# Fleet Lite — Organization-Aware Document Storage

**Status: DOCUMENT STORAGE VALIDATED (local Supabase, 2026-07-25).** Production
(`jsthfmgvcdrfzpgkpwvt`) was never accessed. All commands targeted `127.0.0.1`.

## The problem

Document files live in the private `vehicle-documents` bucket at path
`{uploader_user_id}/{vehicle_id}/{document_id}/{filename}`. The original Storage
policies (`20260607170001`) gated every object on
`(storage.foldername(name))[1] = auth.uid()` — the uploader's id — and signed
URLs are created under the caller's JWT. So a same-organization colleague (a
different `auth.uid`) could see the document metadata but could not open the
file.

## Selected design — authorize by the document row (Option C, no service role)

Storage access is authorized by the **document row's organization**, not by the
path prefix. Two SECURITY DEFINER helpers back the object policies:

- `can_read_document_object(name)` — true when the caller's organization owns a
  non-deleted `vehicle_documents` row whose `storage_path = name`.
- `can_write_document_object(name)` — same, plus `is_org_writer()`.

Object policies on `storage.objects` for the bucket:

| Op | Rule |
|----|------|
| SELECT | `can_read_document_object(name)` — any org member (viewers included) |
| INSERT | uid-prefix `AND is_org_writer()` (row doesn't exist yet at insert) |
| UPDATE | `can_write_document_object(name)` |
| DELETE | `can_write_document_object(name)` |

Server flow is unchanged in shape and remains the primary authorization:
`getDocumentSignedUrl` → `getDocument` (org-scoped) authorizes → the trusted
`storage_path` is read **from the DB row** → `createSignedUrl`. The client only
ever passes a document ID; it can never submit an arbitrary path and get a URL.
The org-aware object policy is a second, independent gate.

### Why this over the alternatives

- **Rejected: org-scoped object paths (`organizations/{org}/…`) + prefix policy.**
  Requires migrating every existing object, and a "read any object under your
  org prefix" policy authorizes by path, not by document access — exactly the
  broad pattern the task warns against.
- **Rejected: service-role signed URLs.** Works, but introduces a service-role
  key into the server env. This codebase deliberately has none (Phase 3B chose
  SECURITY DEFINER RPCs to avoid it); staying consistent avoids a new secret and
  a new operational surface.
- **Chosen:** keep the path, authorize by the document row via SECURITY DEFINER
  helpers. No object migration, no new secret, legacy files work unchanged,
  strict cross-org isolation, and a clean upgrade path to `organization_members`
  (only the org-resolution helpers change).

### Forward compatibility with `organization_members`

Authorization funnels through `current_org_id()` / `is_org_writer()` and the
document-row join. When membership arrives, those helpers resolve org/role from
membership instead of `profiles`, and every Storage policy and service function
follows automatically — no path or policy changes.

## Additional hardening (found by runtime validation)

`vehicle_documents` INSERT/UPDATE RLS now also requires the **referenced vehicle
to be in the caller's organization**. Previously a writer could insert a
document row referencing another org's vehicle (it landed in the writer's own
org — not a data leak, but a cross-org-inconsistent row that defeated "forged
vehicle IDs are rejected"). The app already blocked this via the org-scoped
`getVehicleById`; the DB now blocks a direct client insert too. Scoped to
`vehicle_documents`; `accept_passport` is SECURITY DEFINER and unaffected.

## Legacy compatibility

There is exactly **one** object-path format in the codebase
(`{uid}/{vehicle}/{doc}/{file}`) — the document form and the scan flow both use
it. The migration does **not** change the path, so no object migration is
needed and every existing file keeps working (authorization no longer depends on
the path). This was tested as a transition: a document created under the old
uid-scoped policies remains openable by its uploader after the migration, and a
same-org colleague — previously blocked — can now open it, while other-org and
anonymous callers stay blocked.

No object was moved, renamed or deleted. No production Storage operation was
performed or is required by this task.

## Delete behavior

`softDeleteDocument` now: authorizes (writer + org-scoped), soft-deletes the
metadata row (source of truth), then **best-effort removes the Storage object**
under the writer's JWT (the delete policy permits a writer whose org owns the
row, including just-soft-deleted rows). If object removal fails, the metadata is
still deleted and the orphaned path is logged (never silently) and reported via
the return value. A metadata-less object cannot be deleted (no matching row →
`can_write_document_object` is false), so arbitrary object deletion is blocked.

## Passport boundary (unchanged, re-verified)

Public passport snapshots carry document **metadata only** — no `storage_path`,
no signed URL, no uploader uid. `accept_passport` copies document rows with
`storage_path = NULL`, so a buyer never receives a reference to a seller-private
file. Verified at runtime.

## Validation

`npm run validate:document-storage` — 25/25 assertions pass against local
Supabase (real per-persona JWT sessions; service role for fixtures only). Covers
upload (owner/fleet_manager/viewer/forged-vehicle/anon/private), read/sign
(same-org/other-org/guessed-path/anon/actual-download), membership-loss,
delete (writer/other-org), passport boundary, and AI unconfirmed-upload privacy.

Audit: `supabase/audits/document_storage_audit.sql` — 6 detection queries, all
return zero rows (private bucket, no permissive/anon storage policy, no
doc↔vehicle org mismatch, no shared object paths, uploader-prefixed paths,
helpers present + SECURITY DEFINER).

## Not done here (out of scope)

`organization_members`, invitations, org settings, expiry management. The
service role remains unused by the app. Browser-level visual verification of the
document UI (upload progress, preview, delete dialog, RTL/mobile) was not
performed — no browser automation is available; see the manual checklist in the
completion report.
