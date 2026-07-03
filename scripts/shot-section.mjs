// node scripts/shot-section.mjs <url> <selector> <label> [width] [height]
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , url, selector, label, w = "1440", h = "900"] = process.argv;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0" });
try { await page.evaluateHandle("document.fonts.ready"); } catch {}
await page.evaluate(async (sel) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.documentElement.style.scrollBehavior = "auto";
  const step = Math.round(window.innerHeight * 0.6);
  for (let y = 0; y <= document.body.scrollHeight; y += step) { window.scrollTo(0, y); await sleep(140); }
  const el = document.querySelector(sel);
  el?.scrollIntoView({ block: "center" });
  await sleep(450);
}, selector);
await page.screenshot({ path: `/tmp/shots/${label}.png`, fullPage: false });
console.log(`✓ ${label}`);
await browser.close();
