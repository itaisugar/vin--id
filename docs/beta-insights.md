# Vin.ID — Beta Insights & Health Checks

How to read MVP usage during the beta **without** an admin dashboard and
**without** any third-party analytics. Everything here is inspected manually in
the **Supabase SQL Editor / Table Editor** by the project owner. No analytics
provider (Google Analytics, Mixpanel, PostHog, …) is used anywhere.

Background: events are written to `public.app_events` (see
[event-tracking.md](event-tracking.md)). This doc adds **aggregate-only** SQL
views and audit queries on top of that table.

## What is tracked

First-party product events only (see the full table in
[event-tracking.md](event-tracking.md)):

`user_signed_up`, `vehicle_created`, `maintenance_created`, `issue_created`,
`document_uploaded`, `reminder_created`, `passport_created`,
`passport_public_preview_opened`, `passport_accepted`,
`mock_diagnosis_completed`, `mock_diagnosis_saved_as_issue`,
`mock_document_extraction_started`, `mock_document_extraction_confirmed`,
`beta_feedback_submitted`.

Metadata is small and non-sensitive: counts, booleans, and short enums
(e.g. `included_scopes_count`, `severity`, `urgency`, `file_type` = pdf/image,
`doc_type`, `mock_mode`, `language`, feedback `type`).

## What is intentionally NOT tracked

Never stored in events: document contents, issue symptoms, diagnosis text, VIN,
license plate, storage paths, raw Passport tokens, token hashes, email, phone,
address, payment details, or filenames. The user agent is **not** in events (it
lives only in `beta_feedback`).

## The views (owner/manual inspection only)

Migration `supabase/migrations/20260608040000_beta_insight_views.sql` creates
four **aggregate-only** views. They use `security_invoker = true` and SELECT is
revoked from `anon` + `authenticated`, so they are **not** exposed in the app or
the API — only the Supabase owner reads them in the SQL Editor.

| view | shape |
| --- | --- |
| `beta_event_counts_daily` | `event_date, event_name, event_count` |
| `beta_core_funnel_daily` | per-day columns: `vehicles_created, documents_uploaded, passports_created, public_previews_opened, passports_accepted, feedback_submitted` |
| `beta_passport_funnel_summary` | totals: `passports_created, public_previews_opened, passports_accepted, acceptance_rate` |
| `beta_mock_ai_usage_summary` | totals for the four mock-AI events |

### View event counts

```sql
-- All-time counts per event
select event_name, sum(event_count) as total
from public.beta_event_counts_daily
group by 1 order by total desc;

-- Last 14 days, per day
select * from public.beta_event_counts_daily
where event_date >= current_date - interval '14 days'
order by event_date desc, event_count desc;
```

### Inspect the core funnel

The core loop is:

```
vehicle_created
  → document_uploaded
    → passport_created
      → passport_public_preview_opened
        → passport_accepted
```

```sql
-- Daily funnel
select * from public.beta_core_funnel_daily order by event_date desc;

-- Passport funnel totals + acceptance rate
select * from public.beta_passport_funnel_summary;

-- Mock-AI usage
select * from public.beta_mock_ai_usage_summary;
```

## Privacy audit queries

Run `supabase/audits/app_events_privacy_audit.sql` in the SQL Editor (see that
file for the full set). Each detection query should return **zero rows**:

```sql
-- Forbidden metadata keys (should return 0 rows)
select id, created_at, event_name, metadata
from public.app_events
where exists (
  select 1 from jsonb_object_keys(metadata) as k(key)
  where lower(k.key) ~
    '(vin|license_plate|plate|storage_path|token_hash|token|symptom|diagnos|email|phone|address|file_name|filename)'
);

-- Forbidden metadata values (should return 0 rows)
select id, created_at, event_name, metadata
from public.app_events
where metadata::text ~* '(license_plate|storage_path|token_hash|symptom|diagnosis|@)';
```

If any row comes back, a `trackEvent(...)` call is passing something it
shouldn't — fix the call site and delete the offending rows.

## Interpreting low conversion

- **Many `vehicle_created`, few `passport_created`** → users build history but
  don't reach sharing. Look at onboarding / the "create Passport" entry points.
- **Many `passport_created`, few `passport_public_preview_opened`** → sellers
  create but don't share the link, or buyers don't open it. Revisit the share
  UX / copy.
- **Many previews, few `passport_accepted`** → buyers hesitate at accept. Check
  the buyer guidance and accept CTA (sign-in friction, trust).
- **Low `acceptance_rate`** in `beta_passport_funnel_summary` = accepted /
  created. Early on this is naturally low (small N) — treat as directional, not
  statistically meaningful.

Counts are small in beta; read them as **direction**, not precision.

## Known limitations

- Counts are **event totals**, not unique users (no per-user dedupe view yet).
- `passport_public_preview_opened` counts every open (incl. refreshes), so the
  preview number can exceed unique viewers.
- No date-cohort / retention views.
- `anonymous_id` is unused, so anonymous funnels can't be stitched per visitor.
- Views are manual-inspection only; there is no in-app dashboard (by design).

## Reminder

No external analytics providers are used. All insight is first-party data in
your own Supabase project, read manually by the owner.
