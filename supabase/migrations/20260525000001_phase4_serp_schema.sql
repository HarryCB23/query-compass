-- Phase 4 — serp_snapshots overhaul + projects additions
--
-- DEPLOY CHECKLIST: Before serp-webhook is callable in any environment,
-- set the shared secret used for postback authentication:
--   npx supabase secrets set DATAFORSEO_WEBHOOK_SECRET=$(openssl rand -hex 32)
-- The serp-webhook function returns 403 on any request where this secret
-- is absent or does not match. Generate once per environment (local / prod).
--
-- Pre-flight check result (2026-05-25): serp_snapshots had no existing
-- UNIQUE constraint on query_id — only PK + FK. No DROP required.

BEGIN;

-- ── projects ────────────────────────────────────────────────────────────────
-- Rename existing location_code → default_location_code (same int type,
-- same DEFAULT 2826). projects.domain already exists NOT NULL — no action.

ALTER TABLE projects
  RENAME COLUMN location_code TO default_location_code;

ALTER TABLE projects
  ADD COLUMN alt_domains        text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN daily_serp_budget  numeric(10,2) NOT NULL DEFAULT 50.00;

-- ── serp_snapshots overhaul ─────────────────────────────────────────────────
-- Stub table has no real data. Drop placeholder column; build full schema.

ALTER TABLE serp_snapshots DROP COLUMN features;

ALTER TABLE serp_snapshots

  -- Snapshot metadata / lifecycle
  ADD COLUMN expires_at               timestamptz   NOT NULL
                                        DEFAULT (now() + interval '72 hours'),
  ADD COLUMN location_code            int           NOT NULL DEFAULT 2826,
  ADD COLUMN serp_response_version    text          NOT NULL DEFAULT 'v1',

  -- Layer 1: feature presence booleans
  -- rule a: SERP busyness + dashboard aggregation  rule b: Phase 5 risk inputs
  ADD COLUMN has_ai_overview          boolean       NOT NULL DEFAULT false,
  ADD COLUMN has_top_stories          boolean       NOT NULL DEFAULT false,
  ADD COLUMN has_featured_snippet     boolean       NOT NULL DEFAULT false,
  ADD COLUMN has_video                boolean       NOT NULL DEFAULT false,
  ADD COLUMN has_local_pack           boolean       NOT NULL DEFAULT false,
  ADD COLUMN has_shopping             boolean       NOT NULL DEFAULT false,

  -- Layer 2: publisher presence
  -- rule a: AI Surfaces visibility panels; descriptive, not Phase 5 risk inputs
  ADD COLUMN publisher_in_ai_overview           boolean   NOT NULL DEFAULT false,
  ADD COLUMN publisher_in_top_stories           boolean   NOT NULL DEFAULT false,
  ADD COLUMN publisher_in_featured_snippet      boolean   NOT NULL DEFAULT false,
  ADD COLUMN publisher_organic_position         int       NULL,
  ADD COLUMN publisher_in_organic_top_3         boolean   NOT NULL DEFAULT false,

  -- Layer 3: competitive landscape
  -- rule a: competing domains panel  rule b: aio_citation_count as AIO depth risk input
  ADD COLUMN aio_citation_count       int           NOT NULL DEFAULT 0,
  ADD COLUMN aio_word_count           int           NULL,
  ADD COLUMN top_organic_domains      text[]        NOT NULL DEFAULT '{}',
  ADD COLUMN top_stories_domains      text[]        NOT NULL DEFAULT '{}',

  -- Pixel geometry
  -- rule b: pixels_above_first_organic = refined displacement risk input (Phase 5)
  -- publisher_pixel_height = visibility only, never risk-weighted
  ADD COLUMN pixels_above_first_organic   int   NULL,
  ADD COLUMN publisher_pixel_height       int   NULL,

  -- Full raw DataforSEO Advanced response
  -- Backfill source only. Never read per-row in UI or risk scoring.
  ADD COLUMN raw_serp_data            jsonb   NULL;

-- One snapshot per (query, location) — independent TTL per market
ALTER TABLE serp_snapshots
  ADD CONSTRAINT serp_snapshots_query_location_key UNIQUE (query_id, location_code);

-- Partial indexes for dashboard aggregation (rule a columns)
CREATE INDEX idx_serp_ss_has_ai_overview
  ON serp_snapshots (query_id) WHERE has_ai_overview = true;
CREATE INDEX idx_serp_ss_has_top_stories
  ON serp_snapshots (query_id) WHERE has_top_stories = true;
CREATE INDEX idx_serp_ss_has_featured_snippet
  ON serp_snapshots (query_id) WHERE has_featured_snippet = true;

-- Cache-hit check: enrich-serp filters by query_id + location_code + TTL
CREATE INDEX idx_serp_ss_cache_hit
  ON serp_snapshots (query_id, location_code, expires_at);

COMMIT;
