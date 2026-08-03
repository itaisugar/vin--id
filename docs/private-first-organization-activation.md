# Private-First Account Experience & Explicit Business Organization Creation

Branch: `feat/private-first-organization-activation` (from `main` @ `2b371b9`).

Makes VIN-ID private-first for every new user: signup lands in a Personal
workspace, Team & Access presents organization features as **optional**, and a
separate Business organization is created only when the user explicitly asks for
one — or accepts an invitation. No account type, no tenancy-architecture change.

---

## 1. Audited previous behavior

* **Signup** — already private-first at the database layer. `handle_new_user()`
  ([20260729150000](../supabase/migrations/20260729150000_membership_cardinality.sql))
  creates one organization with `kind='personal'`, an `owner` membership, and
  sets `active_organization_id` to it. The [signup action](../app/(auth)/actions.ts)
  calls `auth.signUp` then redirects to `/dashboard`. No org-choice modal, no
  account classification. **Unchanged by this task.**
* **Team & Access** — [`/organization`](../app/(app)/organization/page.tsx) showed
  the full roster + invite form + pending invitations to any `owner`/`admin`,
  **without** branching on `kind`. A Personal-workspace owner therefore saw
  business team-management UI. Main UX gap.
* **Organization creation** — **none.** Organizations were created only by the
  signup trigger; there was no RPC, action or insert path in app/lib.
* **Invitation creation** — a direct insert into `organization_invitations`,
  governed by RLS `org_invitations_insert_admin`
  ([member_management](../supabase/migrations/20260725190000_member_management.sql)):
  `org = current_org_id() AND is_org_admin() AND invited_by = auth.uid()`. **No
  `kind` check** — a Personal owner (`owner` ⇒ `is_org_admin()`) could invite,
  which is the only path that could turn a Personal workspace into a shared one.
  Main security gap.
* **Data scoping** — every fleet table is `organization_id`-scoped via RLS
  (`organization_id = current_org_id()`). Switching the active workspace changes
  what is visible; nothing is moved. Confirmed unchanged.

---

## 2. Final product decisions

* A new user gets exactly **one Personal workspace**, one Owner membership, no
  Business organization, no onboarding question, no permanent account type.
* A **Personal workspace** is a private vehicle environment: it never shows
  member/invitation/role controls and can never be invited into.
* A **Business organization** is created explicitly, as a separate
  `kind='business'` organization; the creator becomes Owner; it becomes active;
  **no Personal data moves.**
* Every authenticated user with a valid profile may create their own Business
  organization from their Personal workspace.
* Existing organizations are **never** reclassified, renamed, split, emptied or
  moved. Existing Business orgs stay Business; existing memberships stay.

---

## 3. Personal vs Business UX

| | Personal workspace | Business workspace |
| --- | --- | --- |
| Team & Access | Activation card: title, description, **Create organization**, "personal data stays" note | Existing roster + invite form + pending invitations + role management |
| Invite controls | none (and DB refuses) | owner/admin only, per the role matrix |
| Workspace selector | one workspace, labelled "Personal", no Switch button | Personal + each Business org, distinguished, switchable |

Copy lives under `organization.activation.*` (en + he, RTL). The activation view
is rendered by [`/organization/page.tsx`](../app/(app)/organization/page.tsx)
when `isPersonalWorkspace()` is true.

---

## 4. Organization-creation transaction

`create_business_organization(p_name)` — SECURITY DEFINER, pinned
`search_path=''`, `authenticated` only
([20260802120000](../supabase/migrations/20260802120000_business_organization_creation.sql)):

1. derive the caller from `auth.uid()` (no owner/user argument);
2. require an existing `profiles` row (`no_profile` otherwise);
3. trim + validate the name (empty or > 120 chars ⇒ `invalid_name`; Hebrew ok);
4. **idempotency** — if the caller already owns a business org with the same
   normalized name, return it (`deduplicated`) instead of stacking a copy;
5. insert the organization with `kind='business'`;
6. insert the caller's `owner` membership;
7. set `active_organization_id` (and sync the legacy cache);
8. return `{ state:'ok', organization_id }`.

All steps run in the single function transaction — a partial organization or a
membership-less org is not representable. The Personal workspace and its vehicles
are never read or written.

App path: [`createBusinessOrganization`](../lib/organizations/organization.ts) →
[`createOrganizationAction`](../app/(app)/organization/actions.ts) (revalidates
the layout and redirects to the Business Team & Access screen) →
[`CreateOrganizationForm`](../components/organization/create-organization-form.tsx)
(single name field, revealed on demand).

---

## 5. Invitation restriction (server-side)

* **Database (hard boundary):** the invitation INSERT policy now also requires
  `exists (… organizations o where o.id = organization_id and o.kind <> 'personal')`.
  A Personal Owner cannot create an invitation via the app, a direct PostgREST
  insert, or any other path.
* **Service (stable state):** `createInvitation` checks `isPersonalWorkspace()`
  first and returns `{ ok:false, error:'personalWorkspace' }`, so the UI shows a
  clear message instead of a generic RLS failure. UI hiding is not the boundary —
  the policy is.
* The `accept_invitation()` personal→business promotion is **kept** as documented
  defense in depth. With the guard, no invitation can be created for a personal
  org, so that line is now unreachable for personal orgs; removing it is an
  unnecessary separate risk (Task B: keep it).

---

## 6. Authorization matrix (verified)

| Actor | Create org | Invite into Personal | Invite into Business | Manage Business members |
| --- | --- | --- | --- | --- |
| Personal Owner | ✅ | ❌ (DB refuses) | n/a | n/a |
| Business Owner | ✅ | ❌ | ✅ | ✅ (not last owner) |
| Business Admin | ✅ (own, separate) | ❌ | ✅ (non-owners) | ✅ (non-owners) |
| Viewer / Driver | ✅ (own, separate) | ❌ | ❌ | ❌ |
| Anonymous | ❌ (no EXECUTE) | ❌ | ❌ | ❌ |

* Last-owner protection unchanged (trigger + service).
* Active workspace is **not** an authorization boundary — `current_org_id()`
  validates the pointer against a live membership on every read; a forged id
  resolves to the caller's default workspace, never the pointed-at tenant.

---

## 7. Database changes

* **New migration** `20260802120000_business_organization_creation.sql`:
  * `create_business_organization(text)` RPC (SECURITY DEFINER, revoked from
    public/anon, granted to authenticated).
  * Rebuilt `org_invitations_insert_admin` INSERT policy, preserving the
    owner/admin + `invited_by` rules and adding the `kind <> 'personal'` guard.
* **No** table change, **no** backfill, **no** reclassification, **no** data
  movement. Compatibility caches (`profiles.organization_id` / `role`) are kept in
  step by the RPC exactly as `accept_invitation()` / `set_active_organization()`
  already do; they grant nothing.

---

## 8. Tests

* **Focused suite** `validate:private-first`
  ([private-first-check.mjs](../scripts/validation/private-first-check.mjs)) —
  **57 assertions**, real end-user JWTs at every authorization boundary:
  signup-personal-only, personal cannot invite (RLS), atomic business creation,
  owner membership, active-workspace update, Personal workspace + vehicle
  preservation, tenant isolation, duplicate-submit dedup, invalid/Hebrew names,
  anon + missing-profile denial, invitation join keeps Personal + correct role +
  replay idempotency, switching both ways, per-membership roles, and a
  three-membership fixture (personal + 2 business).
* **Fixture update:** `organization-members` now marks its team-management orgs
  `kind='business'` (team management is a business capability), matching the
  member-removal suite. Still 79 assertions.
* **Full regression** (clean `db reset`, 45 migrations):

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
  | member-removal | 42 |
  | dashboard-vehicle-cleanup | 18 |
  | **private-first (new)** | **57** |
  | **total** | **762** |

  Zero failures. `tsc --noEmit` clean, ESLint clean (0 warnings), `next build`
  compiles. en/he key parity holds (1213 keys each).

---

## 9. Existing-data compatibility

* Existing Business organizations: `kind='business'` already ⇒ the invitation
  guard is a no-op for them; members, roles, invitations, acceptance all work.
* Existing Personal workspaces: unchanged; they simply gain the activation view
  and lose the (previously mis-shown) invite controls.
* No organization is reclassified; no membership added/removed; no vehicle moved.
* A database still on the pre-migration schema is unaffected until `db push`.

---

## 10. Manual UI validation (recommended before release)

No component-render infra exists, so verify by hand in en + he (RTL), at
narrow-mobile / mobile / tablet / desktop:

**Personal:** first login → Dashboard; Team & Access shows the activation card
(title / description / Create organization / personal-data note); the form
validates an empty name; mobile Hebrew RTL and desktop English both read cleanly.

**Business:** after Create, the app lands on Business Team & Access; the workspace
selector lists Personal + the new org; the invite form works; switching back to
Personal shows the private vehicles again; a fresh Business org shows an empty
state.

**Invitation user:** Personal + Business both listed with the correct role;
switching both directions; the selection survives a refresh.

---

## 11. Production release plan

1. Back up production (dump via the pooler) before applying anything.
2. Open PR `feat/private-first-organization-activation` → `main`.
3. Apply migration `20260802120000` to production (`supabase db push`) — additive
   RPC + one policy tightening; no data change.
4. Deploy the app (Vercel) so the activation UI and create flow ship together.
5. Smoke test: a new signup lands Personal; Personal Team & Access shows
   activation; Create organization works and switches; existing Business orgs
   still invite/manage members; existing vehicles remain correctly scoped.

### Migration/deploy order

The policy tightening is safe to apply **before** the app deploys (it only
narrows a capability the UI is about to hide). The RPC must exist before the app
that calls it — so apply the migration first, then deploy.

---

## 12. Rollback considerations

* **App:** revert the deploy — the previous UI works against the new schema (the
  create RPC simply goes uncalled).
* **DB:** `create_business_organization` can be dropped harmlessly. Reverting the
  invitation guard means re-creating the prior `org_invitations_insert_admin`
  policy (without the `kind` clause). No data has changed, so rollback is a
  function/policy swap, not a data migration.

---

## 13. Known remaining work

* Manual responsive/RTL visual pass (§10) — no component-render harness in-repo.
* The workspace selector remains the minimal Settings list; moving it into the
  app chrome is a separate navigation change, deliberately out of scope here.
* Invitation email delivery, org deletion/transfer, and account types remain
  out of scope per the task.
