# Government Vehicle Data — Technical Spike (Task C)

Branch: `audit/government-vehicle-data` (off `feat/all-requested-improvements`).
Read-only research. No schema, form, or production behavior changed.
Evidence gathered from the live official API on **2026-08-02**.

---

## 1. Executive conclusion

**`GO WITH LIMITATIONS`.**

Israel's Ministry of Transport publishes active private + commercial vehicle
registration data on `data.gov.il` (CKAN DataStore). It is **queryable by exact
registration number**, returns rich, VIN-ID-relevant technical fields (make,
commercial model, year, color, fuel, chassis, tyres, engine, ownership *type*,
last-test date, **test-validity/expiry date**), is refreshed **daily**, is
**CORS-enabled**, carries an **Open** license, and — importantly — contains **no
owner names, ID numbers, or addresses**. A guarded CLI prototype validated the
full happy path and every failure mode against the live API.

The limitations that make this "GO **WITH LIMITATIONS**" rather than an
unconditional GO:

- **Coverage is per-population, across several resources.** The primary resource
  covers active private/commercial vehicles only. Motorcycles, personal-import,
  heavy trucks, inactive, and history live in **separate resources with
  different schemas** (chassis is `misgeret` in one, `shilda` in another;
  motorcycles carry **no test-expiry field**). An MVP should ship the **primary
  resource only** and treat "not found there" as a clean manual-entry fallback.
- **Latency is user-visible** (median ~1.5 s, slowest ~3.5 s observed) and there
  is **no published rate limit** — this must be a **server-side** call with a
  timeout, a short cache, and conservative traffic, never a browser call.
- **Data-quality quirks** must be handled: `mispar_rechev` returns as a numeric
  (leading zeros already lost at source), `moed_aliya_lakvish` is month-precision
  (`YYYY-M`), model can be a code rather than a name, and manufacturer text bundles
  the country (`"טויוטה יפן"`).
- **Resource IDs are not guaranteed permanent** — they must be configurable and
  discoverable via `package_show`, never hard-assumed.

The default hypothesis (server-side adapter, no local copy, short cache, manual
fallback, mapped-response-only, explicit user review) is **validated**.

---

## 2. Official sources

All published by **משרד התחבורה והבטיחות בדרכים** (Ministry of Transport & Road
Safety) on `data.gov.il`, the official Israeli open-data portal (CKAN).

- API base: `https://data.gov.il/api/3/action/`
- Actions used (all officially supported): `package_search`, `package_show`,
  `datastore_search`. `datastore_search_sql` **returned an HTML error page on
  this instance** — not usable, and not needed (we use parameterized `filters`).
- License on every relevant dataset: **"אחר (פתוח)" / "Other (Open)"**.

Authoritative documentation: data.gov.il CKAN API (`/api/3/action/help_show`)
and the dataset pages themselves. Third-party npm packages / blogs were **not**
used as a source of truth.

---

## 3. Dataset & resource inventory

`package_search` for "רכב" returned 42 Ministry-of-Transport datasets. The ones
relevant to registration-number lookup:

| Dataset (name) | Title (he) | Primary resource id | Records | DataStore | Role |
|---|---|---|---|---|---|
| `private-and-commercial-vehicles` | מספרי רישוי של כלי רכב פרטיים ומסחריים | `053cea08-09bc-40ec-8f7a-156f0677aff3` | ~4,162,982 | active | **PRIMARY** (active private+commercial) |
| `private-and-commercial-vehicles` | (continuation resource) | `0866573c-40cd-4ca8-91d2-9dd2d7a492e5` | — | active | continuation of the same dataset |
| `shinui_mivne` | היסטוריית כלי רכב פרטיים | `56063a99-…`, `bb2355dc-…` | ~2,432,956 | active | history: structural/color/tyre change flags, last-test km |
| `motorcycle` | מספרי רישוי דו-גלגליים | `bf9df4e2-d90d-4c0a-a400-19e15af8e95f` | ~190,448 | active | motorcycles/two-wheel |
| `personal_import_vehicles` | כלי רכב ביבוא אישי | `03adc637-b6fe-402b-9937-7c3d3afc9140` | ~27,414 | active | personal-import |
| `heavy-truck` | מעל 3.5 טון / חסרי קוד דגם | `cd3acc5c-03c3-4c89-9c54-d40f93c0d790` | — | active | heavy commercial |
| `rechev_le_pail_with_degem` | לא פעילים עם קוד דגם | `f6efe89a-…` | — | active | inactive w/ model code |
| `rechev_le_pail_without-degem` | לא פעילים חסרי קוד דגם | — | — | active | inactive w/o model code |
| `reshev_bitul_sofi` | ירדו מהכביש / ביטול סופי | — | — | active | de-registered/off-road |

All resource `last_modified` timestamps were **2026-07-31** (i.e. daily refresh;
observed two days before the spike). Publisher for all: Ministry of Transport.

> **Resource-ID durability:** IDs are stable in practice but not contractually
> permanent. VIN-ID must store the resource id in **configuration** and be able
> to re-discover it via `package_show?id=private-and-commercial-vehicles` →
> `resources[].id`. Never hard-code it as an immutable constant.

---

## 4. Coverage matrix

| Vehicle population | Primary resource | Status |
|---|---|---|
| Active private cars | ✅ | Covered |
| Active commercial (light) | ✅ | Covered |
| Motorcycles / two-wheel | ❌ primary | Covered only in `motorcycle` (different schema, **no test-expiry**) |
| Personal-import | ❌ primary | Covered only in `personal_import_vehicles` (`shilda` chassis, `sug_yevu`) |
| Heavy commercial (> 3.5 t) | ❌ primary | Covered only in `heavy-truck` |
| Inactive / deregistered | ❌ primary | Covered in `rechev_le_pail_*` / `reshev_bitul_sofi` |
| Vehicle history / structural change | ❌ primary | `shinui_mivne` (flags + last-test km) |
| Production-year / weight limits | — | No explicit cutoff observed in the primary resource |
| Taxis / public transport | partial | Some in `kli_rechev_ciburiim`; not the MVP target |
| Government / special / trailers | ❔ | **Unclear from official docs** — not verified |

**MVP decision:** query the **primary resource only**. Motorcycles and imports
are a **post-MVP** addition (each needs its own resource id + field map). Do not
infer national coverage — a "not found" is common and legitimate.

---

## 5. API request examples

Exact-match lookup (the recommended shape — parameterized `filters`, no SQL):

```
GET https://data.gov.il/api/3/action/datastore_search
      ?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3
      &filters={"mispar_rechev":<INTEGER>}
      &limit=2
```

- **Found** → `{ success:true, result:{ records:[ {…} ], total:1 } }`
- **Not found** → `{ success:true, result:{ records:[], total:0 } }`
- **Malformed filter** → HTTP **409**
- **Unknown resource_id** → `{ success:false, error:{ __type:"Not Found Error" } }`

Resource discovery: `GET /api/3/action/package_show?id=private-and-commercial-vehicles`.

---

## 6. Field inventory & mapping (primary resource)

| Source field | EN meaning | Type | Example (sanitized) | VIN-ID destination | MVP | Editable |
|---|---|---|---|---|---|---|
| `mispar_rechev` | registration number | numeric* | `…74` | `license_plate` | use | yes |
| `tozeret_nm` | manufacturer (+country) | text | `טויוטה יפן` | `make` | use | yes |
| `kinuy_mishari` | commercial model name | text | `COROLLA` | `model` | use | yes |
| `degem_nm` | model code | text | `ZRE151L-AEPDKW` | model_code (display) | display | yes |
| `shnat_yitzur` | production year | numeric | `2011` | `year` | use | yes |
| `tzeva_rechev` | color | text | `אפור כהה מטלי` | `color` | use | yes |
| `sug_delek_nm` | fuel type | text | `בנזין` | fuel (display/future) | display | yes |
| `misgeret` | chassis / VIN | text | *(masked)* | `vin` | use | yes |
| `tokef_dt` | **test/registration validity (expiry)** | text(date) | `2027-08-27` | `test_expiry_date` | use | yes |
| `mivchan_acharon_dt` | last test date | text(date) | `2026-07-13` | last_test_date (display) | display | yes |
| `moed_aliya_lakvish` | first road date | text(`YYYY-M`) | `2011-8` | first_road (display) | display | no |
| `degem_manoa` | engine model | text | `1ZR` | engine_model (future) | future | yes |
| `zmig_kidmi` / `zmig_ahori` | front/rear tyre | text | `195/65R15` | tyres (future) | future | yes |
| `baalut` | ownership **type** | text | `פרטי` | ownership_type (display) | display | no |
| `kvutzat_zihum` | pollution group | numeric | `15` | — | ignore | n/a |
| `ramat_eivzur_betihuty` | safety level | numeric | `null` | — | future | n/a |
| `ramat_gimur` | trim level | text | `SUN` | trim (future) | future | yes |
| `tozeret_cd`/`degem_cd`/`sug_degem`/`tzeva_cd`/`horaat_rishum` | internal codes | mixed | — | — | ignore | n/a |

\* `mispar_rechev` is declared numeric and **returns as a string with leading
zeros already removed at source**.

**Personal-import differences:** chassis is **`shilda`** (not `misgeret`), no
`kinuy_mishari` (model comes from `degem_nm`), adds `sug_yevu` (import type),
`tozeret_eretz_nm` (country), `nefach_manoa` (displacement). **Motorcycles** add
`hespek` (power), `nefach_manoa`, `mishkal_kolel` (gross weight),
`mispar_mekomot` (seats) and — critically — **carry no `tokef_dt`**.

**MVP fields written to the draft:** `license_plate, make, model, year, vin,
color, test_expiry_date` (+ `fuel` display). Everything else is display-only or
future. Rationale: each MVP field contributes to identifying the vehicle,
compliance, or Passport quality; we do **not** persist every government field.

**Missing-data behavior:** any field may be null; the draft carries nulls through
and the user fills gaps manually.

---

## 7. Test results (prototype + live)

Prototype: `scripts/research/government-vehicle-data-spike.mjs` (pure functions +
guarded CLI). Offline suite `…-spike.test.mjs`: **42 assertions, 0 failures**,
covering valid/normalized input, spaces & hyphens, invalid characters, too-short
/ too-long, leading-zero preservation, found, not-found, partial/duplicate
result, malformed provider response, 4xx, 5xx, malformed JSON, and timeout —
all with a **mocked transport** (no network in CI).

Live validation (opt-in `--live`, output masked): exact filter returned exactly
one record for sampled public plates (Toyota Corolla 2011, Hyundai Accent 2009);
`total:0` for absent plates; end-to-end map produced a correct masked draft.

---

## 8. Data-quality & conflict risks

| Risk | Observed? | Handling |
|---|---|---|
| Numeric field as string | yes | treat `mispar_rechev` as string; query by integer value |
| Leading zeros lost | yes (source) | normalize to integer for query; warn `registration_number_had_leading_zero` |
| Month-precision date (`YYYY-M`) | yes (`moed_aliya_lakvish`) | never coerce to a day; mark partial |
| Coded model vs name | yes | prefer `kinuy_mishari`, fall back to `degem_nm` + warn |
| Manufacturer includes country | yes (`טויוטה יפן`) | keep as-is; user-editable |
| Multiple manufacturer/model fields | yes | explicit precedence in mapper |
| Chassis field differs per resource | yes (`misgeret`/`shilda`) | mapper checks both |
| >1 record for exact filter | possible | take first + warn `multiple_records_returned` |
| Stale / expired `tokef_dt` | possible | surface as a proposal; never auto-act |
| Same plate in multiple resources | yes (history/inactive) | MVP queries primary only |
| Resource swap / schema change | possible | config-driven resource id + runtime response validation |

**Source-precedence proposal (validated):** user confirmation is final →
structured government data is a *proposal* → document-AI may add a competing
proposal → **existing saved data is never silently overwritten** → conflicts are
shown explicitly on the Review screen.

---

## 9. Date interpretation

| Field | Meaning | Format | VIN-ID use |
|---|---|---|---|
| `tokef_dt` | test/registration **validity end (expiry)** | `YYYY-MM-DD` | → `test_expiry_date` (proposal only; **no auto-reminder**) |
| `mivchan_acharon_dt` | **last** test performed | `YYYY-MM-DD` | display / history context |
| `moed_aliya_lakvish` | first on-road | `YYYY-M` (month precision) | display only; never a day-level date |
| `rishum_rishon_dt` (history) | first registration | date | future/history |
| resource `last_modified` | dataset refresh time | ISO | freshness signal, not a vehicle date |

Timezone: dates are plain calendar dates (no tz); treat as local calendar dates.
`tokef_dt` is the **only** date safe to map to VIN-ID's `test_expiry_date`, and
even then only as a user-confirmed proposal — **no reminder is auto-created**.

---

## 10. Privacy & terms

- **License:** "Other (Open)" on every relevant dataset — open reuse. **Legal
  question requiring confirmation:** exact attribution/redistribution wording of
  the specific "Other (Open)" terms (classified below as a legal question).
- **Personal data:** the primary resource exposes **no owner name, ID number, or
  address**. `baalut` is an ownership *category* (`פרטי`/company), not identity.
  *(official documented fact — verified against the live field list.)*
- **Attribution:** recommended — display "Source: Israel Ministry of Transport,
  data.gov.il" and the `fetchedAt` timestamp on the draft. *(technical inference.)*
- **Caching:** response carries `cache-control: public, max-age=3600,
  s-maxage=14400`. A short server cache is consistent with the provider's own
  headers. *(official documented fact.)*
- **Storage recommendation:** store only the **mapped VIN-ID fields** the user
  confirms. **Do not** store the raw provider response long-term (a short-lived
  in-memory/transient cache only). Do not expose raw responses across
  organizations. Treat the registration number as ordinary vehicle data, but keep
  it **out of analytics/event logs**.
- **Do not** use the integration to infer ownership authorization — presence in
  the dataset is not proof the VIN-ID user owns the vehicle.

Classification: license openness, no-personal-data, CORS, cache headers =
**official documented facts**; attribution/retention specifics = **technical
inference**; precise redistribution terms = **legal question requiring
confirmation**.

---

## 11. Architecture comparison

| | A — Browser direct | B — VIN-ID server route | C — Local synced copy |
|---|---|---|---|
| CORS | works (`*`) | n/a | n/a |
| Input validation | client only (weak) | **server-enforced** | server |
| Timeout/retry control | poor | **full** | n/a |
| Caching | per-browser only | **shared, controllable** | inherent |
| Rate/abuse control | none | **server-side** | n/a |
| Observability | none | **full (no PII)** | full |
| Resource-id swap | redeploy client | **config change** | re-sync |
| Schema-change isolation | leaks to client | **contained in adapter** | contained |
| Freshness | live | live | staleness risk |
| Complexity/scope | low | **moderate (right size)** | high (4M+ rows, sync infra) |
| Privacy | exposes provider to client | **provider isolated** | data duplication |

**Recommended: Option B — a narrow server-side adapter.** No local dataset copy
for the MVP (4M+ rows, sync infra, licensing overhead = premature). Short
conservative cache; official-source-unavailable → manual entry.

---

## 12. Recommended adapter contract

Full type-only draft in `scripts/research/vehicle-lookup-contract.ts` (isolated;
imported by nothing). Result union: `found | not_found | unavailable |
invalid_registration_number`. The draft carries only mapped, non-personal fields
plus `warnings[]` and optional per-field `provenance` for the future Review
screen. Recommended defaults:

- **Normalization:** strip spaces/hyphens, digits only, length 5–8, query by
  integer value, keep original digit string.
- **Timeout:** 8 s. **Retry:** at most one retry, only for timeout/429/5xx.
- **Cache:** key = normalized number + resource id; TTL 15–60 min.
- **Errors:** map to the union; never throw to the caller.
- **Observability:** emit `{ status, resourceId, latencyMs, retryable,
  warningCount }` — **never** the plate, VIN, or raw response.

---

## 13. Duplicate vehicle rules

Current VIN-ID state: **no uniqueness constraint** on `license_plate` or `vin`,
and **no plate normalization** (the form just trims). Vehicles are
`organization_id`-scoped.

Proposed future behavior (no global uniqueness constraint):

| Scenario | Rule |
|---|---|
| Same plate, same workspace | **Warn + offer to open the existing vehicle** before creating a duplicate (soft check at draft/confirm). |
| Same plate, Personal *and* Business | Allowed — different workspace contexts; no cross-workspace check. |
| Same plate, two Business orgs | Allowed — separate tenants. |
| Plate edited manually | Allowed; re-run the in-workspace soft check on save. |
| Lookup finds an existing vehicle | Surface the existing match; do not auto-create. |
| Historical plate change | Out of scope for MVP; keep as history later. |

**Migration impact:** none required for the MVP. A future **normalized plate
column + partial index scoped to `(organization_id, normalized_plate)` among
non-deleted rows** would make the soft duplicate check efficient — additive, no
global constraint. Do **not** add a global unique index (the same physical
vehicle may legitimately exist in different workspaces).

---

## 14. Government data vs license AI (future division)

| Provides | Government lookup | Vehicle-registration AI |
|---|---|---|
| Structured technical data (make/model/year/fuel/engine/tyres) | ✅ primary | secondary |
| Official test/registration dates | ✅ (`tokef_dt`) where present | from document |
| Chassis/VIN | ✅ (`misgeret`/`shilda`) | from document |
| Document-only fields / evidence snapshot | — | ✅ |
| Values missing from government source | — | ✅ (fills gaps) |
| Conflict detection + document retention | — | ✅ |

**Review screen (future):** for each field show *Government value* · *Document
value* · *Existing VIN-ID value* · *User-selected final value*, with the
user's choice authoritative. Not implemented in this spike.

---

## 15. Security review

| Risk | Mitigation (recommended) |
|---|---|
| SSRF | **fixed host + fixed action**; no user-controlled URL. |
| Query injection into CKAN filters | use `datastore_search` **`filters`** (parameterized JSON), never `datastore_search_sql`; value is a validated integer string. |
| Malicious/over-long input | strict normalization (digits, 5–8) **before** any request. |
| Logging registration numbers/VIN | **redacted logs/events** — status + latency only. |
| Cross-org leakage | duplicate checks are **organization-scoped**; drafts are request-scoped. |
| Exposing raw provider responses | return only the mapped draft; never persist/expose raw JSON. |
| Client tampering with the draft | server **re-validates + re-normalizes at confirmation time**; RLS still governs the write. |
| Save without confirmation | nothing persists until explicit user confirm (existing VIN-ID pattern). |
| Rate abuse / DoS on the provider | server-side timeout + short cache + conservative traffic; absence of a published rate limit is **not** permission for unlimited calls. |
| Schema poisoning / unexpected fields | **runtime response validation**; unknown fields ignored; malformed → `unavailable`. |

---

## 16. MVP implementation scope (if scheduled)

Smallest useful slice:

1. Server-side lookup adapter (Option B), primary resource only, config-driven id.
2. Registration-number input + strict normalization.
3. Editable **Vehicle Draft** pre-filled from the mapped fields.
4. Selected technical fields only: `license_plate, make, model, year, vin, color,
   test_expiry_date` (+ fuel display).
5. Manual-entry fallback on `not_found` / `unavailable`.
6. Explicit user confirmation before any save.
7. Store `source` + `fetchedAt`; set `trust_label = 'external_source'` on
   government-originated values (the vocabulary already exists).
8. Organization-scoped soft duplicate check by normalized plate.
9. Timeout + `unavailable` UX states.
10. Tests using the **sanitized contract fixtures** (offline; live opt-in).

**Explicitly excluded:** full history, motorcycle/import resources, recurring
sync, auto-overwrite, bulk import, AI scanning, ownership verification, paid
providers, raw-response storage, background refresh.

---

## 17. Acceptance criteria (for the future MVP)

- A valid plate returns an editable draft with the MVP fields; nothing is saved
  until the user confirms.
- `not_found` / `unavailable` / `invalid_registration_number` each render a
  distinct state and always leave manual entry available.
- The provider is called **server-side only**, with a timeout and a short cache;
  no plate/VIN appears in logs.
- Confirmed government values are stored with `source`, `fetchedAt`, and
  `trust_label='external_source'`; existing values are never silently overwritten.
- A same-plate vehicle in the same workspace triggers a duplicate warning.
- Offline tests pass in CI; live tests are opt-in.

---

## 18. Risks & open questions

- **Legal (confirm):** exact attribution/redistribution wording of the "Other
  (Open)" license for these specific datasets.
- **Coverage:** motorcycles/imports/heavy/trailers/government vehicles need
  additional resources — deferred; confirm product appetite before adding.
- **Resource-id drift:** must be handled via config + `package_show` discovery.
- **Latency/rate limits:** no published limit; keep traffic conservative and
  cached; watch for 429s in production.
- **Model/manufacturer normalization:** coded models and country-suffixed
  manufacturers may need a display cleanup pass (post-MVP).

---

## Final decision

**`GO WITH LIMITATIONS`** — implement the server-side, primary-resource-only
lookup MVP in §16, with manual fallback, explicit confirmation, and the security
and privacy controls above. Defer motorcycle/import/history resources, resolve
the license-wording question, and never treat the source as an unverified source
of truth.
