/* ----------------------------------------------------------------
   Paintable-product registry — maps each product/angle to its asset set.

   Assets live under public/img/paint/<product>/<angle>/. Today only aero/side
   is authored: the passes are derived from the snow-white studio renders by
   scripts/derive-paint-passes.py (matte = AO, metallic - matte = specular),
   masked by product/prisma-aero-side-frame.mask.png. Re-run that script after
   editing the mask. Add angles/products by dropping in the passes and extending
   `angles` here.
   ---------------------------------------------------------------- */
import type { PaintableProduct } from "./types";

const AERO_SIDE_DIR = "/img/paint/aero/side";

export const AERO_PAINT: PaintableProduct = {
  productId: "aero",
  defaultAngle: "side",
  // Specular opacity per finish: matte reads flat, metallic bright, pearl full.
  finishSpec: { matte: 0.22, metallic: 1.0, pearl: 0.9 },
  angles: {
    side: {
      base: `${AERO_SIDE_DIR}/base.png`,
      width: 1196,
      height: 896,
      // Wheels region intentionally omitted: the real per-part wheel masks will
      // be supplied later. Until then the wheels come straight from `base` and
      // are not recoloured (the wheel colour picker stays but has no effect).
      regions: {
        frame: {
          id: "frame",
          label: "Frame",
          shade: `${AERO_SIDE_DIR}/frame.shade.png`,
          spec: `${AERO_SIDE_DIR}/frame.spec.png`,
          defaultHex: "#a3b0bb", // Moon Silver
        },
      },
    },
  },
};

export const PAINTABLE: Record<string, PaintableProduct> = { aero: AERO_PAINT };
