# Vin.ID — Production Health Checklist (weekly)

A quick, free-tier weekly pass to confirm the beta is alive, private, and
logging. ~5–10 minutes. Tick each item; investigate anything that fails.

Related: [beta-insights.md](beta-insights.md) (how to read usage),
[event-tracking.md](event-tracking.md) (what is logged),
[deployment-notes.md](deployment-notes.md),
[production-qa-checklist.md](production-qa-checklist.md).

## 1. App is live
- [ ] Production URL loads (landing / login).
- [ ] `GET /api/health` returns `{ "ok": true, "app": "Vin.ID" }`.
- [ ] Vercel: latest deployment is **Ready** (no failed build).

## 2. Auth works
- [ ] Sign up a throwaway account (or log in to an existing one).
- [ ] Log out and back in.
- [ ] Protected routes redirect to `/login` when signed out.

## 3. Supabase is healthy
- [ ] Project is **not paused** (Free tier pauses after inactivity — open the
      dashboard to wake/confirm).
- [ ] Storage bucket `vehicle-documents` is **private** (not public).
- [ ] **RLS is enabled** on every table (Database → Tables → each has RLS on).
- [ ] No unexpected public/anon SELECT policies (especially on `app_events`).

## 4. Core flows
- [ ] Create a Vehicle Passport; open its **public preview** at `/p/[token]`
      in a logged-out window — it renders and shows the snapshot only.
- [ ] Revoke a Passport and confirm the public link stops working.

## 5. Event logging
- [ ] `app_events` is receiving rows:
      ```sql
      select max(created_at) as last_event, count(*) as total
      from public.app_events;
      ```
      `last_event` should be recent.
- [ ] Funnel views return data:
      ```sql
      select * from public.beta_core_funnel_daily order by event_date desc limit 7;
      select * from public.beta_passport_funnel_summary;
      ```

## 6. Privacy audit
- [ ] Run `supabase/audits/app_events_privacy_audit.sql` — the forbidden-key and
      forbidden-value queries return **0 rows**. (See
      [beta-insights.md](beta-insights.md) → Privacy audit queries.)
- [ ] `select distinct key from public.app_events, jsonb_object_keys(metadata) as key;`
      shows only expected, non-sensitive keys.

## 7. Feedback
- [ ] Review new `beta_feedback` rows:
      ```sql
      select created_at, type, message, page_url
      from public.beta_feedback order by created_at desc limit 50;
      ```
- [ ] Triage anything actionable (mark `status` reviewed/closed in the console).

## 8. Build & usage
- [ ] Vercel build is passing on the default branch.
- [ ] Supabase **Free-tier usage** checked (Database size, Storage, Egress,
      Monthly Active Users) — comfortably under limits.
- [ ] Vercel usage (bandwidth / function invocations) — under Hobby limits.

## Notes
- All checks are **manual** and free-tier. There is no admin dashboard and no
  external analytics by design.
- If `app_events` is empty but the app works, confirm the
  `20260608030000_app_events.sql` and `20260608040000_beta_insight_views.sql`
  migrations have been applied in Supabase.
