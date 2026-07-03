import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = Number(process.argv[2] ?? 390);
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: W, height: 844, deviceScaleFactor: 1 });
await p.goto("http://localhost:4318/", { waitUntil: "networkidle0" });
const res = await p.evaluate((W) => {
  const reel = document.querySelector("[data-reel]");
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    if (reel && reel.contains(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className?.toString?.()||"").slice(0,38), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
    }
  });
  out.sort((a,b)=>(b.right-b.left)-(a.right-a.left));
  return { scrollW: document.documentElement.scrollWidth, n: out.length, offenders: out.slice(0,12) };
}, W);
console.log(`viewport ${W}  scrollWidth ${res.scrollW}  offenders ${res.n}`);
res.offenders.forEach(o => console.log(`  ${o.tag}.${o.cls}  left=${o.left} right=${o.right} w=${o.w}`));
await b.close();
