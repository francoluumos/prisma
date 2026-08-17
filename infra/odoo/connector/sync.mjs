#!/usr/bin/env node
/**
 * Supabase -> Odoo order sync.
 *
 * One-way, idempotent, and deliberately NOT in the checkout path. Supabase
 * stays the capture buffer: `create_order()` is idempotent on the Stripe
 * session id and cannot lose a paid order. If this connector calls a
 * restarting Odoo, the worst case is "the order syncs on the next run" —
 * never "the customer paid and no order exists". That is the whole reason it
 * runs on a schedule instead of inside the Stripe webhook.
 *
 * Idempotency uses Odoo's own ir.model.data: each synced row gets the external
 * ID `prisma.<model>_<supabase id>`. Before creating anything we look the
 * external ID up, so re-running is safe and a half-finished run resumes
 * cleanly. This is principle 2 of docs/commerce-backend.md, and the reason the
 * Supabase schema mirrors Odoo's table names in the first place.
 *
 * Usage:
 *   node sync.mjs              sync paid orders
 *   node sync.mjs --dry-run    resolve and print, write nothing
 *   node sync.mjs --limit 5    cap the batch
 */

const DRY = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? Number(process.argv[i + 1]) : 50;
})();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ODOO_URL = "http://odoo:8069",
  ODOO_DB = "prisma",
  ODOO_USER,
  ODOO_API_KEY,
} = process.env;

for (const [k, v] of Object.entries({
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ODOO_USER, ODOO_API_KEY,
})) {
  if (!v) {
    console.error(`missing env: ${k}`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------ Supabase */

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`supabase ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/* ---------------------------------------------------------------- Odoo */

let uid = null;

async function rpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e9),
    }),
  });
  const body = await res.json();
  if (body.error) {
    const d = body.error.data || {};
    throw new Error(`odoo: ${d.name || body.error.message}: ${d.message || ""}`);
  }
  return body.result;
}

async function login() {
  uid = await rpc("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]);
  if (!uid) throw new Error("odoo login failed — check ODOO_USER / ODOO_API_KEY");
  return uid;
}

const call = (model, method, args, kwargs = {}) =>
  rpc("object", "execute_kw", [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs]);

/* ------------------------------------------------------- external IDs */

/** Odoo record id for `prisma.<name>`, or null. */
async function resolveXmlId(name) {
  const rows = await call("ir.model.data", "search_read",
    [[["module", "=", "prisma"], ["name", "=", name]]],
    { fields: ["res_id"], limit: 1 });
  return rows.length ? rows[0].res_id : null;
}

async function registerXmlId(name, model, resId) {
  await call("ir.model.data", "create", [{
    module: "prisma", name, model, res_id: resId, noupdate: true,
  }]);
}

/* ------------------------------------------------------------ mapping */

const countryCache = new Map();
async function countryId(code) {
  if (!code) return false;
  if (countryCache.has(code)) return countryCache.get(code);
  const rows = await call("res.country", "search_read",
    [[["code", "=", code.toUpperCase()]]], { fields: ["id"], limit: 1 });
  const id = rows.length ? rows[0].id : false;
  countryCache.set(code, id);
  return id;
}

const productCache = new Map();
async function productId(defaultCode) {
  if (!defaultCode) return false;
  if (productCache.has(defaultCode)) return productCache.get(defaultCode);
  const rows = await call("product.product", "search_read",
    [[["default_code", "=", defaultCode]]], { fields: ["id"], limit: 1 });
  if (!rows.length) throw new Error(`no Odoo product with default_code ${defaultCode} — run seed_products.py`);
  productCache.set(defaultCode, rows[0].id);
  return rows[0].id;
}

function partnerVals(p, parentId = null) {
  const vals = {
    name: p.name,
    email: p.email || false,
    phone: p.phone || p.mobile || false,
    street: p.street || false,
    street2: p.street2 || false,
    zip: p.zip || false,
    city: p.city || false,
    is_company: !!p.is_company,
    comment: p.comment || false,
  };
  if (parentId) {
    vals.parent_id = parentId;
    vals.type = p.type;
  }
  return vals;
}

/** Find-or-create a partner, keyed on its Supabase id via ir.model.data. */
async function syncPartner(p, parentId = null) {
  const xmlid = `res_partner_${p.id}`;
  const existing = await resolveXmlId(xmlid);
  if (existing) return existing;

  const vals = partnerVals(p, parentId);
  vals.country_id = await countryId(p.country_code);

  if (DRY) {
    console.log(`  would create res.partner ${xmlid}:`, JSON.stringify(vals));
    return -1;
  }
  const id = await call("res.partner", "create", [vals]);
  await registerXmlId(xmlid, "res.partner", id);
  return id;
}

/* --------------------------------------------------------------- main */

async function syncOrder(order, partners, linesByOrder, txByOrder) {
  const xmlid = `sale_order_${order.id}`;
  if (await resolveXmlId(xmlid)) return { skipped: true };

  const byId = new Map(partners.map((p) => [p.id, p]));
  const customer = byId.get(order.partner_id);
  if (!customer) throw new Error(`order ${order.name}: partner ${order.partner_id} not found`);

  const customerId = await syncPartner(customer);
  // Addresses are child partners in Odoo (parent_id + type), exactly as
  // modelled in Supabase — so this is a straight pass-through.
  const invoiceP = byId.get(order.partner_invoice_id);
  const shipP = byId.get(order.partner_shipping_id);
  const invoiceId = invoiceP && invoiceP.id !== customer.id
    ? await syncPartner(invoiceP, customerId) : customerId;
  const shippingId = shipP && shipP.id !== customer.id
    ? await syncPartner(shipP, customerId) : customerId;

  const lines = (linesByOrder.get(order.id) || []).sort((a, b) => a.sequence - b.sequence);
  const orderLines = [];
  for (const l of lines) {
    const prod = l.product_id
      ? (await sbProductCode(l.product_id))
      : null;
    orderLines.push([0, 0, {
      product_id: prod ? await productId(prod) : false,
      name: l.name,
      product_uom_qty: Number(l.product_uom_qty),
      price_unit: Number(l.price_unit),
      // Not VAT-registered: never let Odoo attach a default tax here.
      tax_id: [[6, 0, []]],
      sequence: l.sequence,
    }]);
  }

  const tx = txByOrder.get(order.id);
  const ref = [
    order.client_order_ref,
    tx?.provider_reference ? `stripe:${tx.provider_reference}` : null,
  ].filter(Boolean).join(" | ") || false;

  const vals = {
    partner_id: customerId,
    partner_invoice_id: invoiceId,
    partner_shipping_id: shippingId,
    date_order: order.date_order.replace("T", " ").slice(0, 19),
    client_order_ref: ref,
    origin: order.name,           // keeps the PRIxxxxx number visible in Odoo
    note: order.note || false,
    order_line: orderLines,
  };

  if (DRY) {
    console.log(`  would create sale.order ${order.name}:`, JSON.stringify(vals, null, 2));
    return { created: true, dry: true };
  }

  const id = await call("sale.order", "create", [vals]);
  await registerXmlId(xmlid, "sale.order", id);

  // Supabase 'sale' means Stripe already took the money, so the Odoo order is
  // a confirmed sale, not a quotation.
  if (order.state === "sale" || order.state === "done") {
    await call("sale.order", "action_confirm", [[id]]);
  }
  return { created: true, odooId: id };
}

// product_product.id -> default_code, resolved once.
let productCodes = null;
async function sbProductCode(id) {
  if (!productCodes) {
    const rows = await sb("product_product?select=id,default_code");
    productCodes = new Map(rows.map((r) => [r.id, r.default_code]));
  }
  return productCodes.get(id) || null;
}

async function main() {
  await login();
  console.log(`odoo uid=${uid} db=${ODOO_DB}${DRY ? "  [DRY RUN]" : ""}`);

  // Only paid orders. Draft carts are not the ERP's business.
  const orders = await sb(
    `sale_order?state=in.(sale,done)&order=id.asc&limit=${LIMIT}` +
    `&select=id,name,partner_id,partner_invoice_id,partner_shipping_id,state,` +
    `date_order,client_order_ref,note,amount_total`
  );
  if (!orders.length) {
    console.log("no paid orders to sync");
    return;
  }

  const ids = orders.map((o) => o.id).join(",");
  const [lines, txs, partners] = await Promise.all([
    sb(`sale_order_line?order_id=in.(${ids})&select=*`),
    sb(`payment_transaction?sale_order_id=in.(${ids})&select=*`),
    sb(`res_partner?select=*`),
  ]);

  const linesByOrder = new Map();
  for (const l of lines) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
    linesByOrder.get(l.order_id).push(l);
  }
  const txByOrder = new Map(txs.map((t) => [t.sale_order_id, t]));

  let created = 0, skipped = 0, failed = 0;
  for (const o of orders) {
    try {
      const r = await syncOrder(o, partners, linesByOrder, txByOrder);
      if (r.skipped) { skipped++; continue; }
      created++;
      console.log(`synced ${o.name} -> odoo ${r.odooId ?? "(dry)"}`);
    } catch (err) {
      // One bad order must not stop the batch; it retries next run.
      failed++;
      console.error(`FAILED ${o.name}: ${err.message}`);
    }
  }
  console.log(`done — created ${created}, already synced ${skipped}, failed ${failed}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
