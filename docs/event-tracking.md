# Vin.ID — Privacy-Safe Beta Event Tracking

Vin.ID logs **minimal, first-party product events** during the beta so we can
understand whether users complete the core loop (add a vehicle → build history →
create a Passport → share → accept). This is **not third-party analytics** — no
Google Analytics, Mixpanel, PostHog, or external SDK. Events are rows in our own
Supabase `app_events` table, inspected in the Supabase Table Editor.

## What is stored

Table `public.app_events` (migration
`supabase/migrations/20260608030000_app_events.sql`):

| column | notes |
| --- | --- |
| `id` | uuid pk |
| `user_id` | nullable, FK `auth.users` (null for anonymous preview opens) |
| `anonymous_id` | nullable text (reserved; not populated yet) |
| `event_name` | the event (see list below) |
| `entity_type` / `entity_id` | coarse type + id of the related row |
| `vehicle_id` / `passport_id` | optional ids for funnel grouping |
| `metadata` | small jsonb: counts, booleans, enums, short source labels |
| `created_at` | timestamptz |

## Privacy rules (enforced)

We **never** store, in events: document contents, issue symptoms, diagnosis
text, VIN, license plate, storage paths, raw Passport tokens, token hashes,
email, phone, address, or payment details.

- The `trackEvent` helper (`lib/analytics/track.ts`) **sanitizes metadata**:
  forbidden / sensitive-looking keys are dropped, nested objects/arrays are
  discarded, and strings are truncated to 64 chars. Keep payloads to counts,
  booleans, enums, and short source labels.
- Tracking is **best-effort and non-blocking**: every helper swallows its own
  errors, so a logging failure can never break a user action.
- The user agent is **not** stored in events. (It is stored only in
  `beta_feedback`, as documented in `docs/beta-readiness.md`.)

## Events

| event | where | sample metadata |
| --- | --- | --- |
| `user_signed_up` | signup (only when a session is returned) | — |
| `vehicle_created` | create vehicle | — |
| `maintenance_created` | create maintenance | `{ trust_label }` |
| `issue_created` | create issue | `{ severity, status }` |
| `document_uploaded` | upload document | `{ file_type: pdf\|image, doc_type }` |
| `reminder_created` | create reminder | `{ reminder_type, urgency }` |
| `passport_created` | create Passport | `{ included_scopes_count, include_personal_docs }` |
| `passport_public_preview_opened` | open `/p/[token]` | `{ source: public_preview }` |
| `passport_accepted` | accept Passport | — |
| `mock_diagnosis_completed` | mock diagnosis | `{ mock_mode: true, language }` |
| `mock_diagnosis_saved_as_issue` | save diagnosis as issue | `{ mock_mode: true }` |
| `mock_document_extraction_started` | run mock extraction | `{ mock_mode: true }` |
| `mock_document_extraction_confirmed` | confirm mock extraction | `{ mock_mode: true }` |
| `beta_feedback_submitted` | settings feedback | `{ type }` |

`file_type` is coarse (`pdf` / `image`) — never the filename, which may contain
personal info. `doc_type`, `severity`, `status`, `reminder_type`, `urgency`, and
`trust_label` are fixed enums.

## Security model

- **Authenticated events** are inserted by the user's own session. RLS policy
  `app_events_insert_own` allows `insert` only where `user_id = auth.uid()`.
  There is **no select/update/delete policy** — users cannot read events back.
- **Anonymous public-preview events** can't use that policy (no session). Rather
  than open a broad anon insert policy, the `passport_public_preview_opened`
  event is written by a `SECURITY DEFINER` function `log_passport_preview`,
  which validates the token (active + active passport) exactly like the public
  preview RPC and stores **only the validated `passport_id`**. The raw token is
  hashed in the Next.js server and passed only as a lookup argument; **neither
  the token nor its hash is persisted**.

## Reading the data

There is **no in-app analytics dashboard** in this phase (by design). For now,
browse `app_events` in the Supabase Table Editor / SQL Editor. Any future
dashboard will be **admin-only**.

## Applying the migration

Run `supabase/migrations/20260608030000_app_events.sql` in the Supabase **SQL
Editor** (or via the Supabase CLI). It is additive and safe to re-run
(`create table if not exists`, `create or replace function`, idempotent policy
drop/create).

## TODOs

- `anonymous_id` is reserved but unused — we deliberately did not add cookie
  tracking. Add only if anonymous funnel analysis is needed.
- `user_signed_up` is skipped when email confirmation is enabled (no session →
  no `auth.uid()`); revisit with a post-confirmation hook if needed.
- An admin-only internal view of `app_events` could be added later.
