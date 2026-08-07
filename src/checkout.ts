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
import { initAnalyticsWithConsent, track } from "./analytics";

const fmt = (n: number) => "CHF " + n.toLocaleString("en-US").replace(/,/g, "'");

/* --- delivery methods (mirrors the product-page options) --- */
interface Method {
  label: string;
  fee: number;
  lead: string;
}
const METHODS: Record<"home" | "pickup", Method> = {
  home: { label: "Home delivery", fee: 59, lead: "Ships in 4–6 weeks" },
  pickup: { label: "Pickup at a local partner", fee: 149, lead: "Ready to collect in 5–7 weeks" },
};

/* --- real mechanics database (public/checkout-mechanics.json, from OSM).
       These shops are NOT confirmed Prisma partners yet — we surface the
       nearest one as a proposal; confirmed partners get wired in later. --- */
interface Mechanic {
  n: string; la: number; lo: number; st: string; z: string; c: string; p: string; e: string;
}
let mechanics: Mechanic[] | null = null;
async function loadMechanics(): Promise<Mechanic[]> {
  if (!mechanics) {
    try {
      mechanics = (await (await fetch("/checkout-mechanics.json")).json()) as Mechanic[];
    } catch {
      mechanics = [];
    }
  }
  return mechanics;
}

function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Geocode a Swiss address to WGS84 lat/lon via the free GeoAdmin API. */
const geocodeCache = new Map<string, { lat: number; lon: number } | null>();
async function geocode(text: string): Promise<{ lat: number; lon: number } | null> {
  if (!text.trim()) return null;
  if (geocodeCache.has(text)) return geocodeCache.get(text)!;
  let coord: { lat: number; lon: number } | null = null;
  try {
    const url =
      "https://api3.geo.admin.ch/rest/services/api/SearchServer" +
      `?type=locations&origins=address,zipcode,gg25&limit=1&sr=4326&searchText=${encodeURIComponent(text)}`;
    const d = await (await fetch(url)).json();
    const a = d.results?.[0]?.attrs;
    if (a && typeof a.lat === "number" && typeof a.lon === "number") coord = { lat: a.lat, lon: a.lon };
  } catch {
    /* offline / rate-limited → leave null */
  }
  geocodeCache.set(text, coord);
  return coord;
}

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

/* --- Address autocomplete: type a street, pick a real Swiss address from the
       free GeoAdmin API, and auto-fill street / postcode / city. --- */
interface AddrHit { street: string; zip: string; city: string; label: string; }
function parseGeoLabel(label: string): AddrHit | null {
  // "Bahnhofstrasse 1 <b>8001 Zürich</b>"
  const m = label.match(/^(.*?)\s*<b>\s*(\d{4})\s+(.*?)\s*<\/b>/);
  if (!m) return null;
  return { street: m[1].trim(), zip: m[2], city: m[3].trim(), label: label.replace(/<[^>]+>/g, "") };
}
function attachAddressAutocomplete(
  street: HTMLInputElement,
  zip: HTMLInputElement,
  city: HTMLInputElement
): void {
  const field = street.closest<HTMLElement>(".co-field");
  if (!field) return;
  field.style.position = "relative";
  street.setAttribute("autocomplete", "off");
  const list = document.createElement("ul");
  list.className = "co-ac";
  list.hidden = true;
  field.appendChild(list);

  let hits: AddrHit[] = [];
  let active = -1;
  let timer = 0;
  let seq = 0;      // ignore responses from searches superseded by a pick/close
  let filling = false; // true while fill() replays input events downstream
  const close = () => {
    // A pending debounce or in-flight fetch would re-open the list moments
    // after it closes — cancel both, so "closed" stays closed.
    window.clearTimeout(timer);
    seq++;
    list.hidden = true;
    active = -1;
    list.innerHTML = "";
  };

  const fill = (h: AddrHit) => {
    street.value = h.street;
    zip.value = h.zip;
    city.value = h.city;
    close();
    // These notify the summary / nearest-mechanic logic; our own input handler
    // must not treat them as the user typing, or it re-opens the dropdown.
    filling = true;
    for (const el of [street, zip, city]) el.dispatchEvent(new Event("input", { bubbles: true }));
    filling = false;
  };

  const render = () => {
    list.innerHTML = "";
    hits.forEach((h, i) => {
      const li = document.createElement("li");
      li.className = "co-ac__item" + (i === active ? " is-active" : "");
      li.textContent = h.label;
      li.addEventListener("mousedown", (e) => { e.preventDefault(); fill(h); });
      list.appendChild(li);
    });
    list.hidden = hits.length === 0;
  };

  const search = async () => {
    const q = street.value.trim();
    if (q.length < 3) return close();
    const text = [q, city.value.trim()].filter(Boolean).join(" ");
    const mine = ++seq;
    try {
      const url =
        "https://api3.geo.admin.ch/rest/services/api/SearchServer" +
        `?type=locations&origins=address&limit=6&sr=4326&searchText=${encodeURIComponent(text)}`;
      const d = await (await fetch(url)).json();
      if (mine !== seq) return; // a pick or a newer keystroke won — drop this
      hits = (d.results || []).map((r: { attrs: { label: string } }) => parseGeoLabel(r.attrs.label))
        .filter((h: AddrHit | null): h is AddrHit => !!h);
      active = -1;
      render();
    } catch {
      if (mine === seq) close();
    }
  };

  street.addEventListener("input", () => {
    if (filling) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(search, 250);
  });
  street.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, hits.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); fill(hits[active]); }
    else if (e.key === "Escape") { close(); }
  });
  street.addEventListener("blur", () => window.setTimeout(close, 150));
}

const form = document.querySelector<HTMLFormElement>("[data-checkout]");
if (form) {
  const build = readBuild();
  const colourSpec = build.product.colours.find((c) => c.name === build.colour);

  // This page has no cookie banner of its own (it isn't an entry point in
  // normal flow), so analytics only runs if consent was already given upstream.
  initAnalyticsWithConsent();
  track("checkout_viewed", {
    model: build.product.id, total_chf: build.bikeTotal,
    size: build.size, colour: build.colour, drivetrain: build.drivetrain,
  });

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

  // Nearest-mechanic result for the current delivery address (null until found).
  let pickup: { m: Mechanic; km: number; min: number } | null = null;

  const currentMethod = () =>
    (form.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value || "home") as
      | "home"
      | "pickup";

  const render = () => {
    const method = currentMethod();
    const m = METHODS[method];
    set("[data-sum-method-label]", m.label);
    set("[data-sum-delivery]", m.fee ? fmt(m.fee) : "Free");
    set("[data-sum-total]", fmt(build.bikeTotal + m.fee));
    set("[data-sum-lead]", m.lead);

    const isPickup = method === "pickup";
    if (pickupPanel) pickupPanel.hidden = !isPickup;
    if (sumPickup) sumPickup.hidden = !isPickup;

    if (isPickup) {
      if (pickup) {
        const { m: mech, km, min } = pickup;
        const addr = [mech.st, [mech.z, mech.c].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        const drive = `~${min} min by car · ${km} km`;
        set("[data-pickup-name]", mech.n);
        set("[data-pickup-address]", addr || mech.c || "");
        set("[data-pickup-phone]", mech.p || "Phone on confirmation");
        set("[data-pickup-email]", mech.e || "");
        set("[data-pickup-drive]", drive);
        set("[data-pickup-near]", mech.c ? `is in ${mech.c}` : "");
        set("[data-sum-pickup-name]", mech.n);
        set("[data-sum-pickup-address]", addr);
        set("[data-sum-pickup-phone]", mech.p || "");
        set("[data-sum-pickup-email]", mech.e || "");
        set("[data-sum-pickup-drive]", drive);
      } else {
        set("[data-pickup-name]", "Enter your delivery address");
        set("[data-pickup-address]", "We'll find your nearest pickup point.");
        set("[data-pickup-phone]", "");
        set("[data-pickup-email]", "");
        set("[data-pickup-drive]", "");
        set("[data-pickup-near]", "");
        set("[data-sum-pickup-name]", "—");
        set("[data-sum-pickup-address]", "Enter your address to assign one");
        set("[data-sum-pickup-phone]", "");
        set("[data-sum-pickup-email]", "");
        set("[data-sum-pickup-drive]", "");
      }
    }

    // Contact echo + update channel in the summary
    const email = $<HTMLInputElement>("#co-email")?.value.trim();
    const phone = $<HTMLInputElement>("#co-phone")?.value.trim();
    const wantsWhatsApp = !!$<HTMLInputElement>("[data-whatsapp]")?.checked;
    set("[data-sum-emailphone]", [email, phone].filter(Boolean).join(" · ") || "—");
    set("[data-sum-channel]", wantsWhatsApp && phone ? "Email + WhatsApp" : "Email");
    // Opt-in needs a number to message — nudge, don't block.
    set("[data-whatsapp-hint]", wantsWhatsApp && !phone ? " Add your phone number above." : "");
  };

  // Geocode the delivery address, find the nearest mechanic, estimate drive time.
  const addrText = () => {
    const street = $<HTMLInputElement>("[data-addr-street]")?.value.trim() || "";
    const zip = $<HTMLInputElement>("[data-addr-zip]")?.value.trim() || "";
    const city = $<HTMLInputElement>("[data-addr-city]")?.value.trim() || "";
    return { street, zip, city, text: [street, zip, city].filter(Boolean).join(" ") };
  };
  const resolvePickup = async () => {
    if (currentMethod() !== "pickup") return;
    const { zip, city, text } = addrText();
    if (!zip && !city) {
      pickup = null;
      render();
      return;
    }
    const [list, coord] = await Promise.all([loadMechanics(), geocode(text)]);
    if (!coord || !list.length) {
      pickup = null;
      render();
      return;
    }
    let best: Mechanic | null = null;
    let bestKm = Infinity;
    for (const mech of list) {
      const d = haversineKm(coord.lat, coord.lon, mech.la, mech.lo);
      if (d < bestKm) {
        bestKm = d;
        best = mech;
      }
    }
    if (best) {
      const roadKm = bestKm * 1.3; // straight-line → rough road distance
      pickup = { m: best, km: Math.max(1, Math.round(roadKm)), min: Math.max(3, Math.round((roadKm / 55) * 60)) };
    }
    render();
  };

  form.addEventListener("input", render);
  form.addEventListener("change", (e) => {
    render();
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.name === "method") resolvePickup();
  });
  // Re-find the nearest mechanic (debounced) as the address is typed.
  let addrTimer = 0;
  form.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-addr-street],[data-addr-zip],[data-addr-city]")) {
      window.clearTimeout(addrTimer);
      addrTimer = window.setTimeout(resolvePickup, 550);
    }
  });

  /* --- street autocomplete for delivery + invoice addresses --- */
  const dStreet = $<HTMLInputElement>("[data-addr-street]");
  const dZip = $<HTMLInputElement>("[data-addr-zip]");
  const dCity = $<HTMLInputElement>("[data-addr-city]");
  if (dStreet && dZip && dCity) attachAddressAutocomplete(dStreet, dZip, dCity);
  const iStreet = $<HTMLInputElement>("#co-inv-street");
  const iZip = $<HTMLInputElement>("#co-inv-zip");
  const iCity = $<HTMLInputElement>("#co-inv-city");
  if (iStreet && iZip && iCity) attachAddressAutocomplete(iStreet, iZip, iCity);

  /* --- invoice: reveal fields only when "same as delivery" is off --- */
  const invoiceSame = $<HTMLInputElement>("[data-invoice-same]");
  const invoiceFields = $("[data-invoice-fields]");
  const syncInvoice = () => {
    if (invoiceFields) invoiceFields.hidden = !!invoiceSame?.checked;
  };
  invoiceSame?.addEventListener("change", syncInvoice);

  /* --- address validation via the Swiss federal GeoAdmin API (free, no key) --- */
  const validateBtn = $<HTMLButtonElement>("[data-validate]");
  const validateMsg = $("[data-validate-msg]");
  validateBtn?.addEventListener("click", async () => {
    if (!validateMsg) return;
    const zip = $<HTMLInputElement>("[data-addr-zip]")?.value.trim() || "";
    const city = $<HTMLInputElement>("[data-addr-city]")?.value.trim() || "";
    const street = $<HTMLInputElement>("[data-addr-street]")?.value.trim() || "";
    const setMsg = (t: string, s: "ok" | "err" | "") => {
      validateMsg.textContent = t;
      if (s) validateMsg.dataset.state = s;
      else validateMsg.removeAttribute("data-state");
    };
    if (!street || !zip || !city) return setMsg("Enter street, postcode and city first.", "err");
    if (!/^\d{4}$/.test(zip)) return setMsg("Swiss postcodes are 4 digits.", "err");
    setMsg("Checking…", "");
    try {
      const q = encodeURIComponent(`${street} ${zip} ${city}`);
      const url =
        "https://api3.geo.admin.ch/rest/services/api/SearchServer" +
        `?type=locations&origins=address&limit=1&sr=2056&searchText=${q}`;
      const data = await (await fetch(url)).json();
      const top = data.results?.[0];
      if (top?.attrs?.label) {
        setMsg("✓ " + top.attrs.label.replace(/<[^>]+>/g, ""), "ok");
        resolvePickup(); // refresh the nearest pickup point for this address
      } else {
        setMsg("Address not found — please check the details.", "err");
      }
    } catch {
      setMsg("Couldn't reach the address service — try again.", "err");
    }
  });

  /* --- place order → Stripe Checkout (redirect). Falls back to a prototype
         message until STRIPE_SECRET_KEY is set on the server. --- */
  const placeLabel = $("[data-place-label]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("[data-place-msg]");
    if (!msg) return;
    const setMsg = (t: string, s: "ok" | "err" | "") => {
      msg.textContent = t;
      if (s) msg.dataset.state = s;
      else msg.removeAttribute("data-state");
    };
    const email = $<HTMLInputElement>("#co-email")?.value.trim();
    if (!email) return setMsg("Add your email to continue.", "err");

    const method = (form.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value ||
      "home") as "home" | "pickup";
    const phone = $<HTMLInputElement>("#co-phone")?.value.trim() || "";
    const whatsapp = !!$<HTMLInputElement>("[data-whatsapp]")?.checked && !!phone;
    const newsletter = !!$<HTMLInputElement>("[data-newsletter]")?.checked;

    // Contact + addresses ride along in the Stripe session's metadata so the
    // webhook can write a complete order (customer, delivery and invoice
    // addresses, assigned pickup partner) without a second round-trip.
    const val = (sel: string) => $<HTMLInputElement>(sel)?.value.trim() || "";
    const address = {
      street: val("#co-street"),
      zip: val("#co-zip"),
      city: val("#co-city"),
      country: $<HTMLSelectElement>("#co-country")?.value.trim() || "CH",
    };
    const invoiceSameNow = $<HTMLInputElement>("[data-invoice-same]")?.checked !== false;
    const invoiceAddress = invoiceSameNow
      ? null
      : {
          name: val("#co-inv-name"),
          street: val("#co-inv-street"),
          zip: val("#co-inv-zip"),
          city: val("#co-inv-city"),
          country: "CH",
        };
    const pickupPartner =
      method === "pickup" && pickup
        ? {
            name: pickup.m.n,
            street: pickup.m.st || "",
            zip: pickup.m.z || "",
            city: pickup.m.c || "",
            lat: pickup.m.la,
            lon: pickup.m.lo,
          }
        : null;

    // The last click before money changes hands — the end of the funnel.
    track("checkout_payment_started", {
      model: build.product.id,
      method,
      total_chf: build.bikeTotal + (method === "pickup" ? 149 : 59),
      has_pickup_partner: !!pickupPartner,
      whatsapp_opt_in: whatsapp,
    });

    if (placeLabel) placeLabel.textContent = "Starting secure payment…";
    setMsg("", "");
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product: build.product.id,
          size: build.size,
          colour: build.colour,
          drivetrain: build.drivetrain,
          pedals: build.pedals,
          method,
          email,
          phone,
          whatsapp,
          newsletter,
          first: val("#co-first"),
          last: val("#co-last"),
          address,
          invoiceAddress,
          pickup: pickupPartner,
        }),
      });
      const data = await r.json();
      if (data.url) {
        window.location.href = data.url; // → Stripe-hosted payment page
        return;
      }
      if (data.configured === false) {
        setMsg(
          "Prototype — Stripe isn't connected yet, so no payment was taken. (Set STRIPE_SECRET_KEY to go live.)",
          "ok"
        );
      } else {
        setMsg(data.error || "Could not start payment. Please try again.", "err");
      }
    } catch {
      setMsg("Network error starting payment. Please try again.", "err");
    }
    if (placeLabel) placeLabel.textContent = "Place order";
  });

  /* --- return from Stripe: show a status banner --- */
  const status = new URLSearchParams(location.search).get("status");
  if (status) {
    const msg = $("[data-place-msg]");
    if (msg) {
      if (status === "success") {
        msg.textContent = "Payment received — thank you! We'll email your order confirmation shortly.";
        msg.dataset.state = "ok";
      } else if (status === "cancelled") {
        msg.textContent = "Payment cancelled — your build is still here whenever you're ready.";
        msg.dataset.state = "err";
      }
    }
  }

  syncInvoice();
  render();
}
