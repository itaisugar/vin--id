# Vehicle Passport — Manual QA Checklist

Manual test pass for the Vehicle Passport flow (create → share → public preview →
accept). No automated test framework is configured; run these by hand.

**Setup**
- Two accounts: **Seller A** and **Buyer B**.
- Apply all migrations in `supabase/migrations/` (especially
  `…_public_passport_rpc.sql` and `…_accept_passport_rpc.sql`).
- A vehicle owned by A with some maintenance, issues, and at least one
  **shareable** document (`share_allowed = true`) and one **non-shareable**
  document (`share_allowed = false`).

Legend: ☐ = to test.

---

## 1. Passport creation (Seller A)
- ☐ A opens a vehicle → **Vehicle Passport** → **Create Vehicle Passport**.
- ☐ Scope toggles show correct counts (maintenance / issues / documents /
  reminders).
- ☐ Non-shareable documents are counted as "not shareable" and never included.
- ☐ Personal-info shareable docs are excluded unless the amber opt-in is checked.
- ☐ After **Create passport**, the success screen shows: title, full share URL,
  **Copy link**, **Open public preview**, **Open passport**, and the "shown only
  once / copy now" warning.
- ☐ In DB: `vehicle_passports` row has `status='active'`, a non-empty
  `snapshot`, a `snapshot_hash`, a `record_confidence_score`, and `ai_summary`.
- ☐ In DB: `transfer_tokens` row has only a `token_hash` (no raw token),
  `status='active'`, `expires_at ≈ now()+72h`.

## 2. Snapshot integrity
- ☐ `snapshot` contains vehicle summary, included scopes, and the selected
  records (maintenance/issues/documents-metadata/reminders).
- ☐ `snapshot` does **not** contain any `storage_path`.
- ☐ Seller edits a maintenance record **after** creating the passport → the
  passport `snapshot` and `snapshot_hash` are **unchanged** (frozen).

## 3. Public preview — unauthenticated (`/p/[token]`)
- ☐ Open the share URL in a **logged-out / incognito** window → full report
  renders (header, vehicle summary, confidence, hash, summary, timeline,
  missing/not-shared, disclaimers).
- ☐ Documents show **metadata only** — no `storage_path`, no file URLs, no
  signed URLs (check page source).
- ☐ CTA shows **"Sign in to accept this Passport"** with a return URL back to
  `/p/[token]`.
- ☐ Reload several times → `transfer_tokens.status` stays `active`,
  `used_at` is null (**preview never marks the token used**).

## 4. Seller opens own link
- ☐ A opens the share URL while logged in → shows **"You are the owner of this
  Passport."** and **no** Accept button.

## 5. Buyer accepts (Buyer B)
- ☐ B opens the share URL → CTA shows **"Accept Passport into my account"**.
- ☐ Click Accept → confirm dialog ("…will be copied to your account",
  "not an official ownership transfer document") → confirm.
- ☐ B is redirected to the **new vehicle** with the green "Vehicle Passport
  accepted…" banner.
- ☐ B's `/vehicles` shows the new vehicle; its detail shows copied
  **maintenance** and **issues** matching the included scopes.
- ☐ Copied `vehicle_documents` rows exist with `storage_path = NULL`
  (metadata only; "preview unavailable").

## 6. Post-accept state
- ☐ `transfer_tokens`: `status='used'`, `used_at` set, `used_by_user_id = B`.
- ☐ `vehicle_passports`: `status='accepted'`, `accepted_at` set,
  `accepted_by_user_id = B`.
- ☐ Seller A's **original** vehicle: `status='sold'`, `sold_at` set (kept, not
  deleted).
- ☐ One `ownership_transfers` row: `from_user_id=A`, `to_user_id=B`,
  `vehicle_id=original`, `new_vehicle_id=B's new`, `status='completed'`,
  `completed_at` set.

## 7. No double-accept
- ☐ Open the same link again (as B or anyone) → **"This Passport has already
  been accepted."**, no Accept button.
- ☐ Rapid double-click Accept (before redirect) results in **one** transfer
  only (token becomes `used` atomically).

## 8. Revoke
- ☐ A revokes an **active** passport (owner detail → Revoke → confirm).
- ☐ `vehicle_passports.status='revoked'`, related `transfer_tokens.status='revoked'`.
- ☐ Public link now shows **"This Passport link was revoked by the owner."**, no
  Accept button.
- ☐ The snapshot row is **kept** (revoke does not delete it).

## 9. Invalid / edge states (public preview shows message, no Accept button)
- ☐ **Expired:** set the token `expires_at` to the past → "This Passport link
  has expired."
- ☐ **Used/accepted:** "This Passport has already been accepted."
- ☐ **Revoked:** "This Passport link was revoked by the owner."
- ☐ **Invalid:** `/p/garbage` → "Passport link not found or invalid."
- ☐ **Missing snapshot:** an empty `snapshot` resolves to the invalid message.
- ☐ **Logged-out accept attempt:** the Accept button is not shown; calling the
  action without a session returns the "please sign in" error.

## 10. Empty / graceful content
- ☐ Passport with **no documents** included → documents section empty, summary
  notes it, no crash.
- ☐ Passport with **issues excluded** → issues omitted, "missing/not shared"
  shows it.
- ☐ Empty maintenance/issues/reminders render graceful empty states.
- ☐ Missing/partial `ai_summary` → summary shows graceful empty state.

## 11. Security spot-checks
- ☐ Page source / network on `/p/[token]` never contains `token_hash`,
  `storage_path`, service-role key, or seller `owner_user_id`/`issuer_user_id`.
- ☐ A second logged-in user (not A, not B) can open the public link but cannot
  reach A's `/vehicles/...` pages (RLS-protected).
- ☐ Buyer B's account contains only **copied** rows; B cannot read A's original
  rows directly.

---

## Notes / known TODOs
- Document **files** are not copied on accept (metadata only, `storage_path`
  NULL). TODO: secure file copy.
- `createPassport` inserts the passport then the token as two statements (not a
  single transaction). If the token insert fails, an active passport exists with
  no share link — recreate or revoke.
- No automated tests: the deterministic helpers (`canonicalize`, hashing,
  confidence, summary) are `server-only`; covered here by manual review.
