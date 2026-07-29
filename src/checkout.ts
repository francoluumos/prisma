/* ----------------------------------------------------------------
   Checkout (PROTOTYPE) — Shopify-style two-column checkout.

   Reads the chosen build from URL params (?product=&size=&colour=&
   drivetrain=&pedals=) written by the "Reserve this build" CTA, prices it
   from the shared catalog, and drives the delivery-method / invoice /
   summary interactions. No backend: address validation, the Stripe element,
   and order placement are placeholders to wire later.
   ---------------------------------------------------------------- */
import "./style.css";
import { PRODUCTS, buildTotal, type Product, type ProductId } from "./data/products";

const fmt = (n: number) => "CHF " + n.toLocaleString("en-US").replace(/,/g, "'");

/* --- delivery methods (mirrors the product-page options) --- */
interface Method {
  label: string;
  fee: number;
  lead: string;
}
const METHODS: Record<"home" | "pickup", Method> = {
  home: { label: "Home delivery", fee: 59, lead: "Ships in 4–6 weeks" },
  pickup: { label: "Pickup at a local partner", fee: 0, lead: "Ready to collect in 5–7 weeks" },
};

/* --- placeholder proposed pickup partner (fictional; real one assigned
       from the pickup network once the address is verified) --- */
const PROPOSED_PARTNER = {
  name: "Velowerkstatt (example partner)",
  address: "Musterstrasse 12, 8000 Zürich",
  phone: "+41 44 000 00 00",
  email: "pickup@example.ch",
};

/* --- read the build from the URL, falling back to the product defaults --- */
function readBuild(): {
  product: Product;
  size: string;
  colour: string;
  drivetrain: string;
  pedals: string;
  bikeTotal: number;
} {
  const q = new URLSearchParams(location.search);
  const id = (q.get("product") as ProductId) in PRODUCTS ? (q.get("product") as ProductId) : "aero";
  const product = PRODUCTS[id];
  const d = product.defaults;
  const size = q.get("size") || d.size;
  const colour = q.get("colour") || d.colour;
  const drivetrain = q.get("drivetrain") || d.drivetrain;
  const pedals = q.get("pedals") || product.pedals[0].name;
  const bikeTotal = buildTotal(product, { drivetrain, pedals });
  return { product, size, colour, drivetrain, pedals, bikeTotal };
}

const form = document.querySelector<HTMLFormElement>("[data-checkout]");
if (form) {
  const build = readBuild();
  const colourSpec = build.product.colours.find((c) => c.name === build.colour);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    document.querySelector<T>(sel);
  const set = (sel: string, text: string) => {
    const el = $(sel);
    if (el) el.textContent = text;
  };

  /* --- static: product line + method fees --- */
  const thumb = $<HTMLImageElement>("[data-sum-thumb]");
  if (thumb && colourSpec?.preview) {
    thumb.src = colourSpec.preview;
    thumb.alt = `${build.product.name} in ${build.colour}`;
  }
  const specLine = [build.size, build.colour, build.drivetrain]
    .concat(build.pedals && build.pedals !== "No pedals" ? [build.pedals] : [])
    .join(" · ");
  set("[data-sum-name]", build.product.name);
  set("[data-sum-spec]", specLine);
  set("[data-sum-bike]", fmt(build.bikeTotal));
  set("[data-sum-sub]", fmt(build.bikeTotal));
  set("[data-fee-home]", METHODS.home.fee ? fmt(METHODS.home.fee) : "Free");
  set("[data-fee-pickup]", METHODS.pickup.fee ? fmt(METHODS.pickup.fee) : "Free");

  /* --- reactive summary: method, totals, lead time, pickup, contact --- */
  const pickupPanel = $("[data-pickup-panel]");
  const sumPickup = $("[data-sum-pickup]");

  const render = () => {
    const method = (form.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value ||
      "home") as "home" | "pickup";
    const m = METHODS[method];
    set("[data-sum-method-label]", m.label);
    set("[data-sum-delivery]", m.fee ? fmt(m.fee) : "Free");
    set("[data-sum-total]", fmt(build.bikeTotal + m.fee));
    set("[data-sum-lead]", m.lead);

    const isPickup = method === "pickup";
    if (pickupPanel) pickupPanel.hidden = !isPickup;
    if (sumPickup) sumPickup.hidden = !isPickup;
    if (isPickup) {
      set("[data-pickup-name]", PROPOSED_PARTNER.name);
      set("[data-pickup-address]", PROPOSED_PARTNER.address);
      set("[data-pickup-phone]", PROPOSED_PARTNER.phone);
      set("[data-pickup-email]", PROPOSED_PARTNER.email);
      set("[data-sum-pickup-name]", PROPOSED_PARTNER.name);
      set("[data-sum-pickup-address]", PROPOSED_PARTNER.address);
      set("[data-sum-pickup-phone]", PROPOSED_PARTNER.phone);
      set("[data-sum-pickup-email]", PROPOSED_PARTNER.email);
      const city = $<HTMLInputElement>("[data-addr-city]")?.value.trim();
      set("[data-pickup-near]", city ? `near ${city}` : "");
    }

    // Contact echo in the summary
    const email = $<HTMLInputElement>("#co-email")?.value.trim();
    const phone = $<HTMLInputElement>("#co-phone")?.value.trim();
    set("[data-sum-emailphone]", [email, phone].filter(Boolean).join(" · ") || "—");
  };

  form.addEventListener("change", render);
  form.addEventListener("input", render);

  /* --- invoice: reveal fields only when "same as delivery" is off --- */
  const invoiceSame = $<HTMLInputElement>("[data-invoice-same]");
  const invoiceFields = $("[data-invoice-fields]");
  const syncInvoice = () => {
    if (invoiceFields) invoiceFields.hidden = !!invoiceSame?.checked;
  };
  invoiceSame?.addEventListener("change", syncInvoice);

  /* --- address validation (placeholder — real service wired later) --- */
  const validateBtn = $<HTMLButtonElement>("[data-validate]");
  const validateMsg = $("[data-validate-msg]");
  validateBtn?.addEventListener("click", () => {
    const zip = $<HTMLInputElement>("[data-addr-zip]")?.value.trim() || "";
    const city = $<HTMLInputElement>("[data-addr-city]")?.value.trim() || "";
    const street = $<HTMLInputElement>("[data-addr-street]")?.value.trim() || "";
    if (validateMsg) {
      if (!street || !zip || !city) {
        validateMsg.textContent = "Enter street, postcode and city first.";
        validateMsg.dataset.state = "err";
      } else if (!/^\d{4}$/.test(zip)) {
        validateMsg.textContent = "Swiss postcodes are 4 digits.";
        validateMsg.dataset.state = "err";
      } else {
        validateMsg.textContent = "Address looks valid (prototype check).";
        validateMsg.dataset.state = "ok";
      }
    }
  });

  /* --- place order (prototype — confirms, charges nothing) --- */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>("#co-email")?.value.trim();
    const msg = $("[data-place-msg]");
    if (!msg) return;
    if (!email) {
      msg.textContent = "Add your email to continue.";
      msg.dataset.state = "err";
      return;
    }
    msg.textContent = "Prototype — order captured, but no payment was taken and nothing was stored.";
    msg.dataset.state = "ok";
  });

  syncInvoice();
  render();
}
