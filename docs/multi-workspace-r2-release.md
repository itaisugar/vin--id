# Multi-Workspace R2 Release

Branch: `release/multi-workspace-r2`, cut from `main` at `7583066`.

**Status: M4–M6 APPLIED to production 2026-07-29T10:13:26Z–10:13:30Z.**
Database-only release — nothing merged, nothing deployed, no Vercel change. The
full application was already live from `main`, so the workspace RPCs it calls
became available the moment the migrations landed.

Two items are **outstanding** and are recorded honestly in §9: the browser smoke
test, and removal of three synthetic test accounts.

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

## 9. Outstanding

1. **Three synthetic accounts remain in production** (`r2-synthetic-*`), each with
   an empty personal organization. Production therefore reads 7 users / 7
   organizations / 7 memberships instead of 4 / 4 / 4.

   They cannot be removed through a supported user flow: the application has **no
   DELETE policy on `organizations`** (by design), and deleting the auth user
   first is refused by the last-owner trigger. Removal needs one scoped
   privileged statement, prepared and guarded at
   `scratchpad/prodclean.sh` — it refuses to run unless exactly 4 real users and
   4 real organizations survive, and aborts the transaction if the result is not
   4/4/4. **It has not been run; it needs approval.**

2. **Browser smoke test** — not performed. The deployed URL is not recorded in the
   repository and the Vercel MCP server needs an OAuth authorization this session
   cannot complete. Worth confirming by hand: Settings loads, the Workspace
   Selector lists one workspace marked active with no Switch button, Dashboard,
   Team & Access, documents and Passport all behave.

3. **Vercel runtime logs** — not reviewed, same reason. Database-side logs were:
   0 application events and 0 auth entries since the release, no SQL error, no RLS
   recursion, no multiple-row subquery failure in any probe.

---

## 10. Remaining product work

Unchanged by this release, and deliberately out of scope:

* post-signup Personal/Organization onboarding
* short invitation codes
* real invitation email delivery (invitations are shared by Copy Link)

No defect was found in the application code, so nothing was deployed.
