// Vercel Edge Middleware — HTTP Basic Auth gate for the WHOLE site.
// Runs on Vercel's edge (not in local `vite dev`/`preview`). Every route —
// pages, assets, and the internal /network data — is behind the password, so
// the public storefront stays private while the site is in build.
//
// Credentials come from the Vercel project env (SITE_USER / SITE_PASSWORD);
// the defaults are only a fallback if those are unset.
// NOTE: env-var changes only take effect on the NEXT deployment.
//
// To take the site public again: delete this file (or narrow `matcher` back to
// just ["/network", "/network.html", "/network-data.json"]).
export const config = {
  // Match every path except Vercel's internal endpoints (speed-insights, etc.).
  matcher: ["/((?!_vercel).*)"],
};

export default function middleware(request: Request): Response | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const user = env?.SITE_USER || "prisma";
  const pass = env?.SITE_PASSWORD || "prisma-network-2026";
  const expected = "Basic " + btoa(`${user}:${pass}`);
  if (request.headers.get("authorization") === expected) return undefined;
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prisma (private)"' },
  });
}
