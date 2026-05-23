-- =============================================================================
-- Phase 1 — Auth tables: orgs, memberships, auto-org trigger
--
-- RLS note: the policies below are intentionally READ-ONLY for authenticated
-- users. All writes to these tables happen through the handle_new_user()
-- SECURITY DEFINER trigger (which runs as the table owner, bypassing RLS).
-- This keeps the surface area for privilege escalation small: application
-- code can never insert or mutate org/membership rows directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- orgs
-- ---------------------------------------------------------------------------
create table public.orgs (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  created_at timestamptz not null default now()
);

alter table public.orgs enable row level security;

-- Users may SELECT the orgs they belong to; no INSERT/UPDATE/DELETE policy
-- (writes are handled exclusively by the SECURITY DEFINER trigger below).
create policy "members can view their org"
  on public.orgs
  for select
  using (
    exists (
      select 1
      from   public.memberships m
      where  m.org_id  = orgs.id
        and  m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id  uuid not null references public.orgs  (id) on delete cascade,
  -- 'owner'  — created automatically on signup; full project access
  -- 'member' — invited later (Phase 2+)
  role    text not null default 'owner'
             check (role in ('owner', 'member')),
  primary key (user_id, org_id)
);

alter table public.memberships enable row level security;

-- Users may SELECT their own membership rows only; no INSERT/UPDATE/DELETE
-- policy (writes are handled exclusively by the SECURITY DEFINER trigger).
create policy "users see own memberships"
  on public.memberships
  for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Auto-create org + owner membership on every new Supabase Auth signup.
--
-- Uses SECURITY DEFINER so the function executes as the table owner and can
-- write to orgs/memberships without requiring the calling role to have INSERT
-- privileges. search_path is pinned to public to prevent search-path injection.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  -- Derive the org name from the domain part of the email (e.g. "acme.com").
  -- This is a sensible default for a consultancy tool where users typically
  -- sign up with their company email.
  insert into public.orgs (name)
  values (split_part(new.email, '@', 2))
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (new.id, new_org_id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();
