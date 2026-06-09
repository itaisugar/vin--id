-- =============================================================================
-- Vin.ID — app_events privacy audit (manual, run in the Supabase SQL Editor)
-- =============================================================================
-- These queries help spot mistakes where sensitive content might have leaked
-- into app_events.metadata. They are NOT a migration — run them by hand while
-- reviewing the beta. Every query below should return ZERO rows. Any result is
-- a red flag to investigate (and likely a bug in a trackEvent(...) call).
--
-- What must NEVER appear in metadata: VIN, license plate, storage paths, raw
-- tokens / token hashes, issue symptoms, diagnosis text, email, phone, address,
-- file names. metadata should only hold counts, booleans, and short enums.
-- =============================================================================

-- 1) Forbidden METADATA KEYS ---------------------------------------------------
-- Any object key whose name looks sensitive.
select id, created_at, event_name, metadata
from public.app_events
where exists (
  select 1
  from jsonb_object_keys(metadata) as k(key)
  where lower(k.key) ~
    '(vin|license_plate|plate|storage_path|token_hash|token|symptom|diagnos|email|phone|address|file_name|filename)'
)
order by created_at desc;

-- 2) Forbidden METADATA VALUES (string match across the whole payload) ---------
-- Catches sensitive substrings and anything that looks like an email/path/token.
select id, created_at, event_name, metadata
from public.app_events
where metadata::text ~*
  '(license_plate|storage_path|token_hash|symptom|diagnosis|vehicle-documents|@|/[a-f0-9-]{20,})'
order by created_at desc;

-- 3) Oversized metadata (payloads should be small) -----------------------------
-- Long strings suggest free-text leaked in; the helper truncates to ~64 chars.
select id, created_at, event_name, length(metadata::text) as meta_len, metadata
from public.app_events
where length(metadata::text) > 300
order by meta_len desc;

-- 4) Distinct keys actually in use (eyeball the whole allow-list at a glance) ---
-- Expected keys only: trust_label, severity, status, file_type, doc_type,
-- reminder_type, urgency, included_scopes_count, include_personal_docs,
-- mock_mode, language, type, source.
select distinct key
from public.app_events, jsonb_object_keys(metadata) as key
order by 1;

-- 5) Distinct event names (confirm only the known allow-list is being logged) --
select event_name, count(*) as n
from public.app_events
group by 1
order by n desc;
