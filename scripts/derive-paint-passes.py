#!/usr/bin/env python3
"""Derive the paint engine's render passes from the snow-white studio renders.

The colour studio (src/paint/engine.ts) recolours a region with
`(colour x shade) screened-with spec`, so it needs three registered layers:

    base             non-paintable parts final; the paintable region transparent
    frame.shade      RGB = AO / luminance, A = the region mask
    frame.spec       specular pass on black

We don't have a 3D export of those passes. We do have the same frame, same
camera, in two finishes, plus a Photoshop isolation of the frame:

    matte render     white paint scatters diffusely  -> reads as AO
    metallic render  same colour, same light         -> matte + specular
    PSD layer 2      frame + fork + drivetrain cut out of the background

Snow white is what makes this work: albedo is ~1 and saturation ~0.01, so the
matte luminance IS the shading term, with no hue to divide out. The specular is
then just the positive part of (metallic - matte).

    shade = matte / white_point      spec = max(metallic - matte, 0)

MASK. `frame.mask.png` is the authoring input and the one file worth redoing by
hand -- everything else is derived from it. A hand-authored mask on disk always
wins; pass --rederive to overwrite it with the automatic one. The automatic mask
is the PSD isolation minus the dark drivetrain, which the luminance histogram
separates cleanly (frame ~190-245, drivetrain <100, nothing between).

Usage:
    python3 scripts/derive-paint-passes.py              # keep existing mask
    python3 scripts/derive-paint-passes.py --rederive   # rebuild the mask too
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
PRODUCT = ROOT / "product"
OUT = ROOT / "public/img/paint/aero/side"

MATTE = PRODUCT / "prisma-aero-snow-white-matte-transparent-side.png"
METALLIC = PRODUCT / "prisma-aero-snow-white-metallic-transparent-side.png"
PSD = PRODUCT / "prisma-aero-snow-white-matte-transparent-side.psd"

# Authoring input, not a shipping asset -- it lives with the other source art in
# product/ so it doesn't deploy to the CDN unused. Nothing at runtime loads it;
# the engine reads the mask from frame.shade's alpha channel.
MASK_PATH = PRODUCT / "prisma-aero-side-frame.mask.png"

# Frame paint sits at luminance ~190-245, the black groupset below ~100. Cut in
# the empty valley between them.
DRIVETRAIN_LUM = 150.0
# Drop specks / plug pinholes smaller than this (px) after thresholding.
SPECK_AREA = 120
# The two renders are separately rendered, not two passes of one camera, so
# their silhouettes disagree by a hair. Erode before differencing or the
# mismatch shows up as a bright rim in the specular pass.
SPEC_ERODE = 2
# Inverting the screen blend divides by (1 - matte), which explodes where the
# frame is already near white. Floor the divisor so those pixels saturate
# gracefully instead of going to full-strength highlight.
SPEC_HEADROOM_FLOOR = 0.12
# White point for the shade pass: percentile of frame luminance mapped to 1.0.
# Using a high percentile rather than the max keeps a stray blown highlight from
# darkening the whole frame.
WHITE_POINT_PCT = 99.0


def load_rgba(path: Path) -> np.ndarray:
    if not path.exists():
        sys.exit(f"missing input: {path.relative_to(ROOT)}")
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)


def psd_frame_isolation(path: Path) -> np.ndarray:
    """Alpha of the PSD's frame layer (frame + fork + drivetrain, no wheels)."""
    im = Image.open(path)
    im.seek(1)
    return np.asarray(im.convert("RGBA")).astype(np.float64)[..., 3]


def clean(mask: np.ndarray, min_area: int) -> np.ndarray:
    """Drop islands and fill holes below `min_area` pixels."""
    for invert in (False, True):
        work = ~mask if invert else mask
        lab, n = ndimage.label(work)
        if n:
            areas = ndimage.sum(work, lab, range(1, n + 1))
            small = np.isin(lab, [i + 1 for i, a in enumerate(areas) if a < min_area])
            work = work & ~small
        mask = ~work if invert else work
    return mask


def derive_mask(matte: np.ndarray) -> np.ndarray:
    """PSD isolation minus the dark groupset, cleaned and feathered.

    Returns a float mask in [0,1] with soft edges: the render is anti-aliased,
    so a hard mask would leave a jagged seam against `base`.
    """
    iso = psd_frame_isolation(PSD)
    lum = matte[..., :3].mean(axis=2)

    hard = (iso > 128) & (lum >= DRIVETRAIN_LUM) & (matte[..., 3] > 128)
    hard = clean(hard, SPECK_AREA)

    # Feather by one pixel, then re-multiply by the render's own alpha so the
    # mask can never claim pixels that are transparent in the source.
    soft = ndimage.gaussian_filter(hard.astype(np.float64), sigma=0.8)
    return np.clip(soft, 0, 1) * (matte[..., 3] / 255.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--rederive",
        action="store_true",
        help="rebuild frame.mask.png instead of using the one on disk",
    )
    args = ap.parse_args()

    matte = load_rgba(MATTE)
    metallic = load_rgba(METALLIC)
    if matte.shape != metallic.shape:
        sys.exit(f"renders disagree on size: {matte.shape} vs {metallic.shape}")
    OUT.mkdir(parents=True, exist_ok=True)

    if MASK_PATH.exists() and not args.rederive:
        mask = np.asarray(Image.open(MASK_PATH).convert("L")).astype(np.float64) / 255.0
        if mask.shape != matte.shape[:2]:
            sys.exit(f"{MASK_PATH.name} is {mask.shape}, renders are {matte.shape[:2]}")
        print(f"mask     using existing {MASK_PATH.relative_to(ROOT)} (--rederive to replace)")
    else:
        mask = derive_mask(matte)
        Image.fromarray((mask * 255).round().astype(np.uint8), "L").save(MASK_PATH)
        print(f"mask     derived -> {MASK_PATH.relative_to(ROOT)}")

    solid = mask > 0.5
    if not solid.any():
        sys.exit("mask is empty - nothing to paint")

    # --- shade: RGB = AO, A = mask -------------------------------------------
    lum = matte[..., :3].mean(axis=2)
    white = np.percentile(lum[solid], WHITE_POINT_PCT)
    ao = np.clip(lum / white, 0, 1)
    shade = np.zeros((*mask.shape, 4), np.uint8)
    shade[..., :3] = (ao[..., None] * 255).round().astype(np.uint8)
    shade[..., 3] = (mask * 255).round().astype(np.uint8)
    Image.fromarray(shade, "RGBA").save(OUT / "frame.shade.png")

    # --- spec: white, with the highlight strength in alpha ---------------------
    # The engine screens this pass, and screening white at alpha a over dst
    # gives `dst + a*(1 - dst)`. So the alpha that reproduces an observed
    # highlight is the inverse of that, not the raw difference:
    #
    #     a = (metallic - matte) / (1 - matte)
    #
    # RGB stays pure white; alpha alone carries the intensity. Keeping the pass
    # transparent where there is no highlight matters -- an opaque spec would
    # make the whole region canvas opaque and stamp a black rectangle over the
    # bike, because canvas composites blend modes with the source-over alpha
    # rule.
    eroded = ndimage.binary_erosion(solid, iterations=SPEC_ERODE)
    m_lum = matte[..., :3].mean(axis=2) / 255.0
    g_lum = metallic[..., :3].mean(axis=2) / 255.0
    headroom = np.maximum(1.0 - m_lum, SPEC_HEADROOM_FLOOR)
    alpha = np.clip((g_lum - m_lum) / headroom, 0, 1) * eroded
    spec = np.zeros((*mask.shape, 4), np.uint8)
    spec[..., :3] = 255
    spec[..., 3] = (alpha * 255).round().astype(np.uint8)
    Image.fromarray(spec, "RGBA").save(OUT / "frame.spec.png")

    # --- base: everything the studio does not repaint --------------------------
    base = matte.copy()
    base[..., 3] *= 1.0 - mask
    Image.fromarray(base.round().astype(np.uint8), "RGBA").save(OUT / "base.png")

    frame_px = int(solid.sum())
    print(f"white pt {white:6.1f}  (p{WHITE_POINT_PCT:g} of frame luminance)")
    print(f"frame    {frame_px:,} px ({frame_px / mask.size * 100:.1f}% of canvas)")
    hot = alpha[eroded]
    print(f"spec     alpha p50 {np.percentile(hot, 50):.3f}  p90 {np.percentile(hot, 90):.3f}  max {hot.max():.3f}")
    print(f"wrote    {OUT.relative_to(ROOT)}/{{base,frame.shade,frame.spec}}.png")


if __name__ == "__main__":
    main()
