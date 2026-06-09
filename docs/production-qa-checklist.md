# Vin.ID — Production QA Checklist

Run this against the **deployed** Vercel URL after each meaningful deploy. It
mirrors the local MVP checklist but focuses on production wiring (env vars, auth
URLs, signed URLs, share links off-device). Legend: ☐ = to test.

**Preconditions**
- All `supabase/migrations/` applied (incl. storage bucket + RPCs).
- Vercel env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `APP_PUBLIC_URL` (= production URL), `MOCK_AI=true`.
- Supabase Auth: **Site URL** = production URL; **Redirect URLs** include
  localhost variants + the production URL (see deployment notes §4).
- Two accounts: **User A**, **User B** (use a second browser/incognito).

---

## 0. Build & deploy
- ☐ `npm run build` passes locally.
- ☐ Vercel deployment succeeds (no build errors in the Vercel log).
- ☐ Production site loads (no 500 on `/`, redirects to `/login` when logged out).

## 1. Auth
- ☐ Sign up User A on production; confirm email if "Confirm email" is enabled
  (the confirmation link points at the production Site URL — not localhost).
- ☐ Log in / log out.
- ☐ Visiting a protected route logged out → redirects to `/login`.
- ☐ `/login?redirectTo=/p/<token>` returns to that page after login.

## 2. Language / RTL
- ☐ Switch EN ↔ HE; UI translates and flips LTR/RTL; choice persists.
- ☐ No raw translation keys visible.
- ☐ Hebrew: forms, badges, cards, and the public preview read right-to-left
  (no stray left-aligned blocks).

## 2b. Dashboard
- ☐ With **no vehicles**: onboarding empty state + "Add vehicle".
- ☐ With vehicles: quick actions (Add vehicle / Diagnose / Add maintenance /
  Upload document / Create Passport) all link to a valid page.
- ☐ "Your vehicles" cards + upcoming reminders render.
- ☐ Bottom nav (Dashboard / Vehicles / Diagnose / Settings) — every item routes
  to a real page; no dead/disabled items.

## 3. Vehicle CRUD
- ☐ Create / view / edit a vehicle; archive (status → archived, not deleted).
- ☐ Empty/loading/error states render.

## 4. Maintenance
- ☐ Add / edit / soft-delete; mileage raises vehicle mileage upward only.

## 5. Issues
- ☐ Add / edit / resolve / soft-delete; badges render (EN + HE).

## 6. Documents + Storage (production signed URLs)
- ☐ Upload a PDF and an image (≤ 5 MB); reject other types / oversize.
- ☐ Open the document — the **signed URL** resolves from the private
  `vehicle-documents` bucket on the production domain.
- ☐ Edit metadata; soft-delete.
- ☐ View page source — **no `storage_path`** and no raw bucket URL exposed.

## 7. Reminders
- ☐ Add date-based and mileage-based reminders; urgency derives.
- ☐ Complete / dismiss / soft-delete; dashboard shows upcoming reminders.

## 8. Vehicle Passport — create & share
- ☐ Create a Passport; success screen shows the share URL using the **production
  domain** (`https://<prod>/p/<token>`), **not** localhost.
- ☐ Copy link works; `snapshot_hash` + Record Confidence + summary render.

## 9. Public Passport preview (`/p/[token]`) — unauthenticated
- ☐ Open the share link in an **incognito** window (logged out) → professional
  report renders.
- ☐ **No `storage_path`**, no file URLs, no `owner_user_id`/`issuer_user_id`,
  no `token_hash` in the page source.
- ☐ Re-open several times → token stays `active` (preview never marks it used).
- ☐ Expired / revoked / invalid / accepted states show the right message and no
  Accept button. No edit/admin controls.

## 10. Accept Passport (second user)
- ☐ Logged out → "Sign in to accept" (returns to `/p/<token>` after login).
- ☐ User A opening own link → "You are the owner".
- ☐ User B accepts → new vehicle + copied history; success banner.
- ☐ Token → `used`; passport → `accepted`; seller vehicle → `sold`;
  one `ownership_transfers` row. Cannot accept twice.

## 11. Revoke
- ☐ User A revokes an active Passport → public link shows "revoked"; snapshot
  kept.

## 12. Mock diagnosis
- ☐ Dangerous keywords (brake/steering/fuel/smoke) → conservative result (never
  "safe to drive: yes"); mock-mode notice visible.
- ☐ Save as issue creates an issue (`source_type = mock_ai_diagnosis`).

## 13. Mock document extraction
- ☐ "Extract with AI" creates a pending extraction (doc unchanged).
- ☐ Confirm updates only the 6 metadata fields; Discard leaves the doc unchanged.
- ☐ `share_allowed` is never auto-enabled. No external AI/network call.

## 14. Security / isolation
- ☐ User B cannot open User A's vehicles/records/passports/diagnosis (not found
  / RLS).
- ☐ No `SUPABASE_SERVICE_ROLE_KEY` and no AI key present in the client bundle.

## 15. Mobile
- ☐ Bottom nav (Dashboard/Vehicles/Diagnose/Settings) fits; content not covered.
- ☐ Forms/cards/public preview readable on a phone.

---

### Production gotchas to watch
- Share URL shows `localhost` → `APP_PUBLIC_URL` not set in Vercel (or empty).
- Confirmation email links to `localhost` → Supabase **Site URL** not set to prod.
- Login works but signup "stuck" → email confirmation enabled but Redirect URLs
  / Site URL not configured.
- Document preview 400/403 → bucket missing/public, or storage policies not run.
