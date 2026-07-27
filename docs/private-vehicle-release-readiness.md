# VIN-ID Layer 1 — Private Vehicle release readiness

Closes the private-user product: **create a vehicle → photograph a document →
extract → review and edit → explicitly confirm → record created → Passport
updated → Passport shared.**

Harness: `npm run validate:private-vehicle` (120 assertions)
Audit: `supabase/audits/private_vehicle_audit.sql` (12 checks, all zero-row)
Migrations: `20260726110000`, `20260726160000`, `20260726170000`

---

## What the audit found

Three of the six defects below were introduced by the previous phase and would
have shipped. Two of those are the kind that only an *upgrade* test can find: a
clean database never reaches them.

| # | Defect | Severity | How it was found |
| --- | --- | --- | --- |
| 1 | **Every document-metadata confirmation raised a constraint violation.** `document_extractions_confirmed_has_record` (phase 6) demanded that any confirmed extraction name an operational record. The older "Extract with AI" flow on a document's own page legitimately produces none — it writes six fields onto the document. The button was dead for every user. | blocker | reading the constraint against the flow, then reproduced in SQL |
| 2 | **A document could only ever be read once.** The same migration's unique index allowed one confirmed extraction per document, so re-reading a document and confirming again failed on a unique violation. | blocker | same |
| 3 | **The phase 6 migration could not be deployed at all.** That unique index is created over existing data; any user who had confirmed the same document twice made `CREATE UNIQUE INDEX` abort, so the deployment would fail against exactly the production data it was written for. | blocker | legacy-upgrade gate |
| 4 | **A failed extraction could be confirmed into a real record.** `confirm_fleet_intake()` refused `cancelled` and `superseded` but not `failed` — the one state where the database holds no reading of the document, so the record's entire content would come from the request body. | high | `private-vehicle-check.mjs` |
| 5 | **Camera photos were silently dropped.** `/scan` accepts 10 MB (a phone photo is routinely 3–8 MB) but persisted the image through a 5 MB schema. Result: extraction ran, the paid provider call was spent, the record was created, and the image — the evidence the feature exists to capture — was discarded without a word. | high | camera-path review |
| 6 | **Every list screen scrolled sideways on a phone.** `<main>` is a flex item and the list containers are grids; both default to `min-width: auto`, so one long vehicle name pushed the whole page wider than the viewport — off the right in English, off the left in Hebrew. | medium | real-browser sweep |

Two further gaps were closed rather than found broken: the `/scan` page gated
only drivers, so a **viewer could spend a paid extraction call** on a record the
server would refuse; and `capture="environment"` on the intake upload forced the
camera and removed the ability to pick an existing photo on mobile.

---

## Server authorization now matches the database

Every write policy on every organization-scoped record table is
`organization_id = current_org_id() AND is_org_writer()`. The service layer now
states the same rule, so a viewer or driver is refused **before** a statement
reaches Postgres, with a clear error instead of an opaque RLS denial. RLS
remains the second, independent layer — nothing was moved out of the database.

24 mutations across 8 modules were aligned. The widest gap was
`lib/vehicle-records/service.ts` (insurance / registration / inspection), which
performed **no role check at all** and relied solely on RLS.

Reads deliberately stay on `requireOrganization()`: every member may read.

Both halves are asserted, and neither is restated in the test — the harness
reads the shipped source for the guards, and `private_vehicle_audit.sql` check 5
derives the table list from `pg_policies` so a table added later cannot escape
the rule by omission.

---

## Validated

### Automated

| Gate | Result |
| --- | --- |
| `validate:private-vehicle` | 120 assertions |
| `validate:fleet-ai-intake` | 85 |
| `validate:driver-view` | 116 |
| `validate:organization-members` | 77 |
| `validate:fleet-tenancy` | 51 |
| `validate:fleet-manager` | 50 |
| `validate:document-storage` | 25 |
| **total** | **524, zero failures** |
| SQL audits | 6 files, all zero-row (private 12, driver 10, intake 9, storage 6, tenancy, app-events) |
| Clean migration chain | `supabase db reset`, 36 migrations |
| Legacy upgrade | pre-phase-6 chain + duplicate legacy rows → upgraded, nothing deleted |
| TypeScript / ESLint / build | clean |

The private harness signs users up through the **public `auth.signUp` endpoint**
with the anon key, so the provisioning trigger, profile row and owner membership
are exercised exactly as in production. The service role is used only for
fixtures and read-back.

**No paid AI call is made.** The extraction *output* is synthesized; everything
that decides what happens to it — `confirm_fleet_intake()`, the derived-field
rules, the constraints, the policies — is the shipped code.

### The tests were checked for vacuity

Assertions that pass for the wrong reason are worse than missing ones, so the
important ones were mutation-tested:

* reverting one service guard → the harness names the exact function;
* stubbing `confirm_fleet_intake()` → 15 assertions fail;
* seeding four deliberate data violations → the audit reports all four.

One vacuous assertion was found and fixed in the harness itself: the last-owner
trigger refuses to delete a sole owner's membership, so "removing the membership
removes access" had been asserting nothing. It now removes the organization —
the only path that drops the membership — and additionally points the user's
stale profile cache at *another* user's organization with the `owner` role to
prove the cache grants nothing.

### Visual — real browser, real screenshots

Google Chrome driven over the DevTools Protocol; **140 screenshots**
(14 screens × 5 viewports × 2 locales), each with an in-page layout audit.

* viewports 320 / 375 / 768 / 1280 / 1440
* English LTR and Hebrew RTL
* **horizontal overflow: 0** across all 140 (was 17 before the fixes)
* `dir="rtl"` correct on every Hebrew page; reading order mirrored
* every form control has a label; every button and link has an accessible name
* the Confirm button is 44 px, above the fixed mobile nav, and topmost at its
  centre at both 320 px and 375 px
* long content exercised deliberately: a 45-character model name, a Hebrew
  garage name, ₪12,480.55, and long Hebrew descriptions
* VIN, licence plate, dates and currency stay LTR-readable inside RTL text

Production was proven unused: the browser logged in as a user that exists only
in the local database, and 5.4 MB of served bytes across 70 files contain zero
occurrences of the production project ref or any `.supabase.co` host.

One flagged item was analysed and dismissed rather than "fixed": the 16 px
consent checkbox on `/scan` sits inside a `<label>` with its text, so the real
tap target is the whole row.

---

## Outstanding risks

Real and unresolved. Nothing here is a known-broken user path.

1. **The physical camera has not been exercised on a device.** The input
   attributes, the EXIF-orientation handling and the server path are verified
   statically and the 10 MB mismatch is fixed, but no photo has been taken with
   a real phone. See the checklist below — this is the one item that needs a
   human before release.
2. **Email confirmation is off in local Supabase.** `signup()` handles the
   no-session case, but that branch has never run: with confirmation enabled the
   profile name is not mirrored and `user_signed_up` is not logged (both already
   carry a `TODO(signup-confirm)`). Decide the production setting deliberately.
3. **Two document-intake entry points remain.** `/scan` (which can create an
   *issue*) and `/fleet-intake` (which cannot). Both now persist provenance to
   the same table and both require explicit confirmation, so neither is unsafe —
   but the duplication is real and should converge.
4. **`/fleet-intake` is a Fleet-flavoured URL on a private-user screen.** The
   visible copy is neutral ("Add from a document"); only the path is not.
   Cosmetic, deliberately not renamed here.
5. **No usage cap on extraction.** Cost control is per-call (downscale, explicit
   user action, no page-load calls). There is still no per-user quota; the
   existing TODOs stand.
6. **Passport `server_signature` is still null.** The snapshot is SHA-256 hashed
   and tamper-evident against modification, but not signed.

---

## Production deployment

**Not executed in this task.** Nothing here has touched production.

1. **Back up.** Take a Supabase point-in-time snapshot and confirm it restores.
2. **Check the data this release migrates.** The one migration that touches
   existing rows is `20260726110000`:
   ```sql
   select document_id, count(*) from public.document_extractions
   where status = 'confirmed' and document_id is not null
   group by document_id having count(*) > 1;
   ```
   Every row returned is a document that was read and confirmed more than once.
   The migration keeps the newest confirmation and marks the older ones
   `superseded` — it deletes nothing, and the document metadata they wrote lives
   on `vehicle_documents` and is untouched. **If this query returns rows and the
   migration is skipped, the deployment will fail** on
   `CREATE UNIQUE INDEX ... one_confirmed_per_document`.
3. **Migrate staging first**, restored from a production snapshot, in file order:
   `20260726110000` → `20260726120000` → `20260726160000` → `20260726170000`.
4. **Run all six audits on staging.** Every check must return zero rows.
5. **Check the environment** before deploying the app: `MOCK_AI`,
   `ANTHROPIC_API_KEY` (server-only, never `NEXT_PUBLIC_`), `EXTRACTION_MODEL`,
   `APP_PUBLIC_URL` set to the production domain — an unset `APP_PUBLIC_URL`
   makes share links come back null rather than wrong, but the Passport is then
   unshareable.
6. **Deploy the application** only after the migrations are applied. The app
   reads `document_extractions` columns that `20260726120000` adds.
7. **Smoke test, in this order**, on production with a throwaway account:
   sign up → personal organization exists → create a vehicle → photograph a
   document **on a phone** → confirm the review screen shows the extracted values
   → confirm **no** record exists yet → confirm → exactly one record → open the
   Passport → share it → open the link in a private window → check no private
   field is shown → revoke → check the link stops working.
8. **Rollback.** The three new migrations are additive except
   `20260726110000`'s status change, which is reversible in principle but not
   worth reversing: the older duplicates were already invisible. To roll back the
   application, redeploy the previous build — the added columns and the widened
   constraints are all backward-compatible with it. To roll back the schema,
   restore the snapshot from step 1.

---

## Manual checklist — the phone camera

The only gate that a human must run. Both entry points, on a real device:

1. On a phone, open `/scan` and `/fleet-intake`.
2. Tap the file input. **Expected:** the native chooser offers Camera, Photo
   Library and Files — not the camera alone. (This was the `capture` fix; the
   camera must still be one tap away.)
3. Take a photo of a printed invoice, **held at an angle** so EXIF orientation
   is non-trivial. Confirm the preview is upright.
4. Check the photo's size in Files. Confirm a 5–8 MB photo completes and that
   the created record has the image attached — this is the case that used to
   fail silently.
5. Cancel the camera without taking a photo. **Expected:** back on the form, no
   error, nothing uploaded.
6. Deny camera permission. **Expected:** a clear message, no crash.
7. On a slow connection, confirm progress is visible while uploading.
8. Complete the review on the phone and confirm the Confirm button is reachable
   with the keyboard open.
9. Repeat step 2 in Hebrew.

Devices worth covering: one iPhone (Safari) and one Android (Chrome). iOS
converts HEIC to JPEG because `accept` excludes HEIC — confirm that holds on the
iOS version you support.
