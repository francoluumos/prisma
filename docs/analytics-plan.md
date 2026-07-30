# Analytics & autonomous optimization — plan

_Status: **Phase 1 partly shipped (2026-07-30)** — consent gate, `track()` seam,
funnel instrumentation and Vercel Web Analytics + Speed Insights are live.
PostHog is **not** wired: Prisma has no PostHog project yet. See §11._

How Prisma measures visitor behaviour and, over time, runs an **agent-proposes /
human-approves** loop that improves the site from that data. Sibling to
`payments-plan.md`. Nothing here ships until the PostHog project exists and the
consent-gated wiring (Phase 1) is reviewed.

---

## 0. The honest constraint (read first)

A/B testing is a **statistics problem before an engineering one**. Calling a
winner at 95% confidence needs on the order of **hundreds of conversions per
variant**. A launching premium brand does not have that traffic yet. So this
plan is deliberately built for **low volume**:

- Optimize **micro-conversions** (configurator-complete, reserve-started), not
  just sales — they have enough volume to move.
- Prefer **qualitative** signal (session replay, funnel drop-off, surveys) over
  blind A/B until traffic supports it.
- When testing, use **sequential / bandit** methods, not fixed 50/50 splits.
- The loop **proposes**; a human **approves** before anything ships. No
  self-rewriting site.

If we forget this, the loop will promote noise as signal and quietly degrade the
site. Volume gates ambition — not the other way round.

---

## 1. Stack decision

| Tool | Role | Why |
| --- | --- | --- |
| **PostHog** (EU cloud) | Core: product analytics, funnels, **session replay**, **feature flags**, **experiments**, **surveys** | One tool covers most of the ask; already connected to the Luumos org via MCP, so the agent can read it directly. EU-hosted → GDPR-friendly. |
| **Vercel Speed Insights + Web Analytics** | Real-user Web Vitals per deploy | One line each; first-party field data (this *is* the "Chrome UX / site speed" answer). |
| ~~GA4~~ | — | Skip until paid Google traffic exists; overlaps PostHog, only adds Ads attribution. |
| ~~Standalone CrUX / PageSpeed~~ | — | Speed Insights covers field Web Vitals; add CrUX later only for competitive benchmarking. |

**Net: PostHog + Vercel Speed Insights.** Two integrations, both consent-gated.

---

## 2. PostHog project setup (do this first — new site)

1. Create a PostHog account / project on **EU cloud** (`eu.posthog.com`) — matches
   the existing Luumos org region and keeps data in the EU.
2. Project name: `prisma` (or `prismacycling`). Note the **Project API key**
   (`phc_…`) and the **API host** (`https://eu.i.posthog.com`).
3. Settings to set on day one:
   - **Autocapture: ON** (cheap clicks/pageviews) but we also send explicit
     events (below) for the funnel that matters.
   - **Session replay: ON**, with **mask all inputs / text** for privacy (we
     never need to see typed emails or discount codes).
   - **Person profiles: "identified only"** — cheaper, more private; we don't
     identify visitors, so most stay anonymous.
   - **Web vitals: ON** (PostHog can capture them too; harmless overlap with
     Speed Insights, useful in the same funnel view).
4. Add a **reverse proxy** so ad-blockers don't nuke ingestion: a Vercel rewrite
   from `/ingest/*` → `eu.i.posthog.com/*` (and `/ingest/static/*` →
   `eu-assets.i.posthog.com/static/*`). Config the SDK with `api_host: "/ingest"`.
   Details in §5. This meaningfully raises data capture rate.
5. Create two **environments** or projects: `production` and (optional)
   `preview`, so Vercel preview deploys don't pollute prod data. Simplest: gate
   init on `import.meta.env.PROD`.

**Hand-off:** once the project exists, put the key in Vercel env as
`VITE_POSTHOG_KEY` (and `VITE_POSTHOG_HOST` if not proxying). The agent never
needs the write key; it reads via the existing PostHog **MCP**.

---

## 3. Consent integration (privacy-first, uses what exists)

`src/cookie.ts` already stores `"all" | "necessary" | null` under
`prisma-cookie-consent` and gates analytics on `getConsent() === "all"`. Two
required changes:

1. **Emit an event on choice.** `decide()` currently sets localStorage but fires
   nothing, so analytics loaded on the same page as the click won't boot until
   the next navigation. Add:
   ```ts
   window.dispatchEvent(new CustomEvent("prisma-consent", { detail: choice }));
   ```
   The analytics bootstrap listens for this **and** checks `getConsent()` on load.
2. **Load order:** analytics init runs only when `getConsent() === "all"`. On
   `"necessary"` or `null`, nothing loads, no PostHog cookies are set, no replay.
   If the visitor later clicks "Accept all", the `prisma-consent` event boots it
   mid-session.

Result: zero analytics for non-consenting visitors, and the Cookie Policy page
(`cookies.html`) stays accurate. Experiments (§7) also respect this — a
`necessary`-only visitor always sees the control.

---

## 4. Event schema

Naming: `snake_case`, `object_verb` where useful. Properties carry **no PII**
(no raw email, no discount code value — only booleans / hashes / enums).

### 4.1 Global
| Event | When | Key properties |
| --- | --- | --- |
| `$pageview` | autocapture | `$current_url`, `path`, model page (aero/gravel/pickup/beta) |
| `$web_vitals` | autocapture | LCP, CLS, INP, FCP, TTFB |
| `cta_click` | any primary CTA | `label`, `location` (nav / hero / config_bar / footer), `href` |

### 4.2 Configurator funnel (the money path — highest priority)
Instrument `src/configurator.ts`. This is where the buying decision happens.

| Step | Event | Properties |
| --- | --- | --- |
| Section reached | `configurator_viewed` | `model` (aero) |
| Any option picked | `config_option_selected` | `dimension` (size\|colour\|drivetrain\|pedals), `value`, `price_delta` |
| Total recomputed | `config_total_changed` | `total_chf` — **debounced** (fire on settle, not per keystroke) |
| Discount tried | `config_discount_applied` | `valid` (bool), `code_hash` (never the raw code) |
| Full build complete | `config_build_complete` | fires once all four dimensions chosen; `{size,colour,drivetrain,pedals,total_chf}` |
| Reserve intent | `reserve_cta_click` | `source` (config_bar\|hero\|nav), the current build object |

`config_build_complete` is the key **micro-conversion** — enough volume to
optimize on long before real sales.

### 4.3 Reserve form (`src/site.ts`)
| Event | When | Properties |
| --- | --- | --- |
| `reserve_form_start` | email field focus | `location` |
| `reserve_submit` | submit | `result` (valid\|invalid), **no email**, optional hashed domain |

### 4.4 Pickup page (`src/pickup.ts`)
| Event | When | Properties |
| --- | --- | --- |
| `pickup_town_search` | search runs | `town`, `nearest_km`, `drive_min` |
| `pickup_notify_click` | Notify me | — |

### 4.5 Studio / Beta (`src/beta.ts`) — lower priority
`studio_opened`, `studio_recolour` `{region, hex}`, `studio_assistant_used`.

### 4.6 Funnels to build in PostHog
1. **Purchase-intent funnel:** `$pageview (aero)` → `configurator_viewed` →
   `config_option_selected` → `config_build_complete` → `reserve_cta_click` →
   `reserve_submit`. This single funnel is the dashboard that matters.
2. **Pickup interest:** `$pageview (pickup)` → `pickup_town_search` →
   `pickup_notify_click`.

---

## 5. Implementation (Phase 1 code)

New module `src/analytics.ts`:
- Exports `initAnalytics()` and a thin `track(event, props?)` wrapper that
  **no-ops when consent ≠ "all"** or PostHog isn't loaded.
- Boots on `getConsent() === "all"` at load, and on the `prisma-consent` event.
- Lazy-loads `posthog-js` (dynamic `import()`), configured with
  `api_host: "/ingest"`, `person_profiles: "identified_only"`,
  `capture_pageview: true`, input masking on.
- Called from `initSite()` so every page gets it; `track()` calls added to
  `configurator.ts`, `site.ts`, `pickup.ts`, `beta.ts` per §4.

Vercel wiring (`vercel.json`):
```jsonc
"rewrites": [
  { "source": "/ingest/static/:p*", "destination": "https://eu-assets.i.posthog.com/static/:p*" },
  { "source": "/ingest/:p*",        "destination": "https://eu.i.posthog.com/:p*" }
]
```
Speed Insights: `@vercel/speed-insights` + `@vercel/analytics` (tiny), injected
only when consent is `"all"`.

Env: `VITE_POSTHOG_KEY` in Vercel. Guard init behind `import.meta.env.PROD`.

**Deliverable of Phase 1:** data flowing, funnels populated, **zero UX change**,
fully consent-gated. Then collect for **~1–2 weeks** before building anything on
top. No experiments until the funnel has a baseline.

---

## 6. The autonomous loop — architecture

Same **producer-proposes / human-approves** pattern as the Odoo triage skills.
The agent never ships to users unattended.

```
 PostHog MCP ──▶ agent reads: funnels, drop-off, replays, web-vitals, survey text
      │
      ▼
 agent forms ONE hypothesis, writes it up as a proposed experiment
      │
      ▼
 human approves (MeisterTask/Odoo task, same as coding loop)   ◀── GATE
      │
      ▼
 agent implements variant behind a PostHog feature flag, ships via git → Vercel
      │
      ▼
 PostHog runs it as a bandit experiment (consent-gated traffic only)
      │
      ▼
 significance reached OR guardrail tripped
      │                         │
   winner                   auto-rollback
      │                         │
 agent promotes winner,     agent disables flag,
 removes flag, logs learning   logs failure
      │
      ▼
 weekly cadence ─────────────────────▶ (back to top)
```

- **Cadence:** weekly, not real-time. Low traffic means daily changes are noise.
- **One hypothesis at a time** until traffic supports parallel tests (avoids
  interaction effects and split-thin traffic).
- **Learning log:** every experiment (win *or* loss) appended to
  `docs/experiments-log.md` — the compounding asset. Losses are data.

---

## 7. Experiment & feature-flag conventions

- Flag naming: `exp-<area>-<slug>` (e.g. `exp-config-default-drivetrain`).
- Every experiment record carries: hypothesis, primary metric, **guardrail
  metric**, minimum runtime, min sample, and rollback trigger — written *before*
  launch.
- **Method:** PostHog experiments in **bandit / sequential** mode; no fixed
  horizon. Ship-to-100% only after the flag is promoted and the code path
  becomes the default (then delete the flag — no permanent flag debt).
- **Consent:** experiments only evaluate for `getConsent() === "all"` visitors;
  everyone else gets control. Bake this into the flag bootstrap.

---

## 8. Guardrails (non-negotiable)

1. **Human approval gate** before any variant ships. Start strict; loosen per
   *class* of experiment later (e.g. copy microtests auto-approve; layout never).
2. **Never touch autonomously:** price, legal/consent copy, checkout/reserve
   logic, Impressum, anything payment-related. Hard allowlist of what the loop
   may edit (headlines, section order, CTA text, default option selection,
   imagery) — everything else is human-only.
3. **Guardrail metric on every test:** if bounce rate, JS error rate, or Web
   Vitals regress beyond a threshold, **auto-disable the flag** and alert.
4. **No PII in events, ever.** Inputs masked in replay; emails/codes never sent.
5. **Consent-respecting:** no experiment, replay, or analytics for
   non-consenting visitors.
6. **Reversible by construction:** everything is a flag or a git revert; a bad
   change is one toggle away from gone.

---

## 9. Roadmap

- **Phase 0 — you:** create the PostHog EU project, add `VITE_POSTHOG_KEY` to
  Vercel. _(blocking)_
- **Phase 1 — instrument (agent, ~½ day):** `analytics.ts`, consent event,
  configurator + reserve + pickup events, reverse proxy, Speed Insights. Ship.
  **Then collect 1–2 weeks.**
- **Phase 2 — read (agent + you):** build the purchase-intent funnel, watch
  replays of drop-offs, add 1–2 micro-surveys. Produce a first hypothesis list.
- **Phase 3 — first experiment (human-approved):** one bandit test on the
  biggest funnel leak. Establish the flag → ship → measure → promote → log ritual.
- **Phase 4 — loop:** wrap Phases 2–3 as a scheduled skill (weekly) that
  proposes into a task queue, exactly like the existing triage skills. Loosen the
  approval gate only for the safest experiment classes.

---

## 10. Open decisions (need your input)

1. **Reverse proxy?** Recommended (beats ad-blockers) but adds two rewrites —
   OK to add to `vercel.json`?
2. **Approval channel:** MeisterTask, Odoo (project 30, like the coding loop), or
   a plain `docs/experiments-log.md` + chat? Reuse existing infra ideally.
3. **Studio/Beta instrumentation** now, or focus purely on the aero purchase
   funnel first? (Recommend: funnel first.)
4. **Surveys on day one** (e.g. exit-intent "what stopped you?") or after the
   first data week? (Recommend: after, once we see where they drop.)

---

## 11. Implementation status (2026-07-30)

**Shipped.** Phase 1 minus the PostHog half.

- **Consent gate is real.** `src/cookie.ts` now dispatches `prisma-consent` on
  choice (§3.1), so accepting boots analytics on *that* page instead of the next
  navigation. `src/analytics.ts` boots on `getConsent() === "all"` at load and on
  that event. Verified in the build output: the provider SDKs compile to their
  own lazy chunks, so a visitor on "necessary only" never downloads them — not
  just no events, no bytes.
- **`track(event, props)` is provider-agnostic.** Call sites name the event; the
  module decides the destination. Vercel Web Analytics custom events are wired
  today; adding PostHog is a change to one file, not to any call site. Events
  fired before the SDK finishes loading are queued (capped at 50) and replayed.
- **Vercel Web Analytics + Speed Insights** (`@vercel/analytics`,
  `@vercel/speed-insights`) — injected via `inject()` / `injectSpeedInsights()`,
  not the React components in Vercel's Next.js-flavoured setup guide. Gated on
  `import.meta.env.PROD` so preview deploys don't pollute the baseline. **Still
  needs enabling in the Vercel dashboard** (Project → Analytics → Enable).
- **Instrumented** per §4: `cta_click`, `configurator_viewed`,
  `config_option_selected`, `config_total_changed` (debounced 600 ms),
  `config_discount_applied` (hashed code, never raw), `config_build_complete`,
  `reserve_cta_click`, `reserve_form_start`, `reserve_submit`,
  `pickup_town_search`, `pickup_notify_click`.
- **Beyond the original §4** — checkout didn't exist when this plan was written,
  and it is now the actual end of the funnel: `checkout_viewed` and
  `checkout_payment_started`. `checkout.html` has no cookie banner of its own
  (it isn't a normal entry point), so analytics there runs only on consent given
  upstream.
- **No PII.** `reserve_submit` sends the email *domain* only; the discount code
  is sent as a hash; no raw address, name or code leaves the browser.

**Not done, and why.**

- **PostHog (§2, §5).** Phase 0 is still open — the only project on the
  connected MCP is `AirLuxo`, which is a different product, and the MCP cannot
  create projects. Needs a PostHog EU project for Prisma + `VITE_POSTHOG_KEY` in
  Vercel. Session replay, funnels, flags, experiments and surveys — and so the
  §6 autonomous loop — all wait on that.
- **Reverse proxy (§5 / §10.1).** Deliberately not added to `vercel.json`: the
  two rewrites only exist to serve PostHog, so shipping them now would be dead
  config. Add them together with the PostHog key.
- **Studio/Beta events (§4.5)** — skipped for now, per §10.3's own
  recommendation to do the purchase funnel first.
- **Surveys** — per §10.4, after the first data week.

**Next:** create the PostHog project, then the §5 wiring is roughly an hour —
the call sites already exist.
