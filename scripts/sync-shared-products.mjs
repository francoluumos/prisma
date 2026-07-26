// Copy the shared catalog into the Supabase function tree.
//
//   node scripts/sync-shared-products.mjs
//
// `supabase functions deploy` only bundles files under supabase/functions/, so
// the Edge Function can't import ../../src/data/products.ts directly. We keep a
// generated copy at supabase/functions/_shared/products.ts and regenerate it
// here. scripts/catalog-check.mjs guarantees products.ts matches the HTML;
// this guarantees the function copy matches products.ts. Run both in the
// build/verify step. Do not edit the generated file by hand.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = resolve(root, "src/data/products.ts");
const outPath = resolve(root, "supabase/functions/_shared/products.ts");

const banner =
  "/* GENERATED — do not edit. Source: src/data/products.ts\n" +
  "   Regenerate with: node scripts/sync-shared-products.mjs */\n\n";

const src = await readFile(srcPath, "utf8");
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, banner + src, "utf8");
console.log("Synced src/data/products.ts → supabase/functions/_shared/products.ts");
