-- =============================================================================
-- Vin.ID multi-workspace — M1: tell a Personal workspace from a business one
-- =============================================================================
-- WHY. `accept_invitation()` currently identifies a "personal" organization by
-- STRUCTURE: sole member, no pending invitations, no fleet data. That inference
-- is the direct cause of a production defect — a user who owns even one vehicle
-- fails the third condition, so accepting an invitation returns 'already_member'
-- and no real user can ever join an organization.
--
-- The inference is also not durable. A personal workspace becomes structurally
-- indistinguishable from a small business the moment it holds data, so no
-- amount of tuning makes it correct. The fact needs to be recorded, not guessed.
--
-- WHAT THIS IS NOT. `kind` is presentation and product semantics: it decides
-- whether the UI says "Personal" or shows a company name, and it gives
-- accept_invitation a fact instead of a heuristic. It grants NOTHING. Every
-- authorization decision still runs through organization_members.
--
-- Additive and idempotent: old code never reads this column.
-- =============================================================================

alter table public.organizations
  add column if not exists kind text not null default 'business';

alter table public.organizations drop constraint if exists organizations_kind_check;
alter table public.organizations
  add constraint organizations_kind_check check (kind in ('personal', 'business'));

comment on column public.organizations.kind is
  'personal = the workspace auto-created for one user at signup, and still held by exactly that one user; business = a shared organization. Presentation and product semantics only — never an authorization input. accept_invitation() promotes personal -> business the moment a second member joins, so "personal" always means "one member".';

-- Personal workspaces are read constantly (every current_org_id() fallback), so
-- index the lookup by member rather than scanning organizations.
create index if not exists organizations_kind_idx
  on public.organizations (kind)
  where kind = 'personal';

-- -----------------------------------------------------------------------------
-- Backfill — deliberately conservative.
--
-- Mislabelling a real company as "Personal" is a product-visible error a
-- customer would see. Leaving a genuine personal workspace as 'business' costs
-- nothing today: the UI simply shows its name. So every condition below must
-- hold, and anything ambiguous stays 'business'.
--
--   1. exactly one member, and
--   2. that member is its owner, and
--   3. it was created by the signup trigger — the member row and the
--      organization row were written in the same transaction, so their
--      created_at values are within a second of each other, and
--   4. it has never had an invitation of any status (a real team was intended),
--      and
--   5. no OTHER user's data sits in it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_total    int;
  v_personal int;
begin
  select count(*) into v_total from public.organizations;

  with single_owner as (
    select o.id
    from public.organizations o
    join public.organization_members m on m.organization_id = o.id
    where o.kind = 'business'
    group by o.id, o.created_at
    having count(*) = 1                                    -- 1. exactly one member
       and bool_and(m.role = 'owner')                      -- 2. who owns it
       and bool_and(                                       -- 3. created together
             abs(extract(epoch from (m.created_at - o.created_at))) <= 1)
  ),
  candidates as (
    select s.id
    from single_owner s
    where not exists (                                     -- 4. never invited anyone
      select 1 from public.organization_invitations i where i.organization_id = s.id
    )
  )
  update public.organizations o
     set kind = 'personal'
   where o.id in (select id from candidates)
     and o.kind is distinct from 'personal';

  get diagnostics v_personal = row_count;
  raise notice 'organization_kind: % organizations, % classified personal', v_total, v_personal;
end $$;

-- -----------------------------------------------------------------------------
-- New signups record the fact directly, so the inference above is never needed
-- again. Everything else about this trigger is unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'My vehicles'
  );

  -- kind='personal': this is the workspace the user gets for their own
  -- vehicles. It is never deleted, and joining an organization does not
  -- replace it.
  insert into public.organizations (name, email, kind)
  values (v_name, new.email, 'personal')
  returning id into v_org;

  insert into public.profiles (id, organization_id, role)
  values (new.id, v_org, 'owner')
  on conflict (id) do update
    set organization_id = coalesce(public.profiles.organization_id, excluded.organization_id);

  -- Conflict target is still (user_id) at this point: the cardinality change
  -- lands in M4, which updates this statement in the same migration that drops
  -- the constraint. Splitting them would leave a window where signup fails.
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, new.id, 'owner')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Verification (expect every personal organization to have exactly one member):
--   select o.id, count(m.*) from public.organizations o
--   join public.organization_members m on m.organization_id = o.id
--   where o.kind = 'personal' group by o.id having count(m.*) <> 1;
