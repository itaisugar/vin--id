# Multi-Workspace R2 Release

Branch: `release/multi-workspace-r2`, cut from `main` at `7583066`.

**Status: M4–M6 APPLIED to production 2026-07-29T10:13:26Z–10:13:30Z.**
Database-only release — nothing merged, nothing deployed, no Vercel change. The
full application was already live from `main`, so the workspace RPCs it calls
became available the moment the migrations landed.

**Update 2026-07-30 (§11): synthetic-account cleanup COMPLETE.** Of the three
synthetic accounts, one was retained as a permanent production QA account and two
were removed by a guarded, single-transaction, audited cleanup. Production is back
to a real **5 / 5 / 5 / 5** (five accounts = four founder accounts + one QA), all
audits clean. The **browser smoke test remains outstanding** — it needs the
deployed URL and an interactive login, neither available to the tooling in a
non-interactive session (§9, §11).

---

## 1. Boundary

| | |
| --- | --- |
| branch / commit | `release/multi-workspace-r2` / `7583066` |
| project | `jsthfmgvcdrfzpgkpwvt` |
| applied before | 40 (including M1–M3 from R1) |
| pending | exactly 3 |
| reverse drift | none |

Pending versions: `20260729150000` (M4 membership cardinality),
`20260729160000` (M5 invitation acceptance), `20260729170000` (M6 workspace RPCs).

### SQL risk summary

A statement scan found **no `drop table`, `drop column`, `truncate` or `delete`**
anywhere in the three files, and **no DML outside function bodies** — so the
migrations changed zero rows at apply time. The only DDL drops are two constraint
drops in M4: one an idempotency guard for the constraint it creates two lines
later, one the intended `UNIQUE(user_id)` swap.

M4's ordering is what makes it safe: it refuses to run if any duplicate
`(organization_id, user_id)` exists, creates the replacement constraint **before**
dropping the old one, and updates `handle_new_user`'s conflict target in the
*same* migration — splitting those would break signup outright.

---

## 2. Backup

`/Users/itai/Desktop/vin-id-production-backups/20260729-101133-r2-premigration/`

schema.sql (150,937 B), data.sql (107,756 B), roles.sql, migration-state.txt,
storage-inventory.txt, row-counts.txt. **All six SHA-256 checksums verified.**
PITR is off, so this is the recovery point.

Pre-release: 4 users · 4 profiles · 4 organizations (3 personal, 1 business) ·
4 memberships · 0 multi-membership users · 7 vehicles · 4 documents ·
15 passports · 9 maintenance · 7 issues · 1 pending invitation · 4 storage
objects (3,689,919 B) · 0 active pointers set.

---

## 3. Dry run and apply

Dry run listed exactly M4, M5, M6 — no replay of M1–M3, nothing unrelated.

Applied 10:13:26Z → 10:13:30Z, all three OK. One notice, unfiltered:
`constraint "organization_members_org_user_unique" ... does not exist, skipping`
— M4's own idempotency guard. History **40 → 43**.

---

## 4. Schema verification

### M4

| Check | Result |
| --- | --- |
| `UNIQUE(user_id)` absent | ✓ |
| `UNIQUE(organization_id, user_id)` present | ✓ |
| `handle_new_user` conflict target valid | ✓ |
| `organization_members_user_idx` present | ✓ |
| last-owner trigger intact | ✓ `organization_members_protect_last_owner` |
| memberships unchanged | 4 → 4 |

### M5 — `accept_invitation()`

No personal-organization deletion path remains ✓ · idempotent
`on conflict (organization_id, user_id) do nothing` ✓ · email mismatch enforced ✓ ·
revoked/expired handled ✓ · inviter-selected role preserved ✓ · personal→business
promotion present ✓ · active organization set only after successful acceptance ✓.

### M6

Both RPCs exist, `SECURITY DEFINER` with `search_path=""`, and **revoked from
`anon`, granted only to `authenticated`**. Confirmed live through PostgREST:
`list_my_workspaces` and `set_active_organization` (called with its real
`p_organization` argument) both return `42501 permission denied` for `anon` —
which is the proof they are in the schema cache *and* correctly gated. The
deployed client sends exactly `p_organization`.

---

## 5. Integrity

**Row counts identical in every table**, pre- versus post-migration — M4–M6
changed zero rows, as the SQL scan predicted. No user, profile, organization,
membership, vehicle, document, passport, token or driver assignment was created,
deleted or moved. Storage unchanged: private bucket, 4 objects, 3,689,919 bytes.

All four existing users, impersonated read-only under their own identities:

| Resolves to own organization | Role unchanged | Vehicles visible | `list_my_workspaces` |
| --- | --- | --- | --- |
| 4 / 4 | 4 / 4 (all owner) | 2, 4, 0, 1 — each equal to its own organization | 1 each |

No active pointer references an inaccessible organization. Zero duplicate
memberships, zero ownerless organizations, zero personal organizations with more
than one member.

---

## 6. Production audits — all clean

RLS on every org-scoped table ✓ · every SECURITY DEFINER function pins
`search_path` ✓ · zero NULL `organization_id` ✓ · zero cross-organization child
rows ✓ · zero duplicate memberships ✓ · zero ownerless organizations ✓ · zero
personal organizations with multiple members ✓ · zero invalid active pointers ✓ ·
zero driver assignments outside their organization ✓ · storage bucket private ✓.

### A production hardening worth recording

`anon` **and `service_role` both hold zero table privileges** on all 22 public
tables in production; only `authenticated` has SELECT. `service_role` carries
`BYPASSRLS`, but that is irrelevant without a GRANT — so a leaked service-role
key cannot read a single application row over PostgREST.

This is stricter than local Supabase, and it is a good property. It also means
**production fixtures cannot be built with the service role** — every test
against production must drive real user JWTs. That is a better methodology, but
it changed how the multi-workspace test had to be written (§8).

---

## 7. Local gate (identical migrations)

Clean `db reset` with all six migrations:

| Suite | Assertions |
| --- | --- |
| fleet-tenancy | 51 |
| document-storage | 25 |
| organization-members | 79 |
| fleet-manager | 50 |
| driver-view | 116 |
| fleet-ai-intake | 85 |
| private-vehicle | 120 |
| qa-quick-wins | 62 |
| multi-workspace | 57 |
| **total** | **645, zero failures** |

Eight SQL audits clean, TypeScript clean, ESLint clean, production build clean.
Signup verified working after the constraint swap: one membership, `kind`
personal, active pointer set — the specific failure M4 was designed to avoid.

The multi-workspace suite's 57 assertions cover, under real JWTs: personal +
A + B, a different role in each, switching in both directions with persistence
across a fresh sign-in, acceptance preserving the personal workspace and its
vehicles, replay, wrong email, revoked, expired, already-member, forged pointer,
stale pointer after membership removal, duplicate membership, viewer write
refusal and driver isolation.

---

## 8. Production multi-workspace test — INCOMPLETE

Three synthetic accounts were created through the **public signup flow** on
production. Signup worked correctly: each received one personal organization,
one owner membership and a profile, confirming `handle_new_user` is healthy after
the constraint change.

The test then stalled on the privilege discovery in §6 — it had been written to
build fixtures with the service role, which production correctly forbids. The
authorization assertions were never reached, so **no multi-workspace behaviour
was exercised against production**.

Rewriting it to drive real user JWTs is straightforward: every policy it needs
exists (`organizations_update_own`, `org_invitations_insert_admin`,
`org_members_delete_admin`, `vehicles_*`, `profiles_update_own`). What blocks it
is cleanup, not the test — see §9.

**Nothing real was touched.** Every founder-owned count is identical to the
pre-release backup: 7 vehicles, 4 documents, 15 passports, 9 maintenance,
7 issues, 1 invitation, 4 storage objects. The three synthetic organizations are
empty — no vehicles, no invitations, no documents.

The one real pending invitation was deliberately left alone. It is now *newly
acceptable* because of M5: its recipient already has an account, a personal
workspace and four vehicles — exactly the case the pre-M5 function refused with
`already_member`.

---

## 9. Outstanding (as of the 2026-07-30 cleanup)

1. ~~Three synthetic accounts remain in production.~~ **RESOLVED — see §11.** One
   retained as production QA, two removed. Production is 5 / 5 / 5 / 5.

2. **Browser smoke test** — still not performed. The deployed URL is not recorded
   in the repository, `APP_PUBLIC_URL` in `.env.local` is `http://localhost:3000`,
   and the Vercel MCP server needs an OAuth authorization a non-interactive session
   cannot complete. It must be done through the founder's interactive browser
   session using the retained QA account (§11). No browser result has been
   invented. The full checklist to run is preserved in §11.

3. **Vercel runtime logs** — still not reviewed, same reason. Database-side logs
   on 2026-07-30 after cleanup: `auth.audit_log_entries` empty (rotated), 0
   `app_events` since the cleanup window, no SQL error and no trigger failure —
   the cleanup transaction committed with every guard passing.

---

## 10. Remaining product work

Unchanged by this release, and deliberately out of scope:

* post-signup Personal/Organization onboarding
* short invitation codes
* real invitation email delivery (invitations are shared by Copy Link)

No defect was found in the application code, so nothing was deployed.

---

## 11. Synthetic-account cleanup — 2026-07-30

Founder decision: **keep one** of the three synthetic accounts as a permanent
production QA account, **remove the other two** via a guarded audited cleanup, and
do not run the earlier "delete all three" script (`scratchpad/prodclean.sh`, now
superseded).

### 11.1 Inventory of the three synthetic accounts (read-only)

All identifiers masked. Every account was created 2026-07-29T10:18:46Z through the
public signup flow, confirmed, with a password from the validation-suite
convention.

| account | uid | created (sub-sec) | profile | org | kind | memb / role | vehicles | maint | issues | reminders | docs | extractions | passports | tokens | driver asg | invitations | storage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| joiner   | `f2fb4001` | .119180 | ✓ | `179f231d` | personal | 1 / owner | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| companyb | `c183f745` | .569358 | ✓ | `bc9d4522` | personal | 1 / owner | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| companyc | `221ece20` | .755052 | ✓ | `b239e9bd` | personal | 1 / owner | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

A dynamic census across **every** foreign key of `auth.users` and
`organizations` confirmed the only rows referencing any of the three are each
account's own profile, own membership, and its profile's self-pointers to its own
personal org. Nothing else in 22 tables references them.

### 11.2 Retained QA account — selection

All three are identical on every deterministic criterion (confirmed auth · valid
profile · single personal org · exactly one owner membership · no vehicle/record
data · no invitations · no storage objects). The tiebreak was **earliest creation
timestamp**, which selects **`f2fb4001` (`r2-synthetic-joiner-…@…`)**. It is also
the semantically correct choice — the "joiner" account was designed to *join*
other workspaces, exactly the QA-tester role. Its personal org is `179f231d`
(`R2 Synthetic joiner`, kind `personal`).

**This account is production QA. Exclude it from all product and traction
metrics.** Its full email is not recorded here; the masked prefix is
`r2***@e***` on an `example.com` address (undeliverable by design — no real
mailbox, so no password reset).

### 11.3 Two accounts removed

`c183f745` (companyb, org `bc9d4522`) and `221ece20` (companyc, org `b239e9bd`).

### 11.4 Cleanup guards and method

A fresh production backup was taken first:
`/Users/itai/Desktop/vin-id-production-backups/20260730-135120-r2-precleanup/`
(schema.sql, data.sql, roles.sql, migration-state, storage-inventory, row-counts;
all six SHA-256 checksums verified). PITR is off, so this is the recovery point.

The cleanup ran as **one transaction** (`ON_ERROR_STOP`, so any failed guard
rolls the whole thing back). It uses **hardcoded UUIDs only** — no `LIKE`/pattern
match is ever used to pick a row to delete, so a real account cannot be caught by
accident.

**Before-guards (abort unless all hold):** exactly 7 auth users / 7 profiles /
7 orgs · all 4 originals present · all 3 synthetics present · the retained QA id
explicitly excluded from the target set · **each** target has exactly one profile,
one personal org, one sole-owner membership, and **zero** of vehicles, maintenance,
issues, reminders, documents, extractions, passports, tokens, driver assignments,
invitations, inspection/insurance/registration, ownership transfers, audit logs,
app events, beta feedback, diagnosis rows, and storage objects · a dynamic FK
backstop asserting no reference to either target exists anywhere beyond its own
profile + membership self-rows.

**Order (derived from the real FKs + the last-owner trigger):** for each target,
`organizations` first, then `profiles`, then `auth.users`. The
`protect_last_owner` trigger has an explicit escape hatch — when the parent org
row is already gone it lets the `organization_members … ON DELETE CASCADE` through
— so deleting the org first removes the sole-owner membership *without* disabling
any trigger or RLS. Deleting the org also `SET NULL`s the target profile's org
pointers (harmless; the profile is deleted next). Deleting the auth user cascades
its `auth.identities/sessions/…`. **No trigger and no RLS was disabled.**

**After-guards (abort unless all hold):** exactly 5 auth users / 5 profiles /
5 orgs / 5 memberships · retained QA present and intact (personal org, sole owner,
active pointer = personal) · all 4 originals present · both targets fully gone
(user, profile, org, membership) · zero orphan profiles · zero memberships with a
missing user or org · every org has an owner · zero rows still pointing at a
deleted org (12 org-scoped tables + profile pointers) · founder counts unchanged
(vehicles 7, documents 4, passports 15, maintenance 9, issues 7, invitations 1) ·
storage unchanged (4 objects, 3,689,919 bytes).

The transaction was **rehearsed first with `commit` replaced by `rollback`**
against live production: it executed all six deletes, passed every after-guard,
and rolled back, proving correctness on real data before the real run. Both the
rehearsal and the committed run reported `PRE-GUARDS PASSED` and
`POST-GUARDS PASSED`.

### 11.5 Before / after counts

| | before | after |
| --- | --- | --- |
| auth users | 7 | **5** |
| profiles | 7 | **5** |
| organizations | 7 | **5** |
| memberships | 7 | **5** |
| org kinds | 4 personal + 1 business (+2 synth personal) | **4 personal + 1 business** |
| vehicles / documents / passports | 7 / 4 / 15 | 7 / 4 / 15 |
| maintenance / issues / reminders | 9 / 7 / 2 | 9 / 7 / 2 |
| tokens / extractions / driver asg | 15 / 3 / 0 | 15 / 3 / 0 |
| invitations | 1 | 1 |
| storage objects / bytes | 4 / 3,689,919 | 4 / 3,689,919 |

### 11.6 Final audits — all clean

5 / 5 / 5 / 5 · 4 personal + 1 business · **zero** users with multiple
memberships · **zero** duplicate memberships · **zero** ownerless organizations ·
**zero** invalid active pointers · **zero** orphan profiles / memberships ·
**zero** cross-organization child rows · **zero** NULL `organization_id` on
org-scoped tables · storage count and bytes unchanged, all 4 objects founder-owned
(`e2faa5ed`) · founder row counts unchanged · the one real pending invitation
(`bd259506`, status `pending`, org `5a754ce7`, inviter `dbb35aaa`) **untouched**.

The retained QA account ends with **zero business memberships**, zero vehicles and
zero records — exactly the Part-4 target state — because the browser validation
that would have added and then removed a Business membership has not yet run.

### 11.7 Browser validation — STILL PENDING (must be founder-driven)

Not performed. It requires the deployed production URL and an interactive login,
neither available to a non-interactive session; the Vercel MCP connector is
unauthorized here. **No browser outcome has been invented.** Run it by hand with
the retained QA account (`f2fb4001`):

* **Initial Personal state** — login succeeds; Settings loads; one Personal
  workspace listed and active; no Switch button; no vehicle data; no other org.
* **Controlled invitation** — from the Business org (`numa dad`, `5a754ce7`),
  invite the QA account as **Viewer** via **Copy Link** (never email; never touch
  the real pending invitation `bd259506`). Preview must show the correct Business
  org, Viewer role, correct recipient, valid state.
* **Accept** — accept explicitly; replay adds no second membership; Personal
  workspace and its `personal` kind survive; Business stays `business`; Business
  becomes active; role is Viewer.
* **Switching** — selector lists Personal + Business; active clearly indicated;
  switch both ways; refresh preserves selection; logout/login resolves a valid
  workspace; no prior-workspace data bleeds through.
* **Viewer security in Business** — read-only: cannot create/edit vehicles,
  maintenance, issues; cannot upload/confirm Fleet AI Intake; cannot assign
  drivers; cannot manage members/invitations; cannot reach another org by direct
  URL.
* **Personal isolation** — no Business vehicles, driver data, costs, or documents
  appear in Personal; Viewer role does not change Personal ownership behaviour.
* **Stale-pointer** — remove the QA Viewer membership from Business (this is a
  non-owner membership, so the last-owner invariant is not touched); access is
  revoked immediately; no stale active-org data leak; safe fallback to Personal;
  selector lists only Personal; Business direct URLs blocked.

After the test, the QA account must again be left with **zero business
memberships** — which is already its state now.

### 11.8 Remaining onboarding / email work (unchanged)

* post-signup Personal/Organization onboarding
* short invitation codes
* real invitation email delivery (invitations are shared by Copy Link)
