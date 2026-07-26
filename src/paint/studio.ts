/* ----------------------------------------------------------------
   Colour studio — wire the Beta studio controls to the PaintEngine.

   Progressive enhancement: if the browser can't run the engine or the paint
   assets fail to load, the studio fieldset stays hidden and the page keeps the
   existing curated image-swap (the 5 catalog swatches) — no dead end.
   ---------------------------------------------------------------- */
import { PRODUCTS } from "../data/products";
import { PaintEngine } from "./engine";
import { AERO_PAINT } from "./products.paint";
import type { Fill, PaintState } from "./types";

/** Quick-pick colours (brand spectrum + neutrals) for arbitrary recolour. */
const FRAME_PRESETS = [
  ["Silver", "#a3b0bb"], ["Graphite", "#1b1b1b"], ["Chalk", "#e9ecef"],
  ["Red", "#e8402f"], ["Amber", "#f08a2a"], ["Green", "#46b96a"],
  ["Cyan", "#34a7c8"], ["Blue", "#3f5fd0"], ["Violet", "#8a47c9"],
] as const;
const WHEEL_PRESETS = [
  ["Black", "#1b1b1b"], ["Silver", "#b8c0c8"], ["Chalk", "#e9ecef"],
  ["Red", "#b3122e"], ["Blue", "#1c3f8f"],
] as const;

const norm = (hex: string) => hex.toUpperCase();

export async function initStudio(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-paint-canvas]");
  const studio = document.querySelector<HTMLFieldSetElement>("[data-studio]");
  const img = document.querySelector<HTMLImageElement>("[data-colour-preview]");
  if (!canvas || !studio) return;

  // Feature gate — leave the curated image swap in place if unsupported.
  if (!PaintEngine.capable) return;
  const engine = new PaintEngine(canvas, AERO_PAINT);
  if (!(await engine.load())) return;

  // Engine is live: reveal the studio + canvas, retire the fallback image.
  canvas.hidden = false;
  studio.hidden = false;
  if (img) img.style.display = "none";

  const aero = PRODUCTS.aero;
  const state: PaintState = {
    frame: { kind: "solid", hex: AERO_PAINT.angles.side!.regions.frame.defaultHex },
    wheels: { kind: "solid", hex: AERO_PAINT.angles.side!.regions.wheels.defaultHex },
    finish: "metallic",
  };

  // Debounced repaint (one per frame while dragging a colour input).
  let raf = 0;
  const repaint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      engine.compose(state);
    });
  };

  /* --- element refs --- */
  const frameColour = studio.querySelector<HTMLInputElement>("[data-frame-colour]")!;
  const frameHexEl = studio.querySelector<HTMLElement>("[data-frame-hex]")!;
  const wheelColour = studio.querySelector<HTMLInputElement>("[data-wheel-colour]")!;
  const wheelHexEl = studio.querySelector<HTMLElement>("[data-wheel-hex]")!;
  const framePresetsEl = studio.querySelector<HTMLElement>("[data-frame-presets]")!;
  const wheelPresetsEl = studio.querySelector<HTMLElement>("[data-wheel-presets]")!;
  const patternInput = studio.querySelector<HTMLInputElement>("[data-frame-pattern]")!;
  const patternClear = studio.querySelector<HTMLButtonElement>("[data-frame-pattern-clear]")!;
  const finishInputs = studio.querySelectorAll<HTMLInputElement>('input[name="finish"]');
  const labelEl = document.querySelector<HTMLElement>("[data-colour-label]");
  const finishEl = document.querySelector<HTMLElement>("[data-colour-finish]");

  const setCaption = (label: string) => {
    if (labelEl) labelEl.textContent = label;
    if (finishEl) finishEl.textContent = state.finish[0].toUpperCase() + state.finish.slice(1);
  };

  /* --- chips --- */
  const buildChips = (host: HTMLElement, presets: readonly (readonly [string, string])[], onPick: (hex: string) => void) => {
    for (const [name, hex] of presets) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "studio__chip";
      btn.style.setProperty("--swatch", hex);
      btn.title = name;
      btn.setAttribute("aria-label", name);
      btn.addEventListener("click", () => onPick(hex));
      li.appendChild(btn);
      host.appendChild(li);
    }
  };

  /* --- frame setters --- */
  const setFrameSolid = (hex: string, caption = "Custom") => {
    patternClear.hidden = true;
    state.frame = { kind: "solid", hex };
    frameColour.value = hex;
    frameHexEl.textContent = norm(hex);
    setCaption(caption);
    repaint();
  };
  const setWheelSolid = (hex: string) => {
    state.wheels = { kind: "solid", hex };
    wheelColour.value = hex;
    wheelHexEl.textContent = norm(hex);
    repaint();
  };

  buildChips(framePresetsEl, FRAME_PRESETS, (hex) => setFrameSolid(hex));
  buildChips(wheelPresetsEl, WHEEL_PRESETS, (hex) => setWheelSolid(hex));

  frameColour.addEventListener("input", () => setFrameSolid(frameColour.value));
  wheelColour.addEventListener("input", () => setWheelSolid(wheelColour.value));

  /* --- finish --- */
  finishInputs.forEach((r) =>
    r.addEventListener("change", () => {
      if (!r.checked) return;
      state.finish = r.value as PaintState["finish"];
      setCaption(labelEl?.textContent || "Custom");
      repaint();
    })
  );

  /* --- pattern upload --- */
  patternInput.addEventListener("change", async () => {
    const file = patternInput.files?.[0];
    if (!file) return;
    try {
      const bitmap = await PaintEngine.toPattern(file);
      state.frame = { kind: "pattern", bitmap, mode: "cover" } satisfies Fill;
      patternClear.hidden = false;
      setCaption("Custom pattern");
      repaint();
    } catch {
      /* ignore an undecodable file */
    }
    patternInput.value = "";
  });
  patternClear.addEventListener("click", () => setFrameSolid(frameColour.value));

  /* --- sync from the catalog swatches (keep summary + engine coherent) --- */
  const configForm = document.querySelector<HTMLFormElement>("[data-configure]");
  configForm?.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t?.name !== "colour" || !t.checked) return;
    const colour = aero.colours.find((c) => c.name === t.value);
    if (!colour) return;
    if (colour.finish) {
      state.finish = colour.finish;
      finishInputs.forEach((r) => (r.checked = r.value === colour.finish));
    }
    setFrameSolid(colour.hex, colour.name);
  });

  // Apply a colourway pushed by the assistant (inspiration palette).
  document.addEventListener("prisma:paint", (e) => {
    const d = (e as CustomEvent).detail as {
      frameHex?: string;
      wheelsHex?: string;
      finish?: PaintState["finish"];
      label?: string;
    };
    if (d.finish) {
      state.finish = d.finish;
      finishInputs.forEach((r) => (r.checked = r.value === d.finish));
    }
    if (d.wheelsHex) setWheelSolid(d.wheelsHex);
    if (d.frameHex) setFrameSolid(d.frameHex, d.label || "Custom");
    else repaint();
  });

  // Recompose on resize (engine rebuilds only if the pixel size changed).
  let rz = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = window.setTimeout(repaint, 120);
  });

  const note = studio.querySelector<HTMLElement>("[data-studio-note]");
  if (note) note.textContent = "Live preview on a reference model — final paint is confirmed with you before production.";

  // Seed the caption + first paint from the default (Moon Silver / Metallic).
  const seed = aero.colours[0];
  setFrameSolid(seed.hex, seed.name);
}
