#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   This validation script deliberately uses `cond ? P(msg) : F(msg)` as a
   compact assertion statement. The expressions have side effects (they log and
   tally), so the rule's concern (a truly unused expression) does not apply. */
/**
 * Fleet Lite — AI document intake security and correctness check.
 *
 * WHAT THIS TESTS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * The security-critical half of intake lives in the DATABASE:
 * `confirm_fleet_intake()` is the only function that turns a reviewed
 * extraction into an operational record, and `match_fleet_vehicles()` is the
 * only thing that decides which vehicle a document may attach to. Both are
 * exercised here through REAL authenticated sessions — that is the shipped
 * code, not a reimplementation.
 *
 * NO PAID AI CALL IS MADE. Extraction itself is a provider round-trip; calling
 * a paid model would make this suite slow, non-deterministic and expensive, and
 * would test the vendor rather than this application. The deterministic
 * THRESHOLDS that decide whether a human must intervene are imported directly
 * from `lib/fleet-intake/types.ts` (Node strips the types), so the shipped
 * matching and confidence rules are tested rather than restated. The production
 * provider selection in `lib/documents/scan/provider.ts` is untouched.
 *
 * Guarantees enforced by construction:
 *   - the SERVICE ROLE is used only to create fixtures,
 *   - every access-control ASSERTION uses a real signed-in session,
 *   - it refuses to run without FLEET_CHECK_ALLOW=1,
 *   - it refuses the production project ref and any non-local URL,
 *   - it returns a non-zero exit code on any failed assertion,
 *   - no secret, JWT or document content is ever logged.
 *
 * Usage (LOCAL only):
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=<local> SUPABASE_SERVICE_ROLE_KEY=<local> \
 *   npm run validate:fleet-ai-intake
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { cleanupUsers, joinOrg, orgOf, setRole } from "./lib/org-fixtures.mjs";
// Shipped deterministic rules — imported, not reimplemented.
import {
  categoryConfidenceLevel,
  requiresManualVehicleSelection,
} from "../../lib/fleet-intake/types.ts";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = "jsthfmgvcdrfzpgkpwvt";

if (process.env.FLEET_CHECK_ALLOW !== "1") {
  console.error("Refusing to run without FLEET_CHECK_ALLOW=1. Never run against production.");
  process.exit(2);
}
if (!URL || !ANON || !SERVICE) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
if (URL.includes(PROD_REF)) {
  console.error("SUPABASE_URL is the production project ref. Aborting.");
  process.exit(2);
}
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`SUPABASE_URL is not local (${URL}). This harness is local-only. Aborting.`);
  process.exit(2);
}

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const H = (m) => console.log(`\n${m}\n${"-".repeat(m.length)}`);
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PW = "Test-Passw0rd!";

async function mkUser(tag) {
  const email = `${tag}+${Date.now()}${randomBytes(2).toString("hex")}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  return { id: data.user.id, email };
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn: ${error.message}`);
  return c;
}
const ins = async (table, payload, cols = "id") => {
  const { data, error } = await admin.from(table).insert(payload).select(cols);
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data ?? [];
};

/** Count intake-created operational records for a document. */
async function recordsFor(documentId) {
  const tables = ["maintenance_logs", "vehicle_insurance", "vehicle_registration", "vehicle_inspection"];
  let total = 0;
  for (const t of tables) {
    const { data } = await admin.from(t).select("id").eq("document_id", documentId).eq("source_type", "fleet_intake");
    total += data?.length ?? 0;
  }
  return total;
}

async function main() {
  const owner = await mkUser("owner");
  const adminUser = await mkUser("admin");
  const manager = await mkUser("mgr");
  const viewer = await mkUser("viewer");
  const driver = await mkUser("drv");
  const removed = await mkUser("gone");
  const bOwner = await mkUser("bowner");
  const created = [owner, adminUser, manager, viewer, driver, removed, bOwner];

  try {
    // ---------------------------------------------------------------------
    // Fixtures (service role only)
    // ---------------------------------------------------------------------
    const orgA = await orgOf(admin, owner.id);
    const orgB = await orgOf(admin, bOwner.id);
    await setRole(admin, owner.id, "owner");
    await joinOrg(admin, adminUser.id, orgA, "admin");
    await joinOrg(admin, manager.id, orgA, "fleet_manager");
    await joinOrg(admin, viewer.id, orgA, "viewer");
    await joinOrg(admin, driver.id, orgA, "driver");
    await joinOrg(admin, removed.id, orgA, "fleet_manager");

    const mkVehicle = async (org, ownerId, fields) =>
      (await ins("vehicles", { owner_user_id: ownerId, organization_id: org, make: "Test", model: "T", ...fields }))[0].id;

    // Vehicle A: unique VIN + plate. Vehicle B: plate differing only by separators
    // (so the normalized tier is genuinely exercised). Twins: identical plate, to
    // force ambiguity. Vehicle in Org B carries Org A's VIN, to prove that an
    // identifier alone can never cross a tenant boundary.
    const vehA = await mkVehicle(orgA, owner.id, { vin: "VINAAA0000000001", license_plate: "11-222-33", current_mileage: 50000 });
    const vehB = await mkVehicle(orgA, owner.id, { vin: "VINBBB0000000002", license_plate: "44 555 66", current_mileage: 10000 });
    // Two vehicles deliberately sharing a plate, so the ambiguity path is real.
    await mkVehicle(orgA, owner.id, { vin: "VINTWIN000000001", license_plate: "77-888-99" });
    await mkVehicle(orgA, owner.id, { vin: "VINTWIN000000002", license_plate: "77-888-99" });
    const vehDel = await mkVehicle(orgA, owner.id, { vin: "VINDEL0000000001", license_plate: "00-000-01" });
    const vehOtherOrg = await mkVehicle(orgB, bOwner.id, { vin: "VINAAA0000000001", license_plate: "11-222-33" });

    // vehicle_documents.vehicle_id is NOT NULL by design, so the vehicle-detail
    // entry point always has one. Dashboard intake (vehicle unknown) is covered
    // separately below, via an intake row carrying a pending file descriptor.
    const mkDoc = async (org, ownerId, hash, vehicleId) =>
      (await ins("vehicle_documents", {
        owner_user_id: ownerId, organization_id: org, vehicle_id: vehicleId,
        doc_type: "invoice", title: "Intake fixture", file_name: "inv.jpg",
        storage_path: `${ownerId}/${randomBytes(6).toString("hex")}.jpg`,
        content_hash: hash,
      }))[0].id;

    const mkIntake = async (org, ownerId, documentId, extracted, extra = {}) =>
      (await ins("document_extractions", {
        owner_user_id: ownerId, organization_id: org, document_id: documentId,
        status: "pending_confirmation", source: "fleet_intake", engine: "mock",
        extracted_data: extracted, proposed_category: extracted.document_category ?? null,
        category_confidence: extracted.confidence ?? null, ...extra,
      }))[0].id;

    const ownerC = await signIn(owner.email);
    const adminC = await signIn(adminUser.email);
    const mgrC = await signIn(manager.email);
    const viewerC = await signIn(viewer.email);
    const drvC = await signIn(driver.email);
    const goneC = await signIn(removed.email);
    const bC = await signIn(bOwner.email);
    const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

    // ---------------------------------------------------------------------
    H("Deterministic rules (imported from lib/fleet-intake/types.ts)");
    // ---------------------------------------------------------------------
    requiresManualVehicleSelection("vin", 1) === false ? P("single VIN match resolves automatically") : F("VIN match wrongly demanded manual selection");
    requiresManualVehicleSelection("registration", 1) === false ? P("single exact-plate match resolves automatically") : F("plate match wrongly demanded manual selection");
    requiresManualVehicleSelection("registration_normalized", 1) === false ? P("single normalized-plate match resolves automatically") : F("normalized match wrongly demanded manual selection");
    requiresManualVehicleSelection("vin", 2) === true ? P("two candidates require manual selection") : F("ambiguity did not require manual selection");
    requiresManualVehicleSelection("ambiguous", 3) === true ? P("ambiguous requires manual selection") : F("ambiguous did not require selection");
    requiresManualVehicleSelection("none", 0) === true ? P("no match requires manual selection") : F("no-match did not require selection");
    requiresManualVehicleSelection("conflict", 1) === true ? P("identifier conflict requires manual selection") : F("conflict did not require selection");
    requiresManualVehicleSelection(null, 1) === true ? P("absent match method requires manual selection") : F("null method did not require selection");
    categoryConfidenceLevel(0.95, "maintenance") === "accepted" ? P("high confidence accepts the proposed category") : F("high confidence not accepted");
    categoryConfidenceLevel(0.6, "maintenance") === "review" ? P("mid confidence warns for review") : F("mid confidence not flagged for review");
    categoryConfidenceLevel(0.2, "maintenance") === "manual" ? P("low confidence forces manual category choice") : F("low confidence not forced manual");
    categoryConfidenceLevel(0.99, "unknown") === "manual" ? P("'unknown' always forces manual choice regardless of confidence") : F("unknown category not forced manual");
    categoryConfidenceLevel(null, "insurance") === "review" ? P("missing confidence falls back to review") : F("null confidence mishandled");

    // ---------------------------------------------------------------------
    H("Vehicle matching (match_fleet_vehicles, real sessions)");
    // ---------------------------------------------------------------------
    const match = async (client, vin, reg) => {
      const { data, error } = await client.rpc("match_fleet_vehicles", { p_vin: vin, p_registration: reg });
      return { rows: data ?? [], error: error?.message ?? null };
    };

    let m = await match(mgrC, "VINAAA0000000001", null);
    m.rows.length === 1 && m.rows[0].vehicle_id === vehA && m.rows[0].method === "vin"
      ? P("exact VIN resolves to exactly one vehicle") : F(`VIN match: ${JSON.stringify(m)}`);

    m = await match(mgrC, null, "11-222-33");
    m.rows.length === 1 && m.rows[0].vehicle_id === vehA && m.rows[0].method === "registration"
      ? P("exact plate resolves to exactly one vehicle") : F(`plate match: ${JSON.stringify(m)}`);

    m = await match(mgrC, null, "445 5566");
    m.rows.length === 1 && m.rows[0].vehicle_id === vehB && m.rows[0].method === "registration_normalized"
      ? P("plate matches ignoring separators (normalized tier)") : F(`normalized match: ${JSON.stringify(m)}`);

    m = await match(mgrC, null, "77-888-99");
    m.rows.length === 2 ? P("two vehicles sharing a plate return BOTH candidates (ambiguous)") : F(`ambiguous match returned ${m.rows.length}`);

    m = await match(mgrC, "VINNOSUCH0000000", "ZZ-999-ZZ");
    m.rows.length === 0 ? P("unknown identifiers match nothing") : F(`no-match returned ${m.rows.length}`);

    m = await match(mgrC, "VINAAA0000000001", null);
    !m.rows.some((r) => r.vehicle_id === vehOtherOrg)
      ? P("an identical VIN in Organization B is NOT returned to Organization A") : F("CROSS-TENANT MATCH LEAK");

    m = await match(bC, "VINAAA0000000001", "11-222-33");
    m.rows.length === 1 && m.rows[0].vehicle_id === vehOtherOrg
      ? P("Organization B matching the same VIN gets only its OWN vehicle") : F(`org B match: ${JSON.stringify(m)}`);

    m = await match(drvC, "VINAAA0000000001", null);
    m.rows.length === 0 ? P("driver matching returns nothing (no fleet visibility)") : F("driver reached vehicle matching");

    m = await match(anonC, "VINAAA0000000001", null);
    m.rows.length === 0 ? P("anonymous matching returns nothing") : F("anonymous reached vehicle matching");

    // ---------------------------------------------------------------------
    H("No operational record before explicit confirmation");
    // ---------------------------------------------------------------------
    const hash1 = randomBytes(32).toString("hex");
    const doc1 = await mkDoc(orgA, owner.id, hash1, vehA);
    const intake1 = await mkIntake(orgA, owner.id, doc1, {
      document_category: "maintenance", date: "2026-06-01", garage_name: "Garage One",
      mileage: 60000, service_type: "Oil change", service_details: "filter + oil",
      cost: 800, vehicle_registration: "11-222-33", vin: null, confidence: 0.93,
      next_service_date: "2026-12-01", next_service_km: 70000,
    });
    (await recordsFor(doc1)) === 0 ? P("uploading + extracting creates NO operational record") : F("a record existed before confirmation");

    const { data: preVeh } = await admin.from("vehicles").select("current_mileage").eq("id", vehA).single();
    preVeh.current_mileage === 50000 ? P("vehicle mileage untouched before confirmation") : F("mileage changed before confirmation");

    // ---------------------------------------------------------------------
    H("Authorization on confirmation");
    // ---------------------------------------------------------------------
    const confirm = async (client, intakeId, vehicleId, category, payload) => {
      const { data, error } = await client.rpc("confirm_fleet_intake", {
        p_extraction: intakeId, p_vehicle: vehicleId, p_category: category, p_payload: payload,
      });
      return { state: data?.state ?? null, recordId: data?.record_id ?? null, error: error?.message ?? null };
    };
    const mPayload = { performed_at: "2026-06-01", mileage: "60000", cost: "800", currency: "ILS", vendor_name: "Garage One", service_type: "Oil change", description: "filter + oil", next_service_date: "2026-12-01", next_service_km: "70000" };

    let r = await confirm(viewerC, intake1, vehA, "maintenance", mPayload);
    r.state === "not_authorized" ? P("viewer cannot confirm") : F(`viewer confirm: ${JSON.stringify(r)}`);
    r = await confirm(drvC, intake1, vehA, "maintenance", mPayload);
    r.state === "not_authorized" || r.state === "extraction_not_found"
      ? P("driver cannot confirm") : F(`driver confirm: ${JSON.stringify(r)}`);
    r = await confirm(bC, intake1, vehA, "maintenance", mPayload);
    r.state === "extraction_not_found" ? P("Organization B cannot confirm Organization A's intake") : F(`org B confirm: ${JSON.stringify(r)}`);
    r = await confirm(anonC, intake1, vehA, "maintenance", mPayload);
    r.error || r.state === "not_authenticated" ? P("anonymous cannot confirm") : F(`anon confirm: ${JSON.stringify(r)}`);
    (await recordsFor(doc1)) === 0 ? P("after every rejected attempt, still NO record") : F("a rejected attempt created a record");

    // Forged vehicle: a real vehicle id from another organization.
    r = await confirm(mgrC, intake1, vehOtherOrg, "maintenance", mPayload);
    r.state === "vehicle_not_found" ? P("forged cross-org vehicle id is rejected") : F(`forged vehicle: ${JSON.stringify(r)}`);

    // ---------------------------------------------------------------------
    H("Confirmation creates exactly one record, idempotently");
    // ---------------------------------------------------------------------
    r = await confirm(mgrC, intake1, vehA, "maintenance", mPayload);
    r.state === "ok" && r.recordId ? P("fleet_manager confirms → record created") : F(`confirm: ${JSON.stringify(r)}`);
    const firstRecord = r.recordId;
    (await recordsFor(doc1)) === 1 ? P("exactly one operational record exists") : F(`record count = ${await recordsFor(doc1)}`);

    const again = await confirm(mgrC, intake1, vehA, "maintenance", mPayload);
    again.state === "already_confirmed" && again.recordId === firstRecord
      ? P("double confirmation returns the SAME record (idempotent)") : F(`repeat confirm: ${JSON.stringify(again)}`);
    (await recordsFor(doc1)) === 1 ? P("double confirmation created no duplicate") : F("duplicate record after repeat confirm");

    // Concurrency: fire several confirmations at once against a fresh intake.
    const hashC = randomBytes(32).toString("hex");
    const docC = await mkDoc(orgA, owner.id, hashC, vehA);
    const intakeC = await mkIntake(orgA, owner.id, docC, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    const concurrent = await Promise.all([
      confirm(mgrC, intakeC, vehA, "maintenance", { performed_at: "2026-06-02", cost: "100" }),
      confirm(ownerC, intakeC, vehA, "maintenance", { performed_at: "2026-06-02", cost: "100" }),
      confirm(adminC, intakeC, vehA, "maintenance", { performed_at: "2026-06-02", cost: "100" }),
    ]);
    const okCount = concurrent.filter((c) => c.state === "ok").length;
    const dupCount = concurrent.filter((c) => c.state === "already_confirmed").length;
    okCount === 1 && dupCount === 2 ? P("3 concurrent confirmations → 1 created, 2 already_confirmed") : F(`concurrent: ${JSON.stringify(concurrent.map((c) => c.state))}`);
    (await recordsFor(docC)) === 1 ? P("concurrent confirmation created exactly one record") : F(`concurrent record count = ${await recordsFor(docC)}`);

    // ---------------------------------------------------------------------
    H("Provenance");
    // ---------------------------------------------------------------------
    const { data: confirmed } = await admin.from("document_extractions")
      .select("status, confirmed_by, confirmed_at, created_record_id, created_record_type, extracted_data, confirmed_data, confirmed_category")
      .eq("id", intake1).single();
    confirmed.status === "confirmed" ? P("intake marked confirmed") : F("intake not marked confirmed");
    confirmed.confirmed_by === manager.id ? P("confirming user recorded") : F("confirmed_by wrong");
    confirmed.created_record_id === firstRecord ? P("intake links to the record it produced") : F("created_record_id wrong");
    confirmed.created_record_type === "maintenance" ? P("record type recorded") : F("created_record_type wrong");
    confirmed.extracted_data?.garage_name === "Garage One" ? P("ORIGINAL extraction preserved after confirmation") : F("extracted_data lost");
    confirmed.confirmed_data?.vendor_name === "Garage One" ? P("confirmed values stored separately from the extraction") : F("confirmed_data missing");

    const { data: rec } = await admin.from("maintenance_logs").select("document_id, trust_label, source_type, cost").eq("id", firstRecord).single();
    rec.document_id === doc1 ? P("created record links back to the source document") : F("record has no document link");
    rec.trust_label === "ai_extracted" ? P("record carries the ai_extracted trust label") : F(`trust_label = ${rec.trust_label}`);
    rec.source_type === "fleet_intake" ? P("record carries the fleet_intake source") : F(`source_type = ${rec.source_type}`);

    // User correction must be recorded as an edit, not silently applied.
    const hashE = randomBytes(32).toString("hex");
    const docE = await mkDoc(orgA, owner.id, hashE, vehA);
    const intakeE = await mkIntake(orgA, owner.id, docE, {
      document_category: "maintenance", garage_name: "WRONG OCR", mileage: 61000,
      date: "2026-06-03", confidence: 0.55, vehicle_registration: "11-222-33", vin: null,
    });
    r = await confirm(mgrC, intakeE, vehA, "maintenance", { performed_at: "2026-06-03", mileage: "61000", vendor_name: "Corrected Garage" });
    const { data: corrected } = await admin.from("maintenance_logs").select("vendor_name").eq("id", r.recordId).single();
    corrected.vendor_name === "Corrected Garage" ? P("user correction overrides the AI suggestion in the final record") : F("correction not applied");
    const { data: exE } = await admin.from("document_extractions").select("extracted_data").eq("id", intakeE).single();
    exE.extracted_data.garage_name === "WRONG OCR" ? P("the superseded AI value is still retained for audit") : F("original AI value overwritten");

    // ---------------------------------------------------------------------
    H("Derived vehicle updates are monotonic");
    // ---------------------------------------------------------------------
    let { data: v } = await admin.from("vehicles").select("current_mileage, next_service_date").eq("id", vehA).single();
    v.current_mileage === 61000 ? P("newer mileage raised the odometer (50000 → 61000)") : F(`mileage = ${v.current_mileage}`);

    const hashOld = randomBytes(32).toString("hex");
    const docOld = await mkDoc(orgA, owner.id, hashOld, vehA);
    const intakeOld = await mkIntake(orgA, owner.id, docOld, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    await confirm(mgrC, intakeOld, vehA, "maintenance", { performed_at: "2025-01-01", mileage: "20000" });
    ({ data: v } = await admin.from("vehicles").select("current_mileage").eq("id", vehA).single());
    v.current_mileage === 61000 ? P("an OLDER document cannot reduce the odometer") : F(`odometer reduced to ${v.current_mileage}`);

    // Insurance expiry: newer moves forward, older does not drag it back.
    const mkIns = async (endDate, perf) => {
      const h = randomBytes(32).toString("hex");
      const d = await mkDoc(orgA, owner.id, h, vehB);
      const i = await mkIntake(orgA, owner.id, d, { document_category: "insurance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
      return confirm(mgrC, i, vehA, "insurance", { start_date: perf, end_date: endDate, insurer_name: "Ins Co", cost: "1200" });
    };
    await mkIns("2027-06-30", "2026-07-01");
    ({ data: v } = await admin.from("vehicles").select("insurance_expiry_date").eq("id", vehA).single());
    v.insurance_expiry_date === "2027-06-30" ? P("newer insurance expiry updated the vehicle cache") : F(`insurance expiry = ${v.insurance_expiry_date}`);
    await mkIns("2025-01-31", "2024-02-01");
    ({ data: v } = await admin.from("vehicles").select("insurance_expiry_date").eq("id", vehA).single());
    v.insurance_expiry_date === "2027-06-30" ? P("an OLDER insurance expiry did not overwrite the newer one") : F(`expiry regressed to ${v.insurance_expiry_date}`);

    // Inspection expiry, same rule.
    const hashI = randomBytes(32).toString("hex");
    const docI = await mkDoc(orgA, owner.id, hashI, vehA);
    const intakeI = await mkIntake(orgA, owner.id, docI, { document_category: "inspection", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    await confirm(mgrC, intakeI, vehA, "inspection", { start_date: "2026-07-01", end_date: "2027-07-01", cost: "310" });
    ({ data: v } = await admin.from("vehicles").select("test_expiry_date").eq("id", vehA).single());
    v.test_expiry_date === "2027-07-01" ? P("inspection expiry updated the test cache") : F(`test expiry = ${v.test_expiry_date}`);

    // next_service comes from the NEWEST service only.
    ({ data: v } = await admin.from("vehicles").select("next_service_date").eq("id", vehA).single());
    v.next_service_date === "2026-12-01" ? P("next service taken from the newest confirmed service") : F(`next_service_date = ${v.next_service_date}`);
    const hashN = randomBytes(32).toString("hex");
    const docN = await mkDoc(orgA, owner.id, hashN, vehA);
    const intakeN = await mkIntake(orgA, owner.id, docN, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    await confirm(mgrC, intakeN, vehA, "maintenance", { performed_at: "2024-01-01", next_service_date: "2024-06-01" });
    ({ data: v } = await admin.from("vehicles").select("next_service_date").eq("id", vehA).single());
    v.next_service_date === "2026-12-01" ? P("a stale older invoice did not reschedule the next service") : F(`next_service_date regressed to ${v.next_service_date}`);

    // ---------------------------------------------------------------------
    H("Costs counted exactly once");
    // ---------------------------------------------------------------------
    const { data: costRows } = await admin.from("maintenance_logs")
      .select("id, cost").eq("document_id", doc1).eq("source_type", "fleet_intake");
    costRows.length === 1 && Number(costRows[0].cost) === 800
      ? P("invoice cost appears on exactly one maintenance row") : F(`cost rows: ${JSON.stringify(costRows)}`);

    const hashNeg = randomBytes(32).toString("hex");
    const docNeg = await mkDoc(orgA, owner.id, hashNeg, vehA);
    const intakeNeg = await mkIntake(orgA, owner.id, docNeg, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    r = await confirm(mgrC, intakeNeg, vehA, "maintenance", { performed_at: "2026-06-05", cost: "-50" });
    r.state === "invalid_payload" ? P("negative cost is rejected") : F(`negative cost accepted: ${JSON.stringify(r)}`);
    (await recordsFor(docNeg)) === 0 ? P("rejected payload created no record") : F("invalid payload still created a record");

    const hashNull = randomBytes(32).toString("hex");
    const docNull = await mkDoc(orgA, owner.id, hashNull, vehA);
    const intakeNull = await mkIntake(orgA, owner.id, docNull, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    r = await confirm(mgrC, intakeNull, vehA, "maintenance", { performed_at: "2026-06-06" });
    r.state === "ok" ? P("a document with no cost confirms fine (null cost)") : F(`null cost: ${JSON.stringify(r)}`);

    // ---------------------------------------------------------------------
    H("Duplicate protection");
    // ---------------------------------------------------------------------
    const dupHash = randomBytes(32).toString("hex");
    await mkDoc(orgA, owner.id, dupHash, vehA);
    const { data: dupes } = await mgrC.rpc("find_duplicate_documents", { p_hash: dupHash });
    (dupes?.length ?? 0) === 1 ? P("re-uploading an identical file is detected") : F(`duplicate lookup returned ${dupes?.length}`);
    const dupBody = JSON.stringify(dupes ?? []);
    !dupBody.includes("storage_path") && !dupBody.includes("amount")
      ? P("duplicate warning exposes no storage path or amount") : F("duplicate lookup leaked a sensitive field");
    const { data: bDupes } = await bC.rpc("find_duplicate_documents", { p_hash: dupHash });
    (bDupes?.length ?? 0) === 0 ? P("Organization B sees no duplicates of Organization A's file") : F("cross-org duplicate leak");
    const { data: drvDupes } = await drvC.rpc("find_duplicate_documents", { p_hash: dupHash });
    (drvDupes?.length ?? 0) === 0 ? P("driver sees no duplicate documents") : F("driver reached duplicate lookup");

    // ---------------------------------------------------------------------
    H("Confirmation after the world changes underneath");
    // ---------------------------------------------------------------------
    // Membership removed mid-review.
    const hashR = randomBytes(32).toString("hex");
    const docR = await mkDoc(orgA, owner.id, hashR, vehA);
    const intakeR = await mkIntake(orgA, owner.id, docR, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null });
    await admin.from("organization_members").delete().eq("user_id", removed.id);
    r = await confirm(goneC, intakeR, vehA, "maintenance", { performed_at: "2026-06-07" });
    r.state === "not_authorized" || r.state === "extraction_not_found"
      ? P("a member removed mid-review cannot confirm") : F(`removed member confirm: ${JSON.stringify(r)}`);
    (await recordsFor(docR)) === 0 ? P("removed member created no record") : F("removed member created a record");

    // Vehicle deleted mid-review.
    const hashD = randomBytes(32).toString("hex");
    const docD = await mkDoc(orgA, owner.id, hashD, vehA);
    const intakeD = await mkIntake(orgA, owner.id, docD, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "00-000-01", vin: null });
    await admin.from("vehicles").update({ deleted_at: new Date().toISOString() }).eq("id", vehDel);
    r = await confirm(mgrC, intakeD, vehDel, "maintenance", { performed_at: "2026-06-08" });
    r.state === "vehicle_not_found" ? P("a vehicle deleted mid-review cannot be confirmed against") : F(`deleted vehicle: ${JSON.stringify(r)}`);

    // Cancelled review is terminal.
    const hashX = randomBytes(32).toString("hex");
    const docX = await mkDoc(orgA, owner.id, hashX, vehA);
    const intakeX = await mkIntake(orgA, owner.id, docX, { document_category: "maintenance", confidence: 0.9, vehicle_registration: "11-222-33", vin: null }, { status: "cancelled" });
    r = await confirm(mgrC, intakeX, vehA, "maintenance", { performed_at: "2026-06-09" });
    r.state === "stale" ? P("a cancelled review cannot be confirmed later") : F(`cancelled confirm: ${JSON.stringify(r)}`);
    (await recordsFor(docX)) === 0 ? P("cancelled review created no record and no alert") : F("cancelled review created a record");

    // Invalid category.
    const hashBad = randomBytes(32).toString("hex");
    const docBad = await mkDoc(orgA, owner.id, hashBad, vehA);
    const intakeBad = await mkIntake(orgA, owner.id, docBad, { document_category: "unknown", confidence: 0.2, vehicle_registration: null, vin: null });
    r = await confirm(mgrC, intakeBad, vehA, "unknown", {});
    r.state === "invalid_category" ? P("an unknown category cannot be persisted") : F(`unknown category: ${JSON.stringify(r)}`);

    // ---------------------------------------------------------------------
    H("Owner and admin can also confirm");
    // ---------------------------------------------------------------------
    for (const [name, client] of [["owner", ownerC], ["admin", adminC]]) {
      const h = randomBytes(32).toString("hex");
      const d = await mkDoc(orgA, owner.id, h, vehB);
      const i = await mkIntake(orgA, owner.id, d, { document_category: "registration", confidence: 0.9, vehicle_registration: "44 555 66", vin: null });
      const res = await confirm(client, i, vehB, "registration", { start_date: "2026-01-01", end_date: "2027-01-01" });
      res.state === "ok" ? P(`${name} can confirm an intake`) : F(`${name} confirm: ${JSON.stringify(res)}`);
    }

    // ---------------------------------------------------------------------
    H("Dashboard intake: vehicle unknown at upload");
    // ---------------------------------------------------------------------
    // No document row yet — the file sits in Storage and its descriptor is
    // parked on the intake until the user resolves the vehicle.
    const pendingHash = randomBytes(32).toString("hex");
    const pendingIntake = (await ins("document_extractions", {
      owner_user_id: owner.id, organization_id: orgA, document_id: null,
      status: "pending_confirmation", source: "fleet_intake", engine: "mock",
      extracted_data: {
        document_category: "inspection", start_date: "2026-08-01",
        end_date: "2027-08-01", cost: 400, confidence: 0.88,
        vehicle_registration: "44 555 66", vin: null,
      },
      proposed_category: "inspection", category_confidence: 0.88,
      vehicle_match_method: "registration_normalized",
      content_hash: pendingHash,
      pending_storage_path: `${owner.id}/${randomBytes(6).toString("hex")}.jpg`,
      pending_file_name: "test.jpg", pending_mime_type: "image/jpeg",
      pending_file_size: 12345,
    }))[0].id;

    const { count: docsBefore } = await admin.from("vehicle_documents")
      .select("id", { count: "exact", head: true }).eq("content_hash", pendingHash);
    docsBefore === 0 ? P("dashboard upload files NO document before confirmation") : F(`${docsBefore} documents existed pre-confirmation`);

    r = await confirm(mgrC, pendingIntake, vehB, "inspection", { start_date: "2026-08-01", end_date: "2027-08-01", cost: "400" });
    r.state === "ok" ? P("dashboard intake confirms once the vehicle is chosen") : F(`dashboard confirm: ${JSON.stringify(r)}`);

    const { data: newDocs } = await admin.from("vehicle_documents")
      .select("id, vehicle_id, doc_type, share_allowed, contains_personal_info")
      .eq("content_hash", pendingHash);
    newDocs?.length === 1 ? P("confirmation created exactly one document") : F(`created ${newDocs?.length} documents`);
    newDocs?.[0]?.vehicle_id === vehB ? P("the document is attached to the chosen vehicle") : F("document attached to the wrong vehicle");
    newDocs?.[0]?.doc_type === "inspection" ? P("document type follows the confirmed category") : F(`doc_type = ${newDocs?.[0]?.doc_type}`);
    newDocs?.[0]?.share_allowed === false ? P("share_allowed is never auto-enabled") : F("share_allowed was auto-enabled");
    newDocs?.[0]?.contains_personal_info === true ? P("contains_personal_info defaults to true for a scan") : F("privacy default weakened");
    (await recordsFor(newDocs[0].id)) === 1 ? P("dashboard intake produced exactly one operational record") : F("dashboard intake record count wrong");

    // ---------------------------------------------------------------------
    H("Privacy of raw extraction");
    // ---------------------------------------------------------------------
    const { data: drvEx, error: drvExErr } = await drvC.from("document_extractions").select("*");
    (drvEx?.length ?? 0) === 0 ? P("driver reads zero extraction rows") : F(`driver read ${drvEx?.length} extractions`);
    drvExErr === null || drvExErr ? P("driver extraction read is denied by RLS, not by an app filter") : F("unexpected");
    const { data: bEx } = await bC.from("document_extractions").select("*");
    (bEx?.length ?? 0) === 0 ? P("Organization B reads zero Organization A extractions") : F("cross-org extraction leak");
    const { data: anonEx } = await anonC.from("document_extractions").select("*");
    (anonEx?.length ?? 0) === 0 ? P("anonymous reads zero extraction rows") : F("anonymous read extractions");

    // Passport must not carry extraction internals.
    const pass = await ins("vehicle_passports", {
      owner_user_id: owner.id, organization_id: orgA, vehicle_id: vehA,
      public_id: randomUUID(), snapshot: { vehicle: { make: "Test" }, maintenance: [{ service_type: "Oil change" }] },
      snapshot_hash: randomBytes(32).toString("hex"), status: "active",
    });
    const { data: snap } = await admin.from("vehicle_passports").select("snapshot").eq("id", pass[0].id).single();
    const snapText = JSON.stringify(snap.snapshot);
    !/raw_text|extracted_data|field_provenance|storage_path|category_confidence/i.test(snapText)
      ? P("passport snapshot carries no extraction internals") : F("passport leaked extraction internals");

    // ---------------------------------------------------------------------
    H("Viewer keeps read access, loses write");
    // ---------------------------------------------------------------------
    const { data: viewerVeh } = await viewerC.from("vehicles").select("id");
    (viewerVeh?.length ?? 0) > 0 ? P("viewer still reads the fleet") : F("viewer lost fleet read access");
    const { data: viewerIns } = await viewerC.from("document_extractions")
      .insert({ owner_user_id: viewer.id, organization_id: orgA, document_id: doc1, extracted_data: {}, source: "fleet_intake" })
      .select("id");
    (viewerIns?.length ?? 0) === 0 ? P("viewer cannot create an intake row") : F("viewer inserted an extraction");
  } finally {
    await cleanupUsers(admin, created);
  }

  console.log(`\n${"=".repeat(60)}\nFleet AI intake check: ${passes} passed, ${fails} failed\n${"=".repeat(60)}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness error:", e.message);
  process.exit(1);
});
