/* ----------------------------------------------------------------
   Apply bridge — turn assistant output into configurator + paint state.

   A recommendation's strings are catalog values (enum-constrained server-side),
   so they map directly onto the radio `value`s. Setting the colour radio and
   dispatching a bubbling change drives both the configurator (price/summary/
   fallback image) and the paint studio (which recolours the canvas from the
   catalog hex). A palette suggestion goes straight to the paint engine via a
   `prisma:paint` event.
   ---------------------------------------------------------------- */
import type { PaletteResult, Recommendation } from "./client";

function setRadio(form: HTMLFormElement, name: string, value: string): HTMLInputElement | null {
  const el = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (el) el.checked = true;
  return el;
}

/** Apply a fit recommendation to the configurator (and, via sync, the canvas). */
export function applyRecommendation(rec: Recommendation): void {
  const form = document.querySelector<HTMLFormElement>("[data-configure]");
  if (!form) return;
  setRadio(form, "size", rec.size);
  setRadio(form, "drivetrain", rec.drivetrain);
  if (rec.pedals) setRadio(form, "pedals", rec.pedals);
  const colour = setRadio(form, "colour", rec.colour);
  // One bubbling change recomputes the whole configurator; dispatching it from
  // the colour input also triggers the studio's colour-sync handler.
  (colour ?? form).dispatchEvent(new Event("change", { bubbles: true }));
}

/** Apply an inspiration palette: exact hexes to the canvas, nearest preset to
 *  the catalog swatch so the summary + image fallback stay coherent. */
export function applyColourway(s: PaletteResult["suggested"]): void {
  if (s.nearestPreset) {
    const form = document.querySelector<HTMLFormElement>("[data-configure]");
    const colour = form && setRadio(form, "colour", s.nearestPreset);
    colour?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.dispatchEvent(
    new CustomEvent("prisma:paint", {
      detail: { frameHex: s.frameHex, wheelsHex: s.wheelsHex, finish: s.finish, label: "From inspiration" },
    })
  );
}
