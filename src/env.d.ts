/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key — safe in the browser. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** PostHog project API key (`phc_…`). Analytics stays off entirely if unset. */
  readonly VITE_POSTHOG_KEY?: string;
  /** Override the ingestion host. Defaults to the /ingest reverse proxy. */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
