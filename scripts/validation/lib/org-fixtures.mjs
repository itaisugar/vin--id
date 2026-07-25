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

/** The organization auto-created for a user by the signup trigger. */
export async function orgOf(admin, userId) {
  const { data } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/** The user's effective role, straight from the membership row. */
export async function roleOf(admin, userId) {
  const { data } = await admin
    .from("organization_members")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role ?? null;
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

  const { error } = await admin
    .from("organization_members")
    .upsert(
      { organization_id: organizationId, user_id: userId, role },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`joinOrg(${role}): ${error.message}`);

  // Keep the (non-authoritative) profile cache consistent with reality.
  await admin
    .from("profiles")
    .update({ organization_id: organizationId, role })
    .eq("id", userId);
}

/** Set a member's role in place, without touching their organization. */
export async function setRole(admin, userId, role) {
  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("user_id", userId);
  if (error) throw new Error(`setRole(${role}): ${error.message}`);
  await admin.from("profiles").update({ role }).eq("id", userId);
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
