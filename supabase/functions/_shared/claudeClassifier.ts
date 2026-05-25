/**
 * claudeClassifier — shared module for Claude Haiku query classification.
 *
 * Exports:
 *   classifyBatch(queries, brandedTerms, options?) → { results, metrics }
 *   MODEL_VERSION, PROMPT_VERSION
 *
 * Architecture:
 *   - 25 queries per Claude call (BATCH_SIZE)
 *   - 429/5xx exponential backoff, up to MAX_RETRIES attempts per call
 *   - Index-based matching: Claude returns query_index (int), not echoed text
 *   - Missing indices default to 'other' without retry (non-transient)
 *   - Prompt caching: large system block gets cache_control ephemeral;
 *     branded-terms block (dynamic, small) is NOT cached
 *   - tool_choice: any → forces structured tool_use output
 */

export const MODEL_VERSION = 'claude-haiku-4-5-20251001'
// IMPORTANT: this value must stay in sync with CLASSIFIER_PROMPT_VERSION in
// src/lib/classifierVersion.ts — update both together.
export const PROMPT_VERSION = 'v3'

const MAX_RETRIES = 4   // 429/5xx retry attempts per API call
const BATCH_SIZE = 25

// ── Cached system prompt ────────────────────────────────────────────────────

const SYSTEM_CACHED = `You are a search-query classifier for Google Search Console data from news publishers.

Classify each query into exactly one category using the classify_query tool.

## Categories

**informational** — The searcher wants to learn, understand, or find guidance. Signals: question words (what, how, why, when, where), "guide", "explained", "tutorial", "difference between", "understanding", analysis of a tool or platform, technical SEO concepts. This is the default for educational or research intent.

**news** — The searcher wants news content. Applies to:
  (a) Queries with a named entity + a news/event signal ("keir starmer resignation", "ukraine war update 2024")
  (b) Bare named entities (PERSON, PLACE, ORGANIZATION) with no other intent modifier — see Rule 5
  (c) Generic news-intent keywords ("latest news", "breaking news") with no specific entity — see Rule 7

**product** — A bare product or tool name with minimal modifiers; the searcher is navigating to a specific product. Examples: "semrush", "google analytics 4", "chatgpt", "screaming frog seo spider".

**commercial** — The searcher is comparing, reviewing, or evaluating products/tools to make a purchase decision. Signals: "best", "top", "vs" between named products, "alternatives", "review", "compared", "which is best". Note: "vs" between abstract concepts (e.g. "commodity vs non commodity content") is informational, not commercial.

**transactional** — Direct action intent: buy, subscribe, download, sign up, get pricing. Signals: "buy", "download", "subscribe", "pricing", "free trial", "cost", "get access".

**other** — Catch-all: single generic terms with no clear intent, bare WORK titles (book/film/song without context), internal business jargon, ambiguous queries that do not fit any above category.

## Rules

1. For news queries with an event modifier, a named entity and a news/event signal are both present (e.g. "budget 2024", "ukraine ceasefire latest", "keir starmer pension").
2. Queries about SEO tools, SEO strategies, or Google products used as topics → **informational**, even if "news" or "discover" appears in the tool/platform name (e.g. "how to rank on google news", "google discover analysis").
3. "vs" between abstract content concepts → **informational**. "vs" between named products/tools → **commercial**.
4. Call classify_query once for every query in the batch. Use the query's 1-based position in the list as query_index (first query = 1, second = 2, etc.). Do not skip any.
5. Bare named entities (PERSON, PLACE, ORGANIZATION) with no other intent modifier → **news** with that entity extracted. Context: this tool serves news publishers, and someone searching a bare entity name on a news publisher's site is looking for news content about that entity. This applies regardless of whether the entity is a famous public figure.
   Examples: "trump" → news, "iran" → news, "manchester united" → news, "erfan soltani" → news.
   Exceptions to Rule 5:
   - Bare PRODUCT name (software tool, app, platform) → **product** instead
   - Bare WORK title (book, film, song with no other context) → **other** with WORK entity
   - Entity + commercial modifier ("X vs Y", "best X") → **commercial**
   - Entity + informational modifier ("how does X work", "what is X") → **informational**
6. Never output "branded" — that category is handled upstream before this call.
7. Generic news-intent keywords with no specific entity → **news**. Examples: "latest news", "news today", "breaking news", "world news", "headlines", "today's headlines". The search intent is explicitly news-seeking even without a named entity.

## Examples

Query (index 5): trump
classify_query({ "query_index": 5, "category": "news", "entities": [{"name": "Donald Trump", "type": "PERSON"}], "reasoning": "Bare named entity on a news publisher — searcher is looking for news content about Trump. Rule 5 applies." })

Query (index 12): latest news
classify_query({ "query_index": 12, "category": "news", "entities": [], "reasoning": "Generic news-intent keyword with no specific entity. Search intent is explicitly news-seeking. Rule 7 applies." })

Query (index 7): keir starmer pension
classify_query({ "query_index": 7, "category": "news", "entities": [{"name": "Keir Starmer", "type": "PERSON"}], "reasoning": "Named entity (politician) + news topic (pension policy). Rule 1 applies." })`

// ── Tool schema ─────────────────────────────────────────────────────────────

const CLASSIFY_TOOL = {
  name: 'classify_query',
  description: 'Record the classification for one search query.',
  input_schema: {
    type: 'object',
    properties: {
      query_index: {
        type: 'integer',
        description: 'The 1-based position of the query in the numbered list (1 = first query, 2 = second, etc.).',
      },
      category: {
        type: 'string',
        enum: ['informational', 'news', 'product', 'commercial', 'transactional', 'other'],
        description: "The category. Never use 'branded' — that is handled upstream.",
      },
      entities: {
        type: 'array',
        description: 'Named entities extracted from the query. Empty array if none.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: ['PERSON', 'ORGANIZATION', 'LOCATION', 'EVENT', 'PRODUCT'],
            },
          },
          required: ['name', 'type'],
        },
      },
      reasoning: {
        type: 'string',
        description: 'One sentence explaining why this category was chosen.',
      },
    },
    required: ['query_index', 'category', 'entities', 'reasoning'],
  },
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  query: string
  category: string
  entities: Array<{ name: string; type: string }>
  reasoning: string
}

export interface BatchMetrics {
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  input_tokens: number
  output_tokens: number
}

interface ToolUse {
  query_index: number
  category: string
  entities: Array<{ name: string; type: string }>
  reasoning: string
}

interface CallResult {
  toolUses: ToolUse[]
  usage: {
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
    input_tokens: number
    output_tokens: number
  }
}

// ── Internal: single Anthropic API call with 429 retry ──────────────────────

async function callClaude(
  queries: string[],
  brandedTerms: string[],
  apiKey: string,
): Promise<CallResult> {
  const brandedBlock = brandedTerms.length > 0
    ? `Branded terms (already filtered upstream, for context): ${brandedTerms.join(', ')}`
    : 'Branded terms: none configured.'

  const userContent = `Classify the following ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}:\n` +
    queries.map((q, i) => `${i + 1}. ${q}`).join('\n')

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_VERSION,
        max_tokens: 4096,
        system: [
          { type: 'text', text: SYSTEM_CACHED, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: brandedBlock },
        ],
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt === MAX_RETRIES) throw new Error(`Claude ${resp.status}: max retries exceeded`)
      const retryAfter = resp.status === 429 ? Number(resp.headers.get('retry-after') ?? 0) : 0
      const delay = Math.max(retryAfter * 1000, Math.pow(2, attempt + 1) * 1000)
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Claude API error ${resp.status}: ${body}`)
    }

    const data = await resp.json()

    const toolUses: ToolUse[] = (data.content ?? [])
      .filter((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'classify_query')
      // deno-lint-ignore no-explicit-any
      .map((b: any) => b.input as ToolUse)

    return {
      toolUses,
      usage: {
        cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
      },
    }
  }

  throw new Error('Claude: unreachable after retry loop')
}

// ── Exported: classify queries in batches ────────────────────────────────────

export async function classifyBatch(
  queries: string[],
  brandedTerms: string[],
  _options: { concurrency?: number } = {},
): Promise<{ results: ClassificationResult[]; metrics: BatchMetrics }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const results: ClassificationResult[] = []
  const metrics: BatchMetrics = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
  }

  for (let batchStart = 0; batchStart < queries.length; batchStart += BATCH_SIZE) {
    const batch = queries.slice(batchStart, batchStart + BATCH_SIZE)
    const { toolUses, usage } = await callClaude(batch, brandedTerms, apiKey)

    metrics.cache_creation_input_tokens += usage.cache_creation_input_tokens
    metrics.cache_read_input_tokens     += usage.cache_read_input_tokens
    metrics.input_tokens               += usage.input_tokens
    metrics.output_tokens              += usage.output_tokens

    // Match by 1-based index — robust to any characters in query text
    const classifiedIndices = new Set<number>()
    for (const tu of toolUses) {
      const idx = tu.query_index - 1  // convert 1-based → 0-based
      if (idx >= 0 && idx < batch.length && !classifiedIndices.has(idx)) {
        classifiedIndices.add(idx)
        results.push({
          query: batch[idx],
          category: tu.category,
          entities: tu.entities ?? [],
          reasoning: tu.reasoning ?? '',
        })
      } else {
        console.warn(`classifyBatch: invalid or duplicate query_index ${tu.query_index} (batch size ${batch.length})`)
      }
    }

    // Any index without a tool_use → default 'other'; do NOT retry (non-transient)
    for (let i = 0; i < batch.length; i++) {
      if (!classifiedIndices.has(i)) {
        console.warn(`classifyBatch: no result for index ${i + 1} ("${batch[i]}") — defaulting to other`)
        results.push({ query: batch[i], category: 'other', entities: [], reasoning: 'no classification returned' })
      }
    }
  }

  return { results, metrics }
}
