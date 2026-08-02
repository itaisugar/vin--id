# Vehicle Registration Document AI Intake (Task E)

Branch: `feat/vehicle-registration-ai-intake` — **stacked on `feat/government-vehicle-lookup`** (Task D), which is stacked on `feat/all-requested-improvements`. Do not merge to `main` or the integration branch here.

Adds a third Add-Vehicle method: scan a vehicle registration document → AI extracts allowlisted fields → compare with the official government source → review/edit → explicit confirm → one vehicle created with its document. AI is input assistance, never authority; nothing is final without confirmation.

---

## 1. Audited existing AI architecture
- **One engine.** `getExtractionProvider()` selects Anthropic when `ANTHROPIC_API_KEY` is set, else a deterministic mock. `lib/fleet-intake/*` already stages an upload, runs extraction, and confirms atomically via `confirm_fleet_intake()`.
- **Pending-before-vehicle is already solved:** `document_extractions` has `pending_storage_path/file_name/mime_type/file_size`, nullable `document_id`, `extracted_data`/`confirmed_data`, status lifecycle, `content_hash`, org scoping, and RLS. The document row + record are created at confirmation.
- **Storage:** private `vehicle-documents` bucket, server-built path `${userId}/${uuid}.ext`, signed URLs only.
- **Extraction schema** (`lib/documents/scan/types.ts`) extracts *record* fields, not vehicle identity → a dedicated vehicle-registration extraction was required.

## 2. Selected pre-vehicle intake design
**Option A — reuse `document_extractions`.** A new `source = 'vehicle_registration'` distinguishes this flow. The staged file lives in the bucket; the row holds `extracted_data`. No placeholder vehicle, no orphan document. Chosen over a new table (nothing extra needed) and over memory-only (survives refresh/latency).

## 3. Storage lifecycle
Upload → private bucket at `${userId}/${uuid}.ext`; descriptor parked on the intake row. **Confirm** files it as the new vehicle's `registration` document inside the RPC transaction. **Cancel/failure** marks the row `cancelled` and removes the staged object (best-effort, org-scoped). Abandoned rows stay `pending_confirmation` and can be swept by a documented cleanup (no background job added).

## 4. Extraction schema
`lib/vehicle-intake/extraction-types.ts` — allowlisted fields, each `{value, confidence}`: `registration_number, make, model, year, vin, color, fuel_type, test_expiry_date`, plus `document_type` (`vehicle_registration|other|uncertain`), `document_type_confidence`, `warnings[]`, `extraction_version`. Tolerant coercion; month-only dates never become a fabricated day; unknown keys ignored.

## 5. PII exclusion
The schema omits owner identity entirely, and `stripProhibitedKeys()` removes any prohibited key (`owner_name, id_number, address, phone, email, signature, previous_owner, …`) at every level before validation, setting `pii_stripped` + a redacted warning. No full OCR text is retained; the provider's raw response is never stored; logs carry only status/reason.

## 6. Vehicle-field mapping
Persisted (reusing Task D columns): `make, model, year, vin, license_plate, color, fuel_type, test_expiry_date`. Additional technical fields (engine displacement, body type, gross weight, tyres, first-registration) are **deliberately not persisted** in this MVP — they add little to the Passport and would each need form/i18n/Passport/test work; they remain extraction evidence only. Documented as excluded.

## 7. Government comparison
After extraction the user reviews the registration number, then the flow calls **Task D's** `lookupVehicleAction` (same adapter, timeout, retry, cache, redaction — no second provider). `compareVehicleSources()` (pure) computes per-field `match | conflict | document_only | government_only | missing` and a default proposal (agree → that; else government; else document; else blank).

## 8. Conflict resolution
Conflicts are surfaced, never auto-resolved. Registration-number mismatch = **blocking** (`registrationConflict`); VIN mismatch = `vinConflict` (explicit review); test-expiry mismatch highlighted. The Review reuses the shared `VehicleForm` prefilled with merged defaults, under a banner listing sources + conflicts. The user's confirmed value is final.

## 9. Provenance
Overall `data_source`: `vehicle_registration_ai` (document only) or `mixed_confirmed` (government also used). Government `fetched_at`/`resource_id` stored when a lookup contributed. The extraction row keeps `extracted_data` + `confirmed_data` as an audit trail linked to the created vehicle (`created_record_type='vehicle'`). Never labelled "verified".

## 10. Duplicate behavior
The confirm RPC runs a workspace-scoped `normalize_plate` duplicate check; a match returns `duplicate` + the existing vehicle id (UI offers "Open existing vehicle"). No global uniqueness; cross-workspace never disclosed.

## 11. Confirmation transaction
`confirm_vehicle_registration_intake()` (SECURITY DEFINER): auth + writer, locks the extraction, idempotent (re-confirm returns the same vehicle), validates payload + `data_source`, duplicate check, creates the vehicle + its registration document, optional reminder, finalizes the extraction — all atomic. States: `ok, already_confirmed, duplicate, not_authenticated, not_authorized, extraction_not_found, invalid_payload, invalid_source, stale`.

## 12. Reminder behavior
No reminder is created silently. An explicit **opt-in checkbox** ("Create a reminder before the test expiry") passes `p_create_reminder`; the RPC inserts exactly one `inspection` reminder due `lead_days` before expiry. Re-confirm is idempotent, so no duplicate reminder.

## 13. Personal and Business authorization
Same rule as vehicle creation (`requireFleetWriter` + `is_org_writer()` in the RPC): owner/admin/fleet_manager may scan+confirm; viewer/driver denied. The intake is bound to the organization at creation; the RPC re-verifies org + permission, so a workspace switch can't redirect ownership.

## 14. Cleanup and recovery
Every pre-confirmation failure keeps manual entry available and the staged file removable. Cancel deletes the staged object. Recovery: retry re-uploads (a new staged file); a failed extraction is stored as a `failed` row the user can cancel. Finalization is idempotent, so a retry after a transient error cannot create a second vehicle/document.

## 15. Tests
- **Focused:** `validate:vehicle-registration-intake` — **39 assertions**: extraction parse + PII strip (offline), mock provider, source comparison/merge (offline), and the DB RPC (create, idempotency, duplicate block, source metadata, document linkage, opt-in reminder once / none without opt-in, viewer denial, invalid payload/source). No live AI in CI.
- **Full regression:** clean `db reset` (47 migrations), **852 assertions, 0 failures** (813 baseline + 39). tsc clean, ESLint clean, `next build` compiles, en/he parity 1279/1279.

## 16. Known limitations
New-vehicle creation only (no existing-vehicle scan). Images only (JPEG/PNG/WebP; no PDF, matching the existing scan flow). Extraction reliability varies with image quality (warnings surfaced). Additional technical fields not persisted. Not ownership/authenticity/roadworthiness verification.

## 17. Production configuration
`ANTHROPIC_API_KEY` (server-only) enables real extraction; without it the deterministic mock is used. `EXTRACTION_MODEL` selects the model. Government lookup uses Task D's config. Server egress to `data.gov.il` required.

## 18. Stacked-branch dependency
Parent: `feat/government-vehicle-lookup` (Task D). This branch reuses that branch's `lib/vehicle-lookup/*`, `data_source`/government columns, and `lookupVehicleAction`. Release Task D first (or together, in order).

## 19. Release & rollback
- **Release:** back up prod → apply `20260802140000` (widens 3 CHECK vocabularies + adds one RPC; additive) → deploy.
- **Rollback:** revert the deploy (previous Add Vehicle unaffected); the RPC can be dropped and the CHECK constraints narrowed again — no data migration (columns/rows are additive and stay valid).

## 20. Future existing-vehicle support
The same extraction + comparison can later attach a registration scan to an existing vehicle (reuse `confirm_fleet_intake`-style matching), and per-field provenance can drive a richer Review (government / document / existing / chosen). Out of scope here.
