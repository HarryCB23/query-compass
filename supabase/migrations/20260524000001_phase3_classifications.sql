-- =============================================================================
-- Phase 3 — Alter classifications table to support full Claude classification
--
-- The Phase 2 schema created classifications with:
--   • intent text (4-value check: informational/navigational/commercial/transactional)
--   • UNIQUE (query_id) — single classification per query, no versioning
--   • No entities, reasoning, or prompt_version columns
--
-- Phase 3 needs:
--   • category text (7 values matching QueryCategory)
--   • entities jsonb (structured entity extraction output)
--   • reasoning text (Claude's chain-of-thought, stored for debugging)
--   • prompt_version text (increment when prompt changes — invalidates cache)
--   • model_version NOT NULL (required for the 3-column unique constraint)
--   • UNIQUE (query_id, model_version, prompt_version) — versioned caching
--
-- UPSERT NOTE: the edge function must use
--   onConflict: 'query_id,model_version,prompt_version'
-- to match the constraint added here.
--
-- No data migration required: the table is empty (no Phase 3 has run yet).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop the single-column unique constraint (no versioning)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  DROP CONSTRAINT classifications_query_id_key;

-- ---------------------------------------------------------------------------
-- 2. Drop intent column (wrong value set, wrong name)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  DROP COLUMN intent;

-- ---------------------------------------------------------------------------
-- 3. Add category (7-value set matching QueryCategory in the frontend)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ADD COLUMN category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('branded','news','informational','commercial','transactional','product','other'));

-- ---------------------------------------------------------------------------
-- 4. Add prompt versioning — NOT NULL so it participates in the unique index
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'v1';

-- ---------------------------------------------------------------------------
-- 5. Make model_version NOT NULL (was nullable — NULL breaks unique constraint
--    because NULL != NULL in Postgres unique indexes, allowing duplicate rows)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ALTER COLUMN model_version SET DEFAULT 'claude-haiku-4-5-20251001',
  ALTER COLUMN model_version SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Add entity storage (array of {type, name, salience} objects)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ADD COLUMN entities jsonb NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------------
-- 7. Add reasoning (chain-of-thought from Claude, for debug tooltip in UI)
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ADD COLUMN reasoning text;

-- ---------------------------------------------------------------------------
-- 8. New 3-column unique constraint (versioned cache key)
--    Matches onConflict: 'query_id,model_version,prompt_version' in edge fn
-- ---------------------------------------------------------------------------
ALTER TABLE public.classifications
  ADD CONSTRAINT classifications_query_model_prompt_key
    UNIQUE (query_id, model_version, prompt_version);

-- ---------------------------------------------------------------------------
-- 9. Allow edge function (service role) to write classifications
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE ON public.classifications TO service_role;

COMMIT;
