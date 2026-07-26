/* CORS — origin allowlist + preflight for the assistant function. */

// Allowed browser origins. Set ALLOWED_ORIGINS (comma-separated) in the
// function's env to add the production domain(s); localhost is always allowed
// for dev.
const DEFAULTS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://prismacycling.ch",
  "https://www.prismacycling.ch",
];

function allowList(): string[] {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULTS, ...extra])];
}

/** Headers to attach to every response, echoing the origin when allowed. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && allowList().includes(origin);
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  };
  if (allowed) h["Access-Control-Allow-Origin"] = origin!;
  return h;
}

/** True if the request origin is on the allowlist. */
export function originAllowed(origin: string | null): boolean {
  return !!origin && allowList().includes(origin);
}
