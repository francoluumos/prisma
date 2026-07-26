/* ----------------------------------------------------------------
   Apply bridge — turn assistant output into configurator + paint state.

   A recommendation's strings are catalog values (enum-constrained server-side),
   so they map directly onto the radio `value`s. Setting the colour radio and
   dispatching a bubbling change drives both the configurator (price/summary/
   fallback image) and the paint studio (which recolours the canvas from the
   catalog hex). A palette suggestion goes straight to the paint engine via a
   `prisma:paint` event.
   ---------------------------------------------------------------- */
import { PRODUCTS } from "../data/products";
import type { PaletteResult, Recommendation } from "./client";

/** Set a choice by name whether it's a radio group or a <select>. */
function setChoice(form: HTMLFormElement, name: string, value: string): Element | null {
  const radio = form.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${CSS.escape(value)}"]`
  );
  if (radio) {
    radio.checked = true;
    return radio;
  }
  const select = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (select) {
    select.value = value;
    return select;
  }
  return null;
}

/** Apply a fit recommendation to the configurator (and, via sync, the canvas). */
export function applyRecommendation(rec: Recommendation): void {
  const form = document.querySelector<HTMLFormElement>("[data-configure]");
  if (!form) return;
  setChoice(form, "size", rec.size);
  setChoice(form, "drivetrain", rec.drivetrain);
  if (rec.pedals) setChoice(form, "pedals", rec.pedals);
  setChoice(form, "colour", rec.colour); // no-op on Beta (studio owns colour)
  // One bubbling change recomputes the configurator (price/summary). The Beta
  // studio has no colour radios, so paint the recommended catalog colour onto
  // the canvas directly via the event the studio listens for.
  form.dispatchEvent(new Event("change", { bubbles: true }));
  const spec = PRODUCTS.aero.colours.find((c) => c.name === rec.colour);
  if (spec) {
    document.dispatchEvent(
      new CustomEvent("prisma:paint", { detail: { frameHex: spec.hex, finish: spec.finish, label: spec.name } })
    );
  }
}

/** Apply an inspiration palette: exact hexes to the canvas, nearest preset to
 *  the catalog swatch so the summary + image fallback stay coherent. */
export function applyColourway(s: PaletteResult["suggested"]): void {
  if (s.nearestPreset) {
    const form = document.querySelector<HTMLFormElement>("[data-configure]");
    const colour = form && setChoice(form, "colour", s.nearestPreset);
    colour?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.dispatchEvent(
    new CustomEvent("prisma:paint", {
      detail: { frameHex: s.frameHex, wheelsHex: s.wheelsHex, finish: s.finish, label: "From inspiration" },
    })
  );
}
