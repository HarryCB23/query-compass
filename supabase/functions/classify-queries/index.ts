/**
 * classify-queries edge function — Claude Haiku query classification.
 *
 * Two modes:
 *
 *   Normal: POST { import_id, project_id }
 *     - Auth required, membership checked
 *     - Fetches import_queries, checks classification cache
 *     - Branded queries → pattern classifier (model_version='pattern', prompt_version='v0')
 *     - Remaining → Claude Haiku in batches of 25
 *     - Upserts into classifications table
 *     - Returns { classified, cached_hits, cache_writes, branded_pattern, errors, metrics }
 *
 *   Eval: POST { mode: 'eval', queries: string[], branded_terms?: string[] }
 *     - Auth required (no DB writes or reads)
 *     - Calls Claude directly and returns results for eval harness
 *     - Returns { results: [{ query, category, entities, reasoning }], metrics }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyBatch, MODEL_VERSION, PROMPT_VERSION } from '../_shared/claudeClassifier.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── CORS ────────────────────────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function isBranded(query: string, terms: string[]): boolean {
  const q = query.toLowerCase().trim()
  return terms.some(t => q.includes(t.toLowerCase()))
}

const PAGE_SIZE = 500
const CHUNK = 100  // max UUIDs per .in() to stay under URL limits

// ── Handler ─────────────────────────────────────────────────────────────────

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

  // ── Eval mode ─────────────────────────────────────────────────────────────

  if (body.mode === 'eval') {
    const evalQueries = body.queries
    const evalBrandedTerms = (body.branded_terms as string[] | undefined) ?? []

    if (!Array.isArray(evalQueries) || evalQueries.length === 0) {
      return new Response(JSON.stringify({ error: 'Bad Request', reason: 'queries must be a non-empty array' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    try {
      const { results, metrics } = await classifyBatch(evalQueries as string[], evalBrandedTerms)
      return new Response(JSON.stringify({ results, metrics }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      return new Response(JSON.stringify({
        error: 'Classification failed',
        detail: err instanceof Error ? err.message : String(err),
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
  }

  // ── Normal mode ───────────────────────────────────────────────────────────

  const import_id = body.import_id as string | undefined
  const project_id = body.project_id as string | undefined
  const chunkOffset = typeof body.offset === 'number' ? (body.offset as number) : null
  const chunkLimit  = typeof body.limit  === 'number' ? (body.limit  as number) : null

  if (!import_id || !project_id) {
    return new Response(JSON.stringify({ error: 'Bad Request', reason: 'missing import_id or project_id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // Membership check: fetch project and verify user belongs to its org
  const { data: project, error: projectError } = await svc
    .from('projects')
    .select('id, org_id, branded_terms')
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
    return new Response(JSON.stringify({ error: 'Forbidden', detail: memberError.message }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden', reason: 'not a member of this project\'s organisation' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const brandedTerms: string[] = project.branded_terms ?? []

  // ── Fetch import_queries + query text ────────────────────────────────────

  const allRows: Array<{ query_id: string; query_text: string }> = []

  if (chunkOffset !== null && chunkLimit !== null) {
    // Chunked mode: client drives the loop; fetch only the requested slice
    const { data, error } = await svc
      .from('import_queries')
      .select('query_id, queries(query_text)')
      .eq('import_id', import_id)
      .order('id', { ascending: true })
      .range(chunkOffset, chunkOffset + chunkLimit - 1)

    if (error) {
      return new Response(JSON.stringify({ error: 'Failed to fetch import_queries', detail: error.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (data) {
      for (const row of data) {
        const qt = (row.queries as { query_text: string } | null)?.query_text
        if (qt) allRows.push({ query_id: row.query_id as string, query_text: qt })
      }
    }
  } else {
    // Full mode: paginate through all rows
    let pageOffset = 0
    for (;;) {
      const { data, error } = await svc
        .from('import_queries')
        .select('query_id, queries(query_text)')
        .eq('import_id', import_id)
        .range(pageOffset, pageOffset + PAGE_SIZE - 1)

      if (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch import_queries', detail: error.message }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (!data || data.length === 0) break

      for (const row of data) {
        const qt = (row.queries as { query_text: string } | null)?.query_text
        if (qt) allRows.push({ query_id: row.query_id as string, query_text: qt })
      }

      if (data.length < PAGE_SIZE) break
      pageOffset += PAGE_SIZE
    }
  }

  if (allRows.length === 0) {
    return new Response(JSON.stringify({
      classified: 0, cached_hits: 0, cache_writes: 0, branded_pattern: 0, errors: [],
      ...(chunkOffset !== null ? { processed_offset: chunkOffset, processed_count: 0 } : {}),
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Deduplicate by query_id (an import can reference the same query_id multiple times)
  const seen = new Set<string>()
  const uniqueRows: Array<{ query_id: string; query_text: string }> = []
  for (const r of allRows) {
    if (!seen.has(r.query_id)) { seen.add(r.query_id); uniqueRows.push(r) }
  }

  // ── Cache lookup: already classified with current model+prompt version ────

  const cachedIds = new Set<string>()
  const queryIds = uniqueRows.map(r => r.query_id)

  for (let i = 0; i < queryIds.length; i += CHUNK) {
    const { data } = await svc
      .from('classifications')
      .select('query_id')
      .in('query_id', queryIds.slice(i, i + CHUNK))
      .eq('model_version', MODEL_VERSION)
      .eq('prompt_version', PROMPT_VERSION)

    if (data) data.forEach((r: { query_id: string }) => cachedIds.add(r.query_id))
  }

  const uncachedRows = uniqueRows.filter(r => !cachedIds.has(r.query_id))

  // ── Branded pre-filter ────────────────────────────────────────────────────

  const brandedRows = uncachedRows.filter(r => isBranded(r.query_text, brandedTerms))
  const toClassify  = uncachedRows.filter(r => !isBranded(r.query_text, brandedTerms))

  let brandedPattern = 0

  if (brandedRows.length > 0) {
    const brandedInserts = brandedRows.map(r => ({
      query_id: r.query_id,
      category: 'branded',
      model_version: 'pattern',
      prompt_version: 'v0',
      entities: [],
      reasoning: null,
    }))

    for (let i = 0; i < brandedInserts.length; i += CHUNK) {
      const { error } = await svc
        .from('classifications')
        .upsert(brandedInserts.slice(i, i + CHUNK), { onConflict: 'query_id,model_version,prompt_version' })

      if (error) {
        console.error('branded upsert error:', error.message)
      } else {
        brandedPattern += brandedInserts.slice(i, i + CHUNK).length
      }
    }
  }

  // ── Claude classification ─────────────────────────────────────────────────

  let classified = 0
  const errors: string[] = []
  const allMetrics = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
  }

  if (toClassify.length > 0) {
    try {
      const { results, metrics } = await classifyBatch(
        toClassify.map(r => r.query_text),
        brandedTerms,
      )

      allMetrics.cache_creation_input_tokens += metrics.cache_creation_input_tokens
      allMetrics.cache_read_input_tokens     += metrics.cache_read_input_tokens
      allMetrics.input_tokens               += metrics.input_tokens
      allMetrics.output_tokens              += metrics.output_tokens

      const textToId = new Map(toClassify.map(r => [r.query_text, r.query_id]))

      const inserts = results
        .filter(r => textToId.has(r.query))
        .map(r => ({
          query_id: textToId.get(r.query)!,
          category: r.category,
          model_version: MODEL_VERSION,
          prompt_version: PROMPT_VERSION,
          entities: r.entities,
          reasoning: r.reasoning || null,
        }))

      for (let i = 0; i < inserts.length; i += CHUNK) {
        const { error } = await svc
          .from('classifications')
          .upsert(inserts.slice(i, i + CHUNK), { onConflict: 'query_id,model_version,prompt_version' })

        if (error) {
          errors.push(`upsert batch ${i}: ${error.message}`)
        } else {
          classified += inserts.slice(i, i + CHUNK).length
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return new Response(JSON.stringify({
    classified,
    cached_hits: cachedIds.size,
    cache_writes: classified + brandedPattern,
    branded_pattern: brandedPattern,
    errors,
    metrics: allMetrics,
    ...(chunkOffset !== null ? { processed_offset: chunkOffset, processed_count: allRows.length } : {}),
  }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
})
