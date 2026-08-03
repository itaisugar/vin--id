#!/usr/bin/env node
/**
 * Local founder-QA seed — sanitized fixtures for the visual pass.
 *
 * LOCAL ONLY. Refuses to run against the production ref or any non-local URL.
 * Creates email/password users, a Personal-only account, a Business org with
 * Owner/Manager/Viewer/Driver, and a few vehicles (photo, expiring dates, a
 * duplicate plate that matches the mock scan output). No real people, plates,
 * or VINs. Idempotent-ish: reuses users by email and the business org by name.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_REF = "jsthfmgvcdrfzpgkpwvt";

if (!URL || !SERVICE) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
if (URL.includes(PROD_REF)) { console.error("Refusing: SUPABASE_URL points at the production ref."); process.exit(1); }
if (!/127\.0\.0\.1|localhost/.test(URL)) { console.error(`Refusing: SUPABASE_URL is not local (${URL}).`); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "VinIdQA!2026";
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'>" +
    "<rect width='100%' height='100%' fill='#2b6cb0'/>" +
    "<text x='50%' y='50%' fill='white' font-size='28' text-anchor='middle' dominant-baseline='middle'>QA PHOTO</text></svg>",
  );

const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function findUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const u = data.users.find((x) => x.email === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
}

async function ensureUser(email) {
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

async function personalOrgOf(userId) {
  const { data: rows } = await admin.from("organization_members").select("organization_id").eq("user_id", userId);
  const ids = (rows ?? []).map((r) => r.organization_id);
  if (!ids.length) return null;
  const { data: orgs } = await admin.from("organizations").select("id, kind").in("id", ids);
  return (orgs ?? []).find((o) => o.kind === "personal")?.id ?? ids[0];
}

async function setActiveOrg(userId, orgId) {
  const { error } = await admin.from("profiles").update({ active_organization_id: orgId }).eq("id", userId);
  if (error) throw new Error(`setActiveOrg: ${error.message}`);
}

async function addMembership(userId, orgId, role) {
  const { error } = await admin.from("organization_members")
    .upsert({ organization_id: orgId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) throw new Error(`addMembership(${role}): ${error.message}`);
}

async function ensureVehicle(v) {
  // Idempotent on (organization_id, license_plate).
  const { data: existing } = await admin.from("vehicles")
    .select("id").eq("organization_id", v.organization_id).eq("license_plate", v.license_plate).maybeSingle();
  if (existing) { await admin.from("vehicles").update(v).eq("id", existing.id); return existing.id; }
  const { data, error } = await admin.from("vehicles").insert(v).select("id").single();
  if (error) throw new Error(`vehicle ${v.license_plate}: ${error.message}`);
  return data.id;
}

async function main() {
  console.log("Seeding local QA fixtures…\n");

  const personal = await ensureUser("qa.personal@vinid.local");
  const owner = await ensureUser("qa.owner@vinid.local");
  const manager = await ensureUser("qa.manager@vinid.local");
  const viewer = await ensureUser("qa.viewer@vinid.local");
  const driver = await ensureUser("qa.driver@vinid.local");

  // The signup trigger creates each user's Personal workspace + membership.
  const personalOrg = await personalOrgOf(personal.id);
  await setActiveOrg(personal.id, personalOrg);

  // Business workspace (service-role insert; mirrors an explicitly-created org).
  const BIZ_NAME = "QA Fleet Ltd";
  let { data: biz } = await admin.from("organizations").select("id").eq("name", BIZ_NAME).eq("kind", "business").maybeSingle();
  if (!biz) {
    const ins = await admin.from("organizations").insert({ name: BIZ_NAME, kind: "business", email: "fleet@vinid.local" }).select("id").single();
    if (ins.error) throw new Error(`business org: ${ins.error.message}`);
    biz = ins.data;
  }
  await addMembership(owner.id, biz.id, "owner");
  await addMembership(manager.id, biz.id, "fleet_manager");
  await addMembership(viewer.id, biz.id, "viewer");
  await addMembership(driver.id, biz.id, "driver");
  // Land each Business user in the Business workspace by default.
  for (const u of [owner, manager, viewer, driver]) await setActiveOrg(u.id, biz.id);

  // Personal vehicles: one with a photo, one with upcoming expiries + a document.
  await ensureVehicle({
    organization_id: personalOrg, owner_user_id: personal.id,
    make: "Toyota", model: "Corolla", year: 2020, license_plate: "11111111",
    color: "White", current_mileage: 45000, photo_url: PHOTO, status: "active",
  });
  const p2 = await ensureVehicle({
    organization_id: personalOrg, owner_user_id: personal.id,
    make: "Honda", model: "Civic", year: 2019, license_plate: "22222222",
    color: "Blue", current_mileage: 82000, status: "active",
    test_expiry_date: daysFromNow(20), insurance_expiry_date: daysFromNow(25),
  });
  // A registration document (metadata only) so Documents + Passport have content.
  {
    const { data: doc } = await admin.from("vehicle_documents")
      .select("id").eq("vehicle_id", p2).eq("doc_type", "registration").maybeSingle();
    if (!doc) {
      const row = { owner_user_id: personal.id, vehicle_id: p2, doc_type: "registration",
        title: "Vehicle registration", trust_label: "document_backed", organization_id: personalOrg };
      let r = await admin.from("vehicle_documents").insert(row).select("id").single();
      if (r.error && /organization_id/.test(r.error.message)) {
        delete row.organization_id;
        r = await admin.from("vehicle_documents").insert(row).select("id").single();
      }
      if (r.error) console.warn(`  (document skipped: ${r.error.message})`);
    }
  }

  // Business vehicles: a normal one, and one whose plate matches the mock scan
  // output (12345678) so scanning in Business demonstrates the duplicate UI.
  await ensureVehicle({
    organization_id: biz.id, owner_user_id: owner.id,
    make: "Mazda", model: "3", year: 2021, license_plate: "33333333",
    color: "Red", current_mileage: 30000, status: "active",
    test_expiry_date: daysFromNow(40),
  });
  await ensureVehicle({
    organization_id: biz.id, owner_user_id: owner.id,
    make: "Toyota", model: "Corolla", year: 2018, license_plate: "12345678",
    color: "Silver", current_mileage: 99000, status: "active",
  });

  console.log("Done.\n");
  console.log("Password for ALL accounts:", PASSWORD, "\n");
  console.table([
    { email: "qa.personal@vinid.local", represents: "Personal (no Business)", workspace: "Personal", role: "owner-of-personal" },
    { email: "qa.owner@vinid.local", represents: "Business Owner", workspace: "QA Fleet Ltd (+ own Personal)", role: "owner" },
    { email: "qa.manager@vinid.local", represents: "Fleet Manager", workspace: "QA Fleet Ltd", role: "fleet_manager" },
    { email: "qa.viewer@vinid.local", represents: "Viewer (read-only)", workspace: "QA Fleet Ltd", role: "viewer" },
    { email: "qa.driver@vinid.local", represents: "Driver (restricted)", workspace: "QA Fleet Ltd", role: "driver" },
  ]);
  console.log("\nVehicles:");
  console.log("  Personal 11111111 (Toyota Corolla, has photo)");
  console.log("  Personal 22222222 (Honda Civic, test+insurance expiring ~20-25d, has a registration document)");
  console.log("  Business 33333333 (Mazda 3, test expiring ~40d)");
  console.log("  Business 12345678 (Toyota Corolla) — matches the mock scan plate → duplicate-UI test in Business");
  console.log("\nScan happy-path: run the registration scan in the PERSONAL workspace (12345678 is free there).");
}

main().catch((e) => { console.error("\nSEED FAILED:", e.message); process.exit(1); });
