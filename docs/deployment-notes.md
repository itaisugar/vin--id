# Vin.ID — Deployment Notes (Vercel + Supabase)

How to deploy Vin.ID to **Vercel Hobby** with **Supabase Free**. The app is
Next.js 16 (App Router). AI features run in **MOCK mode** — no paid AI, no AI
keys. There is **no service-role key** in the app.

---

## 1. Environment variables

The app uses exactly these (audited):

| Variable | Scope | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes | Supabase project URL, **bare origin** (`https://xxxx.supabase.co`). A trailing `/rest/v1/` is stripped defensively, but set the bare origin. Public — safe to expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | yes | Supabase **anon** key. Public — safe to expose. |
| `APP_PUBLIC_URL` | server only | recommended | Base for Passport share links (`/p/{token}`). Set to the stable production domain. If unset on Vercel, the app falls back to `VERCEL_URL`; localhost is used only in local dev. |
| `MOCK_AI` | server only | yes | Keep `true`. Diagnosis + document extraction use deterministic mock providers. |

**Do NOT add** `SUPABASE_SERVICE_ROLE_KEY` (or any AI provider key) — the MVP
does not need them, and the service-role key must never reach the browser.
`MOCK_AI` and `APP_PUBLIC_URL` are intentionally **not** `NEXT_PUBLIC_` (server
only).

### Exact Vercel env vars to add (Production + Preview)

```
NEXT_PUBLIC_SUPABASE_URL      = https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = <your supabase anon key>
APP_PUBLIC_URL                = https://<your-vercel-domain>.vercel.app
MOCK_AI                       = true
```

`APP_PUBLIC_URL` examples:
- Local dev: `http://localhost:3000` (or `:3001` / `:3002` if the port differs).
- Production: `https://<your-vercel-domain>.vercel.app` or your custom domain.

## 2. Deploy from GitHub to Vercel

1. Push the repo to GitHub (already wired: `itaisugar/vin--id`).
2. Vercel → **Add New… → Project** → import the GitHub repo.
3. **Root Directory:** select `vin-id` (the Next.js app lives in this subfolder).
4. Framework preset: **Next.js** (auto-detected). Build command `next build`,
   output handled by Vercel — no overrides needed.
5. Add the env vars from §1 (Production and Preview).
6. **Deploy.** Each push to `main` redeploys.

> `proxy.ts` (session refresh) runs on the Node.js runtime — no extra config.
> `next.config.ts` pins `turbopack.root` so the workspace root resolves
> correctly despite a stray lockfile at the repo root.

## 3. Supabase database + storage setup

In the Supabase **SQL Editor**, run every file in `supabase/migrations/` in
filename order (creates 13 tables, RLS + policies, grants, the storage bucket,
and the `SECURITY DEFINER` RPCs for public preview / accept). Paste only the
SQL, not surrounding prose.

**Storage bucket:** `vehicle-documents` must exist and be **private**
(`public = false`). It is created by
`20260607170001_storage_vehicle_documents.sql` (5 MB limit;
`application/pdf, image/jpeg, image/png, image/webp`) with owner-only
`storage.objects` policies. **No public buckets.** Files are served only via
short-lived signed URLs.

## 4. Supabase Auth URL settings (important)

Auth is **email/password only** (no OAuth, no magic-link, no callback route).
The signup confirmation email links to the Supabase **Site URL**, so set:

**Supabase → Authentication → URL Configuration**

- **Site URL:** `https://<your-vercel-domain>.vercel.app`
- **Redirect URLs (allow list):**
  - `http://localhost:3000/**`
  - `http://localhost:3001/**`
  - `http://localhost:3002/**`
  - `https://<your-vercel-domain>.vercel.app/**`
  - `https://<your-custom-domain>/**` (when added)

In-app post-login redirect (`?redirectTo=`) is internal-only and validated
(no open redirects) — it is not a Supabase setting. Google/OAuth is **not**
implemented; do not enable it for this MVP.

> If you don't want email confirmation during testing, you can disable
> "Confirm email" in Supabase → Authentication → Providers → Email.

## 5. RLS & security reminders

- **RLS is enabled on every table** and must stay enabled.
- Policies are owner-scoped (`owner_user_id = auth.uid()`).
- **Do not** add public/`anon` SELECT policies to raw tables. The public
  Passport preview (`/p/[token]`) is served only through the
  `get_public_passport` RPC, which returns **safe snapshot data only** (no
  `owner_user_id`/`issuer_user_id`, no `storage_path`, no `token_hash`).
- **Never** expose `SUPABASE_SERVICE_ROLE_KEY` to the browser (it isn't used).
- **Never** expose `token_hash`; only the raw share token (shown once at
  creation) appears in the share URL — only its hash is stored.
- Keep the `vehicle-documents` bucket **private**.

## 6. Build & local run

```bash
cd vin-id
npm install
npm run lint      # eslint
npm run build     # next build  (also runs TypeScript)
npm run dev       # local dev
```

Node.js 20+ recommended.

## 7. Free-tier notes

- Supabase Free: storage/row/egress limits — fine for MVP testing.
- Signed URLs expire after a few minutes (re-open to refresh).
- Email delivery depends on Supabase Auth email settings.
- Mock AI only — no external AI usage or cost.

## 8. How to test the production deployment

After deploying, run `docs/production-qa-checklist.md`. Quick smoke test:
sign up → add a vehicle → add maintenance → upload a document (open via signed
URL) → create a Passport → copy the share URL → open `/p/[token]` in an
incognito window → accept it from a second account.

## TODOs (future, not blocking MVP)
- Real AI provider (diagnosis + extraction) behind the existing mock interfaces.
- Secure document-file copy on accept; PDF export; QR for share links.
- Optional: adopt the Supabase CLI for migrations (`supabase db push`).
