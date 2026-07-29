/* ----------------------------------------------------------------
   Paint engine — 2D canvas compositor for independent frame / wheel recolour.

   Per region:  draw fill → clip to mask → multiply by AO → re-clip →
                screen the specular pass (opacity scaled by finish).
   Compose:     base → wheels → frame → overlay, at devicePixelRatio.

   Each source pass is decoded once into an ImageBitmap; each composited region
   is cached in an OffscreenCanvas keyed by region|finish|fill, so changing the
   frame colour recomputes only the frame. If the browser can't support the
   pipeline (no 2D context, no createImageBitmap, or an asset fails to decode),
   isSupported() reports false and the caller falls back to the image swap.
   ---------------------------------------------------------------- */
import type { Fill, PaintLayerSet, PaintRegion, PaintState, PaintableProduct } from "./types";

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Each uploaded/preset pattern bitmap gets a stable unique id so the region
// cache keys distinct images apart. Without this, two different pattern uploads
// hash to the same key ("p:cover") and the second upload returns the first's
// cached render — the old image "sticks" after Clear pattern + re-upload.
let patternSeq = 0;
const patternIds = new WeakMap<ImageBitmap, number>();
function patternId(bmp: ImageBitmap): number {
  let id = patternIds.get(bmp);
  if (id === undefined) {
    id = ++patternSeq;
    patternIds.set(bmp, id);
  }
  return id;
}

function hashFill(fill: Fill): string {
  return fill.kind === "solid"
    ? "s:" + fill.hex.toLowerCase()
    : "p:" + fill.mode + ":" + patternId(fill.bitmap);
}

/** Draw a bitmap to cover (fill, cropping) or tile a w×h box. */
function drawFitted(ctx: Ctx, bmp: ImageBitmap, w: number, h: number, mode: "cover" | "tile") {
  if (mode === "tile") {
    const pat = ctx.createPattern(bmp as unknown as CanvasImageSource, "repeat");
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      return;
    }
  }
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp as unknown as CanvasImageSource, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export class PaintEngine {
  private view: HTMLCanvasElement;
  private product: PaintableProduct;
  private layers: PaintLayerSet;
  private assets = new Map<string, ImageBitmap>();
  private regionCache = new Map<string, AnyCanvas>();
  private ready = false;
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement, product: PaintableProduct, angle = product.defaultAngle) {
    this.view = canvas;
    this.product = product;
    const set = product.angles[angle];
    if (!set) throw new Error(`No paint layers for angle "${angle}"`);
    this.layers = set;
  }

  /** Feature-detect before attempting to load — cheap, synchronous. */
  static get capable(): boolean {
    return (
      typeof document !== "undefined" &&
      typeof createImageBitmap === "function" &&
      !!document.createElement("canvas").getContext("2d")
    );
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Decode every pass. Resolves false if any asset fails (→ use fallback). */
  async load(): Promise<boolean> {
    if (!PaintEngine.capable) return false;
    const paths = new Set<string>([this.layers.base]);
    if (this.layers.overlay) paths.add(this.layers.overlay);
    for (const r of Object.values(this.layers.regions)) {
      if (!r) continue;
      paths.add(r.shade);
      paths.add(r.spec);
      if (r.mask) paths.add(r.mask);
    }
    try {
      await Promise.all(
        [...paths].map(async (p) => {
          const res = await fetch(p);
          if (!res.ok) throw new Error(`${p} → ${res.status}`);
          this.assets.set(p, await createImageBitmap(await res.blob()));
        })
      );
      this.ready = true;
      return true;
    } catch (err) {
      console.warn("[paint] asset load failed, falling back:", err);
      this.ready = false;
      return false;
    }
  }

  /** Size the visible canvas to its CSS box × devicePixelRatio. */
  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.view.getBoundingClientRect();
    const cssW = rect.width || this.layers.width;
    // Preserve the asset's aspect ratio.
    const cssH = cssW * (this.layers.height / this.layers.width);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.view.width = w;
    this.view.height = h;
    this.view.style.height = cssH + "px";
    this.regionCache.clear(); // size changed → cached regions are stale
  }

  /** Build (or fetch cached) the composited layer for one region. */
  private renderRegion(region: PaintRegion, fill: Fill, finish: PaintState["finish"]): AnyCanvas {
    const key = `${region.id}|${finish}|${hashFill(fill)}|${this.w}x${this.h}`;
    const cached = this.regionCache.get(key);
    if (cached) return cached;

    const w = this.w;
    const h = this.h;
    const c = makeCanvas(w, h);
    const g = c.getContext("2d") as Ctx;
    const shade = this.assets.get(region.shade)!;
    const spec = this.assets.get(region.spec)!;
    const mask = this.assets.get(region.mask ?? region.shade)!;
    const S = shade as unknown as CanvasImageSource;
    const SP = spec as unknown as CanvasImageSource;
    const M = mask as unknown as CanvasImageSource;

    // 1. lay down the paint (solid colour or pattern)
    if (fill.kind === "solid") {
      g.fillStyle = fill.hex;
      g.fillRect(0, 0, w, h);
    } else {
      drawFitted(g, fill.bitmap, w, h, fill.mode);
    }
    // 2. clip the paint to the region mask
    g.globalCompositeOperation = "destination-in";
    g.drawImage(M, 0, 0, w, h);
    // 3. multiply by AO/luminance → colour now carries the 3D form
    g.globalCompositeOperation = "multiply";
    g.drawImage(S, 0, 0, w, h);
    // multiply can leave a fringe where AO alpha < 1 → re-clip to the mask
    g.globalCompositeOperation = "destination-in";
    g.drawImage(M, 0, 0, w, h);
    // 4. screen the specular pass back on top, scaled by finish
    g.globalCompositeOperation = "screen";
    g.globalAlpha = this.product.finishSpec[finish];
    g.drawImage(SP, 0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    this.regionCache.set(key, c);
    return c;
  }

  /** Composite the whole bike into the visible canvas. */
  compose(state: PaintState) {
    if (!this.ready) return;
    this.resize();
    const g = this.view.getContext("2d")!;
    const w = this.w;
    const h = this.h;
    g.clearRect(0, 0, w, h);
    const base = this.assets.get(this.layers.base);
    if (base) g.drawImage(base as unknown as CanvasImageSource, 0, 0, w, h);
    const wheels = this.layers.regions.wheels;
    if (wheels) g.drawImage(this.renderRegion(wheels, state.wheels, state.finish) as CanvasImageSource, 0, 0, w, h);
    const frame = this.layers.regions.frame;
    if (frame) g.drawImage(this.renderRegion(frame, state.frame, state.finish) as CanvasImageSource, 0, 0, w, h);
    const overlay = this.layers.overlay ? this.assets.get(this.layers.overlay) : undefined;
    if (overlay) g.drawImage(overlay as unknown as CanvasImageSource, 0, 0, w, h);
  }

  /** Decode an uploaded/preset image for use as a pattern fill. */
  static async toPattern(src: Blob | string): Promise<ImageBitmap> {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    return createImageBitmap(blob);
  }
}
