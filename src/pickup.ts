import "./style.css";
import { initSite } from "./site";
import { track } from "./analytics";
import coverage from "./pickup-coverage.json";

/* ------------------------------------------------------------------
   Pickup network page — a "coming soon" coverage map of Switzerland
   with a town search that finds the nearest planned pickup point.
   Data is Prisma's PLANNED (anonymous) network; no shop is named until
   it is a confirmed partner. See pickup.html for the copy framing.
   ------------------------------------------------------------------ */

type Pt = [number, number];
type Town = [string, number, number, number]; // name, lon, lat, population
interface Coverage {
  outline: Pt[];
  points: Pt[];
  towns: Town[];
  planned: number;
  target_coverage: number;
}

/* Shared site chrome (nav reveal-on-scroll, scroll progress). Null-safe. */
initSite();

const D = coverage as unknown as Coverage;
const canvas = document.querySelector<HTMLCanvasElement>("#pk-map");

if (canvas) {
  const pts = D.points;
  const towns = D.towns;
  const outline = D.outline;
  const ctx = canvas.getContext("2d")!;

  // Town autocomplete — cap options to the most populous for a light list.
  const dl = document.querySelector<HTMLDataListElement>("#pk-townlist");
  if (dl) {
    const frag = document.createDocumentFragment();
    for (const t of towns.slice(0, 900)) {
      const o = document.createElement("option");
      o.value = t[0];
      frag.appendChild(o);
    }
    dl.appendChild(frag);
  }
  const townByName = new Map<string, Town>();
  for (const t of towns) townByName.set(t[0].toLowerCase(), t);

  // Equirectangular projection fitted to the outline's bounds.
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of outline) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  const lat0 = (y0 + y1) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const px0 = x0 * kx, px1 = x1 * kx, py0 = -y1, py1 = -y0;

  let W = 0, H = 0, dpr = 1, sc = 1, ox = 0, oy = 0, pxPerKm = 1;
  let you: Pt | null = null;

  const X = (lon: number) => ox + (lon * kx - px0) * sc;
  const Y = (lat: number) => oy + (-lat - py0) * sc;
  const css = (v: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function hav(la1: number, lo1: number, la2: number, lo2: number): number {
    const R = 6371;
    const dLa = ((la2 - la1) * Math.PI) / 180;
    const dLo = ((lo2 - lo1) * Math.PI) / 180;
    const a =
      Math.sin(dLa / 2) ** 2 +
      Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function layout(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas!.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    const pad = 20;
    const sx = (W - 2 * pad) / (px1 - px0);
    const sy = (H - 2 * pad) / (py1 - py0);
    sc = Math.min(sx, sy);
    ox = pad + ((W - 2 * pad) - (px1 - px0) * sc) / 2;
    oy = pad + ((H - 2 * pad) - (py1 - py0) * sc) / 2;
    pxPerKm = sc / 111.32;
  }

  function render(): void {
    const c = ctx;
    c.save();
    c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);
    const land = css("--pk-land"), landStroke = css("--pk-land-stroke");
    const acc = css("--c-blue"), disc = css("--pk-disc"), youCol = css("--c-orange"), paper = "#ffffff";

    c.beginPath();
    c.moveTo(X(outline[0][0]), Y(outline[0][1]));
    for (let i = 1; i < outline.length; i++) c.lineTo(X(outline[i][0]), Y(outline[i][1]));
    c.closePath();
    c.fillStyle = land; c.fill();
    c.lineJoin = "round"; c.strokeStyle = landStroke; c.lineWidth = 1.1; c.stroke();

    c.save(); c.clip();
    const rr = 10 * pxPerKm;
    c.fillStyle = disc;
    for (const p of pts) { c.beginPath(); c.arc(X(p[0]), Y(p[1]), rr, 0, 7); c.fill(); }
    c.restore();

    c.save(); c.clip();
    for (const p of pts) {
      c.beginPath(); c.arc(X(p[0]), Y(p[1]), 2.6, 0, 7);
      c.fillStyle = acc; c.fill();
      c.lineWidth = 1; c.strokeStyle = paper; c.stroke();
    }
    if (you) {
      let best: Pt | null = null, bd = 1e9;
      for (const p of pts) { const d = hav(you[1], you[0], p[1], p[0]); if (d < bd) { bd = d; best = p; } }
      if (best) {
        c.strokeStyle = youCol; c.lineWidth = 1.6; c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(X(you[0]), Y(you[1])); c.lineTo(X(best[0]), Y(best[1])); c.stroke();
        c.setLineDash([]);
      }
      c.beginPath(); c.arc(X(you[0]), Y(you[1]), 6, 0, 7);
      c.fillStyle = youCol; c.fill();
      c.lineWidth = 2; c.strokeStyle = paper; c.stroke();
    }
    c.restore();
    c.restore();
  }

  function search(): void {
    const inp = document.querySelector<HTMLInputElement>("#pk-town");
    const res = document.querySelector<HTMLElement>("#pk-result");
    if (!inp || !res) return;
    const q = inp.value.trim().toLowerCase();
    let t = townByName.get(q);
    if (!t && q) {
      for (const [nm, town] of townByName) { if (nm.startsWith(q)) { t = town; break; } }
    }
    if (!t) {
      track("pickup_town_search", { town: q, found: false });
      res.classList.remove("on"); you = null; render(); return;
    }
    you = [t[1], t[2]];
    let best = 1e9;
    for (const p of pts) { const d = hav(t[2], t[1], p[1], p[0]); if (d < best) best = d; }
    const mins = Math.max(3, Math.round((best / 45) * 60)); // ~45 km/h mixed roads
    const km = document.querySelector<HTMLElement>("#pk-rkm");
    const title = document.querySelector<HTMLElement>("#pk-rtitle");
    const sub = document.querySelector<HTMLElement>("#pk-rsub");
    if (km) km.textContent = "~" + best.toFixed(0) + " km";
    if (title) title.textContent = "Nearest planned pickup from " + t[0];
    if (sub) sub.textContent = "about a " + mins + "-minute drive";
    res.classList.add("on");
    // How far the nearest planned point actually is — the number that decides
    // where the network needs to grow next.
    track("pickup_town_search", {
      town: t[0], found: true, nearest_km: Math.round(best), drive_min: mins,
    });
    render();
  }

  document.querySelector("#pk-find")?.addEventListener("click", search);
  const townInput = document.querySelector<HTMLInputElement>("#pk-town");
  townInput?.addEventListener("change", search);
  townInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

  const notifyForm = document.querySelector<HTMLFormElement>("#pk-notify");
  notifyForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.querySelector<HTMLInputElement>("#pk-email")?.value.trim();
    if (!email) return;
    track("pickup_notify_click", {});
    // No mailing backend yet — hand off to the visitor's mail client.
    const body = encodeURIComponent("Please tell me when a pickup point opens near me. " + email);
    window.location.href =
      "mailto:info@prismacycling.ch?subject=Notify%20me%20-%20Prisma%20pickup%20network&body=" + body;
  });

  new ResizeObserver(() => { layout(); render(); }).observe(canvas);
  layout();
  render();
}
