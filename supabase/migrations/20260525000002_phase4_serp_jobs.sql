-- Phase 4 — serp_jobs table
--
-- One row per DataforSEO task (= one query per enrichment run).
-- Webhook lookup is O(1) via dataforseo_task_id unique index.
-- Per-import progress: COUNT(*) GROUP BY status WHERE import_id = ?
--
-- DEPLOY CHECKLIST: Set DATAFORSEO_WEBHOOK_SECRET before deploying serp-webhook:
--   npx supabase secrets set DATAFORSEO_WEBHOOK_SECRET=$(openssl rand -hex 32)

BEGIN;

CREATE TABLE serp_jobs (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  dataforseo_task_id    text          UNIQUE,         -- NULL until submission confirmed
  import_id             uuid          NOT NULL REFERENCES imports(id)  ON DELETE CASCADE,
  query_id              uuid          NOT NULL REFERENCES queries(id)  ON DELETE CASCADE,
  location_code         int           NOT NULL DEFAULT 2826,
  status                text          NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('submitted', 'complete', 'error')),
  cost                  numeric(8,4)  NOT NULL DEFAULT 0.0006, -- depth=10 mobile; adjust after first billing statement
  submitted_at          timestamptz   NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  error                 text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Per-import progress query
CREATE INDEX idx_serp_jobs_import_status
  ON serp_jobs (import_id, status);

-- Webhook O(1) lookup (partial: only rows with a confirmed task_id)
CREATE UNIQUE INDEX idx_serp_jobs_task_id
  ON serp_jobs (dataforseo_task_id) WHERE dataforseo_task_id IS NOT NULL;

-- updated_at trigger (CREATE OR REPLACE — safe if function already exists)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER serp_jobs_set_updated_at
  BEFORE UPDATE ON serp_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE serp_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "serp_jobs: org members can read"
  ON serp_jobs FOR SELECT USING (
    import_id IN (
      SELECT i.id FROM imports i
      JOIN projects p ON p.id = i.project_id
      WHERE p.org_id IN (SELECT get_my_org_ids())
    )
  );

CREATE POLICY "serp_jobs: service role full access"
  ON serp_jobs FOR ALL USING (auth.role() = 'service_role');

COMMIT;
