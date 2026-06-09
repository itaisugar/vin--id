# Vin.ID — Passport PDF Export Notes

## Current behavior (MVP, free-tier)

Passport "PDF export" uses **browser print → Save as PDF** (no PDF library, no
server-side rendering, no paid service):

- Owner Passport detail (`/vehicles/[id]/passports/[passportId]`) has an
  **"Export PDF"** button that opens a print-friendly route:
  `/vehicles/[id]/passports/[passportId]/print`.
- That route renders a clean, A4-oriented report and a **"Print / Save as PDF"**
  button (`window.print()`). The button, back link, and the app chrome
  (header / sidebar / bottom nav) are hidden in the printout via `print:` CSS.
- Print CSS forces a light/white palette even when the app/OS is in dark mode,
  so the printout always looks like a document.

The report is built **from `vehicle_passports.snapshot` only** — the same frozen
snapshot used for the public preview. No live seller data is queried to build it.

It includes: Vin.ID branding, "Vehicle Passport", issued/expires dates, status,
version, Passport ID, snapshot hash, Record Confidence Score, the deterministic
summary (strengths / attention / recommended checks / missing-or-not-shared),
the timeline (maintenance, issues, document **metadata only**, reminders), the
verification text, and the disclaimers.

## Security / privacy

- **Owner-only.** The print route uses the owner-scoped `getPassport` (RLS +
  owner filter); a non-owner gets "not found".
- **No `storage_path`, no signed/raw file URLs, no bucket name** — documents are
  shown as metadata only (the snapshot never contains paths).
- **No `token_hash`** and **no service-role key** anywhere.
- Token/accept/transfer/security logic is unchanged.

## Limitations

- **Documents are metadata only** (file_name, type, dates, vendor, amount,
  trust, personal-info flag). Files are not embedded.
- **No share link / QR in the PDF.** The raw share token is shown only once at
  creation (only its hash is stored), so it cannot be reconstructed later. The
  report shows the **snapshot hash** and **Passport ID** instead.
- This is **not** an official ownership document and **not** a mechanical
  certification. "Record Confidence" measures documentation quality only.
- Print fidelity depends on the browser's print engine (margins, page breaks).
  RTL (Hebrew) prints readably; fine-grained RTL print polish is a future TODO.

## Future TODOs
- `TODO(qr)`: include a QR code for the share link **only at creation/export**,
  when the raw link is briefly available (no QR library is bundled today).
- Optional real server-side PDF generation (e.g. a lightweight HTML→PDF
  renderer) if a downloadable file is needed instead of browser print.
- Public-side "Download PDF" was intentionally skipped to avoid touching token
  security; revisit only if it can stay snapshot-only and safe.
