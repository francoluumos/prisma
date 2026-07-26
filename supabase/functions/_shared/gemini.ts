/* Gemini REST wrapper — holds GEMINI_API_KEY server-side.

   GEMINI_BASE_URL and GEMINI_MODEL are overridable (CI points BASE_URL at a
   mock so tests never spend real quota). Two entry points: a streaming call
   (SSE pass-through, used by `fit`) and a JSON call (used by `palette`). */

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

function cfg() {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return {
    key,
    base: Deno.env.get("GEMINI_BASE_URL") ?? DEFAULT_BASE,
    model: Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL,
  };
}

// deno-lint-ignore no-explicit-any
export type GeminiBody = Record<string, any>;

/** Streaming generateContent — returns the raw SSE Response to relay onward. */
export async function streamGenerate(body: GeminiBody): Promise<Response> {
  const { key, base, model } = cfg();
  return await fetch(`${base}/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Non-streaming generateContent — returns the parsed JSON payload. */
export async function generate(body: GeminiBody): Promise<GeminiBody> {
  const { key, base, model } = cfg();
  const res = await fetch(`${base}/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}
