# Commerce backend — decision doc

_Status: **DECIDED — Supabase-first, migration-ready.** Last updated 2026-07-29._

> **Decision (2026-07-29):** build the commerce layer custom on **Supabase +
> Stripe (Tax + Invoicing)** now, following the six migration-cheap principles
> in §7-bis, and move the order/finance system of record to **Odoo (free,
> self-hosted Community)** later. Odoo.sh is a *paid* managed-hosting option and
> is **not** the free target — the free target is self-hosted Community; the
> hosting choice is deferred to migration time. Estimated later migration:
> **~1–3 focused weeks** if built to the principles below.

How Prisma runs orders, customers, inventory, invoicing and fulfilment behind
the custom Vite storefront. Sibling to `payments-plan.md` and
`analytics-plan.md`. This doc exists to make the choice deliberately, not by
default.

---

## TL;DR recommendation

**Launch on a lean custom Supabase commerce layer + Stripe (Tax + Invoicing).
Do not stand up an ERP for Prisma yet. Build one clean `orders` seam so the
books and fulfilment can be offloaded to Odoo (or Bexio) later without touching
the storefront.**

Rationale: you're technical, launching, low volume, want full UX control, and
already run Supabase. Stripe now absorbs the scary parts (VAT, invoicing). The
risk to manage is *not using Supabase* — it's letting the custom build quietly
become an ERP. The phased plan below prevents that.

---

## 1. The real distinction: commerce layer vs back-office

An "e-commerce backend" is two different things. Decide them separately.

| Layer | What it is | Build custom? |
| --- | --- | --- |
| **Commerce / storefront** | catalog & config pricing, cart, orders, customer accounts, saved builds, pickup partners, waitlist | **Yes** — your domain, full UX control, Supabase is great here |
| **Back-office / ERP** | inventory-of-record, made-to-order component depletion, procurement, VAT & compliant invoicing, accounting handoff, fulfilment/labels/tracking, returns/RMA, **admin UI** | **No, don't hand-build** — years of solved, boring, liability-heavy work |

The whole strategy: **own the commerce layer, buy/offload the back-office.**

---

## 2. What a Prisma backend must actually do

Requirements that shape the choice (a bike is not a stock SKU):

- **Made-to-order assembly.** Frame + chosen drivetrain + pedals, assembled &
  checked (the CHF 149 pickup fee pays for partner assembly). This is light
  manufacturing / kitting, not stock e-commerce. Shopify doesn't model
  bill-of-materials natively; ERPs do; custom can, with effort.
- **Configurator pricing** (already in `src/data/products.ts`).
- **Two delivery paths** — home (CHF 59) and partner pickup (CHF 149) with
  nearest-partner routing (already prototyped, GeoAdmin-geocoded).
- **Pickup-partner management** — who's confirmed, address, commission.
- **Payments** — Stripe (already scaffolded: `api/checkout.js` + webhook).
- **Customers/accounts** — email + phone (+ WhatsApp opt-in).
- **Swiss compliance** — VAT, compliant invoices; B2B may expect invoice/QR-bill.
- **Fulfilment** — labels, carrier, tracking (DancingQueens already has
  AfterShip/JTL on Odoo).
- **Admin** — a non-developer must view/refund/fulfil orders, manage inventory.
- **Returns / warranty**.

---

## 3. Options

### A) Custom on Supabase (+ Stripe)  ← recommended for launch
Supabase (Postgres, RLS, Auth with email+phone, storage, edge functions,
realtime) for the commerce layer; Stripe for payments, **Stripe Tax** for VAT,
**Stripe Invoicing** for compliant invoices + customer portal.

- **Fit:** excellent for storefront/orders/accounts; you already run Supabase.
- **Effort:** low–moderate to launch; grows if you add back-office yourself.
- **Cost:** cheapest — no per-order platform fee; Supabase + Stripe fees only.
- **Pros:** total UX + data control; no tool sprawl; one system you own; fast.
- **Cons:** you own the **admin UI** (biggest hidden cost), and inventory/
  procurement/returns if/when they grow. Discipline required to not rebuild ERP.
- **Operated by:** you (dev) + Supabase table editor / Stripe Dashboard early.

### B) Odoo as backbone (headless)
Keep the custom frontend; Odoo is the system of record (Sales, Inventory, BOM/
assembly, Purchase, Invoicing+VAT, Contacts, fulfilment via existing
connectors). Orders flow in via Odoo API.

- **Fit:** strongest for the *back-office* — made-to-order assembly, procurement,
  Swiss accounting are Odoo's wheelhouse, and you already run it at DancingQueens.
- **Effort:** higher upfront (stand up a Prisma company/DB, API integration);
  lower long-term for ops/finance.
- **Cost:** Odoo licensing + hosting; no per-order fee.
- **Pros:** don't build an ERP; reuse your Odoo muscle, connectors, agentic loop;
  real inventory/MRP/VAT/invoicing from day one; proper admin exists.
- **Cons:** heavier; Odoo's own website is clunky (use it headless, backend-only);
  couples Prisma to DancingQueens tooling unless separate instance.
- **Operated by:** you — reusing existing Odoo skills.

### C) Shopify (headless)
Shopify as commerce backend behind the custom frontend (Storefront API), via the
connected Shopify MCP.

- **Fit:** great storefront features (discounts, tax automation, Shop Pay,
  abandoned cart, apps); **weak at bill-of-materials assembly** (bikes as
  variants loses true component model).
- **Effort:** moderate; lots handled for you, but headless + custom checkout has
  limits unless Shopify Plus.
- **Cost:** monthly + transaction fees; adds up.
- **Pros:** mature commerce, fast to a lot of features, good admin.
- **Cons:** rigid checkout for a custom configurator flow; **risk of running
  Shopify *and* Odoo** and reconciling them — tool sprawl for a small team.
- **Operated by:** anyone — Shopify admin is friendly.

### D) Headless commerce framework (Medusa / Saleor) — noted, not recommended now
Open-source, TS-native (Medusa), flexible, self-hosted. More commerce structure
than raw Supabase, but another system to run and **no ERP depth** (accounting/
VAT/procurement still elsewhere). Reconsider only if custom Supabase outgrows
itself but you still don't want Odoo.

---

## 4. Comparison

| | Custom Supabase | Odoo (headless) | Shopify (headless) |
| --- | --- | --- | --- |
| Storefront UX control | ★★★ full | ★★★ full | ★★☆ (checkout limits) |
| Made-to-order assembly | build it | ★★★ native | ✗ weak |
| Swiss VAT / invoicing | Stripe Tax+Invoicing | ★★★ native | tax add-ons |
| Admin for non-devs | **you build** | ★★★ exists | ★★★ exists |
| Inventory / procurement | build it | ★★★ native | ★★ basic |
| Time to launch | ★★★ fast | ★★ slower | ★★ moderate |
| Ongoing cost | ★★★ lowest | ★★ licence | ★ fees |
| Reuses your assets | Supabase | **Odoo + connectors** | Shopify MCP |
| Tool sprawl risk | low | low (if sole) | **high (w/ Odoo)** |

---

## 5. Swiss / legal angle (matters, don't skip)

- **VAT:** Stripe Tax computes CH VAT automatically (custom path) or Odoo does it.
- **Invoicing:** Stripe Invoicing gives compliant invoices + a hosted portal;
  Odoo issues invoices natively. Either satisfies B2C.
- **QR-bill:** Swiss payment slip. B2C card-only via Stripe rarely needs it; B2B
  buyers often expect an invoice/QR-bill — depends on your buyer mix.
- **Accounting handoff:** whatever you pick, orders/invoices must reach your
  fiduciary (Bexio/Abacus/exports). Design the export early.

---

## 6. The three "accidental ERP" risks (for the custom path)

1. **Admin UI** — most underestimated. Someone views/refunds/fulfils orders and
   edits inventory. Early mitigation: Supabase table editor + Stripe Dashboard +
   a thin internal gated page (same pattern as the existing `/network` tool).
2. **VAT / invoicing / accounting** — use Stripe Tax + Invoicing now; export to
   the fiduciary; don't hand-build compliant invoicing.
3. **Inventory / procurement** — a few tables if it's "frames + a few
   components"; if it grows to multi-supplier POs / multi-warehouse, that's the
   trigger to offload to Odoo.

---

## 7. Recommended architecture (phased)

```
Custom Vite frontend (configurator, checkout — keep it)
        │  Stripe (payment) + Stripe Tax (VAT) + Stripe Invoicing
        ▼
Stripe webhook  →  Supabase: write the paid ORDER (system of record for now)
        │
Supabase commerce layer:
   customers · builds · orders (state machine) · pickup_partners · waitlist
        │
        └─(later, when volume justifies)─►  sync orders/invoices to
                                            Odoo or Bexio for books + fulfilment
```

**Starter schema (small, honest):**
```
customers        id, email, phone, wa_opt_in, created_at        (Supabase Auth-backed)
builds           id, product, size, colour, drivetrain, pedals, price_chf
orders           id, customer_id, build_id, status, delivery_method,
                 delivery_addr, invoice_addr, pickup_partner_id,
                 stripe_session_id, stripe_payment_intent,
                 amount_chf, vat_chf, created_at, paid_at
                 status: pending→paid→in_assembly→ready/shipped→delivered→returned
pickup_partners  id, name, address, geo(lat,lon), confirmed, commission_pct
components/stock (add ONLY when you actually track it)
```
RLS: customers see only their own orders; admin via service-role on internal pages.

---

## 7-bis. Migration cost & how to keep it cheap (the chosen path)

Later Supabase → Odoo migration is **~1–3 focused weeks** if built to the
principles below (4–8+ weeks and risky if not). The dominant cost is **domain
re-mapping + re-pointing integrations**, NOT data export.

| Migration work | Effort |
| --- | --- |
| Export/import customers, orders, partners → Odoo | Low (CSV/API import) |
| Re-point order-capture (webhook → Odoo API not Supabase) | Low–Med (small if one order-sink) |
| Map model → Odoo objects (build→`sale.order`+lines, addr→`res.partner`, pickup→carrier/custom fields, assembly→BOM) | **Med — the real work** |
| Invoicing/VAT: Stripe → Odoo (or keep Stripe + sync) | Med |
| Admin retraining | Minimal (Odoo admin exists) |

**Six principles to keep the migration near 1 week — build to these now:**
1. **One order-sink** — every order write goes through a single
   `createOrder(payload)` module. Swapping to Odoo = reimplement that one function.
2. **Stable external IDs** on every entity → map to Odoo `ir.model.data`; imports
   become idempotent/re-runnable.
3. **Model in Odoo's shape now** — order / line / partner / address translate 1:1
   to `sale.order` / `sale.order.line` / `res.partner`.
4. **Keep the back-office OUT** — Stripe Tax + Invoicing; don't hand-build
   inventory/invoicing. Nothing there to migrate; Odoo takes that role wholesale.
5. **Stripe is the constant** — store `stripe_session_id` / `payment_intent` on
   each order so Odoo can reconcile.
6. **Plain relational tables** in the order path — no Supabase-only exotica; trivial export.

**Odoo target hosting (deferred to migration time):** free = **self-hosted
Community** (Docker/VPS; Community includes Sales, Inventory, MRP/BOM assembly,
Purchase, Invoicing, Swiss `l10n_ch` VAT+QR-bill; lacks full Accounting → export
to fiduciary/Bexio). **Odoo.sh is paid** managed hosting — a convenience, not the
free path. Reusing the DancingQueens instance is a separate option (couples the
two businesses) — not chosen; Prisma stays independent.

**Why not Odoo-first, given it's "free"?** Chosen path trades a small future
migration for launch speed + UX simplicity now. Note the subscription saving is
minor (Supabase free tier ≈ self-hosted Community ≈ free), so the real driver is
speed/simplicity, not cost — accepted with eyes open.

## 8. Roadmap

1. **Capture (next step, choice-independent).** Stripe webhook → write a paid
   `order` row in Supabase. Correct orders start accruing immediately.
2. **Accounts.** Supabase Auth (email/phone); "my orders" + status page.
3. **Tax & invoicing.** Enable Stripe Tax; issue Stripe invoices; export to books.
4. **Admin.** Thin internal gated pages for orders/refunds/fulfilment +
   partner management; Supabase editor for the rest.
5. **Fulfilment routing.** Home vs partner; labels/tracking (reuse AfterShip/JTL
   patterns).
6. **Offload trigger.** When inventory/procurement/returns/admin outgrow the
   custom build, sync the `orders`/invoice stream into Odoo/Bexio — storefront
   untouched.

---

## 9. Triggers to switch backbone

Move the system of record to Odoo when **two or more** are true:
- Non-technical ops staff need a real admin daily.
- Multi-supplier procurement / multi-warehouse inventory.
- Returns/warranty volume needs proper RMA workflows.
- Accountant needs tighter, native bookkeeping than exports allow.
- Order volume makes manual/thin-admin ops the bottleneck.

Until then, custom Supabase is the leaner, cheaper, faster choice.

---

## 10. Open questions for Franco

1. **Buyer mix** — mostly B2C card (Stripe covers it) or meaningful B2B needing
   invoices/QR-bill?
2. **Prisma ↔ DancingQueens** — deliberately separate stacks, or is reusing the
   DQ Odoo instance on the table later?
3. **Who operates orders day-to-day** — just you for now, or non-technical staff
   soon (raises the admin-UI priority)?
4. **Expected launch volume** — tens/month (custom is ideal) or hundreds fast
   (revisit Odoo sooner)?
5. **Accounting today** — which tool does the fiduciary use (Bexio/Abacus/…)? It
   shapes the export seam.
