/* ----------------------------------------------------------------
   Assistant client — talks to the Supabase Edge Function.

   `askFit` streams SSE (text deltas + one recommendation). `readPalette` posts
   base64 image(s) and returns a structured colourway. Both are no-ops unless the
   Supabase env vars are set, so the page works before the backend is wired.
   ---------------------------------------------------------------- */
const BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function assistantConfigured(): boolean {
  return !!(BASE && ANON);
}
const endpoint = () => `${BASE}/functions/v1/assistant`;
const headers = () => ({
  "content-type": "application/json",
  apikey: ANON as string,
  authorization: `Bearer ${ANON}`,
});

export interface Rider {
  heightCm?: number;
  inseamCm?: number;
  level?: string;
  style?: string;
  reachPref?: string;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface Recommendation {
  size: string;
  alternativeSize?: string;
  drivetrain: string;
  pedals?: string;
  colour: string;
  confidence: number;
  rationale: string;
}
export interface PaletteSwatch {
  hex: string;
  name: string;
  role: "frame" | "wheels" | "accent";
}
export interface PaletteResult {
  reply: string;
  palette: PaletteSwatch[];
  suggested: {
    frameHex: string;
    wheelsHex: string;
    finish: "matte" | "metallic" | "pearl";
    pattern: "none" | "from-image";
    nearestPreset?: string;
  };
}

interface FitReq {
  product?: string;
  rider: Rider;
  messages: ChatMessage[];
}
interface FitHandlers {
  onText: (delta: string) => void;
  onRecommendation: (rec: Recommendation) => void;
  signal?: AbortSignal;
}

/** Stream a fit conversation. Resolves when the stream ends. */
export async function askFit(req: FitReq, h: FitHandlers): Promise<void> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ task: "fit", product: "aero", ...req }),
    signal: h.signal,
  });
  if (res.status === 429) throw new Error("The assistant is busy — try again in a moment.");
  if (!res.ok || !res.body) throw new Error(`Assistant error (${res.status}).`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const block of events) {
      const evMatch = /event:\s*(.+)/.exec(block);
      const dataMatch = /data:\s*([\s\S]+)/.exec(block);
      if (!evMatch || !dataMatch) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataMatch[1].trim());
      } catch {
        continue;
      }
      if (evMatch[1].trim() === "text") h.onText((data as { delta: string }).delta ?? "");
      else if (evMatch[1].trim() === "recommendation") h.onRecommendation(data as Recommendation);
    }
  }
}

/** Extract a colourway from inspiration image(s). */
export async function readPalette(files: File[], note?: string): Promise<PaletteResult> {
  const images = await Promise.all(
    files.slice(0, 3).map(async (f) => ({ mimeType: f.type, dataBase64: await toBase64(f) }))
  );
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ task: "palette", product: "aero", note, images }),
  });
  if (res.status === 429) throw new Error("The assistant is busy — try again in a moment.");
  if (!res.ok) throw new Error(`Assistant error (${res.status}).`);
  return (await res.json()) as PaletteResult;
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
