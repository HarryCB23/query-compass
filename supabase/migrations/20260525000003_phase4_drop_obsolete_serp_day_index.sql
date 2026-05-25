-- Drop Phase 2 stub unique index UNIQUE(query_id, captured_date).
-- Superseded by UNIQUE(query_id, location_code) added in phase4_serp_schema.
-- The old index would block multi-location enrichment: same query, same day,
-- different location_code would fail on captured_date before reaching the
-- (query_id, location_code) constraint. captured_date column is retained for
-- historical/audit purposes; only the uniqueness constraint is removed.
DROP INDEX IF EXISTS public.serp_snapshots_query_day_idx;
