// Vercel serverless function — Stripe webhook receiver.
//
// Verifies the Stripe signature against STRIPE_WEBHOOK_SECRET and reacts to
// checkout.session.completed (where real fulfilment would go: create the
// order, email confirmation, notify the pickup partner, etc.). Needs the RAW
// request body for signature verification, so bodyParser is disabled.
//
// This path is excluded from the site's Basic-Auth gate in middleware.ts so
// Stripe (which can't send the password) can reach it.
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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
    const session = event.data.object;
    // TODO fulfilment: persist the order, email the customer, notify the
    // pickup partner. session.metadata carries the build; session.customer_email
    // the contact. For the prototype we just acknowledge.
    console.log("Paid order:", session.id, session.metadata, session.customer_email);
  }

  res.status(200).json({ received: true });
}
