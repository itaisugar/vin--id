# Multi-workspace tenancy foundation

Branch `feat/multi-workspace-foundation`, based on `fix/production-qa-quick-wins`
(`5dee03c`) — the quick-wins PR is not merged into `main` yet, so this branch is
based on what `main` becomes once it is. Both are clean descendants of `61f6c87`
and merge in either order.

**Nothing in this task touches production.** Local Supabase only.

---

## 1. Phase 1 — every single-membership assumption

Produced before any schema change, as required. `UNIQUE(user_id)` is not just a
constraint here: six SQL helpers are *written as if it holds*, and two of the
failure modes are silent.

### 1a. SQL helpers — the dangerous ones

All six read `organization_members where user_id = auth.uid()` with **no
organization filter and no `LIMIT`**.

| Function | Shape | With 2 memberships |
| --- | --- | --- |
| `current_org_id()` | `select m.organization_id from … where user_id = auth.uid()` | **Returns an arbitrary row.** A `language sql` scalar function with a multi-row body returns the first row in whatever order the plan produced. Silent cross-tenant selection. |
| `current_org_role()` | same shape | **Arbitrary role**, possibly from the other organization |
| `is_org_writer()` | `coalesce((select …), false)` | **Raises** `more than one row returned by a subquery used as an expression` |
| `is_org_admin()` | same | **Raises** |
| `is_org_driver()` | same | **Raises** |
| `can_manage_driver_assignments()` | same | **Raises** |

`current_driver_vehicle_id()` already carries `limit 1` (arbitrary but not
fatal). `org_owner_count(p_org)` takes the organization as a parameter and
aggregates — safe.

So dropping the constraint first produces either a silent cross-tenant read
(`current_org_id`) or an application-wide 500 (`is_org_writer`, which every
write policy calls). Both were reproduced locally before the rewrite.

### 1b. Blast radius of `current_org_id()`

* **56 RLS policies across 15 tables**
* **11 SQL functions**: `assign_driver`, `can_access_vehicle`,
  `can_read_document_object`, `can_write_document_object`,
  `confirm_fleet_intake`, `find_duplicate_documents`,
  `get_vehicle_assignment_history`, `list_eligible_drivers`,
  `list_organization_members`, `match_fleet_vehicles`, `unassign_driver`
* **4 Storage policies** on `storage.objects`, via
  `can_read_document_object` / `can_write_document_object` / `is_org_writer`

Everything tenant-scoped in this product resolves through that one function.

### 1c. Other constraint-dependent code

| Location | Assumption | Action |
| --- | --- | --- |
| `handle_new_user()` | `on conflict (user_id) do nothing` — names the constraint being dropped | Rewritten to `on conflict (organization_id, user_id)` |
| `accept_invitation()` | Deletes the invitee's personal organization to free `UNIQUE(user_id)` | Rewritten: adds a membership, deletes nothing |
| `lib/organizations/service.ts` `getCurrentMembership()` | `.maybeSingle()` — **throws** on a second row | Replaced by the membership API in §4 |
| `scripts/validation/lib/org-fixtures.mjs` `joinOrg()` | Deletes/moves the previous membership; upserts `onConflict: "user_id"` | Rewritten to add a membership; old behaviour kept as `moveToOrg()` |
| `protect_last_owner()` | Already handles `new.organization_id <> old.organization_id` | No change needed |
| `lib/organizations/members.ts` | Scopes every write by `id` + `organization_id` | No change needed |

### 1d. What was already safe

`profiles.organization_id` / `profiles.role` were already demoted to a display
cache by the Fleet Lite release, and `getCurrentUserProfile()` documents that
membership overrides the cache in both directions. That decision is what makes
this change tractable — no authorization path reads the cache.

---

## 2. Personal workspace representation

**Chosen: `organizations.kind text not null default 'business' check (kind in
('personal','business'))`.**

Rejected alternatives:

* *Structural inference* (sole member, no invitations, no fleet data) — what
  `accept_invitation()` does today, and it is exactly why a user who owns one
  vehicle cannot accept an invitation. It is not durable: a personal workspace
  becomes indistinguishable from a business one the moment it holds data.
* *`profiles.personal_organization_id`* — a second pointer to keep consistent
  with `organization_members`, and no way to express the flag on the
  organization itself, which is where the UI needs it.

### Backfill, and why it is conservative

An organization is classified `personal` only when **all** of these hold:

1. it has exactly one member, and
2. that member's role is `owner`, and
3. it was created by the signup trigger — evidenced by the member's
   `created_at` matching the organization's within one second, and
4. it has never had an invitation (`organization_invitations`), and
5. no other user's data references it.

Anything else stays `business`. This is deliberately asymmetric: mislabelling a
real company as "Personal" is a product-visible error, while leaving a personal
workspace as `business` costs nothing today — the UI falls back to the
organization name.

`handle_new_user()` writes `kind = 'personal'` from now on, so the inference is
never needed again for new users. The backfill is idempotent (`where kind is
distinct from …`) and reports its own counts through `raise notice`.

---

## 3. Active workspace model

`profiles.active_organization_id uuid references organizations(id) on delete set
null`.

It is a **preference, never evidence**. The security property is enforced in one
place — `current_org_id()` joins the pointer to a live `organization_members`
row for `auth.uid()`:

```sql
-- 1. the active pointer, ONLY IF the caller still has a membership in it
-- 2. else the caller's personal organization
-- 3. else the oldest membership   (deterministic: created_at, then id)
-- 4. else NULL
```

Consequences that fall out of that ordering:

* A **forged** pointer (an organization the caller does not belong to) fails the
  join and falls through to the caller's own default — never to the forged
  tenant.
* A **stale** pointer (membership since removed) does the same.
* `on delete set null` means deleting an organization cannot leave a dangling
  pointer.
* Step 3's `order by created_at, id` is why no read ever returns "an arbitrary
  membership": the fallback is total and stable.

`profiles` RLS is already own-row only for select and update, so no user can set
another user's pointer. `switchWorkspace()` additionally verifies membership
server-side before writing, so an invalid write never lands in the first place.

---

## 4. Membership API

`getCurrentMembership()` is gone. `lib/organizations/service.ts` now exposes:

| Function | Returns |
| --- | --- |
| `listMemberships()` | every active membership, personal first, then by `created_at` |
| `getActiveMembership()` | the membership `current_org_id()` resolves to, or `null` |
| `getMembershipFor(orgId)` | that organization's membership, or `null` |
| `resolveDefaultOrganization()` | the same 4-step rule, in TypeScript, for callers that need it without a round trip |
| `isPersonalWorkspace()` | whether the active workspace is `kind = 'personal'` |
| `switchWorkspace(orgId)` | validates membership, then writes the pointer |
| `requireOrganization()` | unchanged signature; now backed by `getActiveMembership()` |

`listMemberships()` orders personal-first deliberately: it is also the order the
selector renders, so the UI needs no sort of its own.

---

## 5. Migration sequence

Six migrations, ordered so that **no deployed code ever meets an incompatible
schema**. The ordering rule that drives everything: the helpers must tolerate
multiple memberships *before* multiple memberships can exist.

| # | File | Does | Old code against it |
| --- | --- | --- | --- |
| M1 | `20260729120000_organization_kind.sql` | `organizations.kind` + conservative backfill; `handle_new_user` writes `'personal'` | Additive. Old code ignores the column. |
| M2 | `20260729130000_active_organization.sql` | `profiles.active_organization_id` (nullable) | Additive, NULL for everyone → every helper falls through to today's behaviour. |
| M3 | `20260729140000_membership_helpers_multi.sql` | Rewrites all six helpers to be multi-membership-safe | **Behaviour-identical while `UNIQUE(user_id)` still holds** — with one membership, the new resolution returns the same row the old one did. This is the migration that makes M4 safe. |
| M4 | `20260729150000_membership_cardinality.sql` | Drops `organization_members_user_unique`, adds `UNIQUE(organization_id, user_id)`; `handle_new_user` conflict target updated | Only now can a second membership exist. Every reader was fixed in M3. |
| M5 | `20260729160000_accept_invitation_multi.sql` | `accept_invitation()` adds a membership and deletes nothing | Replaces destructive behaviour. Idempotent. |
| M6 | `20260729170000_switch_workspace.sql` | `set_active_organization(uuid)` RPC — membership-checked, `SECURITY DEFINER` | Additive. |

**M3 before M4 is the whole safety argument.** Reversing them opens a window in
which a second membership exists while `is_org_writer()` still raises on it.

### Compatibility matrix

| Scenario | Result |
| --- | --- |
| Old code, new schema (M1–M3 applied) | Works. `.maybeSingle()` still sees one row because M4 has not run; helpers behave identically. |
| Old code, all six applied | **Breaks only for users who hold 2+ memberships**, which cannot happen until the new `accept_invitation()` (M5) is used. Single-membership users are unaffected. |
| New code, old schema | Works. The new helpers and APIs tolerate one membership; `active_organization_id` is simply absent → falls back. |
| Rollback after M4 | `UNIQUE(user_id)` can be restored **only while every user still holds one membership**. See §10. |

---

## 6. Invitation behaviour

`accept_invitation()` no longer deletes anything. The full decision order is
unchanged — `not_authenticated` → `invalid` → `revoked` → `accepted` →
`expired` → `email_mismatch` → already-a-member replay → insert — but the
already-a-member branch now means "already a member *of this organization*"
rather than "a member of anything".

* The personal organization survives, with every vehicle in it.
* A user may join a second and third organization.
* The accepted role is still `v_inv.role`, chosen by the inviter, and
  `organization_invitations.role` still excludes `owner` at the CHECK level.
* Replay returns `accepted` and creates no second membership — now enforced by
  `UNIQUE(organization_id, user_id)` as well as by the status check.
* Acceptance stays explicit; nothing here touches the landing page.

Newly joined organizations become the active workspace, because that is what the
user just asked for. Their personal workspace is one switch away.

---

## 7. Security model

| Control | Where |
| --- | --- |
| Which organization am I acting in | `current_org_id()` — pointer **joined** to a live membership |
| What may I do there | `current_org_role()`, `is_org_writer()`, `is_org_admin()`, `can_manage_driver_assignments()` — all now organization-scoped |
| Can UI state grant anything | No. The pointer is validated on every read; an unvalidated pointer resolves to the caller's own default, never to the pointed-at tenant |
| Can I set someone else's pointer | No. `profiles` RLS is own-row; `set_active_organization()` derives the user from `auth.uid()` |
| Can I activate an organization I am not in | No. The RPC returns `not_a_member` and writes nothing |

All helpers keep `SECURITY DEFINER`, `set search_path = ''`, `revoke … from
public, anon` and an explicit `grant … to authenticated`. No table privilege was
widened and no new anonymous access was introduced.

---

## 8. Routes and services

No route or service needed an organization parameter added, because none ever
accepted one. Every org-scoped read already goes through `requireOrganization()`
→ `current_org_id()`, so switching the active workspace changes what all of them
return without a single call-site change. That was the payoff of the Fleet Lite
design decision to resolve tenancy in one place.

What did change:

| Area | Change |
| --- | --- |
| `lib/organizations/service.ts` | `getCurrentMembership()` → the API in §4 |
| `app/(app)/settings` | workspace selector + its server action |
| `scripts/validation/lib/org-fixtures.mjs` | `orgOf` no longer `.maybeSingle()`; `roleOf`/`setRole` take an organization; `joinOrg` sets the active pointer; new `addMembership`, `orgsOf`, `personalOrgsOf`, `setActiveOrg` |

Verified unchanged in behaviour by the existing suites: Dashboard, fleet list,
vehicle detail, documents, AI intake, Team & Access, invitation creation, driver
assignment, Passport management and signed Storage URLs.

Driver View deserves a specific note: `current_driver_vehicle_id()` gained
`and a.organization_id = public.current_org_id()`. Without it, a driver in
organization B who also owns a personal workspace could carry B's vehicle into
their personal view.

---

## 9. Test matrix

`scripts/validation/multi-workspace-check.mjs` — **57 assertions**.

| Group | Covered |
| --- | --- |
| Existing user regression | single membership resolves unchanged; vehicle still visible; ownership unchanged; exactly one personal workspace |
| Multiple memberships | Personal + A; Personal + A + B; owner/fleet_manager/viewer across the three; deterministic default |
| Switching | A → B → Personal; visible data and effective role follow; persists across a fresh sign-in; moves no ownership |
| Security | forged pointer; stale pointer after removal; outsider organization; RPC refusal writes nothing; cross-user pointer write; selector omits inaccessible organizations |
| Roles | different role per organization; viewer cannot write in B while owner in Personal |
| Invitations | vehicle-owning user joins; personal workspace and vehicle survive; replay; second organization; wrong email; revoked; expired; inviter-selected role per organization |
| Database | no duplicate membership; every organization has an owner; every personal workspace has exactly one member; no NULL organization |
| Migration shape | constraint dropped and replaced; conflict target updated in the same migration; predicates organization-scoped; fallback totally ordered |

Full regression, all green, on a clean `db reset`:

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
| **multi-workspace** | **57** |
| **Total** | **645** |

Six SQL audits: zero findings. TypeScript, ESLint, production build: clean.

Visual QA in real headless Chrome: 3 screens × 4 widths (320/375/768/1280) ×
EN/HE = 24 combinations. Zero horizontal overflow, zero sub-32px tap targets,
zero unlabelled controls, every Hebrew page `dir="rtl"`, and a real switch
performed at 375px changed which workspace the app reported as active.

---

## 10. Production rollout

**Not performed. Production was not accessed.**

Recommended as two releases, because M4 is irreversible in practice:

**Release 1 — M1, M2, M3 + the application commits.** All additive. The helpers
become multi-membership-safe while `UNIQUE(user_id)` still holds, so behaviour
is identical for every existing user. Soak this.

**Release 2 — M4, M5, M6.** Cardinality, invitation acceptance and the switch
RPC. Only now can a second membership exist.

Preflight before Release 2, following `production-release-preflight.md`:

1. fresh verified backup (PITR is off — the dumps are the recovery path);
2. `select count(*) from (select organization_id, user_id from
   organization_members group by 1,2 having count(*) > 1) d;` — must be 0, and
   M4 refuses if it is not;
3. confirm every organization has an owner;
4. confirm Release 1 is fully applied — M4 without M3 is the failure mode this
   whole document is arranged around;
5. `supabase db push --linked --dry-run` lists exactly the expected files.

### Rollback

* **Before M4** — every migration is additive; `drop column` restores the prior
  state exactly.
* **After M4, before anyone holds a second membership** — restoring
  `UNIQUE(user_id)` succeeds and the old helpers can be replaced. This window
  closes the first time somebody accepts an invitation.
* **After that** — the constraint cannot be restored without choosing which of
  someone's memberships to delete, which is a data decision, not a rollback.
  Recovery is forward-only: fix the helpers, not the cardinality. Deploying
  Release 1 well ahead of Release 2 is what keeps this window wide.

---

## 10. Rollback

* **Before M4** — every migration is additive; `drop column` restores the prior
  state exactly.
* **After M4, before anyone holds a second membership** — restoring
  `UNIQUE(user_id)` succeeds and the old helpers can be replaced.
* **After anyone holds a second membership** — the constraint can no longer be
  restored without choosing which membership to delete, which is a data
  decision, not a rollback. From that point the recovery path is forward-only:
  fix the helpers, not the cardinality. This is the point of no return and it is
  worth deploying M1–M3 well ahead of M4–M6.

---

## 12. Unresolved risks

1. **M4 is irreversible once anyone holds a second membership.** §10 explains
   the window. This is inherent to the change, not an oversight, but it is the
   single largest risk in the release.
2. **The backfill will under-classify.** A founder who created a real company
   through the signup trigger and never invited anyone will be classified
   `business` and see their company name where "Personal" would read better. The
   asymmetry is deliberate — the opposite error is worse — but it means some
   production organizations will need a manual `kind` correction. There is no
   generic evidence that could distinguish them.
3. **`kind` promotion is one-way.** An organization that gains a second member
   never becomes personal again, even if that member leaves. Reverting would
   mean a workspace whose name and data were shaped by two people claiming to
   belong to one.
4. **`profiles.role` still cannot hold `driver`.** Its CHECK predates the role,
   so the cache stores `viewer` for a driver. Nothing reads it for
   authorization, but anyone inspecting the row by hand will see a wrong value.
   Fixing the CHECK is a separate migration and was out of scope here.
5. **Newly joined organizations become active automatically.** That is what the
   user just asked for, but it means accepting an invitation silently moves them
   out of their personal workspace. The onboarding task should make this
   visible.
6. **No UI yet distinguishes "you have no workspace".** `current_org_id()` can
   return NULL — a user removed from every organization — and the screens will
   report "no organization" rather than offering a route forward. That belongs
   with the onboarding work.
7. **The selector lives in Settings.** Discoverable enough to validate the
   foundation, not enough to be the product. Deliberate: the final switcher is a
   navigation change this task excluded.
8. **This branch is based on `fix/production-qa-quick-wins`, not `main`.** The
   quick-wins PR is still open. Both are clean descendants of `61f6c87` and merge
   in either order, but this branch should not be merged before it.
