/**
 * dataforseoClient — shared module for DataforSEO SERP enrichment.
 *
 * Exports:
 *   submitSerpTasks(tasks, credentials)  → { submitted, errors }
 *   parseSerpPostback(body)              → ParsedTaskResult[]
 *   computeSummaryFields(items, publisherDomains) → SerpSummaryFields
 *   SERP_RESPONSE_VERSION
 *
 * Architecture:
 *   - submitSerpTasks: calls DataforSEO task_post API, 429/5xx backoff
 *   - parseSerpPostback: pure parser, no I/O — safe to import in Node tests
 *   - computeSummaryFields: pure extractor, no I/O — safe to import in Node tests
 *   - eTLD+1 matching: UK-only inline implementation in v1.
 *     For non-UK domains in v2, replace with PSL library.
 *
 * Task payload spec (depth=10 mobile Advanced):
 *   {
 *     keyword, location_code, language_code: 'en', device: 'mobile',
 *     os: 'android', depth: 10,
 *     postback_url: '...', postback_data: 'advanced',
 *     tag: '{import_id}:{query_id}'
 *   }
 */

// IMPORTANT: keep in sync with serp_response_version column default
// in migration 20260525000001_phase4_serp_schema.sql — update both together.
export const SERP_RESPONSE_VERSION = 'v1'

const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com'
const MAX_RETRIES = 3

// ── Types ────────────────────────────────────────────────────────────────────

export interface SerpTaskInput {
  queryId: string
  queryText: string
  locationCode: number
  postbackUrl: string
  importId: string
}

export interface SubmittedTask {
  queryId: string
  dataforseoTaskId: string
}

export interface SubmitResult {
  submitted: SubmittedTask[]
  errors: Array<{ queryId: string; error: string }>
}

/** Shape of one task result as DataforSEO delivers it in the postback body. */
export interface RawDfsTaskResult {
  id: string
  tag: string | null
  status_code: number
  status_message: string
  result: RawDfsSerpResult[] | null
}

export interface RawDfsSerpResult {
  items: DataForSeoItem[] | null
  se_results_count?: number | null
}

export interface DataForSeoItem {
  type: string
  rank_absolute?: number | null
  domain?: string | null
  rectangle?: { x: number; y: number; width: number; height: number } | null
  // AIO
  text?: string | null
  references?: Array<{ domain?: string | null; url?: string | null }> | null
  // Top Stories / Video / PAA
  items?: DataForSeoItem[] | null
  // Organic
  url?: string | null
}

export interface ParsedTaskResult {
  taskId: string
  queryId: string | null   // extracted from tag field
  items: DataForSeoItem[] | null
  error: string | null
}

export interface SerpSummaryFields {
  // Layer 1: feature presence
  has_ai_overview: boolean
  has_top_stories: boolean
  has_featured_snippet: boolean
  has_video: boolean
  has_local_pack: boolean
  has_shopping: boolean

  // Layer 2: publisher presence
  publisher_in_ai_overview: boolean
  publisher_in_top_stories: boolean
  publisher_in_featured_snippet: boolean
  publisher_organic_position: number | null
  publisher_in_organic_top_3: boolean

  // Layer 3: competitive landscape
  aio_citation_count: number
  aio_word_count: number | null
  top_organic_domains: string[]
  top_stories_domains: string[]

  // Pixel geometry (DataforSEO Advanced rectangle data)
  pixels_above_first_organic: number | null
  publisher_pixel_height: number | null
}

// ── eTLD+1 domain matching ───────────────────────────────────────────────────

/**
 * Extracts the registered domain (eTLD+1) from a hostname.
 * UK-only inline implementation in v1 (handles .co.uk, .org.uk, .me.uk etc).
 * For non-UK domains in v2, replace with PSL library.
 *
 * Examples:
 *   secure.telegraph.co.uk  → telegraph.co.uk
 *   www.bbc.co.uk           → bbc.co.uk
 *   cdn.theguardian.com     → theguardian.com
 *   m.telegraph.co.uk       → telegraph.co.uk
 */
function getRegisteredDomain(hostname: string): string {
  if (!hostname) return ''
  const h = hostname.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  const parts = h.split('.')
  // Known UK two-part eTLDs
  const ukSecondLevel = new Set([
    'co', 'org', 'me', 'net', 'ltd', 'plc', 'mod', 'nhs', 'police',
    'sch', 'ac', 'gov',
  ])
  if (parts.length >= 3 && parts[parts.length - 1] === 'uk') {
    const sld = parts[parts.length - 2]
    if (ukSecondLevel.has(sld)) {
      // e.g. secure.telegraph.co.uk → telegraph.co.uk
      return parts.slice(-3).join('.')
    }
  }
  // Default: last two parts (e.g. theguardian.com)
  return parts.slice(-2).join('.')
}

function domainMatches(candidate: string | null | undefined, publisherDomains: string[]): boolean {
  if (!candidate) return false
  const candidateReg = getRegisteredDomain(candidate)
  return publisherDomains.some(pd => getRegisteredDomain(pd) === candidateReg)
}

// ── Internal: DataforSEO API call with retry ─────────────────────────────────

async function dfsPost(
  path: string,
  body: unknown,
  credentials: { login: string; password: string },
): Promise<unknown> {
  const auth = btoa(`${credentials.login}:${credentials.password}`)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`DataforSEO ${resp.status}: max retries exceeded`)
      }
      const delay = Math.pow(2, attempt + 1) * 1000
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`DataforSEO API error ${resp.status}: ${text}`)
    }

    return await resp.json()
  }

  throw new Error('DataforSEO: unreachable after retry loop')
}

// ── Exported: submit tasks to DataforSEO ─────────────────────────────────────

/**
 * Submits up to 100 SERP tasks to DataforSEO task_post.
 * Returns per-task submitted/error breakdown.
 *
 * Each task payload:
 *   keyword, location_code, language_code: 'en', device: 'mobile',
 *   os: 'android', depth: 10, postback_url, postback_data: 'advanced',
 *   tag: '{importId}:{queryId}'
 *
 * postback_data: 'advanced' is required for rectangle/pixel data.
 * Without it, DataforSEO returns the standard response and rectangle.y
 * will be absent on all items, making pixel heights silently null.
 */
export async function submitSerpTasks(
  tasks: SerpTaskInput[],
  credentials: { login: string; password: string },
): Promise<SubmitResult> {
  if (tasks.length === 0) return { submitted: [], errors: [] }
  if (tasks.length > 100) throw new Error('submitSerpTasks: max 100 tasks per call')

  const payload = tasks.map(t => ({
    keyword: t.queryText,
    location_code: t.locationCode,
    language_code: 'en',
    device: 'mobile',
    os: 'android',
    depth: 10,
    postback_url: t.postbackUrl,
    postback_data: 'advanced',
    tag: `${t.importId}:${t.queryId}`,
  }))

  // deno-lint-ignore no-explicit-any
  const data = await dfsPost('/v3/serp/google/organic/task_post', payload, credentials) as any

  const submitted: SubmittedTask[] = []
  const errors: Array<{ queryId: string; error: string }> = []

  const taskMap = new Map(tasks.map(t => [`${t.importId}:${t.queryId}`, t.queryId]))

  const results: unknown[] = Array.isArray(data?.tasks) ? data.tasks : []
  for (const result of results) {
    // deno-lint-ignore no-explicit-any
    const r = result as any
    const tag: string = r?.data?.tag ?? ''
    const queryId = taskMap.get(tag) ?? null
    if (!queryId) continue

    if (r?.status_code === 20100 && r?.id) {
      submitted.push({ queryId, dataforseoTaskId: r.id })
    } else {
      errors.push({
        queryId,
        error: `status_code=${r?.status_code} message=${r?.status_message ?? 'unknown'}`,
      })
    }
  }

  return { submitted, errors }
}

// ── Exported: parse DataforSEO postback body ─────────────────────────────────

/**
 * Parses the raw body from a DataforSEO postback request.
 * Pure function — no I/O. Safe to call in Node test context.
 *
 * DataforSEO postback body shape (confirmed against live fixtures):
 *   {
 *     tasks: [{
 *       id: string,            -- DataforSEO task ID
 *       status_code: number,   -- per-task code; use this, NOT the outer envelope's
 *       data: { tag: string, keyword: string, ... },
 *       result: [{ items: DataForSeoItem[] }] | null
 *     }]
 *   }
 *
 * tag is at task.data.tag (NOT task.tag — those are different fields).
 * tag format: '{importId}:{queryId}'
 *
 * status_code 20000 = task completed (may have empty items — no result is
 * still 20000 with items: []  OR a 4xxxx code; see fixture verification notes).
 * Non-20000 per-task codes are treated as errors.
 *
 * TODO: verify no_result fixture status_code. If DataforSEO sends 40xxx for
 * "keyword returned no data", treat it as complete-with-no-data rather than
 * error (serp_job → complete, serp_snapshot upserted with all-false columns).
 * Update this function after fixture capture confirms the exact code.
 *
 * Returns one ParsedTaskResult per task in the postback.
 * error is non-null when DataforSEO signals the task failed.
 */
export function parseSerpPostback(body: unknown): ParsedTaskResult[] {
  if (!body || typeof body !== 'object') return []
  // deno-lint-ignore no-explicit-any
  const tasks: unknown[] = (body as any)?.tasks ?? []
  if (!Array.isArray(tasks)) return []

  return tasks.map((task): ParsedTaskResult => {
    // deno-lint-ignore no-explicit-any
    const t = task as any
    const taskId: string = t?.id ?? ''
    // tag lives at task.data.tag — NOT task.tag
    const tag: string | null = t?.data?.tag ?? null
    // tag format: '{importId}:{queryId}'
    const queryId = tag ? (tag.split(':')[1] ?? null) : null

    const statusCode: number = t?.status_code ?? 0
    if (statusCode !== 20000 && statusCode !== 20100) {
      return {
        taskId,
        queryId,
        items: null,
        error: `DataforSEO status_code=${statusCode}: ${t?.status_message ?? 'unknown'}`,
      }
    }

    // result may be null, missing, or an empty array when no SERP data exists
    const resultItems: DataForSeoItem[] = t?.result?.[0]?.items ?? []
    return { taskId, queryId, items: resultItems, error: null }
  })
}

// ── Exported: compute summary fields from parsed items ───────────────────────

/**
 * Extracts all serp_snapshots summary columns from a DataforSEO Advanced
 * items array. Pure function — no I/O. Safe to call in Node test context.
 *
 * publisherDomains: [project.domain, ...project.alt_domains]
 * All domain matching uses eTLD+1 comparison (see getRegisteredDomain).
 *
 * Pixel heights:
 *   pixels_above_first_organic = rectangle.y of the first organic item.
 *   publisher_pixel_height     = rectangle.y of the publisher's organic item.
 *   Both are null if rectangle data is absent (non-Advanced response or
 *   DataforSEO omits it for that item). Phase 5 risk scoring falls back
 *   to binary has_ai_overview when pixels_above_first_organic is null.
 */
export function computeSummaryFields(
  items: DataForSeoItem[],
  publisherDomains: string[],
): SerpSummaryFields {
  // ── Layer 1: feature presence ──────────────────────────────────────────────
  const types = new Set(items.map(i => i.type))

  // TODO: verify AI Overview type string against live fixture.
  // DataforSEO docs use both 'ai_overview' and 'answer_box' in different places.
  // If the fixture shows a different type string, update this constant and the
  // has_ai_overview column logic throughout. The fixture for 'latest news'
  // (UK, 2026) is the most likely to contain an AI Overview.
  const has_ai_overview     = types.has('ai_overview')
  const has_top_stories     = types.has('top_stories')
  const has_featured_snippet = types.has('featured_snippet')
  const has_video           = types.has('video')
  const has_local_pack      = types.has('local_pack')
  const has_shopping        = types.has('shopping')

  // ── Layer 2: publisher presence ────────────────────────────────────────────
  const organicItems = items.filter(i => i.type === 'organic')
  const publisherOrganic = organicItems.find(i => domainMatches(i.domain, publisherDomains)) ?? null

  const publisher_organic_position = publisherOrganic?.rank_absolute ?? null
  const publisher_in_organic_top_3 =
    publisher_organic_position !== null && publisher_organic_position <= 3

  const publisher_in_featured_snippet = items
    .filter(i => i.type === 'featured_snippet')
    .some(i => domainMatches(i.domain, publisherDomains))

  const publisher_in_ai_overview = items
    .filter(i => i.type === 'ai_overview')
    .flatMap(i => i.references ?? [])
    .some(r => domainMatches(r.domain, publisherDomains))

  const publisher_in_top_stories = items
    .filter(i => i.type === 'top_stories')
    .flatMap(i => i.items ?? [])
    .some(s => domainMatches(s.domain, publisherDomains))

  // ── Layer 3: competitive landscape ────────────────────────────────────────
  const aio = items.find(i => i.type === 'ai_overview') ?? null
  const aio_citation_count = aio?.references?.length ?? 0
  const aio_word_count = aio?.text != null
    ? aio.text.trim().split(/\s+/).filter(Boolean).length
    : null

  const top_organic_domains = organicItems
    .slice(0, 5)
    .map(i => i.domain ?? '')
    .filter(Boolean)

  const top_stories_domains = items
    .filter(i => i.type === 'top_stories')
    .flatMap(i => i.items ?? [])
    .slice(0, 10)
    .map(s => s.domain ?? '')
    .filter(Boolean)

  // ── Pixel geometry (DataforSEO Advanced rectangle data) ────────────────────
  // rectangle.y is the CSS-pixel top edge of the element from page top.
  // Returns null if rectangle is absent — do not estimate or interpolate.
  const firstOrganic = organicItems[0] ?? null
  const pixels_above_first_organic = firstOrganic?.rectangle?.y ?? null

  const publisher_pixel_height = publisherOrganic?.rectangle?.y ?? null

  return {
    has_ai_overview,
    has_top_stories,
    has_featured_snippet,
    has_video,
    has_local_pack,
    has_shopping,
    publisher_in_ai_overview,
    publisher_in_top_stories,
    publisher_in_featured_snippet,
    publisher_organic_position,
    publisher_in_organic_top_3,
    aio_citation_count,
    aio_word_count,
    top_organic_domains,
    top_stories_domains,
    pixels_above_first_organic,
    publisher_pixel_height,
  }
}
