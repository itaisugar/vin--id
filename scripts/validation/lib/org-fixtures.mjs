/**
 * Shared fixture helpers for the Fleet Lite validation harnesses.
 *
 * MEMBERSHIP, NOT PROFILES. `organization_members` is the authorization
 * authority: `current_org_id()` / `current_org_role()` / `is_org_writer()` /
 * `is_org_admin()` all read it, so every RLS policy and Storage helper follows
 * it. Setting `profiles.organization_id` / `profiles.role` — which is how these
 * harnesses used to build fixtures — now grants nothing at all. A harness that
 * still did that would "pass" while testing an unauthenticated user.
 *
 * TEARDOWN ORDER MATTERS. The last-owner trigger refuses to let the sole owner's
 * membership disappear while their organization still exists, so deleting the
 * auth user first fails: the cascade to `organization_members` is rejected and
 * the whole delete rolls back. Fixtures must therefore be torn down
 * organization-first: fleet rows, then the organization (which cascades
 * memberships and invitations), then the users.
 */

/**
 * The user's PERSONAL organization — the one the signup trigger created.
 *
 * Since the multi-workspace change a user may hold several memberships, so
 * `.maybeSingle()` here would throw. The personal workspace is now identified by
 * `organizations.kind`, not by "the only one they have".
 */
export async function orgOf(admin, userId) {
  // Two plain queries rather than a PostgREST embed. `organization_members` has
  // several relationships that reach `organizations` (its own FK, plus the
  // composite keys driver_assignments uses), and an ambiguous embed resolves to
  // an empty result rather than an error — a silent wrong answer in a fixture
  // helper that half the suites depend on.
  const { data: rows } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const ids = (rows ?? []).map((r) => r.organization_id);
  if (ids.length === 0) return null;

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, kind")
    .in("id", ids);
  const personal = (orgs ?? []).find((o) => o.kind === "personal");
  // Fall back to the oldest membership, mirroring current_org_id().
  return personal?.id ?? ids[0];
}

/** Every PERSONAL organization this user belongs to (expected: exactly one). */
export async function personalOrgsOf(admin, userId) {
  const { data: rows } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId);
  const ids = (rows ?? []).map((r) => r.organization_id);
  if (ids.length === 0) return [];
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, kind")
    .in("id", ids);
  return (orgs ?? []).filter((o) => o.kind === "personal").map((o) => o.id);
}

/**
 * Whether this database can hold more than one membership per user — i.e.
 * whether M4 has been applied.
 *
 * R1 ships M1-M3 and keeps `UNIQUE(user_id)`, so suites that assert on
 * membership cardinality have to assert what the release under test actually
 * promises rather than what the finished feature will. Probing the constraint
 * directly (rather than the schema catalog, which PostgREST does not expose)
 * keeps this honest: it tests the thing that matters.
 */
let multiMembership = null;

export async function hasMultiMembership(admin) {
  if (multiMembership !== null) return multiMembership;
  const { error } = await admin.rpc("set_active_organization", {
    p_organization: null,
  });
  // Present only from M6, which ships in the same release as M4.
  multiMembership = !(error?.code === "PGRST202" || error?.code === "42883");
  return multiMembership;
}

/** Every organization this user belongs to, oldest first. */
export async function orgsOf(admin, userId) {
  const { data } = await admin
    .from("organization_members")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  return data ?? [];
}

/**
 * The user's role in one organization. `organizationId` is required now that a
 * user can hold a different role in each — there is no such thing as "the"
 * user's role any more.
 */
export async function roleOf(admin, userId, organizationId) {
  // No organization named -> the ACTIVE workspace, which is the one the user is
  // acting in and the one accept_invitation() leaves them in. Falling back to
  // "oldest membership" would answer about the personal workspace instead, and
  // report `owner` for someone who was just invited as a viewer.
  let orgId = organizationId;
  if (!orgId) {
    const { data } = await admin
      .from("profiles")
      .select("active_organization_id")
      .eq("id", userId)
      .maybeSingle();
    orgId = data?.active_organization_id;
  }
  if (!orgId) {
    // No pointer. Before M4/M5 nothing ever writes one, and `UNIQUE(user_id)`
    // means the user holds at most one membership — so the sole membership is
    // not a guess, it is the complete answer. With several memberships and no
    // pointer there genuinely is no "the" role, and null is the honest result.
    const memberships = await orgsOf(admin, userId);
    if (memberships.length !== 1) return null;
    return memberships[0].role;
  }

  const { data } = await admin
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data?.role ?? null;
}

/** Point the user's active workspace at an organization (fixtures only). */
export async function setActiveOrg(admin, userId, organizationId) {
  const { error } = await admin
    .from("profiles")
    .update({ active_organization_id: organizationId })
    .eq("id", userId);
  if (error) throw new Error(`setActiveOrg: ${error.message}`);
}

/**
 * Upsert a membership against whichever unique constraint the database has.
 *
 * The R1 release ships M1-M3 and keeps `UNIQUE(user_id)`; M4 replaces it with
 * `UNIQUE(organization_id, user_id)`. The fixtures have to run on both, so the
 * conflict target is discovered rather than assumed — otherwise every suite
 * dies in the harness before asserting anything, which is exactly what happened
 * the first time R1 was tried.
 *
 * Discovery is one failed attempt, memoised for the process. 42P10 is
 * "no unique or exclusion constraint matching the ON CONFLICT specification";
 * any other error is a real failure and is returned to the caller.
 */
let membershipConflictTarget = null;

async function upsertMembership(admin, row) {
  const attempt = (target) =>
    admin.from("organization_members").upsert(row, { onConflict: target });

  if (membershipConflictTarget) {
    const { error } = await attempt(membershipConflictTarget);
    return error;
  }

  const { error } = await attempt("organization_id,user_id");
  if (!error) {
    membershipConflictTarget = "organization_id,user_id";
    return null;
  }
  if (error.code !== "42P10") return error;

  const { error: legacyError } = await attempt("user_id");
  if (!legacyError) membershipConflictTarget = "user_id";
  return legacyError;
}

/**
 * ADD a membership without disturbing any the user already holds.
 *
 * This is what `accept_invitation()` does from M5 onward. It requires M4: under
 * `UNIQUE(user_id)` a second membership is rejected, which is the constraint
 * R1 deliberately keeps.
 */
export async function addMembership(admin, userId, organizationId, role) {
  const error = await upsertMembership(admin, {
    organization_id: organizationId,
    user_id: userId,
    role,
  });
  if (error) throw new Error(`addMembership(${role}): ${error.message}`);
  await setActiveOrg(admin, userId, organizationId);
}

/**
 * Move a user into an existing organization with a given role.
 *
 * Mirrors what `accept_invitation()` does: the user's own auto-created
 * organization is removed (which cascades their membership away — the only path
 * the last-owner trigger permits), then the new membership is created and the
 * profile cache is synced. Under the one-organization-per-user constraint this
 * is the ONLY legitimate way to change someone's organization.
 */
export async function joinOrg(admin, userId, organizationId, role) {
  const previous = await orgOf(admin, userId);
  if (previous && previous !== organizationId) {
    const { count } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", previous)
      .neq("user_id", userId);

    if ((count ?? 0) === 0) {
      // The user's own auto-created organization: it goes away with them, which
      // is the only way the last-owner trigger lets their membership cascade.
      const { error } = await admin
        .from("organizations")
        .delete()
        .eq("id", previous);
      if (error) {
        throw new Error(
          `joinOrg: could not release ${userId}'s personal organization: ${error.message}`,
        );
      }
    } else {
      // A shared organization survives; just drop this one membership. The
      // trigger still refuses if the user is that organization's last owner.
      const { error } = await admin
        .from("organization_members")
        .delete()
        .eq("user_id", userId);
      if (error) {
        throw new Error(
          `joinOrg: could not remove ${userId} from the shared organization: ${error.message}`,
        );
      }
    }
  }

  const error = await upsertMembership(admin, {
    organization_id: organizationId,
    user_id: userId,
    role,
  });
  if (error) throw new Error(`joinOrg(${role}): ${error.message}`);

  // Keep the (non-authoritative) profile cache consistent with reality, and
  // point the active workspace at the organization the fixture just joined —
  // otherwise current_org_id() would fall back to the personal workspace and
  // the persona would be acting somewhere the test did not intend.
  await admin
    .from("profiles")
    .update({
      organization_id: organizationId,
      role: role === "driver" ? "viewer" : role,
      active_organization_id: organizationId,
    })
    .eq("id", userId);
}

/** Set a member's role in place, without touching their organization. */
export async function setRole(admin, userId, role, organizationId) {
  // With several memberships, "the user's role" is not a thing — a role belongs
  // to one membership. When no organization is named, change the role in the
  // user's ACTIVE workspace, which is the one the persona is acting in.
  let orgId = organizationId;
  if (!orgId) {
    const { data } = await admin
      .from("profiles")
      .select("active_organization_id")
      .eq("id", userId)
      .maybeSingle();
    orgId = data?.active_organization_id ?? (await orgOf(admin, userId));
  }

  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) throw new Error(`setRole(${role}): ${error.message}`);
  // profiles.role predates the driver role and its CHECK does not allow it.
  await admin
    .from("profiles")
    .update({ role: role === "driver" ? "viewer" : role })
    .eq("id", userId);
}

/**
 * Deliberately desynchronize the profile cache from the membership, to prove
 * that the cache grants nothing. Only ever used by the harnesses.
 */
export async function setProfileCache(admin, userId, { organizationId, role }) {
  const patch = {};
  if (organizationId !== undefined) patch.organization_id = organizationId;
  if (role !== undefined) patch.role = role;
  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) throw new Error(`setProfileCache: ${error.message}`);
}

/**
 * Tear down every organization these users belong to, then the users.
 *
 * Organization-scoped tables keep RESTRICT foreign keys to `organizations`
 * (deliberately — a live organization holding fleet data must not vanish by
 * accident), so the fleet rows are cleared first. Everything is best-effort:
 * teardown must never mask a real test failure.
 */
export async function cleanupUsers(admin, users) {
  const ids = users.map((u) => u.id).filter(Boolean);
  if (ids.length === 0) return;

  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id")
    .in("user_id", ids);
  const orgIds = [
    ...new Set((memberships ?? []).map((m) => m.organization_id)),
  ];

  for (const orgId of orgIds) {
    // Vehicles cascade to their documents, issues, maintenance, reminders,
    // passports and transfer tokens; clearing them frees the org's RESTRICT FKs.
    await admin.from("vehicles").delete().eq("organization_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  }

  for (const id of ids) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}
