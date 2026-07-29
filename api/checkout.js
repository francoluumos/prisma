// Vercel serverless function — create a Stripe Checkout Session.
//
// The browser POSTs the chosen build; the server re-prices it from the table
// below (NEVER trust a client-sent amount) and returns a Stripe-hosted
// payment URL to redirect to. If STRIPE_SECRET_KEY isn't set yet, it responds
// { configured: false } so the checkout page keeps its prototype behaviour.
//
// Keep PRICES in sync with src/data/products.ts (same values the UI shows).
import Stripe from "stripe";

const PRICES = {
  aero: {
    name: "Prisma One",
    drivetrains: {
      "Wheeltop EDS-TX": 1414, "Shimano 105": 1435, "Shimano 105 Di2": 1865,
      "Shimano Ultegra Di2": 2187, "Shimano Dura-Ace Di2": 2890,
    },
    pedals: { "No pedals": 0, "Shimano PD RS 500": 53, "Shimano Ultegra PD R8000": 103 },
  },
  terra: {
    name: "Prisma Terra",
    drivetrains: { "Shimano GRX600": 1589, "Wheeltop GEX": 1240 },
    pedals: { "No pedals": 0 },
  },
};
const DELIVERY = { home: 59, pickup: 149 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    // Not wired yet — the page falls back to its prototype confirmation.
    res.status(200).json({ configured: false });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { product = "aero", size = "", colour = "", drivetrain = "", pedals = "No pedals",
      method = "home", email, phone = "", whatsapp = false } = body;

    const cat = PRICES[product] || PRICES.aero;
    const bike = (cat.drivetrains[drivetrain] || 0) + (cat.pedals[pedals] || 0);
    if (bike <= 0) {
      res.status(400).json({ error: "Unrecognised build — cannot price." });
      return;
    }
    const delivery = DELIVERY[method] ?? DELIVERY.home;

    const spec = [size, colour, drivetrain, pedals !== "No pedals" ? pedals : null]
      .filter(Boolean).join(" · ");

    const stripe = new Stripe(key);
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const line_items = [
      {
        quantity: 1,
        price_data: {
          currency: "chf",
          unit_amount: bike * 100,
          product_data: { name: cat.name, description: spec },
        },
      },
    ];
    if (delivery > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "chf",
          unit_amount: delivery * 100,
          product_data: { name: method === "pickup" ? "Pickup" : "Home delivery" },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: email || undefined,
      success_url: `${origin}/checkout.html?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?status=cancelled`,
      // update_channel tells fulfilment whether to message the customer on
      // WhatsApp (via the official Cloud API) in addition to email.
      metadata: {
        product, size, colour, drivetrain, pedals, method,
        phone: phone || "",
        update_channel: whatsapp && phone ? "whatsapp+email" : "email",
      },
    });

    res.status(200).json({ configured: true, url: session.url });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : "Stripe error" });
  }
}
