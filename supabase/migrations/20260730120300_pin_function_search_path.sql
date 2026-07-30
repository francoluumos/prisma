-- Pin search_path on the private helpers (Supabase linter 0011). They already
-- schema-qualify everything they touch; this makes that guarantee explicit and
-- immune to a caller's search_path.
alter function private.touch_write_date() set search_path = '';
alter function private.ensure_xmlid(text, bigint, text) set search_path = '';
alter function private.ensure_address(bigint, text, jsonb) set search_path = '';

-- public.ir_model_data stays RLS-on with no policies on purpose: external IDs
-- are internal plumbing, reachable only through the service role. The linter
-- reports that as INFO 0008; it is the intended state, not an oversight.
