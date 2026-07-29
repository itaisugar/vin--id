#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Fleet Lite — organization members + invitations validation.
 *
 * Exercises membership authorization, the invitation lifecycle and member
 * management under REAL per-persona JWT sessions. The service role is used ONLY
 * to create users and to build/inspect fixtures — never to make an
 * access-control assertion, because a service-role client bypasses RLS and would
 * prove nothing.
 *
 * SECRETS: no key, no raw invitation token and no token hash is ever printed.
 * Tokens are generated here, hashed, and referenced only by an opaque handle.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. Cleans up every fixture it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run validate:organization-members
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cleanupUsers,
  joinOrg,
  orgOf,
  personalOrgsOf,
  roleOf,
  setProfileCache,
  setRole,
} from "./lib/org-fixtures.mjs";

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
const PDF = Buffer.from("%PDF-1.4\n%dummy\n");
const BUCKET = "vehicle-documents";

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

const sha = (raw) => createHash("sha256").update(raw).digest("hex");
/** Mint a raw invitation token + its hash. Neither is ever logged. */
const mintToken = () => { const raw = randomBytes(32).toString("base64url"); return { raw, hash: sha(raw) }; };

/** Insert an invitation directly (service role) for the abuse-case fixtures. */
async function seedInvitation(orgId, email, role, invitedBy, overrides = {}) {
  const { raw, hash } = mintToken();
  const { data, error } = await admin
    .from("organization_invitations")
    .insert({ organization_id: orgId, email, role, token_hash: hash, invited_by: invitedBy, ...overrides })
    .select("id").single();
  if (error) throw new Error(`seedInvitation: ${error.message}`);
  return { raw, hash, id: data.id };
}

const preview = async (client, raw) => (await client.rpc("get_invitation_preview", { p_token_hash: sha(raw) })).data;
const accept = async (client, raw) => (await client.rpc("accept_invitation", { p_token_hash: sha(raw) })).data;

async function main() {
  const aOwner = await mkUser("a-owner");
  const aAdmin = await mkUser("a-admin");
  const aFleet = await mkUser("a-fleet");
  const aViewer = await mkUser("a-viewer");
  const bOwner = await mkUser("b-owner");
  const invExisting = await mkUser("inv-existing");
  const invNew = await mkUser("inv-new");
  const wrongMail = await mkUser("wrong-mail");
  const removed = await mkUser("removed");
  const users = [aOwner, aAdmin, aFleet, aViewer, bOwner, invExisting, invNew, wrongMail, removed];

  try {
    const orgA = await orgOf(admin, aOwner.id);
    const orgB = await orgOf(admin, bOwner.id);

    // ==================================================== signup + migration
    section("Signup and migration");
    orgA && orgB && orgA !== orgB
      ? P("signup created a distinct organization per user")
      : F("signup organizations missing or shared");
    (await roleOf(admin, aOwner.id)) === "owner"
      ? P("signup created an OWNER membership") : F("signup membership is not owner");
    {
      const { data } = await admin.rpc("org_owner_count", { p_org: orgA });
      data === 1 ? P("every active organization has an owner") : F(`owner count=${data}`);
    }
    {
      // A user may now belong to several organizations, so a membership in a
      // SECOND organization is legitimate. What must still be impossible is a
      // duplicate membership in the SAME organization — that is what makes
      // invitation replay idempotent at the database level.
      const { error: sameOrg } = await admin.from("organization_members")
        .insert({ organization_id: orgA, user_id: aOwner.id, role: "viewer" });
      sameOrg
        ? P("duplicate membership in the SAME organization: rejected")
        : F("duplicate membership in one organization allowed (!)");

      const { error: otherOrg } = await admin.from("organization_members")
        .insert({ organization_id: orgB, user_id: aOwner.id, role: "viewer" });
      !otherOrg
        ? P("membership in a SECOND organization: allowed")
        : F(`second-organization membership rejected: ${otherOrg.message}`);
      // Leave the fixture as it was: this user is org A's owner elsewhere.
      await admin.from("organization_members").delete()
        .eq("user_id", aOwner.id).eq("organization_id", orgB);
    }

    await joinOrg(admin, aAdmin.id, orgA, "admin");
    await joinOrg(admin, aFleet.id, orgA, "fleet_manager");
    await joinOrg(admin, aViewer.id, orgA, "viewer");
    await joinOrg(admin, removed.id, orgA, "fleet_manager");

    const ownerC = await signIn(aOwner.email);
    const adminC = await signIn(aAdmin.email);
    const fleetC = await signIn(aFleet.email);
    const viewerC = await signIn(aViewer.email);
    const bC = await signIn(bOwner.email);
    const removedC = await signIn(removed.email);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    // ============================================ profile cache is not authority
    section("Profile cache grants nothing");
    {
      const orphan = await mkUser("orphan");
      users.push(orphan);
      await admin.from("organizations").delete().eq("id", await orgOf(admin, orphan.id));
      await setProfileCache(admin, orphan.id, { organizationId: orgA, role: "owner" });
      const orphanC = await signIn(orphan.email);
      const { data: rows } = await orphanC.from("vehicles").select("id");
      (rows ?? []).length === 0
        ? P("profile references org A without membership: no access")
        : F("profile cache alone granted access (!)");
      const { data: mem } = await orphanC.rpc("list_organization_members");
      (mem ?? []).length === 0
        ? P("profile says owner, no membership: member list denied")
        : F("orphan profile listed members (!)");
    }
    {
      await setProfileCache(admin, aViewer.id, { role: "owner" });
      const { data: mem } = await viewerC.rpc("list_organization_members");
      (mem ?? []).length === 0
        ? P("profile says owner but membership says viewer: viewer permissions apply")
        : F("stale profile role escalated a viewer (!)");
      const { error } = await viewerC.from("vehicles")
        .insert({ make: "X", model: "Y", year: 2020, owner_user_id: aViewer.id });
      error ? P("stale owner cache grants a viewer no fleet writes") : F("viewer wrote with stale cache (!)");
      await setProfileCache(admin, aViewer.id, { role: "viewer" });
    }

    // ===================================================== invitation creation
    section("Invitation creation");
    const inviteAs = async (client, uid, email, role = "viewer") =>
      client.from("organization_invitations").insert({
        organization_id: orgA, email, role, token_hash: mintToken().hash, invited_by: uid,
      });
    {
      const { error } = await inviteAs(ownerC, aOwner.id, `own-${RUN}@example.test`);
      !error ? P("owner creates an invitation") : F(`owner invite rejected: ${error.message}`);
      const { error: e2 } = await inviteAs(adminC, aAdmin.id, `adm-${RUN}@example.test`);
      !e2 ? P("admin creates an invitation") : F(`admin invite rejected: ${e2.message}`);
    }
    for (const [label, client, uid] of [["fleet_manager", fleetC, aFleet.id], ["viewer", viewerC, aViewer.id]]) {
      const { error } = await inviteAs(client, uid, `${label}-${RUN}@example.test`);
      error ? P(`${label} cannot create invitations`) : F(`${label} created an invitation (!)`);
    }
    {
      const { error } = await inviteAs(bC, bOwner.id, `cross-${RUN}@example.test`);
      error ? P("cross-org caller cannot invite into org A") : F("cross-org invite allowed (!)");
    }
    {
      const { error } = await admin.from("organization_invitations")
        .insert({ organization_id: orgA, email: "   ", role: "viewer", token_hash: mintToken().hash });
      error ? P("blank email rejected by CHECK constraint") : F("blank email accepted (!)");
    }
    for (const badRole of ["owner", "superuser"]) {
      const { error } = await admin.from("organization_invitations").insert({
        organization_id: orgA, email: `bad-${badRole}-${RUN}@example.test`, role: badRole, token_hash: mintToken().hash });
      error ? P(`invitation role="${badRole}" rejected`) : F(`invitation role="${badRole}" accepted (!)`);
    }
    {
      const email = `dupe-${RUN}@example.test`;
      await seedInvitation(orgA, email, "viewer", aOwner.id);
      const { error } = await admin.from("organization_invitations")
        .insert({ organization_id: orgA, email, role: "viewer", token_hash: mintToken().hash });
      error ? P("duplicate PENDING invitation for the same address: rejected") : F("duplicate pending invite allowed (!)");
    }
    {
      const email = `rawcheck-${RUN}@example.test`;
      const { raw } = await seedInvitation(orgA, email, "viewer", aOwner.id);
      const { data } = await admin.from("organization_invitations").select("token_hash").eq("email", email).single();
      data.token_hash !== raw && data.token_hash === sha(raw) && data.token_hash.length === 64
        ? P("only the sha256 hash is stored; the raw token is not in the database")
        : F("raw token found in the database (!)");
    }

    // ================================================================ preview
    section("Invitation preview");
    const valid = await seedInvitation(orgA, invExisting.email, "fleet_manager", aOwner.id);
    const expired = await seedInvitation(orgA, `exp-${RUN}@example.test`, "viewer", aOwner.id,
      { expires_at: new Date(Date.now() - 86400e3).toISOString() });
    const revoked = await seedInvitation(orgA, `rev-${RUN}@example.test`, "viewer", aOwner.id,
      { status: "revoked", revoked_at: new Date().toISOString() });
    {
      const pv = await preview(anon, valid.raw);
      pv?.state === "valid" ? P("preview (anon): valid invitation") : F(`preview valid -> ${pv?.state}`);
      pv?.organization_name && pv?.role && pv?.email_masked
        ? P("preview returns organization name, role and a masked email") : F("preview payload incomplete");
      !JSON.stringify(pv ?? {}).includes(valid.hash)
        ? P("preview never exposes the token hash") : F("preview leaked the token hash (!)");
      pv?.email_masked && !pv.email_masked.includes(invExisting.email.split("@")[0])
        ? P("preview masks the invited address") : F("preview exposed the full invited address (!)");
      Object.keys(pv ?? {}).every((k) => ["state", "organization_name", "role", "email_masked", "expires_at"].includes(k))
        ? P("preview exposes no organization data beyond the display name")
        : F(`preview exposed extra keys: ${Object.keys(pv ?? {})}`);

      (await preview(anon, "not-a-real-token"))?.state === "invalid" ? P("preview: invalid token") : F("preview invalid");
      (await preview(anon, expired.raw))?.state === "expired" ? P("preview: expired") : F("preview expired");
      (await preview(anon, revoked.raw))?.state === "revoked" ? P("preview: revoked") : F("preview revoked");

      const { count } = await admin.from("organization_members")
        .select("id", { count: "exact", head: true }).eq("user_id", invExisting.id).eq("organization_id", orgA);
      count === 0 ? P("preview creates no membership") : F("preview created a membership (!)");
      const peek = await signIn(invExisting.email);
      const { data: veh } = await peek.from("vehicles").select("id").eq("organization_id", orgA);
      (veh ?? []).length === 0 ? P("preview grants no organization access") : F("preview granted access (!)");
    }

    // ============================================================= acceptance
    section("Invitation acceptance");
    {
      // Two independent defenses, either of which is a pass: `anon` holds no
      // EXECUTE grant on accept_invitation (so the call errors outright), and
      // the function itself returns 'not_authenticated' when auth.uid() is null.
      const { data, error } = await anon.rpc("accept_invitation", { p_token_hash: sha(valid.raw) });
      error || data?.state === "not_authenticated"
        ? P(`accept: unauthenticated rejected (${error ? "no EXECUTE grant for anon" : "not_authenticated"})`)
        : F(`accept: anon not rejected -> ${JSON.stringify(data)}`);
    }
    {
      const wrongC = await signIn(wrongMail.email);
      (await accept(wrongC, valid.raw))?.state === "email_mismatch"
        ? P("accept: wrong email rejected") : F("accept: wrong email not rejected");
    }
    {
      const c = await signIn(invNew.email);
      (await accept(c, expired.raw))?.state === "expired" ? P("accept: expired rejected") : F("accept: expired not rejected");
      (await accept(c, revoked.raw))?.state === "revoked" ? P("accept: revoked rejected") : F("accept: revoked not rejected");
      (await accept(c, "bogus-token"))?.state === "invalid" ? P("accept: invalid token rejected") : F("accept: invalid not rejected");
    }

    const invC = await signIn(invExisting.email);
    {
      const ok = await accept(invC, valid.raw);
      ok?.state === "ok" && ok.organization_id === orgA
        ? P("accept: matching existing user succeeds") : F(`accept existing -> ${ok?.state}`);
      (await roleOf(admin, invExisting.id)) === "fleet_manager"
        ? P("accept: the invited role is assigned") : F("accept: wrong role assigned");
      // Exactly one membership IN THE INVITING ORGANIZATION. The invitee also
      // keeps their personal workspace — that is the point of the change, and
      // it is asserted immediately below.
      const { count } = await admin.from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", invExisting.id).eq("organization_id", orgA);
      count === 1 ? P("accept: exactly one membership in the inviting org") : F(`accept produced ${count} memberships in org A`);

      const kept = await personalOrgsOf(admin, invExisting.id);
      kept.length === 1
        ? P("accept: the invitee KEEPS their personal workspace")
        : F(`accept left ${kept.length} personal workspaces (expected 1)`);
      const { data } = await admin.from("organization_invitations").select("status, accepted_by").eq("id", valid.id).single();
      data.status === "accepted" && data.accepted_by === invExisting.id
        ? P("accept: consumption + membership are atomic (status + accepted_by set)") : F("invitation not consumed");
      (await accept(invC, valid.raw))?.state === "accepted"
        ? P("accept: replay of a consumed invitation rejected") : F("replay not rejected (!)");
      (await preview(anon, valid.raw))?.state === "accepted"
        ? P("preview: already-accepted invitation") : F("accepted preview wrong");
    }

    const orgVehicle = (await ownerC.from("vehicles")
      .insert({ make: "Org", model: "A", year: 2021, owner_user_id: aOwner.id }).select("id").single()).data.id;
    {
      const { data: seen } = await invC.from("vehicles").select("id").eq("id", orgVehicle);
      (seen ?? []).length === 1 ? P("organization access begins only after acceptance") : F("accepted member cannot see org vehicles (!)");
    }
    {
      const target = await mkUser("conc");
      users.push(target);
      const inv = await seedInvitation(orgA, target.email, "viewer", aOwner.id);
      const c = await signIn(target.email);
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => accept(c, inv.raw)));
      const okCount = results.filter((r) => r?.state === "ok").length;
      const { count } = await admin.from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", target.id).eq("organization_id", orgA);
      okCount === 1 && count === 1
        ? P("concurrent acceptance creates exactly one membership in the org")
        : F(`concurrent acceptance: ok=${okCount} memberships in org A=${count}`);
    }
    {
      const inv = await seedInvitation(orgA, invNew.email, "viewer", aOwner.id);
      const c = await signIn(invNew.email);
      (await accept(c, inv.raw))?.state === "ok" ? P("accept: matching new user succeeds") : F("new user acceptance failed");
      (await roleOf(admin, invNew.id)) === "viewer" ? P("accept: new user receives the invited role") : F("new user got the wrong role");
    }

    // ====================================================== member management
    section("Member management");
    {
      const { data: m1 } = await ownerC.rpc("list_organization_members");
      (m1 ?? []).length > 0 ? P("owner lists members") : F("owner cannot list members");
      const { data: m2 } = await adminC.rpc("list_organization_members");
      (m2 ?? []).length > 0 ? P("admin lists members") : F("admin cannot list members");
      const { data: m3 } = await fleetC.rpc("list_organization_members");
      (m3 ?? []).length === 0 ? P("fleet_manager cannot list members") : F("fleet_manager listed members (!)");
      const { data: m4 } = await viewerC.rpc("list_organization_members");
      (m4 ?? []).length === 0 ? P("viewer cannot list members") : F("viewer listed members (!)");
    }
    const memberRow = async (userId) =>
      (await admin.from("organization_members").select("id").eq("user_id", userId).single()).data.id;
    {
      const id = await memberRow(aViewer.id);
      const { data } = await ownerC.from("organization_members").update({ role: "fleet_manager" }).eq("id", id).select("id");
      (data ?? []).length === 1 ? P("owner changes an allowed role") : F("owner role change refused");
      await ownerC.from("organization_members").update({ role: "viewer" }).eq("id", id);
    }
    {
      const id = await memberRow(aFleet.id);
      const { data } = await adminC.from("organization_members").update({ role: "viewer" }).eq("id", id).select("id");
      (data ?? []).length === 1 ? P("admin changes an allowed non-owner role") : F("admin role change refused");
      await adminC.from("organization_members").update({ role: "fleet_manager" }).eq("id", id);
    }
    {
      const ownerId = await memberRow(aOwner.id);
      const { data } = await adminC.from("organization_members").update({ role: "viewer" }).eq("id", ownerId).select("id");
      (data ?? []).length === 0 ? P("admin cannot demote an owner") : F("admin demoted an owner (!)");
      const { data: del } = await adminC.from("organization_members").delete().eq("id", ownerId).select("id");
      (del ?? []).length === 0 ? P("admin cannot remove an owner") : F("admin removed an owner (!)");
      const viewerId = await memberRow(aViewer.id);
      const { data: promo } = await adminC.from("organization_members").update({ role: "owner" }).eq("id", viewerId).select("id");
      (promo ?? []).length === 0 ? P("admin cannot create an owner") : F("admin created an owner (!)");
    }
    for (const [label, client] of [["fleet_manager", fleetC], ["viewer", viewerC]]) {
      const id = await memberRow(removed.id);
      const { data } = await client.from("organization_members").update({ role: "viewer" }).eq("id", id).select("id");
      (data ?? []).length === 0 ? P(`${label} cannot change roles`) : F(`${label} changed a role (!)`);
      const { data: d2 } = await client.from("organization_members").delete().eq("id", id).select("id");
      (d2 ?? []).length === 0 ? P(`${label} cannot remove members`) : F(`${label} removed a member (!)`);
    }
    {
      const id = await memberRow(aFleet.id);
      const { data } = await bC.from("organization_members").update({ role: "viewer" }).eq("id", id).select("id");
      (data ?? []).length === 0 ? P("cross-org caller cannot manage org A members") : F("cross-org member change allowed (!)");
    }
    {
      const ownerId = await memberRow(aOwner.id);
      const { error: demote } = await ownerC.from("organization_members").update({ role: "admin" }).eq("id", ownerId);
      demote ? P("final owner cannot be demoted") : F("final owner demoted (!)");
      const { error: del } = await ownerC.from("organization_members").delete().eq("id", ownerId);
      del ? P("final owner cannot be removed") : F("final owner removed (!)");
    }

    // ====================================================== document access
    section("Document access regression");
    const docPath = `${aOwner.id}/${orgVehicle}/${randomUUID()}/doc.pdf`;
    {
      const up = await ownerC.storage.from(BUCKET).upload(docPath, PDF, { contentType: "application/pdf" });
      !up.error ? P("owner uploads an organization document") : F(`owner upload: ${up.error?.message}`);
      await ownerC.from("vehicle_documents").insert({
        id: docPath.split("/")[2], vehicle_id: orgVehicle, owner_user_id: aOwner.id,
        doc_type: "insurance", file_name: "doc.pdf", storage_path: docPath, mime_type: "application/pdf" });

      const sign = async (c) => (await c.storage.from(BUCKET).createSignedUrl(docPath, 60));
      (await sign(invC)).data?.signedUrl ? P("newly accepted member can open organization documents") : F("new member denied document access (!)");
      (await sign(viewerC)).data?.signedUrl ? P("viewer retains read-only document access") : F("viewer denied document read");
      !(await sign(bC)).data?.signedUrl ? P("another organization cannot open the document") : F("cross-org document access (!)");
      !(await sign(anon)).data?.signedUrl ? P("anon / invitation preview grants no document access") : F("anon signed a URL (!)");
    }

    // Removal takes away future signed URLs; a stale cache does not bring them back.
    {
      const id = await memberRow(removed.id);
      const before = await removedC.storage.from(BUCKET).createSignedUrl(docPath, 60);
      before.data?.signedUrl ? P("member can sign a document URL before removal") : F("member could not sign before removal");

      const { data } = await adminC.from("organization_members").delete().eq("id", id).select("id");
      (data ?? []).length === 1 ? P("admin removes a non-owner member") : F("admin removal refused");

      const after = await removedC.from("vehicles").select("id").eq("id", orgVehicle);
      (after.data ?? []).length === 0 ? P("removed member loses database access") : F("removed member still reads org data (!)");
      const afterSign = await removedC.storage.from(BUCKET).createSignedUrl(docPath, 60);
      !afterSign.data?.signedUrl ? P("removed member cannot create a new signed URL") : F("removed member signed a URL (!)");

      await setProfileCache(admin, removed.id, { organizationId: orgA, role: "owner" });
      const stale = await removedC.from("vehicles").select("id").eq("id", orgVehicle);
      const staleSign = await removedC.storage.from(BUCKET).createSignedUrl(docPath, 60);
      (stale.data ?? []).length === 0 && !staleSign.data?.signedUrl
        ? P("stale profile cache does not restore access after removal") : F("stale cache restored access (!)");
    }

    // A demoted member keeps reads and loses writes.
    {
      await setRole(admin, invExisting.id, "viewer");
      const demotedC = await signIn(invExisting.email);
      const read = await demotedC.storage.from(BUCKET).createSignedUrl(docPath, 60);
      read.data?.signedUrl ? P("demoted member keeps read access") : F("demoted member lost read access");
      const write = await demotedC.from("vehicle_documents").insert({
        vehicle_id: orgVehicle, owner_user_id: invExisting.id, doc_type: "insurance",
        file_name: "x.pdf", mime_type: "application/pdf" });
      write.error ? P("demoted member (viewer) loses document writes") : F("demoted member still writes (!)");
    }

    // ============================================================= revocation
    section("Revocation");
    {
      const target = await mkUser("revoke-target");
      users.push(target);
      const inv = await seedInvitation(orgA, target.email, "viewer", aOwner.id);
      const { data } = await ownerC.from("organization_invitations")
        .update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", inv.id).select("id");
      (data ?? []).length === 1 ? P("owner revokes a pending invitation") : F("revoke refused");
      const c = await signIn(target.email);
      (await accept(c, inv.raw))?.state === "revoked" ? P("revoked invitation cannot be accepted") : F("revoked invitation accepted (!)");
      const { data: veh } = await c.from("vehicles").select("id").eq("id", orgVehicle);
      (veh ?? []).length === 0 ? P("revoked invitation grants no organization access") : F("revoked invitation granted access (!)");
    }
    {
      const { data: f } = await fleetC.from("organization_invitations").select("id");
      (f ?? []).length === 0 ? P("fleet_manager cannot read invitations") : F("fleet_manager read invitations (!)");
      const { data: v } = await viewerC.from("organization_invitations").select("id");
      (v ?? []).length === 0 ? P("viewer cannot read invitations") : F("viewer read invitations (!)");
      const { data: cross } = await bC.from("organization_invitations").select("id");
      (cross ?? []).length === 0 ? P("cross-org caller cannot read org A invitations") : F("cross-org invitation read (!)");
    }
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"}  (${passes} passed)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
