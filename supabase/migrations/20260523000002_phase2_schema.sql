-- =============================================================================
-- Phase 2 — Core schema: projects, imports, queries, classifications,
--            serp_snapshots, risk_weights, risk_scores, keyword_metrics, jobs
--
-- All RLS policies use the get_my_org_ids() helper so that the membership
-- check lives in one place and can be updated without touching every policy.
--
-- CTR is stored as a decimal fraction (0.025 = 2.5 %).  Multiply by 100
-- in the UI layer; never store a percentage integer in this table.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: get_my_org_ids()
-- Returns every org_id the calling user belongs to.  Used in every RLS
-- policy that restricts access to org-owned rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_org_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select org_id
  from   public.memberships
  where  user_id = auth.uid();
$$;

grant execute on function public.get_my_org_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id             uuid        primary key default gen_random_uuid(),
  org_id         uuid        not null references public.orgs (id) on delete cascade,
  client_name    text        not null,
  domain         text        not null,
  branded_terms  text[]      not null default '{}',
  -- DataforSEO defaults; override in Project Settings
  location_code  int         not null default 2826,   -- 2826 = United Kingdom
  device         text        not null default 'mobile'
                               check (device in ('desktop', 'mobile')),
  created_at     timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "org members can select their projects"
  on public.projects
  for select
  using (org_id in (select get_my_org_ids()));

create policy "org members can insert projects"
  on public.projects
  for insert
  with check (org_id in (select get_my_org_ids()));

create policy "org members can update their projects"
  on public.projects
  for update
  using (org_id in (select get_my_org_ids()))
  with check (org_id in (select get_my_org_ids()));

-- v1 caveat: all org members are owners, so any member can delete any project.
-- Phase 5 (role-based access) will narrow this to role = 'owner' only.
create policy "org members can delete their projects"
  on public.projects
  for delete
  using (org_id in (select get_my_org_ids()));

grant select, insert, update, delete on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- imports
-- Row per CSV/GSC upload.  period_start/period_end are NULL for CSV uploads
-- because the user may not know the exact date range; GSC imports populate them.
-- ---------------------------------------------------------------------------
create table public.imports (
  id             uuid        primary key default gen_random_uuid(),
  project_id     uuid        not null references public.projects (id) on delete cascade,
  file_name      text,
  source         text        not null default 'csv'
                               check (source in ('csv', 'gsc')),
  period_start   date,
  period_end     date,
  row_count      int,
  created_at     timestamptz not null default now()
);

alter table public.imports enable row level security;

create policy "org members can select imports for their projects"
  on public.imports
  for select
  using (
    project_id in (
      select id from public.projects
      where  org_id in (select get_my_org_ids())
    )
  );

create policy "org members can insert imports for their projects"
  on public.imports
  for insert
  with check (
    project_id in (
      select id from public.projects
      where  org_id in (select get_my_org_ids())
    )
  );

grant select, insert on public.imports to authenticated;

-- ---------------------------------------------------------------------------
-- queries
-- Global deduplicated query bank.  Not org-scoped: the same query text can
-- appear in many projects, and storing it once avoids repeating Phase 3
-- AI-classification work.  Authenticated users may read all rows; writes are
-- via service role only (ingest-csv edge function).
-- query_hash = encode(sha256(lower(trim(query_text))::bytea), 'hex')
-- ---------------------------------------------------------------------------
create table public.queries (
  id          uuid    primary key default gen_random_uuid(),
  query_text  text    not null,
  query_hash  text    not null unique,
  created_at  timestamptz not null default now()
);

alter table public.queries enable row level security;

create policy "authenticated users can read queries"
  on public.queries
  for select
  using (auth.role() = 'authenticated');

grant select on public.queries to authenticated;
-- INSERT/UPDATE are intentionally not granted to the authenticated role;
-- the ingest-csv edge function uses the service role key.

-- ---------------------------------------------------------------------------
-- import_queries
-- Join table linking an import to the queries it contained, with per-row
-- metrics for the current and previous periods.
--
-- CTR stored as fraction: 0.0250 = 2.5 %.  Use numeric(6,4) so values like
-- 0.9999 (99.99 %) are representable without overflow.
-- Position is nullable: a row can lack a previous-period comparison.
-- ---------------------------------------------------------------------------
create table public.import_queries (
  id                    uuid           primary key default gen_random_uuid(),
  import_id             uuid           not null references public.imports  (id) on delete cascade,
  query_id              uuid           not null references public.queries   (id),
  clicks_current        int,
  impressions_current   int,
  ctr_current           numeric(6,4),  -- fraction, e.g. 0.0250 = 2.5 %
  position_current      numeric(6,2),
  clicks_previous       int,
  impressions_previous  int,
  ctr_previous          numeric(6,4),  -- fraction
  position_previous     numeric(6,2),
  unique (import_id, query_id)
);

alter table public.import_queries enable row level security;

create policy "org members can select import_queries for their projects"
  on public.import_queries
  for select
  using (
    import_id in (
      select i.id from public.imports i
      join   public.projects p on p.id = i.project_id
      where  p.org_id in (select get_my_org_ids())
    )
  );

create policy "org members can insert import_queries for their projects"
  on public.import_queries
  for insert
  with check (
    import_id in (
      select i.id from public.imports i
      join   public.projects p on p.id = i.project_id
      where  p.org_id in (select get_my_org_ids())
    )
  );

grant select, insert on public.import_queries to authenticated;

-- ---------------------------------------------------------------------------
-- classifications
-- AI-generated intent label per query (global, reused across projects).
-- ---------------------------------------------------------------------------
create table public.classifications (
  id            uuid        primary key default gen_random_uuid(),
  query_id      uuid        not null unique references public.queries (id) on delete cascade,
  intent        text        not null
                              check (intent in ('informational','navigational','commercial','transactional')),
  confidence    numeric(4,3),
  model_version text,
  classified_at timestamptz not null default now()
);

alter table public.classifications enable row level security;

create policy "authenticated users can read classifications"
  on public.classifications
  for select
  using (auth.role() = 'authenticated');

grant select on public.classifications to authenticated;

-- ---------------------------------------------------------------------------
-- serp_snapshots
-- One snapshot row per (query × date).  The functional unique index prevents
-- duplicate captures for the same day without storing a redundant date column.
-- ---------------------------------------------------------------------------
create table public.serp_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  query_id      uuid        not null references public.queries (id) on delete cascade,
  captured_at   timestamptz not null default now(),
  -- Separate date column so the unique index below doesn't need a functional
  -- expression (timestamptz::date is STABLE, not IMMUTABLE, so it can't appear
  -- in a standard unique index).  Callers set this to the calendar date in UTC.
  captured_date date        not null default current_date,
  features      jsonb       not null default '{}'
);

alter table public.serp_snapshots enable row level security;

-- One snapshot per query per calendar day
create unique index serp_snapshots_query_day_idx
  on public.serp_snapshots (query_id, captured_date);

create policy "authenticated users can read serp_snapshots"
  on public.serp_snapshots
  for select
  using (auth.role() = 'authenticated');

grant select on public.serp_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- risk_weights
-- Versioned weighting configuration.  Only one row may be active at a time;
-- the partial unique index enforces this at the DB level.
-- ---------------------------------------------------------------------------
create table public.risk_weights (
  id                  uuid        primary key default gen_random_uuid(),
  label               text        not null,
  weights             jsonb       not null,
  active              boolean     not null default false,
  created_at          timestamptz not null default now()
);

alter table public.risk_weights enable row level security;

-- At most one active risk_weights row at any time
create unique index risk_weights_only_one_active_idx
  on public.risk_weights (active)
  where active = true;

create policy "authenticated users can read risk_weights"
  on public.risk_weights
  for select
  using (auth.role() = 'authenticated');

grant select on public.risk_weights to authenticated;

-- ---------------------------------------------------------------------------
-- risk_scores
-- Computed per-import aggregate risk assessment.
-- ---------------------------------------------------------------------------
create table public.risk_scores (
  id                  uuid        primary key default gen_random_uuid(),
  import_id           uuid        not null unique references public.imports (id) on delete cascade,
  traffic_risk_score  numeric(5,2) not null
                        check (traffic_risk_score between 0 and 100),
  breakdown           jsonb       not null default '{}',
  weights_id          uuid        references public.risk_weights (id),
  scored_at           timestamptz not null default now()
);

alter table public.risk_scores enable row level security;

create policy "org members can select risk_scores for their projects"
  on public.risk_scores
  for select
  using (
    import_id in (
      select i.id from public.imports i
      join   public.projects p on p.id = i.project_id
      where  p.org_id in (select get_my_org_ids())
    )
  );

grant select on public.risk_scores to authenticated;

-- ---------------------------------------------------------------------------
-- keyword_metrics
-- DataforSEO search-volume and CPC data per (query × location × device × month).
-- ---------------------------------------------------------------------------
create table public.keyword_metrics (
  id             uuid        primary key default gen_random_uuid(),
  query_id       uuid        not null references public.queries (id) on delete cascade,
  location_code  int         not null,
  device         text        not null check (device in ('desktop', 'mobile')),
  month          date        not null,   -- stored as first day of month
  search_volume  int,
  cpc            numeric(10,4),
  competition    numeric(4,3),
  fetched_at     timestamptz not null default now(),
  unique (query_id, location_code, device, month)
);

alter table public.keyword_metrics enable row level security;

create policy "authenticated users can read keyword_metrics"
  on public.keyword_metrics
  for select
  using (auth.role() = 'authenticated');

grant select on public.keyword_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- jobs
-- Async work items (classify-batch, serp-fetch, etc.).
-- ---------------------------------------------------------------------------
create table public.jobs (
  id           uuid        primary key default gen_random_uuid(),
  import_id    uuid        references public.imports (id) on delete cascade,
  job_type     text        not null,
  status       text        not null default 'pending'
                             check (status in ('pending','running','done','error')),
  payload      jsonb       not null default '{}',
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.jobs enable row level security;

create policy "org members can select jobs for their projects"
  on public.jobs
  for select
  using (
    import_id in (
      select i.id from public.imports i
      join   public.projects p on p.id = i.project_id
      where  p.org_id in (select get_my_org_ids())
    )
  );

create policy "org members can insert jobs for their projects"
  on public.jobs
  for insert
  with check (
    import_id in (
      select i.id from public.imports i
      join   public.projects p on p.id = i.project_id
      where  p.org_id in (select get_my_org_ids())
    )
  );

grant select, insert on public.jobs to authenticated;

COMMIT;
