/* ----------------------------------------------------------------
   Prisma assistant — Supabase Edge Function (Deno).

   One task-routed endpoint that proxies Google Gemini with the API key held
   server-side:
     • task "fit"     — streaming chat that recommends a size + components from
                        rider measurements; ends with a forced recommendBuild
                        tool call relayed as a `recommendation` SSE event.
     • task "palette" — vision: extract a colourway from inspiration image(s)
                        and return a concrete frame/wheel/finish suggestion.

   Deploy:  supabase functions deploy assistant --no-verify-jwt
   Secret:  supabase secrets set GEMINI_API_KEY=...   (optionally ALLOWED_ORIGINS)
   ---------------------------------------------------------------- */
import { corsHeaders, originAllowed } from "../_shared/cors.ts";
import { checkLimit, DEFAULT_LIMITS } from "../_shared/ratelimit.ts";
import { streamGenerate, generate } from "../_shared/gemini.ts";
import { buildFitConfig, buildPaletteConfig } from "../_shared/prompt.ts";
import { PRODUCTS, nearestColour, type ProductId } from "../_shared/products.ts";

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 14 * 1024 * 1024;

const enc = new TextEncoder();
function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0] || req.headers.get("x-real-ip") || "0.0.0.0").trim();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!originAllowed(origin)) return json({ error: "Origin not allowed" }, 403, cors);

  // Require the Supabase anon key so anonymous callers can't hammer the LLM.
  if (!req.headers.get("apikey") && !req.headers.get("authorization")) {
    return json({ error: "Missing apikey" }, 401, cors);
  }

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413, cors);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  const task = payload.task;
  const productId = (payload.product as ProductId) || "aero";
  if (!PRODUCTS[productId]) return json({ error: "Unknown product" }, 400, cors);
  if (task !== "fit" && task !== "palette") return json({ error: "Unknown task" }, 400, cors);

  // Rate limit per IP + task.
  const limit = await checkLimit(clientIp(req), task, DEFAULT_LIMITS[task]);
  if (!limit.ok) {
    return new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429,
      headers: { ...cors, "content-type": "application/json", "Retry-After": String(limit.retryAfter) },
    });
  }

  try {
    if (task === "fit") return await handleFit(payload, productId, cors);
    return await handlePalette(payload, productId, cors);
  } catch (err) {
    console.error("[assistant]", err);
    return json({ error: "Assistant unavailable" }, 502, cors);
  }
});

/* ------------------------------- fit ------------------------------ */
async function handleFit(
  payload: Record<string, unknown>,
  productId: ProductId,
  cors: Record<string, string>
): Promise<Response> {
  const rider = (payload.rider ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length > 30) return json({ error: "Too many messages" }, 413, cors);

  const riderLine =
    "Rider profile: " +
    JSON.stringify({
      heightCm: rider.heightCm ?? null,
      inseamCm: rider.inseamCm ?? null,
      level: rider.level ?? null,
      style: rider.style ?? null,
      reachPref: rider.reachPref ?? null,
    });

  const contents = [
    { role: "user", parts: [{ text: riderLine }] },
    ...messages.map((m: { role?: string; content?: string }) => ({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: String(m.content ?? "") }],
    })),
  ];

  const cfg = buildFitConfig(productId);
  const upstream = await streamGenerate({
    contents,
    ...cfg,
    generationConfig: { maxOutputTokens: 700, temperature: 0.6 },
  });

  if (!upstream.ok || !upstream.body) {
    return json({ error: "Upstream error" }, 502, cors);
  }

  // Transform Gemini SSE → our SSE (text deltas, one recommendation, done).
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(sse("done", {}));
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const parts = chunk?.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text === "string" && part.text) {
              controller.enqueue(sse("text", { delta: part.text }));
            }
            if (part.functionCall?.name === "recommendBuild") {
              controller.enqueue(sse("recommendation", part.functionCall.args ?? {}));
            }
          }
        } catch {
          /* ignore partial/non-JSON keepalive lines */
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/* ----------------------------- palette ---------------------------- */
async function handlePalette(
  payload: Record<string, unknown>,
  productId: ProductId,
  cors: Record<string, string>
): Promise<Response> {
  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return json({ error: "No images" }, 400, cors);
  if (images.length > MAX_IMAGES) return json({ error: "Too many images" }, 413, cors);

  const parts: Array<Record<string, unknown>> = [];
  const note = typeof payload.note === "string" ? payload.note.slice(0, 500) : "";
  if (note) parts.push({ text: `Inspiration note: ${note}` });

  for (const img of images as Array<{ mimeType?: string; dataBase64?: string }>) {
    const data = img.dataBase64 ?? "";
    if (!img.mimeType || !data) return json({ error: "Bad image" }, 400, cors);
    // base64 is ~4/3 of the byte size
    if (data.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413, cors);
    parts.push({ inlineData: { mimeType: img.mimeType, data } });
  }

  const cfg = buildPaletteConfig(productId);
  const result = await generate({
    contents: [{ role: "user", parts }],
    ...cfg,
  });

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "Bad model output" }, 502, cors);
  }

  // Compute the nearest catalog preset server-side (authoritative).
  const suggested = (parsed.suggested ?? {}) as Record<string, unknown>;
  const frameHex = typeof suggested.frameHex === "string" ? suggested.frameHex : "#a3b0bb";
  const nearest = nearestColour(PRODUCTS[productId], frameHex);
  (parsed.suggested as Record<string, unknown>) = { ...suggested, nearestPreset: nearest.name };

  return json(parsed, 200, cors);
}
