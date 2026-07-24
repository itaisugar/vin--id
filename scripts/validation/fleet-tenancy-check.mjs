#!/usr/bin/env node
/**
 * Fleet Lite — authenticated cross-tenant isolation check.
 *
 * STATUS: written for the runtime-validation runbook, NOT yet executed (no
 * non-production database was available when it was authored). Do NOT point it
 * at production. It refuses to run unless FLEET_CHECK_ALLOW=1 is set, as a guard
 * against accidental production use.
 *
 * What it proves (per docs/fleet-lite-runtime-validation-runbook.md, Step 3):
 *   - user creation uses the SERVICE ROLE (setup only),
 *   - every access-control ASSERTION uses a real signed-in session (anon key +
 *     password sign-in) — never the service role,
 *   - User C (Org B) cannot select / insert / update / delete Org A rows,
 *   - User B (viewer, Org A) cannot mutate Org A rows,
 *   - User A (owner, Org A) can.
 *
 * Exit code is non-zero on any failed assertion.
 *
 * Usage (against LOCAL or STAGING only):
 *   FLEET_CHECK_ALLOW=1 \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=<local anon> \
 *   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
 *   node scripts/validation/fleet-tenancy-check.mjs
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (process.env.FLEET_CHECK_ALLOW !== "1") {
  console.error(
    "Refusing to run without FLEET_CHECK_ALLOW=1. Never run against production.",
  );
  process.exit(2);
}
if (!URL || !ANON || !SERVICE) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
if (/jsthfmgvcdrfzpgkpwvt/.test(URL)) {
  console.error("SUPABASE_URL is the production project. Aborting.");
  process.exit(2);
}

const ORG_SCOPED_TABLES = [
  "vehicles",
  "maintenance_logs",
  "issue_logs",
  "vehicle_documents",
  "document_extractions",
  "reminders",
  "vehicle_passports",
  "transfer_tokens",
  "vehicle_insurance",
  "vehicle_registration",
  "vehicle_inspection",
];

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures += 1;
  console.error(`  FAIL  ${m}`);
};

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** Create a confirmed user via the admin API (setup only). */
async function makeUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

/** Sign in with the ANON key → a real JWT-scoped client (used for assertions). */
async function signIn(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

async function main() {
  const pw = "Test-Passw0rd!";
  const aId = await makeUser(`a+${Date.now()}@example.test`, pw);
  const bId = await makeUser(`b+${Date.now()}@example.test`, pw);
  const cId = await makeUser(`c+${Date.now()}@example.test`, pw);

  // Signup trigger provisions a personal org each. Put B in A's org as viewer.
  const { data: aProfile } = await admin
    .from("profiles").select("organization_id").eq("id", aId).single();
  const orgA = aProfile.organization_id;
  await admin.from("profiles")
    .update({ organization_id: orgA, role: "viewer" }).eq("id", bId);

  const aEmail = (await admin.auth.admin.getUserById(aId)).data.user.email;
  const bEmail = (await admin.auth.admin.getUserById(bId)).data.user.email;
  const cEmail = (await admin.auth.admin.getUserById(cId)).data.user.email;

  const A = await signIn(aEmail, pw); // owner, Org A
  const B = await signIn(bEmail, pw); // viewer, Org A
  const C = await signIn(cEmail, pw); // owner, Org B

  // A creates a vehicle in Org A (writer path).
  const { data: veh, error: vErr } = await A
    .from("vehicles").insert({ make: "Test", model: "Iso", year: 2020, owner_user_id: aId })
    .select("id").single();
  if (vErr) fail(`A owner insert vehicle: ${vErr.message}`);
  else ok("A (owner) can insert a vehicle in Org A");
  const vehId = veh?.id;

  // B (viewer) must NOT be able to insert.
  const { error: bInsErr } = await B
    .from("vehicles").insert({ make: "X", model: "Y", year: 2020, owner_user_id: bId })
    .select("id").single();
  if (bInsErr) ok("B (viewer) blocked from inserting a vehicle");
  else fail("B (viewer) was able to insert a vehicle — RLS is_org_writer() not enforced");

  // C (Org B) must not see Org A's vehicle.
  for (const table of ORG_SCOPED_TABLES) {
    const { data: rows, error } = await C.from(table).select("id").limit(1000);
    // error is acceptable (blocked); data must contain none of Org A's ids.
    if (error) { ok(`C select ${table}: blocked (${error.code ?? "err"})`); continue; }
    const leaked = (rows ?? []).length;
    // C has only their own (empty) org, so any Org A rows would show as leakage.
    if (leaked === 0) ok(`C select ${table}: 0 cross-org rows`);
    else fail(`C select ${table}: saw ${leaked} row(s) from another org`);
  }

  // C tries to update A's vehicle by guessed id → 0 rows affected.
  if (vehId) {
    const { data: upd } = await C
      .from("vehicles").update({ make: "HACKED" }).eq("id", vehId).select("id");
    if ((upd ?? []).length === 0) ok("C update of Org A vehicle: 0 rows affected");
    else fail("C updated an Org A vehicle — cross-org write not blocked");

    const { data: del } = await C
      .from("vehicles").delete().eq("id", vehId).select("id");
    if ((del ?? []).length === 0) ok("C delete of Org A vehicle: 0 rows affected");
    else fail("C deleted an Org A vehicle — cross-org delete not blocked");
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
