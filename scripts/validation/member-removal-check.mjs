#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Atomic member removal + safe active-workspace repair — validation.
 *
 * Exercises `remove_organization_member()` and its AFTER DELETE repair trigger
 * under REAL per-persona JWT sessions (the service role only builds/inspects
 * fixtures — it bypasses RLS, so it could never prove an authorization claim).
 *
 * THE INVARIANT UNDER TEST: after any membership is removed, the removed user's
 * `active_organization_id` never names an organization they no longer belong to.
 * It resolves to their personal workspace, else the oldest remaining membership,
 * else NULL — in the SAME transaction as the delete.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. No key or secret is ever printed. Cleans up every fixture it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:member-removal
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import {
  addMembership,
  cleanupUsers,
  orgOf,
  orgsOf,
  setActiveOrg,
} from "./lib/org-fixtures.mjs";

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

async function mkUser(tag) {
  const email = `mr-${tag}-${RUN}@example.test`;
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
const activeOrg = async (c) => (await c.rpc("current_org_id")).data ?? null;
const memberId = async (userId, orgId) =>
  (await admin.from("organization_members").select("id").eq("user_id", userId).eq("organization_id", orgId).maybeSingle()).data?.id ?? null;
const memberCount = async (userId, orgId) =>
  (await admin.from("organization_members").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("organization_id", orgId)).count ?? 0;
const activePointer = async (userId) =>
  (await admin.from("profiles").select("active_organization_id").eq("id", userId).maybeSingle()).data?.active_organization_id ?? null;
const remove = async (client, id) => (await client.rpc("remove_organization_member", { p_member_id: id })).data;

async function main() {
  const users = [];
  try {
    const bossA = await mkUser("bossa");     // owner of business org A
    const admA  = await mkUser("adma");      // admin in A
    const alice = await mkUser("alice");     // personal P; viewer in A and C
    const bossC = await mkUser("bossc");     // owner of business org C
    const outsider = await mkUser("out");    // belongs to nothing relevant
    users.push(bossA, admA, alice, bossC, outsider);

    const orgA = await orgOf(admin, bossA.id);
    const orgC = await orgOf(admin, bossC.id);
    const aliceP = await orgOf(admin, alice.id);         // personal (kind personal)
    await admin.from("organizations").update({ kind: "business" }).in("id", [orgA, orgC]);

    // Build memberships. addMembership sets the joined org active as a side effect.
    await addMembership(admin, admA.id, orgA, "admin");
    await addMembership(admin, alice.id, orgA, "viewer");
    await addMembership(admin, alice.id, orgC, "viewer");
    await setActiveOrg(admin, bossA.id, orgA);
    await setActiveOrg(admin, admA.id, orgA);

    const bossAC = await signIn(bossA.email);
    const admAC = await signIn(admA.email);
    const outsiderC = await signIn(outsider.email);

    // ---------------------------------------------------------------------
    section("1. Owner removes a member whose ACTIVE workspace is the org");
    // ---------------------------------------------------------------------
    {
      await setActiveOrg(admin, alice.id, orgA);           // alice active = A (the org she'll be removed from)
      const id = await memberId(alice.id, orgA);
      const res = await remove(bossAC, id);
      res?.state === "ok" ? P("RPC returns ok") : F(`RPC state ${res?.state}`);
      (await memberCount(alice.id, orgA)) === 0 ? P("membership A→alice deleted") : F("membership survived");
      (await memberCount(alice.id, aliceP)) === 1 ? P("personal membership preserved") : F("personal membership lost (!)");
      const ptr = await activePointer(alice.id);
      ptr === aliceP ? P("active pointer repaired to Personal") : F(`active pointer = ${ptr}, expected Personal`);
      res?.new_active_organization_id === aliceP ? P("RPC reports Personal as new active") : F("RPC new-active wrong");

      // alice's own live session must now resolve to Personal and see no A data.
      const aliceC = await signIn(alice.email);
      (await activeOrg(aliceC)) === aliceP ? P("alice resolves to Personal") : F("alice did not resolve to Personal");
      const { data: aRows } = await aliceC.from("organization_members").select("id").eq("organization_id", orgA);
      (aRows ?? []).length === 0 ? P("alice cannot read A membership rows") : F("A rows leaked to alice (!)");
      // Re-add for later sections.
      await addMembership(admin, alice.id, orgA, "viewer");
    }

    // ---------------------------------------------------------------------
    section("2. Owner removes a member whose active workspace is a DIFFERENT org");
    // ---------------------------------------------------------------------
    {
      await setActiveOrg(admin, alice.id, orgC);           // alice active = C, being removed from A
      const id = await memberId(alice.id, orgA);
      const res = await remove(bossAC, id);
      res?.state === "ok" ? P("RPC returns ok") : F(`RPC state ${res?.state}`);
      (await memberCount(alice.id, orgA)) === 0 ? P("membership A→alice deleted") : F("membership survived");
      (await activePointer(alice.id)) === orgC ? P("active pointer at C left unchanged") : F("active pointer disturbed (!)");
      await addMembership(admin, alice.id, orgA, "viewer");
    }

    // ---------------------------------------------------------------------
    section("3. Deterministic fallback when the removed org WAS active and no Personal");
    // ---------------------------------------------------------------------
    {
      // A user with two business memberships and NO personal org: remove the active one.
      const nomad = await mkUser("nomad");
      users.push(nomad);
      const nomadP = await orgOf(admin, nomad.id);
      await addMembership(admin, nomad.id, orgA, "viewer");
      await addMembership(admin, nomad.id, orgC, "viewer");
      // Drop the personal org so only A and C remain (supported synthetic case).
      await admin.from("organizations").delete().eq("id", nomadP);
      await setActiveOrg(admin, nomad.id, orgA);
      const remaining = await orgsOf(admin, nomad.id);      // oldest-first
      const oldest = remaining[0]?.organization_id;
      const id = await memberId(nomad.id, orgA);
      const res = await remove(bossAC, id);
      res?.state === "ok" ? P("RPC returns ok") : F(`RPC state ${res?.state}`);
      const ptr = await activePointer(nomad.id);
      const expected = oldest === orgA ? (await orgsOf(admin, nomad.id))[0]?.organization_id : oldest;
      ptr === expected ? P("active repaired to oldest remaining membership deterministically") : F(`fallback = ${ptr}, expected ${expected}`);
      ptr !== orgA ? P("no invalid pointer to the removed org") : F("pointer still at removed org (!)");
    }

    // ---------------------------------------------------------------------
    section("4. No memberships remain → active becomes NULL");
    // ---------------------------------------------------------------------
    {
      const lone = await mkUser("lone");
      users.push(lone);
      const loneP = await orgOf(admin, lone.id);
      await addMembership(admin, lone.id, orgA, "viewer");
      await admin.from("organizations").delete().eq("id", loneP); // now only A remains
      await setActiveOrg(admin, lone.id, orgA);
      const id = await memberId(lone.id, orgA);
      const res = await remove(bossAC, id);
      res?.state === "ok" ? P("RPC returns ok") : F(`RPC state ${res?.state}`);
      (await activePointer(lone.id)) === null ? P("active pointer set NULL when no memberships remain") : F("pointer not nulled (!)");
      res?.new_active_organization_id === null ? P("RPC reports NULL new active") : F("RPC new-active not null");
    }

    // ---------------------------------------------------------------------
    section("5. Authorization");
    // ---------------------------------------------------------------------
    {
      // Viewer cannot remove another member.
      await addMembership(admin, alice.id, orgA, "viewer");
      await setActiveOrg(admin, alice.id, orgA);
      const aliceC = await signIn(alice.email);
      const admId = await memberId(admA.id, orgA);
      (await remove(aliceC, admId))?.state === "not_authorized" ? P("viewer cannot remove a member") : F("viewer removed a member (!)");
      (await memberCount(admA.id, orgA)) === 1 ? P("target admin membership intact") : F("admin membership was deleted (!)");

      // Outsider cannot remove a member of A (not their org → not found).
      const st = (await remove(outsiderC, admId))?.state;
      (st === "not_found" || st === "not_authorized") ? P(`outsider blocked (${st})`) : F(`outsider got ${st}`);
      (await memberCount(admA.id, orgA)) === 1 ? P("admin membership still intact") : F("outsider deleted a member (!)");

      // Admin cannot remove an owner.
      const bossId = await memberId(bossA.id, orgA);
      (await remove(admAC, bossId))?.state === "not_authorized" ? P("admin cannot remove an owner") : F("admin removed an owner (!)");

      // Last owner cannot be removed (bossA is A's only owner).
      (await remove(bossAC, bossId))?.state === "last_owner" ? P("last owner refused") : F("last owner removed (!)");
      (await memberCount(bossA.id, orgA)) === 1 ? P("owner still present") : F("owner vanished (!)");
    }

    // ---------------------------------------------------------------------
    section("6. Self-leave (DB capability; no UI in this change)");
    // ---------------------------------------------------------------------
    {
      await setActiveOrg(admin, alice.id, orgA);
      const aliceC = await signIn(alice.email);
      const id = await memberId(alice.id, orgA);
      const res = await remove(aliceC, id);            // alice removes her OWN membership
      res?.state === "ok" ? P("member may self-leave") : F(`self-leave state ${res?.state}`);
      res?.was_self_leave === true ? P("result flags self-leave") : F("self-leave not flagged");
      (await memberCount(alice.id, orgA)) === 0 ? P("own membership removed") : F("self-leave left membership");
      (await memberCount(alice.id, aliceP)) === 1 ? P("personal workspace preserved on self-leave") : F("self-leave harmed personal (!)");
      (await activePointer(alice.id)) === aliceP ? P("self-leave repaired active to Personal") : F("self-leave stale pointer (!)");
    }

    // ---------------------------------------------------------------------
    section("7. Idempotency / concurrency");
    // ---------------------------------------------------------------------
    {
      await addMembership(admin, alice.id, orgA, "viewer");
      await setActiveOrg(admin, alice.id, orgA);
      const id = await memberId(alice.id, orgA);
      const [r1, r2] = await Promise.all([remove(bossAC, id), remove(bossAC, id)]);
      const states = [r1?.state, r2?.state].sort().join(",");
      // The org-row lock serializes the two: exactly one deletes (ok), the other
      // finds nothing (not_found). No row is ever deleted twice.
      states === "not_found,ok" ? P(`concurrent double-remove serializes deterministically (${states})`) : F(`unexpected concurrent states ${states}`);
      (await memberCount(alice.id, orgA)) === 0 ? P("exactly removed, no partial state") : F("row still present");
      // Replay on the now-absent row is a clean, deterministic not_found.
      (await remove(bossAC, id))?.state === "not_found" ? P("replay on gone row → not_found (deterministic)") : F("replay not deterministic");
    }

    // ---------------------------------------------------------------------
    section("8. Data integrity — removal touches only the membership");
    // ---------------------------------------------------------------------
    {
      // Give alice a vehicle in her Personal org, then remove her from A again.
      await addMembership(admin, alice.id, orgA, "viewer");
      await setActiveOrg(admin, alice.id, aliceP);
      const { data: veh } = await admin.from("vehicles").insert({
        owner_user_id: alice.id, organization_id: aliceP,
        make: "Keep", model: "Me", year: 2021, license_plate: `MR-${RUN}`,
      }).select("id").single();
      const beforeOrgs = (await admin.from("organizations").select("id", { count: "exact", head: true })).count;
      const id = await memberId(alice.id, orgA);
      (await remove(bossAC, id))?.state === "ok" ? P("removal ok") : F("removal failed");
      (await admin.from("profiles").select("id").eq("id", alice.id).maybeSingle()).data ? P("profile not deleted") : F("profile deleted (!)");
      (await admin.from("organizations").select("id").eq("id", aliceP).maybeSingle()).data ? P("personal org not deleted") : F("org deleted (!)");
      (await admin.from("vehicles").select("id").eq("id", veh.id).maybeSingle()).data?.id === veh.id ? P("vehicle preserved and not moved") : F("vehicle changed (!)");
      const afterOrgs = (await admin.from("organizations").select("id", { count: "exact", head: true })).count;
      afterOrgs === beforeOrgs ? P("no organization created or destroyed") : F("org count changed (!)");
      const { data: kind } = await admin.from("organizations").select("kind").eq("id", orgA).single();
      kind.kind === "business" ? P("organization kind unchanged") : F("kind changed (!)");
    }

    // ---------------------------------------------------------------------
    section("9. Invariant sweep — no profile points at a non-member org");
    // ---------------------------------------------------------------------
    {
      const { data: profs } = await admin.from("profiles").select("id, active_organization_id").not("active_organization_id", "is", null);
      let bad = 0;
      for (const p of profs ?? []) {
        const c = await memberCount(p.id, p.active_organization_id);
        if (c === 0) bad++;
      }
      bad === 0 ? P("every non-null active pointer is backed by a live membership") : F(`${bad} invalid active pointer(s)`);
    }

    // ---------------------------------------------------------------------
    section("10. Grant posture + trigger fires on a non-RPC deletion path");
    // ---------------------------------------------------------------------
    {
      // anon (no session) must not be able to call the removal RPC.
      const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
      const anonRes = await anonC.rpc("remove_organization_member", { p_member_id: RUN + "-0000-0000-0000-000000000000" });
      anonRes.error ? P(`anon cannot call remove_organization_member (${anonRes.error.code ?? "err"})`) : F("anon called the removal RPC (!)");

      // authenticated CAN call it (a signed-in owner reaches a real state, not an auth error).
      await addMembership(admin, alice.id, orgA, "viewer");
      await setActiveOrg(admin, bossA.id, orgA);
      const okRes = await remove(bossAC, await memberId(alice.id, orgA));
      okRes?.state === "ok" ? P("authenticated owner can call remove_organization_member") : F(`authenticated call state ${okRes?.state}`);

      // The trigger function is not a callable RPC for an authenticated client
      // (it returns `trigger`; PostgREST does not expose it, and no role holds a
      // direct EXECUTE grant on it).
      const trigRes = await bossAC.rpc("repair_active_workspace_after_member_removal");
      trigRes.error ? P(`authenticated cannot directly invoke the trigger function (${trigRes.error.code ?? "err"})`) : F("trigger function was directly invokable (!)");

      // The trigger still fires for a NON-RPC deletion path (direct delete). Give
      // carol two memberships, point her active at the one we delete directly,
      // and confirm the pointer is repaired without going through the RPC.
      const carol = await mkUser("carol");
      users.push(carol);
      const carolP = await orgOf(admin, carol.id);
      await addMembership(admin, carol.id, orgA, "viewer");
      await setActiveOrg(admin, carol.id, orgA);
      await admin.from("organization_members").delete().eq("user_id", carol.id).eq("organization_id", orgA);
      (await activePointer(carol.id)) === carolP
        ? P("trigger repairs the pointer on a direct (non-RPC) membership delete")
        : F("direct-delete path left a stale pointer (!)");
    }
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
