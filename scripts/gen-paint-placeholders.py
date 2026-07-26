#!/usr/bin/env python3
"""
Generate PLACEHOLDER paint-engine layers for the Beta colour studio.

These approximate the real asset set the paint engine expects, derived from the
existing transparent Moon-Silver side render. They exist only so the engine and
UI can be built and demoed end-to-end. Replace every file under
public/img/paint/aero/side/ with the real 3D-source export (see the paint asset
spec in the plan): a neutral `base`, and per region a `*.shade` pass (RGB = AO,
A = mask) plus a `*.spec` highlight pass.

Run:  python3 scripts/gen-paint-placeholders.py
"""
import math
import os
from PIL import Image

SRC = "product/transparent/prisma-aero-moon-silver-side.png"
OUT = "public/img/paint/aero/side"

# Wheel discs measured from the source render (see scripts analysis).
REAR = (260, 527)
FRONT = (916, 527)
R = 214            # wheel outer radius (tyre)
R_TYRE_IN = 196    # inside this = rim body
R_RIM_IN = 150     # inside this = spokes / hub

os.makedirs(OUT, exist_ok=True)
src = Image.open(SRC).convert("RGBA")
W, H = src.size
sp = src.load()


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def dist(x, y, c):
    return math.hypot(x - c[0], y - c[1])


def in_wheel(x, y):
    """Return (center, radius-distance) of the nearest wheel if inside it."""
    dr = dist(x, y, REAR)
    df = dist(x, y, FRONT)
    d = min(dr, df)
    return d


# ---- Frame: shade (RGB = stretched luminance, A = silhouette minus wheels) ----
frame_shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
frame_spec = Image.new("RGBA", (W, H), (0, 0, 0, 0))
fs = frame_shade.load()
fsp = frame_spec.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = sp[x, y]
        if a <= 20 or in_wheel(x, y) <= R:
            continue
        L = lum(r, g, b)
        # brighten midtones so a colour multiply reads true, not muddy
        v = clamp(255 * (L / 255) ** 0.8)
        fs[x, y] = (v, v, v, a)
        # specular: only the brightest silver streaks, on black
        hi = clamp((L - 185) * 2.4)
        if hi > 6:
            fsp[x, y] = (255, 255, 255, clamp(hi, 0, a))
frame_shade.save(f"{OUT}/frame.shade.png")
frame_spec.save(f"{OUT}/frame.spec.png")

# ---- Wheels: synthetic deep-section disc so a colour actually reads on it ----
wheel_shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
wheel_spec = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ws = wheel_shade.load()
wsp = wheel_spec.load()
for center in (REAR, FRONT):
    cx, cy = center
    for y in range(cy - R - 2, cy + R + 2):
        if y < 0 or y >= H:
            continue
        for x in range(cx - R - 2, cx + R + 2):
            if x < 0 or x >= W:
                continue
            d = math.hypot(x - cx, y - cy)
            if d > R:
                continue
            if d >= R_TYRE_IN:
                v = 26           # tyre stays dark (recolour barely shows)
            elif d >= R_RIM_IN:
                # deep rim body: bright, slight radial falloff + top lighting
                toplit = 1.0 - (y - cy) / (2.2 * R)   # brighter up top
                v = clamp(150 + 55 * toplit)
            else:
                # spokes / hub: mid, faint spoke ticks from angle
                ang = math.atan2(y - cy, x - cx)
                spoke = 30 if (int(ang * 16 / math.pi) % 2 == 0 and d > 40) else 0
                v = clamp(120 - 40 * (1 - d / R_RIM_IN) + spoke)
            ws[x, y] = (v, v, v, 255)
            # a bright specular arc across the upper rim
            if R_RIM_IN <= d < R_TYRE_IN and (y - cy) < -0.25 * R and (x - cx) > 0.1 * R:
                wsp[x, y] = (255, 255, 255, 150)
wheel_shade.save(f"{OUT}/wheels.shade.png")
wheel_spec.save(f"{OUT}/wheels.spec.png")

# ---- Base: nothing baked for the placeholder (all visible bike is paintable) ----
Image.new("RGBA", (W, H), (0, 0, 0, 0)).save(f"{OUT}/base.png")

print(f"Wrote placeholder paint layers to {OUT}/ ({W}x{H})")
