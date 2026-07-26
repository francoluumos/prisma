/* Prompt + schema builders — inject the catalog so the model can only return
   choices that map 1:1 onto the configurator. */
import { PRODUCTS, type ProductId } from "./products.ts";

/** Compact catalog JSON for the system instruction. */
function catalogContext(productId: ProductId): string {
  const p = PRODUCTS[productId];
  return JSON.stringify({
    product: p.name,
    category: p.category,
    sizes: p.sizes.map((s) => ({
      label: s.label,
      heightCm: s.heightCm,
      inseamCm: s.inseamCm,
      reach: s.geometry.reach,
      stack: s.geometry.stack,
    })),
    colours: p.colours.map((c) => ({ name: c.name, finish: c.finish ?? "metallic" })),
    drivetrains: p.drivetrains.map((d) => ({ name: d.name, price: d.price, meta: d.meta })),
    pedals: p.pedals.map((d) => ({ name: d.name, price: d.price })),
    fees: p.fees,
    betweenSizesRule: p.betweenSizesRule,
  });
}

const FIT_RULES = `You are the Prisma fit assistant. You help a rider choose a frame SIZE and
components for the bike described in the catalog below. Reason over the rider's height, inseam,
riding level and style. Rules:
- Height is the starting point; refine with inseam (standover) and reach/stack for position.
- If the rider falls between two sizes, apply the product's betweenSizesRule.
- Match the drivetrain tier to level/budget: beginners/endurance → mechanical or 105-class;
  advanced/racing → Di2/Ultegra/Dura-Ace. Never invent components not in the catalog.
- Be concise, warm and precise — a few sentences, no hard sell. Ask at most one clarifying
  question only if height is missing.
- When you have enough to decide, you MUST call recommendBuild exactly once with catalog values.
CATALOG: `;

const PALETTE_RULES = `You extract a cohesive bike colourway from inspiration image(s) and an optional note.
Return 3–5 dominant/accent colours as hex, then a concrete suggestion: a frame colour, a wheel
colour, and a finish (matte|metallic|pearl). Prefer tasteful, buildable combinations that suit a
premium carbon road bike; avoid muddy or clashing pairings. CATALOG (for the nearest preset): `;

/** Config for the streaming `fit` task: system instruction + forced tool call. */
export function buildFitConfig(productId: ProductId) {
  const p = PRODUCTS[productId];
  const enumOr = (vals: string[]) => vals; // Gemini enum = array of strings
  return {
    systemInstruction: { parts: [{ text: FIT_RULES + catalogContext(productId) }] },
    tools: [
      {
        functionDeclarations: [
          {
            name: "recommendBuild",
            description: "Return the recommended build using only catalog values.",
            parameters: {
              type: "object",
              properties: {
                size: { type: "string", enum: enumOr(p.sizes.map((s) => s.label)) },
                alternativeSize: { type: "string", enum: enumOr(["", ...p.sizes.map((s) => s.label)]) },
                drivetrain: { type: "string", enum: enumOr(p.drivetrains.map((d) => d.name)) },
                pedals: {
                  type: "string",
                  enum: enumOr(p.pedals.length ? p.pedals.map((d) => d.name) : ["No pedals"]),
                },
                colour: { type: "string", enum: enumOr(p.colours.map((c) => c.name)) },
                confidence: { type: "number", description: "0–1" },
                rationale: { type: "string" },
              },
              required: ["size", "drivetrain", "colour", "confidence", "rationale"],
            },
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["recommendBuild"] } },
  };
}

/** Config for the non-streaming `palette` task: structured JSON output. */
export function buildPaletteConfig(productId: ProductId) {
  return {
    systemInstruction: { parts: [{ text: PALETTE_RULES + catalogContext(productId) }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          palette: {
            type: "array",
            items: {
              type: "object",
              properties: {
                hex: { type: "string" },
                name: { type: "string" },
                role: { type: "string", enum: ["frame", "wheels", "accent"] },
              },
              required: ["hex", "name", "role"],
            },
          },
          suggested: {
            type: "object",
            properties: {
              frameHex: { type: "string" },
              wheelsHex: { type: "string" },
              finish: { type: "string", enum: ["matte", "metallic", "pearl"] },
              pattern: { type: "string", enum: ["none", "from-image"] },
            },
            required: ["frameHex", "wheelsHex", "finish", "pattern"],
          },
        },
        required: ["reply", "palette", "suggested"],
      },
    },
  };
}
