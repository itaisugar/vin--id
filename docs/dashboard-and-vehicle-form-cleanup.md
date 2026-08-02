# Dashboard & Vehicle-Form Cleanup

Branch: `fix/dashboard-and-vehicle-form-cleanup` (from `main` @ `1c5a27b`).
UI cleanup only — no DB migration, no data change, no new features.

---

## 1. Audit (read-only, before editing)

### Dashboard

* **One dashboard**: `app/(app)/dashboard/page.tsx`. The Fleet Dashboard is the
  single post-login home — the old consumer dashboard was folded into it, so
  Private and Fleet share it. It renders `FleetSummaryCards`, an optional
  fleet-intake button, `ActionList`, `FleetInsights`, `DeadlineList`.
* **"Document Expiring" = two stat tiles** in
  `components/fleet/fleet-summary-cards.tsx`: `documentsExpired` ("Documents
  expired") and `documentsExpiringSoon` ("Documents expiring"), both linking to
  `/vehicles?filter=document_expiring`.
* **Data path**: `getFleetOverview()` → `summary.documentsExpired` /
  `summary.documentsExpiringSoon`, computed in `lib/fleet/service.ts` from the
  per-vehicle `classifyDocumentExpiry()`. **These summary fields are also asserted
  by the `fleet-manager` validation suite** (`scripts/validation/
  fleet-manager-check.mjs` + `lib/fleet-fixture.mjs`), so the computation stays;
  only the two dashboard tiles are removed.
* **Expiry stays available** in: `ActionList` (`document_expired` /
  `document_expiring` action rows), `DeadlineList` ("Upcoming maintenance &
  documents", `document_expiry`), the `/vehicles?filter=document_expiring` list,
  Documents, Service & Compliance, and Fleet Insights. No expiry logic is removed.

### Vehicle forms

* **One shared form** `components/vehicles/vehicle-form.tsx` for both `create` and
  `edit`. Photo URL is a single `<Field name="photo_url">` (type `url`), plus a
  `"photo_url"` entry in `FIELD_NAMES`.
* **Schema/types/payload** all in `lib/vehicles/types.ts`: `photo_url` in
  `vehicleBaseSchema`, `VehicleFormValues`, `EMPTY_VEHICLE_FORM`,
  `vehicleToFormValues` (edit defaults), and `vehicleInputToRow` (payload).
* **Critical**: `vehicleInputToRow()` is used by **both** `createVehicle`
  (`.insert`) and `updateVehicle` (`.update` — a full-row update). It currently
  forces `photo_url: input.photo_url ?? null`, so an edit with the input removed
  would **overwrite an existing photo_url with null**. Fix: **omit `photo_url`
  from `vehicleInputToRow`** — create then relies on the nullable column default,
  and update never touches the column, preserving any stored value.
* **Display path preserved**: `Vehicle.photo_url`, `VEHICLE_COLUMNS`, and
  `components/vehicles/vehicle-card.tsx` (renders the image) are unchanged.
* `photo_url` is a **nullable** column; existing vehicles may have a value. **No
  migration needed.**
* **Now-unused translation keys** (only the removed field/schema referenced them):
  `vehicles.fields.photoUrl`, `vehicles.form.errors.invalidUrl` — removed from
  both locales. `tooLong` is shared and kept.

### Minimum safe change — files expected to change

* `components/fleet/fleet-summary-cards.tsx` — remove the two expiry tiles.
* `components/vehicles/vehicle-form.tsx` — remove the Photo URL field + FIELD_NAMES entry.
* `lib/vehicles/types.ts` — remove `photo_url` from the schema, form-values type,
  empty defaults, edit mapper, and payload builder (keep the read `Vehicle` type
  and `VEHICLE_COLUMNS`).
* `messages/en.json`, `messages/he.json` — remove the four now-unused keys.
* tests + this doc.

---

## 2. Changes made

### A. Dashboard — Document Expiring removed

`components/fleet/fleet-summary-cards.tsx`: removed the two stat tiles
`documentsExpired` ("Documents expired") and `documentsExpiringSoon` ("Documents
expiring"). Both expiry summaries are gone, so no equivalent duplicate remains.
The tile grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`, no fixed positions,
separators or per-tile headings) reflows cleanly from 9 → 7 tiles — no gap,
placeholder or empty heading.

**Preserved:** `summary.documentsExpired` / `documentsExpiringSoon` are still
computed in `lib/fleet/service.ts` (and still asserted by the fleet-manager
suite); document expiry still appears in the `ActionList`
(`document_expired` / `document_expiring`), the `DeadlineList`
(`document_expiry`), the `/vehicles?filter=document_expiring` view, Documents and
Service & Compliance. No query, field, reminder or expiry date was removed.

### B. Vehicle forms — Photo URL removed

* `components/vehicles/vehicle-form.tsx`: removed the `<Field name="photo_url">`
  input and the `"photo_url"` entry in `FIELD_NAMES`. The form is shared by
  create and edit, so both lose the field at once.
* `lib/vehicles/types.ts`: removed `photo_url` from `vehicleBaseSchema`,
  `VehicleFormValues`, `EMPTY_VEHICLE_FORM`, `vehicleToFormValues` (edit
  defaults) and `vehicleInputToRow` (payload). **Kept** `Vehicle.photo_url` and
  `VEHICLE_COLUMNS` (read/display path).
* `messages/{en,he}.json`: removed the four now-orphaned keys
  `vehicles.fields.photoUrl`, `vehicles.form.errors.invalidUrl`,
  `fleet.summary.documentsExpired`, `fleet.summary.documentsExpiringSoon`.

**Photo-data behaviour (critical):** `vehicleInputToRow` is used by both
`createVehicle` (`.insert`) and `updateVehicle` (full-row `.update`). By omitting
`photo_url` from the payload, CREATE relies on the nullable column default (null)
and UPDATE never touches the column — so **editing any other field preserves an
existing stored photo_url**. Any stray `photo_url` posted by a tampered client is
stripped by the Zod object schema. **No migration; the column is unchanged.**

## 3. Tests

New suite `scripts/validation/dashboard-vehicle-cleanup-check.mjs`
(`npm run validate:dashboard-vehicle-cleanup`) — **18 assertions**:

* source: schema/form-values/defaults/edit-mapper/payload own no `photo_url`
  (only the read `Vehicle` type + `VEHICLE_COLUMNS` keep it); URL rule gone;
  the form renders no Photo URL input; the dashboard renders no expiry tile or
  tile link; image display still reads `photo_url`; expiry counts/actions/
  deadlines still computed.
* i18n: the four keys are gone from both locales, needed keys survive, and en/he
  are at full key parity (no missing keys either side).
* data (local Supabase): a vehicle is created without a photo URL (stored null);
  editing another field with a `photo_url`-less payload **preserves** an existing
  stored URL; a null-photo vehicle stays editable.

### Full regression (clean `db reset`, 44 migrations)

| Suite | Assertions |
| --- | --- |
| fleet-tenancy | 51 |
| document-storage | 25 |
| organization-members | 79 |
| fleet-manager | 50 |
| driver-view | 116 |
| fleet-ai-intake | 85 |
| private-vehicle | 120 |
| qa-quick-wins | 62 |
| multi-workspace | 57 |
| member-removal | 42 |
| **dashboard-vehicle-cleanup (new)** | **18** |
| **total** | **705** |

Zero failures. `tsc --noEmit` clean, ESLint clean (0 warnings), `next build`
compiles. Six SQL audits unaffected.

## 4. Manual responsive/UI checks (recommended before release)

No component-render test infra exists in this repo, so verify by hand in both
English and Hebrew (RTL), at narrow-mobile / mobile / tablet / desktop widths:

* Dashboard top row reflows with 7 tiles, no empty cell or stray separator.
* Add Vehicle and Edit Vehicle show no Photo URL field; the form still submits.
* Editing a vehicle that has a stored photo does not remove its image on the
  vehicle card/detail afterwards.
* No raw translation key (e.g. `vehicles.fields.photoUrl`) appears anywhere.

## 5. Risks

* **Low.** UI-only removal; no schema/data change, no migration, no RLS/auth/
  workspace change. The one behavioural subtlety — edit not erasing a stored
  photo — is covered by a DB test.
* The `summary.documentsExpired*` fields are now computed but not shown on the
  dashboard; kept deliberately (still validated, still available to other
  surfaces). Not dead code.
* Remaining verification is the manual responsive/RTL pass above.

## 6. Production release checklist

1. Open PR `fix/dashboard-and-vehicle-form-cleanup` → `main`; diff is UI + tests
   + docs only (no migration).
2. Merge after checks pass; allow the normal Vercel production deploy.
3. Post-deploy: confirm the dashboard has no Document-Expiring tile, Add/Edit
   Vehicle have no Photo URL field, an existing vehicle photo survives an edit,
   and Hebrew/RTL render with no missing keys.

No database migration and no production data change are involved.
