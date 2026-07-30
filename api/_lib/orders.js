// The one order sink (docs/commerce-backend.md §7-bis, principle 1).
//
// Every order in the system is written by this module and nothing else.
// It posts to the Supabase `create_order` RPC, which does the whole write in a
// single transaction and is idempotent on the Stripe Checkout Session id.
//
// When the system of record moves to Odoo, this file is what gets rewritten
// (POST to Odoo's API instead of Supabase) — the webhook that calls it and the
// storefront that feeds it stay untouched.

/** Shape of the payload `createOrder` accepts.
 *
 *  {
 *    stripe_session_id, payment_intent, amount_total, amount_tax, currency,
 *    method: 'home' | 'pickup', update_channel, paid_at,
 *    customer:         { name, email, phone, wa_opt_in, newsletter_opt_in },
 *    delivery_address: { name, street, street2, zip, city, country_code },
 *    invoice_address:  same shape, or null when "same as delivery",
 *    pickup_partner:   { name, street, zip, city, lat, lon } | null,
 *    lines: [{ line_type, product_code, name, qty, price_unit, price_total, config }]
 *  }
 */

/**
 * Persist a paid order.
 * @returns {Promise<{configured: boolean, order_id?: number, order_name?: string, created?: boolean}>}
 *   `configured: false` when Supabase env vars aren't set (local/preview) — the
 *   caller should log and move on rather than fail the webhook.
 * @throws on a real backend error, so Stripe retries the webhook.
 */
export async function createOrder(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false };

  const res = await fetch(`${url}/rest/v1/rpc/create_order`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ payload }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`create_order failed (${res.status}): ${text}`);
  }
  return { configured: true, ...JSON.parse(text) };
}
