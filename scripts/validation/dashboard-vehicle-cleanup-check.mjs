#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Dashboard & vehicle-form cleanup — validation.
 *
 * Two product cleanups, proven at two levels:
 *   1. SOURCE  — the shipped schema/payload no longer own `photo_url`, the removed
 *                UI (dashboard expiry tiles, form Photo URL field) is gone, and
 *                preserved surfaces (expiry data, image display) stay.
 *   2. DATA    — against local Supabase: creating a vehicle without a photo URL
 *                works, and an UPDATE that omits `photo_url` (exactly what the
 *                shipped `vehicleInputToRow` now produces) does NOT erase an
 *                existing stored value.
 *
 * `lib/vehicles/types.ts` uses `@/` path aliases that a plain Node process can't
 * resolve, so it is asserted at the source level rather than imported; the row
 * builder's real output (no `photo_url` key) is checked in source and its effect
 * proven against the database.
 *
 * Guards: refuses without FLEET_CHECK_ALLOW=1, refuses the production ref,
 * refuses non-local URLs unless FLEET_CHECK_ALLOW_REMOTE=1. No secret is printed.
 *
 * Usage:
 *   FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… npm run validate:dashboard-vehicle-cleanup
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cleanupUsers, orgOf } from "./lib/org-fixtures.mjs";

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
// Strip block and line comments so assertions match CODE, not explanatory prose
// (which legitimately still mentions the removed identifiers).
const code = (p) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const RUN = randomBytes(3).toString("hex");

async function main() {
  const users = [];
  try {
    // -------------------------------------------------------------------
    section("1. Source: schema/types/payload no longer own photo_url");
    // -------------------------------------------------------------------
    {
      const types = code("lib/vehicles/types.ts"); // comments stripped
      // The ONLY code-level photo_url mentions allowed are the two read/display
      // ones: the `Vehicle` row type field and the VEHICLE_COLUMNS select string.
      // Any third occurrence would be a form-side (schema/defaults/mapper/payload)
      // reference that should be gone.
      const occurrences = (types.match(/photo_url/g) ?? []).length;
      const inRowType = /photo_url: string \| null;/.test(types);
      const inColumns = /photo_url/.test(types.match(/VEHICLE_COLUMNS =[\s\S]*?;/)?.[0] ?? "");
      occurrences === 2 && inRowType && inColumns
        ? P("schema, form-values, defaults, edit-mapper and payload builder drop photo_url")
        : F(`unexpected photo_url usage in types.ts (code occurrences=${occurrences})`);
      inRowType && inColumns
        ? P("Vehicle row type + VEHICLE_COLUMNS keep photo_url (read/display path)")
        : F("read path lost photo_url");
      /invalidUrl/.test(types) === false
        ? P("the URL validation rule is gone from the schema") : F("invalidUrl rule remains");
    }

    // -------------------------------------------------------------------
    section("2. Source: removed UI gone, preserved surfaces stay");
    // -------------------------------------------------------------------
    {
      const form = code("components/vehicles/vehicle-form.tsx");
      !/name="photo_url"/.test(form) && !/fields\.photoUrl/.test(form)
        ? P("vehicle form exposes no Photo URL input (create + edit share this form)")
        : F("vehicle form still renders a Photo URL field");

      // No expiry TILE (a tile is a `key: "…"` object) and no expiry tile LINK.
      const cards = code("components/fleet/fleet-summary-cards.tsx");
      !/key:\s*"documentsExpired"/.test(cards) && !/key:\s*"documentsExpiringSoon"/.test(cards)
        ? P("dashboard summary cards no longer render any document-expiry tile")
        : F("dashboard still renders a document-expiry tile");
      !/href:\s*"\/vehicles\?filter=document_expiring"/.test(cards)
        ? P("no expiry tile link remains on the dashboard") : F("expiry tile link remains");

      // Preserved: image display still reads photo_url.
      const card = code("components/vehicles/vehicle-card.tsx");
      /vehicle\.photo_url/.test(card)
        ? P("vehicle image display still uses stored photo_url") : F("image display lost photo_url");

      // Preserved: expiry still computed + still surfaced where it is actionable.
      const svc = code("lib/fleet/service.ts");
      /documentsExpired/.test(svc) && /documentsExpiringSoon/.test(svc)
        ? P("document-expiry counts are still computed in the fleet service") : F("expiry computation removed");
      /document_expired/.test(svc) && /document_expiry/.test(svc)
        ? P("document-expiry actions/deadlines still generated") : F("expiry actions/deadlines removed");
    }

    // -------------------------------------------------------------------
    section("3. i18n: removed keys gone, parity holds, no missing keys");
    // -------------------------------------------------------------------
    {
      const en = JSON.parse(read("messages/en.json"));
      const he = JSON.parse(read("messages/he.json"));
      const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v) ? flat(v, p + k + ".") : [p + k]);
      const enK = new Set(flat(en)), heK = new Set(flat(he));
      const removed = [
        "vehicles.fields.photoUrl", "vehicles.form.errors.invalidUrl",
        "fleet.summary.documentsExpired", "fleet.summary.documentsExpiringSoon",
      ];
      removed.every((k) => !enK.has(k) && !heK.has(k))
        ? P("all four orphaned keys removed from both locales") : F("an orphaned key remains");
      // Still-needed keys survive.
      ["vehicles.fields.make", "fleet.summary.openIssues", "vehicles.form.errors.tooLong"]
        .every((k) => enK.has(k) && heK.has(k))
        ? P("shared/needed keys preserved in both locales") : F("a needed key was removed");
      const onlyEn = [...enK].filter((k) => !heK.has(k));
      const onlyHe = [...heK].filter((k) => !enK.has(k));
      onlyEn.length === 0 && onlyHe.length === 0
        ? P("en/he key parity — no missing keys either side")
        : F(`key drift: en-only ${onlyEn.length}, he-only ${onlyHe.length}`);
    }

    // -------------------------------------------------------------------
    section("4. DATA: create works without a photo; edit preserves an existing one");
    // -------------------------------------------------------------------
    {
      // The update payload mirrors the shipped `vehicleInputToRow` EXACTLY: no
      // `photo_url` key (section 1 asserts the builder omits it). Section 2
      // asserts the form never submits one. Together with the preservation seen
      // here, that is the full create + edit behaviour.
      const rowFor = (make, model, year) => ({
        make, model, year,
        vin: null, license_plate: null, current_mileage: null, mileage_unit: "km",
        operational_status: "active", vehicle_type: null,
        next_service_date: null, next_service_km: null,
        test_expiry_date: null, insurance_expiry_date: null,
      });

      const { data: u } = await admin.auth.admin.createUser({
        email: `dvc-${RUN}@example.test`, password: "Test-Passw0rd!", email_confirm: true });
      users.push({ id: u.user.id });
      const org = await orgOf(admin, u.user.id);

      // (a) CREATE without photo_url.
      const { data: created, error: cErr } = await admin.from("vehicles")
        .insert({ ...rowFor("Kia", "Niro", 2022), owner_user_id: u.user.id, organization_id: org })
        .select("id, photo_url").single();
      !cErr ? P("vehicle created without a photo URL") : F(`create failed: ${cErr?.message}`);
      created?.photo_url == null ? P("created vehicle has null photo_url (no bogus value)") : F("create wrote a photo_url");

      // Seed an existing stored photo_url (as if set before the field was removed).
      const STORED = "https://example.com/existing-photo.jpg";
      await admin.from("vehicles").update({ photo_url: STORED }).eq("id", created.id);

      // (b) EDIT another field with a photo_url-less payload — must NOT clear it.
      const { error: uErr } = await admin.from("vehicles")
        .update(rowFor("Kia", "Sportage", 2023)).eq("id", created.id);
      !uErr ? P("vehicle edit succeeded") : F(`edit failed: ${uErr?.message}`);
      const { data: after } = await admin.from("vehicles")
        .select("photo_url, model").eq("id", created.id).single();
      after?.photo_url === STORED
        ? P("editing another field PRESERVED the existing photo_url") : F(`edit erased photo_url -> ${after?.photo_url}`);
      after?.model === "Sportage" ? P("the intended edit was applied") : F("edit did not apply");

      // (c) A vehicle with no photo_url stays editable and null.
      await admin.from("vehicles").update({ photo_url: null }).eq("id", created.id);
      await admin.from("vehicles").update(rowFor("Kia", "Rio", 2024)).eq("id", created.id);
      const { data: after2 } = await admin.from("vehicles").select("photo_url, model").eq("id", created.id).single();
      after2?.photo_url == null && after2?.model === "Rio"
        ? P("a vehicle without a photo_url stays editable, photo_url stays null") : F("null-photo edit misbehaved");
    }
  } finally {
    await cleanupUsers(admin, users);
  }

  console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
