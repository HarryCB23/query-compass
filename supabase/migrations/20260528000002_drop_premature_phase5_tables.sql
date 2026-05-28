-- Drop tables introduced prematurely in phase5_risk_schema.
--
-- risk_weights contradicts the locked Phase 5 decision: weights live as
-- constants in src/lib/riskScoring.ts, not the DB.
--
-- risk_scores was shaped for the rejected additive 0-100 model (components,
-- zero_click_risk, publisher_in_aio, etc.). The locked model is client-side
-- and stores nothing in v1; at_risk_clicks are computed from serp_snapshots
-- + import_queries on the fly. A stub of wrong-shaped columns is worse than
-- nothing — it implies a DB-backed workflow that doesn't exist.
--
-- The serp_snapshots additions from phase5_risk_schema (has_paa,
-- has_knowledge_graph, publisher_in_paa, publisher_in_knowledge_graph,
-- publisher_in_video) are kept — these are PAA/KG Phase 6+ candidates per
-- the brief, and the serp-webhook already populates them.

BEGIN;
DROP TABLE IF EXISTS public.risk_scores;
DROP TABLE IF EXISTS public.risk_weights;
COMMIT;
