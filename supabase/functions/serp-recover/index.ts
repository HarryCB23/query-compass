/**
 * serp-recover — backfill serp_snapshots for stuck 'submitted' jobs.
 *
 * DataforSEO caches task results for ~30 days via task_get/advanced.
 * Use this after any webhook failure to recover lost postbacks without
 * re-submitting (which would cost another $0.0006/query).
 *
 * POST body:
 *   {
 *     importId: string,
 *     chunkOffset?: number,   -- 0-based, default 0
 *     chunkLimit?:  number    -- jobs per call, default 20, max 50
 *   }
 *
 * Response (200):
 *   {
 *     recovered: number,    -- snapshots written this call
 *     errors:    number,    -- tasks that failed task_get or upsert
 *     skipped:   number,    -- already complete / not yet ready
 *     processed: number,    -- total jobs examined this call
 *     remaining: number     -- submitted jobs left in this import
 *   }
 *
 * Chunk loop pattern (same as enrich-serp):
 *   Call repeatedly with increasing chunkOffset until remaining === 0.
 *
 * Required environment variables (same secrets as enrich-serp):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  dfsGet,
  parseSerpPostback,
  computeSummaryFields,
  SERP_RESPONSE_VERSION,
  type DataForSeoItem,
} from '../_shared/dataforseoClient.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DFS_LOGIN    = Deno.env.get('DATAFORSEO_LOGIN')!
const DFS_PASSWORD = Deno.env.get('DATAFORSEO_PASSWORD')!

const TTL_MS       = 72 * 60 * 60 * 1000
const MAX_CHUNK    = 50

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS: Array<string | RegExp> = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:8080,https://*.lovable.app'
)
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
  .map(o => o.includes('*')
    ? new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+') + '$')
    : o)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.some(p =>
    typeof p === 'string' ? p === origin : (p as RegExp).test(origin)
  )
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors   = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const authResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON_KEY },
  })
  if (!authResp.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  const user = await authResp.json()
  if (!user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ────────────────────────────────────────────────────────────

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const importId   = body.importId as string | undefined
  const chunkOffset = typeof body.chunkOffset === 'number' ? body.chunkOffset : 0
  const chunkLimit  = typeof body.chunkLimit  === 'number'
    ? Math.min(body.chunkLimit as number, MAX_CHUNK)
    : 20

  if (!importId) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing importId' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Fetch import + project (membership check) ─────────────────────────────

  const { data: importRow, error: importError } = await svc
    .from('imports')
    .select('id, project_id, projects(id, org_id, domain, alt_domains)')
    .eq('id', importId)
    .single()

  if (importError || !importRow) {
    return new Response(JSON.stringify({ error: 'Import not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // deno-lint-ignore no-explicit-any
  const project = importRow.projects as any
  if (!project) {
    return new Response(JSON.stringify({ error: 'Project not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { data: membership } = await svc
    .from('memberships')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('org_id', project.org_id)
    .maybeSingle()

  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Publisher domains ─────────────────────────────────────────────────────

  const domain: string = project.domain ?? ''
  const altDomains: string[] = project.alt_domains ?? []
  const publisherDomains = domain ? [domain, ...altDomains] : altDomains

  // ── Fetch chunk of submitted jobs ─────────────────────────────────────────

  const { data: jobRows, error: jobsError } = await svc
    .from('serp_jobs')
    .select('id, query_id, location_code, dataforseo_task_id, status')
    .eq('import_id', importId)
    .eq('status', 'submitted')
    .order('created_at', { ascending: true })
    .range(chunkOffset, chunkOffset + chunkLimit - 1)

  if (jobsError) {
    return new Response(JSON.stringify({ error: 'Failed to fetch jobs', detail: jobsError.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Count remaining submitted jobs ────────────────────────────────────────

  const { count: remainingCount } = await svc
    .from('serp_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('import_id', importId)
    .eq('status', 'submitted')

  const credentials = { login: DFS_LOGIN, password: DFS_PASSWORD }
  let recovered = 0
  let errors    = 0
  let skipped   = 0

  // ── Process each job ─────────────────────────────────────────────────────

  for (const job of jobRows ?? []) {
    if (!job.dataforseo_task_id) {
      console.warn(`serp-recover: job ${job.id} has no dataforseo_task_id — skipping`)
      skipped++
      continue
    }

    let taskGetBody: unknown
    try {
      taskGetBody = await dfsGet(
        `/v3/serp/google/organic/task_get/advanced/${job.dataforseo_task_id}`,
        credentials,
      )
    } catch (err) {
      console.error(`serp-recover: task_get failed for job ${job.id} task ${job.dataforseo_task_id}:`, err)
      errors++
      continue
    }

    const parsed = parseSerpPostback(taskGetBody)
    if (parsed.length === 0) {
      // task_get returned no tasks — not yet available or expired
      console.warn(`serp-recover: task_get returned 0 tasks for job ${job.id} — skipping`)
      skipped++
      continue
    }

    const task = parsed[0]

    if (task.items === null) {
      // DataforSEO returned an error status for this task
      const { error: errUpdate } = await svc
        .from('serp_jobs')
        .update({ status: 'error', error: task.error, completed_at: new Date().toISOString() })
        .eq('id', job.id)
      if (errUpdate) console.error(`serp-recover: failed to mark job ${job.id} as error:`, errUpdate.message)
      errors++
      continue
    }

    const items: DataForSeoItem[] = task.items
    const summary = computeSummaryFields(items, publisherDomains)

    const now       = new Date().toISOString()
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()

    const { error: upsertError } = await svc
      .from('serp_snapshots')
      .upsert({
        query_id:                      job.query_id,
        location_code:                 job.location_code,
        captured_at:                   now,
        captured_date:                 now.split('T')[0],
        expires_at:                    expiresAt,
        serp_response_version:         SERP_RESPONSE_VERSION,
        has_ai_overview:               summary.has_ai_overview,
        has_top_stories:               summary.has_top_stories,
        has_featured_snippet:          summary.has_featured_snippet,
        has_video:                     summary.has_video,
        has_local_pack:                summary.has_local_pack,
        has_shopping:                  summary.has_shopping,
        publisher_in_ai_overview:      summary.publisher_in_ai_overview,
        publisher_in_top_stories:      summary.publisher_in_top_stories,
        publisher_in_featured_snippet: summary.publisher_in_featured_snippet,
        publisher_organic_position:    summary.publisher_organic_position,
        publisher_in_organic_top_3:    summary.publisher_in_organic_top_3,
        aio_citation_count:            summary.aio_citation_count,
        aio_word_count:                summary.aio_word_count,
        top_organic_domains:           summary.top_organic_domains,
        top_stories_domains:           summary.top_stories_domains,
        pixels_above_first_organic:    null,
        publisher_pixel_height:        null,
        raw_serp_data:                 items,
      }, { onConflict: 'query_id,location_code' })

    if (upsertError) {
      console.error(`serp-recover: snapshot upsert failed for job ${job.id}:`, upsertError.message)
      errors++
      continue
    }

    const { error: completeError } = await svc
      .from('serp_jobs')
      .update({ status: 'complete', completed_at: now, error: null })
      .eq('id', job.id)

    if (completeError) {
      console.error(`serp-recover: failed to mark job ${job.id} complete:`, completeError.message)
      // Non-fatal: snapshot is written.
      errors++
    }

    recovered++
    console.log(`serp-recover: recovered job ${job.id} query ${job.query_id}`)
  }

  // remaining = total submitted minus what we just processed (some may have moved to complete)
  const remaining = Math.max(0, (remainingCount ?? 0) - recovered)

  return new Response(JSON.stringify({
    recovered,
    errors,
    skipped,
    processed: (jobRows ?? []).length,
    remaining,
  }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
})
