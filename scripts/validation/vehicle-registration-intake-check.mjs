#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Vehicle-registration AI intake — validation.
 *
 * OFFLINE: extraction parsing + PII stripping, the mock provider, and the
 * source-comparison/merge (all pure). DB (guarded): the atomic
 * confirm_vehicle_registration_intake RPC — creation, idempotency, duplicate
 * block, source metadata, document linkage, opt-in reminder, and authorization.
 *
 * No live AI provider is ever called (the mock is used). Guards for the DB
 * section: FLEET_CHECK_ALLOW=1, refuse prod ref / non-local.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import {
  parseVehicleRegistrationExtraction,
  stripProhibitedKeys,
} from "../../lib/vehicle-intake/extraction-types.ts";
import { compareVehicleSources, resolveConfirmedDataSource } from "../../lib/vehicle-intake/compare.ts";
import { MockVehicleExtractionProvider } from "../../lib/vehicle-intake/provider.ts";
import { addMembership, setActiveOrg, orgOf } from "./lib/org-fixtures.mjs";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);

const govDraft = (over = {}) => ({
  registration_number: "12345678", make: "Toyota", model: "Corolla", year: 2019,
  vin: "GOVVIN123", color: "White", fuel_type: "Petrol", test_expiry_date: "2027-03-01",
  display: { last_test_date: null, ownership_type: null }, ...over,
});

async function offline() {
  section("1. Extraction parsing + PII exclusion");
  {
    const ex = parseVehicleRegistrationExtraction({
      document_type: "vehicle_registration",
      document_type_confidence: 0.9,
      registration_number: { value: "12-345-67", confidence: 0.9 },
      make: { value: "טויוטה", confidence: 0.8 },
      year: { value: "2019", confidence: 0.7 },
      test_expiry_date: { value: "01/03/2027", confidence: 0.6 },
      // prohibited PII + unknown key:
      owner_name: "Jane Doe", id_number: "123456789", address: "1 Main St", surprise: "x",
    });
    ex.document_type === "vehicle_registration" ? P("recognized document type") : F("doc type");
    ex.make.value === "טויוטה" ? P("Hebrew make extracted") : F("make");
    ex.year.value === 2019 ? P("year coerced from string") : F("year");
    ex.test_expiry_date.value === "2027-03-01" ? P("dd/mm/yyyy expiry normalized to ISO") : F(`expiry ${ex.test_expiry_date.value}`);
    ex.pii_stripped === true ? P("PII detected + stripped flag set") : F("pii flag");
    ex.warnings.includes("prohibited_fields_removed") ? P("PII-removal warning emitted") : F("pii warning");
    !("owner_name" in ex) && !("id_number" in ex) && !("address" in ex) ? P("no PII keys on the result") : F("PII leaked");
  }
  {
    const { cleaned, removed } = stripProhibitedKeys({ make: "X", owner: "Y", phone: "1", nested: { address: "z", model: "m" } });
    removed === true && !("owner" in cleaned) && !("phone" in cleaned) && !("address" in cleaned.nested)
      ? P("stripProhibitedKeys removes PII at top and nested levels") : F("strip nested");
    cleaned.make === "X" && cleaned.nested.model === "m" ? P("non-PII fields preserved") : F("strip preserve");
  }
  {
    const ex = parseVehicleRegistrationExtraction({ document_type: "other", document_type_confidence: 0.95 });
    ex.document_type === "other" ? P("wrong document type recognized") : F("other type");
  }
  {
    const ex = parseVehicleRegistrationExtraction({ year: { value: 1700 }, test_expiry_date: { value: "2027-03" } });
    ex.year.value === null ? P("out-of-range year -> null") : F("year range");
    ex.test_expiry_date.value === null ? P("month-only date -> null (no fabricated day)") : F(`month-only ${ex.test_expiry_date.value}`);
  }

  section("2. Mock provider");
  {
    const p = new MockVehicleExtractionProvider();
    const ex = await p.extract();
    ex.document_type === "vehicle_registration" && ex.make.value && ex.registration_number.value
      ? P("mock provider returns a recognized registration extraction") : F("mock provider");
  }

  section("3. Source comparison + merge");
  {
    const ex = parseVehicleRegistrationExtraction({
      document_type: "vehicle_registration",
      registration_number: { value: "12345678" }, make: { value: "Toyota" }, model: { value: "Corolla" },
      year: { value: 2019 }, vin: { value: "GOVVIN123" }, color: { value: "Pearl white" },
      fuel_type: { value: "Petrol" }, test_expiry_date: { value: "2027-03-01" },
    });
    const cmp = compareVehicleSources(ex, govDraft());
    cmp.fields.make.status === "match" ? P("identical make -> match") : F(`make ${cmp.fields.make.status}`);
    cmp.fields.color.status === "conflict" ? P("different color -> conflict") : F("color conflict");
    cmp.fields.color.proposed === "White" ? P("conflict defaults to government value") : F("conflict default");
    !cmp.registrationConflict ? P("matching registration -> no block") : F("reg block false-positive");
  }
  {
    const ex = parseVehicleRegistrationExtraction({ document_type: "vehicle_registration", registration_number: { value: "99999999" }, vin: { value: "DOCVINX" } });
    const cmp = compareVehicleSources(ex, govDraft());
    cmp.registrationConflict === true ? P("registration mismatch -> blocking conflict") : F("reg conflict");
    cmp.vinConflict === true ? P("VIN mismatch -> vin conflict flag") : F("vin conflict");
  }
  {
    const ex = parseVehicleRegistrationExtraction({ document_type: "vehicle_registration", make: { value: "Kia" } });
    const cmp = compareVehicleSources(ex, null); // no government
    cmp.fields.make.status === "document_only" && cmp.fields.make.proposed === "Kia" ? P("document-only field proposed from document") : F("document_only");
    cmp.fields.model.status === "missing" ? P("absent-in-both field -> missing") : F("missing");
  }
  {
    const cmp = compareVehicleSources(parseVehicleRegistrationExtraction({ document_type: "vehicle_registration" }), govDraft());
    cmp.fields.make.status === "government_only" ? P("government-only field recognized") : F("government_only");
  }
  resolveConfirmedDataSource(true) === "mixed_confirmed" ? P("data_source = mixed_confirmed when government used") : F("ds mixed");
  resolveConfirmedDataSource(false) === "vehicle_registration_ai" ? P("data_source = vehicle_registration_ai when document only") : F("ds ai");
}

async function db() {
  const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.FLEET_CHECK_ALLOW !== "1" || !URL || !ANON || !SERVICE) {
    console.log("\n— 4. DB RPC — SKIP (set FLEET_CHECK_ALLOW=1 + SUPABASE_URL/ANON/SERVICE)"); return;
  }
  if (URL.includes("jsthfmgvcdrfzpgkpwvt")) { console.error("Production ref. Aborting DB section."); fails++; return; }

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const PW = "Test-Passw0rd!";
  const RUN = randomBytes(3).toString("hex");
  const mk = async (tag) => {
    const email = `vri-${tag}-${RUN}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(error.message);
    return { id: data.user.id, email };
  };
  const signIn = async (email) => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: PW });
    if (error) throw new Error(error.message);
    return c;
  };
  const stageIntake = async (userId, orgId) => {
    const { data, error } = await admin.from("document_extractions").insert({
      owner_user_id: userId, organization_id: orgId, status: "pending_confirmation",
      source: "vehicle_registration", engine: "mock", provider_model: "mock",
      extracted_data: {}, content_hash: "hash" + RUN,
      pending_storage_path: `${userId}/${RUN}.jpg`, pending_file_name: "reg.jpg",
      pending_mime_type: "image/jpeg", pending_file_size: 1234,
    }).select("id").single();
    if (error) throw new Error("stage: " + error.message);
    return data.id;
  };
  const vehiclePayload = { make: "Toyota", model: "Corolla", year: "2019", license_plate: "12345678", color: "White", fuel_type: "Petrol", test_expiry_date: "2027-03-01" };

  const users = [];
  try {
    section("4. DB RPC: confirm_vehicle_registration_intake");
    const owner = await mk("owner"); users.push(owner);
    const orgId = await orgOf(admin, owner.id);
    const ownerC = await signIn(owner.email);

    // (a) create a vehicle
    const exId = await stageIntake(owner.id, orgId);
    const r1 = (await ownerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exId, p_vehicle: vehiclePayload, p_data_source: "vehicle_registration_ai",
      p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    r1?.state === "ok" && r1.vehicle_id ? P("creates a vehicle (state ok)") : F(`create ${r1?.state}`);
    const { data: veh } = await admin.from("vehicles").select("make, data_source, test_expiry_date, organization_id").eq("id", r1.vehicle_id).single();
    veh?.make === "Toyota" && veh.data_source === "vehicle_registration_ai" ? P("vehicle has make + data_source") : F("vehicle fields");
    veh?.organization_id === orgId ? P("vehicle created in the caller's organization") : F("org scope");
    // document created + linked
    const { data: doc } = await admin.from("vehicle_documents").select("id, doc_type, vehicle_id").eq("id", r1.document_id).single();
    doc?.doc_type === "registration" && doc.vehicle_id === r1.vehicle_id ? P("registration document created + linked to vehicle") : F("document link");
    // extraction finalized
    const { data: ex } = await admin.from("document_extractions").select("status, created_record_type, created_record_id").eq("id", exId).single();
    ex?.status === "confirmed" && ex.created_record_type === "vehicle" && ex.created_record_id === r1.vehicle_id ? P("intake finalized -> confirmed/vehicle") : F("finalize");

    // (b) idempotent: second confirm returns the same vehicle, no duplicate
    const r2 = (await ownerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exId, p_vehicle: vehiclePayload, p_data_source: "vehicle_registration_ai", p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    r2?.state === "already_confirmed" && r2.vehicle_id === r1.vehicle_id ? P("re-confirm is idempotent (same vehicle)") : F(`idempotent ${r2?.state}`);
    const { count: vehCount } = await admin.from("vehicles").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("license_plate", "12345678");
    (vehCount ?? 0) === 1 ? P("no duplicate vehicle from re-confirm") : F(`vehicle count ${vehCount}`);

    // (c) duplicate: a NEW intake with the same plate is blocked
    const exDup = await stageIntake(owner.id, orgId);
    const rDup = (await ownerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exDup, p_vehicle: vehiclePayload, p_data_source: "vehicle_registration_ai", p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    rDup?.state === "duplicate" && rDup.existing_vehicle_id === r1.vehicle_id ? P("duplicate plate blocked, returns existing vehicle") : F(`duplicate ${rDup?.state}`);

    // (d) opt-in reminder creates exactly one reminder; government metadata stored
    const owner2 = await mk("owner2"); users.push(owner2);
    const org2 = await orgOf(admin, owner2.id);
    const owner2C = await signIn(owner2.email);
    const ex2 = await stageIntake(owner2.id, org2);
    const r3 = (await owner2C.rpc("confirm_vehicle_registration_intake", {
      p_extraction: ex2, p_vehicle: { ...vehiclePayload, license_plate: "87654321" },
      p_data_source: "mixed_confirmed",
      p_government: { fetched_at: new Date().toISOString(), resource_id: "res-123" },
      p_create_reminder: true, p_reminder_lead_days: 30,
    })).data;
    r3?.state === "ok" ? P("second org create ok") : F("create2");
    const { data: v2 } = await admin.from("vehicles").select("data_source, government_resource_id").eq("id", r3.vehicle_id).single();
    v2?.data_source === "mixed_confirmed" && v2.government_resource_id === "res-123" ? P("mixed_confirmed + government metadata stored") : F("gov meta");
    const { count: remCount } = await admin.from("reminders").select("id", { count: "exact", head: true }).eq("vehicle_id", r3.vehicle_id);
    (remCount ?? 0) === 1 ? P("opt-in reminder created exactly once") : F(`reminder count ${remCount}`);

    // (e) no reminder without opt-in (owner's first vehicle had create_reminder=false)
    const { count: rem0 } = await admin.from("reminders").select("id", { count: "exact", head: true }).eq("vehicle_id", r1.vehicle_id);
    (rem0 ?? 0) === 0 ? P("no reminder created without opt-in") : F("silent reminder");

    // (f) authorization: a viewer in a business org cannot confirm
    const viewer = await mk("viewer"); users.push(viewer);
    const boss = await mk("boss"); users.push(boss);
    const bizOrg = await orgOf(admin, boss.id);
    await admin.from("organizations").update({ kind: "business" }).eq("id", bizOrg);
    await addMembership(admin, viewer.id, bizOrg, "viewer");
    await setActiveOrg(admin, viewer.id, bizOrg);
    const exViewer = await stageIntake(boss.id, bizOrg);
    const viewerC = await signIn(viewer.email);
    const rv = (await viewerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exViewer, p_vehicle: vehiclePayload, p_data_source: "vehicle_registration_ai", p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    rv?.state === "not_authorized" ? P("viewer cannot confirm (not_authorized)") : F(`viewer ${rv?.state}`);

    // (g) invalid payload (missing make) rejected
    const exBad = await stageIntake(owner.id, orgId);
    const rb = (await ownerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exBad, p_vehicle: { model: "X", year: "2019" }, p_data_source: "vehicle_registration_ai", p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    rb?.state === "invalid_payload" ? P("missing make -> invalid_payload") : F(`invalid ${rb?.state}`);

    // (h) invalid data_source rejected
    const exBad2 = await stageIntake(owner.id, orgId);
    const rb2 = (await ownerC.rpc("confirm_vehicle_registration_intake", {
      p_extraction: exBad2, p_vehicle: { ...vehiclePayload, license_plate: "55555555" }, p_data_source: "totally_bogus", p_government: null, p_create_reminder: false, p_reminder_lead_days: 30,
    })).data;
    rb2?.state === "invalid_source" ? P("bogus data_source -> invalid_source") : F(`invalid_source ${rb2?.state}`);
  } finally {
    // teardown: orgs (cascade docs/extractions/reminders/vehicles) then users
    const ids = users.map((u) => u.id);
    const { data: mem } = await admin.from("organization_members").select("organization_id").in("user_id", ids);
    for (const orgId of [...new Set((mem ?? []).map((m) => m.organization_id))]) {
      await admin.from("vehicles").delete().eq("organization_id", orgId);
      await admin.from("document_extractions").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
    }
    for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function main() {
  await offline();
  await db();
  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
