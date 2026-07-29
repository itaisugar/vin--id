#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Multi-workspace tenancy foundation — validation.
 *
 * The whole point of this suite is that a user may now hold SEVERAL
 * memberships, so almost every assertion here would have been impossible to
 * express before: it either could not happen (UNIQUE(user_id)) or it threw.
 *
 * Every access-control assertion runs under a REAL per-persona JWT session. The
 * service role only builds and inspects fixtures — it bypasses RLS, so using it
 * for an authorization assertion would prove nothing.
 *
 * THE SECURITY CLAIM UNDER TEST: `profiles.active_organization_id` is a
 * preference, never evidence. A forged or stale pointer must resolve to the
 * user's own default workspace and never to the pointed-at tenant.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. No key or secret is ever printed. Cleans up every fixture it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:multi-workspace
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  addMembership,
  cleanupUsers,
  orgOf,
  personalOrgsOf,
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
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

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
/** A fresh session — proves a switch survives sign-out/sign-in, not just a cache. */
const reSignIn = signIn;

async function activeOrg(client) {
  const { data } = await client.rpc("current_org_id");
  return data ?? null;
}
async function activeRole(client) {
  const { data } = await client.rpc("current_org_role");
  return data ?? null;
}
async function seedInvitation(orgId, email, role, invitedBy) {
  const raw = randomBytes(32).toString("base64url");
  const { error } = await admin.from("organization_invitations").insert({
    organization_id: orgId, email, role, token_hash: sha256(raw), invited_by: invitedBy,
  });
  if (error) throw new Error(`seedInvitation: ${error.message}`);
  return { raw };
}

async function main() {
  const users = [];
  try {
    const alice = await mkUser("mw-alice");
    const bossA = await mkUser("mw-bossa");
    const bossB = await mkUser("mw-bossb");
    const outsider = await mkUser("mw-out");
    users.push(alice, bossA, bossB, outsider);

    const alicePersonal = await orgOf(admin, alice.id);
    const orgA = await orgOf(admin, bossA.id ?? bossA.id);
    const orgB = await orgOf(admin, bossB.id);
    const outsiderOrg = await orgOf(admin, outsider.id);

    // The two "companies" start life as signup-created personal workspaces;
    // promote them explicitly so the fixture models a real business org.
    await admin.from("organizations").update({ kind: "business" }).in("id", [orgA, orgB]);

    const aliceC = await signIn(alice.email);
    const outsiderC = await signIn(outsider.email);

    // ---------------------------------------------------------------------
    section("1. Existing single-membership user is unaffected");
    // ---------------------------------------------------------------------
    {
      const { data: v } = await admin.from("vehicles").insert({
        owner_user_id: alice.id, organization_id: alicePersonal,
        make: "Alice", model: "Private", year: 2020, license_plate: `MW-${RUN}`,
      }).select("id").single();

      (await activeOrg(aliceC)) === alicePersonal
        ? P("a user with one membership resolves to it (no pointer set)")
        : F("single-membership resolution changed");
      (await activeRole(aliceC)) === "owner" ? P("their role is unchanged") : F("role changed");

      const { data: seen } = await aliceC.from("vehicles").select("id");
      (seen ?? []).length === 1 && seen[0].id === v.id
        ? P("their existing vehicle is still visible")
        : F("existing vehicle became invisible (!)");

      const { data: owner } = await admin.from("vehicles")
        .select("owner_user_id").eq("id", v.id).single();
      owner.owner_user_id === alice.id ? P("ownership is unchanged") : F("ownership changed (!)");

      (await personalOrgsOf(admin, alice.id)).length === 1
        ? P("exactly one personal workspace") : F("wrong number of personal workspaces");
    }

    // ---------------------------------------------------------------------
    // R1 MODE. The R1 release ships M1-M3 only: the additive schema and the
    // multi-membership-safe helpers, with `UNIQUE(user_id)` deliberately still
    // in force. Everything from section 2 onward exercises behaviour that M4-M6
    // introduce, so on an R1 database it would be asserting against code that is
    // not supposed to be there yet.
    //
    // Rather than a second suite that drifts from this one, the suite detects
    // which release it is running against and asserts what that release
    // actually promises. On R1 that promise is a strong one: nothing changed.
    // ---------------------------------------------------------------------
    const { error: probe } = await admin.rpc("list_my_workspaces");
    const isR1 = probe?.code === "PGRST202" || probe?.code === "42883";

    if (isR1) {
      section("R1. Additive schema, unchanged behaviour");
      {
        // M1 — the fact is recorded, and signup records it.
        const { data: personal } = await admin.from("organizations")
          .select("kind").eq("id", alicePersonal).single();
        personal?.kind === "personal"
          ? P("signup records kind='personal' (M1)") : F(`kind is ${personal?.kind}`);

        // M2 — the pointer exists, and is untouched until someone switches.
        const { data: prof } = await admin.from("profiles")
          .select("active_organization_id").eq("id", alice.id).single();
        prof && "active_organization_id" in prof
          ? P("profiles.active_organization_id exists (M2)") : F("M2 column missing");
        prof?.active_organization_id === null
          ? P("it is NULL for an existing user — no backfill") : F("the pointer was backfilled");

        // M4 must NOT have run: this is the whole point of R1.
        const { error: second } = await admin.from("organization_members")
          .insert({ organization_id: orgA, user_id: alice.id, role: "viewer" });
        second?.code === "23505"
          ? P("UNIQUE(user_id) still rejects a second membership (M4 absent)")
          : F(`a second membership was accepted — M4 leaked into R1 (${second?.code})`);

        // M6 must NOT have run.
        const { error: sw } = await admin.rpc("set_active_organization", { p_organization: orgA });
        sw?.code === "PGRST202" || sw?.code === "42883"
          ? P("set_active_organization is absent (M6 absent)") : F("M6 leaked into R1");

        // M3 — resolution is deterministic and a forged pointer grants nothing.
        await setActiveOrg(admin, alice.id, outsiderOrg);
        const c = await reSignIn(alice.email);
        (await activeOrg(c)) === alicePersonal
          ? P("a forged active pointer falls back to her own workspace")
          : F("a forged pointer was honoured (!)");
        const { data: leaked } = await c.from("vehicles")
          .select("id").eq("organization_id", outsiderOrg);
        (leaked ?? []).length === 0
          ? P("and leaks no row from the organization it names") : F("cross-tenant leak (!)");
        await setActiveOrg(admin, alice.id, null);

        const seen = new Set();
        for (let i = 0; i < 5; i++) seen.add(await activeOrg(c));
        seen.size === 1 ? P("resolution is deterministic across calls") : F("resolution varies");
      }

      section("R1. The release boundary is real");
      {
        const held = [
          "20260729150000_membership_cardinality.sql",
          "20260729160000_accept_invitation_multi.sql",
          "20260729170000_switch_workspace.sql",
        ].filter((f) => existsSync(`supabase/migrations/${f}`));
        held.length === 0
          ? P("M4-M6 are absent from the release branch, so db push cannot apply them")
          : F(`M4-M6 present on an R1 branch: ${held.join(", ")}`);

        const kind = readFileSync("supabase/migrations/20260729120000_organization_kind.sql", "utf8");
        /on conflict \(user_id\) do nothing/.test(kind)
          ? P("handle_new_user still targets the constraint that exists")
          : F("signup would break: conflict target names a constraint R1 does not have");
      }

      for (const id of [alicePersonal, orgA, orgB, outsiderOrg].filter(Boolean)) {
        await admin.from("vehicles").delete().eq("organization_id", id);
      }
      // Tear down and report here rather than returning: a bare `return` inside
      // this try/finally would skip the summary below and exit 0 whatever
      // failed. `users` is emptied so the finally block has nothing left to do.
      await cleanupUsers(admin, users);
      users.length = 0;
      console.log(`\n${"=".repeat(64)}`);
      console.log(`Multi-workspace (R1 mode): ${passes} passed, ${fails} failed`);
      console.log("=".repeat(64));
      process.exit(fails === 0 ? 0 : 1);
    }

    // ---------------------------------------------------------------------
    section("2. Personal + Organization A");
    // ---------------------------------------------------------------------
    {
      await addMembership(admin, alice.id, orgA, "fleet_manager");
      const { data: rows } = await admin.from("organization_members")
        .select("organization_id").eq("user_id", alice.id);
      (rows ?? []).length === 2
        ? P("alice holds 2 memberships (impossible before this change)")
        : F(`expected 2 memberships, got ${(rows ?? []).length}`);

      (await personalOrgsOf(admin, alice.id)).length === 1
        ? P("her personal workspace survived the join") : F("personal workspace lost (!)");

      const c = await reSignIn(alice.email);
      (await activeOrg(c)) === orgA
        ? P("the newly joined organization is active") : F("active workspace did not follow the join");
      (await activeRole(c)) === "fleet_manager"
        ? P("her role IN ORG A is fleet_manager") : F("wrong role in org A");
    }

    // ---------------------------------------------------------------------
    section("3. Personal + A + B, a different role in each");
    // ---------------------------------------------------------------------
    {
      await addMembership(admin, alice.id, orgB, "viewer");
      const { data: rows } = await admin.from("organization_members")
        .select("organization_id, role").eq("user_id", alice.id);
      (rows ?? []).length === 3 ? P("alice holds 3 memberships") : F(`got ${(rows ?? []).length}`);

      const roleIn = (id) => (rows ?? []).find((r) => r.organization_id === id)?.role;
      roleIn(alicePersonal) === "owner" && roleIn(orgA) === "fleet_manager" && roleIn(orgB) === "viewer"
        ? P("owner / fleet_manager / viewer — role is per membership, not per user")
        : F(`roles wrong: ${JSON.stringify(rows)}`);
    }

    // ---------------------------------------------------------------------
    section("4. Switching, and what each workspace shows");
    // ---------------------------------------------------------------------
    {
      // A vehicle in each organization, so "what do I see" is answerable.
      await admin.from("vehicles").insert([
        { owner_user_id: bossA.id ?? bossA.id, organization_id: orgA, make: "A", model: "Fleet", year: 2021 },
        { owner_user_id: bossB.id, organization_id: orgB, make: "B", model: "Fleet", year: 2021 },
      ]);

      let c = await reSignIn(alice.email);
      const { data: sw1 } = await c.rpc("set_active_organization", { p_organization: orgA });
      sw1?.state === "ok" ? P("switch to A accepted") : F(`switch to A -> ${sw1?.state}`);
      c = await reSignIn(alice.email);
      const inA = (await c.from("vehicles").select("id, organization_id")).data ?? [];
      inA.length === 1 && inA[0].organization_id === orgA
        ? P("in A she sees only A's vehicle") : F(`in A she saw ${inA.length} vehicles`);
      (await activeRole(c)) === "fleet_manager" ? P("in A she is fleet_manager") : F("wrong role in A");

      const { data: sw2 } = await c.rpc("set_active_organization", { p_organization: orgB });
      sw2?.state === "ok" ? P("switch A -> B accepted") : F(`switch to B -> ${sw2?.state}`);
      c = await reSignIn(alice.email);
      const inB = (await c.from("vehicles").select("id, organization_id")).data ?? [];
      inB.length === 1 && inB[0].organization_id === orgB
        ? P("in B she sees only B's vehicle") : F(`in B she saw ${inB.length} vehicles`);
      (await activeRole(c)) === "viewer" ? P("in B she is viewer") : F("wrong role in B");
      const { data: bWrite } = await c.from("vehicles")
        .update({ current_mileage: 1 }).eq("id", inB[0].id).select("id");
      (bWrite ?? []).length === 0 ? P("as viewer in B she cannot write") : F("viewer wrote in B (!)");

      const { data: sw3 } = await c.rpc("set_active_organization", { p_organization: alicePersonal });
      sw3?.state === "ok" ? P("switch B -> Personal accepted") : F(`switch to personal -> ${sw3?.state}`);
      c = await reSignIn(alice.email);
      const inP = (await c.from("vehicles").select("id, organization_id")).data ?? [];
      inP.length === 1 && inP[0].organization_id === alicePersonal
        ? P("in Personal she sees only her own vehicle") : F(`in Personal she saw ${inP.length}`);
      (await activeRole(c)) === "owner" ? P("in Personal she is owner again") : F("wrong role in personal");

      // Persistence across a completely fresh session.
      const fresh = await reSignIn(alice.email);
      (await activeOrg(fresh)) === alicePersonal
        ? P("the selection persists across sign-out and sign-in") : F("selection did not persist");

      // Switching moved nothing.
      const { count: aCount } = await admin.from("vehicles")
        .select("id", { count: "exact", head: true }).eq("organization_id", orgA);
      aCount === 1 ? P("switching changed no vehicle ownership") : F("vehicles moved (!)");
    }

    // ---------------------------------------------------------------------
    section("5. The pointer is a preference, never evidence");
    // ---------------------------------------------------------------------
    {
      // 5a. FORGED — point at an organization she does not belong to.
      await setActiveOrg(admin, alice.id, outsiderOrg);
      const c = await reSignIn(alice.email);
      const resolved = await activeOrg(c);
      resolved !== outsiderOrg
        ? P("a forged pointer does NOT resolve to the forged tenant")
        : F("FORGED POINTER GRANTED ACCESS (!!)");
      resolved === alicePersonal
        ? P("it falls back to her own personal workspace")
        : F(`forged pointer resolved to ${resolved}`);
      const { data: leaked } = await c.from("vehicles")
        .select("id").eq("organization_id", outsiderOrg);
      (leaked ?? []).length === 0 ? P("no row leaks through a forged pointer") : F("rows leaked (!)");

      // 5b. STALE — a membership that is removed after being selected.
      await setActiveOrg(admin, alice.id, orgB);
      let c2 = await reSignIn(alice.email);
      (await activeOrg(c2)) === orgB ? P("pointer at B is honoured while the membership lives") : F("B not active");
      await admin.from("organization_members").delete()
        .eq("user_id", alice.id).eq("organization_id", orgB);
      c2 = await reSignIn(alice.email);
      (await activeOrg(c2)) !== orgB
        ? P("removing the membership invalidates the pointer immediately")
        : F("STALE POINTER STILL RESOLVES TO B (!!)");
      const { data: staleRows } = await c2.from("vehicles").select("id").eq("organization_id", orgB);
      (staleRows ?? []).length === 0 ? P("and B's rows are gone with it") : F("stale pointer leaked rows (!)");

      // 5c. The RPC refuses outright, and writes nothing.
      const { data: refused } = await c2.rpc("set_active_organization", { p_organization: outsiderOrg });
      refused?.state === "not_a_member" ? P("set_active_organization refuses a non-member org") : F(`-> ${refused?.state}`);
      const { data: prof } = await admin.from("profiles")
        .select("active_organization_id").eq("id", alice.id).single();
      prof.active_organization_id !== outsiderOrg ? P("the refused switch wrote nothing") : F("the refused switch wrote (!)");

      // 5d. No user can set another user's pointer.
      const { data: otherWrite } = await outsiderC.from("profiles")
        .update({ active_organization_id: outsiderOrg }).eq("id", alice.id).select("id");
      (otherWrite ?? []).length === 0 ? P("one user cannot set another's pointer") : F("cross-user pointer write (!)");

      // 5e. The selector never lists an organization the caller cannot access.
      const c3 = await reSignIn(alice.email);
      const { data: ws } = await c3.rpc("list_my_workspaces");
      const listed = (ws ?? []).map((w) => w.organization_id);
      !listed.includes(outsiderOrg) && !listed.includes(orgB)
        ? P("list_my_workspaces omits organizations she is not in")
        : F("the selector listed an inaccessible organization (!)");
      listed.length === 2 ? P("it lists exactly her 2 remaining workspaces") : F(`listed ${listed.length}`);
      (ws ?? [])[0]?.kind === "personal" ? P("personal is listed first") : F("personal is not first");
    }

    // ---------------------------------------------------------------------
    section("6. Invitations under the new model");
    // ---------------------------------------------------------------------
    {
      // A user who owns a vehicle — the exact case that was refused before.
      const joiner = await mkUser("mw-joiner");
      users.push(joiner);
      const joinerPersonal = await orgOf(admin, joiner.id);
      await admin.from("vehicles").insert({
        owner_user_id: joiner.id, organization_id: joinerPersonal,
        make: "Joiner", model: "Private", year: 2019,
      });

      const inv = await seedInvitation(orgA, joiner.email, "viewer", bossA.id ?? bossA.id);
      const jc = await signIn(joiner.email);
      const { data: r1 } = await jc.rpc("accept_invitation", { p_token_hash: sha256(inv.raw) });
      r1?.state === "ok"
        ? P("a user who OWNS A VEHICLE can accept an invitation (was 'already_member')")
        : F(`accept -> ${r1?.state}`);

      (await personalOrgsOf(admin, joiner.id)).length === 1
        ? P("their personal workspace survives") : F("personal workspace destroyed (!)");
      const { count: vCount } = await admin.from("vehicles")
        .select("id", { count: "exact", head: true }).eq("organization_id", joinerPersonal);
      vCount === 1 ? P("their personal vehicle survives") : F("personal vehicle lost (!)");

      // Replay.
      const { data: r2 } = await jc.rpc("accept_invitation", { p_token_hash: sha256(inv.raw) });
      r2?.state === "accepted" ? P("replay reports 'accepted'") : F(`replay -> ${r2?.state}`);
      const { count: mCount } = await admin.from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", joiner.id).eq("organization_id", orgA);
      mCount === 1 ? P("replay created no second membership") : F(`replay produced ${mCount}`);

      // Then a THIRD organization.
      const inv2 = await seedInvitation(orgB, joiner.email, "fleet_manager", bossB.id);
      const { data: r3 } = await jc.rpc("accept_invitation", { p_token_hash: sha256(inv2.raw) });
      r3?.state === "ok" ? P("the same user joins a second organization") : F(`second join -> ${r3?.state}`);
      const { count: total } = await admin.from("organization_members")
        .select("id", { count: "exact", head: true }).eq("user_id", joiner.id);
      total === 3 ? P("they now hold 3 memberships (personal + A + B)") : F(`holds ${total}`);

      // Wrong email / revoked / expired still refused.
      const wrong = await seedInvitation(orgA, `nobody-${RUN}@example.test`, "viewer", bossA.id ?? bossA.id);
      const { data: rw } = await jc.rpc("accept_invitation", { p_token_hash: sha256(wrong.raw) });
      rw?.state === "email_mismatch" ? P("wrong email still refused") : F(`wrong email -> ${rw?.state}`);

      const rev = await seedInvitation(orgB, joiner.email, "viewer", bossB.id);
      await admin.from("organization_invitations").update({ status: "revoked" })
        .eq("token_hash", sha256(rev.raw));
      const { data: rr } = await jc.rpc("accept_invitation", { p_token_hash: sha256(rev.raw) });
      rr?.state === "revoked" ? P("revoked still refused") : F(`revoked -> ${rr?.state}`);

      const exp = await seedInvitation(outsiderOrg, joiner.email, "viewer", outsider.id);
      await admin.from("organization_invitations")
        .update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
        .eq("token_hash", sha256(exp.raw));
      const { data: re } = await jc.rpc("accept_invitation", { p_token_hash: sha256(exp.raw) });
      re?.state === "expired" ? P("expired still refused") : F(`expired -> ${re?.state}`);

      // The role is the inviter's choice, per organization.
      const { data: joinerRoles } = await admin.from("organization_members")
        .select("organization_id, role").eq("user_id", joiner.id);
      const rIn = (id) => (joinerRoles ?? []).find((r) => r.organization_id === id)?.role;
      rIn(orgA) === "viewer" && rIn(orgB) === "fleet_manager"
        ? P("each membership carries the role its inviter chose") : F(`roles: ${JSON.stringify(joinerRoles)}`);
    }

    // ---------------------------------------------------------------------
    section("7. A personal workspace never has two members");
    // ---------------------------------------------------------------------
    {
      const solo = await mkUser("mw-solo");
      const guest = await mkUser("mw-guest");
      users.push(solo, guest);
      const soloPersonal = await orgOf(admin, solo.id);

      const { data: before } = await admin.from("organizations")
        .select("kind").eq("id", soloPersonal).single();
      before.kind === "personal" ? P("a fresh signup workspace is 'personal'") : F(`kind=${before.kind}`);

      const inv = await seedInvitation(soloPersonal, guest.email, "viewer", solo.id);
      const gc = await signIn(guest.email);
      await gc.rpc("accept_invitation", { p_token_hash: sha256(inv.raw) });

      const { data: after } = await admin.from("organizations")
        .select("kind").eq("id", soloPersonal).single();
      after.kind === "business"
        ? P("inviting somebody in promotes it to 'business'")
        : F("a two-member workspace is still labelled personal (!)");
    }

    // ---------------------------------------------------------------------
    section("8. Database invariants");
    // ---------------------------------------------------------------------
    {
      const { data: dupes } = await admin.from("organization_members").select("organization_id, user_id");
      const seen = new Set();
      let dupe = 0;
      for (const r of dupes ?? []) {
        const k = `${r.organization_id}:${r.user_id}`;
        if (seen.has(k)) dupe++;
        seen.add(k);
      }
      dupe === 0 ? P("no duplicate membership anywhere") : F(`${dupe} duplicate membership(s)`);

      const { data: orgs } = await admin.from("organizations").select("id");
      const { data: owners } = await admin.from("organization_members").select("organization_id").eq("role", "owner");
      const ownerSet = new Set((owners ?? []).map((o) => o.organization_id));
      const ownerless = (orgs ?? []).filter((o) => !ownerSet.has(o.id));
      ownerless.length === 0 ? P("every organization has an owner") : F(`${ownerless.length} organization(s) without an owner`);

      const { data: personalMulti } = await admin.from("organizations").select("id").eq("kind", "personal");
      let bad = 0;
      for (const o of personalMulti ?? []) {
        const { count } = await admin.from("organization_members")
          .select("id", { count: "exact", head: true }).eq("organization_id", o.id);
        if (count !== 1) bad++;
      }
      bad === 0 ? P("every personal workspace has exactly one member") : F(`${bad} personal workspace(s) with != 1 member`);

      const { data: nullOrg } = await admin.from("vehicles").select("id").is("organization_id", null);
      (nullOrg ?? []).length === 0 ? P("no vehicle has a NULL organization") : F("NULL organization_id found");
    }

    // ---------------------------------------------------------------------
    section("9. The constraint really changed");
    // ---------------------------------------------------------------------
    {
      const m1 = readFileSync("supabase/migrations/20260729150000_membership_cardinality.sql", "utf8");
      /drop constraint if exists organization_members_user_unique/.test(m1)
        ? P("UNIQUE(user_id) is dropped") : F("the old constraint is not dropped");
      /unique \(organization_id, user_id\)/.test(m1)
        ? P("UNIQUE(organization_id, user_id) replaces it") : F("no per-organization uniqueness added");
      /on conflict \(organization_id, user_id\)/.test(m1)
        ? P("handle_new_user's conflict target is updated in the SAME migration")
        : F("signup would break: conflict target names a dropped constraint");

      const helpers = readFileSync("supabase/migrations/20260729140000_membership_helpers_multi.sql", "utf8");
      (helpers.match(/organization_id = public\.current_org_id\(\)/g) ?? []).length >= 4
        ? P("the role predicates are organization-scoped") : F("a role predicate is not organization-scoped");
      /order by m\.created_at, m\.id/.test(helpers)
        ? P("the fallback is totally ordered (never an arbitrary row)") : F("fallback ordering is not total");
    }

    // Teardown: fleet rows, then organizations, then users.
    const allOrgs = [alicePersonal, orgA, orgB, outsiderOrg].filter(Boolean);
    for (const id of allOrgs) await admin.from("vehicles").delete().eq("organization_id", id);
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Multi-workspace: ${passes} passed, ${fails} failed`);
  console.log("=".repeat(64));
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
