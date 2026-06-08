-- =============================================================================
-- Vin.ID — Phase 2B fix: grant table privileges to the authenticated role
-- =============================================================================
-- Symptom: Postgres error 42501 ("permission denied for table ...") when the
-- app reads/writes vehicles as a logged-in user.
--
-- Cause: RLS (enabled in 20260607120000) controls WHICH ROWS a role can see,
-- but it does not GRANT access to the table itself. Supabase normally
-- auto-grants privileges to the `authenticated`/`anon` roles via default
-- privileges, but that did not apply to these tables — so every query is
-- denied before RLS is even evaluated.
--
-- This migration grants table privileges to `authenticated` only (every app
-- query happens as a logged-in user). RLS still restricts each user to their
-- own rows, so this does NOT widen data access. `anon` is intentionally left
-- without access; the future public passport preview will use the service role.
--
-- Idempotent and safe to run on the existing database.
-- =============================================================================

-- Allow the role to "enter" the schema.
grant usage on schema public to authenticated;

-- Allow row operations on all existing tables (RLS still gates the rows).
grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

-- Apply the same grants automatically to any tables created later (by the
-- role running this migration, i.e. postgres in the SQL Editor).
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
