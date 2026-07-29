# Production QA round 1 — quick wins

Six independent corrections from `production-qa-round-1-audit.md`, implemented
on `fix/production-qa-quick-wins` from `61f6c87`.

**No migration. No schema change.** Nothing here touches organization tenancy,
membership cardinality, `current_org_id()`, invitation acceptance or any RLS
policy. The multi-workspace work is deliberately out of scope.

Two of the eight audit findings are handled elsewhere: invitation email delivery
needs a founder decision on a provider, and the Personal/Organization workspace
split needs the migration chain the audit describes.

---

## 1. `Needs attention` was stale

**Root cause: status materialization.** `vehicles.operational_status` is written
by hand — by the vehicle form and the quick status control — and nothing ever
recomputed it. Grepping every migration for a trigger or function that writes it
returns nothing. Resolving the last open issue therefore left `issue_open`
behind forever.

What made it visibly wrong: the *derived* signals beside it were already
correct. `lib/fleet/service.ts` filters `.in("status", OPEN_ISSUE_STATUSES)`, so
`openIssueCount` dropped to zero while the badge still read "Needs attention".
The two sat in the same row of the same card, disagreeing.

### Chosen strategy — derive, keep the column for declared states

`effectiveOperationalStatus(stored, { openIssueCount, serviceState })` in
[lib/fleet/types.ts](lib/fleet/types.ts) is the single authoritative rule.

| Kind | Statuses | Behaviour |
| --- | --- | --- |
| **Declared** | `out_of_service`, `in_garage`, `documents_missing` | A human statement no query may contradict. Always honoured. |
| **Derived** | `issue_open`, `needs_service` | Recomputed from live rows on every read. |
| Default | `active` | Nothing outstanding. |

`documents_missing` is declared rather than derived for the reason already
documented on `DocumentStatus`: the schema has no per-organization policy of
which documents are required, so "missing" is not derivable and clearing it
automatically would delete information.

**Nothing writes to the database.** The stored column keeps its value; it is
simply no longer what the UI trusts. That is what makes this safe to ship
without a migration or a backfill, and it is asserted by a test.

Rejected: a trigger on `issue_logs` (silently overwrites a manual setting, and
cannot tell whether a human set `issue_open`), and a generated column
(`needs_service` depends on other tables and on "today").

### Every surface reads it

| Surface | Before | After |
| --- | --- | --- |
| Dashboard `operational` / `attention` / `unavailable` tiles | `vehicles.operational_status` | `row.effectiveStatus` |
| Fleet-list badge | `v.operational_status` | `row.effectiveStatus` |
| Status filters (`issue_open`, `needs_service`, …) | stored column | `row.effectiveStatus` |
| `sort=status` | stored column | `row.effectiveStatus` |
| Vehicle-detail badge | stored column | `fleetRow.row.effectiveStatus` |
| Vehicle-detail read-only status | stored column | effective |

`requiresAttention` (`row.actions.length > 0`) was already correct and is
unchanged. The vehicle form and the quick status control still write the stored
column — that is how a declared status is set.

Where the effective status lives is deliberate: `lib/fleet/types.ts` has no
runtime imports, so the validation harness can load the shipped function
directly. `lib/fleet/alerts.ts` re-exports it, since that is where callers look
for alert rules.

---

## 2. Nearest document expiry left the Fleet list

Removed from [components/fleet/fleet-vehicle-row.tsx](components/fleet/fleet-vehicle-row.tsx)
(the mobile card and the desktop grid are the same component); the grid drops
from five columns to four. The unused `fleet.fields.nearestExpiry` label is gone
from both catalogues.

**Preserved, and asserted by tests:** `documents.nearestExpiry` is still computed
on every row; the dashboard's `document_expired` / `document_expiring` actions
still fire; the deadline list, the `document_expiring` filter and the
vehicle-detail document view are untouched. The query is unchanged — the value
is used elsewhere, so narrowing the query would have cost more than it saved.

**Held back:** the `document_expiry` sort option still exists. The audit listed
it as an open founder decision and this task did not resolve it; removing a sort
control is a product choice, not a cleanup. Sorting by a value the row no longer
displays is admittedly odd — say the word and it goes.

---

## 3. One Passport action on vehicle detail

[components/passports/passport-section.tsx](components/passports/passport-section.tsx)
rendered up to three recent passport cards plus "view all N". It now renders one
action:

* **Open Passport** when a current passport exists
* **Create Passport** otherwise

"Current" is `effectiveStatus(p) === "active"` from
[lib/passports/types.ts](lib/passports/types.ts) — the same helper the passport
list and detail screens use. It downgrades an `active` passport past its
`expires_at` to `expired`, so a lapsed passport correctly offers Create.
`revoked`, `accepted` and `draft` are likewise not current.

**No data is deleted.** `listPassports()` is unchanged, every row is still
stored and readable, and `/vehicles/[id]/passports` stays reachable through a
de-emphasised history link so nothing becomes unreachable. Tokens, the public
RPC and the accept flow are untouched. Rendering an action creates nothing —
asserted by a count.

---

## 4. Team & Access navigation

The screen at `/organization` already existed and worked. It was reachable only
from a Settings card labelled with the organization subtitle.

* **Desktop sidebar:** a new Team & Access entry, gated on
  `canManageOrganization(role)` — owner and admin, the same set
  `list_organization_members()` and every invitation policy already require. A
  fleet manager or viewer would otherwise reach a screen that can only tell them
  they may not use it.
* **Mobile:** unchanged. The bottom bar has exactly five slots (four items plus
  the scanner FAB) and a sixth does not fit at 320px, so the Settings card
  remains the way in — now under the same name, so the screen has one name.
* **Driver:** not shown; drivers use `driverNavItems`.

Hiding is presentation only. `/organization` still calls
`getCurrentUserContext()` and renders nothing manageable without
`canManageOrganization`, the service layer re-checks, and the database refuses
independently — `list_organization_members()` carries `and is_org_admin()`
inside its `WHERE`, so a non-admin gets an empty roster rather than an error.
All three layers are asserted separately.

Personal users gain no Fleet navigation from this change.

---

## 5. Service & Compliance

**The fields were always editable.** The form rendered and persisted
`next_service_date`, `next_service_km`, `test_expiry_date` and
`insurance_expiry_date` in edit mode, `vehicleToFormValues()` prefilled them, and
`updateVehicle()` wrote them. The defect was discoverability: they sat in an
unlabelled information grid, and the form's disclosure was collapsed.

Three changes, no new plumbing:

1. The card is titled **Service & Compliance** / **טיפולים וציות**, with a
   subtitle and its own Edit action.
2. Each value is a link to `/vehicles/[id]/edit#<field>`. `Field` renders
   `id={name}`, so the hash lands on the input.
3. The form's fleet section is `open` in edit mode (still collapsed on create,
   so a first vehicle stays a short form). Without this the deep links would
   scroll to a hidden element.

Empty fields now read "Not set" with the link, instead of disappearing — that
absence is exactly what hid them.

### Source of truth

| Field | Column | Written by | Second source? |
| --- | --- | --- | --- |
| Next service date | `vehicles.next_service_date` | vehicle form → `updateVehicle` | none |
| Next service mileage | `vehicles.next_service_km` (CHECK ≥ 0) | same | none |
| Inspection / test renewal | `vehicles.test_expiry_date` | same | none |
| Insurance expiry | `vehicles.insurance_expiry_date` | same | none |
| Operational status | `vehicles.operational_status` | form + quick control | displayed via `effectiveStatus` |
| Assigned driver | `driver_assignments` | `assign_driver()` RPC | resolved — see §6 |

Permissions are unchanged: `canWriteFleetData` gates the affordances, the server
action calls `requireFleetWriter()`, and RLS refuses independently. Viewer is
read-only; driver cannot read the fleet table at all.

---

## 6. Driver assignment

Two competing representations, neither aware of the other. Only
`driver_assignments` grants access, so a manager who typed a name into the
vehicle form believed they had assigned a driver who in fact had none.

**`driver_assignments` is authoritative.** Changes:

* The free-text inputs are removed from the vehicle form, and the two keys are
  out of `FIELD_NAMES` so the form no longer posts them.
* **`fleetFieldsToRow()` no longer includes the two columns.** This is the part
  that matters: had they stayed in the payload, every save would have written
  NULL over whatever a fleet manager typed. Omitting them from the UPDATE leaves
  every historical value untouched — asserted by a test that saves a vehicle and
  re-reads the value.
* The vehicle page shows the legacy value, when one exists, as an explicitly
  labelled **Driver contact note** stating that it grants no access and pointing
  at the assignment card. Shown to the roles that can act on it.
* The compliance card carries no driver row at all.
* The fleet list's `driver_assigned` / `driver_unassigned` filters and the
  vehicle subtitle now read real assignments, fetched in **one** org-scoped
  query per list — no N+1.

A role subtlety worth recording: `driver_assignments_select` requires
`can_manage_driver_assignments()`, so a viewer's query returns zero rows. Issuing
it anyway would render every vehicle as "no driver" — a confident wrong answer.
The query is skipped for those roles and `hasAssignedDriver` is `null`, meaning
*unknown*, which matches neither filter.

No migration, no data deleted, and `assign_driver()` / `unassign_driver()` are
untouched.

---

## Files changed

| File | Change |
| --- | --- |
| `lib/fleet/types.ts` | `effectiveOperationalStatus`, declared statuses; `fleetFieldsToRow` drops the driver columns |
| `lib/fleet/alerts.ts` | documents the declared/derived split; re-exports the rule |
| `lib/fleet/service.ts` | `effectiveStatus` + `hasAssignedDriver` on the row; assignment query; counts, filters and sort read the effective status |
| `components/fleet/fleet-vehicle-row.tsx` | nearest expiry removed; effective badge; official assignment in the subtitle |
| `components/fleet/fleet-info-card.tsx` | Service & Compliance; deep links; `LegacyDriverNote`; driver rows removed |
| `components/passports/passport-section.tsx` | one contextual action |
| `components/vehicles/vehicle-form.tsx` | driver inputs removed; section open in edit mode |
| `components/nav-config.ts`, `components/app-nav.tsx`, `components/icons.tsx` | Team & Access entry + icon |
| `app/(app)/layout.tsx` | resolves `canManageOrganization` server-side |
| `app/(app)/vehicles/[id]/page.tsx` | effective badge; passes it down; renders the legacy note |
| `app/(app)/settings/page.tsx` | card renamed to Team & Access |
| `messages/en.json`, `messages/he.json` | new keys both locales; unused labels removed |
| `scripts/validation/qa-quick-wins-check.mjs` | new suite |
| `package.json` | `validate:qa-quick-wins` |

## Tests

`npm run validate:qa-quick-wins` — 62 assertions, 0 failures. Every
authorization assertion runs under a real per-persona JWT; the service role only
builds and inspects fixtures. The rules under test are imported from the shipped
modules.

The required reproduction, as its own numbered sequence: no alerts → not
attention; add an open issue → attention; resolve it → **not** attention; the
stored column unchanged throughout; the three surfaces agree. Plus: a resolved
issue does *not* clear a still-overdue service; each declared status survives
with no live alert to justify it.

Also covered: passport create/open/expired/revoked, history preserved, no
duplicate, cross-org isolation; operational field updates, persistence,
dashboard recalculation, negative mileage rejected, viewer and driver blocked;
assignment grant/revoke, free text granting nothing, historical value surviving
a save, viewer/driver/cross-org all blocked; nav labels in both locales and the
three authorization layers.

Full regression, all green:

| Suite | Assertions |
| --- | --- |
| fleet-tenancy | 51 |
| document-storage | 25 |
| organization-members | 77 |
| fleet-manager | 50 |
| driver-view | 116 |
| fleet-ai-intake | 85 |
| private-vehicle | 120 |
| **qa-quick-wins** | **62** |
| **Total** | **586** |

Six SQL audits: zero findings. TypeScript, ESLint, production build: clean.

**Visual QA** in a real headless Chrome over CDP: 5 screens × 5 widths
(320/375/768/1280/1440) × EN/HE = 50 combinations. **Zero horizontal overflow,
zero sub-32px tap targets, zero unlabelled controls**, every Hebrew page
`dir="rtl"`, and the new copy verified rendering in both locales.

## Remaining risks

1. **`document_expiry` sort survives** while the column it sorts by is no longer
   shown (§2). Deliberate — it was an unresolved founder decision.
2. **Legacy free-text driver values are still in the database** and shown as a
   contact note. Nothing writes them any more, but nothing migrates them to real
   assignments either; that has to be done by hand, per vehicle.
3. **A vehicle manually set to `issue_open` or `needs_service` now displays as
   `active`** once no live alert justifies it. That is the fix working as
   intended, but a user who set the status by hand will see it apparently
   revert. The stored value is intact — only the display is derived.
4. **`hasAssignedDriver` is `null` for viewers**, so the driver filters match
   nothing for them. Correct rather than wrong, but it does mean the filter
   counts differ by role.
5. The deep links depend on the browser honouring a hash into an `open`
   `<details>`. Verified in Chrome; not exercised in Safari or Firefox.

## Manual production checks

After deploying, on a real device:

1. A vehicle with one open issue shows "Needs attention"; resolve it and confirm
   the badge, the dashboard tile and the list filter all clear together.
2. A vehicle marked `out_of_service` stays out of service.
3. Fleet list shows no nearest-expiry column; the dashboard still lists expiring
   documents.
4. Vehicle detail shows exactly one Passport action, and Open lands on the
   current passport.
5. Owner sees Team & Access in the desktop sidebar; a viewer does not; a driver
   sees neither it nor the Fleet screens.
6. Tap a next-service value and land on that field; change it and confirm the
   detail page, the list and the dashboard all update.
7. Confirm no vehicle form offers a free-text driver field, and that a vehicle
   which had one still shows it as a contact note.
8. Assign a driver, sign in as them, confirm Driver View; unassign and confirm
   access is gone.
9. Hebrew/RTL pass over the same screens on a phone.
