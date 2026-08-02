# Government Vehicle Lookup — Implementation (Task D)

Branch: `feat/government-vehicle-lookup` (off `feat/all-requested-improvements`).
Implements the approved `GO WITH LIMITATIONS` MVP from
[`docs/government-vehicle-data-spike.md`](government-vehicle-data-spike.md).

Government data is an **external proposal**, never ownership or verification. The
final saved vehicle is always the user's confirmed, editable record.

---

## 1. Final architecture

```
Add Vehicle (client flow)
  └─ method select → registration lookup ──▶ lookupVehicleAction (server)
                                              └─ lib/vehicle-lookup/service.lookupVehicle
                                                   ├─ normalize-registration (shared)
                                                   ├─ in-memory TTL cache
                                                   ├─ israel-government-provider (fetch, timeout, retry, zod validation)
                                                   └─ map-government-vehicle (record → draft)
  └─ Review (reuses VehicleForm, prefilled) ─▶ createVehicleAction(values, {source, fetchedAt})
                                              └─ createVehicle (dup check + source metadata)
  └─ manual entry (VehicleForm, empty) ──────▶ createVehicleAction(values)
```

- **Server-side only.** The browser never calls `data.gov.il`. Lookup runs in a
  server action (`lookupVehicleAction`) that mirrors vehicle-create authorization
  (`requireFleetWriter`).
- **No vehicle is created during lookup.** Only the final `VehicleForm`
  submission (confirmation) creates one, through the normal `createVehicle` path.
- **Manual entry is always available** — before lookup, after not-found, after
  any provider failure, and from the review's back action.

## 2. Configured official source

- Host (fixed): `https://data.gov.il/api/3/action/` — enforced in
  [config.ts](../lib/vehicle-lookup/config.ts); any non-`data.gov.il` base is rejected.
- Action (fixed): `datastore_search`.
- Primary resource (env-overridable, UUID-validated):
  `053cea08-09bc-40ec-8f7a-156f0677aff3` (active private + commercial vehicles).
- Server-only env: `GOV_VEHICLE_RESOURCE_ID`, `GOV_VEHICLE_API_BASE_URL`,
  `GOV_VEHICLE_TIMEOUT_MS`, `GOV_VEHICLE_CACHE_MS`, `GOV_VEHICLE_NOT_FOUND_CACHE_MS`.
  **None** is `NEXT_PUBLIC_*`. No per-request package discovery; an operator
  verifies the resource out of band via `package_show`.

## 3. Field mapping

Query: `datastore_search?resource_id=…&filters={"mispar_rechev":<int>}&limit=2`.

| Government field | Draft field | MVP |
|---|---|---|
| `mispar_rechev` | `license_plate` | ✅ persisted |
| `tozeret_nm` | `make` | ✅ |
| `kinuy_mishari` → `degem_nm` | `model` (prefers commercial name) | ✅ |
| `shnat_yitzur` | `year` | ✅ |
| `misgeret` | `vin` | ✅ |
| `tzeva_rechev` | `color` | ✅ (new column surfaced) |
| `sug_delek_nm` | `fuel_type` | ✅ (new column) |
| `tokef_dt` | `test_expiry_date` (proposal) | ✅ |
| `mivchan_acharon_dt` | display only (last test) | display |
| `baalut` | display only (ownership **type**, not identity) | display |

Warnings surfaced on the Review screen: leading-zero plate, coded model,
unparseable expiry, expired expiry, partial data. Month-only dates
(`moed_aliya_lakvish`) are never mapped to a full date. No owner name/ID/address
is read or stored — it is not representable in the draft type.

## 4. Source metadata

New additive columns on `vehicles`
([migration](../supabase/migrations/20260802130000_vehicle_source_metadata.sql)):
`fuel_type`, `data_source` (`null`|`manual`|`israel_government`, CHECK-constrained),
`government_fetched_at`, `government_resource_id`. Provenance only — **not**
`verified`. All nullable; existing rows unaffected; no backfill.

- `data_source`/`fetchedAt`/`resourceId` are **server-set**: the action accepts
  only `source: "israel_government"` from the client (allowlist) and re-derives
  `government_resource_id` from server config — the client cannot forge it.
- The **raw provider response is never stored**. Only mapped, confirmed fields
  plus the three metadata columns persist.

## 5. Normalization

One shared utility ([normalize-registration.ts](../lib/vehicle-lookup/normalize-registration.ts))
used by lookup, the duplicate check, and creation:

- accept digits/spaces/hyphens; strip spaces/hyphens; reject letters;
- keep the result a **string** (never `parseInt` in app code) — leading zeros are
  preserved for display/storage;
- valid length 5–8 digits;
- the numeric CKAN filter value is derived (leading zeros dropped) **only inside
  the provider adapter**, after validation.

**Leading-zero limitation:** the source stores `mispar_rechev` as numeric, so
leading zeros are already absent there. A found record with a leading-zero plate
raises a warning. Stored plates are **not** rewritten by this task.

## 6. Duplicate rules

Workspace-scoped **soft** check ([service.findVehicleByRegistration](../lib/vehicles/service.ts)):
compares normalized keys among the active org's non-deleted vehicles.

- **Same workspace:** creation is blocked; the UI shows a warning and an *Open
  existing vehicle* link. Checked both at Review time and again at confirmation
  (server, `createVehicle` throws `DuplicateVehicleError`).
- **Different workspaces:** allowed; the check is org-scoped, so it never
  discloses that a plate exists in another workspace.
- **No global unique constraint.** Null/blank plates are exempt.

## 7. Cache & retry

- **Cache:** in-process TTL map keyed `israel_government:<resourceId>:<numeric>`.
  Found = 30 min, not-found = 5 min; failures and config errors are **never**
  cached. Best-effort (per-instance on serverless). A resource-id change
  invalidates all entries automatically (it is part of the key).
- **Retry/timeout:** 8 s **total** budget across at most **one** retry; retry only
  on timeout / 429 / 5xx; never on 4xx, not-found, ambiguous, invalid, or config.
  The retry shares the total deadline, so worst-case wait stays ~8 s.

## 8. Runtime validation

The CKAN envelope is validated with zod in the provider — success flag, result
object, records array; records are validated loosely (unknown fields ignored) and
never spread into app objects. `>1` record for an exact filter → **ambiguous**
(never auto-picked). Malformed envelope → `unavailable(invalid_response)`.

## 9. Review flow & reminders

Review reuses the shared `VehicleForm` prefilled with the draft, under a banner
showing **Official government data**, the retrieval time, an ownership disclaimer,
warnings, and any duplicate notice. Every field is editable; the user's value
overrides the proposal. No green "verified" badge.

**Reminders:** the confirmed `test_expiry_date` is saved to its vehicle field.
**No reminder is auto-created** — this task does not change the reminder system;
reminders remain created explicitly elsewhere as before.

## 10. Security

Fixed host + fixed action + parameterized `filters` (no SQL, no user-controlled
URL/host/action/resource id) → no SSRF/injection. Authenticated,
create-capable users only (`requireFleetWriter`). Duplicate check is
org-scoped. Confirmation re-validates auth, org, input, and duplicates
server-side. Raw responses are never exposed or stored. Observability
(`trackEvent`) records status only — the analytics layer already forbids
plate/VIN keys. No service-role key in client code; no RLS change; no
unauthenticated proxy.

## 11. Tests

- **Focused:** `validate:government-vehicle-lookup` — **51 assertions**
  (normalization, dates, mapper, provider transport with mocked fetch incl.
  409/429/500/timeout/malformed/one-retry/ambiguous/unexpected-fields, service
  orchestration + cache, read-only source guard, and a guarded DB section for the
  migration columns + CHECK). CI never calls the live API.
- **Live opt-in:** `GOV_VEHICLE_LIVE_TEST=1 npm run validate:government-vehicle-live -- <reg>`
  — one real masked lookup; writes nothing; excluded from CI.
- **Full regression:** clean `db reset` (46 migrations), **813 assertions, 0
  failures** (762 baseline + 51). tsc clean, ESLint clean, `next build` compiles,
  en/he parity 1244/1244.

## 12. Limitations

- Primary resource only: motorcycles, personal-import, heavy trucks, inactive/
  deregistered vehicles are out of scope — a `not_found` there is expected and
  never proves the vehicle does not exist.
- Leading zeros may be lost at the source (warned).
- Model/manufacturer may be coded/abbreviated or country-suffixed (warned; user-editable).
- `Other (Open)` license: attribution wording is an open legal question, not a blocker.

## 13. Production configuration

Set (optional — defaults are safe): `GOV_VEHICLE_RESOURCE_ID` if the resource
changes. Ensure server egress to `https://data.gov.il` is allowed. No secret is
required by the provider.

## 14. Release plan

1. Back up production.
2. Apply migration `20260802130000` (additive; no backfill, no RLS change).
3. Deploy the app.
4. Smoke test: Add Vehicle → registration → Review → confirm; not-found →
   manual; duplicate warning; Personal and Business workspaces.

## 15. Rollback

- **App:** revert the deploy — the previous Add Vehicle worked against the new
  schema (new columns simply go unused; the lookup action goes uncalled).
- **DB:** the columns are additive and nullable; they can be left in place
  harmlessly, or dropped if required. No data migration to unwind.

## 16. Future AI integration points

The draft type carries optional per-field provenance for a future Review that
shows *Government value · Document value · Existing value · User-selected value*.
Vehicle-registration AI (OCR) will fill document-only fields, provide an evidence
snapshot, and detect conflicts — out of scope here. `trust_label='external_source'`
already exists for government-originated record values.
