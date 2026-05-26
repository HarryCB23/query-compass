/**
 * serp-webhook — receives DataforSEO postback, writes serp_snapshots + updates serp_jobs.
 *
 * Auth: ?token= query param compared constant-time against DATAFORSEO_WEBHOOK_SECRET.
 * Returns 200 on parse errors (prevents DataforSEO infinite-retry on bad payload).
 * Returns 200 on per-task errors (one bad task never blocks the rest).
 *
 * Required environment variables (set as function secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   DATAFORSEO_WEBHOOK_SECRET  -- must match enrich-serp's postback_url ?token= value
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  parseSerpPostback,
  computeSummaryFields,
  SERP_RESPONSE_VERSION,
  type DataForSeoItem,
} from '../_shared/dataforseoClient.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('DATAFORSEO_WEBHOOK_SECRET') ?? ''

// ── Constant-time token comparison ───────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

// ── TTL ───────────────────────────────────────────────────────────────────────

const TTL_MS = 72 * 60 * 60 * 1000  // 72 hours

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Token auth ────────────────────────────────────────────────────────────
  // Constant-time compare to prevent timing attacks.
  // 403 on mismatch — DataforSEO should not retry on 4xx (it considers these
  // permanent failures and stops calling), which is what we want.

  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  if (!WEBHOOK_SECRET || !timingSafeEqual(token, WEBHOOK_SECRET)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  // Return 200 on malformed body — DataforSEO will retry indefinitely on 5xx,
  // but if the payload is structurally malformed it will never parse correctly.

  let rawBody: unknown
  try {
    let bodyText: string
    if (req.headers.get('content-encoding') === 'gzip') {
      const buf = await req.arrayBuffer()
      const ds = new DecompressionStream('gzip')
      const stream = new Response(buf).body!.pipeThrough(ds)
      bodyText = await new Response(stream).text()
    } else {
      bodyText = await req.text()
    }
    rawBody = JSON.parse(bodyText)
  } catch (err) {
    console.error('serp-webhook: failed to parse body:', err)
    return new Response(JSON.stringify({ processed: 0, errors: 1, detail: 'body parse failed' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const tasks = parseSerpPostback(rawBody)
  if (tasks.length === 0) {
    console.warn('serp-webhook: parseSerpPostback returned 0 tasks')
    return new Response(JSON.stringify({ processed: 0, errors: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // Cache project publisher domains by import_id to avoid N DB round-trips
  // when a single postback contains multiple tasks from the same import.
  const domainsCache = new Map<string, string[]>()

  let processed = 0
  let errors = 0

  // ── Process each task serially ────────────────────────────────────────────

  for (const task of tasks) {
    try {
      // a. Look up serp_jobs by dataforseo_task_id (O(1) via UNIQUE index)
      if (!task.taskId) {
        console.warn('serp-webhook: task missing taskId, skipping')
        continue
      }

      const { data: primaryJob, error: jobError } = await svc
        .from('serp_jobs')
        .select('id, query_id, import_id, location_code, status')
        .eq('dataforseo_task_id', task.taskId)
        .maybeSingle()

      if (jobError) {
        console.error(`serp-webhook: job lookup error for task ${task.taskId}:`, jobError.message)
        errors++
        continue
      }

      let job = primaryJob

      // ── Tag-fallback lookup ───────────────────────────────────────────────
      // If task_id lookup missed (row still has NULL task_id — the ~500ms race
      // window between submission and our UPDATE), find via importId+queryId+
      // locationCode from the tag/data and patch the task_id onto the row.
      if (!job && task.importId && task.queryId && task.locationCode) {
        const { data: fallbackJob } = await svc
          .from('serp_jobs')
          .select('id, query_id, import_id, location_code, status')
          .eq('import_id', task.importId)
          .eq('query_id', task.queryId)
          .eq('location_code', task.locationCode)
          .in('status', ['submitting', 'submitted'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (fallbackJob) {
          console.log(`serp-webhook: tag-fallback matched job ${fallbackJob.id} for task ${task.taskId}`)
          await svc.from('serp_jobs')
            .update({ dataforseo_task_id: task.taskId })
            .eq('id', fallbackJob.id)
          job = fallbackJob
        }
      }

      if (!job) {
        console.warn(`serp-webhook: no serp_jobs row for dataforseo_task_id=${task.taskId} — skipping`)
        continue
      }

      // b. Idempotency: skip if already processed
      if (job.status === 'complete') {
        console.log(`serp-webhook: task ${task.taskId} already complete — skipping (idempotent)`)
        continue
      }

      // c. Fetch publisher domains (cached per import_id)
      let publisherDomains = domainsCache.get(job.import_id)
      if (!publisherDomains) {
        const { data: importRow, error: importError } = await svc
          .from('imports')
          .select('projects(domain, alt_domains)')
          .eq('id', job.import_id)
          .single()

        if (importError || !importRow) {
          console.error(`serp-webhook: failed to fetch project for import ${job.import_id}:`, importError?.message)
          errors++
          continue
        }

        // deno-lint-ignore no-explicit-any
        const proj = importRow.projects as any
        const domain: string = proj?.domain ?? ''
        const altDomains: string[] = proj?.alt_domains ?? []
        publisherDomains = domain ? [domain, ...altDomains] : altDomains
        domainsCache.set(job.import_id, publisherDomains)
      }

      // d. Compute summary fields
      // task.items is [] for 40102 (no results) and null for errors.
      // We only write a snapshot for non-error results (items !== null).
      if (task.items === null) {
        // True error (non-20000, non-40102): mark job as error, no snapshot
        const { error: errUpdate } = await svc
          .from('serp_jobs')
          .update({
            status: 'error',
            error: task.error,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        if (errUpdate) {
          console.error(`serp-webhook: failed to mark job ${job.id} as error:`, errUpdate.message)
        }
        errors++
        continue
      }

      const items: DataForSeoItem[] = task.items  // [] for 40102, array for 20000
      const summary = computeSummaryFields(items, publisherDomains)

      // e. Upsert serp_snapshots ON CONFLICT (query_id, location_code) DO UPDATE
      const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
      const now = new Date().toISOString()

      console.log(`serp-webhook: upserting snapshot for query ${job.query_id} location ${job.location_code}`)
      const { error: upsertError } = await svc
        .from('serp_snapshots')
        .upsert({
          query_id:               job.query_id,
          location_code:          job.location_code,
          captured_at:            now,
          captured_date:          now.split('T')[0],
          expires_at:             expiresAt,
          serp_response_version:  SERP_RESPONSE_VERSION,
          // Layer 1: feature presence
          has_ai_overview:        summary.has_ai_overview,
          has_top_stories:        summary.has_top_stories,
          has_featured_snippet:   summary.has_featured_snippet,
          has_video:              summary.has_video,
          has_local_pack:         summary.has_local_pack,
          has_shopping:           summary.has_shopping,
          // Layer 2: publisher presence
          publisher_in_ai_overview:      summary.publisher_in_ai_overview,
          publisher_in_top_stories:      summary.publisher_in_top_stories,
          publisher_in_featured_snippet: summary.publisher_in_featured_snippet,
          publisher_organic_position:    summary.publisher_organic_position,
          publisher_in_organic_top_3:    summary.publisher_in_organic_top_3,
          // Layer 3: competitive landscape
          aio_citation_count:    summary.aio_citation_count,
          aio_word_count:        summary.aio_word_count,
          top_organic_domains:   summary.top_organic_domains,
          top_stories_domains:   summary.top_stories_domains,
          // Pixel geometry (always null in Phase 4)
          pixels_above_first_organic: null,
          publisher_pixel_height:     null,
          // Raw items for this task (for debugging / reprocessing).
          // Stored as array of DataforSEO item objects, not the full postback
          // envelope — this is query-scoped, not postback-scoped.
          raw_serp_data: items,
        }, {
          onConflict: 'query_id,location_code',
        })

      if (upsertError) {
        console.error(`serp-webhook: snapshot upsert failed for query ${job.query_id}:`, upsertError.message, JSON.stringify(upsertError))
        errors++
        continue
      }
      console.log(`serp-webhook: snapshot upsert OK for query ${job.query_id}`)

      // f. Mark serp_job complete
      const { error: completeError } = await svc
        .from('serp_jobs')
        .update({
          status:       'complete',
          completed_at: now,
          error:        null,
        })
        .eq('id', job.id)

      if (completeError) {
        console.error(`serp-webhook: failed to mark job ${job.id} complete:`, completeError.message)
        // Non-fatal: snapshot is written; job status is stale but recoverable.
        errors++
      }

      processed++
    } catch (err) {
      // g. Per-task catch: one bad task never blocks the rest
      console.error(`serp-webhook: unhandled error for task ${task.taskId}:`, err)
      errors++
    }
  }

  return new Response(JSON.stringify({ processed, errors }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
