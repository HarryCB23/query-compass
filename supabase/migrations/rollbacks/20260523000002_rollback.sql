-- =============================================================================
-- Rollback for 20260523000002_phase2_schema.sql
-- Drop tables in reverse dependency order; cascade handles child constraints.
-- =============================================================================

BEGIN;

drop function if exists public.get_my_org_ids() cascade;

drop table if exists public.jobs             cascade;
drop table if exists public.keyword_metrics  cascade;
drop table if exists public.risk_scores      cascade;
drop table if exists public.risk_weights     cascade;
drop table if exists public.serp_snapshots   cascade;
drop table if exists public.classifications  cascade;
drop table if exists public.import_queries   cascade;
drop table if exists public.queries          cascade;
drop table if exists public.imports          cascade;
drop table if exists public.projects         cascade;

COMMIT;
