# Fleet Lite — organization members and invitations

How a Vin.ID organization gets more than one person in it, and what governs
what each of them may do.

## The one-line version

`organization_members` is the authorization authority. `profiles.organization_id`
and `profiles.role` remain only as a display/default cache and grant nothing.

## Why membership, and why it was a single switch

Phase 1 resolved the organization from `profiles.organization_id`. Every
org-scoped RLS policy and every Storage helper was already written in terms of
four SQL helpers — `current_org_id()`, `current_org_role()`, `is_org_writer()`
and (new) `is_org_admin()`. Repointing those four functions at
`organization_members` made every existing policy membership-driven in one
migration, with no policy rewrites.

That is also why the profile columns cannot quietly come back as an authority:
nothing reads them any more except display code.

### Profile cache synchronization

| Event | What updates the cache |
| --- | --- |
| Signup | `handle_new_user()` writes profile + owner membership together |
| Invitation accepted | `accept_invitation()` syncs `profiles` in the same transaction |
| Role changed | `changeMemberRole()` best-effort syncs `profiles.role` |
| Member removed | `removeMember()` best-effort clears `profiles.organization_id` |

The sync is best-effort on purpose. A drifted cache is cosmetic: membership is
read on every request, and `getCurrentUserProfile()` serves `organization_id`
and `role` **from the membership**, so a stale cache can neither elevate nor
demote anyone. Users cannot write these columns themselves — `profiles` RLS
allows a user to update only their own row, and no code path in the app includes
the org columns in an update.

## Roles

`owner` · `admin` · `fleet_manager` · `viewer` — defined once, in
`lib/organizations/types.ts`. There is no driver role in this product.

| Capability | owner | admin | fleet_manager | viewer |
| --- | :-: | :-: | :-: | :-: |
| Read fleet data | ✅ | ✅ | ✅ | ✅ |
| Write fleet data (vehicles, documents, …) | ✅ | ✅ | ✅ | — |
| List members | ✅ | ✅ | — | — |
| Create / revoke invitations | ✅ | ✅ | — | — |
| Change non-owner roles | ✅ | ✅ | — | — |
| Remove non-owner members | ✅ | ✅ | — | — |
| Create, demote or remove an **owner** | ✅ | — | — | — |

Enforced in three places: RLS policies and RPCs (database), the service layer
(`lib/organizations/members.ts`, `invitations.ts`), and the UI, which never
renders a control the server would refuse.

## The last-owner invariant

> An organization that continues to exist must never be left without an owner.

Enforced by `protect_last_owner()`, a `BEFORE UPDATE OR DELETE` trigger on
`organization_members`.

| Operation | Result |
| --- | --- |
| Remove / demote the last owner while the org lives | **rejected** |
| Move the last owner to a different organization | **rejected** |
| Remove / demote an owner when another owner exists | allowed |
| Delete the organization (cascades memberships) | allowed |
| Delete a non-owner's account (cascades membership) | allowed |
| Delete a co-owner's account (another owner remains) | allowed |
| Delete the **sole owner's** account while the org lives | **rejected** |

Two details worth knowing:

**Organization deletion is detected, not special-cased.** The trigger takes a
`FOR UPDATE` lock on the parent `organizations` row. If the row is already gone,
the delete is an `ON DELETE CASCADE` from `organizations` and is allowed through
— there is no surviving organization to leave ownerless.

**That same lock is the concurrency control.** Without it, two transactions
under READ COMMITTED both read "2 owners" and both remove one, leaving zero. The
lock serializes membership mutations per organization, so the second transaction
sees a single remaining owner and is rejected. Verified with concurrent
delete/delete, demote/demote and delete/demote.

### Account deletion of a sole owner

Deliberately **rejected** rather than orphaning the organization or silently
deleting it with all its fleet data. To delete such an account, either promote
another member to owner first, or delete the organization. Fixture teardown must
therefore run organization-first — see `scripts/validation/lib/org-fixtures.mjs`.

`profiles.organization_id` was changed from `RESTRICT` to `ON DELETE SET NULL`
so that deleting an organization is possible at all. Every other org-scoped
table keeps `RESTRICT` on purpose: an organization still holding vehicles or
documents must not vanish by accident.

## Invitations

### Token handling

- 256 bits from `randomBytes(32)`, rendered base64url.
- Only the **SHA-256 hash** is stored. A database leak yields no usable links.
- The raw token is returned **once**, in the invite URL from
  `createInvitation()`. It is never persisted, cached, or logged — not on
  success, not in an error path, and not by the validation harnesses. Lost link
  ⇒ revoke and reissue.
- Never placed in localStorage, sessionStorage or a cookie. It lives in the URL
  and in the server action argument.

### Lifecycle

`pending → accepted | revoked | expired`. Invitations expire after 7 days and
are never hard-deleted; revoking is a status change, preserving the audit trail.
A partial unique index allows one *pending* invitation per (organization,
email); a lapsed one is swept to `expired` first so re-inviting just works,
while a live duplicate is reported rather than silently issuing a second link.

Invitations can carry `admin`, `fleet_manager` or `viewer` — never `owner`.
Ownership is granted by promoting an existing member, not by emailing a link.

### The two RPCs

Both are `SECURITY DEFINER` with `search_path` pinned to `''`, contain no
dynamic SQL, take no organization or user argument, and derive identity from
`auth.uid()` inside the database.

`get_invitation_preview(hash)` — read-only. Returns only `state`,
`organization_name`, `role`, a **masked** email and `expires_at`. It creates no
membership and never returns the token hash. Granted to `anon` so the landing
page can render before sign-in.

`accept_invitation(hash)` — atomic, `authenticated` only. Locks the invitation
row `FOR UPDATE`, validates status/expiry/email, creates the membership,
consumes the invitation and syncs the profile cache in one transaction. Five
concurrent accepts produce exactly one membership and one `ok`.

> **Grants gotcha.** Postgres grants EXECUTE to PUBLIC on every new function, and
> Supabase additionally ships `alter default privileges … grant all on functions
> to anon, authenticated, service_role`. Revoking only PUBLIC leaves `anon`
> holding EXECUTE via the explicit default-privilege grant. `anon` must be
> revoked **by name** — see `20260725180000_invitation_rpc_grants.sql`.

### Accepting when you already have an organization

Every signup gets its own organization and an owner membership, and a user may
belong to one organization at a time. Left alone, that combination makes it
impossible for any existing account to ever accept an invitation — it always
returned `already_member`.

Acceptance therefore replaces the invitee's **auto-created personal
organization**, identified structurally: they are its only member, it has no
pending invitations, and it holds no fleet data. The last condition is enforced
by the database rather than a checklist — the `DELETE` simply fails with
`foreign_key_violation` against the RESTRICT foreign keys if anything is
attached, and the acceptance is refused. An organization with colleagues,
invitations or vehicles is never destroyed by accepting an invitation; the user
gets `already_member` instead.

Multi-organization membership and switching remain out of scope.

## Routes

| Route | Who | Notes |
| --- | --- | --- |
| `/organization` | signed-in | Team screen. Roster/invitations render for owner+admin only. |
| `/invite/[token]` | anyone | Preview + explicit Accept. |

**Opening an invitation link never accepts it.** The page only previews. A link
prefetcher, email scanner or chat-app unfurl bot cannot consume an invitation on
the recipient's behalf. Signed-out visitors go to `/login` or `/signup` with
`redirectTo` pointing back at the invitation; the auth actions validate it
through `safeRedirectPath()` as an internal path, so it is not an open redirect.

## Document access

Document authorization keys off the document row's organization (Phase 2), which
now follows membership. Consequences, all covered by the harnesses:

- A newly accepted member can open the organization's documents.
- Another organization cannot.
- A removed member cannot create **new** signed URLs.
- A viewer keeps read access and loses writes.
- A demoted member gets exactly the new role's permissions.
- Invitation preview and revoked invitations grant nothing.

> **Signed URLs already issued remain valid until they expire.** A signed URL is
> a bearer token minted by Storage; removing a member revokes their ability to
> mint new ones, but cannot retract one already handed out. The app uses
> short-lived URLs (60s in the harnesses) to bound this window. Treat "remove a
> member" as *no new access from now on*, not as instant retraction of a link
> they may already be holding.

## Validation

```bash
FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
SUPABASE_SERVICE_ROLE_KEY=… npm run validate:organization-members
```

Guards: requires `FLEET_CHECK_ALLOW=1`, refuses the production ref
`jsthfmgvcdrfzpgkpwvt`, refuses non-local URLs unless
`FLEET_CHECK_ALLOW_REMOTE=1`. Real per-persona JWT sessions make every
access-control assertion; the service role only builds and inspects fixtures.
No key, raw token or token hash is ever printed.

Personas: org A owner/admin/fleet manager/viewer, org B owner, invited existing
user, invited new user, wrong-email user, removed member, orphaned-profile user,
and anon.

Fixtures **must** use `organization_members` (`scripts/validation/lib/
org-fixtures.mjs`). A harness that sets `profiles.organization_id` instead is
testing an unauthenticated user and will pass for the wrong reason — the
document-storage harness had exactly that bug when the switch landed, and its
`joinOrg` fix is why "removed member cannot sign a URL" is meaningful again.
