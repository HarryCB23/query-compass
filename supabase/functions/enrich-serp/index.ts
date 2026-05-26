/**
 * enrich-serp — DataforSEO SERP enrichment, client-chunked.
 *
 * POST body:
 *   {
 *     importId: string,       -- UUID of the import to enrich
 *     chunkOffset: number,    -- 0-based row offset into import_queries
 *     chunkLimit: number,     -- how many rows to process this call (max 100)
 *     dryRun?: boolean,       -- if true: return cost estimate, no submissions
 *     locationCode?: number   -- override project default_location_code
 *   }
 *
 * Response (200):
 *   {
 *     submitted: number,
 *     cached: number,
 *     errors: string[],
 *     processed_offset: number,
 *     processed_count: number,
 *     estimated_cost?: number   -- only present on dryRun
 *   }
 *
 * Response (402):
 *   { error: 'daily_budget_exceeded', budget: number, spent: number }
 *
 * Required environment variables (set as function secrets):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 *   DATAFORSEO_WEBHOOK_SECRET   -- appended to postback_url as ?token=
 *     (generate once: openssl rand -hex 32)
 *     Must also be set on the serp-webhook function so it can verify calls.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  submitSerpTasks,
  type SerpTaskInput,
} from '../_shared/dataforseoClient.ts'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DFS_LOGIN     = Deno.env.get('DATAFORSEO_LOGIN')!
const DFS_PASSWORD  = Deno.env.get('DATAFORSEO_PASSWORD')!
const WEBHOOK_SECRET = Deno.env.get('DATAFORSEO_WEBHOOK_SECRET') ?? ''

const TASK_COST_DEFAULT = 0.0006
const CHUNK = 100          // max UUIDs per .in() to stay under URL limits
const MAX_CHUNK_LIMIT = 100 // DataforSEO task_post max per call

// ── CORS ─────────────────────────────────────────────────────────────────────

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
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'missing Authorization header' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const authResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: ANON_KEY },
  })
  if (!authResp.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'invalid JWT' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  const user = await authResp.json()
  if (!user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'user not found' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ────────────────────────────────────────────────────────────

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const importId    = body.importId as string | undefined
  const chunkOffset = typeof body.chunkOffset === 'number' ? body.chunkOffset : null
  const chunkLimit  = typeof body.chunkLimit  === 'number'
    ? Math.min(body.chunkLimit as number, MAX_CHUNK_LIMIT)
    : null
  const dryRun      = body.dryRun === true
  const locationCodeOverride = typeof body.locationCode === 'number'
    ? (body.locationCode as number)
    : null

  if (!importId) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing importId' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (chunkOffset === null || chunkLimit === null) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing chunkOffset or chunkLimit' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Fetch import + project ────────────────────────────────────────────────
  // Single join so we get project membership in one round trip.

  const { data: importRow, error: importError } = await svc
    .from('imports')
    .select(`
      id,
      project_id,
      projects (
        id,
        org_id,
        domain,
        alt_domains,
        default_location_code,
        daily_serp_budget
      )
    `)
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
    return new Response(JSON.stringify({ error: 'Project not found for import' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Membership check ──────────────────────────────────────────────────────

  const { data: membership, error: memberError } = await svc
    .from('memberships')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('org_id', project.org_id)
    .maybeSingle()

  if (memberError) {
    return new Response(JSON.stringify({ error: 'Forbidden', detail: memberError.message }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden', reason: "not a member of this project's organisation" }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Effective location ────────────────────────────────────────────────────

  const effectiveLocationCode: number =
    locationCodeOverride ?? project.default_location_code ?? 2826

  // ── Daily budget check ────────────────────────────────────────────────────
  // Sum cost from all serp_jobs submitted today for this project's imports.

  const dailyBudget: number = parseFloat(project.daily_serp_budget ?? '50.00')
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayStartIso = todayStart.toISOString()

  // Collect import_ids for this project (chunked to respect .in() limits)
  const { data: projectImports, error: importsError } = await svc
    .from('imports')
    .select('id')
    .eq('project_id', project.id)

  if (importsError) {
    return new Response(JSON.stringify({ error: 'Failed to fetch project imports', detail: importsError.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const allProjectImportIds = (projectImports ?? []).map((r: { id: string }) => r.id)

  let dailySpent = 0
  for (let i = 0; i < allProjectImportIds.length; i += CHUNK) {
    const { data: jobs } = await svc
      .from('serp_jobs')
      .select('cost')
      .in('import_id', allProjectImportIds.slice(i, i + CHUNK))
      .gte('submitted_at', todayStartIso)

    if (jobs) {
      for (const j of jobs) dailySpent += parseFloat(j.cost ?? '0')
    }
  }

  if (dailySpent >= dailyBudget) {
    return new Response(JSON.stringify({
      error: 'daily_budget_exceeded',
      budget: dailyBudget,
      spent: dailySpent,
    }), { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // ── Fetch import_queries chunk ────────────────────────────────────────────

  const { data: chunkRows, error: chunkError } = await svc
    .from('import_queries')
    .select('query_id, queries(query_text)')
    .eq('import_id', importId)
    .order('id', { ascending: true })
    .range(chunkOffset, chunkOffset + chunkLimit - 1)

  if (chunkError) {
    return new Response(JSON.stringify({ error: 'Failed to fetch import_queries', detail: chunkError.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const queryRows: Array<{ query_id: string; query_text: string }> = []
  for (const row of chunkRows ?? []) {
    // deno-lint-ignore no-explicit-any
    const qt = (row.queries as any)?.query_text as string | undefined
    if (qt) queryRows.push({ query_id: row.query_id as string, query_text: qt })
  }

  if (queryRows.length === 0) {
    return new Response(JSON.stringify({
      submitted: 0, cached: 0, errors: [],
      processed_offset: chunkOffset, processed_count: 0,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Deduplicate by query_id (an import can reference the same query_id multiple times)
  const seen = new Set<string>()
  const uniqueRows: Array<{ query_id: string; query_text: string }> = []
  for (const r of queryRows) {
    if (!seen.has(r.query_id)) { seen.add(r.query_id); uniqueRows.push(r) }
  }

  // ── Cache-hit check ───────────────────────────────────────────────────────
  // A cached hit = UNIQUE(query_id, location_code) already has expires_at > now()

  const nowIso = new Date().toISOString()
  const cachedIds = new Set<string>()
  const allQueryIds = uniqueRows.map(r => r.query_id)

  for (let i = 0; i < allQueryIds.length; i += CHUNK) {
    const { data: snapshots } = await svc
      .from('serp_snapshots')
      .select('query_id')
      .in('query_id', allQueryIds.slice(i, i + CHUNK))
      .eq('location_code', effectiveLocationCode)
      .gt('expires_at', nowIso)

    if (snapshots) {
      for (const s of snapshots) cachedIds.add(s.query_id as string)
    }
  }

  const uncachedRows = uniqueRows.filter(r => !cachedIds.has(r.query_id))

  // ── Dry run ───────────────────────────────────────────────────────────────

  if (dryRun) {
    const estimatedCost = uncachedRows.length * TASK_COST_DEFAULT
    return new Response(JSON.stringify({
      submitted: 0,
      cached: cachedIds.size,
      errors: [],
      processed_offset: chunkOffset,
      processed_count: queryRows.length,
      estimated_cost: estimatedCost,
      would_submit: uncachedRows.length,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  if (uncachedRows.length === 0) {
    return new Response(JSON.stringify({
      submitted: 0, cached: cachedIds.size, errors: [],
      processed_offset: chunkOffset, processed_count: queryRows.length,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // ── Pre-INSERT serp_jobs (status='submitting', task_id=NULL) ──────────────
  // Insert BEFORE calling DataforSEO so the webhook can always find the row,
  // even if it fires in the ~500ms window between submission and our UPDATE.

  const preInsertRows = uncachedRows.map(r => ({
    import_id: importId,
    query_id: r.query_id,
    location_code: effectiveLocationCode,
    status: 'submitting',
    cost: TASK_COST_DEFAULT,
  }))

  const { data: insertedJobs, error: preInsertError } = await svc
    .from('serp_jobs')
    .insert(preInsertRows)
    .select('id, query_id')

  if (preInsertError || !insertedJobs) {
    return new Response(JSON.stringify({
      submitted: 0,
      cached: cachedIds.size,
      errors: [preInsertError?.message ?? 'pre-insert returned no rows'],
      processed_offset: chunkOffset,
      processed_count: queryRows.length,
    }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // queryId → DB row id (for patching task_id after submission)
  const queryIdToJobId = new Map<string, string>(
    insertedJobs.map((j: { id: string; query_id: string }) => [j.query_id, j.id])
  )

  // ── Submit to DataforSEO ──────────────────────────────────────────────────
  // postback_url: SUPABASE_URL/functions/v1/serp-webhook?token=DATAFORSEO_WEBHOOK_SECRET
  // tag format: "{importId}:{queryId}"
  // submitSerpTasks handles retry (max 3) on 429/5xx.

  const postbackUrl = `${SUPABASE_URL}/functions/v1/serp-webhook?token=${WEBHOOK_SECRET}`

  const tasks: SerpTaskInput[] = uncachedRows.map(r => ({
    queryId: r.query_id,
    queryText: r.query_text,
    locationCode: effectiveLocationCode,
    postbackUrl,
    importId,
  }))

  const errors: string[] = []
  let submitResult: Awaited<ReturnType<typeof submitSerpTasks>>

  try {
    submitResult = await submitSerpTasks(tasks, {
      login: DFS_LOGIN,
      password: DFS_PASSWORD,
    })
  } catch (err) {
    // Permanent API failure: mark all pre-inserted rows as error
    const errMsg = err instanceof Error ? err.message : String(err)
    for (const jobId of queryIdToJobId.values()) {
      await svc.from('serp_jobs')
        .update({ status: 'error', error: errMsg })
        .eq('id', jobId)
        .eq('status', 'submitting')  // don't overwrite if webhook already completed it
    }
    return new Response(JSON.stringify({
      submitted: 0,
      cached: cachedIds.size,
      errors: [errMsg],
      processed_offset: chunkOffset,
      processed_count: queryRows.length,
    }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // TEST ONLY — uncomment to exercise webhook tag-fallback path:
  // await new Promise(r => setTimeout(r, 30_000))

  // ── Patch task_id onto submitted rows ─────────────────────────────────────
  // Per-task errors from DataforSEO: mark as error. Accepted tasks: set task_id + status='submitted'.

  for (const e of submitResult.errors) {
    errors.push(`query ${e.queryId}: ${e.error}`)
    const jobId = queryIdToJobId.get(e.queryId)
    if (jobId) {
      await svc.from('serp_jobs')
        .update({ status: 'error', error: e.error })
        .eq('id', jobId)
        .eq('status', 'submitting')  // don't overwrite if webhook already completed it
    }
  }

  for (const s of submitResult.submitted) {
    const jobId = queryIdToJobId.get(s.queryId)
    if (jobId) {
      await svc.from('serp_jobs')
        .update({ dataforseo_task_id: s.dataforseoTaskId, status: 'submitted' })
        .eq('id', jobId)
        .eq('status', 'submitting')  // don't overwrite if webhook already completed it
    }
  }

  return new Response(JSON.stringify({
    submitted: submitResult.submitted.length,
    cached: cachedIds.size,
    errors,
    processed_offset: chunkOffset,
    processed_count: queryRows.length,
  }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
})
