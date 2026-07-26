/* ----------------------------------------------------------------
   Shared product catalog — single source of truth.

   These values MIRROR the hardcoded markup in index.html (Aero) and
   gravel.html (Terra). The live pages still read their own DOM, so this
   module changes nothing there; it exists so the new Beta page, the paint
   engine, and the Gemini assistant all reason over the same structured data.

   `scripts/catalog-check.mjs` asserts this file stays in sync with the HTML.
   If you change a price / colour / size here, change it in the HTML too
   (or the parity check fails the build).
   ---------------------------------------------------------------- */

export type Finish = "matte" | "metallic" | "pearl";
export type ProductId = "aero" | "terra";

/** A frame colourway. `preview` is the curated pre-rendered side photo used
 *  by the fallback image-swap; `hex` seeds the swatch chip and paint engine. */
export interface ColourSpec {
  name: string;
  hex: string;
  finish?: Finish;
  /** Curated side-profile render for the image-swap fallback. */
  preview?: string;
}

/** One selectable, priced component (drivetrain or pedal). */
export interface ComponentSpec {
  name: string;
  /** CHF, matching the `data-price` attribute in the HTML. */
  price: number;
  /** Short spec line shown under the name. */
  meta: string;
}

/** A frame size with its fit window and full geometry (mm, ° where marked). */
export interface SizeSpec {
  /** e.g. "Size 51" — matches the radio `value`. */
  label: string;
  /** Rider height window [min, max] in cm. */
  heightCm: [number, number];
  /** Inseam window [min, max] in cm. */
  inseamCm: [number, number];
  wheel: string;
  /** Geometry table row for this size. Numbers in mm, angles in degrees. */
  geometry: {
    seatTube: number;
    topTube: number;
    seatAngle: number;
    headAngle: number;
    headTube: number;
    reach: number;
    stack: number;
    chainstay: number;
    frontCentre: number;
    wheelbase: number;
    bbDrop: number;
    /** Fork rake (aero) / fork offset (terra). */
    forkOffset: number;
    forkLength: number;
  };
}

export interface Fees {
  /** CHF handling to the German warehouse (baked into shown prices). */
  warehouse: number;
  /** CHF flat-rate Swiss delivery (baked into shown prices). */
  delivery: number;
}

export interface Product {
  id: ProductId;
  name: string;
  category: string;
  sizes: SizeSpec[];
  colours: ColourSpec[];
  drivetrains: ComponentSpec[];
  pedals: ComponentSpec[];
  fees: Fees;
  /** Copy from the size-guide modal — the between-sizes fit rule. */
  betweenSizesRule: string;
  defaults: {
    size: string;
    colour: string;
    drivetrain: string;
    pedals?: string;
  };
}

/* ------------------------------ Aero ------------------------------ */
const AERO: Product = {
  id: "aero",
  name: "Prisma One",
  category: "Aero road bike — racing",
  sizes: [
    {
      label: "Size 48",
      heightCm: [166, 172],
      inseamCm: [74, 79],
      wheel: "700c",
      geometry: { seatTube: 473, topTube: 533, seatAngle: 73.5, headAngle: 71.5, headTube: 106, reach: 378, stack: 521, chainstay: 410, frontCentre: 577, wheelbase: 976, bbDrop: 72, forkOffset: 42, forkLength: 380 },
    },
    {
      label: "Size 51",
      heightCm: [172, 178],
      inseamCm: [78, 83],
      wheel: "700c",
      geometry: { seatTube: 503, topTube: 549, seatAngle: 73.5, headAngle: 72.75, headTube: 123, reach: 390, stack: 539, chainstay: 410, frontCentre: 584, wheelbase: 983, bbDrop: 70, forkOffset: 42, forkLength: 380 },
    },
    {
      label: "Size 54",
      heightCm: [178, 187],
      inseamCm: [82, 88],
      wheel: "700c",
      geometry: { seatTube: 533, topTube: 559, seatAngle: 73.5, headAngle: 73.25, headTube: 144, reach: 393, stack: 560, chainstay: 410, frontCentre: 589, wheelbase: 988, bbDrop: 70, forkOffset: 42, forkLength: 380 },
    },
  ],
  colours: [
    { name: "Moon Silver", hex: "#a3b0bb", finish: "metallic", preview: "/img/prisma-aero-moon-silver-side.webp" },
    { name: "Prisma Silver", hex: "#c9ccc7", finish: "pearl", preview: "/img/prisma-aero-chameleon-silver-side.webp" },
    { name: "Bordeaux Red", hex: "#623c62", finish: "metallic", preview: "/img/prisma-aero-bordeaux-red-side.webp" },
    { name: "Sapphire Blue", hex: "#0351a3", finish: "metallic", preview: "/img/prisma-aero-sapphire-blue-side.webp" },
    { name: "Olive Green", hex: "#596553", finish: "matte", preview: "/img/prisma-aero-olive-green-side.webp" },
  ],
  drivetrains: [
    { name: "Wheeltop EDS-TX", price: 1414, meta: "24-speed · mechanical" },
    { name: "Shimano 105", price: 1435, meta: "24-speed · mechanical" },
    { name: "Shimano 105 Di2", price: 1865, meta: "24-speed · electronic" },
    { name: "Shimano Ultegra Di2", price: 2187, meta: "24-speed · electronic" },
    { name: "Shimano Dura-Ace Di2", price: 2890, meta: "24-speed · electronic" },
  ],
  pedals: [
    { name: "No pedals", price: 0, meta: "Bring your own" },
    { name: "Shimano PD RS 500", price: 53, meta: "SPD-SL · road clipless" },
    { name: "Shimano Ultegra PD R8000", price: 103, meta: "SPD-SL · carbon body" },
  ],
  fees: { warehouse: 400, delivery: 59 },
  betweenSizesRule:
    "On an aero build, riders between two sizes usually size down for a sharper, more aerodynamic position.",
  defaults: { size: "Size 51", colour: "Moon Silver", drivetrain: "Wheeltop EDS-TX", pedals: "No pedals" },
};

/* ------------------------------ Terra ----------------------------- */
const TERRA: Product = {
  id: "terra",
  name: "Prisma Terra",
  category: "All-road gravel bike",
  sizes: [
    { label: "Size 50", heightCm: [165, 172], inseamCm: [73, 79], wheel: "700c", geometry: { seatTube: 435, topTube: 521.5, seatAngle: 75.3, headAngle: 69, headTube: 115, reach: 383, stack: 528.5, chainstay: 440, frontCentre: 611, wheelbase: 1041.5, bbDrop: 70, forkOffset: 45, forkLength: 395 } },
    { label: "Size 53", heightCm: [170, 178], inseamCm: [77, 83], wheel: "700c", geometry: { seatTube: 465, topTube: 537, seatAngle: 74.5, headAngle: 70, headTube: 135, reach: 384, stack: 551.2, chainstay: 440, frontCentre: 611, wheelbase: 1041.5, bbDrop: 70, forkOffset: 45, forkLength: 395 } },
    { label: "Size 56", heightCm: [176, 184], inseamCm: [81, 87], wheel: "700c", geometry: { seatTube: 495, topTube: 561, seatAngle: 73.5, headAngle: 71.5, headTube: 155, reach: 390.5, stack: 575.8, chainstay: 440, frontCentre: 611, wheelbase: 1041.5, bbDrop: 70, forkOffset: 45, forkLength: 395 } },
    { label: "Size 58", heightCm: [182, 190], inseamCm: [85, 91], wheel: "700c", geometry: { seatTube: 515, topTube: 575.5, seatAngle: 73, headAngle: 72, headTube: 175, reach: 393.2, stack: 596.7, chainstay: 440, frontCentre: 615.5, wheelbase: 1046, bbDrop: 70, forkOffset: 45, forkLength: 395 } },
    { label: "Size 61", heightCm: [188, 196], inseamCm: [89, 95], wheel: "700c", geometry: { seatTube: 545, topTube: 592.5, seatAngle: 73, headAngle: 72.5, headTube: 195, reach: 403.7, stack: 617.7, chainstay: 440, frontCentre: 627.5, wheelbase: 1058, bbDrop: 70, forkOffset: 45, forkLength: 395 } },
  ],
  colours: [
    { name: "Raw Silver", hex: "#cfd2d6" },
    { name: "Phantom Black", hex: "#2b2d31" },
  ],
  drivetrains: [
    { name: "Shimano GRX600", price: 1589, meta: "1×11 · hydraulic" },
    { name: "Wheeltop GEX", price: 1240, meta: "1×13 · wireless & hydraulic" },
  ],
  pedals: [],
  fees: { warehouse: 400, delivery: 59 },
  betweenSizesRule:
    "Gravel geometry runs a touch more upright, so if you're between two sizes, the smaller frame gives a more comfortable, controllable ride.",
  defaults: { size: "Size 50", colour: "Raw Silver", drivetrain: "Shimano GRX600" },
};

export const PRODUCTS: Record<ProductId, Product> = { aero: AERO, terra: TERRA };

/* ----------------------- Rider-facing enums ----------------------- */
/** Self-reported experience — steers component tier and fit aggressiveness. */
export const RIDER_LEVELS = ["beginner", "intermediate", "advanced", "racer"] as const;
export type RiderLevel = (typeof RIDER_LEVELS)[number];

/** Intended use — steers reach/stack preference and drivetrain. */
export const RIDING_STYLES = ["endurance", "all-round", "aggressive", "racing"] as const;
export type RidingStyle = (typeof RIDING_STYLES)[number];

/* --------------------------- Pure helpers -------------------------- */

/** Sum the prices of the named component choices for a product. */
export function buildTotal(
  product: Product,
  choice: { drivetrain?: string; pedals?: string }
): number {
  const find = (list: ComponentSpec[], name?: string) =>
    list.find((c) => c.name === name)?.price ?? 0;
  return find(product.drivetrains, choice.drivetrain) + find(product.pedals, choice.pedals);
}

/** Recommend a size purely from rider height (assistant refines with inseam/style). */
export function sizeForHeight(product: Product, heightCm: number): SizeSpec {
  const inRange = product.sizes.find(
    (s) => heightCm >= s.heightCm[0] && heightCm <= s.heightCm[1]
  );
  if (inRange) return inRange;
  // Below the smallest / above the largest — clamp to the nearest end.
  const first = product.sizes[0];
  if (heightCm < first.heightCm[0]) return first;
  return product.sizes[product.sizes.length - 1];
}

/** sRGB distance from a hex to each catalog colour; returns the closest. */
export function nearestColour(product: Product, hex: string): ColourSpec {
  const target = hexToRgb(hex);
  let best = product.colours[0];
  let bestDist = Infinity;
  for (const c of product.colours) {
    const rgb = hexToRgb(c.hex);
    const d =
      (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** "#rrggbb" | "#rgb" → [r, g, b] (0–255). Invalid input → black. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
