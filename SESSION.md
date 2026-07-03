# SESSION — Prisma One landing page

_Last updated: 2026-06-27_

A working log to pick the project back up. For strategic/visual context see
`PRODUCT.md` and `DESIGN.md`.

> **2026-06-27** — Reworked around **real studio photos** (`product/IMG_2484*.jpeg`,
> 5 views) that replaced the AI renders. Hero is now a **zoomed front-wheel crop**
> from the side profile (`prisma-one-wheel.webp`, cropped from `IMG_2484 (4)`).
> Showpiece + turntable (side/3-4/front) now use the real shots. **Price removed**
> from the site (hero CTA + spec table). New photos carry a light-gray studio bg,
> so contained images read as subtle rounded "plates" on white — intentional.

---

## What this is

Launch landing page for the **Prisma One** — a premium **aero road bicycle**
(single-piece carbon monocoque frame). Single-page marketing site.

> ⚠️ History: the project started as a literal "optical glass prism" (from the
> mood board in `brainstorm/`). Mid-build the user dropped real bike renders into
> `product/`, revealing the actual product is a **bike**. The whole site was
> rebuilt around it; the optical-white design system carried over unchanged.

## Stack

- **Vite + vanilla TS**, zero runtime dependencies.
- Fonts: Space Grotesk (display) · Inter (body) · JetBrains Mono (labels), via Google Fonts.
- Images: `cwebp`-optimized WebP. Source renders are 2048² PNGs in `product/` (5–6 MB each).
- Dev-only: `puppeteer-core` (drives system Chrome for screenshots/QA). `ffmpeg`, `cwebp`, `sips` used for image processing.

## Run it

```bash
npm install
npm run dev        # hot-reload dev server
npm run preview    # serves the production build (npm run build first)
npm run build      # outputs dist/
```

## Layout / files

```
index.html              # all markup (single page)
src/style.css           # design tokens + all styles
src/main.ts             # all behaviour
public/favicon.svg      # prism-triangle mark
public/img/
  prisma-one-hero.webp      # hero — three-quarter render
  prisma-one-profile.webp   # showpiece — side profile (cover-cropped to drivetrain)
  turn/{side,three,front}.webp  # turntable frames sliced from the collage
product/                # ORIGINAL source renders (not shipped): 2 renders + 5-view collage
brainstorm/             # original mood-board screenshots
scripts/                # dev QA (puppeteer): shot.mjs, shot-section.mjs, check.mjs
```

## Page sections (in order)

1. **Nav** — wordmark · Frame / Geometry / Spec · Reserve CTA (sticky, hairline on scroll)
2. **Hero** — "Aero, distilled." + bike plate (pointer tilt) + spectral aura behind
3. **Manifesto** — "Speed isn't added. It's everything you take away."
4. **Showpiece** — full-bleed drivetrain detail crop (parallax pan) + spectral rule
5. **Frame** — 3 editorial feature columns (Frame / Build / Ride)
6. **Geometry** — **scroll-scrub turntable** (side→3/4→front), pinned, live angle label
7. **Spec** — bike spec table (mono labels + Space Grotesk values)
8. **Reserve** — email capture, full state machine (idle/invalid/submitting/success) + aura
9. **Footer**

## Design system (see DESIGN.md)

- **Optical white**, chroma-0 surfaces (never warm cream). North Star "The White Studio".
- Bold grotesque display + clean body + mono spec labels.
- **Spectrum = restrained brand accent** (auras, hover halos, progress line, rules) — never a rainbow wash, never gradient text.
- Single real shadow belongs to the product. WCAG-AA contrast verified.

## Motion inventory (all have `prefers-reduced-motion` fallbacks)

- Hero bike: pointer tilt (settles + pauses off-screen)
- Spectral auras: slow drift (hero + reserve)
- Hover: plate spectral halos, dark-button light-sweep (screen blend), feature lift, magnetic CTAs
- Scroll: spectral progress line, profile-image parallax (object-position pan), reveal-on-enter
- **Turntable**: pinned scroll-scrub, 3 frames crossfaded by scroll (power-curve sharpened). No-JS/reduced-motion → static side profile, no pin.

## Verification done

- `npm run build` clean, `tsc --noEmit` clean, **no console errors**.
- Form states tested (invalid → success) via `scripts/check.mjs`.
- Desktop + mobile + reduced-motion captured (puppeteer → `/tmp/shots/`).

## Specs are INVENTED — confirm before publishing

Frame/groupset/weight/price (e.g. **$6,400**, 7.4 kg, Toray T1100, 50 mm wheels,
edition of 500) are plausible placeholders. Replace with real numbers in
`index.html` (hero `dl.hero__facts`, the `.spec__table`, and feature `.feature__spec`).

## Open items / next steps

- [ ] **True 3D bike**: current turntable is a 3-angle scroll-scrub from real views.
      For a smooth Apple-style spin or drag-to-orbit, need a **`.glb`/`.gltf` model**
      (best) → wire three.js / `<model-viewer>`. Higgsfield (AI orbit→frames) was
      **out of credits** (free plan, 0 credits) and tends to warp bikes anyway.
- [ ] Optionally add **rear/top** turntable frames (slice from `product/prisma-one-collage.png`
      via ffmpeg `crop=w:h:x:y`) for a fuller rotation.
- [ ] Hero render has faint **floating component insets** (cockpit/saddle corners) —
      AI artifacts kept because cropping them zoomed too far. Swap if cleaner renders arrive.
- [ ] Replace invented specs with real product data.
- [ ] No deploy target set up yet (static `dist/` — drops onto any host / Vercel).

## Skills installed this session (FYI)

`impeccable`, `emilkowalski/skill` (emil-design-eng, review-animations),
`Leonxlnx/taste-skill` (13 skills incl. gpt-taste, high-end-visual-design),
`vercel-labs find-skills`. PRODUCT.md + DESIGN.md were generated via `/impeccable init`.
