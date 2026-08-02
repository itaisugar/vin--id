# Stale Active Workspace Fix — Atomic Member Removal and Safe Fallback

Branch: `fix/stale-active-workspace-removal` (from `main` @ `7583066`).
Scope: a narrow correctness/UX fix. No tenancy redesign, no onboarding, no
invitation email, no short codes.

---

## 1. Root cause (Phase 1 audit — read-only)

### Current owner-side removal call chain

```
components/organization/member-list.tsx  (Team & Access UI)
  └─ removeMemberAction(member.id)            app/(app)/organization/actions.ts
       └─ removeMember(memberId)              lib/organizations/members.ts
            1. requireOrganizationAdmin()     → caller org + role (owner/admin)
            2. findMemberInOwnOrg(memberId)   → target row, re-checked to caller's org
            3. role rule: admin may not remove an owner
            4. supabase.from("organization_members").delete()   ← direct table DELETE
            5. supabase.from("profiles").update({ organization_id: null })
                 .eq("id", target.user_id)                       ← SEPARATE request
```

Authorization today is enforced in three layers and is correct: the service
guard `requireOrganizationAdmin()`, the RLS policy
`org_members_delete_admin` = `organization_id = current_org_id() AND is_org_admin()
AND (current_org_role() = 'owner' OR role <> 'owner')`, and the
`protect_last_owner` BEFORE-DELETE trigger. Removal itself is safe.

### The defect

Steps 4 and 5 are **two separate statements, not one transaction**, and step 5 is
**wrong on two counts**:

1. It updates only the legacy `organization_id` cache and **never touches
   `profiles.active_organization_id`** — the actual active-workspace pointer.
2. `profiles` RLS is **own-row** (`profiles_update_own` = `id = auth.uid()`), so an
   owner/admin updating the *removed* user's profile row matches **zero rows**. The
   "best-effort" cleanup is a guaranteed no-op for anyone but the caller
   themselves.

Net effect: after an owner removes user A from organization X, A's
`active_organization_id` keeps pointing at X. It is **not** a data leak —
`current_org_id()` validates the pointer against a live membership on every read
and falls through to A's personal workspace — but it leaves stale profile state
that (a) shows as an "invalid active pointer" in audits and (b) cannot be
self-cleared by a single-workspace user through the UI (no switch to trigger
`set_active_organization`). This is exactly what forced a one-time manual
normalization after the R2 QA test.

### Profile fields — authoritative vs. compatibility

`lib/organizations/service.ts` header states it plainly: **membership is the
authority**. `current_org_id()` / `current_org_role()` / `is_org_writer()` /
`is_org_admin()` all read `organization_members`. `profiles.organization_id` and
`profiles.role` are **compatibility caches** — `getCurrentUserProfile()` even
serves those two fields from the membership, not the cached copies. They are kept
"in step" by `accept_invitation()`, `set_active_organization()` and
`changeMemberRole()` purely so a row read by hand is not confusing. `role` is
`NOT NULL` (CHECK: owner/admin/fleet_manager/viewer/driver); the two org columns
are nullable. This fix keeps all three consistent, but relies on none of them for
authorization.

### Default-workspace resolution (the fallback we must mirror)

`current_org_id()` (migration `20260729140000`): (1) `active_organization_id` **iff
a live membership backs it**, else (2) the personal-workspace membership, else (3)
the oldest membership by `(created_at, id)`, else NULL.

### Minimum safe fix

Make membership removal and pointer repair **atomic**. Two parts:

* an authoritative `SECURITY DEFINER` RPC `remove_organization_member(uuid)` that
  performs authorization + the single DELETE and returns a structured result; and
* an `AFTER DELETE` trigger on `organization_members` that repairs the removed
  user's `active_organization_id` (and the two caches) in the **same transaction**,
  for **every** deletion path — so the invariant "no `active_organization_id`
  points at a non-member org" is enforced by the database, not by a caller.

A migration is required (new function + trigger). No schema/column change.

---

## 2. Chosen design — atomic, database-enforced

Two objects in one migration, `20260731120000_atomic_member_removal.sql`, both
acting inside the caller's transaction:

### 2.1 Repair trigger (the invariant)

`repair_active_workspace_after_member_removal()` — `AFTER DELETE ON
organization_members FOR EACH ROW`, `SECURITY DEFINER`, `search_path=''`. For the
just-removed row's user it:

1. loads the user's profile (skips if the profile is already gone — e.g. a cascade
   from deleting the auth user);
2. if `active_organization_id` still names a live membership, **leaves it
   untouched** (Case B — an unrelated active workspace is never disturbed);
3. otherwise recomputes the pointer with the **same chain as `current_org_id()`**
   and writes it, syncing the legacy caches.

Because it fires for *every* delete — the RPC below, a direct service-role
delete, a future self-leave, a cascade — the invariant "`active_organization_id`
never names a non-member organization" is guaranteed by the database, not by any
caller. It is the single source of repair truth; the RPC does not duplicate it.

### 2.2 Authorized operation (the entry point)

`remove_organization_member(p_member_id uuid) returns jsonb`, `SECURITY DEFINER`,
`search_path=''`, granted to `authenticated` only. One transaction:

1. `auth.uid()` → caller (`not_authenticated` if none);
2. resolve the caller's active org `current_org_id()` and role
   `current_org_role()`;
3. **lock the organization row `FOR UPDATE`** — the same row `protect_last_owner`
   locks — serializing concurrent removals and role changes;
4. fetch the target membership **by id, within the caller's org** (`not_found`
   otherwise — this is also what rejects a cross-organization member id);
5. authorize (below); `not_authorized` on failure;
6. last-owner pre-check → `last_owner` (the trigger remains the final backstop);
7. delete exactly one row by primary key;
8. read back the trigger-repaired pointer and return
   `{ state:'ok', organization_id, removed_user_id, was_self_leave,
   new_active_organization_id }`.

`removeMember()` in `lib/organizations/members.ts` now calls this RPC and maps
`state` onto the unchanged `MemberActionResult` contract, so the Team & Access UI,
its success feedback, translations (en/he) and RTL are untouched.

## 3. Authorization rules (unchanged matrix, plus safe self-leave)

Mirrors the `org_members_delete_admin` RLS policy exactly:

* **owner** removes anyone (last owner excepted);
* **admin** removes non-owners only;
* **viewer / driver / outsider** cannot remove anyone → `not_authorized`
  (or `not_found` for a member outside the caller's org);
* **last owner** of a live organization can never be removed → `last_owner`;
* **self-leave**: any member may remove *their own* membership, still subject to
  last-owner protection. This is a DB capability with **no UI** in this change
  (see §6); it exists so a future "leave organization" action can route through
  the same atomic operation. Permissions are not otherwise broadened.

The caller is always `auth.uid()`; the only client input is a membership id, which
is re-checked against the caller's own organization inside the function. No caller
can target another organization or update an arbitrary user's profile.

## 4. Fallback algorithm (identical to `current_org_id()`)

After a removal, if the user's `active_organization_id` is NULL or no longer
backed by a membership:

1. their **personal** workspace membership (`organizations.kind='personal'`), else
2. the **oldest remaining** membership by `(created_at, id)` — total, stable
   ordering, never planner-dependent, else
3. **NULL**.

Case B (pointer already names a valid *other* org) is left unchanged.

## 5. Legacy profile fields

`profiles.organization_id` and `profiles.role` are compatibility caches only
(§1). The trigger keeps them in step with the resolved fallback so a hand-read row
is not misleading. `role` is `NOT NULL`, so when no memberships remain it becomes
the least-privileged `viewer`; `organization_id` becomes NULL. Nothing authorizes
on these fields — `getCurrentUserProfile()` serves both from the membership. They
are **not** removed or broadly rewritten in this task.

## 6. Self-leave — UI out of scope

No self-leave UI exists today, and none is added. The operation is *designed* to
support it (the self-branch above) and its database behaviour is tested, so a
future "Leave organization" button is a thin wiring task with no new SQL.

## 7. Tests

New suite `scripts/validation/member-removal-check.mjs`
(`npm run validate:member-removal`), **38 assertions**, all under real per-persona
JWTs (service role only builds/inspects fixtures):

1. owner removes active-workspace member → repaired to Personal, personal data
   kept, no A rows readable;
2. owner removes inactive-workspace member → active org (C) untouched;
3. removed org was active, no Personal → deterministic oldest-membership fallback;
4. last membership removed → active NULL;
5. authorization — viewer refused, outsider blocked, admin cannot remove owner,
   last owner refused;
6. self-leave — own membership removed, personal kept, pointer repaired;
7. idempotency/concurrency — two concurrent removals serialize to `ok` +
   `not_found`, no double delete, replay deterministic;
8. data integrity — profile, org, vehicle, org-kind all untouched;
9. invariant sweep — no profile points at a non-member org.

New SQL audit query in `fleet_tenancy_audit.sql` (§9): zero profiles with an
`active_organization_id` lacking a backing membership.

### Regression baseline (clean `db reset`, 44 migrations)

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
| **member-removal (new)** | **38** |
| **total** | **683** |

Zero failures. Six SQL audits clean. `tsc --noEmit` clean, ESLint clean,
`next build` compiles. Prior R2 baseline was 645; this adds 38 and regresses none.

## 8. Security review

* `current_org_id()` unchanged — still membership-validated; the active pointer is
  never an authorization boundary on its own.
* Both new functions are `SECURITY DEFINER` with `search_path=''`, fully
  schema-qualified, `revoke … from public, anon` + `grant … to authenticated`.
  `anon` cannot call either (PostgREST-exposed to authenticated only).
* No new policy on `profiles`; the own-row policies stand. The trigger writes
  another user's profile only because it is `SECURITY DEFINER`, and only the one
  row whose membership was removed.
* Caller identity is always `auth.uid()`; no user or organization id is trusted
  from the client.
* RLS remains enabled on every table; the last-owner trigger is unchanged and
  remains the final backstop.
* No service-role usage in browser code; no credentials or tokens logged.

## 9. Risks

* **Trigger scope.** The repair now runs on *every* membership delete, including
  fixture teardown and org-deletion cascades. It is a single-row, guarded UPDATE
  and a no-op when the profile is gone or the pointer is still valid; the full
  suite (which deletes many memberships) confirms no adverse interaction.
* **Legacy-cache writes.** Writing `organization_id`/`role` could in principle
  race a concurrent `set_active_organization`; both take the same effective path
  and the values are non-authoritative, so a transient cache value cannot change
  access. The org-row lock serializes the removal path itself.
* **`last_owner` vs UI.** Behaviour and copy are unchanged (`lastOwner`).

## 10. Production release plan

Database-only, same shape as R1/R2:

1. **Backup** production (`jsthfmgvcdrfzpgkpwvt`) via the verified IPv4-pooler
   method; verify checksums.
2. **Dry run** `supabase db push` — expect exactly one pending migration,
   `20260731120000_atomic_member_removal.sql`.
3. **Apply** it. It creates one function, one trigger, one function + grants;
   changes **zero rows**; no schema/column change; history 43 → 44.
4. **Verify**: both functions `SECURITY DEFINER` + `search_path` pinned, granted to
   `authenticated` only, `anon` denied; trigger enabled; run the
   `fleet_tenancy_audit.sql` active-pointer query (expect 0).
5. **Smoke test** (Team & Access, a real removable non-owner in a test org): remove
   → success feedback, list updates, removed user's next request resolves to their
   Personal workspace, Business gone from the selector, direct Business URL blocked,
   personal data intact.
6. Do **not** deploy app code for the DB behaviour to take effect (the RPC is
   called by the already-shipped `removeMember`, which changes with this branch —
   so the app change *does* ship together): merge the branch and deploy as normal
   once reviewed. Until the app is deployed, production keeps the old two-step
   path; the migration alone is safe and additive.

**Rollback.** Code: revert the branch (restores the prior two-step `removeMember`).
Database: `drop trigger organization_members_repair_active_workspace on
public.organization_members; drop function
public.repair_active_workspace_after_member_removal();  drop function
public.remove_organization_member(uuid);`. Both functions/trigger are additive, so
dropping them cannot lose data; the only effect is the return of the original
stale-pointer gap. No prior migration is touched.

## 11. Classification

`STALE ACTIVE WORKSPACE FIX VALIDATED` — every changed layer (migration, RPC,
trigger, server wiring, tests, audit) is validated against a clean database; no
UI code changed, so the Team & Access screen, its translations and RTL are
unaffected. A production apply + browser smoke test remain, per §10.

---

## 12. Production release record — 2026-07-31

Database migration applied to production `jsthfmgvcdrfzpgkpwvt` from
`fix/stale-active-workspace-removal`. Application deploy (PR merge + Vercel) is
**pending** — see §12.7. The migration is backward-compatible, so the fix is
already effective for the currently-deployed app: the repair trigger fires on its
existing direct-delete path.

### 12.1 Grant hardening (commit `ede3e87`)

`repair_active_workspace_after_member_removal()` had the default `PUBLIC`
EXECUTE grant. Revoked from `public`, `anon` and `authenticated` — a trigger
runs without the invoker holding EXECUTE, so no role needs a direct grant. The RPC
stays `authenticated`-only. Tests added (anon cannot call the RPC → 42501;
authenticated can; the trigger fn is not directly invokable → PGRST202; the
trigger still fires on a direct non-RPC delete) and a `has_function_privilege`
grant-posture query in `fleet_tenancy_audit.sql`.

### 12.2 Approved baseline (real multi-workspace usage)

A founder decision confirmed a real change made 2026-07-31 14:33Z: user
`b3c52640…` (`ya***`) accepted a Viewer invitation into `89a499fc…`
(`Itai Bell`), which promoted that org `personal → business` under the M5 rule.
Approved pre-release baseline: **4 users · 4 profiles · 4 organizations ·
5 memberships · 2 personal · 2 business · 1 approved multi-membership user · 0
duplicates · 0 invalid pointers · 0 ownerless · 3 invitation rows · 7 vehicles ·
4 documents · 15 Passports · 9 maintenance · 7 issues · 4 storage objects /
3,689,919 bytes**. The `yahlido` Viewer membership is permanent and excluded from
the controlled removal test.

### 12.3 Backup

`/Users/itai/Desktop/vin-id-production-backups/20260731-181538-member-removal-premigration` — schema.sql, data.sql, roles.sql, migration-state.txt,
storage-inventory.txt, row-counts.txt, RESTORE.md; **all 7 SHA-256 checksums
verified**. Captured 4/4/4/5, storage 4 / 3,689,919. PITR off → this is the
recovery point.

### 12.4 Dry run and apply

Dry run listed exactly `20260731120000_atomic_member_removal.sql` (no replay).
Applied 2026-07-31 15:20Z; the only notice was the idempotent
`drop trigger if exists` guard. **History 43 → 44.** Row snapshot identical
pre/post: 4 users, 4 profiles, 4 orgs, 5 memberships, 1 active pointer set — the
migration changed **zero application rows**.

### 12.5 Final production grant + object state

* Trigger `organization_members_repair_active_workspace` — `AFTER DELETE … FOR
  EACH ROW`, enabled.
* Both functions `SECURITY DEFINER`, `search_path=''`.
* `remove_organization_member(uuid)`: EXECUTE = authenticated **only** (anon,
  public denied). Confirmed in the schema cache via PostgREST: anon POST returns
  **HTTP 401 / 42501** (denied, not 404).
* `repair_active_workspace_after_member_removal()`: EXECUTE denied to public,
  anon **and** authenticated.

### 12.6 Post-apply audits — clean

Fleet tenancy audit (incl. #9 active-pointer and #10 grant-posture) every query
0 rows. Direct checks: 0 invalid active pointers, 0 duplicate memberships, 0
ownerless organizations. Founder data and storage unchanged.

### 12.7 Remaining — deployment + controlled removal test

Not performed from the release tooling: `gh`/`vercel` CLIs are unavailable and
the Vercel connector is unauthorized in a non-interactive session. Remaining,
founder-driven:

1. Open PR `fix/stale-active-workspace-removal` → `main`; the diff is exactly
   six files (migration 44, `members.ts` RPC wiring, validation suite, audit
   addition, `package.json`, docs) — no unrelated files. Merge after checks pass.
2. Let the connected Vercel production deployment run; confirm the deployed commit
   matches the merge.
3. Smoke test (login, Dashboard, Settings, Team & Access, vehicles, documents,
   Passports — no Settings 500, no missing-RPC error).
4. Controlled removal test with the founder target `itaibell134@gmail.com` in the
   **separate** Business org `5a754ce7…` (`numa dad`), **not** `yahlido`:
   invite Viewer → accept (6 memberships) → make `numa dad` active → remove via
   Team & Access (no SQL) → verify the trigger auto-repairs the active workspace
   back to `Itai Bell`, temporary membership gone (back to 5 memberships), all
   founder data intact, `yahlido` untouched. Leave the accepted invitation as
   audit history.

Expected final production state: 4 users · 4 profiles · 4 organizations ·
**5 memberships** · 2 personal · 2 business · one approved multi-membership user
(`b3c52640…`) · no temporary founder membership in `numa dad` · no invalid
pointers · every org owned · founder data unchanged · migration history 44.
