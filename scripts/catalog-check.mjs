// Parity guard: assert src/data/products.ts stays in sync with the catalog
// values hardcoded in index.html (Aero) and gravel.html (Terra).
//
//   node scripts/catalog-check.mjs
//
// Exits non-zero and prints a diff if anything drifted. No browser needed —
// it transpiles products.ts with the local typescript devDep and regex-parses
// the HTML. Run it in the build/verify step so the shared module can't silently
// disagree with the live pages.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Load PRODUCTS from the TS module by stripping types and importing it. */
async function loadProducts() {
  const src = await readFile(resolve(root, "src/data/products.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = await import("data:text/javascript," + encodeURIComponent(js));
  return mod.PRODUCTS;
}

const norm = (s) => s.replace(/–|—/g, "-").replace(/\s+/g, " ").trim();

/** Extract the catalog from one HTML page. */
function parseHtml(html) {
  const colours = [];
  const colourRe =
    /<input[^>]*name="colour"[^>]*value="([^"]+)"([^>]*)\/>\s*<span class="swatch__chip[^"]*"[^>]*--swatch:\s*(#[0-9a-fA-F]{3,6})/g;
  for (let m; (m = colourRe.exec(html)); ) {
    const [, name, attrs, hex] = m;
    const preview = /data-preview="([^"]+)"/.exec(attrs)?.[1];
    const finish = /data-finish="([^"]+)"/.exec(attrs)?.[1]?.toLowerCase();
    colours.push({ name, hex: hex.toLowerCase(), finish, preview });
  }

  const comps = (kind) => {
    const out = [];
    const re = new RegExp(
      `<input[^>]*name="${kind}"[^>]*value="([^"]+)"[^>]*data-price="(\\d+)"`,
      "g"
    );
    for (let m; (m = re.exec(html)); ) out.push({ name: m[1], price: Number(m[2]) });
    return out;
  };

  const sizes = [];
  const sizeRe =
    /<tr><td>(Size \d+)<\/td><td>([\d–—-]+)\s*cm<\/td><td>([\d–—-]+)\s*cm<\/td><td>([^<]+)<\/td><\/tr>/g;
  for (let m; (m = sizeRe.exec(html)); ) {
    const [, label, h, i, wheel] = m;
    const range = (r) => norm(r).split("-").map(Number);
    sizes.push({ label, heightCm: range(h), inseamCm: range(i), wheel: norm(wheel) });
  }

  return { colours, drivetrains: comps("drivetrain"), pedals: comps("pedals"), sizes };
}

const errors = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(label, fromHtml, fromData) {
  if (!eq(fromHtml, fromData)) {
    errors.push(
      `MISMATCH · ${label}\n  html:  ${JSON.stringify(fromHtml)}\n  data:  ${JSON.stringify(fromData)}`
    );
  }
}

function compare(productLabel, html, product) {
  // Colours
  check(
    `${productLabel} colours`,
    html.colours,
    product.colours.map((c) => ({
      name: c.name,
      hex: c.hex.toLowerCase(),
      finish: c.finish,
      preview: c.preview,
    }))
  );
  // Drivetrains & pedals (name + price)
  check(
    `${productLabel} drivetrains`,
    html.drivetrains,
    product.drivetrains.map((d) => ({ name: d.name, price: d.price }))
  );
  check(
    `${productLabel} pedals`,
    html.pedals,
    product.pedals.map((p) => ({ name: p.name, price: p.price }))
  );
  // Sizes (label + fit windows). Geometry lives in a separate table; we check
  // the fit windows the size guide exposes, which is what the assistant uses.
  check(
    `${productLabel} sizes`,
    html.sizes,
    product.sizes.map((s) => ({
      label: s.label,
      heightCm: s.heightCm,
      inseamCm: s.inseamCm,
      wheel: s.wheel,
    }))
  );
}

const PRODUCTS = await loadProducts();
const [indexHtml, gravelHtml] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "gravel.html"), "utf8"),
]);

compare("aero", parseHtml(indexHtml), PRODUCTS.aero);
compare("terra", parseHtml(gravelHtml), PRODUCTS.terra);

if (errors.length) {
  console.error("Catalog parity FAILED:\n\n" + errors.join("\n\n"));
  process.exit(1);
}
console.log("Catalog parity OK — products.ts matches index.html & gravel.html.");
