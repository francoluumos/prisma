import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await p.goto("http://localhost:4318/", { waitUntil: "networkidle0" });
const r = await p.evaluate(() => {
  const sel = ["body","#main","#geometry","[data-reel]",".geometry .shell"];
  const info = {};
  for (const s of sel) {
    const el = document.querySelector(s);
    if (!el) { info[s] = "missing"; continue; }
    const cs = getComputedStyle(el);
    info[s] = { offsetW: el.offsetWidth, scrollW: el.scrollWidth, clientW: el.clientWidth, ovx: cs.overflowX, padL: cs.paddingLeft, padR: cs.paddingRight };
  }
  return info;
});
console.log(JSON.stringify(r, null, 2));
await b.close();
