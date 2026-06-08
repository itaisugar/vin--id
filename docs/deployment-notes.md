# Vin.ID — Deployment Notes

MVP deployment guidance. Vin.ID is a Next.js (App Router) app on Supabase,
designed to run on free tiers. AI features run in **MOCK mode** — no paid AI.

## 1. Environment variables

Set these in the host (e.g. Vercel Project → Settings → Environment Variables)
and in `.env.local` for local dev:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (bare origin, e.g. `https://xxxx.supabase.co`). The app strips a trailing `/rest/v1/` defensively, but set the bare origin. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key. Safe in the browser. |
| `APP_PUBLIC_URL` | yes | Public origin used to build Passport share links (`/p/{token}`). Set to the deployed URL in production (e.g. `https://vin-id.example.com`). |
| `MOCK_AI` | yes | Keep `true` for the MVP — diagnosis and document extraction use deterministic mock providers. |

There is **no service-role key** in the app. Privileged operations (public
passport preview, accept transfer) run through `SECURITY DEFINER` Postgres
functions, so the service-role key is never shipped to the browser or server.

## 2. Supabase setup (run migrations in order)

In the Supabase **SQL Editor**, run every file in `supabase/migrations/` in
filename order. Key ones:

1. `20260607120000_init_core_schema.sql` — 13 tables + RLS + policies + triggers.
2. `20260607130000_*` … vehicles `mileage_unit`/`photo_url`.
3. `20260607140000_grant_table_privileges.sql` — grants to `authenticated`.
4. `20260607150000_*`, `20260607160000_*` — maintenance/issue vocab + source.
5. `20260607170000_*` (documents metadata) + `20260607170001_storage_vehicle_documents.sql` (bucket + storage policies).
6. `20260607180000_*` reminders; `20260607190000_*` passport summary/signature.
7. `20260607200000_public_passport_rpc.sql` — public preview RPC.
8. `20260607210000_accept_passport_rpc.sql` — accept transfer RPC.
9. `20260608000000_*` issue↔diagnosis link; `20260608010000_*` extraction review.

> Tip: paste only the SQL — not surrounding prose — into the editor.

## 3. Storage bucket

- A **private** bucket named `vehicle-documents` is required.
- It is created by `20260607170001_storage_vehicle_documents.sql` (5 MB limit;
  `application/pdf, image/jpeg, image/png, image/webp`) with owner-only
  `storage.objects` policies (first path segment = user id).
- **No public buckets.** Files are served only via short-lived signed URLs.

## 4. RLS reminder

- RLS is **enabled on every table** and must stay enabled.
- Policies are owner-scoped (`owner_user_id = auth.uid()`); ownership transfers
  are visible to both parties.
- **Do not** add public/`anon` SELECT policies to raw tables. Public passport
  preview is served only through the `get_public_passport` RPC.

## 5. Build & run

```bash
npm install
npm run lint
npm run build
npm start    # or deploy to Vercel
```

- Next.js 16 (App Router, Turbopack). Node.js 20+ recommended.
- The repo root has a stray lockfile; `turbopack.root` is pinned in
  `next.config.ts` so the workspace root resolves correctly.

## 6. Vercel notes

- Framework preset: **Next.js** (zero-config).
- Set all env vars above (Production + Preview).
- Set `APP_PUBLIC_URL` to the deployment URL so share links resolve off-device.
- Middleware/`proxy.ts` runs on the Node.js runtime (refreshes the Supabase
  session); no extra config needed.

## 7. Known free-tier constraints

- Supabase free tier: storage/row/egress limits — fine for MVP testing.
- Signed URLs expire after a few minutes (re-open to refresh).
- Email confirmation depends on Supabase Auth email settings.
- Mock AI only — no external AI usage or cost.

## 8. Post-deploy smoke test

Run the highlights from `docs/mvp-qa-checklist.md`: sign up, add a vehicle,
add maintenance, upload a document, create + share a Passport, open `/p/[token]`
in an incognito window, and accept it from a second account.

## TODOs (future, not blocking MVP)
- Real AI provider (diagnosis + extraction) behind the existing mock interfaces.
- Secure document-file copy on accept; PDF export; QR for share links.
- Optional: adopt the Supabase CLI for migrations (`supabase db push`).
