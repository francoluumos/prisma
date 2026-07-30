// Vercel serverless function — Stripe webhook receiver.
//
// Verifies the Stripe signature against STRIPE_WEBHOOK_SECRET and, on
// checkout.session.completed, captures the paid order through the single order
// sink in api/_lib/orders.js. Needs the RAW request body for signature
// verification, so bodyParser is disabled.
//
// This path is excluded from the site's Basic-Auth gate in middleware.ts so
// Stripe (which can't send the password) can reach it.
import Stripe from "stripe";
import { createOrder } from "./_lib/orders.js";

export const config = { api: { bodyParser: false } };

/** Storefront product id → the SKU seeded in product_product. */
const SKU = { aero: "PRISMA-ONE", terra: "PRISMA-TERRA" };
const DELIVERY_SKU = { home: "DELIV-HOME", pickup: "DELIV-PICKUP" };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const chf = (cents) => Math.round(cents || 0) / 100;

/** Build the order-sink payload from a paid Checkout Session. */
function toOrderPayload(session, lineItems) {
  const m = session.metadata || {};
  const method = m.method === "pickup" ? "pickup" : "home";
  const name = [m.first, m.last].filter(Boolean).join(" ").trim();

  // api/checkout.js always pushes the bike first and the delivery fee second,
  // so read the amounts Stripe actually charged in that order.
  const [bikeItem, deliveryItem] = lineItems;

  const lines = [];
  if (bikeItem) {
    lines.push({
      line_type: "product",
      product_code: SKU[m.product] || SKU.aero,
      name: [bikeItem.description, m.size, m.colour, m.drivetrain,
             m.pedals && m.pedals !== "No pedals" ? m.pedals : null]
        .filter(Boolean).join(" · "),
      qty: bikeItem.quantity || 1,
      price_unit: chf(bikeItem.amount_subtotal),
      price_total: chf(bikeItem.amount_total),
      config: {
        product: m.product || "aero",
        size: m.size || "",
        colour: m.colour || "",
        drivetrain: m.drivetrain || "",
        pedals: m.pedals || "No pedals",
      },
    });
  }
  if (deliveryItem) {
    lines.push({
      line_type: "delivery",
      product_code: DELIVERY_SKU[method],
      name: deliveryItem.description || method,
      qty: 1,
      price_unit: chf(deliveryItem.amount_subtotal),
      price_total: chf(deliveryItem.amount_total),
    });
  }

  const deliveryAddress = m.s_street
    ? { name: name || undefined, street: m.s_street, zip: m.s_zip, city: m.s_city,
        country_code: m.s_country || "CH" }
    : null;
  // Only sent when "same as delivery" is unticked; null makes the order point
  // its invoice address at the delivery one.
  const invoiceAddress = m.i_street
    ? { name: m.i_name || name || undefined, street: m.i_street, zip: m.i_zip,
        city: m.i_city, country_code: m.i_country || "CH" }
    : null;

  return {
    stripe_session_id: session.id,
    payment_intent:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null,
    amount_total: chf(session.amount_total),
    amount_tax: chf(session.total_details?.amount_tax),
    currency: (session.currency || "chf").toUpperCase(),
    method,
    update_channel: m.update_channel || "email",
    paid_at: new Date().toISOString(),
    customer: {
      name: name || undefined,
      email: session.customer_details?.email || session.customer_email,
      phone: m.phone || session.customer_details?.phone || "",
      wa_opt_in: (m.update_channel || "").includes("whatsapp"),
      newsletter_opt_in: m.newsletter === "1",
    },
    delivery_address: deliveryAddress,
    invoice_address: invoiceAddress,
    pickup_partner:
      method === "pickup" && m.pu_name
        ? { name: m.pu_name, street: m.pu_street || "", zip: m.pu_zip || "",
            city: m.pu_city || "",
            lat: m.pu_lat ? Number(m.pu_lat) : null,
            lon: m.pu_lon ? Number(m.pu_lon) : null }
        : null,
    lines,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whSecret) {
    res.status(200).json({ configured: false });
    return;
  }

  const stripe = new Stripe(key);
  let event;
  try {
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], whSecret);
  } catch (e) {
    res.status(400).send(`Webhook signature verification failed: ${e.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    try {
      // The event payload omits line items; re-read the session so the order
      // records the amounts Stripe actually charged, not what the client sent.
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ["line_items", "customer_details"],
      });
      const result = await createOrder(
        toOrderPayload(session, session.line_items?.data || [])
      );

      if (!result.configured) {
        console.warn("Paid order not persisted — SUPABASE_URL / "
          + "SUPABASE_SERVICE_ROLE_KEY not set:", session.id);
      } else {
        console.log(
          result.created ? "Order captured:" : "Order already captured:",
          result.order_name, session.id
        );
      }
      // TODO: confirmation email, WhatsApp update, pickup-partner notification.
    } catch (e) {
      // 500 makes Stripe retry, and create_order is idempotent — so a transient
      // failure here costs nothing but a redelivery.
      console.error("Order capture failed:", e.message);
      res.status(500).json({ error: "Order capture failed" });
      return;
    }
  }

  res.status(200).json({ received: true });
}
