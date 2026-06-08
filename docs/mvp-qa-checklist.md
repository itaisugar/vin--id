# Vin.ID — MVP Manual QA Checklist

Run through these by hand before deploying. No automated test framework is
configured. Legend: ☐ = to test.

**Setup**
- Apply all SQL files in `supabase/migrations/` (in order) via the Supabase SQL
  Editor, including the Storage bucket + the RPC functions.
- Create the private Storage bucket `vehicle-documents` (see deployment notes).
- Two accounts: **User A** and **User B**.

---

## 1. Auth
- ☐ Sign up a new account; confirm email if required.
- ☐ Log in / log out.
- ☐ Visiting a protected route while logged out redirects to `/login`.
- ☐ After login you land on the dashboard.
- ☐ `/login?redirectTo=/p/<token>` returns you to that page after login.

## 2. Language / RTL
- ☐ Toggle עברית: UI translates and flips to RTL; English flips back to LTR.
- ☐ No raw translation keys visible (e.g. `nav.diagnose`).
- ☐ Settings → Language switcher persists across reloads.

## 3. Navigation
- ☐ Sidebar (desktop) + bottom bar (mobile) show: Dashboard, Vehicles,
  Diagnose, Settings. Active route is highlighted.
- ☐ Bottom nav fits 4 items without overflow on a phone width.
- ☐ No dead/disabled nav items.

## 4. Dashboard
- ☐ With **no vehicles**: onboarding empty state + "Add vehicle".
- ☐ With vehicles: quick actions, "Your vehicles" cards, upcoming reminders.
- ☐ Quick actions link correctly (per-vehicle actions target a vehicle).

## 5. Vehicle CRUD
- ☐ Create, view, edit a vehicle.
- ☐ Archive a vehicle (status → archived; not deleted).
- ☐ Empty/loading/error states render.

## 6. Maintenance
- ☐ Add / edit / soft-delete a maintenance log.
- ☐ Mileage above current raises vehicle mileage (never lowers).
- ☐ Trust label + section empty state render.

## 7. Issues
- ☐ Add / edit / resolve / soft-delete an issue.
- ☐ Severity + status + trust badges render; RTL ok.

## 8. Documents + Storage
- ☐ Upload a PDF and an image (≤ 5 MB); reject other types / oversize.
- ☐ Open document via **signed URL**; image preview shows.
- ☐ Edit metadata; soft-delete.
- ☐ No `storage_path` or raw file URL exposed in page source.

## 9. Reminders
- ☐ Add date-based and mileage-based reminders (one required).
- ☐ Urgency derives (overdue/soon); complete/dismiss/soft-delete work.
- ☐ Dashboard shows upcoming reminders across active vehicles.

## 10. Vehicle Passport
- ☐ Create a passport (choose scopes); success screen shows the share URL once
  with Copy + Open public preview.
- ☐ `snapshot_hash` + Record Confidence + summary render.
- ☐ Revoke works (passport + token revoked; snapshot kept).

## 11. Public Passport preview (`/p/[token]`)
- ☐ Opens logged-out; clean header, status, confidence helper, disclaimers.
- ☐ Documents are metadata-only — no `storage_path`/file URLs.
- ☐ Re-opening does NOT mark the token used.
- ☐ Expired / revoked / invalid / accepted states show the right message and no
  Accept button.
- ☐ No edit/admin controls visible.

## 12. Accept / Ownership transfer
- ☐ Logged-out → "Sign in to accept"; owner → "You are the owner".
- ☐ Buyer accepts → new vehicle + copied history; banner shown.
- ☐ Token becomes `used`; passport `accepted`; seller vehicle `sold`;
  one `ownership_transfers` row.
- ☐ Cannot accept twice.

## 13. Mock diagnosis
- ☐ Start a diagnosis; dangerous keywords (brake/steering/fuel/smoke) give a
  conservative result (never "safe to drive: yes").
- ☐ Save as issue creates an issue (source_type `mock_ai_diagnosis`).
- ☐ Mock-mode notice is visible.

## 14. Mock document extraction
- ☐ "Extract with AI" creates a pending extraction (doc unchanged).
- ☐ Review panel is editable; Confirm updates only the 6 metadata fields.
- ☐ Discard leaves the document unchanged.
- ☐ `share_allowed` is never turned on automatically.

## 15. Security / multi-user isolation
- ☐ User B cannot open User A's vehicles/maintenance/issues/documents/reminders/
  passports/diagnosis (not found / RLS).
- ☐ No service-role key in client bundle; no external AI calls.

## 16. Mobile layout
- ☐ Forms, cards, badges readable on a phone; bottom nav doesn't cover content
  (pages have bottom padding).
- ☐ Public preview readable on mobile.

## 17. Deployment readiness
- ☐ `npm run build` succeeds; `npm run lint` clean.
- ☐ Env vars set (see `docs/deployment-notes.md`); `MOCK_AI=true`.
- ☐ `APP_PUBLIC_URL` points at the deployed origin (share links).
