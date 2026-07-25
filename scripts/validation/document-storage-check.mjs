#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Fleet Lite — organization-aware document Storage validation.
 *
 * Exercises the REAL Storage layer (upload + createSignedUrl + remove) under
 * real per-persona JWT sessions, so it validates both database authorization and
 * actual Storage behavior. The service role is used ONLY to create users and to
 * inspect final state — never for an access-control assertion.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. Non-zero exit on any
 * failure. Cleans up the users (and their cascaded rows) it creates.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/validation/document-storage-check.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = "jsthfmgvcdrfzpgkpwvt";
const BUCKET = "vehicle-documents";

if (process.env.FLEET_CHECK_ALLOW !== "1") { console.error("Set FLEET_CHECK_ALLOW=1."); process.exit(2); }
if (!URL || !ANON || !SERVICE) { console.error("Missing SUPABASE_URL/ANON/SERVICE."); process.exit(2); }
if (URL.includes(PROD_REF)) { console.error("Production ref. Aborting."); process.exit(2); }
if (!/127\.0\.0\.1|localhost/.test(URL) && process.env.FLEET_CHECK_ALLOW_REMOTE !== "1") {
  console.error(`Non-local URL ${URL}; set FLEET_CHECK_ALLOW_REMOTE=1 for staging.`); process.exit(2);
}

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PW = "Test-Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\n%dummy\n"); // minimal allowed file

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
const orgOf = async (id) => (await admin.from("profiles").select("organization_id").eq("id", id).single()).data.organization_id;

/** Emulate the app's upload+metadata flow for a persona (client JWT). */
async function uploadDoc(client, uid, vehicleId, { withMeta = true } = {}) {
  const documentId = randomUUID();
  const path = `${uid}/${vehicleId}/${documentId}/file.pdf`;
  const up = await client.storage.from(BUCKET).upload(path, PDF, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, stage: "upload", error: up.error, documentId, path };
  if (withMeta) {
    const ins = await client.from("vehicle_documents").insert({
      id: documentId, vehicle_id: vehicleId, owner_user_id: uid,
      doc_type: "insurance", file_name: "file.pdf", storage_path: path, mime_type: "application/pdf",
    }).select("id").single();
    if (ins.error) return { ok: false, stage: "meta", error: ins.error, documentId, path };
  }
  return { ok: true, documentId, path };
}

async function main() {
  const A = await mkUser("a"), B = await mkUser("b"), D = await mkUser("d"), C = await mkUser("c"), PRIV = await mkUser("priv");
  const users = [A, B, D, C, PRIV];
  try {
    const orgA = await orgOf(A.id);
    await admin.from("profiles").update({ organization_id: orgA, role: "viewer" }).eq("id", B.id);
    await admin.from("profiles").update({ organization_id: orgA, role: "fleet_manager" }).eq("id", D.id);
    await admin.from("profiles").update({ role: "owner" }).eq("id", A.id);

    const aC = await signIn(A.email), bC = await signIn(B.email), dC = await signIn(D.email), cC = await signIn(C.email), pC = await signIn(PRIV.email);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    // Fixtures: an Org A vehicle, an Org C vehicle, a private vehicle.
    const vA = (await aC.from("vehicles").insert({ make: "T", model: "H", year: 2021, owner_user_id: A.id }).select("id").single()).data.id;
    const vP = (await pC.from("vehicles").insert({ make: "T", model: "H", year: 2019, owner_user_id: PRIV.id }).select("id").single()).data.id;

    // ---------- UPLOAD ----------
    const docA = await uploadDoc(aC, A.id, vA);
    docA.ok ? P("A (owner) upload + metadata: succeeds") : F(`A upload: ${docA.stage} ${docA.error?.message}`);
    const docD = await uploadDoc(dC, D.id, vA);
    docD.ok ? P("D (fleet_manager) upload: succeeds") : F(`D upload: ${docD.stage} ${docD.error?.message}`);
    // B viewer: storage insert policy requires is_org_writer -> object upload blocked
    const docB = await uploadDoc(bC, B.id, vA);
    !docB.ok && docB.stage === "upload" ? P("B (viewer) upload: rejected at Storage") : F("B (viewer) upload: allowed (!)");
    // C forged vehicle id (Org A vehicle) with C's own uid prefix: metadata insert must fail (vehicle not in C's org)
    const docCf = await uploadDoc(cC, C.id, vA);
    !docCf.ok && docCf.stage === "meta" ? P("C upload w/ forged Org A vehicle id: metadata rejected") : F("C forged-vehicle upload: metadata allowed (!)");
    // unauthenticated upload
    const anonUp = await anon.storage.from(BUCKET).upload(`${A.id}/${vA}/${randomUUID()}/x.pdf`, PDF, { contentType: "application/pdf" });
    anonUp.error ? P("anon upload: rejected") : F("anon upload: allowed (!)");
    // private user upload (own vehicle) — must still work
    const docPriv = await uploadDoc(pC, PRIV.id, vP);
    docPriv.ok ? P("private user upload: succeeds") : F(`private upload: ${docPriv.stage} ${docPriv.error?.message}`);

    // ---------- READ (signed URL) ----------
    const sign = async (client, path) => (await client.storage.from(BUCKET).createSignedUrl(path, 60));
    const aSign = await sign(aC, docA.path);
    aSign.data?.signedUrl ? P("A createSignedUrl own-org doc: succeeds") : F(`A sign: ${aSign.error?.message}`);
    const bSign = await sign(bC, docA.path);
    bSign.data?.signedUrl ? P("B (viewer, same org) createSignedUrl: succeeds (the core fix)") : F(`B sign: ${bSign.error?.message}`);
    const dSign = await sign(dC, docA.path);
    dSign.data?.signedUrl ? P("D (fleet_manager, same org) createSignedUrl: succeeds") : F(`D sign: ${dSign.error?.message}`);
    const cSign = await sign(cC, docA.path);
    !cSign.data?.signedUrl ? P("C (other org) createSignedUrl on Org A path: rejected") : F("C signed an Org A object (!)");
    const cGuess = await sign(cC, `${A.id}/${vA}/${randomUUID()}/guess.pdf`);
    !cGuess.data?.signedUrl ? P("C createSignedUrl on guessed arbitrary path: rejected") : F("C signed an arbitrary path (!)");
    const anonSign = await sign(anon, docA.path);
    !anonSign.data?.signedUrl ? P("anon createSignedUrl: rejected") : F("anon signed an object (!)");
    // signed URL actually downloads
    if (aSign.data?.signedUrl) {
      const r = await fetch(aSign.data.signedUrl);
      r.ok ? P("signed URL downloads the file (200)") : F(`signed URL fetch: HTTP ${r.status}`);
    }
    // private user reads own doc
    const pSign = await sign(pC, docPriv.path);
    pSign.data?.signedUrl ? P("private user signs own doc: succeeds") : F(`private sign: ${pSign.error?.message}`);

    // ---------- MEMBERSHIP LOSS ----------
    // Move B out of Org A (Phase 1 model: change profile.organization_id).
    const orphanOrg = (await admin.from("organizations").insert({ name: "solo" }).select("id").single()).data.id;
    await admin.from("profiles").update({ organization_id: orphanOrg, role: "owner" }).eq("id", B.id);
    const bC2 = await signIn(B.email); // fresh session picks up new org
    const bSignAfter = await sign(bC2, docA.path);
    !bSignAfter.data?.signedUrl ? P("membership loss: former member cannot create new signed URL") : F("removed member still signed (!)");
    await bC2.storage.from(BUCKET).remove([docA.path]);
    // remove() returns success with empty data when nothing matched RLS; verify object still exists via admin
    const stillThere = (await admin.storage.from(BUCKET).createSignedUrl(docA.path, 30)).data?.signedUrl;
    stillThere ? P("membership loss: former member's delete did not remove the object") : F("removed member deleted the object (!)");
    // restore B to Org A viewer for later cleanliness (not required)

    // ---------- DELETE ----------
    // viewer delete (via storage) blocked: use a same-org viewer — re-add a viewer
    // D (writer) removes D's own doc object
    await dC.storage.from(BUCKET).remove([docD.path]);
    const dGone = !(await admin.storage.from(BUCKET).createSignedUrl(docD.path, 30)).data?.signedUrl;
    dGone ? P("D (writer) removes an object: succeeds") : F("D writer object removal failed");
    // C (other org) tries to remove Org A object
    await cC.storage.from(BUCKET).remove([docA.path]);
    const aStill = (await admin.storage.from(BUCKET).createSignedUrl(docA.path, 30)).data?.signedUrl;
    aStill ? P("C (other org) cannot remove Org A object") : F("C removed an Org A object (!)");

    // ---------- PASSPORT boundary ----------
    // Public passport snapshot must never carry storage_path; accepted copy has NULL path.
    const raw = randomBytes(16).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const snapshot = {
      meta: { issuer_user_id: A.id },
      vehicle: { vehicle_id: vA, make: "T", model: "H", year: 2021, mileage_unit: "km", status: "active" },
      documents: [{ document_type: "insurance", file_name: "file.pdf", mime_type: "application/pdf", contains_personal_info: true, share_allowed: true, trust_level: "document_backed" }],
    };
    const pass = (await admin.from("vehicle_passports").insert({ owner_user_id: A.id, organization_id: orgA, vehicle_id: vA, status: "active", version: 1, snapshot, snapshot_hash: "x", issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 72 * 3600e3).toISOString() }).select("id").single()).data;
    await admin.from("transfer_tokens").insert({ owner_user_id: A.id, organization_id: orgA, passport_id: pass.id, vehicle_id: vA, token_hash: tokenHash, status: "active", expires_at: new Date(Date.now() + 72 * 3600e3).toISOString() });
    const pub = (await anon.rpc("get_public_passport", { p_token_hash: tokenHash })).data;
    const pubBlob = JSON.stringify(pub);
    !pubBlob.includes("storage_path") ? P("public passport: no storage_path") : F("public passport leaks storage_path");
    !pubBlob.includes(A.id) && !pubBlob.includes(`${A.id}/`) ? P("public passport: no uploader uid / object path") : F("public passport leaks uid/path");
    // buyer accepts -> copied doc has NULL storage_path -> buyer cannot sign a seller file
    const acc = (await cC.rpc("accept_passport", { p_token_hash: tokenHash })).data;
    if (acc?.state === "ok") {
      const copied = (await admin.from("vehicle_documents").select("storage_path").eq("vehicle_id", acc.new_vehicle_id));
      const allNull = (copied.data ?? []).every((d) => d.storage_path === null);
      allNull ? P("passport accept: copied document storage_path is NULL (no seller file)") : F("accepted copy retained a storage_path (!)");
    } else F(`accept_passport state=${acc?.state}`);

    // ---------- AI intake (no record before confirmation) ----------
    // The scan flow persists the document + record only on confirm; a bare upload
    // creates no maintenance/issue row. Assert: an uploaded doc with no confirm
    // leaves zero maintenance/issue rows referencing it.
    const orphanUpload = await uploadDoc(aC, A.id, vA, { withMeta: false });
    orphanUpload.ok ? P("AI-style raw upload (pre-confirm) stays in private bucket") : F("raw upload failed");
    const anonAiSign = await sign(anon, orphanUpload.path);
    !anonAiSign.data?.signedUrl ? P("AI unconfirmed upload: anon cannot access") : F("anon accessed unconfirmed upload (!)");
    const cAiSign = await sign(cC, orphanUpload.path);
    !cAiSign.data?.signedUrl ? P("AI unconfirmed upload: other org cannot access") : F("other org accessed unconfirmed upload (!)");
    const mCount = (await admin.from("maintenance_logs").select("id").eq("vehicle_id", vA)).data?.length ?? 0;
    mCount === 0 ? P("no maintenance record exists before confirmation") : F(`unexpected ${mCount} maintenance rows`);
  } finally {
    for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"}  (${passes} passed)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
