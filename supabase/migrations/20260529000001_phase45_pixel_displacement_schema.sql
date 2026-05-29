-- Phase 4.5: pixel-displacement columns for SERP Screenshot enrichment

-- serp_jobs: distinguish organic vs screenshot task type
ALTER TABLE serp_jobs
  ADD COLUMN task_type text NOT NULL DEFAULT 'organic'
    CHECK (task_type IN ('organic', 'screenshot'));

-- serp_snapshots: per-element y-coordinates for AIO-above-TS tier rule
-- pixels_above_first_organic and publisher_pixel_height already exist (nullable)
ALTER TABLE serp_snapshots
  ADD COLUMN aio_pixel_y integer,
  ADD COLUMN top_stories_pixel_y integer;

COMMENT ON COLUMN serp_jobs.task_type IS
  'organic = standard SERP task; screenshot = SERP Screenshot task for pixel geometry';

COMMENT ON COLUMN serp_snapshots.aio_pixel_y IS
  'Visual y-coordinate (px from top) of the AI Overview element, from screenshot task. Null until screenshot enriched.';

COMMENT ON COLUMN serp_snapshots.top_stories_pixel_y IS
  'Visual y-coordinate (px from top) of the Top Stories carousel, from screenshot task. Null until screenshot enriched.';
