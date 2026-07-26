/* Rate limiting — per-IP token bucket backed by Deno KV.

   Two windows per hashed IP: a burst (per-minute) and a daily cap. Cheap,
   stateless-ish, and good enough to blunt abuse of the LLM/vision calls. If KV
   is unavailable the limiter fails open (allows the request) rather than taking
   the function down. */

const MINUTE = 60_000;
const DAY = 24 * 60 * 60_000;

export interface Limits {
  perMinute: number;
  perDay: number;
}

export const DEFAULT_LIMITS: Record<string, Limits> = {
  fit: { perMinute: 20, perDay: 300 },
  palette: { perMinute: 6, perDay: 60 },
};

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "::prisma-assistant");
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/** Returns { ok, retryAfter } — retryAfter is seconds until the next allowance. */
export async function checkLimit(
  ip: string,
  task: string,
  limits: Limits
): Promise<{ ok: boolean; retryAfter: number }> {
  let kv: Deno.Kv;
  try {
    kv = await Deno.openKv();
  } catch {
    return { ok: true, retryAfter: 0 }; // fail open
  }
  const id = await hashIp(ip);
  const now = Date.now();

  const roll = async (window: number, limit: number, tag: string) => {
    const key = ["rl", task, tag, id];
    const cur = (await kv.get<{ count: number; reset: number }>(key)).value;
    if (!cur || cur.reset <= now) {
      await kv.set(key, { count: 1, reset: now + window }, { expireIn: window });
      return { ok: true, retryAfter: 0 };
    }
    if (cur.count >= limit) {
      return { ok: false, retryAfter: Math.ceil((cur.reset - now) / 1000) };
    }
    await kv.set(key, { count: cur.count + 1, reset: cur.reset }, { expireIn: cur.reset - now });
    return { ok: true, retryAfter: 0 };
  };

  const minute = await roll(MINUTE, limits.perMinute, "m");
  if (!minute.ok) return minute;
  const day = await roll(DAY, limits.perDay, "d");
  return day;
}
