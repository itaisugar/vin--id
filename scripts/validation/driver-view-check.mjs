#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   This validation script deliberately uses `cond ? P(msg) : F(msg)` as a
   compact assertion statement. The expressions have side effects (they log and
   tally), so the rule's concern (a truly unused expression) does not apply. */
/**
 * Fleet Lite — driver role, assignment and Driver View security check.
 *
 * WHY THIS EXISTS. The Fleet conversion generated one identical policy for every
 * org-scoped table — `organization_id = current_org_id()`, with no role
 * condition. That is correct for owner/admin/fleet_manager/viewer and
 * catastrophic for `driver`. A first pass at the driver migrations made five
 * tables driver-aware and left SIX on the bare organization-wide rule
 * (vehicle_insurance, vehicle_inspection, vehicle_registration,
 * document_extractions, vehicle_passports, transfer_tokens). Nothing caught it,
 * because no test enumerated the full table list.
 *
 * So the DRIVER RLS COVERAGE section below does not test a hand-picked sample.
 * It enumerates every org-scoped table from a declared matrix, asserts that the
 * matrix matches the tables that actually exist in the database, and then proves
 * the expected driver access for each one with a real signed-in driver session.
 * Adding an org-scoped table without deciding its driver rule fails the run.
 *
 * Guarantees enforced by construction:
 *   - the SERVICE ROLE is used only to create fixtures (users, seed rows),
 *   - every access-control ASSERTION uses a real signed-in session (anon key +
 *     password sign-in) — never the service role,
 *   - it refuses to run without FLEET_CHECK_ALLOW=1,
 *   - it refuses the production project ref and any non-local URL,
 *   - it returns a non-zero exit code on any failed assertion,
 *   - no secret, JWT or raw invitation token is ever logged,
 *   - it deletes the users it created (cascading their rows) on completion.
 *
 * Usage (LOCAL only):
 *   FLEET_CHECK_ALLOW=1 \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=<local anon> \
 *   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
 *   npm run validate:driver-view
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cleanupUsers, joinOrg, orgOf, setProfileCache, setRole } from "./lib/org-fixtures.mjs";

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

/**
 * THE DRIVER RLS COVERAGE MATRIX.
 *
 * `expect` is what a signed-in Org A driver assigned to Vehicle A must see:
 *   none        — zero rows, even for their own vehicle
 *   assigned    — only rows belonging to their assigned vehicle
 *   shared      — only rows for their vehicle that a manager explicitly shared
 *   self        — only their own row
 *
 * Every entry names the sensitive columns that motivated the decision, so the
 * reason a table is denied is reviewable next to the assertion that proves it.
 */
const DRIVER_MATRIX = [
  { table: "vehicles", expect: "assigned", sensitive: "—", note: "the one table a driver reads directly" },
  { table: "reminders", expect: "shared", sensitive: "description", note: "driver_visible is per-row manager consent" },
  { table: "organization_members", expect: "self", sensitive: "roster, roles", note: "own membership row only" },
  { table: "maintenance_logs", expect: "none", sensitive: "cost, currency, vendor_name, description", note: "safe fields via get_driver_maintenance_history()" },
  { table: "issue_logs", expect: "none", sensitive: "internal diagnosis notes", note: "driver issue reporting out of scope" },
  { table: "vehicle_documents", expect: "none", sensitive: "storage_path, amount, currency, vendor", note: "LEAK 7 — safe fields via get_driver_documents()" },
  { table: "vehicle_insurance", expect: "none", sensitive: "insurer_name, cost", note: "LEAK 1" },
  { table: "vehicle_inspection", expect: "none", sensitive: "cost, notes", note: "LEAK 2" },
  { table: "vehicle_registration", expect: "none", sensitive: "notes", note: "LEAK 3" },
  { table: "document_extractions", expect: "none", sensitive: "raw_text, extracted_data", note: "LEAK 4" },
  { table: "vehicle_passports", expect: "none", sensitive: "snapshot, snapshot_hash, server_signature", note: "LEAK 5 — snapshot re-exposes maintenance costs" },
  { table: "transfer_tokens", expect: "none", sensitive: "token_hash", note: "LEAK 6" },
  { table: "driver_assignments", expect: "none", sensitive: "note (a manager's remark about the driver)", note: "LEAK 8 — vehicle via get_my_driver_vehicle()" },
  { table: "organizations", expect: "none", sensitive: "subscription_status, plan, phone, email", note: "name via get_my_driver_vehicle()" },
  { table: "organization_invitations", expect: "none", sensitive: "token_hash", note: "admin-only" },
  { table: "profiles", expect: "self", sensitive: "other users' profiles", note: "own profile row only" },
];

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
/**
 * Every table exposed by PostgREST that carries an `organization_id` column,
 * read from the live OpenAPI schema rather than a hand-maintained list.
 */
async function orgScopedTables() {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) return [];
  const spec = await res.json();
  return Object.entries(spec.definitions ?? {})
    .filter(([, def]) => Object.prototype.hasOwnProperty.call(def.properties ?? {}, "organization_id"))
    .map(([name]) => name)
    .sort();
}

/** Row count a client can actually see. Errors count as zero rows AND are surfaced. */
async function visible(client, table, filter = {}) {
  let q = client.from(table).select("*");
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  return { n: data?.length ?? 0, rows: data ?? [], error: error?.message ?? null };
}

async function main() {
  const owner = await mkUser("owner");
  const adminUser = await mkUser("admin");
  const manager = await mkUser("mgr");
  const viewer = await mkUser("viewer");
  const driverA = await mkUser("drvA");
  const driverB = await mkUser("drvB");
  const driverIdle = await mkUser("drvIdle");
  const driverGone = await mkUser("drvGone");
  const orgBOwner = await mkUser("orgBOwner");
  const outsider = await mkUser("orgB");
  const created = [owner, adminUser, manager, viewer, driverA, driverB, driverIdle, driverGone, orgBOwner, outsider];

  try {
    // ---------------------------------------------------------------------
    // Fixtures (service role only)
    // ---------------------------------------------------------------------
    const orgA = await orgOf(admin, owner.id);
    // Org B needs its OWN owner before the outsider can become a driver there:
    // the last-owner trigger refuses to demote an organization's only owner.
    const orgB = await orgOf(admin, orgBOwner.id);
    await setRole(admin, owner.id, "owner");
    await joinOrg(admin, adminUser.id, orgA, "admin");
    await joinOrg(admin, manager.id, orgA, "fleet_manager");
    await joinOrg(admin, viewer.id, orgA, "viewer");
    await joinOrg(admin, driverA.id, orgA, "driver");
    await joinOrg(admin, driverB.id, orgA, "driver");
    await joinOrg(admin, driverIdle.id, orgA, "driver");
    await joinOrg(admin, driverGone.id, orgA, "driver");
    await joinOrg(admin, outsider.id, orgB, "driver");

    const mkVehicle = async (org, ownerId, plate) => {
      const { data, error } = await admin.from("vehicles")
        .insert({ owner_user_id: ownerId, organization_id: org, make: "Test", model: plate, license_plate: plate, current_mileage: 1000 })
        .select("id").single();
      if (error) throw new Error(`seed vehicle ${plate}: ${error.message}`);
      return data.id;
    };
    const vehA = await mkVehicle(orgA, owner.id, "AAA-111");
    const vehB = await mkVehicle(orgA, owner.id, "BBB-222");
    const vehGone = await mkVehicle(orgA, owner.id, "GON-999");
    const vehOther = await mkVehicle(orgB, orgBOwner.id, "ZZZ-000");

    // Related rows on BOTH vehicles, so "driver sees nothing" is distinguishable
    // from "there was nothing to see".
    // Seed failures must be LOUD: a silently-empty fixture turns every "driver
    // sees 0 rows" assertion into a vacuous pass.
    const ins = async (table, payload, cols = "id") => {
      const { data, error } = await admin.from(table).insert(payload).select(cols);
      if (error) throw new Error(`seed ${table}: ${error.message}`);
      return data ?? [];
    };
    const seed = async (vehicleId, org, ownerId) => {
      const base = { owner_user_id: ownerId, organization_id: org, vehicle_id: vehicleId };
      await ins("maintenance_logs", { ...base, service_type: "oil", performed_at: "2026-01-05", mileage: 900, cost: 750.5, currency: "ILS", vendor_name: "Secret Garage", description: "internal note" });
      await ins("issue_logs", { ...base, title: "rattle", description: "internal diagnosis" });
      await ins("vehicle_insurance", { ...base, insurer_name: "SecretInsurer", cost: 4200, start_date: "2026-01-01", end_date: "2026-12-31" });
      await ins("vehicle_registration", { ...base, notes: "internal registration note", start_date: "2026-01-01", end_date: "2026-12-31" });
      await ins("vehicle_inspection", { ...base, cost: 310, notes: "internal inspection note", start_date: "2026-01-01", end_date: "2026-12-31" });
      const passRows = await ins("vehicle_passports", { ...base, public_id: randomUUID(), snapshot: { secret: "full history with costs" }, snapshot_hash: createHash("sha256").update(vehicleId).digest("hex") });
      // A real token: the raw value is generated, hashed, and only the HASH is
      // stored — mirroring production. The raw token is never logged.
      const rawToken = randomBytes(24).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await ins("transfer_tokens", { owner_user_id: ownerId, organization_id: org, vehicle_id: vehicleId, passport_id: passRows[0].id, token_hash: tokenHash });
      // One shared and one private reminder / document per vehicle.
      await ins("reminders", [
        { ...base, title: "shared reminder", description: "visible", driver_visible: true, due_date: "2026-09-01" },
        { ...base, title: "private reminder", description: "internal admin note", driver_visible: false, due_date: "2026-09-02" },
      ]);
      const docRows = await ins("vehicle_documents", [
        { ...base, doc_type: "registration", title: "shared doc", file_name: "reg.pdf", storage_path: `${ownerId}/${randomBytes(6).toString("hex")}.pdf`, driver_visible: true, amount: 1200, currency: "ILS", vendor: "SecretVendor" },
        { ...base, doc_type: "invoice", title: "private invoice", file_name: "inv.pdf", storage_path: `${ownerId}/${randomBytes(6).toString("hex")}.pdf`, driver_visible: false, amount: 9900, currency: "ILS", vendor: "SecretVendor" },
      ], "id, driver_visible");
      const sharedDoc = docRows.find((d) => d.driver_visible);
      const privateDoc = docRows.find((d) => !d.driver_visible);
      await ins("document_extractions", { owner_user_id: ownerId, organization_id: org, document_id: sharedDoc.id, vehicle_id: vehicleId, status: "pending_confirmation", raw_text: "INVOICE TOTAL 9900 ILS", extracted_data: { total: 9900 } });
      return { sharedDoc: sharedDoc.id, privateDoc: privateDoc.id, tokenHash };
    };
    const docsA = await seed(vehA, orgA, owner.id);
    const docsB = await seed(vehB, orgA, owner.id);
    await seed(vehGone, orgA, owner.id);
    await seed(vehOther, orgB, orgBOwner.id);

    // Sessions — real JWTs, never the service role.
    const ownerC = await signIn(owner.email);
    const adminC = await signIn(adminUser.email);
    const mgrC = await signIn(manager.email);
    const viewerC = await signIn(viewer.email);
    const drvAC = await signIn(driverA.email);
    const drvBC = await signIn(driverB.email);
    const idleC = await signIn(driverIdle.email);
    const goneC = await signIn(driverGone.email);
    const otherC = await signIn(outsider.email);
    const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

    // ---------------------------------------------------------------------
    H("Assignment lifecycle (manager RPCs)");
    // ---------------------------------------------------------------------
    const memberOf = async (userId) => {
      const { data } = await admin.from("organization_members").select("id").eq("user_id", userId).maybeSingle();
      return data?.id ?? null;
    };
    const mA = await memberOf(driverA.id), mB = await memberOf(driverB.id), mGone = await memberOf(driverGone.id);
    const mViewer = await memberOf(viewer.id);

    let r = await mgrC.rpc("assign_driver", { p_vehicle: vehA, p_member: mA });
    r.data?.state === "ok" ? P("fleet_manager assigns Driver A to Vehicle A") : F(`assign_driver A: ${JSON.stringify(r.data ?? r.error?.message)}`);
    r = await mgrC.rpc("assign_driver", { p_vehicle: vehB, p_member: mB });
    r.data?.state === "ok" ? P("fleet_manager assigns Driver B to Vehicle B") : F(`assign_driver B: ${JSON.stringify(r.data ?? r.error?.message)}`);
    r = await mgrC.rpc("assign_driver", { p_vehicle: vehGone, p_member: mGone });
    r.data?.state === "ok" ? P("fleet_manager assigns the soon-to-be-removed driver") : F("assign_driver gone");

    r = await mgrC.rpc("assign_driver", { p_vehicle: vehA, p_member: mViewer });
    r.data?.state === "not_a_driver" ? P("a viewer cannot be assigned a vehicle") : F(`viewer assignment not rejected: ${JSON.stringify(r.data)}`);
    r = await mgrC.rpc("assign_driver", { p_vehicle: vehOther, p_member: mA });
    r.data?.state === "vehicle_not_found" ? P("assigning a vehicle from another organization is rejected") : F(`cross-org assign: ${JSON.stringify(r.data)}`);
    r = await drvAC.rpc("assign_driver", { p_vehicle: vehB, p_member: mA });
    r.data?.state === "not_authorized" ? P("a driver cannot assign themselves a different vehicle") : F(`driver self-assign: ${JSON.stringify(r.data)}`);
    r = await viewerC.rpc("unassign_driver", { p_vehicle: vehA });
    r.data?.state === "not_authorized" ? P("a viewer cannot unassign a driver") : F(`viewer unassign: ${JSON.stringify(r.data)}`);
    r = await anonC.rpc("assign_driver", { p_vehicle: vehA, p_member: mA });
    r.error ? P("anonymous cannot call assign_driver") : F("anonymous reached assign_driver");

    // The removed driver: membership deleted, assignment row deliberately LEFT
    // ACTIVE so the stale-assignment path is what gets tested.
    await admin.from("organization_members").delete().eq("user_id", driverGone.id);
    await setProfileCache(admin, driverGone.id, { organizationId: orgA, role: "driver" });
    const { data: staleRows } = await admin.from("driver_assignments").select("id").eq("driver_user_id", driverGone.id).is("unassigned_at", null);
    (staleRows?.length ?? 0) > 0 ? P("stale ACTIVE assignment retained after membership removal (the case under test)") : F("stale assignment was cleaned up; the removed-driver test would be vacuous");

    // ---------------------------------------------------------------------
    H("Driver RLS Coverage");
    // ---------------------------------------------------------------------
    // The matrix must describe every org-scoped table that actually exists.
    // The list is DERIVED FROM THE LIVE SCHEMA, not hand-written: PostgREST's
    // OpenAPI document at /rest/v1/ enumerates every exposed table with its
    // columns, so a new table carrying organization_id shows up here the moment
    // it is created. This is the check that would have caught the original six.
    const actual = await orgScopedTables();
    const declared = new Set(DRIVER_MATRIX.map((m) => m.table));
    const undeclared = actual.filter((t) => !declared.has(t));
    actual.length > 0
      ? P(`derived ${actual.length} org-scoped tables from the live schema`)
      : F("could not derive the org-scoped table list — coverage is unverified");
    undeclared.length === 0
      ? P("every org-scoped table has a declared driver rule in the coverage matrix")
      : F(`org-scoped tables with NO declared driver rule: ${undeclared.join(", ")}`);

    for (const m of DRIVER_MATRIX) {
      const seen = await visible(drvAC, m.table);
      const label = `${m.table.padEnd(26)} expect=${m.expect.padEnd(9)}`;
      if (m.expect === "none") {
        seen.n === 0 ? P(`${label} driver sees 0 rows   [${m.note}]`) : F(`${label} driver sees ${seen.n} rows — LEAK (${m.sensitive})`);
      } else if (m.expect === "assigned") {
        const only = seen.n === 1 && seen.rows[0].id === vehA;
        only ? P(`${label} driver sees only Vehicle A`) : F(`${label} driver sees ${seen.n} rows (expected exactly Vehicle A)`);
      } else if (m.expect === "shared") {
        const ok = seen.rows.every((row) => row.vehicle_id === vehA && row.driver_visible === true);
        ok && seen.n === 1 ? P(`${label} driver sees only the shared row for Vehicle A`) : F(`${label} driver sees ${seen.n} rows, cross-vehicle or unshared`);
      } else if (m.expect === "self") {
        const ok = seen.rows.every((row) => (row.user_id ?? row.id) === driverA.id);
        ok ? P(`${label} driver sees only their own row`) : F(`${label} driver sees ${seen.n} rows including others'`);
      }
    }

    // ---------------------------------------------------------------------
    H("Explicit leak tests — Driver A");
    // ---------------------------------------------------------------------
    let g = await drvAC.from("vehicles").select("*").eq("id", vehB);
    (g.data?.length ?? 0) === 0 ? P("guessed Vehicle B id returns nothing") : F("Driver A read Vehicle B by id");
    g = await drvAC.from("vehicles").select("*").eq("id", vehOther);
    (g.data?.length ?? 0) === 0 ? P("guessed Org B vehicle id returns nothing") : F("Driver A read an Org B vehicle");
    g = await drvAC.from("maintenance_logs").select("cost, currency, vendor_name");
    (g.data?.length ?? 0) === 0 ? P("selecting cost/currency/vendor_name directly returns nothing") : F("Driver A read maintenance cost columns");
    g = await drvAC.from("vehicle_documents").select("storage_path");
    (g.data?.length ?? 0) === 0 ? P("selecting storage_path directly returns nothing") : F("Driver A read raw Storage paths");
    g = await drvAC.from("vehicle_documents").select("*").eq("id", docsA.sharedDoc);
    (g.data?.length ?? 0) === 0 ? P("even the SHARED document row is not directly selectable") : F("Driver A read the shared document row (storage_path/amount exposed)");
    g = await drvAC.from("vehicle_documents").select("*").eq("id", docsB.privateDoc);
    (g.data?.length ?? 0) === 0 ? P("guessed Vehicle B private document id returns nothing") : F("Driver A read a Vehicle B document");
    g = await drvAC.from("transfer_tokens").select("token_hash");
    (g.data?.length ?? 0) === 0 ? P("token_hash is unreachable") : F("Driver A read passport transfer token hashes");
    g = await drvAC.from("vehicle_passports").select("snapshot");
    (g.data?.length ?? 0) === 0 ? P("passport snapshot (which carries costs) is unreachable") : F("Driver A read passport snapshots");
    g = await drvAC.from("vehicles").select("*").eq("organization_id", orgA);
    (g.data?.length ?? 0) <= 1 ? P("a forged organization_id filter does not widen the result") : F("Driver A enumerated the fleet via organization_id");

    // Writes
    const w1 = await drvAC.from("vehicles").update({ current_mileage: 5 }).eq("id", vehA).select("id");
    (w1.data?.length ?? 0) === 0 ? P("driver cannot UPDATE their own vehicle") : F("Driver A updated a vehicle");
    const w2 = await drvAC.from("vehicles").insert({ owner_user_id: driverA.id, organization_id: orgA, make: "X", model: "Y" }).select("id");
    w2.error ? P("driver cannot INSERT a vehicle") : F("Driver A inserted a vehicle");
    const w3 = await drvAC.from("issue_logs").insert({ owner_user_id: driverA.id, organization_id: orgA, vehicle_id: vehA, title: "hi" }).select("id");
    w3.error ? P("driver cannot report an issue (out of scope this phase)") : F("Driver A created an issue");
    const w4 = await drvAC.from("maintenance_logs").delete().eq("vehicle_id", vehA).select("id");
    (w4.data?.length ?? 0) === 0 ? P("driver cannot DELETE maintenance rows") : F("Driver A deleted maintenance rows");
    const w5 = await drvAC.from("driver_assignments").update({ vehicle_id: vehB }).eq("driver_user_id", driverA.id).select("id");
    (w5.data?.length ?? 0) === 0 ? P("driver cannot re-point their own assignment at Vehicle B") : F("Driver A reassigned themselves");

    // ---------------------------------------------------------------------
    H("Driver-safe RPCs");
    // ---------------------------------------------------------------------
    const mine = await drvAC.rpc("get_my_driver_vehicle");
    const mv = mine.data?.[0];
    mv?.vehicle_id === vehA ? P("get_my_driver_vehicle returns Vehicle A") : F(`get_my_driver_vehicle: ${JSON.stringify(mine.data ?? mine.error?.message)}`);
    mv && !("cost" in mv) && !("owner_user_id" in mv) && !("organization_id" in mv)
      ? P("get_my_driver_vehicle exposes no cost / owner / organization columns") : F("driver vehicle projection leaked a forbidden column");
    mv?.organization_name ? P("organization NAME is available without reading the organizations row") : F("organization name missing from driver projection");

    const hist = await drvAC.rpc("get_driver_maintenance_history");
    const hrow = hist.data?.[0];
    (hist.data?.length ?? 0) > 0 ? P("get_driver_maintenance_history returns the vehicle's service history") : F("driver maintenance history empty");
    hrow && !("cost" in hrow) && !("vendor_name" in hrow) && !("description" in hrow)
      ? P("maintenance projection omits cost, vendor_name and description") : F("maintenance projection leaked a commercial column");

    const ddocs = await drvAC.rpc("get_driver_documents");
    const drow = ddocs.data?.[0];
    (ddocs.data?.length ?? 0) === 1 ? P("get_driver_documents returns only the shared document") : F(`driver documents returned ${ddocs.data?.length ?? 0} rows`);
    drow && !("storage_path" in drow) && !("amount" in drow) && !("currency" in drow) && !("vendor" in drow)
      ? P("document projection omits storage_path, amount, currency and vendor") : F("document projection leaked a forbidden column");

    const rem = await drvAC.rpc("get_driver_reminders");
    (rem.data?.length ?? 0) === 1 ? P("get_driver_reminders returns only the shared reminder") : F(`driver reminders returned ${rem.data?.length ?? 0} rows`);

    const pathOk = await drvAC.rpc("get_driver_document_path", { p_document: docsA.sharedDoc });
    pathOk.data ? P("signed-URL resolver returns a path for the shared document") : F("signed-URL resolver denied the shared document");
    const pathBad = await drvAC.rpc("get_driver_document_path", { p_document: docsB.privateDoc });
    !pathBad.data ? P("signed-URL resolver returns NULL for a Vehicle B document") : F("signed-URL resolver leaked a path for another vehicle");
    const pathPriv = await drvAC.rpc("get_driver_document_path", { p_document: docsA.privateDoc });
    !pathPriv.data ? P("signed-URL resolver returns NULL for an unshared document on the OWN vehicle") : F("signed-URL resolver leaked an unshared invoice");

    const agg = await drvAC.rpc("list_eligible_drivers");
    (agg.data?.length ?? 0) === 0 ? P("driver calling list_eligible_drivers gets nothing") : F("driver enumerated the driver roster");
    const histRpc = await drvAC.rpc("get_vehicle_assignment_history", { p_vehicle: vehA });
    (histRpc.data?.length ?? 0) === 0 ? P("driver calling get_vehicle_assignment_history gets nothing") : F("driver read assignment history");

    // ---------------------------------------------------------------------
    H("Driver B, unassigned, removed, Org B, anonymous");
    // ---------------------------------------------------------------------
    const bVeh = await drvBC.rpc("get_my_driver_vehicle");
    bVeh.data?.[0]?.vehicle_id === vehB ? P("Driver B sees Vehicle B") : F("Driver B did not resolve Vehicle B");
    const bVehicles = await visible(drvBC, "vehicles");
    bVehicles.n === 1 && bVehicles.rows[0].id === vehB ? P("Driver B sees only Vehicle B (mirror isolation)") : F(`Driver B sees ${bVehicles.n} vehicles`);
    const bDocs = await drvBC.rpc("get_driver_documents");
    (bDocs.data ?? []).every((d) => d.id !== docsA.sharedDoc) ? P("Driver B cannot see Driver A's shared document") : F("Driver B saw Vehicle A's document");

    for (const [name, client] of [["unassigned driver", idleC], ["removed driver (stale active assignment)", goneC], ["Org B driver", otherC], ["anonymous", anonC]]) {
      const v = await visible(client, "vehicles");
      const orgAOnly = v.rows.filter((row) => [vehA, vehB, vehGone].includes(row.id));
      orgAOnly.length === 0 ? P(`${name}: 0 Org A vehicles`) : F(`${name}: saw ${orgAOnly.length} Org A vehicles`);
      const ml = await visible(client, "maintenance_logs");
      ml.n === 0 ? P(`${name}: 0 maintenance rows`) : F(`${name}: saw ${ml.n} maintenance rows`);
      const ins = await visible(client, "vehicle_insurance");
      ins.n === 0 ? P(`${name}: 0 insurance rows`) : F(`${name}: saw ${ins.n} insurance rows`);
      const pass = await visible(client, "vehicle_passports");
      pass.n === 0 ? P(`${name}: 0 passport rows`) : F(`${name}: saw ${pass.n} passport rows`);
      const tok = await visible(client, "transfer_tokens");
      tok.n === 0 ? P(`${name}: 0 transfer tokens`) : F(`${name}: saw ${tok.n} transfer tokens`);
    }
    const goneRpc = await goneC.rpc("get_my_driver_vehicle");
    (goneRpc.data?.length ?? 0) === 0 ? P("removed driver: stale ACTIVE assignment resolves to no vehicle") : F("removed driver still resolved a vehicle");
    const goneDoc = await goneC.rpc("get_driver_document_path", { p_document: docsA.sharedDoc });
    !goneDoc.data ? P("removed driver: signed-URL resolver returns NULL") : F("removed driver still minted a document path");
    const idleRpc = await idleC.rpc("get_my_driver_vehicle");
    (idleRpc.data?.length ?? 0) === 0 ? P("unassigned driver: no vehicle") : F("unassigned driver resolved a vehicle");
    const idleHist = await idleC.rpc("get_driver_maintenance_history");
    (idleHist.data?.length ?? 0) === 0 ? P("unassigned driver: no maintenance history") : F("unassigned driver read maintenance history");

    // ---------------------------------------------------------------------
    H("Unassignment revokes immediately");
    // ---------------------------------------------------------------------
    r = await mgrC.rpc("unassign_driver", { p_vehicle: vehA });
    r.data?.state === "ok" ? P("fleet_manager unassigns Vehicle A") : F(`unassign_driver: ${JSON.stringify(r.data)}`);
    const afterV = await visible(drvAC, "vehicles");
    afterV.n === 0 ? P("after unassignment the driver sees 0 vehicles") : F(`after unassignment the driver still sees ${afterV.n} vehicles`);
    const afterDoc = await drvAC.rpc("get_driver_document_path", { p_document: docsA.sharedDoc });
    !afterDoc.data ? P("after unassignment no new signed URL can be minted") : F("unassigned driver still minted a document path");
    const afterRem = await visible(drvAC, "reminders");
    afterRem.n === 0 ? P("after unassignment the driver sees 0 reminders") : F("unassigned driver still sees reminders");
    r = await mgrC.rpc("unassign_driver", { p_vehicle: vehA });
    r.data?.state === "ok" ? P("unassigning twice is idempotent") : F("repeat unassign errored");

    // Reassignment replaces atomically.
    await mgrC.rpc("assign_driver", { p_vehicle: vehA, p_member: mA });
    await mgrC.rpc("assign_driver", { p_vehicle: vehB, p_member: mA });
    const { data: activeA } = await admin.from("driver_assignments").select("vehicle_id").eq("driver_user_id", driverA.id).is("unassigned_at", null);
    (activeA?.length ?? 0) === 1 && activeA[0].vehicle_id === vehB ? P("reassignment leaves exactly one active assignment") : F(`reassignment left ${activeA?.length} active rows`);
    const { data: bStill } = await admin.from("driver_assignments").select("driver_user_id").eq("vehicle_id", vehB).is("unassigned_at", null);
    (bStill?.length ?? 0) === 1 ? P("Vehicle B has exactly one active driver after takeover") : F("Vehicle B has multiple active drivers");

    // ---------------------------------------------------------------------
    H("Non-driver roles keep their organization-wide behaviour");
    // ---------------------------------------------------------------------
    for (const [name, client] of [["owner", ownerC], ["admin", adminC], ["fleet_manager", mgrC], ["viewer", viewerC]]) {
      const v = await visible(client, "vehicles");
      v.n === 3 ? P(`${name} still sees all 3 Org A vehicles`) : F(`${name} sees ${v.n} vehicles (expected 3)`);
      const ml = await visible(client, "maintenance_logs");
      ml.n > 0 ? P(`${name} still reads maintenance incl. cost`) : F(`${name} lost maintenance access`);
      const ins = await visible(client, "vehicle_insurance");
      ins.n > 0 ? P(`${name} still reads insurance`) : F(`${name} lost insurance access`);
      const docv = await visible(client, "vehicle_documents");
      docv.n > 0 ? P(`${name} still reads documents`) : F(`${name} lost document access`);
    }
    // INSERT ... RETURNING must still work for a writer. Postgres applies the
    // SELECT policy to the RETURNING clause, so a `vehicles` policy that answers
    // by re-querying `vehicles` from a STABLE function cannot see the new row
    // and fails the whole statement — silently breaking every
    // `.insert().select()` in the app while a bare INSERT still succeeds. An
    // earlier draft of the driver policy did exactly that.
    const created = await mgrC.from("vehicles")
      .insert({ owner_user_id: manager.id, make: "Ins", model: "Ret", year: 2026 })
      .select("id")
      .single();
    created.data?.id
      ? P("INSERT ... RETURNING still returns the new vehicle to a writer")
      : F(`INSERT ... RETURNING broken: ${created.error?.message}`);
    if (created.data?.id) await admin.from("vehicles").delete().eq("id", created.data.id);

    const viewerWrite = await viewerC.from("vehicles").update({ current_mileage: 7 }).eq("id", vehA).select("id");
    (viewerWrite.data?.length ?? 0) === 0 ? P("viewer remains read-only") : F("viewer wrote a vehicle");
    const mgrWrite = await mgrC.from("vehicles").update({ current_mileage: 1234 }).eq("id", vehA).select("id");
    (mgrWrite.data?.length ?? 0) === 1 ? P("fleet_manager retains write access") : F("fleet_manager lost write access");
    const mgrRoster = await mgrC.rpc("list_eligible_drivers");
    (mgrRoster.data?.length ?? 0) >= 3 ? P("fleet_manager can list eligible drivers") : F(`list_eligible_drivers returned ${mgrRoster.data?.length ?? 0}`);
    const ownerHist = await ownerC.rpc("get_vehicle_assignment_history", { p_vehicle: vehA });
    (ownerHist.data?.length ?? 0) > 0 ? P("owner can read vehicle assignment history") : F("owner could not read assignment history");
    const otherHist = await otherC.rpc("get_vehicle_assignment_history", { p_vehicle: vehA });
    (otherHist.data?.length ?? 0) === 0 ? P("Org B cannot read Org A assignment history") : F("cross-org assignment history leak");

    // fleet_manager assignment rights do NOT imply invitation-management rights.
    const mgrInvites = await visible(mgrC, "organization_invitations");
    mgrInvites.n === 0 ? P("fleet_manager cannot read invitations (assignment rights ≠ invite rights)") : F("fleet_manager read invitations");

    // ---------------------------------------------------------------------
    H("Free-text driver fields grant nothing");
    // ---------------------------------------------------------------------
    await admin.from("vehicles").update({ assigned_driver_name: "Driver Idle", assigned_driver_phone: "+972500000000" }).eq("id", vehGone);
    const idleAfter = await visible(idleC, "vehicles");
    idleAfter.n === 0 ? P("assigned_driver_name/phone matching a real user grants no access") : F("free-text driver field granted access");

    // ---------------------------------------------------------------------
    H("Passport behaviour is unchanged by the driver role");
    // ---------------------------------------------------------------------
    // get_public_passport takes the token HASH. Passing the real hash of a real
    // token exercises the actual public path rather than a not_found branch.
    const anonPass = await anonC.rpc("get_public_passport", { p_token_hash: docsA.tokenHash });
    const anonBody = JSON.stringify(anonPass.data ?? {});
    anonPass.data && anonPass.data.state !== "not_found"
      ? P("anonymous still resolves a valid passport token") : F(`public passport unreachable: ${anonBody.slice(0, 120)}`);
    !anonBody.includes("organization_id") && !anonBody.includes("storage_path") && !anonBody.includes("owner_user_id") && !anonBody.includes("token_hash")
      ? P("public passport leaks no org / storage / owner / token fields") : F("public passport output leaked a forbidden field");

    // The driver role must not BROADEN passport output. Driver A is assigned to
    // the very vehicle this passport describes, which is the strongest case.
    const drvPass = await drvAC.rpc("get_public_passport", { p_token_hash: docsA.tokenHash });
    JSON.stringify(drvPass.data ?? {}) === anonBody
      ? P("the assigned driver gets byte-identical passport output to anonymous") : F("driver assignment broadened passport output");
    const drvOtherPass = await drvAC.rpc("get_public_passport", { p_token_hash: docsB.tokenHash });
    const otherBody = JSON.stringify(drvOtherPass.data ?? {});
    !otherBody.includes("SecretInsurer") && !otherBody.includes("Secret Garage")
      ? P("a driver resolving another vehicle's token gains no private data") : F("passport token leaked another vehicle's private data");
  } finally {
    await cleanupUsers(admin, created);
  }

  console.log(`\n${"=".repeat(60)}\nDriver View check: ${passes} passed, ${fails} failed\n${"=".repeat(60)}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness error:", e.message);
  process.exit(1);
});
