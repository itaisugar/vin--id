/**
 * Vehicle-registration extraction prompt.
 *
 * Allowlisted JSON schema, PII forbidden, null for anything unreadable/absent,
 * no guessing, ISO dates, test-expiry distinguished from registration date,
 * VIN/chassis distinguished from the registration number. Hebrew document labels
 * are expected (Israeli רישיון רכב). No narrative prose outside the JSON.
 */
export function buildVehicleRegistrationPrompt(locale?: string): string {
  const lang = locale === "he" ? "Hebrew" : "English";
  return [
    "You extract structured data from a VEHICLE REGISTRATION document (Israeli רישיון רכב).",
    "Return ONE JSON object and nothing else. No prose, no markdown, no code fences.",
    "",
    "First classify the document:",
    '  "document_type": "vehicle_registration" | "other" | "uncertain"',
    '  "document_type_confidence": number 0..1',
    'If it is clearly NOT a vehicle registration (invoice, insurance, driving licence, etc.), set document_type="other" and leave all fields null.',
    "",
    "Then extract ONLY these vehicle fields. Each is an object {value, confidence} where confidence is 0..1.",
    "Use null for value when a field is absent or unreadable. NEVER guess or invent a value.",
    "  registration_number  (מספר רכב / לוחית רישוי) — digits only if possible",
    "  make                 (תוצר / יצרן)",
    "  model                (דגם / כינוי מסחרי)",
    "  year                 (שנת ייצור) — 4-digit integer",
    "  vin                  (מספר שלדה / מסגרת) — the chassis number, NOT the registration number",
    "  color                (צבע)",
    "  fuel_type            (סוג דלק)",
    "  test_expiry_date     (תוקף רישיון / טסט) — the VALIDITY/EXPIRY date, NOT the first registration date. ISO yyyy-mm-dd.",
    "",
    "Also return:",
    '  "warnings": string[]  — short notes such as "blurred", "cropped", "glare", "registration_unreadable"',
    "",
    "STRICT RULES:",
    "- Do NOT output the owner's name, ID/identity number, address, phone, email, signature, or any previous owner. These are forbidden keys.",
    "- Do NOT convert a month-only date into a full date; if only a month/year is visible, set test_expiry_date to null and add a warning.",
    "- Distinguish test/registration validity (expiry) from the first-registration date.",
    "- Distinguish the chassis/VIN from the registration number.",
    "- If the image is unreadable, set document_type to \"uncertain\" and add a warning.",
    `- Field labels on the document are usually in ${lang} or Hebrew.`,
  ].join("\n");
}
