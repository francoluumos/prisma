# Payments integration plan — Stripe (TWINT, Klarna, Apple Pay, Google Pay, cards)

Status: **plan / not yet built.** This document is the roadmap for turning the
configurator's "Reserve this build" into a real checkout. Nothing here is wired
up yet — it needs a Stripe account and keys before implementation starts.

## Goal

Let a visitor configure a build and pay for it, supporting Swiss-first methods:
**TWINT**, **Apple Pay**, **Google Pay**, **Klarna** (BNPL), and **cards**. The
site is a static Vite SPA on Vercel with a Supabase backend (edge functions +
Postgres) already in place for the AI assistant — we reuse that backend.

## Recommended approach: Stripe Checkout (hosted) + automatic payment methods

Use **Stripe Checkout** (Stripe-hosted payment page) created server-side, rather
than embedding the Payment Element. Rationale:

- **Every method we want, for free.** With `automatic_payment_methods` enabled,
  Stripe shows TWINT, Apple Pay, Google Pay, Klarna and cards automatically based
  on the buyer's device, country and the session currency (CHF) — no per-method
  UI code. Apple/Google Pay appear on supported devices with zero extra work on a
  Stripe-hosted page (no domain association file needed for hosted Checkout).
- **Least PCI scope + least maintenance.** Card data never touches our origin;
  Stripe handles SCA/3-D Secure, receipts, and method-specific redirect flows
  (TWINT and Klarna are redirect-based).
- **Fast to ship.** One function to create a session, two static result pages, one
  webhook. We can migrate to the embedded Payment Element later for an on-site
  checkout without changing the backent contract much.

> Alternative if we want the checkout to stay visually on prismacycling.ch: the
> **embedded Payment Element**. It supports the same methods but requires hosting
> the Apple Pay domain-association file and more client code + PCI SAQ A. Defer
> unless the hosted redirect is a dealbreaker.

## Payment methods

| Method | Stripe id | Notes |
| --- | --- | --- |
| TWINT | `twint` | Switzerland only, **CHF only**. Redirect flow. Enable in Stripe Dashboard. |
| Apple Pay | `apple_pay` (wallet) | Auto on Safari/iOS. Hosted Checkout needs no domain file. |
| Google Pay | `google_pay` (wallet) | Auto on Chrome/Android. |
| Klarna | `klarna` | BNPL. Available for CHF/EU; check per-country eligibility. Redirect flow. |
| Cards | `card` | Visa/Mastercard/Amex; SCA handled by Stripe. |

All are switched on via `automatic_payment_methods: { enabled: true }` once
enabled on the Stripe account. Currency must be **CHF** for TWINT.

## Flow

1. User configures a build (existing configurator) and taps **Reserve / Buy this build**.
2. Frontend POSTs the selected option **ids** (not prices) to a Supabase edge
   function `create-checkout-session`.
3. The function **recomputes the price server-side** from `products.ts` (never
   trust client prices), builds Stripe line items, creates a Checkout Session in
   **CHF** with `automatic_payment_methods`, and returns the session URL.
4. Frontend redirects to the Stripe-hosted page. User pays with TWINT / wallet /
   Klarna / card.
5. Stripe redirects to `/checkout/success` or `/checkout/cancel` (new static pages).
6. Stripe calls our `stripe-webhook` function on `checkout.session.completed`; we
   verify the signature and record the order in Postgres (source of truth — the
   success redirect is not trusted for fulfilment).

## Backend (Supabase edge functions — mirrors the existing `assistant` function)

```
supabase/functions/
  create-checkout-session/index.ts   # build line items, create Session, return url
  stripe-webhook/index.ts            # verify signature, persist paid orders
  _shared/
    stripe.ts                        # Stripe client (holds STRIPE_SECRET_KEY)
    pricing.ts                       # server-side price from products.ts (build-synced copy)
    products.ts                      # already build-synced (scripts/sync-shared-products.mjs)
```

- **Line items** come from the shared catalog: frame size (base), shift unit,
  pedals, assembly & delivery — reuse `PRODUCTS.aero` + `buildTotal()` in
  `src/data/products.ts`. Custom paint/pattern rides as metadata (and, later, a
  surcharge line item).
- **`create-checkout-session`**: validate the incoming ids against the catalog →
  `stripe.checkout.sessions.create({ mode: 'payment', currency: 'chf',
  line_items, automatic_payment_methods: { enabled: true }, success_url,
  cancel_url, metadata: { config } })`. CORS + rate-limit reuse `_shared/cors.ts`
  and `_shared/ratelimit.ts` from the assistant function.
- **`stripe-webhook`**: `stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)`
  → on `checkout.session.completed`, upsert an `orders` row. Must read the **raw**
  request body for signature verification.

## Data model (Postgres via Supabase)

```
orders(
  id uuid pk, created_at timestamptz,
  stripe_session_id text unique, stripe_payment_intent text,
  email text, amount_total int, currency text, status text,
  product text, config jsonb,          -- size/drivetrain/pedals/assembly/colours
  fulfilment text                       -- build-at-home / half-built / pickup
)
```

RLS: no public read/write; only the service role (edge functions) writes. An
internal/admin view reads them.

## Frontend changes

- Replace the configurator's `#reserve` link target on "Reserve this build" with a
  handler that calls `create-checkout-session` and `window.location = session.url`.
  Keep the email-reserve flow as a fallback / "notify me".
- New static pages `checkout-success.html` and `checkout-cancel.html` (Vite
  entries, shared nav/footer) — success reads `?session_id=` to show a summary and
  a "what happens next" note; fulfilment status comes from the webhook, not the URL.
- Env: `VITE_STRIPE_PUBLISHABLE_KEY` isn't even required for hosted Checkout (we
  only need the session URL), but add it if we later use Stripe.js wallets.

## Secrets / configuration

| Name | Where | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Supabase secret | server-side API calls |
| `STRIPE_WEBHOOK_SECRET` | Supabase secret | verify webhook signatures |
| `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` | function env | redirect targets |

Dashboard setup: enable TWINT, Klarna, Apple Pay, Google Pay under **Settings →
Payment methods**; add the webhook endpoint (`.../functions/v1/stripe-webhook`)
subscribed to `checkout.session.completed` (+ `payment_intent.payment_failed`).

## Compliance & regional notes

- **SCA/3-DS** and PCI are handled by Stripe (hosted Checkout → PCI SAQ A, minimal).
- **CHF** required for TWINT; keep the store single-currency (CHF) initially.
- **Klarna** eligibility varies by country/amount — verify for CH before enabling.
- Update the **Cookie Policy** and **T&C** to name Stripe as a payment processor
  and cover payment/refund terms (the T&C already has price/withdrawal sections).
- Refunds/cancellations map to the 14-day withdrawal clause; add a refund path via
  the Dashboard or a small admin function later.

## Phased rollout

1. **Stripe account + methods enabled** (user) → test keys in place.
2. `create-checkout-session` + success/cancel pages → cards only, **test mode**.
3. Add `automatic_payment_methods` → TWINT + wallets + Klarna in test mode; verify
   TWINT/Klarna redirect and Apple/Google Pay on real devices.
4. `stripe-webhook` + `orders` table → reliable fulfilment record.
5. Legal copy update; go live keys; smoke test one real low-value transaction.

## What I need from you to build it

- A **Stripe account** (Swiss entity for TWINT) with TWINT/Klarna/wallets enabled,
  and **test + live** secret keys.
- Confirmation to charge **immediately** at checkout vs. authorise-on-reserve /
  deposit (changes `mode` and whether we capture later).
- Whether checkout may be **Stripe-hosted** (recommended) or must stay embedded on
  the site (more work; needs the Apple Pay domain file).
- The real company/VAT details (also needed for the Impressum) for receipts.
