# SESSION — Prisma One landing page

_Last updated: 2026-07-03_

A working log to pick the project back up. For strategic/visual context see
`PRODUCT.md` and `DESIGN.md`.

> **2026-07-03** — **Site is now TWO models + live in production.** Added a second bike
> (**Prisma Terra**, a gravel bike) and shipped it to `prismacycling.ch` via Vercel.
> Everything below the 2026-06-27 note is partly historical (single-page / turntable /
> invented-spec era) — this entry is the current source of truth.
>
> **What changed today**
> - **Two pages, header switch.** `index.html` = Aero (Prisma One). `gravel.html` = Gravel
>   (Prisma Terra). Nav has an **Aero | Gravel** segmented switch (`.nav__models`) that
>   navigates between them; active model highlighted. Present on both pages.
> - **Multi-page build.** New `vite.config.js` (`rollupOptions.input` = index + gravel) so
>   `npm run build` emits both. Dev server serves any root `.html`.
> - **Gravel page** clones the Aero layout with gravel copy/specs (from an Alibaba/KOZO
>   listing + the user's real photos). Real Terra studio photos live in
>   `public/img/gravel/` as WebP: `prisma-terra-{side,front,rear,top,three-quarter}.webp`
>   (converted from `product/prisma-terra-transparent-*.png` via `cwebp -q 82 -alpha_q 100`).
>   Hero + anatomy use the **side** photo; the annotated anatomy callouts were **re-tuned by
>   hand** to the Terra side image (image placed at x443 y200 w1014 h641 in the 1900×1040 SVG).
>   Geometry reel = three-quarter · front · top · rear.
> - **Configurator** (gravel): **Drivetrain** is the priced dimension —
>   **Shimano GRX600 CHF 1'530** (default, matches the pictured bike) / **Wheeltop GEX 1×13
>   wireless CHF 1'181**. Frame size (50/53/56/58/61) is free; Colour = Raw Silver / Phantom
>   Black. Prices = base + **CHF 400** shipping fee (781→1181, 1130→1530). "**Pedals not
>   included**" note. "Your build" price shows a small `*` → footnote "*Includes CHF 400
>   shipping to our warehouse in Germany*" (added to **both** pages).
> - **Shared JS generalized** (`src/main.ts`): configurator total now reads
>   `input[data-price]:checked` and the summary joins all checked radios — one code path
>   serves both pages. Aero page unchanged in behaviour (verified).
> - **CSS fixes** (`src/style.css`): reel slides go **full-width < 640px** so the bike centres
>   on mobile (was left-anchored); hero gets a **desktop-only right margin**
>   (`.hero__grid { padding-right: var(--pad-x) }`) so the bike no longer bleeds to the edge —
>   the `max-width:880px` mobile override (`padding-inline`) keeps mobile untouched.
>
> **Deploy / infra (LIVE)**
> - **GitHub:** `git@github.com-luumos:francoluumos/prisma.git` on `main`. ⚠️ Must push via
>   the **`github.com-luumos` SSH alias** (`~/.ssh/config` → `id_ed25519_luumos`, authenticates
>   as `francoluumos`). The default `git@github.com` key is `francoseinerdq` and is **denied**.
>   Remote is already set correctly, so `git push` just works.
> - **Vercel:** project `luumos-projects/prisma`, auto-detects Vite, auto-deploys on push.
>   `.claude/ .agents/ .codex/ .cursor/ .impeccable/` + `node_modules`/`dist` are gitignored.
> - **Domain:** `prismacycling.ch` live, primary = **bare apex**, `www` **308-redirects** to it.
>   DNS at **Hostpoint**: apex `A → 216.198.79.1`, `www CNAME → 12c6ccb1d92c0377.vercel-dns-017.com`,
>   all mail records (MX/autoconfig/SPF) left intact. (Debugging note: `.ch` delegation lagged
>   a few hours after same-day registration — was NXDOMAIN at `a.nic.ch` until SWITCH published.)
>
> **Pick up here next**
> - When the user sends more/better gravel photos, replace the `public/img/gravel/*.webp`
>   (same names) and re-verify anatomy callout alignment (`scripts/shot-section.mjs .anatomy`).
> - Colour swatches are placeholders (Raw Silver / Phantom Black) carried from Aero — the
>   real listing showed 4 colours; swap names/hex when known.
> - Aero (`index.html`) still carries the **invented specs** flagged below; Gravel specs are
>   real-ish (from the listing) but tyre data was contradictory (700c vs 29×2.1) — presented
>   as gravel `700c / 29 × 2.1"`.
> - QA loop: `npm run preview -- --port 4173` then `node scripts/shot-section.mjs <url> <sel> <label> [w] [h]`
>   (drives system Chrome headless → `/tmp/shots/`). Config interactivity checked with an
>   inline puppeteer script run **from the project dir** (needs local `node_modules`).

> **2026-06-27** — Reworked around **real studio photos** (`product/IMG_2484*.jpeg`,
> 5 views) that replaced the AI renders. Hero is now a **zoomed front-wheel crop**
> from the side profile (`prisma-one-wheel.webp`, cropped from `IMG_2484 (4)`).
> Showpiece + turntable (side/3-4/front) now use the real shots. **Price removed**
> from the site (hero CTA + spec table). New photos carry a light-gray studio bg,
> so contained images read as subtle rounded "plates" on white — intentional.

---

## What this is

Launch site for **Prisma** bikes — now **two models**: **Prisma One** (aero road,
`index.html`) and **Prisma Terra** (gravel, `gravel.html`), switchable from the header.
Premium single-piece carbon frames. (Originally a single Prisma One page — see the
2026-07-03 note above for the current two-model + deployed state.)

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
