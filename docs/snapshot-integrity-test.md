# Vin.ID — Passport Snapshot Integrity Test (manual)

Proves that a Vehicle Passport is a **frozen snapshot**: editing seller data
after creation never changes an existing Passport's content or hash, the public
preview / print use the snapshot only, and a buyer receives the snapshot data
(not the seller's edited live state). ~10 minutes, two accounts.

Related: [data-safety-review.md](data-safety-review.md),
[passport-qa-checklist.md](passport-qa-checklist.md).

## Setup

You need two accounts: **Seller** (S) and **Buyer** (B). Use two browsers or a
normal + private window.

## Steps

1. **Create seller data.** As S, create a vehicle and add at least one of each:
   a maintenance log, an issue, a document (with **Allow sharing** on), and a
   reminder. Note the make/model/year and the mileage.

2. **Create a Passport.** As S, create a Vehicle Passport for that vehicle,
   including all scopes. On the success screen, **copy the share link** and open
   the owner Passport detail to note the **Snapshot hash (SHA-256)**.

3. **Capture the public preview + hash.** Open the share link in a logged-out
   window. Record:
   - the visible content (vehicle summary, maintenance/issues/documents/reminders),
   - the **snapshot hash** shown in the Verification section.

4. **Edit seller data after creation.** As S, change live data: bump the
   vehicle mileage, edit the maintenance category/description, add a **new**
   maintenance record, and **soft-delete** the issue ("Remove from active
   history").

5. **Re-open the public Passport.** Reload the same `/p/[token]` link.

6. **Verify it did NOT change.** Confirm:
   - the content is identical to step 3 (old mileage, original maintenance text,
     the deleted issue still shown as it was at creation, the new maintenance
     record **absent**),
   - the **snapshot hash is identical** to step 3.
   Also open the **Print / Save as PDF** route as S → it shows the same snapshot
   content (not the edited live data).

7. **Accept as buyer.** As B, open the link, sign in, and **Accept** the
   Passport.

8. **Verify buyer copy = original snapshot.** In B's account, open the new
   vehicle. Its make/model/year/mileage and history must match the **step 3
   snapshot**, NOT S's edited state:
   - old mileage (from snapshot), not the bumped value,
   - original maintenance text, no new record,
   - documents present as **metadata only** (no downloadable file),
   - the buyer's vehicle has no `storage_path`/files.

9. **Verify seller rows stay private.** As B, confirm you only see the **copied**
   vehicle — you cannot see S's original vehicle or its records. As S, confirm
   the original vehicle still exists and is now marked **Sold** (not deleted).

## Pass criteria

- Snapshot hash in step 6 == step 3 (immutable).
- Public preview + print show snapshot data, never edited live data.
- Buyer's copied data == snapshot, not seller's post-edit state.
- No `storage_path`, file URLs, or token visible anywhere in the preview/print.
- Seller's raw rows remain private to the seller; seller vehicle is `sold`.

## If a check fails

- Content/hash changed after a seller edit → a read path is querying live rows
  instead of `snapshot`. Check `get_public_passport`, the print report, and
  `accept_passport` (they must read `snapshot` only).
- Buyer sees edited (not snapshot) data → `accept_passport` is copying from live
  tables; it must use `jsonb_to_recordset(snapshot->...)`.
- Any `storage_path`/file URL/token visible → stop and fix the leak before beta.
