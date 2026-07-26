/* ----------------------------------------------------------------
   Paint engine — types describing the paintable-asset set.

   The bike is flat raster art, so per-region recolour is done by recombining
   render passes exported from the 3D source:
     • base    — non-paintable parts final; paintable regions transparent
     • *.shade — RGB = AO / luminance, A = the region's anti-aliased mask
                 (so the shade file doubles as the mask)
     • *.spec  — specular / highlight pass on black (reflections stay white
                 regardless of paint colour)
   Runtime formula per region:  (colour × shade) screened-with spec.
   ---------------------------------------------------------------- */
import type { Finish } from "../data/products";

export type { Finish };
export type RegionId = "frame" | "wheels";
export type AngleId = "side" | "front" | "rear" | "three-quarter" | "top";

/** One recolourable region and the passes that render it. */
export interface PaintRegion {
  id: RegionId;
  label: string;
  /** RGB = AO, A = region mask. */
  shade: string;
  /** Specular/highlight pass on black. */
  spec: string;
  /** Explicit hard mask; defaults to the shade's alpha channel when omitted. */
  mask?: string;
  /** Seed colour for the region. */
  defaultHex: string;
}

/** All layers for one product at one camera angle. Every layer must be
 *  pixel-registered (same camera, same canvas size). */
export interface PaintLayerSet {
  base: string;
  overlay?: string;
  /** Intrinsic pixel size of the passes. */
  width: number;
  height: number;
  /** Present regions. Wheels are omitted until real wheel masks are supplied. */
  regions: Partial<Record<RegionId, PaintRegion>>;
}

export interface PaintableProduct {
  productId: "aero" | "terra";
  defaultAngle: AngleId;
  angles: Partial<Record<AngleId, PaintLayerSet>>;
  /** Specular opacity per finish (matte flat → metallic bright). */
  finishSpec: Record<Finish, number>;
}

/** How a region is filled. */
export type Fill =
  | { kind: "solid"; hex: string }
  | { kind: "pattern"; bitmap: ImageBitmap; mode: "cover" | "tile" };

/** Current studio selection the engine renders. */
export interface PaintState {
  frame: Fill;
  wheels: Fill;
  finish: Finish;
}
