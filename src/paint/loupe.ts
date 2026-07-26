/* ----------------------------------------------------------------
   Loupe — a magnifier that follows the cursor over the studio preview.

   Samples whichever source is live (the painted canvas, or the fallback image)
   so the zoom reflects the current colours in real time. Hover-capable pointers
   only (no touch), and purely decorative (aria-hidden), so it's a progressive
   enhancement over the existing preview.
   ---------------------------------------------------------------- */
const SIZE = 176; // loupe diameter in CSS px
const ZOOM = 2.5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function initLoupe(): void {
  const fig = document.querySelector<HTMLElement>(".configure__preview");
  if (!fig) return;
  // Desktop hover only — a loupe makes no sense under a fingertip.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const canvas = fig.querySelector<HTMLCanvasElement>("[data-paint-canvas]");
  const img = fig.querySelector<HTMLImageElement>("[data-colour-preview]");
  if (!canvas && !img) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const loupe = document.createElement("div");
  loupe.className = "loupe";
  loupe.setAttribute("aria-hidden", "true");
  const lc = document.createElement("canvas");
  lc.className = "loupe__canvas";
  lc.width = SIZE * dpr;
  lc.height = SIZE * dpr;
  loupe.appendChild(lc);
  fig.appendChild(loupe);
  const ctx = lc.getContext("2d");
  if (!ctx) return;

  const activeSource = (): HTMLCanvasElement | HTMLImageElement | null => {
    if (canvas && !canvas.hidden && canvas.width > 0) return canvas;
    if (img && img.style.display !== "none" && img.complete && img.naturalWidth > 0) return img;
    return null;
  };

  let raf = 0;
  let lastX = 0;
  let lastY = 0;

  const draw = () => {
    raf = 0;
    const src = activeSource();
    if (!src) return;
    const rect = src.getBoundingClientRect();
    const x = lastX - rect.left;
    const y = lastY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      loupe.classList.remove("is-visible");
      return;
    }
    const sw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
    const sh = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
    const scaleX = sw / rect.width;
    const scaleY = sh / rect.height;
    const region = SIZE / ZOOM; // displayed px shown through the lens
    const rw = region * scaleX;
    const rh = region * scaleY;
    const sx = clamp(x * scaleX - rw / 2, 0, Math.max(0, sw - rw));
    const sy = clamp(y * scaleY - rh / 2, 0, Math.max(0, sh - rh));

    ctx.clearRect(0, 0, lc.width, lc.height);
    ctx.fillStyle = "#f4f4f5"; // matches the preview panel behind transparent art
    ctx.fillRect(0, 0, lc.width, lc.height);
    ctx.drawImage(src, sx, sy, rw, rh, 0, 0, lc.width, lc.height);

    const figRect = fig.getBoundingClientRect();
    loupe.style.left = lastX - figRect.left + "px";
    loupe.style.top = lastY - figRect.top + "px";
    loupe.classList.add("is-visible");
  };

  fig.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(draw);
  });
  fig.addEventListener("pointerleave", () => loupe.classList.remove("is-visible"));
}
