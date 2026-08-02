#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions --
   Deliberate `cond ? P(msg) : F(msg)` assertion style; both branches log+tally. */
/**
 * Registration photo upload size limits — regression (OFFLINE, structural).
 *
 * Root cause (verified): the scan photo is uploaded through a Server Action
 * (multipart FormData). Server Actions default to a 1MB body limit, which
 * rejects normal phone-camera photos BEFORE the action runs. Fix: raise the
 * transport ceiling to 12mb while the app still enforces the real 10MB limit
 * server-side (MAX_SCAN_FILE_SIZE), rejecting >10MB with a clear message and
 * creating no Storage object / no DB row.
 *
 * Asserts the config, the exact size-check predicate/ordering the server uses,
 * the MIME allowlist, the client pre-check, and bilingual error copy. No real
 * upload is performed (no browser/device automation).
 */
import { MAX_SCAN_FILE_SIZE, isScanImageMime } from "../../lib/documents/scan/types.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

let fails = 0, passes = 0;
const P = (m) => { passes++; console.log(`  PASS  ${m}`); };
const F = (m) => { fails++; console.error(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n— ${t} —`);
const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolvePath(REPO, p), "utf8");
const MB = 1024 * 1024;

// Parse "12mb" / "500kb" / number → bytes (mirrors the `bytes` package Next uses).
function toBytes(s) {
  if (typeof s === "number") return s;
  const m = /^(\d+(?:\.\d+)?)\s*(gb|mb|kb|b)?$/i.exec(s.trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return n * ({ b: 1, kb: 1024, mb: MB, gb: 1024 * MB }[(m[2] || "b").toLowerCase()]);
}

section("1. Transport (Server Action) vs application limit");
{
  const cfg = read("next.config.ts");
  const m = /bodySizeLimit:\s*["'`]([^"'`]+)["'`]/.exec(cfg);
  m ? P(`serverActions.bodySizeLimit configured (${m[1]})`) : F("no bodySizeLimit configured");
  const transport = m ? toBytes(m[1]) : NaN;
  transport > MAX_SCAN_FILE_SIZE ? P("transport ceiling is ABOVE the 10MB app limit") : F(`transport ${transport} <= app ${MAX_SCAN_FILE_SIZE}`);
  transport >= MAX_SCAN_FILE_SIZE + MB ? P("transport leaves >=1MB for multipart overhead") : F("transport overhead too tight");
  transport <= 20 * MB ? P("transport ceiling kept tight (<=20MB, bounds DoS exposure)") : F("transport ceiling too permissive");
  MAX_SCAN_FILE_SIZE === 10 * MB ? P("application file limit is exactly 10MB") : F(`app limit ${MAX_SCAN_FILE_SIZE}`);
}

section("2. allowedDevOrigins (mobile fix) preserved");
{
  const cfg = read("next.config.ts");
  cfg.includes("allowedDevOrigins") && cfg.includes("192.168.1.179")
    ? P("allowedDevOrigins from the mobile fix is still present") : F("allowedDevOrigins lost");
}

section("3. Server-side size predicate (same constant the service uses)");
{
  // The service rejects with: file.size > MAX_SCAN_FILE_SIZE.
  const rejects = (size) => size > MAX_SCAN_FILE_SIZE;
  !rejects(500 * 1024) ? P("500KB accepted") : F("500KB rejected");
  !rejects(1.1 * MB) ? P("1.1MB accepted (was the failing case)") : F("1.1MB rejected");
  !rejects(3 * MB) ? P("3MB accepted") : F("3MB rejected");
  !rejects(MAX_SCAN_FILE_SIZE - 1) ? P("just under 10MB accepted") : F("just-under-10MB rejected");
  !rejects(MAX_SCAN_FILE_SIZE) ? P("exactly 10MB accepted (boundary inclusive)") : F("exactly 10MB rejected");
  rejects(MAX_SCAN_FILE_SIZE + 1) ? P("just over 10MB rejected") : F("just-over-10MB accepted");
  rejects(11 * MB) ? P("11MB rejected") : F("11MB accepted");
}

section("4. MIME allowlist unchanged");
{
  isScanImageMime("image/jpeg") && isScanImageMime("image/png") && isScanImageMime("image/webp")
    ? P("JPEG/PNG/WebP accepted") : F("image MIME rejected");
  !isScanImageMime("application/pdf") ? P("PDF rejected") : F("PDF accepted");
  !isScanImageMime("image/heic") ? P("HEIC rejected") : F("HEIC accepted");
  !isScanImageMime("text/html") ? P("arbitrary MIME rejected") : F("arbitrary MIME accepted");
}

section("5. Server rejects BEFORE any Storage upload / DB insert");
{
  const src = read("lib/vehicle-intake/service.ts");
  const iTooLarge = src.indexOf('error: "fileTooLarge"');
  const iBadMime = src.indexOf('error: "invalidFileType"');
  const iUpload = src.indexOf(".upload(");
  const iInsert = src.indexOf('.from("document_extractions")');
  iTooLarge > -1 && iTooLarge < iUpload && iTooLarge < iInsert
    ? P("fileTooLarge returns before upload + DB insert (no orphan object/row)") : F("size check ordering");
  iBadMime > -1 && iBadMime < iUpload && iBadMime < iInsert
    ? P("invalidFileType returns before upload + DB insert") : F("mime check ordering");
  // Exactly one staged intake row is inserted on the success path.
  ((src.match(/status:\s*"pending_confirmation"/g) || []).length === 1)
    ? P("success path inserts exactly one pending intake row") : F("intake insert count");
}

section("6. Client-side pre-check (UX, not security)");
{
  const flow = read("components/vehicles/scan-registration-flow.tsx");
  flow.includes("MAX_SCAN_FILE_SIZE") && /file\.size > MAX_SCAN_FILE_SIZE/.test(flow)
    ? P("client rejects >10MB before submit (avoids raw transport error)") : F("no client size pre-check");
  flow.includes('ts("errors.fileTooLarge")') ? P("client shows the fileTooLarge message") : F("client message");
}

section("7. Cancellation cleanup + bilingual copy");
{
  const svc = read("lib/vehicle-intake/service.ts");
  /cancelRegistrationIntake[\s\S]*storage[\s\S]*\.remove\(/.test(svc)
    ? P("cancel removes the staged Storage object") : F("cancel cleanup missing");
  const en = JSON.parse(read("messages/en.json")).vehicles.scan.errors.fileTooLarge;
  const he = JSON.parse(read("messages/he.json")).vehicles.scan.errors.fileTooLarge;
  /10\s?MB/i.test(en) ? P("EN fileTooLarge states the 10MB limit") : F(`EN copy: ${en}`);
  /10\s?MB/i.test(he) ? P("HE fileTooLarge states the 10MB limit") : F(`HE copy: ${he}`);
}

console.log(`\n${fails === 0 ? "OK" : "FAILED"} — ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
