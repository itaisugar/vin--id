-- =============================================================================
-- Vin.ID — Phase 3A: vehicle_passports — ai_summary + server_signature
-- =============================================================================
-- The Phase 2A base schema covered the core passport columns (snapshot,
-- snapshot_hash, record_confidence_score, status, version, public_id, expiry/
-- revoke fields). Phase 3A adds:
--
--   * `ai_summary` jsonb — a DETERMINISTIC summary (strengths / attention /
--     recommended checks / missing-or-not-shared) generated without any AI.
--     Stored here so the future real-AI summary slots into the same column.
--   * `server_signature` text (nullable placeholder) — reserved for a future
--     server-side signature over the snapshot hash. Not populated yet and
--     intentionally NOT part of the hashed snapshot.
--
-- Safe to run on the existing database (additive, IF NOT EXISTS).
-- =============================================================================

alter table public.vehicle_passports
  add column if not exists ai_summary jsonb not null default '{}'::jsonb;

alter table public.vehicle_passports
  add column if not exists server_signature text;
