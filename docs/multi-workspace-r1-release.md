# Multi-Workspace R1 Release

Branch: `release/multi-workspace-r1`, cut from `main` at `96b9be1`.

R1 ships the additive half of the multi-workspace foundation — M1, M2, M3 — and
keeps `UNIQUE(user_id)` in force. One membership per user, exactly as production
behaves today. M4 (the irreversible cardinality change), M5 and M6 are held for
R2 and are **absent from this branch**, which is the mechanism that keeps
`db push` away from them.

**Status: APPLIED to production 2026-07-29T09:49:16Z–09:49:20Z.** See §0.

---

## 0. Release record — M1-M3 applied to production

Applied from `release/multi-workspace-r1` at `ecee036`, project
`jsthfmgvcdrfzpgkpwvt`, over the IPv4 session pooler. Database-only release: no
merge, no deploy, no Vercel change. The application was already running from
`main` (`7583066`), which includes the Settings fallback.

### Boundary and dry run

37 migrations applied on both sides, **3 pending**, zero drift in either
direction. `db push --dry-run` listed exactly:

```
20260729120000_organization_kind.sql
20260729130000_active_organization.sql
20260729140000_membership_helpers_multi.sql
```

A statement scan of the three files found no `drop table`, `drop column`,
`truncate` or `delete`. The single `drop constraint if exists
organizations_kind_check` is M1's own idempotency guard for a constraint it
creates two lines later. The only DML is the `kind` backfill.

### Backup

`/Users/itai/Desktop/vin-id-production-backups/20260729-094655-r1-premigration/`
— schema.sql (146,526 B), data.sql (107,674 B), roles.sql, migration-state.txt,
storage-inventory.txt, row-counts.txt. **All six SHA-256 checksums verified.**

### Applied

| | |
| --- | --- |
| start / end | 2026-07-29T09:49:16Z → 09:49:20Z |
| result | all three OK, no error |
| notices | `constraint "organizations_kind_check" … does not exist, skipping` (expected); `organization_kind: 4 organizations, 3 classified personal` |
| history | 37 → **40** applied; the three added are exactly M1-M3 |

### Classification — matched the approved audit exactly

**3 personal, 1 business, 0 null or invalid.** No manual repair was needed and
none was performed; the §5 contingency plan was not executed.

| Organization | kind | Approved |
| --- | --- | --- |
| `e4149df3…` | personal | ✓ |
| `89a499fc…` | personal | ✓ (the one flagged for optional confirmation) |
| `5917ba63…` | personal | ✓ |
| `5a754ce7…` | business | ✓ (holds the pending third-party invitation) |

Invariant holds: every `personal` organization has exactly one member.

### Active organization pointer

4 profiles, **0 pointers set, 4 NULL** — no backfill, as designed. No profile
points at an organization it is not a member of. Column nullable, FK
`on delete set null`.

The forged-pointer test was **not** run against production: it requires a write,
and the release used a read-only session throughout. It was verified locally on
the identical schema — a pointer aimed at a non-member organization is not
honoured, resolution falls back to the user's own workspace, and zero rows leak.

### Helpers and resolution, under real production identities

All nine SECURITY DEFINER functions carry `search_path=""`. `is_personal_workspace`
grants EXECUTE to `authenticated` only — `anon` is revoked.

Each of the four production users was impersonated in a read-only transaction:

| Resolved to own organization | Role matches membership | Vehicles visible |
| --- | --- | --- |
| 4 / 4 | 4 / 4 | 2, 4, 0, 1 — each equal to its own organization's count |

Determinism: 5 consecutive `current_org_id()` calls per user, **0
non-deterministic users**. Anonymous: `current_org_id()` NULL, `is_org_writer`
and `is_org_admin` false, and every private table refused at the privilege layer
(`42501 permission denied`) — stronger than RLS returning zero rows.

`UNIQUE(user_id)` still in force. M4, M5 and M6 confirmed absent.

### Integrity

**Row counts identical in every table**, pre- versus post-migration (`diff`
clean across all 22 public tables plus `auth.users` and `storage.objects`). No
user, profile, organization, membership, vehicle, document, Passport, token or
driver assignment created, deleted or moved. Storage bucket still private, 4
objects, 3,689,919 bytes unchanged. Zero new NULL organization IDs, zero
cross-organization child rows. All 4 auth sessions remained valid — nobody was
logged out.

### Application verification

Verified against the live production API, which is what the deployed app uses:

* `POST /rest/v1/rpc/list_my_workspaces` → **PGRST202**, precisely the code the
  deployed fallback keys on. The Settings page therefore takes the fallback path
  and renders one active workspace with no Switch button.
* PostgREST's hint suggests `public.is_personal_workspace` — proof its **schema
  cache reloaded** and knows the objects M3 just created.
* Anonymous: `42501 permission denied` on `vehicles`, `profiles`,
  `organization_members` and `vehicle_documents`. No private data exposed.

**Not performed:** the authenticated browser smoke test (Dashboard, vehicles,
documents, Passport, Team & Access, Service & Compliance, Driver Assignment) and
the Vercel runtime log review. The deployed URL is not recorded in the repository
and the Vercel MCP server requires an OAuth authorization this session cannot
complete; logging in would also need production credentials, and modifying Auth
users was out of scope. **This remains open for the founder** — see §0a.

Database-side logs were reviewed instead: 0 application events and 0 auth audit
entries since the migration (nobody has used the app in the interval), and no SQL
error, RLS recursion or multiple-row subquery failure in any probe.

---

## 0a. Open items for the founder

1. **Authenticated smoke test.** Log in and walk Dashboard → vehicles →
   maintenance → issues → reminders → documents → Passport → Settings → Team &
   Access. The specific thing to confirm is that **Settings loads without a 500**
   and shows exactly one workspace with no Switch button.
2. **Vercel runtime logs** — check for Settings 500s or missing-RPC errors.
3. **`89a499fc…` is now labelled Personal.** Evidence supported it (one member,
   never invited anyone, name never edited). If it is really a company, say so and
   it becomes a one-row `kind` correction. Nothing depends on it: `kind` grants no
   authorization, and R2's M5 promotes it automatically the moment anyone joins.

---

## 0b. Deviation from the release brief

The brief expected **two** Auth users and two profiles at preflight. Production
has **four** users, four profiles, four organizations and four memberships —
identical to the audit these classification decisions were approved from, so
nothing had changed and this was not treated as a blocker. The brief's figure was
stale.

---

## 1. How this branch came about

The original plan assumed `main` contained only the Quick Wins, with the
multi-workspace work still on a feature branch. It does not: **PR #8 merged the
entire `feat/multi-workspace-foundation` branch into `main`** (`96b9be1`), so
`main` now carries all six migrations and the workspace switcher UI.

That created a live hazard, since merging to `main` does not migrate production:

| | state |
| --- | --- |
| production database | 37 migrations applied, **none of M1-M6** |
| `main` application code | requires `organizations.kind`, `profiles.active_organization_id`, `list_my_workspaces()`, `set_active_organization()` |

`listWorkspaces()` rethrew the resulting error, so the Settings page — the way
into Team & Access on a phone — would have returned a server error in
production. The build succeeds, so a deploy would have looked green.

Fixed on `fix/settings-workspace-fallback` (commit `4049d81`, cherry-picked here):
`listWorkspaces()` now falls back to the single workspace a pre-migration schema
can describe. The guard matches only "this function does not exist"
(42883 / PGRST202) — permission errors, connectivity failures and genuine bugs
still throw, because quietly showing one workspace to a user who has several
would be worse than an error.

Verified against a real pre-migration database: PGRST202 is the code that comes
back, the fallback's own queries succeed, and the columns it deliberately avoids
are absent as expected. **That branch should reach `main` regardless of R1's
timing** — it is what makes `main` safe to deploy before the migrations run.

### What this means for the R1 boundary

Because `main` holds M4-M6, this release branch **deletes** those three files
rather than simply not having them. `main` and this branch therefore diverge,
and `main` must not be the production migration source until R2.

---

## 1a. Superseded blocker (retained for the record)

`origin/main` = `61f6c87` (`Merge pull request #6 from fleet-lite-phase-1`).

The Quick Wins commits `7caf489`, `2b77a97`, `5dee03c` exist only on
`origin/fix/production-qa-quick-wins`. Verified by content, not by commit graph:

| Quick Wins marker | `main` | `fix/production-qa-quick-wins` |
| --- | --- | --- |
| `effectiveOperationalStatus` | absent | 5 files |
| `DECLARED_OPERATIONAL_STATUSES` | absent | 2 files |
| `teamAccessNavItem` (Team & Access nav) | absent | 3 files |
| `LegacyDriverNote` (Service & Compliance) | absent | 5 files |
| obsolete `document_expiry` sort | **still present** | still present* |

\* The obsolete sort removal is a *filter/sort surface* change; the `document_expiry`
deadline **type** legitimately remains in both. The distinguishing marker is
`effectiveOperationalStatus`, which is absent from `main` entirely.

Building `release/multi-workspace-r1` from `main` today would produce a release
branch that **regresses the Quick Wins**. That is the substantive reason to stop,
beyond the instruction to do so.

**Unblock:** merge `fix/production-qa-quick-wins` into `main`, then re-run this task.

---

## 2. R1 boundary — proven, not assumed

### Migrations

| ID | File | R1? | Depends on M4–M6 | Old-code compatible | Rollback |
| --- | --- | --- | --- | --- | --- |
| M1 | `20260729120000_organization_kind.sql` | **yes** | no | yes — old code never reads `kind` | drop column |
| M2 | `20260729130000_active_organization.sql` | **yes** | no | yes — nullable, no backfill | drop column |
| M3 | `20260729140000_membership_helpers_multi.sql` | **yes** | no | yes — same result at cardinality 1 | restore prior bodies |
| M4 | `20260729150000_membership_cardinality.sql` | no | — | drops `UNIQUE(user_id)` | **irreversible once used** |
| M5 | `20260729160000_accept_invitation_multi.sql` | no | requires M4 unique target | requires M4 | restore prior body |
| M6 | `20260729170000_switch_workspace.sql` | no | meaningless before M4 | n/a | drop functions |

The commit split is exact: `ae6966b` contains M1–M3 and nothing else; `cd10ea7`
contains M4–M6 and nothing else. No file-level surgery is needed on the migrations.

### Application commits — *not* cleanly separable at commit granularity

| Commit | R1? | Reason |
| --- | --- | --- |
| `1cd0fb4` `lib/organizations/service.ts` | **yes, with the fallback** | `listWorkspaces()` and `switchWorkspace()` call M6 RPCs. Rather than strip them, `4049d81` makes `listWorkspaces()` fall back when the RPC is absent — which is what R1 needs anyway, and what makes `main` safe to deploy pre-migration. |
| `22c2f6e` workspace selector UI | **yes, inert** | With the fallback it renders one workspace, marked active, with no Switch button (the button is only drawn for *inactive* entries). The M6 RPC is therefore unreachable from the UI on R1. Functionally equivalent to today: a read-only statement of which organization you are in. |
| `75ff482` tests + fixtures | **yes, made dual-mode** | See below. |
| `e842d3c` docs | yes | Documentation only. |

Keeping the selector rather than reverting it is deliberate: it holds this branch
to `main` *minus three migration files plus one commit*, which is the smallest
possible divergence and the least painful merge at R2.

### The fixture blocker, and how it was resolved

`scripts/validation/lib/org-fixtures.mjs` used `onConflict: "organization_id,user_id"`
in `joinOrg` and `addMembership`. That unique index is created by **M4**. On an
R1-only schema every suite died in the harness before asserting anything:

```
joinOrg(admin): there is no unique or exclusion constraint
matching the ON CONFLICT specification
```

Measured first: 9 suites, 9 harness failures, 0 assertions reached.

The fixtures now **discover** the conflict target instead of assuming it (one
failed attempt on 42P10, memoised), and `hasMultiMembership()` lets a suite assert
what the release under test actually promises. Three assertions became
release-aware rather than release-specific:

* a membership in a second organization — *allowed* under R2, *rejected with
  23505* under R1;
* `roleOf()` with no active pointer — falls back to the sole membership, which
  under `UNIQUE(user_id)` is the complete answer rather than a guess (nothing
  writes the pointer before M4/M5, so it is always NULL on R1);
* the invitee's personal workspace — *kept* under R2, *consumed* under R1, which
  is the pre-M5 behaviour R1 knowingly ships.

One fixture file now serves both releases, so there is no merge conflict at R2.

**Conclusion:** R1 can be isolated safely. It is `main`, minus M4-M6, plus the
fallback commit.

---

## 3. R1 schema under the old constraint — measured

Clean `supabase db reset` with M1–M3 only, M4–M6 removed from the directory.

| Property | Result |
| --- | --- |
| `organization_members_user_unique UNIQUE (user_id)` | **still present** |
| `organizations.kind`, `profiles.active_organization_id` | present |
| `list_my_workspaces`, `set_active_organization` | **absent** (confirms the UI dependency) |
| `accept_invitation` | still the **old** body — deletes the personal org, no `(organization_id, user_id)` conflict target |
| `handle_new_user` | conflict target still `(user_id)`; writes `kind='personal'` |
| Signup end to end | **works** — membership created, `kind='personal'`, exactly 1 membership |
| `current_org_id()` with NULL pointer | resolves to the sole membership; `is_org_writer`, `is_org_admin`, `is_personal_workspace` all true |
| Determinism | 5 consecutive calls → **1 distinct result** |
| Second membership insert | **rejected**, `unique_violation` — cardinality unchanged |
| Forged `active_organization_id` at a non-member org | not honoured; falls back to own org; **0 foreign rows leaked**; 1 org visible |

R1 therefore preserves one-membership-per-user behaviour exactly, and the new
active-organization pointer grants nothing before M4 exists.

### Compatibility matrix

| Combination | Verdict |
| --- | --- |
| Old schema + old code | Baseline. Current production. |
| **R1 schema + old code** | **Supported** — measured above. `kind` and `active_organization_id` are additive and unread by old code; M3 helpers return identical results at cardinality 1. This is the state during the migrate-then-deploy window. |
| **Old schema + R1 code** | **Degraded, not broken.** Measured on a database with all six migrations removed: `list_my_workspaces` is absent (PGRST202) and the fallback returns the user's single workspace, so Settings renders. Beyond that, `resolveDefaultOrganization()` still selects `organizations.kind` and would fail — but it has no call sites, so no request path reaches it. **Prefer migrate-then-deploy regardless**; this row describes the safety net, not the plan. |
| **R1 schema + R1 code** | **Full R1 behaviour.** 603 assertions across 9 suites, 8 SQL audits, typecheck, lint and production build — all clean. See §8a. |

---

## 4. Production organization inventory

Project `jsthfmgvcdrfzpgkpwvt`, read-only session
(`default_transaction_read_only = on`). Identifiers abbreviated; no names, emails,
document contents or OCR were read into this document.

4 organizations · 4 auth users · 4 profiles · 4 memberships · **0 users hold more
than one membership** · all 4 profile pointers agree with their membership and role.

| Org | Created | Members | Roles | Vehicles | Docs | Invites | Assignments |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `e4149df3…` | 2026-07-27 10:52:24 | 1 | owner | 2 | 0 | 0 | 0 |
| `89a499fc…` | 2026-07-27 10:52:24 | 1 | owner | 4 | 4 | 0 | 0 |
| `5917ba63…` | 2026-07-28 07:04:02 | 1 | owner | 0 | 0 | 0 | 0 |
| `5a754ce7…` | 2026-07-28 07:07:24 | 1 | owner | 1 | 0 | **1 pending** | 0 |

### Provenance — this matters for classification

`e4149df3` and `89a499fc` share an **identical** `created_at`. That is a migration
signature, not two signups. They were created by `20260722120000`, which loops over
`public.profiles` and inserts **one organization per existing user**, named from
that user's own `full_name` / email local part — semantically identical to the
signup trigger. Their member rows land in the same transaction, so the M1
"created within 1 second" condition is satisfied by construction.

This means condition 3 of the M1 backfill does **not** distinguish "signup trigger"
from "one-org-per-user migration". Both are system-generated single-user
workspaces, so the classification still holds — but the evidence below is what
actually justifies it, not the timestamp.

### Independent evidence

| Org | Name still system-derived | Org row edited since creation | Rows owned by a non-member | Vehicles predating the org |
| --- | --- | --- | --- | --- |
| `e4149df3…` | yes (email local part) | no | 0 | 2 of 2 |
| `89a499fc…` | yes (signup `full_name`) | no | 0 | 3 of 4 |
| `5917ba63…` | yes (signup `full_name`) | no | 0 (org is empty) | — |
| `5a754ce7…` | yes (signup `full_name`) | no | 0 | 0 of 1 |

No organization has ever been renamed. No organization holds a row belonging to
anyone other than its sole member. `contact_name` on `89a499fc` was written by the
migration from the user's own profile, not by a user edit.

### Proposed classification

| Org | Proposed | Confidence | Founder confirmation |
| --- | --- | --- | --- |
| `e4149df3…` | **Personal** | high | not required |
| `89a499fc…` | **Personal** | high | *optional* — see below |
| `5917ba63…` | **Personal** | high | not required |
| `5a754ce7…` | **Business** | high | not required |

`5a754ce7` stays Business because it fails condition 4: it holds a **pending
`fleet_manager` invitation to a third party**, created 2026-07-28. That is
deliberate team intent, and the conservative rule is working exactly as designed.

**The M1 backfill, run against production as written, produces precisely this
result** — verified by executing the backfill's own predicate as a read-only
dry run: it selects `e4149df3`, `89a499fc`, `5917ba63` and nothing else.

**No ambiguous organizations. No repair rows required.**

The one judgement worth surfacing: `89a499fc` holds the most real data (4 vehicles,
4 documents). Under the founder's stated rule — one member, never invited anyone —
it is Personal. If it is in fact a company that simply has not invited anyone yet,
the only consequence is that the UI labels it "Personal"; `kind` grants no
authorization, and M5 promotes it to Business automatically the moment anyone
joins. Cost of being wrong is a label, and it self-corrects.

---

## 5. Classification repair plan — contingency only, do not execute

The backfill covers all three Personal organizations, so this plan is a
**contingency** for the case where post-migration verification shows a mismatch.
Run only after step 6 of the release sequence reports an unexpected result.

```sql
-- Idempotent. Touches organizations.kind and nothing else.
-- Preserves memberships, vehicles, documents, Passport rows and Storage objects:
-- no other table is named.
do $$
declare
  v_expected uuid[] := array[
    'e4149df3-2c5f-4176-91a4-d297a90c6c1d',
    '89a499fc-456b-4187-a960-b07f11e753e7',
    '5917ba63-cff9-4620-b341-b2e81953ce38'
  ]::uuid[];
  v_before int;
  v_after  int;
  v_touched int;
begin
  -- Fail loudly if the target set is not what was audited.
  if (select count(*) from public.organizations where id = any(v_expected)) <> 3 then
    raise exception 'repair: expected exactly 3 approved organizations to exist';
  end if;

  -- Fail loudly if any approved organization has gained a member since the audit.
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = any(v_expected)
    group by m.organization_id having count(*) <> 1
  ) then
    raise exception 'repair: an approved organization no longer has exactly one member';
  end if;

  select count(*) into v_before from public.organizations where kind = 'personal';

  update public.organizations
     set kind = 'personal'
   where id = any(v_expected)
     and kind is distinct from 'personal';
  get diagnostics v_touched = row_count;

  select count(*) into v_after from public.organizations where kind = 'personal';

  if v_after > 3 then
    raise exception 'repair: % personal organizations after repair, expected at most 3', v_after;
  end if;
  raise notice 'repair: % personal before, % touched, % after', v_before, v_touched, v_after;
end $$;
```

Before/after verification:

```sql
select kind, count(*) from public.organizations group by kind;              -- expect personal=3, business=1
select o.id from public.organizations o                                     -- expect 0 rows
  join public.organization_members m on m.organization_id = o.id
 where o.kind = 'personal' group by o.id having count(*) <> 1;
```

Organizations left Business for later manual review: **`5a754ce7…`** — revisit only
if the founder states it is a personal workspace, which its pending third-party
invitation contradicts.

---

## 6. Invitation and active-workspace scope

`accept_invitation()` changes belong to **R2**, not R1. The M5 body inserts with
`on conflict (organization_id, user_id)`, a target that does not exist until M4;
shipping it in R1 would break acceptance outright.

R1 therefore keeps the current production behaviour, including its known defect:
an invitee who owns any vehicle receives `already_member` and cannot join. R1 is
*no worse* than production, which is the stated bar — but it is also **no better**,
so the pending invitation on `5a754ce7` will still fail if that invitee owns a
vehicle. That defect is fixed by R2, not R1.

`profiles.active_organization_id` ships in R1 unused and always NULL: nothing
writes it (M5 and M6 both being R2), and `current_org_id()` falls through to the
same personal-then-oldest resolution that reproduces today's behaviour.

### Known R1 gap — a `personal` organization can gain a second member

Found by a test that was passing for the wrong reason, and worth stating plainly.

M1 records `kind`, and M5 maintains the invariant that a personal workspace has
exactly one member by promoting it to `business` when someone joins. **M5 is R2**,
so on R1 nothing maintains that invariant: if the pre-M5 `accept_invitation()`
succeeds against a signup-created organization, that organization ends up with two
members while still labelled `personal`.

Inert in the R1 application — `listWorkspaces()` takes the fallback path (M6 being
absent), which reports `business` and shows the organization's name, so no user
sees a wrong label. `current_org_id()` is unaffected because a user still holds
exactly one membership. It is a data-quality issue, not an access-control one:
`kind` grants nothing.

Narrow in practice, too. It needs an acceptance to succeed during the soak, and
the pre-M5 function only succeeds when the invitee's own organization is empty.
The one pending production invitation belongs to `5a754ce7…`, which is `business`.

**Detection** — run before R2, and repair by setting those rows to `business`:

```sql
select o.id, count(m.*) as members
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id
 where o.kind = 'personal'
 group by o.id having count(m.*) <> 1;   -- expect 0 rows
```

This is already an R1 post-migration audit (§8 step 6) and an R2 entry criterion.

---

## 7. Security

Measured on the R1 branch against the R1 schema, under real per-persona JWTs.

| Property | Result |
| --- | --- |
| Forged active pointer at a non-member organization | Not honoured; falls back to own workspace; **0 rows leaked**; the organization is not even visible to `select` |
| Tenant isolation, roles, Viewer write refusal | fleet-tenancy 51, organization-members 79, fleet-manager 50 — all pass |
| Driver single-vehicle scope | driver-view 116 — all pass |
| Storage signed-URL scoping, private/public Passport | document-storage 25, private-vehicle 120 — all pass |
| AI intake organization scoping | fleet-ai-intake 85 — all pass |
| `UNIQUE(user_id)` still enforced | Second membership rejected, 23505 |

**R1 broadens no privilege.** The only new callable object is M3's
`is_personal_workspace()`, which explicitly revokes from `public` and `anon` and
grants only to `authenticated`.

Two audit rows that look like findings and are not, both checked rather than
waved away:

* the three `profiles` policies do not mention `current_org_id()` — they are
  `id = auth.uid()`, own-row scoped. `profiles.organization_id` is the legacy
  display cache, not a tenant key.
* `anon` can execute `current_org_id()`, `is_org_admin()` and `is_org_writer()` —
  a local Supabase default-privileges artifact, pre-dating this work. Executed as
  `anon` they return NULL/false, and `anon` sees **0 vehicles and 0
  organizations**. Production grants `anon` no table privileges at all.

---

## 8a. Validation performed on this branch

Clean `supabase db reset` with M1-M3 only.

| Suite | R1 | full M1-M6 |
| --- | --- | --- |
| fleet-tenancy | 51 | 51 |
| document-storage | 25 | 25 |
| organization-members | 79 | 79 |
| fleet-manager | 50 | 50 |
| driver-view | 116 | 116 |
| fleet-ai-intake | 85 | 85 |
| private-vehicle | 120 | 120 |
| qa-quick-wins | 62 | 62 |
| multi-workspace | 15 *(R1 mode)* | 57 |
| **total** | **603** | **645** |

**0 failures in both columns.** The right-hand column matters as much as the
left: the shared fixtures were changed for R1, so they were re-run against the
full schema to prove R1 preparation did not break `main`.

8 SQL audits, zero genuine findings (two explained in §7). TypeScript, ESLint and
the production build all clean.

Not re-run on this branch: the 24-combination responsive EN/HE/RTL pass. R1
changes no layout — the one UI difference is that the workspace card lists a
single entry with no Switch button — and that pass was clean on the identical
markup. It should be repeated against production during the smoke test.

---

## 8. R1 release sequence

1. **Backup** — full read-only dump to a new timestamped directory, checksummed,
   as in the 2026-07-27 pre-migration backup.
2. **Classification verification** — re-run the §4 evidence queries; confirm 4
   organizations and that the backfill predicate still selects exactly the three
   approved IDs.
3. **Optional repair** — §5, only if step 6 disagrees. Not expected.
4. **Dry run** — `supabase db push --linked --dry-run`; confirm it lists exactly
   M1, M2, M3 and no others.
5. **Apply** — `supabase db push --linked`.
6. **Post-migration audits** — `kind` distribution equals personal=3/business=1;
   every personal organization has exactly one member (§6); `UNIQUE(user_id)` still
   present; `list_my_workspaces`/`set_active_organization` still absent; all row
   counts identical to the backup.
7. **Merge** `release/multi-workspace-r1` to `main`. Note it is *behind* `main` by
   the three R2 migrations, so this is a merge that must not resurrect them —
   confirm `supabase/migrations/` holds no `2026072915/16/17*` afterwards.
8. **Deploy** the application. Order is mandatory: **migrations first**. The
   fallback means the reverse order degrades rather than breaks, but that is a
   safety net, not the plan.
9. **Smoke test** — signup; Private Vehicle list and detail; Fleet Dashboard;
   invitation creation and preview; document view; Passport; Hebrew/RTL; mobile.
10. **Soak** — at least one week with no schema change, watching for any
    `current_org_id()` resolution anomaly.
11. **R2 preflight** — see §9.

### Keeping `db push` away from M4–M6

The mechanism is **absence**: M4–M6 do not exist on `release/multi-workspace-r1`,
so `db push` cannot see them. Migration-history tables are never touched, and no
migration is marked applied that was not applied. Step 4's dry run is the check
that this held, and the multi-workspace suite asserts it in R1 mode
("M4-M6 are absent from the release branch").

The one trap this creates: because `main` **does** hold M4-M6, running `db push`
from a `main` checkout would apply all six, crossing M4 with no soak. Until R2,
production migrations must be pushed from this branch only.

### Rollback

Before M4 there is nothing irreversible. R1 rolls back by dropping
`organizations.kind` and `profiles.active_organization_id` and restoring the prior
helper bodies — but the correct response to an R1 problem is almost always to
redeploy the previous application build and leave the additive columns in place,
since old code cannot observe them.

---

## 8b. Soak gate — R1 is applied, not yet declared stable

R1 counts as stable once, and only once, all of the following hold:

* M1-M3 applied — **done**, 2026-07-29T09:49Z
* all audits clean — **done**
* every existing user retains access — **done**, verified under real identities
* no unexpected row change — **done**, counts identical
* classification correct — **done**, 3 personal / 1 business as approved
* Settings works in the browser with no RPC runtime error — **outstanding**
  (§0a item 1)
* production stable under the founder's normal use for the soak period —
  **outstanding**

### R2 entry audit — a personal organization with more than one member

Run before R2. M5 maintains this invariant; M5 is R2; so nothing maintains it
during the soak (§6).

```sql
select o.id, count(m.*) as members
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id
 where o.kind = 'personal'
 group by o.id having count(m.*) <> 1;
```

Expected: **zero rows**, or every result reviewed and corrected to `business`.
At release time this returned zero rows.

The pending-invitation limitation is unchanged by R1: an invitee who owns any
vehicle still receives `already_member` and cannot join. That is fixed by M5 in
R2, not here.

---

## 9. R2 entry criteria

- R1 soaked with no resolution anomalies.
- `kind` classification confirmed correct in production.
- No `personal` organization holding more than one member (§6 detection query);
  repair any that appeared during the soak before M5 lands.
- Accepted that **M4 is irreversible** the moment any user holds a second
  membership: `UNIQUE(user_id)` cannot then be restored without choosing which of
  someone's memberships to destroy.
- Onboarding UI decided, since R2's `accept_invitation` silently makes the joined
  organization active.
- `fix/settings-workspace-fallback` merged to `main`, so no deployment of `main`
  can precede its migrations and break Settings.

Fixtures are already dual-mode (§2), so no test work is outstanding for R2.

---

## 10. Smoke-test checklist

Signup · Private Vehicle list/detail/edit · Fleet Dashboard summary and filters ·
Vehicle detail · Team & Access roster · invitation create and preview ·
document upload and view · Passport private and public · AI intake ·
Owner / Fleet Manager / Viewer / Driver · Hebrew and English · RTL · 375px and
1280px.
