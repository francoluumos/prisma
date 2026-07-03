// Smoke check: load the page, report console errors + page errors, and test the form.
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.argv[2] || "http://localhost:4318/";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 600));

// invalid email
await page.type("#email", "not-an-email");
await page.click("[data-submit]");
await new Promise((r) => setTimeout(r, 200));
const invalidMsg = await page.$eval("[data-msg]", (el) => el.textContent);
const invalidState = await page.$eval(".field", (el) => el.className);

// valid email
await page.$eval("#email", (el) => (el.value = ""));
await page.type("#email", "franco@studio.com");
await page.click("[data-submit]");
await new Promise((r) => setTimeout(r, 1400));
const successMsg = await page.$eval("[data-msg]", (el) => el.textContent);
const successState = await page.$eval(".field", (el) => el.className);

console.log("console/page errors:", errors.length ? errors : "none");
console.log("invalid:", JSON.stringify(invalidMsg), "|", invalidState);
console.log("success:", JSON.stringify(successMsg), "|", successState);
await browser.close();
