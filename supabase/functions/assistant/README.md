# Prisma assistant — Supabase Edge Function

Proxies Google Gemini with the API key held server-side. One endpoint, two tasks:

- **`fit`** — streaming (SSE) chat that recommends a frame size + components from
  rider measurements. Ends with a forced `recommendBuild` tool call, relayed as a
  `recommendation` event whose fields map 1:1 onto the configurator.
- **`palette`** — vision: extract a colourway from inspiration image(s); returns a
  palette plus a concrete `{ frameHex, wheelsHex, finish, pattern, nearestPreset }`.

## Deploy

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set GEMINI_API_KEY=<key>
# optional: extra browser origins (comma-separated), and model override
supabase secrets set ALLOWED_ORIGINS="https://prismacycling.ch,https://www.prismacycling.ch"
supabase functions deploy assistant --no-verify-jwt
```

The endpoint is then `https://<ref>.supabase.co/functions/v1/assistant`.

## Frontend env

Set in Vercel and in a local `.env.local` (see `.env.example`):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Env / secrets

| Name | Where | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | function secret | Google Gemini key (required) |
| `GEMINI_MODEL` | function secret | default `gemini-2.5-flash` |
| `GEMINI_BASE_URL` | function secret | override for CI mock (no real spend) |
| `ALLOWED_ORIGINS` | function secret | extra CORS origins beyond localhost + prismacycling.ch |

## Local dev + smoke test

```bash
supabase functions serve assistant --env-file supabase/.env.local
```

Fit (streaming):

```bash
curl -N http://localhost:54321/functions/v1/assistant \
  -H "content-type: application/json" -H "apikey: $ANON" -H "origin: http://localhost:5173" \
  -d '{"task":"fit","product":"aero","rider":{"heightCm":176,"inseamCm":81,"level":"intermediate","style":"endurance"},"messages":[{"role":"user","content":"aggressive but comfy"}]}'
```

Palette (vision):

```bash
curl http://localhost:54321/functions/v1/assistant \
  -H "content-type: application/json" -H "apikey: $ANON" -H "origin: http://localhost:5173" \
  -d '{"task":"palette","product":"aero","note":"coastal morning","images":[{"mimeType":"image/jpeg","dataBase64":"<...>"}]}'
```

Expected gates: 401 without `apikey`, 403 for a non-allowlisted `origin`, 429 after the
rate-limit bucket drains, 413 on oversized images. Point `GEMINI_BASE_URL` at a mock in CI
so tests never spend real quota.
