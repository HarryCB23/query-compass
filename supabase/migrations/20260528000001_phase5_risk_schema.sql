-- Phase 5 — Traffic Risk scoring schema
--
-- Three changes:
--   1. serp_snapshots: add missing SERP feature columns needed by the risk model
--      (has_paa, has_knowledge_graph, publisher_in_paa, publisher_in_knowledge_graph,
--       publisher_in_video).
--   2. risk_scores: drop the Phase 2 import-level stub and replace with a per-query
--      table matching the §6 spec (Appendix A: query_id uuid FK, not query_hash).
--   3. risk_weights: seed v1 weights from the §6 weight definitions.
--
-- Safe to run with 0 rows in risk_scores (Phase 2 stub was never written to).
-- serp_snapshots columns are additive (no existing data affected).

BEGIN;

-- ── 1. serp_snapshots: missing SERP feature columns ─────────────────────────
--
-- These five columns are all risk-model inputs (condition b in the §5 promotion
-- rule) or dashboard aggregation targets (condition a). They were omitted from
-- the Phase 4 migration because the DataforSEO webhook parser was scoped to
-- the features present in the first live dataset (news/informational heavy,
-- low PAA/KG volume). They are required for Phase 5 risk scoring and are
-- additive — existing rows default to false, which is correct (absence evidence).

ALTER TABLE serp_snapshots
  ADD COLUMN has_paa                    boolean   NOT NULL DEFAULT false,
  ADD COLUMN has_knowledge_graph        boolean   NOT NULL DEFAULT false,
  ADD COLUMN publisher_in_paa           boolean   NOT NULL DEFAULT false,
  ADD COLUMN publisher_in_knowledge_graph boolean NOT NULL DEFAULT false,
  ADD COLUMN publisher_in_video         boolean   NOT NULL DEFAULT false;

-- Partial indexes for dashboard aggregation (rule a) and risk filtering (rule b)
CREATE INDEX idx_serp_ss_has_paa
  ON serp_snapshots (query_id) WHERE has_paa = true;
CREATE INDEX idx_serp_ss_has_knowledge_graph
  ON serp_snapshots (query_id) WHERE has_knowledge_graph = true;

-- ── 2. risk_scores: replace import-level stub with per-query table ───────────
--
-- The Phase 2 migration created risk_scores with UNIQUE(import_id) — one row
-- per import. Phase 5 requires one row per (import, query, weights version) so
-- that:
--   a) per-query risk scores are stored alongside their components breakdown
--   b) re-scoring with new weights creates new rows without touching old ones
--   c) materialised aggregations can GROUP BY import_id, category, entity
--
-- risk_scores has 0 rows so DROP + recreate is the cleanest path.

DROP TABLE IF EXISTS public.risk_scores;

CREATE TABLE public.risk_scores (
  id                        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id                 uuid          NOT NULL
                              REFERENCES public.imports (id) ON DELETE CASCADE,
  query_id                  uuid          NOT NULL
                              REFERENCES public.queries (id) ON DELETE CASCADE,
  weights_id                uuid          REFERENCES public.risk_weights (id),

  -- Composite score
  traffic_risk_score        numeric(5,2)  NOT NULL
                              CHECK (traffic_risk_score BETWEEN 0 AND 100),

  -- Full component breakdown — used for re-scoring without re-querying SERP/classification
  components                jsonb         NOT NULL DEFAULT '{}',

  -- Derived flags — for UI badges and fast filtering
  zero_click_risk           boolean       NOT NULL DEFAULT false,
  publisher_in_aio          boolean       NOT NULL DEFAULT false,
  publisher_in_top_stories  boolean       NOT NULL DEFAULT false,
  publisher_owns_fs         boolean       NOT NULL DEFAULT false,
  ai_surface_flag           boolean       NOT NULL DEFAULT false,

  computed_at               timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (import_id, query_id, weights_id)
);

ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read risk_scores for their imports"
  ON public.risk_scores
  FOR SELECT
  USING (
    import_id IN (
      SELECT i.id FROM public.imports i
      JOIN   public.projects p ON p.id = i.project_id
      WHERE  p.org_id IN (SELECT get_my_org_ids())
    )
  );

-- Edge function writes risk scores via service-role key — no INSERT policy needed
-- for the authenticated role.
GRANT SELECT ON public.risk_scores TO authenticated;

-- Indexes for the aggregation queries in §6
CREATE INDEX idx_risk_scores_import_id
  ON public.risk_scores (import_id);

CREATE INDEX idx_risk_scores_import_score_desc
  ON public.risk_scores (import_id, traffic_risk_score DESC);

CREATE INDEX idx_risk_scores_zero_click
  ON public.risk_scores (import_id) WHERE zero_click_risk = true;

CREATE INDEX idx_risk_scores_has_aio
  ON public.risk_scores (import_id) WHERE publisher_in_aio = true;

-- ── 3. risk_weights: seed v1 weights ────────────────────────────────────────
--
-- Weights from REFACTOR_BRIEF.md §6. Stored as JSONB so re-scoring with new
-- weights never requires a schema change — add a new row and mark it active.

INSERT INTO public.risk_weights (label, weights, active) VALUES (
  'v1',
  '{
    "base_penalties": {
      "aio_click_loss": 35,
      "aio_visibility_loss": 10,
      "has_featured_snippet": 15,
      "has_paa": 8,
      "has_knowledge_graph": 12,
      "has_video_carousel": 5,
      "ctr_decline_at_stable_position_max": 20,
      "position_volatility": 5,
      "informational_no_aio_yet": 5
    },
    "aio_position_multiplier": {
      "position_1_to_3": 1.0,
      "position_4_to_10": 0.75,
      "position_11_to_20": 0.5,
      "position_21_plus_or_unknown": 0.3
    },
    "publisher_presence_multipliers": {
      "featured_snippet_publisher_owns": 0.0,
      "paa_publisher_present": 0.5,
      "knowledge_graph_publisher_present": 0.5,
      "video_publisher_present": -0.6
    },
    "news_adjustments": {
      "top_stories_publisher_in_carousel": -25,
      "top_stories_publisher_not_in_carousel": 5,
      "news_with_aio_extra_penalty": 15
    }
  }',
  true
);

COMMIT;
