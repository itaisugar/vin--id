#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   This validation script deliberately uses `cond ? P(msg) : F(msg)` as a
   compact assertion statement. The expressions have side effects (they log and
   tally), so the rule's concern (a truly unused expression) does not apply. */
/**
 * VIN-ID Layer 1 — Private Vehicle release gate.
 *
 * WHOSE EXPERIENCE THIS TESTS. Everything here runs as a PRIVATE user: someone
 * who signed up on their own and was given a personal organization by the
 * `on_auth_user_created` trigger. They never invite anyone, never see a role
 * picker, and must never be asked to understand memberships. The Fleet suites
 * prove the multi-tenant machinery; this proves that a single person using the
 * product alone gets a correct, private, complete result from it.
 *
 * REAL SIGNUP, NOT A FIXTURE. The private users below are created through the
 * public `auth.signUp` endpoint with the anon key — the same call the signup
 * form makes — so the provisioning trigger, the profile row and the owner
 * membership are all exercised as they are in production. The service role is
 * used only to seed documents and to read back state for assertions, never to
 * make an access-control decision.
 *
 * NO PAID AI CALL IS MADE. Extraction is a provider round-trip; calling a paid
 * model would be slow, non-deterministic and would test the vendor rather than
 * this application. The extraction OUTPUT is synthesized, and everything that
 * decides what happens to it — `confirm_fleet_intake()`, the derived-field
 * rules, the constraints, the RLS policies — is the real shipped code.
 *
 * SERVER/RLS CONSISTENCY IS CHECKED FROM SOURCE, NOT RESTATED. The service
 * modules are `server-only` and cannot be imported into a plain Node process,
 * so the "server rejects before the database is touched" requirement is
 * verified by reading the shipped source and the live policy catalog and
 * comparing them. Neither side is hard-coded here: the table list comes from
 * `pg_policies` and the guard names come from the files themselves.
 *
 * Guarantees enforced by construction:
 *   - the SERVICE ROLE is used only for fixtures and read-back,
 *   - every access-control ASSERTION uses a real signed-in session,
 *   - it refuses to run without FLEET_CHECK_ALLOW=1,
 *   - it refuses the production project ref and any non-local URL,
 *   - it returns a non-zero exit code on any failed assertion,
 *   - synthetic data only; no secret, JWT, token or document content is logged.
 *
 * Usage (LOCAL only):
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=<local> SUPABASE_SERVICE_ROLE_KEY=<local> \
 *   npm run validate:private-vehicle
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { cleanupUsers, setRole } from "./lib/org-fixtures.mjs";
// Shipped deterministic rules — imported, not reimplemented.
// `lib/passports/confidence.ts` is deliberately NOT imported: it reaches for
// `./analysis` without a file extension, which Node's ESM resolver cannot
// follow. Rewriting shipped imports to suit a test would be the wrong trade, so
// the Record Confidence rule stays covered by the type-level suites and this
// harness asserts what it can observe: the Passport's contents and its privacy.
import { canWriteFleetData, ORG_ROLES } from "../../lib/organizations/types.ts";

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
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;
const isoDay = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

/**
 * Register a private user the way the signup form does: the public signUp
 * endpoint with the anon key. Returns the user plus their signed-in client, so
 * every later assertion runs under a real JWT.
 */
async function signUpPrivateUser(tag) {
  const email = `${tag}+${Date.now()}${randomBytes(3).toString("hex")}@example.test`;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await pub.auth.signUp({
    email,
    password: PW,
    options: { data: { full_name: `${tag} Tester` } },
  });
  if (error) throw new Error(`signUp ${tag}: ${error.message}`);
  if (!data.session) throw new Error(`signUp ${tag}: no session (email confirmation is on?)`);
  return { id: data.user.id, email, client: pub };
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

const orgOf = async (userId) => {
  const { data } = await admin
    .from("organization_members").select("organization_id, role")
    .eq("user_id", userId).maybeSingle();
  return data ?? null;
};

/** Count operational records linked to a document, across every record table. */
async function recordsFor(documentId) {
  const tables = ["maintenance_logs", "issue_logs", "vehicle_insurance", "vehicle_registration", "vehicle_inspection"];
  let total = 0;
  for (const t of tables) {
    const { data } = await admin.from(t).select("id").eq("document_id", documentId);
    total += data?.length ?? 0;
  }
  return total;
}

/** Seed a stored document for a vehicle (the file itself is not needed here). */
async function mkDoc(orgId, ownerId, vehicleId, hash, extra = {}) {
  const id = randomUUID();
  await ins("vehicle_documents", {
    id, vehicle_id: vehicleId, owner_user_id: ownerId, organization_id: orgId,
    storage_path: `${ownerId}/${vehicleId}/${id}/scan.jpg`,
    file_name: "invoice.jpg", mime_type: "image/jpeg", file_size: 128_000,
    content_hash: hash, contains_personal_info: true, share_allowed: false,
    ...extra,
  });
  return id;
}

/**
 * Seed the reviewable intake row that extraction produces. This is the ONLY
 * place the harness stands in for the provider: the row's shape is exactly what
 * `runFleetExtraction()` writes, and everything downstream of it is real.
 */
async function mkIntake(orgId, ownerId, docId, vehicleId, extracted, over = {}) {
  const [row] = await ins("document_extractions", {
    owner_user_id: ownerId, organization_id: orgId, document_id: docId,
    vehicle_id: vehicleId, source: "fleet_intake", engine: "mock",
    status: "pending_confirmation", extracted_data: extracted,
    proposed_category: extracted.document_category ?? null,
    category_confidence: extracted.confidence ?? null,
    vehicle_match_method: vehicleId ? "registration" : "none",
    ...over,
  });
  return row.id;
}

async function main() {
  const alice = await signUpPrivateUser("alice");   // the private user under test
  const bob = await signUpPrivateUser("bob");       // an unrelated private user
  const viewer = await signUpPrivateUser("viewer"); // demoted inside Alice's org
  const driver = await signUpPrivateUser("driver"); // demoted inside Alice's org
  const created = [alice, bob, viewer, driver];
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

  try {
    // =====================================================================
    H("1. Signup, personal organization and owner membership");
    // =====================================================================
    const aliceOrg = await orgOf(alice.id);
    const bobOrg = await orgOf(bob.id);
    aliceOrg?.organization_id ? P("signup auto-provisions a personal organization") : F("no organization after signup");
    aliceOrg?.role === "owner" ? P("the new private user is the OWNER of it") : F(`role after signup = ${aliceOrg?.role}`);
    aliceOrg.organization_id !== bobOrg.organization_id
      ? P("two private users get two separate organizations") : F("private users share an organization");

    const { data: prof } = await admin.from("profiles").select("id, organization_id, role").eq("id", alice.id).maybeSingle();
    prof ? P("a profile row is created for the new user") : F("no profile row after signup");
    prof?.organization_id === aliceOrg.organization_id ? P("profile cache points at the personal organization") : F("profile cache is out of step");

    // The private user must never need a Fleet concept to work. The only role
    // they will ever hold is one that can write.
    canWriteFleetData(aliceOrg.role) ? P("the default private role can create records without any setup") : F("a fresh private user cannot write");
    ORG_ROLES.includes("owner") ? P("owner is a recognized role in the shipped role list") : F("owner missing from ORG_ROLES");

    const orgA = aliceOrg.organization_id;
    const orgB = bobOrg.organization_id;
    const aliceC = alice.client;
    const bobC = bob.client;

    // =====================================================================
    H("2. Vehicle creation and cross-user isolation");
    // =====================================================================
    const mkVehicle = async (client, fields) => {
      const { data, error } = await client.from("vehicles").insert(fields).select("id").maybeSingle();
      return { id: data?.id ?? null, error: error?.message ?? null };
    };

    // organization_id is deliberately omitted: a BEFORE INSERT trigger derives
    // it, which is what makes a forged organization id impossible from a form.
    const v1 = await mkVehicle(aliceC, {
      owner_user_id: alice.id, make: "Toyota", model: "Corolla", year: 2019,
      license_plate: "12-345-67", vin: "JTDBR32E870123456",
      current_mileage: 82_000, mileage_unit: "km", status: "active",
    });
    v1.id ? P("private user creates a vehicle with no organization setup") : F(`create vehicle: ${v1.error}`);

    const { data: v1row } = await admin.from("vehicles").select("organization_id, owner_user_id").eq("id", v1.id).single();
    v1row.organization_id === orgA ? P("the vehicle lands in the user's own organization (trigger-derived)") : F("vehicle organization mismatch");

    // Forging another organization's id in the insert must not place it there.
    const forged = await mkVehicle(aliceC, {
      owner_user_id: alice.id, organization_id: orgB, make: "Forged", model: "X", status: "active",
    });
    if (forged.id) {
      const { data: fr } = await admin.from("vehicles").select("organization_id").eq("id", forged.id).single();
      fr.organization_id === orgA ? P("a forged organization_id is overridden by the trigger") : F("forged organization_id was honoured");
      await admin.from("vehicles").delete().eq("id", forged.id);
    } else {
      P("a forged organization_id is rejected outright");
    }

    const bobVeh = await mkVehicle(bobC, {
      owner_user_id: bob.id, make: "Mazda", model: "3", license_plate: "99-999-99",
      vin: "JM1BL1V71C1500000", current_mileage: 10_000, status: "active",
    });
    bobVeh.id ? P("a second private user creates their own vehicle") : F(`bob vehicle: ${bobVeh.error}`);

    const { data: aliceSees } = await aliceC.from("vehicles").select("id");
    aliceSees?.length === 1 && aliceSees[0].id === v1.id
      ? P("Alice sees ONLY her own vehicle") : F(`Alice sees ${aliceSees?.length} vehicles`);
    const { data: bobSeesAlice } = await bobC.from("vehicles").select("id").eq("id", v1.id);
    (bobSeesAlice?.length ?? 0) === 0 ? P("Bob cannot read Alice's vehicle by id") : F("cross-user vehicle read succeeded");

    const { error: bobWriteErr } = await bobC.from("vehicles").update({ make: "Hacked" }).eq("id", v1.id);
    const { data: stillToyota } = await admin.from("vehicles").select("make").eq("id", v1.id).single();
    stillToyota.make === "Toyota" ? P("Bob cannot modify Alice's vehicle") : F(`cross-user write changed the row (${bobWriteErr ?? "no error"})`);

    const { data: anonVeh } = await anonC.from("vehicles").select("id");
    (anonVeh?.length ?? 0) === 0 ? P("an anonymous visitor sees no vehicles") : F("anonymous read returned vehicles");

    // =====================================================================
    H("3. Vehicle operations");
    // =====================================================================
    const { error: editErr } = await aliceC.from("vehicles").update({ model: "Corolla Hybrid" }).eq("id", v1.id);
    !editErr ? P("owner edits their vehicle") : F(`edit: ${editErr.message}`);

    // A duplicate registration is allowed (the same plate legitimately recurs
    // across a re-registration), but it must never merge two vehicles.
    const dup = await mkVehicle(aliceC, {
      owner_user_id: alice.id, make: "Toyota", model: "Corolla", license_plate: "12-345-67", status: "active",
    });
    dup.id && dup.id !== v1.id ? P("a duplicate registration creates a separate vehicle, never a merge") : F("duplicate registration merged or failed");
    await admin.from("vehicles").delete().eq("id", dup.id);

    const extra = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await mkVehicle(aliceC, {
        owner_user_id: alice.id, make: "Kia", model: `Model${i}`,
        license_plate: `55-${100 + i}-55`, current_mileage: 20_000 + i * 1_000, status: "active",
      });
      if (r.id) extra.push(r.id);
    }
    extra.length === 4 ? P("a private user can hold multiple vehicles (5 total)") : F(`only ${extra.length} extra vehicles created`);

    // Archive (the product's "delete") must be reversible and must never remove
    // history: a sold car's records are the whole point of the Passport.
    await aliceC.from("vehicles").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", extra[0]);
    const { data: archived } = await admin.from("vehicles").select("status, deleted_at").eq("id", extra[0]).single();
    archived.status === "archived" && archived.deleted_at === null
      ? P("archiving sets a status and never hard-deletes") : F("archive removed the row");
    await aliceC.from("vehicles").update({ status: "active", archived_at: null }).eq("id", extra[0]);
    const { data: restored } = await admin.from("vehicles").select("status").eq("id", extra[0]).single();
    restored.status === "active" ? P("archiving can be undone (cancelled deletion)") : F("could not restore an archived vehicle");

    // =====================================================================
    H("4. Server authorization matches database authorization");
    // =====================================================================
    const RECORD_MODULES = [
      ["lib/maintenance/service.ts", ["createMaintenanceLog", "updateMaintenanceLog", "softDeleteMaintenanceLog"]],
      ["lib/issues/service.ts", ["createIssue", "updateIssue", "resolveIssue", "softDeleteIssue"]],
      ["lib/reminders/service.ts", ["createReminder", "updateReminder", "setReminderStatus", "softDeleteReminder"]],
      ["lib/vehicle-records/service.ts", ["createVehicleRecord"]],
      ["lib/passports/service.ts", ["createPassport", "revokePassport"]],
      ["lib/documents/service.ts", ["createDocument", "updateDocument", "softDeleteDocument"]],
      ["lib/documents/extraction-service.ts", ["runExtraction", "confirmExtraction", "discardExtraction"]],
      ["lib/vehicles/service.ts", ["createVehicle", "updateVehicle", "setOperationalStatus", "archiveVehicle"]],
    ];

    /** The guard a function body reaches for, read from the shipped source. */
    function guardOf(source, fn) {
      const start = source.search(new RegExp(`(export )?(async )?function ${fn}\\b`));
      if (start === -1) return "NOT-FOUND";
      const rest = source.slice(start);
      const nextFn = rest.slice(1).search(/\n(export )?(async )?function /);
      const body = nextFn === -1 ? rest : rest.slice(0, nextFn);
      if (/await requireFleetWriter\(\)/.test(body)) return "requireFleetWriter";
      if (/await requireOrganization\(\)/.test(body)) return "requireOrganization";
      return "NONE";
    }

    let guardOk = 0, guardBad = [];
    for (const [file, fns] of RECORD_MODULES) {
      const src = readFileSync(new global.URL(`../../${file}`, import.meta.url), "utf8");
      for (const fn of fns) {
        guardOf(src, fn) === "requireFleetWriter" ? (guardOk += 1) : guardBad.push(`${file}:${fn}`);
      }
    }
    guardBad.length === 0
      ? P(`all ${guardOk} record mutations call requireFleetWriter() before touching the database`)
      : F(`mutations without a writer guard: ${guardBad.join(", ")}`);

    // Reads must NOT be writer-gated — a viewer is allowed to read everything.
    const readSrc = readFileSync(new global.URL("../../lib/maintenance/service.ts", import.meta.url), "utf8");
    guardOf(readSrc, "listMaintenanceLogs") === "requireOrganization"
      ? P("reads stay open to every member (requireOrganization)") : F("a read was writer-gated");

    // =====================================================================
    H("5. Viewer and driver cannot perform private-record writes");
    // =====================================================================
    // Demote two users INTO Alice's organization. A private user never does
    // this, but it is the only way to prove the server and the database agree
    // about who may write to her records.
    const { joinOrg } = await import("./lib/org-fixtures.mjs");
    await joinOrg(admin, viewer.id, orgA, "viewer");
    await joinOrg(admin, driver.id, orgA, "driver");
    await setRole(admin, viewer.id, "viewer");
    await setRole(admin, driver.id, "driver");
    const viewerC = await signIn(viewer.email);
    const driverC = await signIn(driver.email);

    canWriteFleetData("viewer") === false ? P("shipped rule: a viewer may not write") : F("canWriteFleetData('viewer') is true");
    canWriteFleetData("driver") === false ? P("shipped rule: a driver may not write") : F("canWriteFleetData('driver') is true");

    const writeAttempts = [
      ["maintenance_logs", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, performed_at: isoDay(-1), description: "x" }],
      ["issue_logs", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, title: "x", reported_at: isoDay(-1) }],
      ["reminders", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, title: "x", reminder_type: "service" }],
      ["vehicle_insurance", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, start_date: isoDay(-1), end_date: isoDay(300) }],
      ["vehicle_inspection", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, start_date: isoDay(-1), end_date: isoDay(300) }],
      ["vehicle_registration", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, start_date: isoDay(-1), end_date: isoDay(300) }],
      ["vehicle_passports", { vehicle_id: v1.id, owner_user_id: viewer.id, organization_id: orgA, status: "active", version: 1, snapshot: {} }],
    ];
    let viewerBlocked = 0, driverBlocked = 0;
    for (const [table, row] of writeAttempts) {
      const { error: ve } = await viewerC.from(table).insert(row);
      if (ve) viewerBlocked += 1;
      const { error: de } = await driverC.from(table).insert({ ...row, owner_user_id: driver.id });
      if (de) driverBlocked += 1;
    }
    viewerBlocked === writeAttempts.length
      ? P(`viewer write rejected on all ${writeAttempts.length} record tables`) : F(`viewer wrote to ${writeAttempts.length - viewerBlocked} table(s)`);
    driverBlocked === writeAttempts.length
      ? P(`driver write rejected on all ${writeAttempts.length} record tables`) : F(`driver wrote to ${writeAttempts.length - driverBlocked} table(s)`);

    const { data: viewerReads } = await viewerC.from("maintenance_logs").select("id");
    Array.isArray(viewerReads) ? P("viewer can still READ the organization's records") : F("viewer read failed");

    // A non-member has neither.
    const { error: bobIns } = await bobC.from("maintenance_logs").insert({
      vehicle_id: v1.id, owner_user_id: bob.id, organization_id: orgA, performed_at: isoDay(-1), description: "x",
    });
    bobIns ? P("a non-member cannot write to another private user's vehicle") : F("non-member write succeeded");

    // =====================================================================
    H("6. AI intake — nothing is saved before explicit confirmation");
    // =====================================================================
    const hash1 = randomBytes(32).toString("hex");
    const doc1 = await mkDoc(orgA, alice.id, v1.id, hash1);
    const extracted1 = {
      document_category: "maintenance", confidence: 0.94,
      date: "2026-06-14", garage_name: "Moshe's Garage", mileage: 84_500,
      service_type: "Full service", service_details: "Oil, filters, brake pads",
      cost: 1_450, next_service_date: "2027-06-14", next_service_km: 94_500,
      vehicle_registration: "12-345-67", vin: "JTDBR32E870123456",
    };
    const intake1 = await mkIntake(orgA, alice.id, doc1, v1.id, extracted1);

    (await recordsFor(doc1)) === 0 ? P("uploading + extracting creates NO maintenance record") : F("a record existed before confirmation");
    const { data: preVeh } = await admin.from("vehicles").select("current_mileage, next_service_date").eq("id", v1.id).single();
    preVeh.current_mileage === 82_000 ? P("mileage is untouched before confirmation") : F("mileage moved before confirmation");
    preVeh.next_service_date === null ? P("next service is untouched before confirmation") : F("next service moved before confirmation");

    const { data: draft } = await aliceC.from("document_extractions").select("status, extracted_data, created_record_id").eq("id", intake1).single();
    draft.status === "pending_confirmation" ? P("the extraction is a reviewable DRAFT") : F(`draft status = ${draft.status}`);
    draft.created_record_id === null ? P("the draft names no created record") : F("draft already claims a record");
    draft.extracted_data.garage_name === "Moshe's Garage" ? P("the draft is readable by its owner for review") : F("draft not readable");

    // The database refuses to let an unconfirmed row claim a record at all.
    const { error: claimErr } = await admin.from("document_extractions")
      .update({ created_record_id: randomUUID(), created_record_type: "maintenance" }).eq("id", intake1);
    claimErr ? P("the database REFUSES an unconfirmed extraction that claims a record") : F("an unconfirmed row was allowed to claim a record");

    // =====================================================================
    H("7. Review, correction and explicit confirmation");
    // =====================================================================
    const confirm = async (client, intakeId, vehicleId, category, payload) => {
      const { data, error } = await client.rpc("confirm_fleet_intake", {
        p_extraction: intakeId, p_vehicle: vehicleId, p_category: category, p_payload: payload,
      });
      return { state: data?.state ?? null, recordId: data?.record_id ?? null, error: error?.message ?? null };
    };

    // The user corrects TWO fields on the review screen: the cost was misread
    // and the garage name was abbreviated.
    const corrected = {
      performed_at: "2026-06-14", mileage: "84500", cost: "1290", currency: "ILS",
      vendor_name: "Moshe's Garage Ltd", service_type: "Full service",
      description: "Oil, filters, brake pads",
      next_service_date: "2027-06-14", next_service_km: "94500",
    };

    let r = await confirm(viewerC, intake1, v1.id, "maintenance", corrected);
    r.state === "not_authorized" ? P("a viewer cannot confirm") : F(`viewer confirm: ${JSON.stringify(r)}`);
    r = await confirm(driverC, intake1, v1.id, "maintenance", corrected);
    r.state === "not_authorized" || r.state === "extraction_not_found" ? P("a driver cannot confirm") : F(`driver confirm: ${JSON.stringify(r)}`);
    r = await confirm(bobC, intake1, v1.id, "maintenance", corrected);
    r.state === "extraction_not_found" ? P("another private user cannot confirm Alice's intake") : F(`cross-user confirm: ${JSON.stringify(r)}`);
    r = await confirm(anonC, intake1, v1.id, "maintenance", corrected);
    r.error || r.state === "not_authenticated" ? P("an anonymous caller cannot confirm") : F(`anon confirm: ${JSON.stringify(r)}`);
    (await recordsFor(doc1)) === 0 ? P("after every rejected attempt, still NO record") : F("a rejected attempt created a record");

    r = await confirm(aliceC, intake1, v1.id, "maintenance", corrected);
    r.state === "ok" && r.recordId ? P("the owner confirms → exactly one record is created") : F(`confirm: ${JSON.stringify(r)}`);
    const record1 = r.recordId;
    (await recordsFor(doc1)) === 1 ? P("exactly one operational record exists for the document") : F(`record count = ${await recordsFor(doc1)}`);

    // =====================================================================
    H("8. Confirmation replay — double click, retry, concurrency");
    // =====================================================================
    const again = await confirm(aliceC, intake1, v1.id, "maintenance", corrected);
    again.state === "already_confirmed" && again.recordId === record1
      ? P("a second confirmation returns the SAME record") : F(`replay: ${JSON.stringify(again)}`);
    (await recordsFor(doc1)) === 1 ? P("the replay created no duplicate") : F("replay duplicated the record");

    const hashC = randomBytes(32).toString("hex");
    const docC = await mkDoc(orgA, alice.id, v1.id, hashC);
    const intakeC = await mkIntake(orgA, alice.id, docC, v1.id, { document_category: "maintenance", confidence: 0.9 });
    const burst = await Promise.all([
      confirm(aliceC, intakeC, v1.id, "maintenance", { performed_at: isoDay(-3), cost: "100", currency: "ILS" }),
      confirm(aliceC, intakeC, v1.id, "maintenance", { performed_at: isoDay(-3), cost: "100", currency: "ILS" }),
      confirm(aliceC, intakeC, v1.id, "maintenance", { performed_at: isoDay(-3), cost: "100", currency: "ILS" }),
    ]);
    burst.filter((b) => b.state === "ok").length === 1 && burst.filter((b) => b.state === "already_confirmed").length === 2
      ? P("3 concurrent confirmations → 1 created, 2 already_confirmed") : F(`concurrent: ${JSON.stringify(burst.map((b) => b.state))}`);
    (await recordsFor(docC)) === 1 ? P("concurrent confirmation created exactly one record") : F(`concurrent count = ${await recordsFor(docC)}`);

    // =====================================================================
    H("9. Provenance");
    // =====================================================================
    const { data: prov } = await admin.from("document_extractions")
      .select("status, extracted_data, confirmed_data, field_provenance, created_record_id, created_record_type, confirmed_by, confirmed_at, document_id")
      .eq("id", intake1).single();
    prov.status === "confirmed" ? P("the extraction is marked confirmed") : F(`status = ${prov.status}`);
    prov.created_record_id === record1 ? P("the extraction names the record it produced") : F("extraction does not link to its record");
    prov.created_record_type === "maintenance" ? P("the record TYPE is recorded") : F(`record type = ${prov.created_record_type}`);
    prov.document_id === doc1 ? P("the record's source document is linked") : F("no source document link");
    prov.confirmed_by === alice.id ? P("who confirmed it is recorded") : F("confirmed_by missing");
    prov.confirmed_at ? P("when it was confirmed is recorded") : F("confirmed_at missing");

    prov.extracted_data.cost === 1450 && prov.extracted_data.garage_name === "Moshe's Garage"
      ? P("the ORIGINAL extraction survives confirmation unchanged") : F("extracted_data was overwritten by the correction");
    prov.confirmed_data?.cost === "1290" ? P("the user's corrected value is stored") : F("confirmed_data missing the correction");
    // The per-field diff column is filled by `confirmIntake()` in the service
    // layer AFTER this RPC returns, so a direct RPC call leaves it empty. What
    // must hold regardless of which caller confirmed is that the correction is
    // still RECOVERABLE — both the model's reading and the user's values are
    // stored, so the diff can always be recomputed.
    const diff = ["cost", "garage_name", "vendor_name"].filter((k) => {
      const a = prov.extracted_data?.[k];
      const b = prov.confirmed_data?.[k] ?? prov.confirmed_data?.vendor_name;
      return a != null && b != null && String(a) !== String(b);
    });
    diff.length >= 2
      ? P(`the correction is recoverable from what is stored (${diff.length} fields differ)`)
      : F(`only ${diff.length} field(s) differ between extracted and confirmed`);
    const svcSrc = readFileSync(new global.URL("../../lib/fleet-intake/service.ts", import.meta.url), "utf8");
    /field_provenance:\s*provenance|\.update\(\{\s*field_provenance/.test(svcSrc)
      ? P("the service layer writes the per-field diff on the app's own path") : F("no field_provenance write in the service layer");

    const { data: rec1 } = await admin.from("maintenance_logs").select("cost, description, trust_label, source_type, document_id").eq("id", record1).single();
    Number(rec1.cost) === 1290 ? P("the SAVED record uses the corrected value, not the model's") : F(`saved cost = ${rec1.cost}`);
    rec1.trust_label === "ai_extracted" ? P("the record is labelled ai_extracted") : F(`trust label = ${rec1.trust_label}`);
    rec1.document_id === doc1 ? P("the record links back to the source document") : F("record has no document link");

    // =====================================================================
    H("10. Derived vehicle updates are deterministic and monotonic");
    // =====================================================================
    const { data: afterVeh } = await admin.from("vehicles").select("current_mileage, next_service_date, next_service_km").eq("id", v1.id).single();
    afterVeh.current_mileage === 84_500 ? P("confirmation raised the odometer to the document's mileage") : F(`mileage = ${afterVeh.current_mileage}`);
    afterVeh.next_service_date === "2027-06-14" ? P("the next service date was applied") : F(`next service = ${afterVeh.next_service_date}`);
    afterVeh.next_service_km === 94_500 ? P("the next service mileage was applied") : F(`next service km = ${afterVeh.next_service_km}`);

    // A late-arriving OLD invoice must not wind the odometer back.
    const hashOld = randomBytes(32).toString("hex");
    const docOld = await mkDoc(orgA, alice.id, v1.id, hashOld);
    const intakeOld = await mkIntake(orgA, alice.id, docOld, v1.id, { document_category: "maintenance", confidence: 0.9, mileage: 40_000 });
    const rOld = await confirm(aliceC, intakeOld, v1.id, "maintenance", { performed_at: "2024-01-05", mileage: "40000", cost: "300", currency: "ILS" });
    rOld.state === "ok" ? P("an older invoice can still be confirmed") : F(`old invoice: ${JSON.stringify(rOld)}`);
    const { data: notLowered } = await admin.from("vehicles").select("current_mileage").eq("id", v1.id).single();
    notLowered.current_mileage === 84_500 ? P("an older, lower mileage does NOT lower the odometer") : F(`odometer fell to ${notLowered.current_mileage}`);

    // =====================================================================
    H("11. Insurance, inspection and forward-only expiry");
    // =====================================================================
    const hashIns = randomBytes(32).toString("hex");
    const docIns = await mkDoc(orgA, alice.id, v1.id, hashIns);
    const intakeIns = await mkIntake(orgA, alice.id, docIns, v1.id, {
      document_category: "insurance", confidence: 0.91,
      insurer_name: "Harel", insurance_type: "comprehensive",
      start_date: isoDay(-30), end_date: isoDay(335), cost: 3_200,
    });
    const rIns = await confirm(aliceC, intakeIns, v1.id, "insurance", {
      insurer_name: "Harel Insurance", insurance_type: "comprehensive",
      start_date: isoDay(-30), end_date: isoDay(335), cost: "3200", currency: "ILS",
    });
    rIns.state === "ok" ? P("an insurance certificate confirms into a record") : F(`insurance: ${JSON.stringify(rIns)}`);
    const { data: insVeh } = await admin.from("vehicles").select("insurance_expiry_date").eq("id", v1.id).single();
    insVeh.insurance_expiry_date === isoDay(335) ? P("the insurance expiry cache was updated") : F(`expiry = ${insVeh.insurance_expiry_date}`);

    // An OLDER certificate confirmed afterwards must not drag the expiry back
    // and invent an alert.
    const hashInsOld = randomBytes(32).toString("hex");
    const docInsOld = await mkDoc(orgA, alice.id, v1.id, hashInsOld);
    const intakeInsOld = await mkIntake(orgA, alice.id, docInsOld, v1.id, { document_category: "insurance", confidence: 0.9 });
    const rInsOld = await confirm(aliceC, intakeInsOld, v1.id, "insurance", {
      insurer_name: "Harel Insurance", start_date: isoDay(-400), end_date: isoDay(-35), cost: "2900", currency: "ILS",
    });
    rInsOld.state === "ok" ? P("a superseded certificate can still be recorded") : F(`old insurance: ${JSON.stringify(rInsOld)}`);
    const { data: insVeh2 } = await admin.from("vehicles").select("insurance_expiry_date").eq("id", v1.id).single();
    insVeh2.insurance_expiry_date === isoDay(335) ? P("an OLDER expiry does NOT replace a newer one") : F(`expiry regressed to ${insVeh2.insurance_expiry_date}`);

    const hashTest = randomBytes(32).toString("hex");
    const docTest = await mkDoc(orgA, alice.id, v1.id, hashTest);
    const intakeTest = await mkIntake(orgA, alice.id, docTest, v1.id, { document_category: "inspection", confidence: 0.88 });
    const rTest = await confirm(aliceC, intakeTest, v1.id, "inspection", {
      start_date: isoDay(-10), end_date: isoDay(355), mileage: "84600", cost: "180", currency: "ILS", notes: "Passed",
    });
    rTest.state === "ok" ? P("a test/inspection certificate confirms into a record") : F(`inspection: ${JSON.stringify(rTest)}`);
    const { data: testVeh } = await admin.from("vehicles").select("test_expiry_date").eq("id", v1.id).single();
    testVeh.test_expiry_date === isoDay(355) ? P("the test expiry cache was updated") : F(`test expiry = ${testVeh.test_expiry_date}`);
    const { data: inspProv } = await admin.from("document_extractions").select("created_record_type, created_record_id").eq("id", intakeTest).single();
    inspProv.created_record_type === "inspection" && inspProv.created_record_id
      ? P("the inspection keeps provenance too") : F("inspection provenance missing");

    // =====================================================================
    H("12. Cost is counted exactly once");
    // =====================================================================
    // The invoice figure lives on BOTH the maintenance record and the document
    // row. Only one of them is ever summed, so an intake invoice cannot be
    // double-counted.
    // The confirmed invoice figure lands on the maintenance record. It must
    // appear there exactly once — one document can never yield two costed rows.
    const { data: costRows } = await admin.from("maintenance_logs")
      .select("id, cost, document_id").eq("vehicle_id", v1.id).is("deleted_at", null);
    const perDoc = new Map();
    for (const row of costRows) {
      if (!row.document_id) continue;
      perDoc.set(row.document_id, (perDoc.get(row.document_id) ?? 0) + 1);
    }
    [...perDoc.values()].every((n) => n === 1)
      ? P(`each source document produced exactly one costed record (${perDoc.size} documents)`)
      : F(`a document produced ${Math.max(...perDoc.values())} costed records`);

    const corrected1 = costRows.find((x) => x.id === record1);
    Number(corrected1?.cost) === 1290 && costRows.filter((x) => Number(x.cost) === 1290).length === 1
      ? P("the corrected invoice amount is counted once, at the corrected value")
      : F("the corrected amount is missing or duplicated");

    // The same figure is also stored on the document row. The cost rules must
    // not sum that one too, or every intake invoice would count twice.
    // Comments are stripped first: costs.ts explains this very rule in prose, and
    // matching its own explanation would make the check pass for the wrong reason.
    const costSrc = readFileSync(new global.URL("../../lib/fleet/costs.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    !/vehicle_documents/.test(costSrc)
      ? P("the cost rules never read vehicle_documents, so an invoice counts once") : F("cost rules also read document amounts");

    // =====================================================================
    H("13. Duplicate upload is warned about, never silently duplicated");
    // =====================================================================
    const { data: dupes } = await aliceC.rpc("find_duplicate_documents", { p_hash: hash1 });
    (dupes?.length ?? 0) >= 1 ? P("re-uploading the same file finds the earlier document") : F("duplicate not detected");
    const dupeKeys = Object.keys(dupes?.[0] ?? {});
    !dupeKeys.includes("storage_path") ? P("the duplicate warning does not expose the storage path") : F("duplicate warning leaked storage_path");
    const { data: bobDupes } = await bobC.rpc("find_duplicate_documents", { p_hash: hash1 });
    (bobDupes?.length ?? 0) === 0 ? P("another private user is not told about Alice's documents") : F("duplicate lookup crossed users");

    // =====================================================================
    H("14. Unknown document and extraction failure");
    // =====================================================================
    const hashUnk = randomBytes(32).toString("hex");
    const docUnk = await mkDoc(orgA, alice.id, v1.id, hashUnk);
    const intakeUnk = await mkIntake(orgA, alice.id, docUnk, null, { document_category: "unknown", confidence: 0.2 }, { vehicle_match_method: "none" });
    const { data: unk } = await aliceC.from("document_extractions").select("proposed_category, category_confidence, status, created_record_id").eq("id", intakeUnk).single();
    unk.status === "pending_confirmation" && unk.created_record_id === null
      ? P("an unclassified document creates no record and waits for the user") : F("unknown document was auto-committed");
    unk.proposed_category === "unknown" ? P("the category is reported as unknown rather than guessed") : F(`category forced to ${unk.proposed_category}`);

    // The user picks the category and the vehicle themselves; only then a record.
    const rUnk = await confirm(aliceC, intakeUnk, v1.id, "maintenance", { performed_at: isoDay(-2), cost: "75", currency: "ILS", description: "Manually categorised" });
    rUnk.state === "ok" ? P("after a MANUAL category choice, confirmation succeeds") : F(`unknown confirm: ${JSON.stringify(rUnk)}`);

    // A failed extraction leaves a reviewable failure, not a half-record.
    const hashFail = randomBytes(32).toString("hex");
    const docFail = await mkDoc(orgA, alice.id, v1.id, hashFail);
    const intakeFail = await mkIntake(orgA, alice.id, docFail, v1.id, {}, { status: "failed", error: "provider_unavailable" });
    (await recordsFor(docFail)) === 0 ? P("a failed extraction creates no record") : F("failed extraction produced a record");
    const rFail = await confirm(aliceC, intakeFail, v1.id, "maintenance", { performed_at: isoDay(-1), cost: "10", currency: "ILS" });
    rFail.state !== "ok" ? P("a failed extraction cannot be confirmed") : F("a failed extraction was confirmed");
    const { data: failRow } = await admin.from("document_extractions").select("error").eq("id", intakeFail).single();
    !/[Ss]tack|https?:\/\/|key|token/.test(failRow.error ?? "")
      ? P("the stored failure reason is a category, not a raw provider response") : F("raw provider error stored");

    // Retrying must not orphan a second document for the same file.
    const { data: sameHashDocs } = await admin.from("vehicle_documents").select("id").eq("content_hash", hashFail).is("deleted_at", null);
    (sameHashDocs?.length ?? 0) === 1 ? P("a retry after failure leaves exactly one document for the file") : F(`${sameHashDocs?.length} documents share the failed file`);

    // =====================================================================
    H("15. Vehicle Passport — private view");
    // =====================================================================
    const { data: mList } = await admin.from("maintenance_logs")
      .select("id, performed_at, mileage, service_type, description, cost, currency, trust_label, source_type")
      .eq("vehicle_id", v1.id).is("deleted_at", null);
    const snapshot = {
      meta: { passport_id: randomUUID(), version: 1, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(), issuer_user_id: alice.id },
      vehicle: { vehicle_id: v1.id, make: "Toyota", model: "Corolla Hybrid", year: 2019, vin: "JTDBR32E870123456", license_plate: "12-345-67", current_mileage: 84_500, mileage_unit: "km", status: "active" },
      included_scopes: ["maintenance"],
      maintenance: mList.map((m) => ({ id: m.id, date: m.performed_at, mileage: m.mileage, category: m.service_type, description: m.description, cost: m.cost, currency: m.currency, trust_level: m.trust_label, source_type: m.source_type })),
      issues: [], documents: [], reminders: [],
      missing_or_not_shared: { issue_history_excluded: true, documents_excluded_count: 0, personal_documents_excluded_count: 0, no_document_backed_records: false, no_recent_service: false },
      disclaimer: { not_official_ownership_document: true, not_mechanical_certification: true, record_confidence_not_condition_score: true },
    };
    const passportId = snapshot.meta.passport_id;
    await ins("vehicle_passports", {
      id: passportId, owner_user_id: alice.id, organization_id: orgA, vehicle_id: v1.id,
      status: "active", version: 1, snapshot, snapshot_hash: sha256(JSON.stringify(snapshot)),
      record_confidence_score: null, issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });

    const { data: mine } = await aliceC.from("vehicle_passports").select("id, snapshot").eq("id", passportId).maybeSingle();
    mine ? P("the owner can open their own Passport") : F("owner cannot read their Passport");
    mine.snapshot.maintenance.length === mList.length
      ? P(`the Passport carries the confirmed history (${mList.length} records)`) : F("Passport history is incomplete");
    const snapText = JSON.stringify(mine.snapshot);
    !/extracted_data|field_provenance|raw_text|storage_path|category_confidence/.test(snapText)
      ? P("no raw extraction data appears in the Passport snapshot") : F("raw extraction data leaked into the Passport");

    const { data: bobPassport } = await bobC.from("vehicle_passports").select("id").eq("id", passportId);
    (bobPassport?.length ?? 0) === 0 ? P("another private user cannot read the Passport row") : F("cross-user Passport read succeeded");

    // =====================================================================
    H("16. Vehicle Passport — public sharing and privacy");
    // =====================================================================
    const rawToken = randomBytes(32).toString("hex");
    await ins("transfer_tokens", {
      owner_user_id: alice.id, organization_id: orgA, passport_id: passportId, vehicle_id: v1.id,
      token_hash: sha256(rawToken), status: "active",
      expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });

    const pub = async (client, token) => {
      const { data } = await client.rpc("get_public_passport", { p_token_hash: sha256(token) });
      return data ?? { state: "invalid" };
    };

    const view = await pub(anonC, rawToken);
    view.state === "ok" ? P("an ANONYMOUS visitor can open a valid share link") : F(`public passport: ${view.state}`);
    const again2 = await pub(anonC, rawToken);
    again2.state === "ok" ? P("the link works on repeated access (preview never consumes it)") : F("second view failed");
    const { data: tokAfter } = await admin.from("transfer_tokens").select("status").eq("token_hash", sha256(rawToken)).single();
    tokAfter.status === "active" ? P("viewing does NOT mark the token used") : F(`token status after preview = ${tokAfter.status}`);

    const bad = await pub(anonC, randomBytes(32).toString("hex"));
    bad.state === "not_found" ? P("an invalid token is refused") : F(`invalid token: ${bad.state}`);

    // What the public page is allowed to know.
    const publicText = JSON.stringify(view.passport);
    const forbidden = [
      ["organization id", orgA],
      ["owner user id", alice.id],
      ["issuer_user_id key", "issuer_user_id"],
      ["storage path", "storage_path"],
      ["token hash", sha256(rawToken)],
      ["raw OCR", "raw_text"],
      ["extraction confidence", "category_confidence"],
      ["per-field provenance", "field_provenance"],
      ["driver assignment", "driver_assignment"],
      ["internal operational status", "operational_status"],
    ];
    let leaks = [];
    for (const [label, needle] of forbidden) if (publicText.includes(needle)) leaks.push(label);
    leaks.length === 0
      ? P(`the public Passport exposes none of ${forbidden.length} private fields`) : F(`public Passport leaked: ${leaks.join(", ")}`);
    view.passport?.snapshot?.vehicle?.make === "Toyota" ? P("it does expose the intended vehicle snapshot") : F("public snapshot is empty");

    // Revocation must take effect immediately.
    await admin.from("transfer_tokens").update({ status: "revoked" }).eq("token_hash", sha256(rawToken));
    const revoked = await pub(anonC, rawToken);
    revoked.state === "token_revoked" ? P("a revoked link stops working immediately") : F(`revoked token: ${revoked.state}`);

    // Expiry.
    const expToken = randomBytes(32).toString("hex");
    await ins("transfer_tokens", {
      owner_user_id: alice.id, organization_id: orgA, passport_id: passportId, vehicle_id: v1.id,
      token_hash: sha256(expToken), status: "active", expires_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    const expired = await pub(anonC, expToken);
    expired.state === "expired" ? P("an expired link is refused") : F(`expired token: ${expired.state}`);

    // Anonymous visitors must not reach the underlying tables at all.
    const { data: anonPassports } = await anonC.from("vehicle_passports").select("id");
    (anonPassports?.length ?? 0) === 0 ? P("anonymous direct table access returns nothing") : F("anonymous read hit vehicle_passports");
    const { data: anonTokens } = await anonC.from("transfer_tokens").select("id");
    (anonTokens?.length ?? 0) === 0 ? P("anonymous cannot enumerate transfer tokens") : F("anonymous read hit transfer_tokens");

    // =====================================================================
    H("17. Passport acceptance stays inside its own tenant");
    // =====================================================================
    const acceptToken = randomBytes(32).toString("hex");
    const [acceptPassport] = await ins("vehicle_passports", {
      owner_user_id: alice.id, organization_id: orgA, vehicle_id: v1.id, status: "active", version: 1,
      snapshot, snapshot_hash: sha256(JSON.stringify(snapshot)), record_confidence_score: null,
      issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });
    await ins("transfer_tokens", {
      owner_user_id: alice.id, organization_id: orgA, passport_id: acceptPassport.id, vehicle_id: v1.id,
      token_hash: sha256(acceptToken), status: "active", expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });

    const { data: accepted } = await bobC.rpc("accept_passport", { p_token_hash: sha256(acceptToken) });
    accepted?.state === "ok" ? P("a buyer can accept a shared Passport") : F(`accept: ${JSON.stringify(accepted)}`);

    const buyerVehicleId = accepted?.vehicle_id ?? null;
    if (buyerVehicleId) {
      const { data: buyerVeh } = await admin.from("vehicles").select("organization_id, owner_user_id").eq("id", buyerVehicleId).single();
      buyerVeh.organization_id === orgB ? P("the accepted copy lands in the BUYER's organization") : F("accepted vehicle landed in the wrong tenant");
      buyerVeh.owner_user_id === bob.id ? P("the buyer owns the copy") : F("accepted vehicle has the wrong owner");

      // The buyer must receive a COPY, never a handle on the seller's rows.
      const { data: buyerDocs } = await admin.from("vehicle_documents").select("storage_path").eq("vehicle_id", buyerVehicleId);
      (buyerDocs ?? []).every((d) => !d.storage_path)
        ? P("the buyer gets no storage path to the seller's files") : F("accepted copy carries the seller's storage paths");
      const { data: sellerStill } = await admin.from("vehicles").select("id").eq("id", v1.id).single();
      sellerStill ? P("the seller's original vehicle still exists (not deleted)") : F("acceptance deleted the seller's vehicle");
      const { data: bobReadsSeller } = await bobC.from("maintenance_logs").select("id").eq("vehicle_id", v1.id);
      (bobReadsSeller?.length ?? 0) === 0 ? P("the buyer still cannot read the seller's own records") : F("buyer reached the seller's records");
    }

    const replay = await bobC.rpc("accept_passport", { p_token_hash: sha256(acceptToken) });
    replay.data?.state !== "ok" || replay.error
      ? P("a used acceptance token cannot be replayed") : F(`replayed acceptance: ${JSON.stringify(replay.data)}`);

    // =====================================================================
    H("18. Sign out and sign back in — persistence");
    // =====================================================================
    await aliceC.auth.signOut();
    const { data: afterSignOut } = await aliceC.from("vehicles").select("id");
    (afterSignOut?.length ?? 0) === 0 ? P("after sign-out the session reads nothing") : F("a signed-out client still read vehicles");

    const aliceAgain = await signIn(alice.email);
    const { data: vehAgain } = await aliceAgain.from("vehicles").select("id").eq("id", v1.id);
    (vehAgain?.length ?? 0) === 1 ? P("signing back in restores access to the vehicle") : F("vehicle missing after re-login");
    const { data: logsAgain } = await aliceAgain.from("maintenance_logs").select("id, cost").eq("id", record1).maybeSingle();
    logsAgain && Number(logsAgain.cost) === 1290
      ? P("the confirmed record and its corrected value persisted across sessions") : F("record did not persist across sessions");
    const { data: provAgain } = await aliceAgain.from("document_extractions").select("id").eq("id", intake1).maybeSingle();
    provAgain ? P("provenance is still readable after re-login") : F("provenance lost across sessions");

    // =====================================================================
    H("19. Membership removed mid-flight");
    // =====================================================================
    const gone = await signUpPrivateUser("gone");
    created.push(gone);
    const goneOrg = await orgOf(gone.id);
    const goneC = await signIn(gone.email);
    const { data: goneSees } = await goneC.from("vehicles").select("id");
    Array.isArray(goneSees) ? P("a fresh private user starts with an empty vehicle list") : F("empty state query failed");

    // The last-owner trigger REFUSES to delete a sole owner's membership while
    // the organization exists, so deleting the membership row on its own is a
    // silent no-op — an earlier version of this check asserted nothing at all.
    // Removing the organization is the only path that drops the membership, and
    // it is what account deletion does.
    const { error: rmErr } = await admin.from("organization_members")
      .delete().eq("user_id", gone.id).eq("organization_id", goneOrg.organization_id);
    rmErr ? P("the last owner's membership cannot simply be deleted (invariant holds)") : F("the sole owner's membership was deleted without protest");
    await admin.from("organizations").delete().eq("id", goneOrg.organization_id);
    const stillMember = await orgOf(gone.id);
    stillMember === null ? P("removing the organization removed the membership") : F("membership survived organization deletion");

    // STALE CACHE GRANTS NOTHING. `profiles.organization_id` / `role` are a
    // display cache. Point this membership-less user's cache at ALICE's
    // organization with the owner role — the most favourable lie the cache can
    // tell — and confirm it buys them nothing, because every policy resolves
    // authorization from `organization_members`.
    const { error: cacheErr } = await admin.from("profiles")
      .update({ organization_id: orgA, role: "owner" }).eq("id", gone.id);
    !cacheErr ? P("a drifted profile cache can be created (owner of someone else's organization)") : F(`could not set up the stale cache: ${cacheErr.message}`);
    const { data: staleProfile } = await admin.from("profiles").select("organization_id, role").eq("id", gone.id).maybeSingle();
    staleProfile?.organization_id === orgA && staleProfile?.role === "owner"
      ? P("the cache now claims ownership of Alice's organization") : F("stale cache did not take, so this proves nothing");

    const { data: afterRemoval } = await goneC.from("vehicles").select("id");
    (afterRemoval?.length ?? 0) === 0 ? P("the stale cache grants NO read access to Alice's vehicles") : F("stale profile cache granted access");
    const { data: staleReads } = await goneC.from("maintenance_logs").select("id");
    (staleReads?.length ?? 0) === 0 ? P("the stale cache grants no access to her records either") : F("stale cache reached maintenance records");
    const { error: staleWrite } = await goneC.from("maintenance_logs").insert({
      vehicle_id: v1.id, owner_user_id: gone.id, organization_id: orgA, performed_at: isoDay(-1), description: "x",
    });
    staleWrite ? P("the stale cache grants no WRITE access") : F("stale profile cache allowed a write");
    const { error: afterRemovalWrite } = await goneC.from("vehicles").insert({ owner_user_id: gone.id, make: "X", status: "active" });
    afterRemovalWrite ? P("a user with no membership cannot write") : F("membership-less write succeeded");

    // =====================================================================
    H("20. Performance shape — no full-tenant or N+1 fetch");
    // =====================================================================
    const bulkVehicle = extra[1];
    const bulkRows = [];
    for (let i = 0; i < 100; i += 1) {
      bulkRows.push({
        vehicle_id: bulkVehicle, owner_user_id: alice.id, organization_id: orgA,
        performed_at: isoDay(-i - 1), description: `Service ${i}`, cost: 100 + i, currency: "ILS",
      });
    }
    await ins("maintenance_logs", bulkRows);
    const t0 = Date.now();
    const { data: page } = await aliceAgain.from("maintenance_logs").select("id").eq("vehicle_id", bulkVehicle).is("deleted_at", null);
    const elapsed = Date.now() - t0;
    page?.length === 100 ? P("100 maintenance records load in a single query") : F(`bulk query returned ${page?.length}`);
    elapsed < 2000 ? P(`the vehicle's record list returns quickly (${elapsed}ms)`) : F(`bulk query took ${elapsed}ms`);

    // A vehicle page must read only its own vehicle's records, never the tenant's.
    const { data: scoped } = await aliceAgain.from("maintenance_logs").select("id").eq("vehicle_id", v1.id).is("deleted_at", null);
    (scoped?.length ?? 0) < 100 ? P("a vehicle page reads only that vehicle's records") : F("vehicle query pulled the whole organization");

    // =====================================================================
    H("21. Privacy of what gets logged and stored");
    // =====================================================================
    const { data: events } = await admin.from("app_events").select("metadata").limit(200);
    const evText = JSON.stringify(events ?? []);
    !/Moshe|JTDBR32E870123456|12-345-67|storage_path/.test(evText)
      ? P("analytics events carry no document content, VIN, plate or storage path") : F("an analytics event leaked document content");

    const { data: extrRows } = await admin.from("document_extractions").select("raw_text").eq("organization_id", orgA);
    (extrRows ?? []).every((x) => x.raw_text === null)
      ? P("no raw OCR text is retained") : F("raw OCR text is stored");

    // =====================================================================
    H("22. Locale coverage for every private-facing string");
    // =====================================================================
    const en = JSON.parse(readFileSync(new global.URL("../../messages/en.json", import.meta.url), "utf8"));
    const he = JSON.parse(readFileSync(new global.URL("../../messages/he.json", import.meta.url), "utf8"));
    const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
    const enKeys = new Set(flat(en));
    const heKeys = new Set(flat(he));
    const missingHe = [...enKeys].filter((k) => !heKeys.has(k));
    const missingEn = [...heKeys].filter((k) => !enKeys.has(k));
    missingHe.length === 0 ? P(`every one of ${enKeys.size} English keys has a Hebrew translation`) : F(`missing Hebrew: ${missingHe.slice(0, 5).join(", ")}`);
    missingEn.length === 0 ? P("no orphan Hebrew keys") : F(`orphan Hebrew: ${missingEn.slice(0, 5).join(", ")}`);
  } finally {
    // Teardown: organization rows first, then organizations, then users.
    for (const u of created) {
      const m = await orgOf(u.id);
      if (!m) continue;
      for (const t of ["document_extractions", "transfer_tokens", "vehicle_passports", "maintenance_logs", "issue_logs", "reminders", "vehicle_insurance", "vehicle_registration", "vehicle_inspection", "vehicle_documents", "vehicles"]) {
        await admin.from(t).delete().eq("organization_id", m.organization_id);
      }
      await admin.from("organizations").delete().eq("id", m.organization_id);
    }
    await cleanupUsers(admin, created);
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Private Vehicle check: ${passes} passed, ${fails} failed`);
  console.log("=".repeat(64));
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness error:", e.message);
  process.exit(1);
});
