/* ----------------------------------------------------------------
   Paintable-product registry — maps each product/angle to its asset set.

   Assets live under public/img/paint/<product>/<angle>/. Today only aero/side
   is authored (placeholder layers from scripts/gen-paint-placeholders.py, to be
   replaced by the real 3D export). Add angles/products by dropping in the passes
   and extending `angles` here.
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
      regions: {
        frame: {
          id: "frame",
          label: "Frame",
          shade: `${AERO_SIDE_DIR}/frame.shade.png`,
          spec: `${AERO_SIDE_DIR}/frame.spec.png`,
          defaultHex: "#a3b0bb", // Moon Silver
        },
        wheels: {
          id: "wheels",
          label: "Wheels",
          shade: `${AERO_SIDE_DIR}/wheels.shade.png`,
          spec: `${AERO_SIDE_DIR}/wheels.spec.png`,
          defaultHex: "#1b1b1b", // deep-section black
        },
      },
    },
  },
};

export const PAINTABLE: Record<string, PaintableProduct> = { aero: AERO_PAINT };
