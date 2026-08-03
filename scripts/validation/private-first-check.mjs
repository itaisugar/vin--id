#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Private-first account experience + explicit Business organization creation.
 *
 * Proven at two levels:
 *   1. SOURCE  — the Team & Access page branches on a personal workspace, the
 *                invitation service returns a stable `personalWorkspace` state,
 *                and the migration ships the RPC + the personal invitation guard.
 *   2. DATA    — against local Supabase, using REAL end-user JWTs (not the
 *                service role) wherever an authorization boundary is under test:
 *                signup is personal-only, a Personal owner cannot invite,
 *                create_business_organization() is atomic and data-preserving,
 *                invitation join keeps the personal workspace, switching works,
 *                and tenants stay isolated.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. No secret is printed.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:private-first
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cleanupUsers, orgOf, orgsOf, roleOf } from "./lib/org-fixtures.mjs";

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

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const read = (p) => readFileSync(resolve(repo, p), "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PW = "Test-Passw0rd!";
const RUN = randomBytes(3).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function mkUser(tag) {
  const email = `pf-${tag}-${RUN}@example.test`;
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
const orgKind = async (id) =>
  (await admin.from("organizations").select("kind").eq("id", id).maybeSingle()).data?.kind ?? null;
const activePointer = async (userId) =>
  (await admin.from("profiles").select("active_organization_id").eq("id", userId).maybeSingle()).data?.active_organization_id ?? null;
const memberCount = async (userId, orgId) =>
  (await admin.from("organization_members").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("organization_id", orgId)).count ?? 0;
async function seedVehicle(userId, orgId, make) {
  const { data, error } = await admin.from("vehicles")
    .insert({ make, model: "Model", year: 2022, mileage_unit: "km", operational_status: "active", owner_user_id: userId, organization_id: orgId })
    .select("id").single();
  if (error) throw new Error(`seedVehicle: ${error.message}`);
  return data.id;
}
async function insertInvitation(client, orgId, email, role, invitedBy) {
  const raw = randomBytes(16).toString("base64url");
  return client.from("organization_invitations").insert({
    organization_id: orgId, email, role, token_hash: sha(raw),
    invited_by: invitedBy, expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  }).select("id").maybeSingle();
}

async function main() {
  const users = [];
  try {
    // -------------------------------------------------------------------
    section("1. Source: personal activation branch, stable state, migration");
    // -------------------------------------------------------------------
    {
      const page = code("app/(app)/organization/page.tsx");
      /isPersonalWorkspace\(\)/.test(page) && /organization\.activation/.test(page)
        ? P("Team & Access page branches on isPersonalWorkspace() into the activation view")
        : F("page does not branch into a personal activation view");

      const inv = code("lib/organizations/invitations.ts");
      /isPersonalWorkspace\(\)/.test(inv) && /"personalWorkspace"/.test(inv)
        ? P("createInvitation guards personal workspaces with a stable state")
        : F("createInvitation has no personal-workspace guard");

      const mig = code("supabase/migrations/20260802120000_business_organization_creation.sql");
      /create_business_organization/.test(mig)
        ? P("migration ships create_business_organization()") : F("RPC missing from migration");
      /kind <> 'personal'/.test(mig) && /org_invitations_insert_admin/.test(mig)
        ? P("migration adds the personal-workspace invitation guard to RLS")
        : F("invitation guard missing from migration");
      /grant execute on function public\.create_business_organization\(text\) to authenticated/.test(mig)
        ? P("RPC granted to authenticated (revoked from public/anon)") : F("RPC grants wrong");
    }

    // -------------------------------------------------------------------
    section("2. Signup creates a Personal workspace only");
    // -------------------------------------------------------------------
    const alice = await mkUser("alice");
    users.push(alice);
    const aliceP = await orgOf(admin, alice.id);
    {
      const memberships = await orgsOf(admin, alice.id);
      memberships.length === 1 ? P("new user has exactly one membership") : F(`membership count ${memberships.length}`);
      (await orgKind(aliceP)) === "personal" ? P("that workspace is kind=personal") : F("workspace is not personal");
      memberships[0]?.role === "owner" ? P("the user is its owner") : F("user is not owner of personal");
      (await activePointer(alice.id)) === aliceP ? P("personal workspace is the active pointer") : F("personal not active");

      const aliceC = await signIn(alice.email);
      (await aliceC.rpc("is_personal_workspace")).data === true
        ? P("is_personal_workspace() is true for a fresh user") : F("is_personal_workspace() not true");
      (await aliceC.rpc("current_org_id")).data === aliceP
        ? P("current_org_id() resolves to the personal workspace") : F("current_org_id wrong");
    }

    // Seed a private vehicle so we can prove creation preserves it.
    const aliceCarP = await seedVehicle(alice.id, aliceP, "Kia");

    // -------------------------------------------------------------------
    section("3. A Personal workspace cannot create an invitation");
    // -------------------------------------------------------------------
    {
      const aliceC = await signIn(alice.email);
      const { error } = await insertInvitation(aliceC, aliceP, "someone@example.test", "viewer", alice.id);
      error ? P("personal owner's direct invitation insert is rejected by RLS") : F("personal workspace was allowed to invite (!)");
      const { count } = await admin.from("organization_invitations")
        .select("id", { count: "exact", head: true }).eq("organization_id", aliceP);
      (count ?? 0) === 0 ? P("no invitation row exists for the personal workspace") : F("an invitation row leaked into personal");
    }

    // -------------------------------------------------------------------
    section("4. Explicit Business organization creation (atomic, data-preserving)");
    // -------------------------------------------------------------------
    let bizId;
    {
      const aliceC = await signIn(alice.email);
      const { data, error } = await aliceC.rpc("create_business_organization", { p_name: "  Acme Fleet  " });
      !error && data?.state === "ok" ? P("create_business_organization returns ok") : F(`create failed: ${error?.message ?? data?.state}`);
      bizId = data?.organization_id;
      bizId ? P("a new organization id is returned") : F("no organization id returned");
      (await orgKind(bizId)) === "business" ? P("new organization is kind=business") : F("new org is not business");
      const { data: orgRow } = await admin.from("organizations").select("name").eq("id", bizId).maybeSingle();
      orgRow?.name === "Acme Fleet" ? P("organization name is trimmed and stored") : F(`name stored as ${orgRow?.name}`);
      (await memberCount(alice.id, bizId)) === 1 ? P("caller has an owner membership in the new org") : F("no membership in new org");
      (await roleOf(admin, alice.id, bizId)) === "owner" ? P("that membership is owner") : F("membership is not owner");
      (await activePointer(alice.id)) === bizId ? P("new business org is now the active workspace") : F("active pointer not updated");
      (await aliceC.rpc("current_org_id")).data === bizId ? P("current_org_id() resolves to the new business org") : F("current_org_id not business");

      // Preservation: personal workspace + its membership + its vehicle survive.
      (await memberCount(alice.id, aliceP)) === 1 ? P("personal membership preserved") : F("personal membership lost (!)");
      (await orgKind(aliceP)) === "personal" ? P("personal workspace still kind=personal") : F("personal was reclassified (!)");
      const { data: carRow } = await admin.from("vehicles").select("organization_id").eq("id", aliceCarP).maybeSingle();
      carRow?.organization_id === aliceP ? P("private vehicle still scoped to the personal workspace") : F("vehicle moved (!)");
    }

    // -------------------------------------------------------------------
    section("5. Tenant isolation across the two workspaces");
    // -------------------------------------------------------------------
    {
      const aliceC = await signIn(alice.email); // active = business
      const { data: carsInBiz } = await aliceC.from("vehicles").select("id").eq("id", aliceCarP);
      (carsInBiz ?? []).length === 0 ? P("personal vehicle is invisible while acting in the business org") : F("personal vehicle leaked into business view");
      // Business is empty of vehicles.
      const { data: bizCars } = await aliceC.from("vehicles").select("id");
      (bizCars ?? []).length === 0 ? P("the new business org starts with no vehicles") : F("business org has unexpected vehicles");
    }

    // -------------------------------------------------------------------
    section("6. Duplicate submission does not create duplicate organizations");
    // -------------------------------------------------------------------
    {
      const aliceC = await signIn(alice.email);
      const { data } = await aliceC.rpc("create_business_organization", { p_name: "Acme Fleet" });
      data?.state === "ok" ? P("a repeat same-name create still returns ok") : F(`repeat create state ${data?.state}`);
      data?.organization_id === bizId ? P("the repeat returns the SAME organization (deduplicated)") : F("a duplicate org was created");
      const { count } = await admin.from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("kind", "business").ilike("name", "acme fleet");
      // Only alice's — scope by membership to avoid counting parallel test data.
      const { data: mine } = await admin.from("organization_members").select("organization_id").eq("user_id", alice.id);
      const bizNames = await admin.from("organizations").select("id,name,kind").in("id", (mine ?? []).map((m) => m.organization_id));
      const acmes = (bizNames.data ?? []).filter((o) => o.kind === "business" && o.name.toLowerCase() === "acme fleet");
      acmes.length === 1 ? P("caller owns exactly one 'Acme Fleet' business org") : F(`caller owns ${acmes.length} Acme Fleet orgs`);
      void count;
    }

    // -------------------------------------------------------------------
    section("7. Invalid organization name is rejected");
    // -------------------------------------------------------------------
    {
      const aliceC = await signIn(alice.email);
      (await aliceC.rpc("create_business_organization", { p_name: "   " })).data?.state === "invalid_name"
        ? P("whitespace-only name -> invalid_name") : F("blank name was accepted");
      (await aliceC.rpc("create_business_organization", { p_name: "" })).data?.state === "invalid_name"
        ? P("empty name -> invalid_name") : F("empty name was accepted");
      (await aliceC.rpc("create_business_organization", { p_name: "x".repeat(121) })).data?.state === "invalid_name"
        ? P("over-long name -> invalid_name") : F("over-long name was accepted");
      // A Hebrew name is valid.
      const heRes = (await aliceC.rpc("create_business_organization", { p_name: "צי הבדיקה" })).data;
      heRes?.state === "ok" ? P("a Hebrew organization name is accepted") : F("Hebrew name rejected");
    }

    // -------------------------------------------------------------------
    section("8. Anonymous and missing-profile denial");
    // -------------------------------------------------------------------
    {
      const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
      const anonRes = await anonC.rpc("create_business_organization", { p_name: "Ghost Co" });
      // Denial is either a permission error (EXECUTE is revoked from anon) or the
      // not_authenticated state — both mean anon creates nothing. The stronger
      // outcome (no EXECUTE at all) is the one that actually happens.
      anonRes.error || anonRes.data?.state === "not_authenticated"
        ? P("anon cannot create an organization (no EXECUTE / not_authenticated)")
        : F(`anon create was not denied: ${anonRes.data?.state}`);

      const ghost = await mkUser("ghost");
      users.push(ghost);
      await admin.from("profiles").delete().eq("id", ghost.id);
      const ghostC = await signIn(ghost.email);
      const gr = (await ghostC.rpc("create_business_organization", { p_name: "Ghost Co" })).data;
      gr?.state === "no_profile" ? P("user without a profile -> no_profile") : F(`missing-profile state ${gr?.state}`);
    }

    // -------------------------------------------------------------------
    section("9. Invitation join after personal signup (keeps personal, correct role)");
    // -------------------------------------------------------------------
    {
      const boss = await mkUser("boss");
      users.push(boss);
      const bossP = await orgOf(admin, boss.id);
      // Boss makes a business org, then invites bob into it as viewer.
      const bossC = await signIn(boss.email);
      const bizBoss = (await bossC.rpc("create_business_organization", { p_name: "Boss Fleet" })).data?.organization_id;
      bizBoss ? P("boss created a business org") : F("boss org create failed");

      // Business owner CAN create an invitation (positive control for the guard).
      const bossC2 = await signIn(boss.email); // active = bizBoss
      const raw = randomBytes(16).toString("base64url");
      const { error: invErr } = await bossC2.from("organization_invitations").insert({
        organization_id: bizBoss, email: `pf-bob-${RUN}@example.test`, role: "viewer",
        token_hash: sha(raw), invited_by: boss.id,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
      !invErr ? P("a Business owner CAN create an invitation") : F(`business invite rejected: ${invErr?.message}`);

      const bob = await mkUser("bob");
      users.push(bob);
      const bobP = await orgOf(admin, bob.id);
      await seedVehicle(bob.id, bobP, "Toyota");
      const bobC = await signIn(bob.email);
      const acc = (await bobC.rpc("accept_invitation", { p_token_hash: sha(raw) })).data;
      acc?.state === "ok" ? P("bob accepts the invitation") : F(`accept state ${acc?.state}`);
      (await memberCount(bob.id, bizBoss)) === 1 ? P("bob gains the business membership") : F("bob has no business membership");
      (await memberCount(bob.id, bobP)) === 1 ? P("bob keeps his personal membership") : F("bob lost his personal workspace (!)");
      (await roleOf(admin, bob.id, bizBoss)) === "viewer" ? P("bob's business role matches the invitation (viewer)") : F("bob's role is wrong");
      (await roleOf(admin, bob.id, bobP)) === "owner" ? P("bob is still owner of his personal workspace") : F("bob is no longer personal owner");
      const { count: bobCars } = await admin.from("vehicles").select("id", { count: "exact", head: true }).eq("organization_id", bobP);
      (bobCars ?? 0) === 1 ? P("bob's private vehicle is preserved and unmoved") : F("bob's vehicle moved/lost");

      // Replay is idempotent: the same token, now consumed, reports 'accepted'
      // (the "already a member + still-pending" path is the one that reports ok).
      // Either way, the invariant under test is that NO second membership appears.
      const acc2 = (await bobC.rpc("accept_invitation", { p_token_hash: sha(raw) })).data;
      ["ok", "accepted"].includes(acc2?.state) ? P("replay is a no-op (accepted/ok)") : F(`replay state ${acc2?.state}`);
      (await memberCount(bob.id, bizBoss)) === 1 ? P("replay creates no duplicate membership") : F("replay duplicated membership");

      // -------------------------------------------------------------------
      section("10. Workspace switching + organization-specific roles + isolation");
      // -------------------------------------------------------------------
      const wss = (await bobC.rpc("list_my_workspaces")).data ?? [];
      wss.length === 2 ? P("bob lists exactly two workspaces") : F(`bob lists ${wss.length} workspaces`);
      wss[0]?.kind === "personal" ? P("personal workspace is listed first") : F("personal not first");

      const back = (await bobC.rpc("set_active_organization", { p_organization: bobP })).data;
      back?.state === "ok" ? P("bob switches back to Personal") : F(`switch-to-personal state ${back?.state}`);
      (await bobC.rpc("current_org_id")).data === bobP ? P("current_org_id() now resolves to Personal") : F("did not switch to personal");
      const { data: seesOwnCar } = await bobC.from("vehicles").select("id");
      (seesOwnCar ?? []).length === 1 ? P("in Personal, bob sees his own vehicle again") : F("personal vehicle not visible after switch back");

      const fwd = (await bobC.rpc("set_active_organization", { p_organization: bizBoss })).data;
      fwd?.state === "ok" ? P("bob switches to the Business org") : F("switch-to-business failed");
      const { data: seesBizCar } = await bobC.from("vehicles").select("id");
      (seesBizCar ?? []).length === 0 ? P("in Business, bob no longer sees his personal vehicle (isolation)") : F("personal vehicle leaked into business");

      // A viewer cannot invite even in a Business org (role matrix intact).
      const rawV = randomBytes(16).toString("base64url");
      const { error: vErr } = await bobC.from("organization_invitations").insert({
        organization_id: bizBoss, email: "x@example.test", role: "viewer",
        token_hash: sha(rawV), invited_by: bob.id,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
      vErr ? P("a Business viewer still cannot create invitations") : F("viewer created an invitation (!)");

      // switching to a workspace bob is not a member of is refused.
      const notMine = (await bobC.rpc("set_active_organization", { p_organization: bossP })).data;
      notMine?.state === "not_a_member" ? P("switching to a non-member workspace is refused") : F(`unexpected switch state ${notMine?.state}`);

      // -------------------------------------------------------------------
      section("11. Existing multi-membership fixture resolves correctly");
      // -------------------------------------------------------------------
      // Bob joins a SECOND business org -> personal + 2 business = 3 memberships.
      const raw2 = randomBytes(16).toString("base64url");
      const biz2 = (await (await signIn(boss.email)).rpc("create_business_organization", { p_name: "Boss Fleet Two" })).data?.organization_id;
      await admin.from("organization_invitations").insert({
        organization_id: biz2, email: bob.email, role: "fleet_manager",
        token_hash: sha(raw2), invited_by: boss.id,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
      await bobC.rpc("accept_invitation", { p_token_hash: sha(raw2) });
      const all = (await bobC.rpc("list_my_workspaces")).data ?? [];
      all.length === 3 ? P("bob now lists three workspaces") : F(`bob lists ${all.length}`);
      all.filter((w) => w.kind === "personal").length === 1 ? P("exactly one is personal") : F("personal count wrong");
      (await roleOf(admin, bob.id, biz2)) === "fleet_manager" ? P("bob's role in the 2nd org is fleet_manager (per-membership role)") : F("2nd-org role wrong");
    }
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
