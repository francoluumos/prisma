// Vercel Edge Middleware — HTTP Basic Auth gate for the internal partner
// network tool. Runs on Vercel's edge (not in local `vite preview`).
// Protects BOTH the page and its data file, so the shop names are never
// served without the password. Credentials come from the Vercel project env
// (SITE_USER / SITE_PASSWORD); the defaults are only a fallback if those are
// unset. NOTE: env-var changes only take effect on the NEXT deployment.
export const config = {
  matcher: ["/network", "/network.html", "/network-data.json"],
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
    headers: { "WWW-Authenticate": 'Basic realm="Prisma Partner Network"' },
  });
}
