-- =============================================================================
-- Vin.ID — Phase 2F: reminders — urgency column + extra reminder types
-- =============================================================================
-- The Phase 2A base schema covered most reminder fields (title, description,
-- reminder_type, due_date, due_mileage, status, completed_at, deleted_at) but
-- had no `urgency` column and a narrower reminder_type set. Phase 2F adds:
--
--   * `urgency` (green | orange | red, default green) — a user-set base level;
--     the UI also derives an *effective* urgency from due_date/due_mileage.
--   * `reminder_type` widened to include 'tires' and 'battery'.
--
-- Status is left as-is (pending | completed | dismissed); the app treats
-- 'pending' as the "active" state. `deleted_at` already exists (soft delete).
--
-- Safe to run on the existing database: reminders has no rows yet.
-- =============================================================================

alter table public.reminders
  add column if not exists urgency text not null default 'green'
    check (urgency in ('green', 'orange', 'red'));

alter table public.reminders
  drop constraint if exists reminders_reminder_type_check;

alter table public.reminders
  add constraint reminders_reminder_type_check
  check (
    reminder_type in (
      'service',
      'inspection',
      'insurance',
      'registration',
      'tires',
      'battery',
      'custom'
    )
  );
