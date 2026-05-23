import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseGSCCSV } from '../_shared/csvParser.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // auto-injected by runtime

const BATCH_SIZE = 2_000

// ALLOWED_ORIGINS: comma-separated list, wildcard segment (*) supported.
// e.g. "http://localhost:8080,https://*.lovable.app"
const ALLOWED_ORIGINS: Array<string | RegExp> = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:8080,https://*.lovable.app'
)
  .split(',')
  .map(o => o.trim())
  .map(o => o.includes('*') ? new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+') + '$') : o)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.some(p =>
    typeof p === 'string' ? p === origin : p.test(origin)
  )
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Auth: extract user from JWT ───────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'missing or malformed Authorization header' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const jwt = authHeader.replace('Bearer ', '')
  const anonClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: { user }, error: userError } = await anonClient.auth.getUser(jwt)
  if (userError) {
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'invalid JWT', detail: userError.message }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized', reason: 'user not found' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { project_id: string; csv_text: string; file_name?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { project_id, csv_text, file_name } = body
  if (!project_id) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing project_id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!csv_text) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing csv_text' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Service-role client for privileged DB writes ──────────────────────────
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Membership check: user must belong to the org that owns this project ──
  const { data: project, error: projectError } = await svc
    .from('projects')
    .select('id, org_id')
    .eq('id', project_id)
    .single()

  if (projectError || !project) {
    return new Response(JSON.stringify({ error: 'Project not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { data: membership, error: memberError } = await svc
    .from('memberships')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('org_id', project.org_id)
    .maybeSingle()

  if (memberError) {
    return new Response(JSON.stringify({ error: 'Forbidden', reason: 'membership lookup failed', detail: memberError.message }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden', reason: 'user is not a member of this project\'s organisation' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const { rows, errors } = parseGSCCSV(csv_text)

  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid rows found', errors }), {
      status: 422, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── SHA-256 query hash: encode(sha256(lower(trim(text))::bytea), 'hex') ───
  async function queryHash(text: string): Promise<string> {
    const normalised = text.toLowerCase().trim()
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // ── Upsert queries (global dedup) ─────────────────────────────────────────
  const queryRows = await Promise.all(
    rows.map(async r => ({
      query_text: r.query_text,
      query_hash: await queryHash(r.query_text),
    }))
  )

  const { error: queryUpsertError } = await svc
    .from('queries')
    .upsert(queryRows, { onConflict: 'query_hash', ignoreDuplicates: true })

  if (queryUpsertError) {
    return new Response(JSON.stringify({ error: 'Failed to upsert queries', detail: queryUpsertError.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Fetch query IDs for the hashes we just upserted
  const hashes = queryRows.map(r => r.query_hash)
  const { data: queryRecords, error: fetchError } = await svc
    .from('queries')
    .select('id, query_hash')
    .in('query_hash', hashes)

  if (fetchError || !queryRecords) {
    return new Response(JSON.stringify({ error: 'Failed to fetch query IDs', detail: fetchError?.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const hashToId = new Map(queryRecords.map(q => [q.query_hash, q.id]))

  // ── Insert import row ─────────────────────────────────────────────────────
  const { data: importRow, error: importError } = await svc
    .from('imports')
    .insert({
      project_id,
      file_name: file_name ?? null,
      source: 'csv',
      period_start: null,  // unknown for CSV uploads
      period_end: null,
      row_count: rows.length,
    })
    .select('id')
    .single()

  if (importError || !importRow) {
    return new Response(JSON.stringify({ error: 'Failed to create import', detail: importError?.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const import_id = importRow.id

  // ── Batch-insert import_queries in 2 000-row chunks ───────────────────────
  // Soft advisory: the UI warns at 25 000 rows; we process all rows here.
  // At 2 000 rows/batch a 50 000-row file needs ~25 round-trips; total time
  // is typically well within the 60 s Free-tier edge function limit.
  const importQueryRows = rows.map(r => ({
    import_id,
    query_id:             hashToId.get(queryRows.find(q => q.query_text === r.query_text)!.query_hash)!,
    clicks_current:       r.clicks_current       ?? null,
    impressions_current:  r.impressions_current  ?? null,
    ctr_current:          r.ctr_current          ?? null,  // already a fraction
    position_current:     r.position_current     ?? null,
    clicks_previous:      r.clicks_previous      ?? null,
    impressions_previous: r.impressions_previous ?? null,
    ctr_previous:         r.ctr_previous         ?? null,  // already a fraction
    position_previous:    r.position_previous    ?? null,
  }))

  for (let i = 0; i < importQueryRows.length; i += BATCH_SIZE) {
    const batch = importQueryRows.slice(i, i + BATCH_SIZE)
    const { error: batchError } = await svc.from('import_queries').insert(batch)
    if (batchError) {
      return new Response(JSON.stringify({
        error: 'Failed to insert import_queries batch',
        batch_start: i,
        detail: batchError.message,
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
  }

  return new Response(
    JSON.stringify({ import_id, row_count: rows.length, errors }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
