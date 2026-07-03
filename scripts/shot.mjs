// Dev-only visual QA: drive system Chrome to screenshot the built site.
// Scrolls top→bottom first so IntersectionObserver reveals fire, then captures.
//   node scripts/shot.mjs <url> <label> <width> <height> [reduceMotion]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , url = "http://localhost:4318/", label = "page", w = "1440", h = "900", reduce = ""] =
  process.argv;
const width = Number(w);
const height = Number(h);
const outDir = "/tmp/shots";
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
if (reduce === "reduce") {
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
}
await page.setViewport({ width, height, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0" });
try {
  await page.evaluateHandle("document.fonts.ready");
} catch {}

// Walk the page so every reveal observer fires, then settle back at the top.
// Force instant scrolling — the site's smooth-scroll would make scrollTo undershoot.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  const step = Math.round(window.innerHeight * 0.6);
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await sleep(160);
  }
  window.scrollTo(0, document.body.scrollHeight);
  await sleep(200);
  window.scrollTo(0, 0);
  html.style.scrollBehavior = prev;
  await sleep(400);
});

await page.screenshot({ path: `${outDir}/${label}-full.png`, fullPage: true });
await page.screenshot({ path: `${outDir}/${label}-fold.png`, fullPage: false });
console.log(`✓ ${label} (${width}x${height})`);
await browser.close();
