-- Phase 4.5 close-out: drop pixel y-coordinate columns added in phase45_pixel_displacement_schema.
--
-- DataforSEO Screenshot product provides PNG images, not structured pixel coordinates.
-- The 'rectangle' field in organic Advanced responses is always null (verified 2026-05-29).
-- No structured per-element y-data is available from this provider.
-- Leaving these columns creates permanent confusion ("why always null?") — same logic as
-- the Phase 5 premature-model rollback (20260528000002_drop_premature_phase5_tables.sql).
--
-- KEPT: serp_jobs.task_type (future-proof for other task types; harmless default 'organic')
-- KEPT: serp_snapshots.pixels_above_first_organic, publisher_pixel_height (pre-Phase 4,
--       reflect a real-but-deferred concept; slot in if a CV pipeline materialises)

ALTER TABLE serp_snapshots
  DROP COLUMN IF EXISTS aio_pixel_y,
  DROP COLUMN IF EXISTS top_stories_pixel_y;
