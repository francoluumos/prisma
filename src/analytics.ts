/* ----------------------------------------------------------------
   Analytics — consent-gated bootstrap + a thin `track()` seam.

   Implements Phase 1 of docs/analytics-plan.md. Two rules shape this file:

   1. **Nothing loads without consent.** A visitor on "necessary only" (or who
      hasn't chosen yet) gets zero analytics: no script fetched, no cookie, no
      event. If they later click "Accept all", `cookie.ts` fires the
      `prisma-consent` event and we boot mid-session.
   2. **`track()` is provider-agnostic.** Call sites name the event; this module
      decides where it goes. Vercel Web Analytics is wired today; a product-
      analytics provider drops in behind the same seam without touching a single
      call site.

   Everything no-ops off-consent, in dev, and if a provider fails to load — an
   analytics failure must never break the page.
   ---------------------------------------------------------------- */

import { getConsent } from "./cookie";

type Props = Record<string, string | number | boolean | null>;

let booted = false;
/** Events fired before the provider finished loading, replayed on boot. */
const queue: Array<{ event: string; props?: Props }> = [];
let vercelTrack: ((event: string, props?: Props) => void) | null = null;
let posthogCapture: ((event: string, props?: Props) => void) | null = null;

const consented = () => getConsent() === "all";

/** Send one event. Silently drops it when consent is absent. */
export function track(event: string, props?: Props): void {
  if (!consented()) return;
  if (!booted) {
    // Bounded — a page that fires hundreds of events pre-boot is a bug, and we
    // would rather lose the tail than grow without limit.
    if (queue.length < 50) queue.push({ event, props });
    return;
  }
  try {
    vercelTrack?.(event, props);
    posthogCapture?.(event, props);
  } catch {
    /* never let analytics break the page */
  }
}

/** PostHog — product analytics, session replay, flags, experiments.
 *
 *  Stays entirely absent until VITE_POSTHOG_KEY is set, so the site behaves
 *  identically with or without it. Requests go to the first-party `/ingest`
 *  proxy (see vercel.json) rather than eu.i.posthog.com directly, which stops
 *  ad-blockers from silently eating a chunk of the data. */
async function bootPostHog(): Promise<void> {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;

  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "/ingest",
    ui_host: "https://eu.posthog.com",
    // We never identify visitors, so profiles for everyone would be pure cost.
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_performance: { web_vitals: true },
    session_recording: {
      // Replay is for seeing WHERE people struggle, never WHAT they typed —
      // this page collects emails, addresses and discount codes.
      maskAllInputs: true,
      maskTextSelector: "*",
    },
  });
  posthogCapture = (event, props) => posthog.capture(event, props ?? undefined);
}

/** Load the providers. Idempotent; safe to call from every page entry point. */
export function initAnalytics(): void {
  if (booted || !consented()) return;
  booted = true;

  // Preview/dev traffic would pollute the baseline, and there is no Vercel
  // Analytics endpoint outside a deployment anyway.
  if (!import.meta.env.PROD) return;

  void (async () => {
    try {
      const [{ inject, track: vt }, { injectSpeedInsights }] = await Promise.all([
        import("@vercel/analytics"),
        import("@vercel/speed-insights"),
      ]);
      inject();               // page views + custom events
      injectSpeedInsights();  // real-user Web Vitals per deploy
      vercelTrack = vt as (event: string, props?: Props) => void;

      await bootPostHog();

      for (const q of queue) {
        try {
          vercelTrack(q.event, q.props);
        } catch {
          /* ignore a single bad event */
        }
      }
      queue.length = 0;
    } catch {
      // Blocked by an extension, offline, CDN hiccup — the site carries on.
      booted = false;
    }
  })();
}

/** Wire consent → analytics. Boots now if already consented, and listens for a
 *  later "Accept all" so the same page starts reporting without a reload. */
export function initAnalyticsWithConsent(): void {
  initAnalytics();
  window.addEventListener("prisma-consent", (e) => {
    if ((e as CustomEvent<string>).detail === "all") initAnalytics();
  });
}
