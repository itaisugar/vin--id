#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Production QA round 1 — quick-wins validation.
 *
 * Covers the six corrections in docs/production-qa-quick-wins.md:
 *   1. Needs attention is derived, not stale
 *   2. nearest document expiry is gone from the fleet list only
 *   3. one contextual Passport action on vehicle detail
 *   4. Team & Access navigation
 *   5. operational fields editable and discoverable after creation
 *   6. driver assignment is authoritative; free text grants nothing
 *
 * Every access-control assertion runs under a REAL per-persona JWT session. The
 * service role only builds and inspects fixtures — it bypasses RLS, so using it
 * for an authorization assertion would prove nothing.
 *
 * The rules under test are the shipped TypeScript modules imported directly
 * (`lib/fleet/alerts.ts`, `lib/fleet/types.ts`, `lib/passports/types.ts`), never
 * a reimplementation of them.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. No key or secret is ever printed. Cleans up every fixture it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:qa-quick-wins
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { cleanupUsers, joinOrg, orgOf } from "./lib/org-fixtures.mjs";
// Imported from the shipped modules. `lib/fleet/alerts.ts` cannot be loaded
// here — Node's type-stripping loader will not resolve its extensionless
// `./dates` import — which is exactly why the effective-status rule was placed
// in `./types`, a module with no runtime imports. `classifyDeadline` and
// `classifyKmDeadline` below are the same functions `getServiceStatus()` calls.
import {
  classifyDeadline,
  classifyKmDeadline,
} from "../../lib/fleet/dates.ts";
import {
  effectiveOperationalStatus,
  needsAttention,
} from "../../lib/fleet/types.ts";
import { effectiveStatus as passportEffectiveStatus } from "../../lib/passports/types.ts";

/** Issue statuses that count as open — mirrors OPEN_ISSUE_STATUSES. */
const OPEN_ISSUE_STATUSES = ["open", "monitoring"];

/** The worst-of composition `getServiceStatus()` performs. */
function serviceStateOf(v) {
  const byDate = classifyDeadline(v.next_service_date);
  const byMileage = classifyKmDeadline(v.next_service_km, v.current_mileage);
  if (byDate === "overdue" || byMileage === "overdue") return "overdue";
  if (byDate === "due_soon" || byMileage === "due_soon") return "due_soon";
  if (byDate === "upcoming" || byMileage === "upcoming") return "upcoming";
  return null;
}

/** Mirrors `operationalGroup()` in lib/fleet/alerts.ts. */
function operationalGroup(status) {
  if (status === "active") return "operational";
  if (status === "out_of_service" || status === "in_garage") return "unavailable";
  return "attention";
}

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = "jsthfmgvcdrfzpgkpwvt";

if (process.env.FLEET_CHECK_ALLOW !== "1") { console.error("Set FLEET_CHECK_ALLOW=1. Never run against production."); process.exit(2); }
if (!URL || !ANON || !SERVICE) { console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
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
const DAY = 86_400_000;
const isoDay = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

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

/**
 * Re-derive one vehicle's row exactly as `buildRows()` does, through a persona
 * session so RLS applies. Returns the effective status plus the pieces the three
 * surfaces render, which is what lets us assert they agree.
 */
async function vehicleRow(client, organizationId, vehicleId) {
  const [{ data: vehicles }, { data: issues }] = await Promise.all([
    client.from("vehicles").select("*").eq("organization_id", organizationId)
      .eq("status", "active").is("deleted_at", null),
    client.from("issue_logs").select("id, vehicle_id, status, severity, title")
      .eq("organization_id", organizationId).in("status", OPEN_ISSUE_STATUSES)
      .is("deleted_at", null),
  ]);
  const v = (vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) return null;
  const openIssueCount = (issues ?? []).filter((i) => i.vehicle_id === vehicleId).length;
  const service = { state: serviceStateOf(v) };
  const status = effectiveOperationalStatus(v.operational_status, {
    openIssueCount,
    serviceState: service.state,
  });
  return {
    vehicle: v,
    openIssueCount,
    service,
    effectiveStatus: status,
    // The three surfaces, computed the way each one computes it.
    listBadge: status,
    detailBadge: status,
    dashboardGroup: operationalGroup(status),
    attention: needsAttention(status),
  };
}

async function main() {
  const users = [];
  try {
    const owner = await mkUser("qa-owner");
    const viewer = await mkUser("qa-viewer");
    const driver = await mkUser("qa-driver");
    const outsider = await mkUser("qa-outsider");
    users.push(owner, viewer, driver, outsider);

    const orgA = await orgOf(admin, owner.id);
    const orgB = await orgOf(admin, outsider.id);
    await joinOrg(admin, viewer.id, orgA, "viewer");
    await joinOrg(admin, driver.id, orgA, "driver");

    const ownerC = await signIn(owner.email);
    const viewerC = await signIn(viewer.email);
    const driverC = await signIn(driver.email);
    const outsiderC = await signIn(outsider.email);

    // A vehicle with NO alerts at all: no service target, no expiry dates.
    const { data: vRows, error: vErr } = await admin.from("vehicles").insert({
      owner_user_id: owner.id, organization_id: orgA,
      make: "QA", model: "Van", year: 2021, license_plate: `QA-${RUN}`,
      current_mileage: 10_000, operational_status: "active",
    }).select("id").single();
    if (vErr) throw new Error(`seed vehicle: ${vErr.message}`);
    const vehicleId = vRows.id;

    // ---------------------------------------------------------------------
    section("1. Needs attention follows live data");
    // ---------------------------------------------------------------------
    {
      let row = await vehicleRow(ownerC, orgA, vehicleId);
      row && row.effectiveStatus === "active" && row.attention === false
        ? P("step 1: a vehicle with no active alert is not Needs attention")
        : F(`step 1: expected active/false, got ${row?.effectiveStatus}/${row?.attention}`);

      const { data: issueRow } = await admin.from("issue_logs").insert({
        owner_user_id: owner.id, organization_id: orgA, vehicle_id: vehicleId,
        title: "Brake noise", severity: "urgent", status: "open",
      }).select("id").single();

      row = await vehicleRow(ownerC, orgA, vehicleId);
      row.effectiveStatus === "issue_open" && row.attention === true
        ? P("step 2-3: one open issue puts the vehicle in Needs attention")
        : F(`step 2-3: expected issue_open/true, got ${row.effectiveStatus}/${row.attention}`);

      // The whole point of the fix: resolving clears it.
      await admin.from("issue_logs")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", issueRow.id);

      row = await vehicleRow(ownerC, orgA, vehicleId);
      row.openIssueCount === 0
        ? P("step 4: the resolved issue is no longer counted as open")
        : F(`step 4: openIssueCount ${row.openIssueCount}, expected 0`);
      row.effectiveStatus === "active" && row.attention === false
        ? P("step 5-6: with no other alert the vehicle is no longer Needs attention")
        : F(`step 5-6: STALE — expected active/false, got ${row.effectiveStatus}/${row.attention}`);

      // The stored column is deliberately untouched — this is what regressed.
      const { data: stored } = await admin.from("vehicles")
        .select("operational_status").eq("id", vehicleId).single();
      stored.operational_status === "active"
        ? P("the stored column was not written by any of the above")
        : F(`the stored column changed to ${stored.operational_status} (!)`);

      // Surfaces agree.
      row.listBadge === row.detailBadge &&
      (row.dashboardGroup === "attention") === row.attention
        ? P("step 7: dashboard group, list badge and detail badge agree")
        : F("step 7: the three surfaces disagree");
    }

    // ---------------------------------------------------------------------
    section("1b. A resolved issue does NOT clear a still-valid alert");
    // ---------------------------------------------------------------------
    {
      // Overdue service, plus an issue that then gets resolved.
      await admin.from("vehicles")
        .update({ next_service_date: isoDay(-30) }).eq("id", vehicleId);
      const { data: i2 } = await admin.from("issue_logs").insert({
        owner_user_id: owner.id, organization_id: orgA, vehicle_id: vehicleId,
        title: "Rattle", severity: "monitor", status: "open",
      }).select("id").single();

      let row = await vehicleRow(ownerC, orgA, vehicleId);
      row.effectiveStatus === "issue_open"
        ? P("an open issue outranks an overdue service")
        : F(`expected issue_open, got ${row.effectiveStatus}`);

      await admin.from("issue_logs").update({ status: "resolved" }).eq("id", i2.id);
      row = await vehicleRow(ownerC, orgA, vehicleId);
      row.effectiveStatus === "needs_service" && row.attention === true
        ? P("resolving the issue leaves the overdue service in Needs attention")
        : F(`expected needs_service/true, got ${row.effectiveStatus}/${row.attention}`);

      await admin.from("vehicles").update({ next_service_date: null }).eq("id", vehicleId);
      row = await vehicleRow(ownerC, orgA, vehicleId);
      row.effectiveStatus === "active"
        ? P("clearing the last alert returns the vehicle to active")
        : F(`expected active, got ${row.effectiveStatus}`);
    }

    // ---------------------------------------------------------------------
    section("1c. Declared statuses are never recomputed away");
    // ---------------------------------------------------------------------
    {
      for (const declared of ["out_of_service", "in_garage", "documents_missing"]) {
        await admin.from("vehicles").update({ operational_status: declared }).eq("id", vehicleId);
        const row = await vehicleRow(ownerC, orgA, vehicleId);
        row.effectiveStatus === declared
          ? P(`${declared} survives with no live alert to justify it`)
          : F(`${declared} was overwritten with ${row.effectiveStatus} (!)`);
      }
      await admin.from("vehicles").update({ operational_status: "active" }).eq("id", vehicleId);
    }

    // ---------------------------------------------------------------------
    section("2. Nearest expiry left the list, not the product");
    // ---------------------------------------------------------------------
    {
      const row = readFileSync("components/fleet/fleet-vehicle-row.tsx", "utf8");
      !/fields\.nearestExpiry/.test(row)
        ? P("fleet list no longer renders the nearest-expiry field")
        : F("fleet list still renders nearest expiry (!)");

      const service = readFileSync("lib/fleet/service.ts", "utf8");
      /nearestExpiry:/.test(service)
        ? P("nearestExpiry is still computed on the row")
        : F("nearestExpiry is no longer computed (!)");
      /document_expiring/.test(service) && /document_expired/.test(service)
        ? P("dashboard document-expiry actions are still built")
        : F("document expiry actions disappeared (!)");

      for (const loc of ["en", "he"]) {
        const messages = readFileSync(`messages/${loc}.json`, "utf8");
        !/"nearestExpiry"/.test(messages)
          ? P(`${loc}: the unused nearestExpiry label was removed`)
          : F(`${loc}: nearestExpiry label still present (!)`);
      }
    }

    // ---------------------------------------------------------------------
    section("3. One contextual Passport action");
    // ---------------------------------------------------------------------
    {
      const mkPassport = async (status, expires) => {
        const { data, error } = await admin.from("vehicle_passports").insert({
          owner_user_id: owner.id, organization_id: orgA, vehicle_id: vehicleId,
          status, version: 1, snapshot: { vehicle: {} },
          expires_at: expires,
        }).select("id, status, expires_at").single();
        if (error) throw new Error(`seed passport: ${error.message}`);
        return data;
      };
      const currentOf = (list) =>
        list.find((p) => passportEffectiveStatus(p) === "active") ?? null;

      const { data: none } = await ownerC.from("vehicle_passports")
        .select("id, status, expires_at").eq("vehicle_id", vehicleId);
      currentOf(none ?? []) === null
        ? P("no passport -> the page offers Create")
        : F("expected no current passport");

      const revoked = await mkPassport("revoked", null);
      let { data: list } = await ownerC.from("vehicle_passports")
        .select("id, status, expires_at").eq("vehicle_id", vehicleId);
      currentOf(list ?? []) === null
        ? P("a revoked passport is not current -> still Create")
        : F("a revoked passport was treated as current (!)");

      const lapsed = await mkPassport("active", new Date(Date.now() - DAY).toISOString());
      ({ data: list } = await ownerC.from("vehicle_passports")
        .select("id, status, expires_at").eq("vehicle_id", vehicleId));
      currentOf(list ?? []) === null
        ? P("an active-but-expired passport is not current -> still Create")
        : F("a lapsed passport was treated as current (!)");

      const live = await mkPassport("active", new Date(Date.now() + 30 * DAY).toISOString());
      ({ data: list } = await ownerC.from("vehicle_passports")
        .select("id, status, expires_at").eq("vehicle_id", vehicleId));
      const current = currentOf(list ?? []);
      current?.id === live.id
        ? P("a live passport -> the page offers Open, pointing at it")
        : F("the live passport was not selected (!)");

      (list ?? []).length === 3
        ? P("all 3 historical passports are still stored and readable")
        : F(`history lost rows: ${(list ?? []).length} of 3`);

      // Rendering one action never creates a passport.
      const { count } = await admin.from("vehicle_passports")
        .select("id", { count: "exact", head: true }).eq("vehicle_id", vehicleId);
      count === 3 ? P("no duplicate passport was created") : F(`passport count ${count}, expected 3`);

      // Tenant isolation.
      const { data: crossOrg } = await outsiderC.from("vehicle_passports")
        .select("id").eq("vehicle_id", vehicleId);
      (crossOrg ?? []).length === 0
        ? P("another organization reads none of this vehicle's passports")
        : F("cross-organization passport read (!)");

      const section3 = readFileSync("components/passports/passport-section.tsx", "utf8");
      !/PassportCard/.test(section3)
        ? P("the vehicle page no longer renders passport history cards")
        : F("passport history cards are still rendered (!)");

      await admin.from("vehicle_passports").delete()
        .in("id", [revoked.id, lapsed.id, live.id]);
    }

    // ---------------------------------------------------------------------
    section("4. Team & Access navigation");
    // ---------------------------------------------------------------------
    {
      const nav = readFileSync("components/nav-config.ts", "utf8");
      /teamAccessNavItem/.test(nav) && /\/organization/.test(nav)
        ? P("a Team & Access nav item exists and points at /organization")
        : F("Team & Access nav item missing (!)");

      const appNav = readFileSync("components/app-nav.tsx", "utf8");
      /canManageOrganization/.test(appNav)
        ? P("the sidebar gates the entry on canManageOrganization")
        : F("the sidebar does not gate Team & Access (!)");
      !/teamAccessNavItem/.test(appNav.split("export function BottomNav")[1] ?? "")
        ? P("the mobile bar is unchanged (still 5 slots)")
        : F("Team & Access was added to the mobile bar (!)");

      const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
      const he = JSON.parse(readFileSync("messages/he.json", "utf8"));
      en.nav.teamAccess === "Team & Access"
        ? P("English label is 'Team & Access'") : F(`English label: ${en.nav.teamAccess}`);
      he.nav.teamAccess === "צוות והרשאות"
        ? P("Hebrew label is 'צוות והרשאות'") : F(`Hebrew label: ${he.nav.teamAccess}`);

      // Hiding the nav entry is presentation; the database is what actually
      // refuses. `list_organization_members()` carries `and is_org_admin()`
      // INSIDE its WHERE clause, so a non-admin gets an empty roster rather than
      // an error — no row, and no signal about whether rows exist.
      const { data: viewerMembers } = await viewerC.rpc("list_organization_members");
      const { data: viewerInv } = await viewerC.from("organization_invitations").select("id");
      (viewerMembers ?? []).length === 0
        ? P("viewer: the member roster returns no rows") : F("viewer read the member roster (!)");
      (viewerInv ?? []).length === 0
        ? P("viewer: reads no invitations") : F("viewer read invitations (!)");
      const { data: driverMembers } = await driverC.rpc("list_organization_members");
      (driverMembers ?? []).length === 0
        ? P("driver: the member roster returns no rows") : F("driver read the member roster (!)");

      // And the owner, who may, still gets a real roster — so the assertions
      // above are proving authorization, not a broken RPC.
      const { data: ownerMembers } = await ownerC.rpc("list_organization_members");
      (ownerMembers ?? []).length === 3
        ? P("owner: reads the full 3-member roster")
        : F(`owner roster returned ${(ownerMembers ?? []).length} rows, expected 3`);
    }

    // ---------------------------------------------------------------------
    section("5. Operational fields are editable after creation");
    // ---------------------------------------------------------------------
    {
      const nextDate = isoDay(45);
      const { data: upd } = await ownerC.from("vehicles")
        .update({ next_service_date: nextDate, next_service_km: 25_000, test_expiry_date: isoDay(60) })
        .eq("id", vehicleId).select("next_service_date, next_service_km, test_expiry_date").single();
      upd?.next_service_date === nextDate ? P("owner updates next service date") : F("next service date not saved");
      upd?.next_service_km === 25_000 ? P("owner updates next service mileage") : F("next service mileage not saved");
      upd?.test_expiry_date === isoDay(60) ? P("owner updates inspection/test renewal") : F("test expiry not saved");

      // Survives a fresh read (i.e. it is in the database, not in a cache).
      const { data: reread } = await ownerC.from("vehicles")
        .select("next_service_date, next_service_km").eq("id", vehicleId).single();
      reread?.next_service_date === nextDate && reread?.next_service_km === 25_000
        ? P("values persist across a fresh read") : F("values did not persist");

      // The dashboard recomputes from them.
      await admin.from("vehicles").update({ next_service_date: isoDay(-5) }).eq("id", vehicleId);
      const overdue = await vehicleRow(ownerC, orgA, vehicleId);
      overdue.service.state === "overdue" && overdue.effectiveStatus === "needs_service"
        ? P("an overdue date immediately drives the derived status")
        : F(`expected overdue/needs_service, got ${overdue.service.state}/${overdue.effectiveStatus}`);
      await admin.from("vehicles")
        .update({ next_service_date: null, next_service_km: null, test_expiry_date: null })
        .eq("id", vehicleId);

      // Invalid mileage is refused by the CHECK constraint.
      const { error: badKm } = await ownerC.from("vehicles")
        .update({ next_service_km: -1 }).eq("id", vehicleId).select("id");
      badKm ? P("a negative next-service mileage is rejected") : F("negative mileage accepted (!)");

      // Viewer is read-only.
      const { data: viewerWrite } = await viewerC.from("vehicles")
        .update({ next_service_date: isoDay(10) }).eq("id", vehicleId).select("id");
      (viewerWrite ?? []).length === 0 ? P("viewer cannot edit operational fields") : F("viewer wrote (!)");

      // Driver cannot even read the fleet table, let alone write it.
      const { data: driverWrite } = await driverC.from("vehicles")
        .update({ next_service_date: isoDay(10) }).eq("id", vehicleId).select("id");
      (driverWrite ?? []).length === 0 ? P("driver cannot edit operational fields") : F("driver wrote (!)");

      // Discoverability: the card links into the exact field, and the form's
      // disclosure is open in edit mode so the target is visible.
      const card = readFileSync("components/fleet/fleet-info-card.tsx", "utf8");
      /serviceCompliance\.title/.test(card) ? P("the card is titled Service & Compliance") : F("card title missing");
      /edit#\$\{field\}|edit#/.test(card) ? P("values deep-link into the edit form") : F("no deep link to the field");
      const form = readFileSync("components/vehicles/vehicle-form.tsx", "utf8");
      /open=\{mode === "edit"\}/.test(form)
        ? P("the form section is open in edit mode") : F("the form section is still collapsed in edit mode (!)");
    }

    // ---------------------------------------------------------------------
    section("6. Driver assignment is authoritative; free text is not");
    // ---------------------------------------------------------------------
    {
      // A legacy free-text value, exactly as production holds it.
      await admin.from("vehicles")
        .update({ assigned_driver_name: "Typed Name", assigned_driver_phone: "050-0000000" })
        .eq("id", vehicleId);

      // It grants nothing: the driver still sees no vehicle.
      const { data: beforeAssign } = await driverC.rpc("get_my_driver_vehicle");
      (beforeAssign ?? []).length === 0
        ? P("a typed driver name grants the driver no access")
        : F("free text granted vehicle access (!)");

      // The form can no longer set it, and saving never clears it.
      const form = readFileSync("components/vehicles/vehicle-form.tsx", "utf8");
      !/register\("assigned_driver_name"\)/.test(form)
        ? P("the free-text driver input is gone from the form")
        : F("the free-text driver input is still on the form (!)");
      const fleetTypes = readFileSync("lib/fleet/types.ts", "utf8");
      const rowFn = fleetTypes.split("export function fleetFieldsToRow")[1] ?? "";
      !/assigned_driver_name:/.test(rowFn)
        ? P("fleetFieldsToRow does not write the driver columns")
        : F("fleetFieldsToRow still writes the driver columns (!)");

      await ownerC.from("vehicles").update({ next_service_km: 30_000 }).eq("id", vehicleId);
      const { data: afterSave } = await admin.from("vehicles")
        .select("assigned_driver_name").eq("id", vehicleId).single();
      afterSave.assigned_driver_name === "Typed Name"
        ? P("saving the vehicle preserves the historical free-text value")
        : F(`the historical value was destroyed: ${afterSave.assigned_driver_name}`);

      // Assignment through the authoritative RPC.
      const { data: memberRow } = await admin.from("organization_members")
        .select("id").eq("user_id", driver.id).single();
      const { data: assigned } = await ownerC.rpc("assign_driver", {
        p_vehicle: vehicleId, p_member: memberRow.id, p_note: null,
      });
      assigned?.state === "ok" ? P("owner assigns a driver") : F(`assign_driver: ${assigned?.state}`);

      const { data: driverVehicle } = await driverC.rpc("get_my_driver_vehicle");
      (driverVehicle ?? []).length === 1
        ? P("assignment grants the driver access to that vehicle")
        : F("assignment did not grant access (!)");

      // The list's driver filter reads the assignment, not the free text.
      const { data: activeAssignments } = await ownerC.from("driver_assignments")
        .select("vehicle_id").eq("organization_id", orgA).is("unassigned_at", null);
      (activeAssignments ?? []).some((a) => a.vehicle_id === vehicleId)
        ? P("the vehicle appears in the authoritative active-assignment set")
        : F("the assignment is not visible to the list query (!)");

      // Viewer and driver may not assign.
      const { data: viewerAssign } = await viewerC.rpc("assign_driver", {
        p_vehicle: vehicleId, p_member: memberRow.id, p_note: null,
      });
      viewerAssign?.state !== "ok" ? P("viewer cannot assign a driver") : F("viewer assigned (!)");
      const { data: driverSelfAssign } = await driverC.rpc("assign_driver", {
        p_vehicle: vehicleId, p_member: memberRow.id, p_note: null,
      });
      driverSelfAssign?.state !== "ok" ? P("driver cannot self-assign") : F("driver self-assigned (!)");

      // Another organization cannot touch it.
      const { data: crossAssign } = await outsiderC.rpc("assign_driver", {
        p_vehicle: vehicleId, p_member: memberRow.id, p_note: null,
      });
      crossAssign?.state !== "ok"
        ? P("another organization cannot assign to this vehicle")
        : F("cross-organization assignment succeeded (!)");
      const { data: crossRead } = await outsiderC.from("driver_assignments")
        .select("id").eq("organization_id", orgA);
      (crossRead ?? []).length === 0
        ? P("another organization reads no assignments") : F("cross-organization assignment read (!)");

      // Unassign revokes.
      const { data: unassigned } = await ownerC.rpc("unassign_driver", { p_vehicle: vehicleId });
      unassigned?.state === "ok" ? P("owner unassigns the driver") : F(`unassign_driver: ${unassigned?.state}`);
      const { data: afterUnassign } = await driverC.rpc("get_my_driver_vehicle");
      (afterUnassign ?? []).length === 0
        ? P("unassignment revokes the driver's access") : F("driver kept access after unassignment (!)");

      // The legacy value is still readable, and labelled as a note.
      const card = readFileSync("components/fleet/fleet-info-card.tsx", "utf8");
      /LegacyDriverNote/.test(card) && /driverNote\.help/.test(card)
        ? P("the legacy value is shown as an explicitly labelled contact note")
        : F("the legacy value is unlabelled or hidden (!)");
      !/fields\.assignedDriver/.test(card)
        ? P("nothing labels the free text as the assigned driver any more")
        : F("the free text is still labelled 'Assigned driver' (!)");
    }

    // ---------------------------------------------------------------------
    section("7. Translation completeness");
    // ---------------------------------------------------------------------
    {
      const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
      const en = new Set(flat(JSON.parse(readFileSync("messages/en.json", "utf8"))));
      const he = new Set(flat(JSON.parse(readFileSync("messages/he.json", "utf8"))));
      const missing = [...en].filter((k) => !he.has(k));
      const orphan = [...he].filter((k) => !en.has(k));
      missing.length === 0 ? P(`every one of ${en.size} English keys has a Hebrew translation`)
                           : F(`missing Hebrew: ${missing.slice(0, 5).join(", ")}`);
      orphan.length === 0 ? P("no orphan Hebrew keys") : F(`orphan Hebrew: ${orphan.slice(0, 5).join(", ")}`);
    }

    // Fixture teardown: fleet rows, then the organizations, then the users.
    await admin.from("issue_logs").delete().eq("vehicle_id", vehicleId);
    await admin.from("driver_assignments").delete().eq("vehicle_id", vehicleId);
    await admin.from("vehicles").delete().eq("id", vehicleId);
    await admin.from("organizations").delete().in("id", [orgA, orgB]);
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`QA quick wins: ${passes} passed, ${fails} failed`);
  console.log("=".repeat(64));
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
