# Fleet Lite — AI document intake and deterministic insights

Phase 6. Turns an uploaded vehicle document into a structured, confirmed
operational record, and extends Fleet Insights with severity, evidence links
and the two rules that were missing.

Migration: `20260726120000_fleet_document_intake.sql`
Audit: `supabase/audits/fleet_intake_audit.sql`
Harness: `npm run validate:fleet-ai-intake`

---

## Starting audit — what was actually there

Two half-flows, neither usable for Fleet:

| | Flow A — "Scan a document" | Flow B — "Extract with AI" |
| --- | --- | --- |
| Entry | `/scan` | a document's detail page |
| Provider | **real** (Anthropic when a key is set, else mock) | **mock only** |
| Extraction persisted? | **no** — in-memory, discarded | yes, with raw/confirmed split |
| Produces | real maintenance / issue / insurance / registration / inspection records | six metadata fields on the document |
| Vehicle | chosen up front | inherited from the document |
| Provenance | **none** | partial |
| Duplicate protection | none | none |

So the flow that created records kept no evidence, and the flow that kept
evidence created nothing. Flow B already had the right shape, so
`document_extractions` became the single intake record for both.

Two defects found in the read-only pass and fixed here:

* **`/scan` gated only drivers, not viewers.** A viewer could open it and spend
  a paid extraction call on a record the server would then refuse to save. The
  dashboard entry point is now writer-only, and `runFleetExtraction()` requires
  `requireFleetWriter()`.
* **`createMaintenanceLog` / `createIssue` use `requireOrganization()`, not
  `requireFleetWriter()`.** Writes are still blocked — the RLS INSERT policy is
  `is_org_writer()` — but the service layer does not pre-check. Left as-is
  (changing it is out of this phase's scope) and noted here; the intake path
  does not rely on it, because `confirm_fleet_intake()` checks the role itself.

---

## The safety rule, enforced in the database

```
upload → extract → review/edit → EXPLICIT confirm → persistence
```

`confirm_fleet_intake()` is the **only** function in the intake path that
writes an operational record. Uploading and extracting are inert: they put a
file in Storage and a reviewable row in `document_extractions`, and change
nothing on the dashboard, the Passport or any alert.

The rule is stated structurally, not just in code:

```sql
check (
  (status = 'confirmed' and created_record_id is not null and confirmed_at is not null)
  or (status <> 'confirmed' and created_record_id is null)
)
```

A row cannot claim a record without being confirmed.

### What confirmation does, in one transaction

1. rejects an unauthenticated caller, and anyone who is not
   owner/admin/fleet_manager (`is_org_writer()` — viewer and driver both fail),
2. locks the extraction row `FOR UPDATE`,
3. returns the **existing** record id if already confirmed — a double-click,
   a network retry and three concurrent requests all produce one record,
4. refuses a `cancelled` or `superseded` review,
5. re-resolves the vehicle inside the caller's organization: a forged id, a
   cross-tenant id or a deleted vehicle all fail,
6. creates exactly one record, linked to the source document, with
   `trust_label='ai_extracted'` and `source_type='fleet_intake'` forced
   server-side,
7. applies monotonic derived updates,
8. records who confirmed, when, under which category, and which record resulted.

---

## Vehicle matching

Deterministic and identifier-first. `match_fleet_vehicles()` runs in the
database, scoped by `current_org_id()` with **no organization parameter**, so
there is nothing to forge.

| Tier | Rule |
| --- | --- |
| 1 | exact VIN / chassis |
| 2 | exact licence plate as printed |
| 3 | plate ignoring case and separators (`12-345-67` = `12 345 67` = `1234567`) |

Make, model, driver name, filename and general similarity are **never** matched
on. Every candidate at the strongest tier that produced a hit is returned; the
function never picks a winner among equals.

A document is attached automatically **only** when a strong identifier produced
exactly one candidate (`requiresManualVehicleSelection`). No identifier,
several candidates, or identifiers that disagree with a preselected vehicle all
force a manual choice. A vehicle-detail upload whose document names a different
vehicle is reported as `conflict` and must be resolved explicitly.

Cross-tenant matching is impossible: the harness seeds an Org B vehicle
carrying Org A's exact VIN and asserts each organization sees only its own.

> **Driver leak caught by the harness.** `match_fleet_vehicles()` is SECURITY
> DEFINER, so its read of `vehicles` bypasses the policy restricting a driver to
> one assigned vehicle. Without an explicit `is_org_driver()` guard a driver
> could have enumerated the whole fleet one plate guess at a time, re-opening
> the hole `20260725220000_driver_rls.sql` closed. **Every SECURITY DEFINER
> function that reads an org-scoped table must restate the driver rule; it is
> not inherited.**

---

## Confidence

The provider returns one 0..1 confidence for the **classification**. It does
not report per-field confidence, so this codebase does not display any —
inventing a per-field score would be worse than showing none.

| Level | Threshold | Behaviour |
| --- | --- | --- |
| accepted | ≥ 0.8 | category pre-selected, still fully editable |
| review | ≥ 0.5 | pre-selected with a visible "please check" |
| manual | < 0.5, or `unknown` | **nothing pre-selected** — the user must choose |

Low confidence in vehicle identity always forces manual review, independent of
category confidence.

Every field shows what the model read next to the value that will be saved, and
marks the ones the user changed. `extracted_data` is never overwritten;
corrections go to `confirmed_data` and the per-field diff to `field_provenance`.

---

## Derived vehicle updates

All monotonic and deterministic:

| Field | Rule |
| --- | --- |
| `current_mileage` | upward only — an odometer cannot fall, so a late-arriving old invoice never reduces it |
| `insurance_expiry_date`, `test_expiry_date` | forward only — confirming a 2024 certificate after the 2026 one must not drag the cache back and invent an alert |
| `next_service_date`, `next_service_km` | applied **only** from the vehicle's newest service, since a service legitimately moves the next one earlier or later |

---

## Cost

Unchanged from Phase 4 and deliberately so: totals come from
`maintenance_logs.cost` attributed by `performed_at`. `vehicle_documents.amount`
is **not** summed, so an intake-created invoice is counted exactly once even
though both rows carry the figure. Negative cost is rejected by the RPC before
any record exists. Audit check 7 flags a maintenance row whose cost has drifted
from its document's amount.

---

## Dashboard intake with an unknown vehicle

`vehicle_documents.vehicle_id` is NOT NULL and stays that way — the Passport,
the dashboard and the Storage policies all read it and are already validated,
and loosening it to serve one new flow would put all of them back in scope.

So the document row is not created at upload at all. The file goes to Storage,
its descriptor parks on the intake row (`pending_storage_path` and friends),
and `confirm_fleet_intake()` creates the document once the vehicle is known —
in the same transaction as the operational record, so the two cannot exist
without each other. Privacy defaults follow the documents module:
`contains_personal_info=true`, `share_allowed=false`, never auto-enabled.

---

## Fleet Insights

Deterministic, no LLM, no generated prose. Every insight carries a severity and
an `href` to the records it was computed from.

| Insight | Rule | Severity |
| --- | --- | --- |
| cost anomaly | Phase 4 rule verbatim (`costs.anomalies`): ≥3 vehicles with cost, ≥2× fleet average, ≥1000 absolute | warning |
| most expensive vehicle | top of the month's cost roll-up; **suppressed** when the same vehicle is already the anomaly | info |
| repeated issues | ≥2 open issues (`REPEATED_ISSUE_THRESHOLD`) | critical if any high-priority, else warning |
| incomplete service data | vehicles with neither a service date nor a mileage target | info |
| document changed an action | the most recent **confirmed** intake | info |

Overdue service, due-soon service and expiring documents remain in the
**action list**, which is where the fleet acts on them — duplicating them as
insights would create two competing definitions of the same fact.

**No fabricated compliance.** The incomplete-data insight says vehicles lack
the data needed to judge service status. It does not claim a document is
missing or that anyone is out of compliance, because nothing in the schema
records which documents a given organization is required to hold.

---

## Privacy

Raw extraction never leaves the server boundary it belongs to:

* `document_extractions` denies drivers outright (Phase 5 policy) and is
  org-scoped for everyone else,
* the Passport snapshot carries no `raw_text`, `extracted_data`,
  `field_provenance`, `storage_path` or `category_confidence` — audit check 8,
* extraction failures log the error **category** only, never the provider's raw
  response, which can echo document content,
* duplicate warnings return no `storage_path` and no `amount`,
* the Storage path is built server-side from the uploader's id and random
  bytes; the client never proposes one.

---

## Verification

```bash
supabase db reset
docker exec -i supabase_db_vin-id psql -U postgres -d postgres \
  -f - < supabase/audits/fleet_intake_audit.sql     # 9 checks, all 0 rows

FLEET_CHECK_ALLOW=1 SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<local> SUPABASE_SERVICE_ROLE_KEY=<local> \
  npm run validate:fleet-ai-intake                   # 85 assertions
```

**No paid AI call is made by the suite.** Extraction is a provider round-trip;
calling a paid model would be slow, non-deterministic and would test the vendor
rather than this application. The deterministic thresholds are imported
directly from `lib/fleet-intake/types.ts` (Node strips the types), and the
confirmation and matching RPCs exercised are the real, shipped ones. Provider
selection in `lib/documents/scan/provider.ts` is untouched.

All suites, after this phase:

| Suite | Assertions |
| --- | --- |
| Fleet tenancy | 51 |
| Document Storage | 25 |
| Organization members and invitations | 77 |
| Fleet Manager | 50 |
| Driver View | 116 |
| **Fleet AI intake** | **85** |

Three SQL audits (document Storage 6, driver RLS 10, Fleet intake 9) all return
zero rows.

---

## Browser validation and what remains manual

Run locally without touching `.env.local` (shell env wins over it):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> \
npx next dev -p 3100
```

Verified at HTTP/SSR level: the upload screen, the review screen with per-field
provenance, English and Hebrew with `dir="rtl"`, viewer/driver/anonymous all
redirected away from both intake routes, and the dashboard CTA present for a
writer and absent for a viewer. Production was proven unused — zero occurrences
of the production ref or any `.supabase.co` host across 4.5 MB of served bytes,
and the app's rendered output tracks local database state changes.

**Still requires a human with a browser**: pixel-level layout, responsive
breakpoints, the camera capture path on a real phone, and long-content
behaviour (long garage names, large amounts, long extracted descriptions) in
both locales. There is no headless browser in this environment, so none of that
is claimed as validated.
