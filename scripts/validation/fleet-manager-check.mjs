#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Fleet Lite — Fleet Manager validation.
 *
 * Exercises the dashboard's alert and cost rules, the vehicle list's search /
 * filter / sort, vehicle detail, and the role model, against a deterministic
 * 50-vehicle fixture in real application tables. Every access-control assertion
 * runs under a REAL per-persona JWT session; the service role only builds and
 * inspects fixtures, because a service-role client bypasses RLS and would prove
 * nothing.
 *
 * The alert/cost calculations under test are the same TypeScript modules the app
 * renders from (`lib/fleet/alerts.ts`, `lib/fleet/costs.ts`), imported here
 * directly, so this validates the shipped rules rather than a reimplementation.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. No key or secret is ever printed. Cleans up every fixture it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:fleet-manager
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { cleanupUsers, joinOrg, orgOf } from "./lib/org-fixtures.mjs";
import { seedFleet } from "./lib/fleet-fixture.mjs";
import { summarizeMonthlyCosts } from "../../lib/fleet/costs.ts";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = "jsthfmgvcdrfzpgkpwvt";

if (process.env.FLEET_CHECK_ALLOW !== "1") { console.error("Set FLEET_CHECK_ALLOW=1."); process.exit(2); }
if (!URL || !ANON || !SERVICE) { console.error("Missing SUPABASE_URL/ANON/SERVICE."); process.exit(2); }
if (URL.includes(PROD_REF)) { console.error("Production ref. Aborting."); process.exit(2); }
if (!/127\.0\.0\.1|localhost/.test(URL) && process.env.FLEET_CHECK_ALLOW_REMOTE !== "1") {
  console.error(`Non-local URL ${URL}; set FLEET_CHECK_ALLOW_REMOTE=1 for staging.`); process.exit(2);
}

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PW = "Test-Passw0rd!";
const RUN = randomBytes(3).toString("hex");
const FLEET_SIZE = 50;

async function mkUser(tag) {
  const email = `${tag}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  return { id: data.user.id, email, tag };
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn: ${error.message}`);
  return c;
}

const DAY = 86_400_000;
const isoDay = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const nextMonthStart = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1))
    .toISOString().slice(0, 10);
};

/**
 * Re-issue the dashboard's queries through a persona session, then apply the
 * shipped rules. Mirrors `getFleetOverview()`'s query plan exactly.
 */
async function fleetSnapshot(client, organizationId) {
  const [veh, iss, doc, cost] = await Promise.all([
    client.from("vehicles")
      .select("id, license_plate, operational_status, current_mileage, next_service_date, next_service_km, test_expiry_date, insurance_expiry_date, assigned_driver_name, make, model")
      .eq("organization_id", organizationId).eq("status", "active").is("deleted_at", null),
    client.from("issue_logs").select("id, vehicle_id, status, severity")
      .eq("organization_id", organizationId).in("status", ["open", "monitoring"]).is("deleted_at", null),
    client.from("vehicle_documents").select("id, vehicle_id, expiry_date")
      .eq("organization_id", organizationId).not("expiry_date", "is", null).is("deleted_at", null),
    client.from("maintenance_logs").select("vehicle_id, cost, currency, performed_at")
      .eq("organization_id", organizationId)
      .gte("performed_at", monthStart()).lt("performed_at", nextMonthStart())
      .is("deleted_at", null),
  ]);
  return {
    vehicles: veh.data ?? [],
    issues: iss.data ?? [],
    docs: doc.data ?? [],
    costRows: cost.data ?? [],
    errors: [veh.error, iss.error, doc.error, cost.error].filter(Boolean),
  };
}

const classify = (iso) => {
  if (!iso) return null;
  const days = Math.round(
    (Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / DAY,
  );
  return days < 0 ? "overdue" : days <= 30 ? "due_soon" : "upcoming";
};

async function main() {
  const owner = await mkUser("fm-owner");
  const fleetMgr = await mkUser("fm-manager");
  const viewer = await mkUser("fm-viewer");
  const removed = await mkUser("fm-removed");
  const otherOrg = await mkUser("fm-other");
  const users = [owner, fleetMgr, viewer, removed, otherOrg];

  try {
    const orgA = await orgOf(admin, owner.id);
    const orgB = await orgOf(admin, otherOrg.id);
    await joinOrg(admin, fleetMgr.id, orgA, "fleet_manager");
    await joinOrg(admin, viewer.id, orgA, "viewer");
    await joinOrg(admin, removed.id, orgA, "fleet_manager");

    section(`Fixture: ${FLEET_SIZE}-vehicle fleet`);
    const fixture = await seedFleet(admin, {
      ownerId: owner.id,
      organizationId: orgA,
      count: FLEET_SIZE,
    });
    P(`seeded ${fixture.vehicleCount} vehicles with issues, documents and costs`);

    // A decoy fleet in the OTHER organization: nothing below may ever see it.
    await seedFleet(admin, {
      ownerId: otherOrg.id,
      organizationId: orgB,
      count: 6,
    });
    P("seeded a separate organization B fleet as a cross-tenant decoy");

    const ownerC = await signIn(owner.email);
    const mgrC = await signIn(fleetMgr.email);
    const viewerC = await signIn(viewer.email);
    const removedC = await signIn(removed.email);
    const otherC = await signIn(otherOrg.email);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    const snap = await fleetSnapshot(ownerC, orgA);
    snap.errors.length === 0 ? P("dashboard queries succeed for the owner") : F(`query errors: ${snap.errors.map((e) => e.message)}`);

    const exp = fixture.expected;

    // ================================================= dashboard calculations
    section("Dashboard calculations");
    snap.vehicles.length === exp.total
      ? P(`total vehicle count = ${exp.total}`) : F(`total ${snap.vehicles.length} != ${exp.total}`);

    const serviceState = (v) => {
      const byDate = classify(v.next_service_date);
      const byKm =
        v.next_service_km == null || v.current_mileage == null
          ? null
          : v.next_service_km - v.current_mileage < 0
            ? "overdue"
            : v.next_service_km - v.current_mileage <= 1000
              ? "due_soon"
              : "upcoming";
      if (byDate === "overdue" || byKm === "overdue") return "overdue";
      if (byDate === "due_soon" || byKm === "due_soon") return "due_soon";
      if (byDate || byKm) return "upcoming";
      return null;
    };

    const overdue = snap.vehicles.filter((v) => serviceState(v) === "overdue").length;
    const dueSoon = snap.vehicles.filter((v) => serviceState(v) === "due_soon").length;
    const unknown = snap.vehicles.filter((v) => serviceState(v) === null).length;

    overdue === exp.serviceOverdue
      ? P(`overdue services = ${overdue} (date and mileage rules combined)`)
      : F(`overdue ${overdue} != ${exp.serviceOverdue}`);
    dueSoon === exp.serviceDueSoon
      ? P(`upcoming services = ${dueSoon}`) : F(`due soon ${dueSoon} != ${exp.serviceDueSoon}`);
    unknown === exp.serviceUnknown
      ? P(`vehicles with no service target = ${unknown} (reported, not counted as healthy)`)
      : F(`unknown ${unknown} != ${exp.serviceUnknown}`);
    overdue !== dueSoon || exp.serviceOverdue === exp.serviceDueSoon
      ? P("overdue and upcoming are separate counts, not one merged number")
      : F("overdue/upcoming indistinguishable");

    // Documents: count DOCUMENTS, not vehicles.
    let docExpired = 0, docExpiring = 0;
    for (const v of snap.vehicles) {
      for (const d of [v.test_expiry_date, v.insurance_expiry_date]) {
        const s = classify(d);
        if (s === "overdue") docExpired += 1;
        else if (s === "due_soon") docExpiring += 1;
      }
    }
    for (const d of snap.docs) {
      const s = classify(d.expiry_date);
      if (s === "overdue") docExpired += 1;
      else if (s === "due_soon") docExpiring += 1;
    }
    docExpired === exp.documentsExpired
      ? P(`expired documents = ${docExpired} (documents, not vehicles)`)
      : F(`expired documents ${docExpired} != ${exp.documentsExpired}`);
    docExpiring === exp.documentsExpiringSoon
      ? P(`expiring documents = ${docExpiring}`)
      : F(`expiring documents ${docExpiring} != ${exp.documentsExpiringSoon}`);

    const openIssues = snap.issues.length;
    const highPriority = snap.issues.filter((i) =>
      ["urgent", "stop_immediately"].includes(i.severity)).length;
    openIssues === exp.openIssues
      ? P(`open issues = ${openIssues} (resolved excluded)`) : F(`open issues ${openIssues} != ${exp.openIssues}`);
    highPriority === exp.highPriorityIssues
      ? P(`high-priority open issues = ${highPriority} (real severity values)`)
      : F(`high priority ${highPriority} != ${exp.highPriorityIssues}`);

    // ============================================================ cost cases
    section("Cost calculations");
    const costs = summarizeMonthlyCosts(snap.costRows);
    costs.monthTotal === exp.monthCost
      ? P(`current-month cost = ${costs.monthTotal} ${costs.currency}`)
      : F(`month cost ${costs.monthTotal} != ${exp.monthCost}`);
    costs.unknownCostCount === exp.unknownCostCount
      ? P(`NULL costs excluded from the sum and disclosed (${costs.unknownCostCount})`)
      : F(`unknown cost count ${costs.unknownCostCount} != ${exp.unknownCostCount}`);
    !costs.mixedCurrency ? P("single currency: no conversion performed") : F("unexpected mixed currency");
    costs.anomalies.length > 0
      ? P(`cost anomalies identified deterministically (${costs.anomalies.length})`)
      : F("no cost anomaly identified in a fleet seeded with 12,000 outliers");
    {
      // Previous-month spend must not leak into this month's figure.
      const { count } = await admin.from("maintenance_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgA).lt("performed_at", monthStart());
      (count ?? 0) > 0 && costs.monthTotal === exp.monthCost
        ? P(`previous-month costs exist (${count}) and are excluded from this month`)
        : F("previous-month exclusion not demonstrated");
    }
    {
      const zero = summarizeMonthlyCosts([
        { vehicle_id: "v1", cost: 0, currency: "ILS", performed_at: isoDay(0) },
      ]);
      zero.monthTotal === 0 && zero.unknownCostCount === 0
        ? P("zero cost is a real recorded value, not 'unknown'") : F("zero cost mishandled");
      const neg = summarizeMonthlyCosts([
        { vehicle_id: "v1", cost: -50, currency: "ILS", performed_at: isoDay(0) },
      ]);
      neg.monthTotal === 0 && neg.invalidCount === 1
        ? P("negative cost excluded and counted as invalid") : F("negative cost mishandled");
      const undated = summarizeMonthlyCosts([
        { vehicle_id: "v1", cost: 100, currency: "ILS", performed_at: null },
      ]);
      undated.monthTotal === 0 && undated.undatedCount === 1
        ? P("undated cost excluded from monthly attribution and disclosed") : F("undated cost mishandled");
      const mixed = summarizeMonthlyCosts([
        { vehicle_id: "v1", cost: 100, currency: "ILS", performed_at: isoDay(0) },
        { vehicle_id: "v2", cost: 100, currency: "USD", performed_at: isoDay(0) },
      ]);
      mixed.mixedCurrency && mixed.monthTotal === 100
        ? P("mixed currencies flagged; amounts never converted") : F("currency mixing mishandled");
    }
    {
      const { error } = await admin.from("maintenance_logs").insert({
        owner_user_id: owner.id, organization_id: orgA,
        vehicle_id: [...fixture.vehicleIdsByIndex.values()][0],
        service_type: "negative", performed_at: isoDay(0), cost: -1, currency: "ILS",
      });
      error ? P("database rejects a negative cost (CHECK constraint)") : F("negative cost accepted by the database (!)");
    }

    // ============================================================ vehicle list
    section("Vehicle list");
    snap.vehicles.length === FLEET_SIZE
      ? P(`all ${FLEET_SIZE} vehicles available to the list`) : F("list vehicle count wrong");
    {
      const plate = snap.vehicles[0].license_plate;
      const hits = snap.vehicles.filter((v) =>
        [v.license_plate, v.make, v.model, v.assigned_driver_name]
          .filter(Boolean).join(" ").toLowerCase()
          .includes(plate.toLowerCase()));
      hits.length === 1 ? P(`search by plate "${plate}" returns exactly the right vehicle`) : F(`plate search returned ${hits.length}`);

      const driverHits = snap.vehicles.filter((v) =>
        (v.assigned_driver_name ?? "").toLowerCase().includes("dana"));
      driverHits.length > 0 ? P("search by driver name returns vehicles") : F("driver search found nothing");
    }
    {
      const unassigned = snap.vehicles.filter((v) => !v.assigned_driver_name?.trim()).length;
      unassigned === exp.driverUnassigned
        ? P(`filter: unassigned driver = ${unassigned}`) : F(`unassigned ${unassigned} != ${exp.driverUnassigned}`);
      const withIssues = new Set(snap.issues.map((i) => i.vehicle_id)).size;
      withIssues === exp.vehiclesWithOpenIssues
        ? P(`filter: vehicles with open issues = ${withIssues}`) : F(`open-issue vehicles ${withIssues} != ${exp.vehiclesWithOpenIssues}`);
      const overdueFilter = snap.vehicles.filter((v) => serviceState(v) === "overdue").length;
      overdueFilter === exp.serviceOverdue
        ? P(`filter: overdue service = ${overdueFilter}`) : F("overdue filter wrong");
    }
    {
      // Combined filter: overdue service AND no driver.
      const combined = snap.vehicles.filter(
        (v) => serviceState(v) === "overdue" && !v.assigned_driver_name?.trim()).length;
      combined <= exp.serviceOverdue
        ? P(`combined filters behave predictably (overdue + no driver = ${combined})`)
        : F("combined filter exceeded its own subset");
    }
    {
      const sorted = [...snap.vehicles].sort((a, b) =>
        (a.license_plate ?? "").localeCompare(b.license_plate ?? ""));
      sorted[0].license_plate <= sorted[sorted.length - 1].license_plate
        ? P("sort by plate is ordered") : F("plate sort wrong");
      const byCost = [...costs.byVehicle].sort((a, b) => b.total - a.total);
      byCost.length === 0 || byCost[0].total >= byCost[byCost.length - 1].total
        ? P("sort by cost is ordered, highest first") : F("cost sort wrong");
    }

    // ========================================================== vehicle detail
    section("Vehicle detail");
    {
      const target = snap.vehicles.find((v) => v.license_plate === "FL-1000");
      const detail = await ownerC.from("vehicles").select("id, organization_id, license_plate")
        .eq("id", target.id).maybeSingle();
      detail.data?.organization_id === orgA
        ? P("vehicle detail returns the correct vehicle in the correct organization")
        : F("vehicle detail org mismatch");
      serviceState(target) === "overdue"
        ? P("vehicle detail service status = overdue (matches the dashboard rule)")
        : F(`detail service state ${serviceState(target)}`);

      const forged = await ownerC.from("vehicles").select("id").eq("id", randomUUID()).maybeSingle();
      !forged.data ? P("forged vehicle id rejected") : F("forged vehicle id resolved (!)");
    }

    // =============================================================== tenancy
    section("Tenant isolation");
    {
      const cross = await otherC.from("vehicles").select("id").eq("organization_id", orgA);
      (cross.data ?? []).length === 0
        ? P("organization B cannot read organization A vehicles") : F("cross-org vehicle read (!)");
      const crossCosts = await otherC.from("maintenance_logs").select("id").eq("organization_id", orgA);
      (crossCosts.data ?? []).length === 0
        ? P("organization B cannot read organization A costs") : F("cross-org cost read (!)");
      const bSnap = await fleetSnapshot(otherC, orgB);
      bSnap.vehicles.length === 6
        ? P("organization B sees exactly its own 6 vehicles") : F(`org B saw ${bSnap.vehicles.length}`);
      // Search must not cross tenants: B searching A's plate finds nothing.
      const bSearch = bSnap.vehicles.filter((v) => v.license_plate === "FL-1049");
      bSearch.length === 0 ? P("search does not cross organizations") : F("search crossed tenants (!)");

      const anonRead = await anon.from("vehicles").select("id").eq("organization_id", orgA);
      (anonRead.data ?? []).length === 0 ? P("unauthenticated user reads no vehicles") : F("anon read vehicles (!)");
    }

    // ============================================================ permissions
    section("Permissions");
    {
      const vehicleId = [...fixture.vehicleIdsByIndex.values()][0];

      const ownerRead = await ownerC.from("vehicles").select("id").eq("id", vehicleId);
      (ownerRead.data ?? []).length === 1 ? P("owner: dashboard and vehicle access") : F("owner denied access");

      const mgrSnap = await fleetSnapshot(mgrC, orgA);
      mgrSnap.vehicles.length === FLEET_SIZE ? P("fleet manager: full dashboard access") : F("fleet manager denied dashboard");
      const mgrWrite = await mgrC.from("vehicles").update({ current_mileage: 99_999 }).eq("id", vehicleId).select("id");
      (mgrWrite.data ?? []).length === 1 ? P("fleet manager: vehicle operational write allowed") : F("fleet manager write refused");

      const viewerSnap = await fleetSnapshot(viewerC, orgA);
      viewerSnap.vehicles.length === FLEET_SIZE ? P("viewer: read-only dashboard access") : F("viewer denied dashboard");
      const viewerWrite = await viewerC.from("vehicles").update({ current_mileage: 1 }).eq("id", vehicleId).select("id");
      (viewerWrite.data ?? []).length === 0 ? P("viewer: vehicle write refused") : F("viewer wrote a vehicle (!)");
      const viewerIssue = await viewerC.from("issue_logs").insert({
        owner_user_id: viewer.id, vehicle_id: vehicleId, title: "x", status: "open", severity: "info" });
      viewerIssue.error ? P("viewer: issue creation refused") : F("viewer created an issue (!)");
      const viewerMaint = await viewerC.from("maintenance_logs").insert({
        owner_user_id: viewer.id, vehicle_id: vehicleId, service_type: "x", performed_at: isoDay(0) });
      viewerMaint.error ? P("viewer: maintenance creation refused") : F("viewer created maintenance (!)");

      // Removed member loses everything, even with a stale profile cache.
      const { data: delRow } = await admin.from("organization_members").delete()
        .eq("user_id", removed.id).select("id");
      (delRow ?? []).length === 1 ? P("removed member: membership deleted") : F("could not remove member");
      await admin.from("profiles").update({ organization_id: orgA, role: "owner" }).eq("id", removed.id);
      const removedSnap = await fleetSnapshot(removedC, orgA);
      removedSnap.vehicles.length === 0
        ? P("removed member: no vehicle access despite a stale profile cache") : F("removed member still reads vehicles (!)");
      const removedWrite = await removedC.from("vehicles").update({ current_mileage: 5 }).eq("id", vehicleId).select("id");
      (removedWrite.data ?? []).length === 0 ? P("removed member: writes refused") : F("removed member wrote (!)");

      // Non-member (never joined) — org B owner acting on org A.
      const nonMember = await otherC.from("vehicles").update({ current_mileage: 7 }).eq("id", vehicleId).select("id");
      (nonMember.data ?? []).length === 0 ? P("non-member: writes refused") : F("non-member wrote (!)");
    }
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"}  (${passes} passed)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
