# All Requested Improvements — Release Readiness (RC1)

Release candidate consolidating the five requested VIN-ID improvements. Branch
`release/all-requested-improvements-rc1`. **Not merged to `main`, not deployed,
no migrations applied to production.**

Classification: **IMPLEMENTATION VALIDATED — FOUNDER VISUAL CHECK PENDING.**
Every automated and structural gate is green; the only outstanding item is the
human responsive/RTL/camera visual pass (no browser-automation tooling is
available in this environment, so it is honestly reported as *not viewed*).

---

## 1. Branch ancestry

Linear chain (each is an ancestor of the next — verified with
`git merge-base --is-ancestor`):

```
main
 └─ …2b371b9 (PR #11: dashboard + photo-url cleanup, Task A)
     └─ feat/all-requested-improvements   b406e2f   (Task B: private-first)
         └─ feat/government-vehicle-lookup 88142a0   (Task D: gov lookup)
             └─ feat/vehicle-registration-ai-intake a67258b (Task E: AI intake)
                 └─ release/all-requested-improvements-rc1 (this RC)
```

Cleanup commits `2b26616, cee5295, 62b153d, 4fe5459` are all present in HEAD.
Integration branch `feat/all-requested-improvements` was in sync with origin
(0/0) at the start.

## 2. Included improvements

| # | Improvement | Task | Migration |
|---|-------------|------|-----------|
| 1 | Remove document-expiry tiles from the Dashboard | A | — |
| 2 | Remove raw Photo URL field from vehicle forms (values preserved) | A | — |
| 3 | Private-first + explicit Business organization creation | B | 20260802120000 |
| 4 | Official Israeli government vehicle lookup by registration | D | 20260802130000 |
| 5 | Vehicle-registration document image scan → AI extract → gov compare | E | 20260802140000 |

RC-only hardening commits (this task): AI production-safety gate, upload-copy
alignment, additive `created_record_type` fix.

## 3. Final migration order (47 total)

Existing production migrations through `20260731120000_atomic_member_removal`,
then:

- `20260802120000_business_organization_creation` — atomic Business-org RPC + Personal-invitation restriction.
- `20260802130000_vehicle_source_metadata` — additive `fuel_type`, `data_source` (`null|manual|israel_government`), `government_fetched_at`, `government_resource_id`.
- `20260802140000_vehicle_registration_intake` — widens three CHECK vocabularies (all additive) + `confirm_vehicle_registration_intake()`.

Clean `supabase db reset` applies all 47 with no migration-history repair, no
manual step, and only benign idempotent "does not exist, skipping" notices.

## 4. AI production provider rule

Single gate: `lib/server/ai/provider-mode.ts` → `resolveExtractionProviderMode(env)`.

| Environment | Selector / key | Result |
|-------------|----------------|--------|
| production | `ANTHROPIC_API_KEY` present | `anthropic` |
| production | key missing | **`unavailable(missing_key)`** — never mock |
| production | `AI_EXTRACTION_PROVIDER=mock` | **`unavailable(mock_in_production)`** — rejected |
| production | `AI_EXTRACTION_PROVIDER=anthropic`, no key | `unavailable(missing_key)` |
| test / development | `AI_EXTRACTION_PROVIDER=mock` | `mock` |
| test / development | no selector, no key | `mock` (zero-config CI/local fallback) |
| any | `AI_EXTRACTION_PROVIDER=anthropic`, no key | `unavailable(missing_key)` |

- **No `anthropic → mock` fallback exists.** Provider timeout / 5xx / malformed
  response is surfaced as a typed `VehicleExtractionError`, never mock output.
- The vehicle-registration intake resolves the provider **before** uploading:
  an unavailable provider returns `extractUnavailable` with **no upload, no DB
  write, no synthetic extraction** — the user can retry, replace the photo,
  continue manually, or cancel. Only the reason is logged (no document content).
- Both extraction factories (`getExtractionProvider`, `getVehicleExtractionProvider`)
  go through the gate; the doc-scan and fleet-intake callers already treat a
  thrown provider as "extract failed → manual".
- `MOCK_AI` no longer gates extraction (it only affects mock diagnosis / summary
  / landing copy). Provider keys are **server-only**, never `NEXT_PUBLIC_`.

## 5. Supported image types

JPEG, PNG, WebP. Camera capture via `capture="environment"`. Max 10 MB.
File input `accept="image/jpeg,image/png,image/webp"`.

## 6. PDF limitation

PDF is **not** supported for registration scanning (the file input excludes it
and the service rejects non-image MIME types). Copy in both languages now states
images-only and that PDFs are unsupported. PDF scanning is documented future
scope only. (The separate document *upload* form legitimately accepts PDF — that
is a different feature and its copy is correct.)

## 7. Visual matrix (status)

Browser automation / screenshots are **not available in this environment**, so
the responsive + RTL matrix below was **not visually viewed**. Each row is
marked with the strongest evidence actually obtained:

- **auto** — covered by an automated assertion suite.
- **code** — verified by code/structure inspection.
- **smoke** — production server booted and served (root `/` → 200, no errors).
- **pending** — requires a human/browser visual pass.

| Flow | 360 | 390 | 430 | 768 | 1440 | he-RTL | en-LTR | Evidence |
|------|-----|-----|-----|-----|------|--------|--------|----------|
| Dashboard cleanup | pending | pending | pending | pending | pending | pending | pending | auto (dashboard-vehicle-cleanup 18) + code |
| Photo URL removal | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Personal Team & Access | pending | pending | pending | pending | pending | pending | pending | auto (private-first 57) + code |
| Business creation | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Government lookup | pending | pending | pending | pending | pending | pending | pending | auto (gov-lookup 51) + code |
| Manual fallback | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Duplicate state | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Registration camera/upload | pending | pending | pending | pending | pending | pending | pending | auto (intake 39) + code |
| Extraction states | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Conflict Review | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Reminder opt-in | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Confirmation | pending | pending | pending | pending | pending | pending | pending | auto + code |
| Workspace switching | pending | pending | pending | pending | pending | pending | pending | auto (multi-workspace 57) + code |
| Permissions | pending | pending | pending | pending | pending | pending | pending | auto (driver 116, fleet-manager 50) + code |

The founder visual pass is the single remaining gate before this becomes
`ALL REQUESTED IMPROVEMENTS RELEASE CANDIDATE VALIDATED`.

## 8. Visual findings and fixes (structural)

Verified by code inspection (not a browser):

- Dashboard: no `documentsExpiring`/`docExpiry` tiles remain in dashboard code.
- Vehicle form: no `photo_url`/`photoUrl` input in create or edit.
- Personal workspace `organization` page branches on `isPersonalWorkspace()` →
  activation card + `CreateOrganizationForm` (no roster/invite/role controls).
- Add Vehicle exposes exactly three methods; scan sub-flow remounts fresh on
  re-entry (no stale cross-method state); all three creation paths reuse the
  shared `VehicleForm`.
- No new visual defects were introduced by this task's fixes.

## 9. Accessibility findings

Touched components carry: `<Label htmlFor>`, `aria-invalid`, `aria-describedby`,
`role="alert"` on errors, `aria-live="polite"` on progress/outcome regions,
`disabled` submit while pending. No accessibility regressions introduced. Full
keyboard/focus/contrast pass is part of the pending founder visual check.

## 10. Production configuration

Server-only unless marked public. **Never print secret values.**

| Variable | Scope | Required | Missing-value behavior |
|----------|-------|----------|------------------------|
| `ANTHROPIC_API_KEY` | server | for scan | Scan → `extractUnavailable`; manual entry works |
| `AI_EXTRACTION_PROVIDER` | server | optional | Legacy key-based gate; `mock` rejected in production |
| `EXTRACTION_MODEL` | server | optional | Defaults to `claude-haiku-4-5-20251001` |
| `GOV_VEHICLE_RESOURCE_ID` | server | optional | Defaults to the primary DataStore resource |
| `GOV_VEHICLE_API_BASE_URL` | server | optional | Defaults to `https://data.gov.il/api/3/action/` (host-locked) |
| `GOV_VEHICLE_TIMEOUT_MS` / `GOV_VEHICLE_CACHE_MS` / `GOV_VEHICLE_NOT_FOUND_CACHE_MS` | server | optional | 8000 / 30 min / 5 min |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | App cannot reach Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | App cannot authenticate |
| `SUPABASE_SERVICE_ROLE_KEY` | server | server ops/tests | (never shipped to client) |
| `APP_PUBLIC_URL` / `VERCEL_URL` | server | optional | Used for absolute URLs |

Required release behavior: missing AI key → scan unavailable, manual works;
missing/invalid government config → lookup unavailable, manual works; neither
blocks ordinary manual vehicle creation; **mock AI never runs in production.**

## 11. Automated validation

- Clean `supabase db reset`: 47 migrations, no repair, no manual step.
- Regression: **876 assertions, 0 failures** across 15 suites (852 baseline +
  24 new AI-provider-hardening).
- New focused suite `validate:ai-provider-hardening` — 24 offline assertions.
- `tsc --noEmit` clean · ESLint clean · `next build` compiles · i18n parity
  1280/1280 (en/he).
- Production server boot smoke: `/` → 200, no boot errors, no mock references.

Suite breakdown: fleet-tenancy 51 · document-storage 25 · organization-members
79 · fleet-manager 50 · driver-view 116 · fleet-ai-intake 85 · private-vehicle
120 · qa-quick-wins 62 · multi-workspace 57 · member-removal 42 ·
dashboard-vehicle-cleanup 18 · private-first 57 · government-vehicle-lookup 51 ·
vehicle-registration-intake 39 · ai-provider-hardening 24.

## 12. Data and security model

- **Mock restriction:** production never selects mock (Section 4); proven by 24
  assertions incl. factory-throws-in-prod and no-degrade-on-failure.
- **Provider secrets:** server-only; no `NEXT_PUBLIC_` AI config.
- **PII:** extraction schema omits owner identity; `stripProhibitedKeys` removes
  prohibited keys at every level; raw model response never stored; logs carry
  status/reason only.
- **Storage:** private `vehicle-documents` bucket; server-built paths; signed
  URLs only; staged file filed at confirmation or removed on cancel.
- **Tenant isolation:** org-scoped RLS; intake bound to org at creation and
  re-verified in the confirm RPC (a workspace switch cannot rebind it).
- **Duplicate isolation:** workspace-scoped in both creation paths
  (`registrationDuplicateKey` in the service, `normalize_plate` in the RPC); no
  cross-workspace disclosure.
- **Public Passport:** unaffected; metadata-only; storage paths never leak.
- **Authorization:** Fleet-writer required in service and RPC; viewer/driver
  denied.

## 13. Known limitations

Image-only registration intake (no PDF); primary government DataStore resource
only; not ownership/authenticity/roadworthiness verification; no recurring
government sync; extraction reliability varies with image quality (warnings
surfaced); additional technical fields (engine/body/weight/tyres) intentionally
not persisted; legal attribution wording ("Other (Open)" license, data.gov.il)
should be confirmed with the founder before public launch.

## 14. Production migration order

1. Back up production database.
2. Apply in order: `20260802120000` → `20260802130000` → `20260802140000`.
   All additive (new RPCs, additive columns, additive CHECK widening). No
   destructive backfill; existing rows remain valid.
3. Regenerate DB types through the normal process if used downstream.

## 15. Application deployment order

Database-first: apply migrations 45–47, then deploy the application build.
Application code tolerates the pre-migration schema only insofar as the new
columns/RPC are absent — so migrations must land first. Do **not** deploy the app
before the migrations.

## 16. Smoke-test plan (post-deploy, browser)

1. Dashboard: no document-expiry tiles; Action/Deadline lists still populated.
2. Create/edit vehicle: no Photo URL field; existing image still renders.
3. Personal workspace → Team & Access shows activation card; create a Business
   org; Personal data remains in Personal.
4. Government lookup: valid plate → editable Review with source label +
   disclaimer; not-found → manual fallback; unavailable → manual fallback.
5. Registration scan: capture/upload image → extraction → registration review →
   gov compare → confirm → vehicle appears once + document in Documents.
6. With the AI key intentionally unset in a preview: scan shows the unavailable
   state and manual entry still works (confirm no mock output).
7. Duplicate registration in the active workspace → "Open existing vehicle".
8. Viewer/Driver cannot reach create flow.

## 17. Rollback plan

- Application: redeploy the previous build (previous Add Vehicle unaffected).
- Database: the three migrations are additive; if needed the new RPCs can be
  dropped and the widened CHECK constraints narrowed again — no data migration,
  because columns/rows are additive and remain valid. Prefer forward-fix over
  destructive rollback.

## 18. First-use monitoring

Watch (no new vendor): extraction count, extraction failure rate, provider
latency, provider 429/5xx count, `extractUnavailable` rate, government lookup
latency, confirmation failure rate, duplicate-block rate, manual-fallback rate.

## 19. Remaining future work

PDF registration support; existing-vehicle registration scan; richer per-field
provenance in Review; additional persisted technical fields; recurring
government re-sync; usage quotas / per-user scan caps; founder-approved legal
attribution copy; the full browser visual/RTL/accessibility pass (Section 7).

## 20. Mobile interaction release blocker (found in founder QA)

**Founder-reported defects (real phone, LAN origin `http://192.168.1.179:3000`):**
all three Add Vehicle method buttons and the language toggle ignored taps.
Desktop `http://localhost:3000` worked.

**Reproduction environment:** Next.js 16 dev server, phone + Mac on the same
Wi-Fi, app opened at the Mac's LAN IP. Empirically: a `/_next/static/*.js`
chunk requested with the LAN origin returned **403** (localhost origin → 200),
and the dev log showed *"Blocked cross-origin request to Next.js dev resource
/_next/webpack-hmr from 192.168.1.179."*

**Root cause (single, shared, dev-only):** Next.js 16 blocks cross-origin
requests to dev resources from hosts not in `allowedDevOrigins`; only
`localhost` is trusted by default. From the phone the JS chunks were 403, so the
page rendered (SSR HTML) but **never hydrated** — every client control was inert.
The Add Vehicle buttons (`<button type="button">` + `onClick`) and the language
toggle (`<button>` + `setLocale`) were already correct; there was no component
bug. This affects `next dev` only — `next build`/`next start` and the production
HTTPS domain are unaffected, so it is **not** a production-code defect.

**Fix:** add a dev-only `allowedDevOrigins` in `next.config.ts`, driven entirely
by the `ALLOWED_DEV_ORIGINS` env var (comma-separated; set in a gitignored
`.env.development.local` for QA) — **no machine-specific IP is committed**. No
production trust boundary, CORS, Auth redirect, cookie, or server-action origin
check was changed. After the fix the LAN chunk returns 200 and hydration is
restored.

**Affected files:** `next.config.ts` (fix), `scripts/validation/mobile-interaction-check.mjs`
(new, 21 assertions), `package.json` (script), `scripts/qa/seed-local-qa.mjs`
(local QA fixtures).

**Focused tests:** `validate:mobile-interaction` — asserts the dev-origin fix is
present and dev-only, the three Add Vehicle controls are real non-disabled
`<button>`s wired to the state machine with no `<div onClick>` / no mobile
`hidden`, the language toggle is a hydratable labelled `<button>` invoking
`setLocale`, and locale/direction/cookie behavior works on both HTTP LAN and
HTTPS prod (SameSite=Lax, no hardcoded `Secure`). **No automated touch
validation was performed (no browser/device automation available); a real-device
manual retest is required.**

**Real-device retest checklist (phone via `http://192.168.1.179:3000`):**
1. Log in (`qa.owner@vinid.local` / QA password).
2. Add Vehicle → tap **Registration number** → registration input opens on first tap.
3. Back → tap **Scan vehicle registration** → camera/gallery upload opens.
4. Back → tap **Manual entry** → manual form opens.
5. Tap the **globe** language toggle → menu opens → pick עברית → UI switches to
   Hebrew **RTL**; pick English → **LTR**; session + workspace preserved.
6. Repeat 2–5 in both Hebrew and English; confirm no double-tap needed and no
   horizontal overflow.
Desktop (`http://localhost:3000`): confirm the same controls still work in
English LTR and Hebrew RTL.

**Visual gate:** still **pending** founder confirmation (now including the mobile
retest above).

## 21. Registration photo upload 1MB limit (found in founder mobile QA)

**Founder-reported defect:** vehicle-registration images larger than ~1MB could
not be uploaded on mobile, blocking the primary camera flow. The intended
product limit is JPEG/PNG/WebP up to 10MB.

**Failing layer:** the scan photo is uploaded through a **Next.js Server Action**
(`createRegistrationIntakeAction`, multipart `FormData`). Server Actions default
to a **1MB** request-body limit, so anything larger was rejected at the request-
body boundary *before* the action ran — under-1MB files worked, normal phone
photos (2–8MB) did not. Application validation already allowed 10MB
(`MAX_SCAN_FILE_SIZE`); the choke was purely the transport limit. The Next 16
proxy (`proxy.ts`) does not read the request body, so `proxyClientMaxBodySize`
was not a factor.

**Fix (transport vs application separation):**
- Transport ceiling: `experimental.serverActions.bodySizeLimit = "12mb"` in
  `next.config.ts` — just above 10MB to cover the file + multipart overhead,
  kept tight to bound request-memory/DoS exposure (not 50/100MB, not unlimited).
- Application limit: unchanged **10MB**, enforced **server-side** before any
  Storage upload or DB insert (files >10MB → `fileTooLarge`, no orphan object/
  row). MIME allowlist unchanged (JPEG/PNG/WebP; PDF/HEIC rejected).
- Added a **client-side** size pre-check (UX only, not security) so files above
  the transport ceiling get the friendly message instead of a raw error.
- `fileTooLarge` copy now states the 10MB limit in en + he.
- `allowedDevOrigins` (mobile fix) preserved; no security headers, CORS, Auth,
  RLS, or Storage privacy changed.

**Security:** auth + Fleet-writer still required before processing; 10MB limit
enforced server-side even if the client is bypassed; MIME allowlist intact;
private Storage; cancellation/failure cleanup intact; no file contents or PII in
logs.

**Focused tests:** `validate:upload-size-limit` — 25 assertions (transport >10MB
and tight; app limit exactly 10MB; the exact server predicate accepts
500KB/1.1MB/3MB/≤10MB and rejects >10MB; MIME allowlist; reject-before-upload/
insert ordering; single intake row; client pre-check; cancel cleanup; bilingual
copy).

**Real-device retest checklist (phone via `http://192.168.1.179:3000`):**
1. Log in (`qa.owner@vinid.local`). Add Vehicle → **Scan vehicle registration**.
2. Capture/choose a real authorized photo **>1MB and <10MB** → upload → extraction
   begins → Review appears → **no 1MB / body-size error**.
3. Cancel before final creation → confirm no orphan document remains.
4. Try a file **>10MB** → clear "image is too large… up to 10MB" message, nothing created.

**Visual gate:** remains **pending** founder confirmation.
