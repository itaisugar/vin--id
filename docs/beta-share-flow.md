# Vin.ID — Beta Passport Share Flow

How Vehicle Passport sharing works today (beta, free-tier), and what to expect.

## How sharing works today

1. The owner creates a **Vehicle Passport** from a vehicle
   (`/vehicles/[id]/passports/new`). They choose which scopes to include
   (maintenance, issues, documents, reminders) and see a preview.
2. On creation, the snapshot is **frozen** and a canonical-JSON **SHA-256 hash**
   is computed. A one-time **secure share link** (`/p/{token}`) is generated.
3. The owner is shown the **full share link once**, on the success screen, with:
   - **Copy link** (and a native **Share** button via the Web Share API where
     supported, e.g. mobile — it falls back to copy on desktop),
   - **Open public preview**,
   - **Export PDF** (print / save a static copy),
   - **Open passport**,
   - a **Next steps** card explaining what to do.
4. The owner sends the link to a buyer. The buyer opens `/p/{token}` and can
   **preview** the Passport before deciding.
5. A signed-in buyer can **Accept** the Passport, which copies the shared
   history into their account and marks the Passport accepted.

## The full link is shown only at creation

For security, **only a hash of the token is stored** — never the raw token. So
the full share link **cannot be shown again** after the creation screen. The
owner Passport detail page explains this and offers **"Create a new Passport for
a fresh link"** if a new link is needed. We never reconstruct a raw token from
its hash.

## Preview is not one-time

Opening the public preview (`/p/{token}`) **does not use up the link**. The
buyer can open it multiple times until the link **expires** (72 hours), is
**revoked** by the owner, or is **accepted**.

## Accept is one-time

**Accepting** copies the seller's shared history into the buyer's account, marks
the token used and the Passport accepted, and sets the seller's vehicle to
`sold`. This is a **one-time** action and cannot be repeated. The accept logic
is an atomic `SECURITY DEFINER` RPC; it is **not changed** by this UX phase.

- **Signed-out** visitors see "Sign in to accept this Passport" and are told
  they can **preview first**.
- **Signed-in buyers** see "Accept Passport into my account" and are told it is
  one-time.
- The **owner** is told they **cannot accept their own Passport** and should
  share the link with a buyer.

## PDF / print is a static copy

**Export PDF** opens a print-friendly route and uses the browser's
**Print → Save as PDF**. It is a **static copy of the snapshot** only. It is:

- **not** the same as accepting a Passport into an account,
- **not** an official ownership document,
- **not** a mechanical certification.

The PDF is built from `vehicle_passports.snapshot` only — no `storage_path`, no
signed/raw file URLs, and **no share link/QR** (the raw token isn't stored, so
it can't be embedded). It shows the snapshot hash and Passport ID instead.

## Raw token is never stored

Only `token_hash` (SHA-256 of the raw token) is stored in `transfer_tokens`. The
raw token exists only in the share URL shown once at creation. This phase does
**not** change token/security/accept/transfer logic and does **not** store raw
tokens.

## Known limitations

- No way to re-display or re-issue a link for an existing Passport — the owner
  must create a new Passport for a fresh link.
- Documents are shared as **metadata only** (no files embedded or linked).
- No QR code (no raw token to encode after creation; no QR library bundled).
- Web Share API is used only in the immediate post-creation state where the raw
  URL is available; desktop browsers without it fall back to Copy.
- No email/SMS sending — sharing is manual (copy/Web Share/PDF).

## Future improvements

- `TODO(regenerate-link)`: allow re-issuing a share token for an existing
  Passport in place (still hash-only).
- `TODO(qr)`: QR for the share link **at creation/export only**, while the raw
  link is briefly available.
- Optional notification/reminder when a buyer accepts.
- Richer buyer-side guidance and a guided accept walkthrough.
