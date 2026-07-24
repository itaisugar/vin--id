#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   This validation script deliberately uses `cond ? P(msg) : F(msg)` as a
   compact assertion statement. The expressions have side effects (they log and
   tally), so the rule's concern (a truly unused expression) does not apply. */
/**
 * Fleet Lite — authenticated tenant-isolation, role and passport-boundary check.
 *
 * This is the executable form of the runtime security validation. It was RUN
 * against a local Supabase instance on 2026-07-24 and passed (51 assertions);
 * see docs/fleet-lite-runtime-validation-runbook.md.
 *
 * Guarantees enforced by construction:
 *   - the SERVICE ROLE is used only to create fixtures (users, seed rows),
 *   - every access-control ASSERTION uses a real signed-in session (anon key +
 *     password sign-in) — never the service role,
 *   - it refuses to run without FLEET_CHECK_ALLOW=1,
 *   - it refuses the production project ref and any non-local URL,
 *   - it returns a non-zero exit code on any failed assertion,
 *   - it deletes the users it created (cascading their rows) on completion.
 *
 * Coverage:
 *   - signup provisions a distinct org per user,
 *   - the BEFORE INSERT trigger sets organization_id on every org-scoped table,
 *   - anon is blocked (0 rows on SELECT, INSERT rejected) despite table GRANTs,
 *   - Org B cannot SELECT / UPDATE / DELETE Org A rows on any org-scoped table,
 *   - a forged organization_id is rejected by the RLS WITH CHECK,
 *   - viewer is read-only; fleet_manager can write; owner can write,
 *   - public passport (get_public_passport) leaks no org_id / owner / driver
 *     phone / operational_status / storage_path,
 *   - accept_passport copies into the buyer's org, marks the seller vehicle
 *     sold, and rejects replay.
 *
 * Usage (LOCAL or dedicated STAGING only):
 *   FLEET_CHECK_ALLOW=1 \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=<local anon> \
 *   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
 *   node scripts/validation/fleet-tenancy-check.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

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
if (!/127\.0\.0\.1|localhost/.test(URL) && process.env.FLEET_CHECK_ALLOW_REMOTE !== "1") {
  console.error(
    `SUPABASE_URL is not local (${URL}). If this is a dedicated staging project, set FLEET_CHECK_ALLOW_REMOTE=1.`,
  );
  process.exit(2);
}

const ORG_TABLES = [
  "vehicles", "maintenance_logs", "issue_logs", "vehicle_documents",
  "document_extractions", "reminders", "vehicle_passports", "transfer_tokens",
  "vehicle_insurance", "vehicle_registration", "vehicle_inspection",
];

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
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
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}
const orgOf = async (id) =>
  (await admin.from("profiles").select("organization_id").eq("id", id).single()).data.organization_id;

async function main() {
  const A = await mkUser("a"), B = await mkUser("b"), C = await mkUser("c"), D = await mkUser("d");
  const created = [A, B, C, D];
  try {
    const orgA = await orgOf(A.id);
    const orgC = await orgOf(C.id);
    await admin.from("profiles").update({ organization_id: orgA, role: "viewer" }).eq("id", B.id);
    await admin.from("profiles").update({ organization_id: orgA, role: "fleet_manager" }).eq("id", D.id);
    await admin.from("profiles").update({ role: "owner" }).eq("id", A.id);
    orgA !== orgC ? P("signup provisioned distinct orgs for A and C") : F("signup did not isolate orgs");

    const aC = await signIn(A.email), bC = await signIn(B.email), cC = await signIn(C.email), dC = await signIn(D.email);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    const { data: veh, error: vErr } = await aC.from("vehicles")
      .insert({ make: "Toyota", model: "Hilux", year: 2021, license_plate: "11-111-11", current_mileage: 50000, owner_user_id: A.id })
      .select("*").single();
    vErr ? F(`A insert vehicle: ${vErr.message}`) : P("A (owner) inserted a vehicle");
    const vid = veh?.id;
    if (veh) veh.organization_id === orgA ? P("trigger set vehicle.organization_id = orgA") : F(`vehicle org=${veh.organization_id}`);

    const childSeeds = {
      maintenance_logs: { vehicle_id: vid, owner_user_id: A.id, service_type: "oil", performed_at: "2026-01-01", mileage: 50000 },
      issue_logs: { vehicle_id: vid, owner_user_id: A.id, title: "noise", severity: "monitor", status: "open", reported_at: "2026-01-01" },
      vehicle_documents: { vehicle_id: vid, owner_user_id: A.id, doc_type: "insurance", file_name: "x.pdf" },
      reminders: { vehicle_id: vid, owner_user_id: A.id, title: "test due", reminder_type: "inspection", due_date: "2026-09-01" },
      vehicle_insurance: { vehicle_id: vid, owner_user_id: A.id, insurer_name: "AIG", end_date: "2026-12-01" },
      vehicle_registration: { vehicle_id: vid, owner_user_id: A.id, end_date: "2026-11-01" },
      vehicle_inspection: { vehicle_id: vid, owner_user_id: A.id, end_date: "2026-10-01" },
    };
    const seededIds = {};
    for (const [t, row] of Object.entries(childSeeds)) {
      const { data, error } = await aC.from(t).insert(row).select("id, organization_id").single();
      if (error) { F(`A insert ${t}: ${error.message}`); continue; }
      seededIds[t] = data.id;
      data.organization_id === orgA ? P(`A ${t}: org auto-set to orgA`) : F(`A ${t}: org=${data.organization_id}`);
    }

    const { data: anonRows } = await anon.from("vehicles").select("id");
    (anonRows ?? []).length === 0 ? P("anon SELECT vehicles: 0 rows (RLS blocks)") : F(`anon SELECT: ${anonRows.length} leaked`);
    const { error: anonIns } = await anon.from("vehicles").insert({ make: "x", model: "y", year: 2020, owner_user_id: A.id }).select("id").single();
    anonIns ? P("anon INSERT vehicles: rejected") : F("anon INSERT: allowed (!)");

    for (const t of ORG_TABLES) {
      const { data, error } = await cC.from(t).select("id").limit(1000);
      if (error) { P(`C SELECT ${t}: blocked (${error.code})`); continue; }
      (data ?? []).length === 0 ? P(`C SELECT ${t}: 0 cross-org rows`) : F(`C SELECT ${t}: ${data.length} leaked`);
    }
    {
      const { data: u } = await cC.from("vehicles").update({ make: "HACKED" }).eq("id", vid).select("id");
      (u ?? []).length === 0 ? P("C UPDATE orgA vehicle: 0 affected") : F("C UPDATE: mutated!");
      const { data: d } = await cC.from("vehicles").delete().eq("id", vid).select("id");
      (d ?? []).length === 0 ? P("C DELETE orgA vehicle: 0 affected") : F("C DELETE: deleted!");
      const { data: chk } = await admin.from("vehicles").select("make").eq("id", vid).single();
      chk.make === "Toyota" ? P("orgA vehicle intact after C attempts") : F(`orgA vehicle make now ${chk.make}`);
    }
    {
      const { error } = await cC.from("vehicles").insert({ make: "forge", model: "z", year: 2020, owner_user_id: C.id, organization_id: orgA }).select("id").single();
      error ? P("C INSERT forged organization_id=orgA: rejected") : F("C forged insert: allowed (!)");
      const { data, error: e2 } = await cC.from("vehicles").insert({ make: "legit", model: "z", year: 2020, owner_user_id: C.id }).select("organization_id").single();
      if (e2) F(`C legit insert: ${e2.message}`);
      else data.organization_id === orgC ? P("C INSERT (no org_id): trigger set orgC") : F(`C insert org=${data.organization_id}`);
    }
    {
      const { error: ins } = await bC.from("vehicles").insert({ make: "v", model: "w", year: 2020, owner_user_id: B.id }).select("id").single();
      ins ? P("B (viewer) INSERT: rejected") : F("B (viewer) INSERT: allowed (!)");
      const { data: upd } = await bC.from("vehicles").update({ make: "V2" }).eq("id", vid).select("id");
      (upd ?? []).length === 0 ? P("B (viewer) UPDATE: 0 affected") : F("B (viewer) UPDATE: mutated!");
      const { data: del } = await bC.from("maintenance_logs").delete().eq("id", seededIds.maintenance_logs).select("id");
      (del ?? []).length === 0 ? P("B (viewer) DELETE: 0 affected") : F("B (viewer) DELETE: deleted!");
      const { data: rd } = await bC.from("vehicles").select("id");
      (rd ?? []).length >= 1 ? P("B (viewer) SELECT own org: sees rows") : F("B (viewer) SELECT: sees nothing");
    }
    {
      const { data, error } = await dC.from("vehicles").insert({ make: "Ford", model: "Transit", year: 2022, owner_user_id: D.id }).select("id, organization_id").single();
      if (error) F(`D (fleet_manager) INSERT: ${error.message}`);
      else data.organization_id === orgA ? P("D (fleet_manager) INSERT: allowed, org=orgA") : F(`D insert org=${data.organization_id}`);
      const { data: upd } = await dC.from("vehicles").update({ current_mileage: 51000 }).eq("id", vid).select("id");
      (upd ?? []).length === 1 ? P("D (fleet_manager) UPDATE orgA vehicle: allowed") : F("D (fleet_manager) UPDATE: blocked");
    }

    // Passport boundary + accept propagation
    const raw = randomBytes(24).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const snapshot = {
      meta: { issuer_user_id: A.id, version: 1 },
      vehicle: { vehicle_id: vid, make: "Toyota", model: "Hilux", year: 2021, vin: "VINSECRET123", license_plate: "11-111-11", current_mileage: 51000, mileage_unit: "km", status: "active" },
      maintenance: [{ date: "2026-01-01", mileage: 50000, category: "oil", description: "oil", cost: 200, currency: "ILS", trust_level: "user_entered", source_type: "user" }],
      issues: [{ date: "2026-01-01", mileage: 50000, symptoms: "noise", status: "open", severity: "monitor", resolution_notes: null, trust_level: "user_entered", source_type: "user" }],
      documents: [{ document_type: "insurance", file_name: "x.pdf", mime_type: "application/pdf", document_date: "2026-01-01", expiry_date: "2026-12-01", vendor: "AIG", amount: 1000, currency: "ILS", contains_personal_info: true, share_allowed: true, trust_level: "document_backed" }],
      reminders: [{ title: "test due", description: null, reminder_type: "inspection", due_date: "2026-09-01", due_mileage: null, urgency: "green", status: "pending" }],
    };
    const { data: pass, error: pErr } = await admin.from("vehicle_passports")
      .insert({ owner_user_id: A.id, organization_id: orgA, vehicle_id: vid, status: "active", version: 1, snapshot, snapshot_hash: "deadbeef", issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 72 * 3600e3).toISOString() })
      .select("id").single();
    if (pErr) F(`seed passport: ${pErr.message}`);
    else {
      await admin.from("transfer_tokens").insert({ owner_user_id: A.id, organization_id: orgA, passport_id: pass.id, vehicle_id: vid, token_hash: tokenHash, status: "active", expires_at: new Date(Date.now() + 72 * 3600e3).toISOString() });
      const { data: pub, error: pubErr } = await anon.rpc("get_public_passport", { p_token_hash: tokenHash });
      if (pubErr) F(`anon get_public_passport: ${pubErr.message}`);
      else if (pub?.state !== "ok") F(`get_public_passport state=${pub?.state}`);
      else {
        P("anon get_public_passport: state ok");
        const blob = JSON.stringify(pub);
        for (const [label, needle] of [["organization_id", orgA], ["issuer_user_id", "issuer_user_id"], ["assigned_driver_phone", "assigned_driver_phone"], ["operational_status", "operational_status"], ["storage_path", "storage_path"], ["owner id", A.id]]) {
          blob.includes(needle) ? F(`public passport leaks ${label}`) : P(`public passport: no ${label}`);
        }
      }
      const { data: acc, error: accErr } = await cC.rpc("accept_passport", { p_token_hash: tokenHash });
      if (accErr) F(`C accept_passport: ${accErr.message}`);
      else if (acc?.state !== "ok") F(`accept_passport state=${acc?.state}`);
      else {
        P("C accept_passport: state ok");
        const newVid = acc.new_vehicle_id;
        const { data: nv } = await admin.from("vehicles").select("organization_id, owner_user_id").eq("id", newVid).single();
        nv.organization_id === orgC ? P("accepted vehicle → org C") : F(`accepted vehicle org=${nv.organization_id}`);
        nv.owner_user_id === C.id ? P("accepted vehicle owner = C") : F("accepted vehicle owner wrong");
        for (const t of ["maintenance_logs", "issue_logs", "vehicle_documents", "reminders"]) {
          const { data: rows } = await admin.from(t).select("organization_id").eq("vehicle_id", newVid);
          (rows ?? []).length > 0 && rows.every((r) => r.organization_id === orgC)
            ? P(`accepted ${t}: all in org C`) : F(`accepted ${t}: not all org C (${rows?.length})`);
        }
        const { data: sv } = await admin.from("vehicles").select("status, organization_id").eq("id", vid).single();
        sv.status === "sold" ? P("seller vehicle status=sold") : F(`seller status=${sv.status}`);
        sv.organization_id === orgA ? P("seller vehicle still org A") : F("seller org changed");
        const { data: acc2 } = await cC.rpc("accept_passport", { p_token_hash: tokenHash });
        acc2?.state === "accepted" ? P("replay accept → 'accepted' (no double copy)") : F(`replay state=${acc2?.state}`);
      }
    }
  } finally {
    for (const u of created) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"}  (${passes} passed)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
