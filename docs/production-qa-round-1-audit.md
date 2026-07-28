# Production QA round 1 — read-only audit

Audited at `61f6c87` (deployed `main`, Fleet Lite live in production).
Read-only. No application code, migration or production configuration was
changed. Production was not accessed; every reproduction below ran against a
local `supabase db reset` database.

---

## 1. Executive summary

Eight findings were investigated. Two are outright bugs I reproduced, three are
capabilities that were never built, two are discoverability problems where the
feature already works, and one is a scope correction.

| # | Finding | Verdict | Severity |
| --- | --- | --- | --- |
| 1 | Invitation email never arrives | **Not implemented.** No provider, no dependency, no call site anywhere in the repo | Blocker |
| 2 | An invited private user cannot join | **Reproduced.** `accept_invitation` returns `already_member` for anyone who owns even one vehicle | Blocker |
| 3 | Invitation link is lost through email/password signup | **Reproduced by inspection.** `signup()` never reads `redirectTo`; the signup form never sends it | Blocker |
| 4 | No post-signup Personal vs Organization choice | Not implemented. Every signup silently becomes an org owner | High |
| 5 | Organization screen hard to find | **Built and working**, reachable only from Settings, unlabelled as Team & Access | Medium |
| 6 | Operational fields not editable after creation | **Already works end to end.** The real defect is that *assigned driver* has two competing sources | Medium |
| 7 | `Needs attention` sticks after resolving an issue | **Reproduced.** `vehicles.operational_status` is a stored column nothing recomputes | High |
| 8 | Fleet list clutter | Nearest-expiry is in the Fleet list. Passport history is **not** — it is on the vehicle detail page | Low |

**The single structural blocker behind findings 2, 3 and 4** is
`organization_members_user_unique UNIQUE (user_id)`
(`supabase/migrations/20260725140000_organization_members_invitations.sql:43`).
One user may hold exactly one membership. The founder requirement — *"One user
may use Personal only, belong to one or more organizations, use both"* — is not
expressible under that constraint. Everything else in the invitation and
workspace plan depends on lifting it.

Nothing found here is a security defect. Two findings (2 and the `already_member`
path) are the system *refusing* to act, which is the safe direction.

---

## 2. Current flow maps

### 2.1 Signup → provisioning

```
/signup  (app/(auth)/signup/page.tsx)
  → auth-form.tsx  →  signup()  (app/(auth)/actions.ts:92)
      supabase.auth.signUp({ email, password, data:{ first_name, last_name, full_name }})
          │
          ├── DB trigger on_auth_user_created → public.handle_new_user()
          │      1. name := full_name | name | email local-part | 'My fleet'
          │      2. INSERT organizations (name, email)          ← always, unconditionally
          │      3. INSERT profiles (id, organization_id, 'owner')
          │      4. INSERT organization_members (org, user, 'owner')
          │
          ├── no session (email confirmation ON)  → return { success:true } → "check your email"
          └── session (confirmation OFF)          → mirror full_name → redirect("/dashboard")
```

`handle_new_user()` is at
`supabase/migrations/20260725140000_organization_members_invitations.sql:288`.

Consequences, all confirmed in code:

* **Every** user gets an organization and an `owner` membership at signup. There
  is no such thing today as a user without an organization.
* A "personal" organization is **not flagged**. It is identified *structurally*
  by `accept_invitation()`: sole member, no pending invitations, no fleet data.
* There is **no `account_type`, no onboarding flag, no `last_workspace`
  column** anywhere. Verified against every migration and against the live local
  schema.
* `signup()` **ignores `redirectTo` entirely** — it is not in the schema, not
  read from `formData`, and the redirect target is the literal `"/dashboard"`
  (`app/(auth)/actions.ts:144`).

### 2.2 Workspace / organization resolution

```
getAuthUserId()                       lib/organizations/service.ts:62
  → getCurrentMembership()            :74   SELECT ... FROM organization_members WHERE user_id = uid  (.maybeSingle())
      → getCurrentUserProfile()       :116  profile row, but organization_id/role OVERRIDDEN by membership
      → requireOrganization()         :159  throws OrganizationMissingError when membership is null
      → getCurrentUserContext()       :179  never throws; reports membership:null
      → requireFleetWriter() :233 / requireOrganizationAdmin() :242 / requireOrganizationOwner() :261
```

Database side (`current_org_id`, `current_org_role`, `is_org_writer`,
`is_org_admin`, `is_org_driver`) all read `organization_members`, all
`SECURITY DEFINER` with `set search_path = ''`. Every org-scoped RLS policy is
anchored on `organization_id = public.current_org_id()`.

* There is **no organization selector and no persisted selection** — none is
  possible, because `.maybeSingle()` on a `UNIQUE(user_id)` table can only ever
  return one row.
* `profiles.organization_id` / `profiles.role` are a display cache. Line 142 of
  `service.ts` is explicit: *"Membership overrides the profile cache — never the
  other way round."* This is correct and must be preserved.
* Route guards: `app/(app)/layout.tsx` checks the session and computes
  `isDriver` for navigation only; each Fleet screen guards itself
  (`redirectDriversAway()`, `canWriteFleetData`, `canManageOrganization`), and
  RLS denies the rows regardless.

### 2.3 Invitations

```
/organization  (owner|admin only)
  → InviteForm → createInvitation()          lib/organizations/invitations.ts:111
        requireOrganizationAdmin()
        validate { email, role∈INVITABLE_ROLES }
        reject if already a member
        expire lapsed pending rows
        getAppBaseUrl()                       ← fails closed with "linkUnavailable"
        randomBytes(32) → base64url raw token; only sha256 hash is stored
        INSERT organization_invitations
        return { inviteUrl: `${base}/invite/${rawToken}` }     ← shown ONCE, copy button
                                                               ← NO EMAIL IS SENT

/invite/[token]  (public, robots noindex)
  → previewInvitation() → RPC get_invitation_preview(hash)      anon-executable, returns
        { organization_name, role, email_masked, expires_at }   no membership created
  → signed in?  <AcceptInvitation> (explicit button, server action)
     signed out? links to /login?redirectTo=/invite/... and /signup?redirectTo=/invite/...

  → acceptInvitation() → RPC accept_invitation(hash)            SECURITY DEFINER, one transaction
```

`accept_invitation()`
(`supabase/migrations/20260725170000_accept_invitation_join_org.sql:32`) decides,
in order: `not_authenticated` → `invalid` → `revoked` → `accepted` → `expired`
→ `email_mismatch` → same-org replay → **personal-org replacement** → insert
membership with the invited role.

---

## 3. Relevant routes and files

| Concern | Files |
| --- | --- |
| Signup / login | [app/(auth)/actions.ts](app/(auth)/actions.ts), [app/(auth)/auth-form.tsx](app/(auth)/auth-form.tsx), [app/(auth)/signup/page.tsx](app/(auth)/signup/page.tsx), [app/auth/callback/route.ts](app/auth/callback/route.ts) |
| Org context | [lib/organizations/service.ts](lib/organizations/service.ts), [lib/organizations/types.ts](lib/organizations/types.ts) |
| Invitations | [lib/organizations/invitations.ts](lib/organizations/invitations.ts), [app/invite/[token]/page.tsx](app/invite/[token]/page.tsx), [app/invite/[token]/actions.ts](app/invite/[token]/actions.ts), [components/organization/invite-form.tsx](components/organization/invite-form.tsx), [components/organization/invitation-list.tsx](components/organization/invitation-list.tsx) |
| Members / roles | [lib/organizations/members.ts](lib/organizations/members.ts), [app/(app)/organization/page.tsx](app/(app)/organization/page.tsx), [components/organization/member-list.tsx](components/organization/member-list.tsx) |
| Navigation | [components/nav-config.ts](components/nav-config.ts), [components/app-nav.tsx](components/app-nav.tsx), [app/(app)/settings/page.tsx](app/(app)/settings/page.tsx) |
| Vehicle fields | [lib/vehicles/types.ts](lib/vehicles/types.ts), [lib/vehicles/service.ts](lib/vehicles/service.ts), [components/vehicles/vehicle-form.tsx](components/vehicles/vehicle-form.tsx), [app/(app)/vehicles/[id]/edit/page.tsx](app/(app)/vehicles/[id]/edit/page.tsx) |
| Attention / fleet list | [lib/fleet/types.ts](lib/fleet/types.ts), [lib/fleet/alerts.ts](lib/fleet/alerts.ts), [lib/fleet/service.ts](lib/fleet/service.ts), [components/fleet/fleet-vehicle-row.tsx](components/fleet/fleet-vehicle-row.tsx) |
| Passport | [lib/passports/service.ts](lib/passports/service.ts), [components/passports/passport-section.tsx](components/passports/passport-section.tsx) |
| Drivers | [lib/drivers/](lib/drivers/), [components/drivers/driver-assignment-card.tsx](components/drivers/driver-assignment-card.tsx) |
| Base URL | [lib/app-url.ts](lib/app-url.ts) |

---

## 4. Tables, functions, triggers, policies

**Tables** — `organizations`, `organization_members` (**`UNIQUE(user_id)`**),
`organization_invitations` (unique partial index on `(organization_id,
lower(email)) WHERE status='pending'`), `driver_assignments`, `profiles`
(+`organization_id`, `role` cache), plus 15 org-scoped data tables.

**Functions** — `handle_new_user` (trigger), `current_org_id`,
`current_org_role`, `is_org_writer`, `is_org_admin`, `is_org_driver`,
`can_access_vehicle`, `can_manage_driver_assignments`,
`can_read_document_object`, `can_write_document_object`,
`get_invitation_preview` (anon), `accept_invitation`, `list_organization_members`,
`assign_driver`, `unassign_driver`, `list_eligible_drivers`,
`get_vehicle_assignment_history`, `org_owner_count`, `protect_last_owner`
(trigger), `set_organization_id_from_owner` (trigger),
`enforce_assignment_member_is_driver` (trigger).

**Roles** — `organization_members.role ∈ (owner, admin, fleet_manager, viewer,
driver)`; `organization_invitations.role ∈ (admin, fleet_manager, viewer,
driver)` — **`owner` is already un-invitable at the database level**, which is
exactly what the short-code requirement needs.

---

## 5. Confirmed causes

### 5.1 Invitation email — **no email delivery is implemented**

Classification: **no email delivery is implemented** (the first option in the
brief), not "unconfigured" and not "provider call fails".

Evidence — a repository-wide search for `resend|sendgrid|postmark|nodemailer|
mailgun|smtp|sendEmail|inviteUserByEmail|mailer` across `app/`, `lib/`,
`components/`, `scripts/` and `package.json` returns **zero** matches outside
unrelated `emailError` form-validation identifiers. There is no provider
dependency, no API-route, no server action and no Supabase
`auth.admin.inviteUserByEmail` call. `createInvitation()` returns `inviteUrl`
to the caller and the UI renders it with a Copy button
(`components/organization/invite-form.tsx:118-128`).

So the invitation *row* is created correctly and the *link works* — it was
simply never sent to anybody. The founder's test invitation could not arrive.

Secondary risk on the same path: `getAppBaseUrl()` resolves
`APP_PUBLIC_URL` → request headers → `VERCEL_URL`, and in production it
**rejects any loopback URL** and logs a warning (`lib/app-url.ts:117-122`). Your
`.env.local` carries `APP_PUBLIC_URL=http://localhost:3000`; if that value ever
reached Vercel, invitation creation would fail closed with `linkUnavailable`
rather than mint a broken link. Worth confirming the Vercel value.

Environment variables that a mail provider would need (none exist today; names
only, no values): a provider API key (e.g. `RESEND_API_KEY`), a verified
`INVITATION_FROM_EMAIL`, and `APP_PUBLIC_URL` already present. Adding a provider
means adding a dependency, which `AGENTS.md` puts behind explicit approval —
see §16.

**Copy Link exists. Resend does not. Revoke exists.**
`invitation-list.tsx:16` states the design intent plainly: the raw token is
never persisted, so there is deliberately no "copy again" affordance and
revoking is the way to invalidate a lost link. A Resend feature therefore has to
*mint a new token* — it cannot re-send the old one.

### 5.2 An invited private user cannot join — reproduced

`accept_invitation()` may only replace an existing organization if it is
disposable: sole member, no pending invitations, and **no fleet data** (enforced
by `RESTRICT` foreign keys — the `DELETE` raises `foreign_key_violation`, which
is caught and converted to `already_member`).

Reproduced locally on a clean `supabase db reset`:

```
accept_invitation for a private user who owns 1 vehicle -> {"state": "already_member"}
accept_invitation for a private user with NO data       -> {"state": "ok", "organization_id": "..."}
```

Any real user — anyone who has added a single vehicle — is refused. The message
they see is "already a member", which is also misleading: they are not a member
of the inviting organization at all.

### 5.3 Invitation link lost through signup — reproduced by inspection

Three independent breaks on the same path:

1. `app/(auth)/auth-form.tsx:130` — `{isLogin && redirectTo ? <input hidden…>}`.
   The hidden field is rendered **only for login**. The signup form never posts
   `redirectTo`.
2. `app/(auth)/actions.ts:92-145` — `signup()` never reads `redirectTo` from
   `formData` and ends at the literal `redirect("/dashboard")`.
3. Email confirmation returns `{ success:true }` with no session and no state;
   the confirmation link goes to Supabase's own redirect target, so even a
   carried token would not survive the round trip.

Google OAuth is the exception and **does** work: `auth-form.tsx:101` posts
`redirectTo` on the Google form, `signInWithGoogle()` puts it in the callback
URL, and `app/auth/callback/route.ts` validates and honours `next`.

So today: invited user + Google = lands back on the invite; invited user +
email/password = lands on `/dashboard` inside a brand-new personal organization,
with the invitation still pending and now un-acceptable per §5.2.

### 5.4 No onboarding choice

Not implemented, and not expressible under the current schema — `handle_new_user`
creates the organization unconditionally inside the auth trigger, before any UI
could ask.

### 5.5 Organization UI

Not hidden — **built, working, and reachable**, but only from
`app/(app)/settings/page.tsx:90` as a link inside a Settings card. It is absent
from `navItems` (`components/nav-config.ts:19-24`). The comment at
`settings/page.tsx:83` explains why: *"the bottom nav keeps four slots on
mobile"*. The screen itself is complete: organization identity, role badge,
member list with role change and removal, invite form with role selector,
pending-invitation list with revoke, and last-owner protection in the database,
the service layer and the UI.

### 5.6 Vehicle operational editing — already works

Contrary to the QA note, all four fields are editable after creation today:

* `components/vehicles/vehicle-form.tsx` renders `next_service_date`,
  `next_service_km`, `test_expiry_date`, `insurance_expiry_date`,
  `operational_status`, `assigned_driver_name`, `assigned_driver_phone` in
  **both** modes — `mode` only changes the submit label (`:346`).
* `vehicleToFormValues()` (`lib/vehicles/types.ts`) prefills every one of them.
* `app/(app)/vehicles/[id]/edit/page.tsx` passes `mode="edit"` and binds
  `updateVehicleAction`.
* `updateVehicle()` (`lib/vehicles/service.ts:109`) writes
  `vehicleInputToRow(input)`, which spreads `fleetFieldsToRow(input)`.
* The Edit link is on the vehicle detail page (`[id]/page.tsx:123`).

**The genuine defect is *assigned driver*, which has two competing sources** —
see §9.

### 5.7 `Needs attention` — reproduced

`vehicles.operational_status` is a **manually stored** column. Grepping every
migration for a trigger or function that writes it returns nothing; the only
writers in the whole codebase are `updateVehicle()` and `setOperationalStatus()`
(`lib/vehicles/service.ts:124`), both user-driven.

The *derived* signals are correct — `lib/fleet/service.ts:411` filters
`.in("status", OPEN_ISSUE_STATUSES)` where `OPEN_ISSUE_STATUSES = ["open",
"monitoring"]` (`lib/fleet/alerts.ts:68`), so `openIssueCount` and the dashboard
action list both clear the moment an issue is resolved.

But `needsAttention(status) { return status !== "active" }`
(`lib/fleet/types.ts:40`) reads the **stored** column, and
`OperationalStatusBadge` renders it. Reproduced locally:

```
STEP 1-2  one open issue  -> vehicles.operational_status = issue_open
STEP 3-4  issue resolved; open/monitoring issues now = 0
STEP 5    vehicles.operational_status is STILL 'issue_open'
```

Classification: **status materialization** — a stored column with no
recomputation path. Not query filtering, not caching, not revalidation.

### 5.8 Fleet list and Passport — scope correction

* Nearest document expiry **is** in the Fleet list, as the third of five
  `Field`s in `components/fleet/fleet-vehicle-row.tsx:126-130`, and as the
  `document_expiry` sort option (`lib/fleet/types.ts:136`, applied at
  `lib/fleet/service.ts:799`).
* Passport history is **not in the Fleet list at all.** A grep for `passport`
  across `fleet-vehicle-row.tsx`, `vehicle-card.tsx`, `app/(app)/vehicles/page.tsx`
  and `components/fleet/*` returns nothing. The history lives on the **vehicle
  detail** page: `PassportSection` renders up to 3 recent passport cards plus a
  "view all N" link (`components/passports/passport-section.tsx:12,23,55`).

I have planned the cleanup against where the code actually is (§11). If the
intent really was the Fleet list, the Passport half of that task is already
satisfied and only the expiry column needs removing.

---

## 6. Personal / Organization workspace recommendation

### Rules

1. **Membership remains the only authorization boundary.** `current_org_id()`
   must keep resolving from `organization_members`. A workspace selection is a
   *filter over memberships the user already holds*, never a grant.
2. **Personal is an organization**, flagged rather than inferred. Add
   `organizations.kind ∈ ('personal','business')` (default `'business'`;
   `handle_new_user` writes `'personal'`). This replaces the fragile structural
   test in `accept_invitation` and lets the UI hide Fleet concepts from Personal
   without a second data model.
3. **Lift `UNIQUE(user_id)`** to `UNIQUE(user_id, organization_id)`. This is the
   change that makes findings 2, 3 and 4 solvable.
4. **Add an explicit current-organization pointer**, `profiles.active_organization_id`,
   *validated against membership on every read*:

   ```sql
   -- resolution order, all inside current_org_id():
   --   1. active_organization_id, IF the caller still has a membership in it
   --   2. else the personal organization, if any
   --   3. else the oldest membership
   --   4. else NULL
   ```

   Step 1's validation is what stops workspace selection becoming a security
   boundary: a stale or forged pointer resolves to nothing rather than to
   someone else's tenant.
5. **Onboarding choice is UI-only.** Personal → the org the trigger already
   made. "Join an organization" → the invite/code entry screen. It sets no
   permission.

### What must not change

`getCurrentUserProfile()`'s rule that membership overrides the profile cache;
the `SECURITY DEFINER` + pinned `search_path` on every helper; and the fact that
every org-scoped policy is `organization_id = current_org_id()`.

---

## 7. Invitation email diagnosis

See §5.1. **No email delivery is implemented.** The row is created, the token
is sound, the link is correct; nothing sends it.

Minimum fix that needs no dependency and no approval: make the copy-link path
honest and reliable — a persistent "Copy invite link" on each pending
invitation (by reissuing a token), plus explicit UI copy stating the link must
be sent manually. That closes the production blocker on its own.

Adding a real provider is a separate, approval-gated step (§16, Open decision 1).

---

## 8. Link and short-code design

### Return-to-invite (minimal, no schema change)

1. Render the `redirectTo` hidden input for **signup as well as login** — delete
   `isLogin &&` at `auth-form.tsx:130`.
2. Have `signup()` read `redirectTo` through the existing `safeRedirectPath()`
   (already written, already open-redirect-safe, currently used only by
   `login()`), and pass it to Supabase as
   `options.emailRedirectTo = ${base}/auth/callback?next=${redirectTo}` so the
   token survives email confirmation.
3. Keep acceptance **explicit** — the button on `/invite/[token]` stays. Never
   auto-accept on page load; the current comment at `invite/[token]/page.tsx:18`
   documents why (prefetchers, email scanners, chat previews).
4. The token stays in the URL only. Do not put it in a cookie or localStorage.

### Short join code — recommendation

**Represent the short code as an alternate credential on the existing
`organization_invitations` row, not as a separate join-code entity.**

Reasons: it inherits the email restriction, expiry, revocation, replay
prevention and audit trail that already exist and are already tested; the
inviter still picks the role, which the founder requires; the `owner` role is
already excluded by the table's CHECK constraint; and it adds no new
enumeration surface beyond what `get_invitation_preview` already exposes. A
separate org-wide join code would be a *bearer* credential with no named
recipient — a different and much larger security object, and it would need its
own rate limiting, max-uses accounting and abuse story.

Design (migration deferred to implementation):

| Property | Decision |
| --- | --- |
| Entropy | 8 characters from a 32-symbol Crockford-style alphabet (no `I/L/O/U`) ≈ 40 bits |
| Storage | `code_hash text unique` — SHA-256, same pattern as `token_hash`. Raw code shown once |
| Lookup | Normalize (uppercase, strip separators) then hash; constant-time by construction |
| Expiry | Reuses `expires_at` (7 days) |
| Revocation | Reuses `status='revoked'` |
| Max uses | 1 — it is one invitation |
| Email restriction | Reuses the existing `lower(email)` match in `accept_invitation` |
| Roles | Reuses the CHECK: `admin, fleet_manager, viewer, driver`. **Never `owner`** |
| Rate limiting | Required: throttle failed redemptions per IP **and** per account. 40 bits needs it |
| Enumeration | The preview RPC must return the same shape for wrong and expired codes |
| Audit | `accepted_at` / `accepted_by` already exist |

---

## 9. Vehicle field source-of-truth matrix

| Field | UI | Schema | Table.column | Server path | RLS | Editable now | Source of truth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Next service date | `vehicle-form.tsx:300` | `fleetVehicleFieldsSchema` | `vehicles.next_service_date` | `updateVehicle` → `fleetFieldsToRow` | org writer | **Yes** | `vehicles` ✅ single |
| Next service mileage | `:308` | same | `vehicles.next_service_km` (CHECK ≥ 0) | same | org writer | **Yes** | `vehicles` ✅ single |
| Test / inspection expiry | `:317` | same | `vehicles.test_expiry_date` | same | org writer | **Yes** | `vehicles` ✅ single |
| Insurance expiry | `:325` | same | `vehicles.insurance_expiry_date` | same | org writer | **Yes** | `vehicles` ✅ single |
| Operational status | `:256` | same | `vehicles.operational_status` | `updateVehicle` **and** `setOperationalStatus` | org writer | Yes | `vehicles`, **stale** — §5.7 |
| **Assigned driver** | `:283` free text **and** `DriverAssignmentCard` | both | `vehicles.assigned_driver_name/_phone` **and** `driver_assignments` | `updateVehicle` **and** `assign_driver()` RPC | org writer / `can_manage_driver_assignments` | Yes, **twice** | ❌ **conflict** |

### The assigned-driver conflict

Two unrelated representations, neither aware of the other:

* `vehicles.assigned_driver_name` / `_phone` — free text typed into the vehicle
  form. Consumed by `components/fleet/fleet-info-card.tsx:70-78` (including a
  `tel:` link), `fleet-vehicle-row.tsx:68`, and the fleet-list `has_driver` /
  `no_driver` filters (`lib/fleet/service.ts:718-720`). Grants nothing.
* `driver_assignments` + `assign_driver()` / `unassign_driver()` /
  `list_eligible_drivers()` — the real linkage to a `driver`-role member. This
  is what actually grants the driver access to the vehicle, and it is guarded by
  `can_manage_driver_assignments()` and the
  `enforce_assignment_member_is_driver` trigger.

A fleet manager who types a name into the vehicle form believes they assigned a
driver. Nobody gains access. Conversely a real assignment leaves the free-text
field showing whatever was typed before.

**Recommendation — one authoritative path per field:**

* Keep `vehicles.*` as the single source for the four date/mileage fields. No
  change needed beyond what already works.
* Make **`driver_assignments` authoritative for "who drives this vehicle"**.
  Demote `assigned_driver_name/_phone` to an explicitly-labelled *contact note*
  for drivers who have no VIN-ID account, or hide it once an assignment exists.
  Do **not** drop the columns — they hold real production data and the fleet
  filters read them.
* `operational_status` — see §10.

---

## 10. `Needs attention` root cause and fix

**Cause: status materialization.** A stored column with no recomputation path
(§5.7, reproduced).

Three options, in order of preference:

1. **Derive the attention state, keep the column for manual override**
   (recommended, **no migration**). Introduce
   `effectiveOperationalStatus(vehicle, openIssueCount)`:
   * `out_of_service`, `in_garage` — manual, always win. These mean "the
     operator says this vehicle cannot work" and must never be auto-cleared.
   * `issue_open` — derived. Shown when `openIssueCount > 0`; falls back to
     `active` when it reaches 0.
   * `needs_service`, `documents_missing` — already derivable from
     `next_service_*` and document expiry, which the dashboard alerts compute
     anyway.

   The whole change lands in `lib/fleet/` plus the badge components, is
   unit-testable without a database, and cannot corrupt data.

2. A trigger on `issue_logs` that resets `operational_status` to `active` when
   the last open issue closes. Rejected: it silently overwrites a manual
   setting, and it has to guess whether `issue_open` was set by a human.

3. A generated/materialized column. Rejected: `needs_service` and
   `documents_missing` depend on other tables and on "today", so it cannot be a
   `GENERATED` column, and a materialized one reintroduces staleness.

---

## 11. Fleet-list cleanup plan

All UI/query, **no migration, no data deleted**.

1. **Remove the nearest-expiry Field** —
   `components/fleet/fleet-vehicle-row.tsx:126-130`. Keep
   `documents.nearestExpiry` in `FleetVehicleRow`: the dashboard action list
   (`lib/fleet/service.ts:318,326`) reports `document_expiring` /
   `document_expired` from it, and that must survive per the founder's
   requirement.
2. **Decide the `document_expiry` sort option** (`lib/fleet/types.ts:136`,
   applied at `service.ts:799`). Removing the column while keeping a sort by
   the invisible value is confusing; I recommend removing the sort option too,
   which needs a message-catalog key removal in both locales.
3. **Passport** — replace `PassportSection`'s recent-list + "view all" with a
   single contextual action on the **vehicle detail** page:
   * an `active` passport (status `active` and not past `expires_at`, per
     `effectivePassportStatus()` at `lib/passports/types.ts:183-191`) → **Open
     Passport** → `/vehicles/[id]/passports/[passportId]`
   * otherwise → **Create Passport** → `/vehicles/[id]/passports/new`
   * keep `/vehicles/[id]/passports` reachable as a secondary "history" link so
     no data becomes unreachable.
4. `listPassports()` is unchanged; the full history page still uses it. **No
   row is deleted and no query is narrowed** — only the rendering changes.

---

## 12. Migration plan

| # | Migration | Purpose | Objects | Backward compatible | Backfill | Risk | Rollback | Necessary? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | `organizations.kind` | Flag personal vs business so the UI can hide Fleet concepts and `accept_invitation` stops inferring | 1 column + CHECK, default `'business'` | Yes — additive, nullable-safe | `kind='personal'` where the org has exactly one member who is its `owner`, no pending invitations and no fleet data (the same structural test `accept_invitation` uses today) | Low | Drop column | **Yes** — the structural test is already the cause of finding 2 |
| M2 | Multi-membership | Drop `organization_members_user_unique`, add `UNIQUE(user_id, organization_id)` | 1 constraint swap + index | Yes — every existing row satisfies the new key | None | **Medium** — `getCurrentMembership()` uses `.maybeSingle()`, which *throws* on multiple rows. M2 must not ship before the resolver is updated | Re-add the old unique (only while every user still has one membership) | **Yes** — nothing else unblocks findings 2/3/4 |
| M3 | `profiles.active_organization_id` | Persist the chosen workspace | 1 column + FK + index | Yes — NULL means "resolve by rule" | None | Low | Drop column | **Yes**, once M2 lands |
| M4 | `current_org_id()` rewrite | Honour M3 with membership validation | `CREATE OR REPLACE` on one function | Yes — same signature, same return | None | **Medium** — every org RLS policy calls it. Must be tested against all six audits before it goes near production | `CREATE OR REPLACE` back to the current body | **Yes**, with M3 |
| M5 | `accept_invitation()` rewrite | Stop destroying the personal org; join *in addition to* it | `CREATE OR REPLACE` | Yes | None | Medium | Replace back | **Yes** — this is finding 2 |
| M6 | Invitation short code | `code_hash text unique` + partial index | 1 column + 1 index | Yes — nullable | None | Low | Drop column | Only if short codes are approved |
| M7 | Invitation resend | `superseded_by uuid`, `sent_count int` | 2 columns | Yes | None | Low | Drop columns | Optional — only if Resend is built |

**No migration is needed for:** vehicle operational editing (§5.6), the
attention fix under option 1 (§10), or the Fleet-list/Passport cleanup (§11).
Three of the eight findings are pure UI/query work.

---

## 13. Security impact

| Risk | Assessment |
| --- | --- |
| **RLS** | M4 is the only change that touches an authorization primitive. Every org policy calls `current_org_id()`, so it must keep returning exactly one organization the caller is a member of, and must stay `SECURITY DEFINER` with `set search_path = ''`. All six audits must pass before it ships. |
| **Workspace ≠ authorization** | `active_organization_id` must be validated against `organization_members` **inside** `current_org_id()` on every call. A stale or forged pointer must resolve to NULL, never to another tenant. This is the single most important rule in the whole plan. |
| **Cross-org access** | M2 lets a user hold several memberships. Every screen already scopes by `current_org_id()`, so the exposure is a *wrong-workspace* bug, not a leak — provided M4 validates. Add an explicit multi-org isolation test. |
| **Role escalation** | The inviter chooses the role; `organization_invitations.role` excludes `owner` at the database level; `accept_invitation` inserts `v_inv.role` and never a client-supplied value. Preserve all three. A short code must not widen this. |
| **Invitation enumeration** | `get_invitation_preview` is anon-executable by design and returns a masked email. Verified: a random hash returns `{"state":"invalid"}` with no distinguishing detail. A short code has ~40 bits, so **rate limiting is mandatory**, and wrong/expired must be indistinguishable. |
| **Token leakage** | Raw tokens are never persisted or logged; error paths log only the Postgres code. Any Resend feature must mint a **new** token — it cannot recover the old one. |
| **Driver restrictions** | `driver` is RPC-only, holds no Fleet table read, sees no costs. Making `driver_assignments` authoritative must not add a Fleet-table grant. |
| **Viewer restrictions** | `is_org_writer()` excludes `viewer`. The vehicle edit form and the new Passport action must both stay behind `canWriteFleetData`. |
| **Public Passport** | Untouched. The cleanup changes rendering only; snapshot, token hashing and the public RPC are not in scope. |
| **Signed Storage URLs** | Untouched. |
| **Onboarding UI** | Purely presentational. Choosing "Personal" must not write a role, and choosing "Organization" must not create a membership — only an invitation acceptance may do that. |

---

## 14. Ordered implementation tasks

| # | Task | Branch | Depends on |
| --- | --- | --- | --- |
| 1 | Invitation reliability and join flow | `fix/invitation-join-flow` | — |
| 2 | Post-signup onboarding and workspace context | `feat/workspace-onboarding` | 1 |
| 3 | Team & Access navigation | `feat/team-and-access-nav` | 2 |
| 4 | Vehicle operational editing (driver source of truth) | `fix/vehicle-driver-source-of-truth` | — |
| 5 | Attention-status correction | `fix/attention-status` | — |
| 6 | Fleet-list and Passport cleanup | `chore/fleet-list-cleanup` | — |
| 7 | Full regression and production release | `release/qa-round-1` | all |

I kept the founder's order. Tasks 4, 5 and 6 have **no dependency** on 1–3 and
need no migration, so they can run in parallel and ship first if you want
visible progress early.

---

## 15. Task detail and acceptance criteria

### Task 1 — Invitation reliability and join flow
**Branch** `fix/invitation-join-flow`
**Goal** An invited person can actually join, and the inviter can reliably get
them a link.
**Files** `app/(auth)/actions.ts`, `app/(auth)/auth-form.tsx`,
`lib/organizations/invitations.ts`, `components/organization/invitation-list.tsx`,
`app/invite/[token]/*`, migrations M1 + M5 (+ M6/M7 if approved).
**Database** M1, M5. **Security** role still inviter-chosen; `owner` still
un-invitable; explicit acceptance preserved; new tokens on resend.
**Acceptance**
1. A user who owns vehicles accepts an invitation and joins — no `already_member`.
2. Their personal organization and every vehicle in it survive, unchanged.
3. Signup with `redirectTo=/invite/{token}` returns to the invitation, before
   and after email confirmation.
4. The accepted role is exactly the inviter's choice.
5. Replay returns `accepted`, creating no second membership.
6. Wrong email → `email_mismatch`; revoked → `revoked`; expired → `expired`.
7. Every pending invitation offers a working link; the UI states plainly that it
   must be sent manually (until a provider is approved).

### Task 2 — Post-signup onboarding and workspace context
**Branch** `feat/workspace-onboarding`
**Files** `lib/organizations/service.ts`, `app/(auth)/actions.ts`, a new
onboarding route, `app/(app)/layout.tsx`; migrations M2, M3, M4.
**Database** M2, M3, M4. **Security** the §13 validation rule is the acceptance
gate.
**Acceptance**
1. After signup the user chooses Personal or Join an organization.
2. Personal lands on the existing private-vehicle experience with no Fleet
   concepts.
3. A user in two organizations can switch, and sees only the active one's data.
4. A tampered `active_organization_id` resolves to no access — not to another
   tenant.
5. All six SQL audits and all 524 existing assertions still pass.

### Task 3 — Team & Access navigation
**Branch** `feat/team-and-access-nav`
**Files** `components/nav-config.ts`, `components/app-nav.tsx`,
`app/(app)/organization/page.tsx`, `messages/*`.
**Database** none. **Security** entry visible only to `canManageOrganization`;
the page keeps its own guard.
**Acceptance** reachable in ≤ 1 tap from the Organization workspace; absent for
Personal and for drivers; mobile bottom nav still fits four slots at 320px.

### Task 4 — Vehicle operational editing
**Branch** `fix/vehicle-driver-source-of-truth`
**Files** `components/vehicles/vehicle-form.tsx`,
`components/fleet/fleet-info-card.tsx`, `lib/fleet/service.ts`, `messages/*`.
**Database** none. **Security** assignment stays behind
`can_manage_driver_assignments()`.
**Acceptance** the four date/mileage fields remain editable (regression-locked
by test); exactly one driver control is authoritative; assigning a driver
updates that driver's access; `assigned_driver_name` is relabelled, not dropped.

### Task 5 — Attention-status correction
**Branch** `fix/attention-status`
**Files** `lib/fleet/types.ts`, `lib/fleet/service.ts`, badge components.
**Database** none.
**Acceptance** resolving the last open issue clears `Needs attention` on the
vehicle card, the fleet list and the dashboard counters; a manual
`out_of_service` / `in_garage` is never auto-cleared; dashboard and list counts
still agree.

### Task 6 — Fleet-list and Passport cleanup
**Branch** `chore/fleet-list-cleanup`
**Files** `components/fleet/fleet-vehicle-row.tsx`,
`components/passports/passport-section.tsx`, `lib/fleet/types.ts`, `messages/*`.
**Database** none.
**Acceptance** no nearest-expiry column in the Fleet list; document-expiry
alerts still on the Dashboard; one contextual Passport action; the history page
still reachable; `select count(*) from vehicle_passports` unchanged.

### Task 7 — Regression and release
**Branch** `release/qa-round-1`
**Acceptance** 524+ assertions, six audits, tsc/lint/build, legacy-upgrade
migration gate, EN/HE/RTL at 320/375/768/1280px, then the production release
procedure from `docs/production-release-preflight.md`.

---

## 16. Open founder decisions

Only where code evidence cannot resolve it.

1. **Invitation email provider.** Sending email needs a new paid/third-party
   dependency, which `AGENTS.md` places behind explicit approval. Options:
   (a) manual copy-link only — ships now, no dependency;
   (b) Supabase Auth's own invite mail — no new vendor, but it creates the auth
   user and changes the signup shape;
   (c) a provider such as Resend — best UX, needs approval, a verified sending
   domain and two new env vars.
   **My recommendation: (a) now, (c) as a follow-up.**

2. **Short join code.** Confirm you want it at all, given a working link. If
   yes, confirm the ~40-bit code with mandatory rate limiting and the
   email restriction retained.

3. **`document_expiry` sort option** — remove with the column, or keep sorting
   by a value no longer displayed?

4. **Fleet list vs vehicle detail for the Passport cleanup.** The Passport
   history is on the vehicle detail page, not the Fleet list (§5.8). I planned
   for where the code is; confirm that matches your intent.

5. **`assigned_driver_name` after Task 4** — relabel as a contact note for
   drivers without an account, or hide it entirely once a real assignment
   exists?
