-- =============================================================================
-- Vin.ID Fleet Lite — least-privilege grants for the membership functions
-- =============================================================================
-- PostgreSQL grants EXECUTE to PUBLIC on every newly created function, so the
-- explicit `grant ... to authenticated` in the previous migrations did not
-- actually narrow anything: `anon` could still call accept_invitation() and
-- org_owner_count() through the implicit PUBLIC grant. Neither is exploitable
-- (accept_invitation returns 'not_authenticated' when auth.uid() is null), but
-- org_owner_count() did let an unauthenticated caller probe the owner count of
-- any organization id, and least privilege should not depend on the function
-- body being careful.
--
-- Revoke PUBLIC, then re-grant only the roles that need each function:
--
--   get_invitation_preview  anon + authenticated — the invitation landing page
--                           renders before sign-in.
--   accept_invitation       authenticated only.
--   org_owner_count         authenticated only; it is called by the last-owner
--                           trigger, which runs SECURITY DEFINER and therefore
--                           needs no grant to the calling role at all.
--
-- The RLS resolution helpers (current_org_id / current_org_role / is_org_writer
-- / is_org_admin) deliberately keep their anon grant: they are invoked from
-- inside RLS policies on tables that anon may touch, they take no arguments, and
-- they return NULL/false for an unauthenticated caller.
--
-- Note that `anon` must be revoked BY NAME, not just via PUBLIC. Supabase ships
-- `alter default privileges in schema public grant all on functions to anon,
-- authenticated, service_role`, so every function created here starts with an
-- explicit anon grant on top of the implicit PUBLIC one. Revoking only PUBLIC
-- leaves anon holding EXECUTE — verified at runtime.
-- =============================================================================

revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

revoke all on function public.org_owner_count(uuid) from public, anon;
grant execute on function public.org_owner_count(uuid) to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================
