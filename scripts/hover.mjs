import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const idx = Number(process.argv[2] ?? 3);
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args:["--hide-scrollbars","--force-device-scale-factor=1"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await p.goto("http://localhost:4318/", { waitUntil: "networkidle0" });
await p.evaluate(async () => {
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  for(let y=0;y<=document.body.scrollHeight;y+=400){window.scrollTo(0,y);await sleep(80);}
  document.querySelector("#anatomy").scrollIntoView({block:"center"});
  await sleep(400);
});
const calls = await p.$$(".anatomy__call");
const box = await calls[idx].boundingBox();
if(box) await p.mouse.move(box.x+box.width/2, box.y+box.height/2);
await new Promise(r=>setTimeout(r,600));
await p.screenshot({ path: "/tmp/shots/anatomy-hover.png" });
console.log("hover shot done; callout", idx, "box", box);
await b.close();
