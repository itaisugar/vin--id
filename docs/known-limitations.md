# Vin.ID — Known Limitations (beta)

What Vin.ID intentionally does **not** do yet. Share this with testers so
expectations are clear. None of these are bugs — they're scoped out of the
free-tier beta.

## AI / extraction
- **AI diagnosis is mock/demo, not real AI.** It's a deterministic,
  keyword-based guide (cautious by design) and shows a "mock mode" notice.
- **Document extraction is mock/demo, not real OCR.** It infers from the
  document type / file name and always requires you to confirm before saving.

## Vehicle Passport
- **PDF is a print/save flow, not a server-generated official PDF.** It uses your
  browser's Print → Save as PDF from the snapshot.
- A Vehicle Passport is **not an official ownership / title / registration
  document**.
- A Vehicle Passport is **not a mechanical certification** or a guarantee of
  condition. "Record Confidence" = documentation quality, not vehicle condition.
- **No automatic document redaction yet** — you control sharing via the
  "allow sharing" and "contains personal info" flags; review documents before
  sharing.
- **No mechanic verification yet** — there's no third-party "shop verified"
  workflow beyond the trust labels you set.
- **No share link / QR after creation** — the full share link is shown only once
  at creation (only a hash is stored). Create a new Passport for a fresh link.

## Sharing / transfer
- **No real email/SMS sharing** — you share the link manually (copy / Web Share /
  PDF). No messages are sent by Vin.ID.
- **No document file copy during ownership transfer yet** — accepting a Passport
  copies history **metadata** into the buyer's account; the original document
  files are not transferred.

## Integrations / platform
- **No OBD / vehicle hardware integration.**
- **No payments / subscriptions** — everything in the beta is free-tier.
- **No marketplace** — Vin.ID is not a place to list or sell vehicles.
- **No blockchain anchoring** — tamper-evidence is via a SHA-256 snapshot hash.

## Account / data
- **No automated account deletion yet** — request deletion from Settings and it's
  handled manually.
- **Exports exclude original document files** (metadata only); see
  [data-export-and-account-control.md](data-export-and-account-control.md).
- **Backups are manual** during the beta; see
  [manual-backup-checklist.md](manual-backup-checklist.md).

## Testing
- **No automated mobile/visual test suite** — mobile checks are manual
  ([mobile-ux-checklist.md](mobile-ux-checklist.md)).

These map to TODOs tracked across the codebase and docs; they're candidates for
post-beta work.
