/**
 * claudeClassifier — shared module for Claude Haiku query classification.
 *
 * Exports:
 *   classifyBatch(queries, brandedTerms, options?) → { results, metrics }
 *   MODEL_VERSION, PROMPT_VERSION
 *
 * Architecture:
 *   - 25 queries per Claude call (BATCH_SIZE)
 *   - 429 exponential backoff, up to MAX_RETRIES attempts
 *   - Incomplete-response retry: up to MAX_COMPLETION attempts per batch
 *   - Prompt caching: large system block gets cache_control ephemeral;
 *     branded-terms block (dynamic, small) is NOT cached
 *   - tool_choice: any → forces structured tool_use output
 */

export const MODEL_VERSION = 'claude-haiku-4-5-20251001'
export const PROMPT_VERSION = 'v1'

const MAX_RETRIES = 4      // 429 retry attempts per API call
const MAX_COMPLETION = 3   // incomplete-response retries per batch
const BATCH_SIZE = 25

// ── Cached system prompt ────────────────────────────────────────────────────

const SYSTEM_CACHED = `You are a search-query classifier for Google Search Console data.

Classify each query into exactly one category using the classify_query tool.

## Categories

**informational** — The searcher wants to learn, understand, or find guidance. Signals: question words (what, how, why, when, where), "guide", "explained", "tutorial", "difference between", "understanding", analysis of a tool or platform, technical SEO concepts. This is the default for educational or research intent.

**news** — The searcher wants recent news, current events, or updates. BOTH conditions must hold: (a) a named entity is present (politician, public figure, country, institution, organisation) AND (b) a news/event signal is present (e.g. "latest", "update", "crisis", "resignation", "ceasefire", a year like "2024", topical event words like "war", "election", a political budget event). A generic term that happens to share a word with news (e.g. "crawl budget", "google news" as an SEO topic) is NOT news.

**product** — A bare product or tool name with minimal modifiers; the searcher is navigating to a specific product. Examples: "semrush", "google analytics 4", "chatgpt", "screaming frog seo spider".

**commercial** — The searcher is comparing, reviewing, or evaluating products/tools to make a purchase decision. Signals: "best", "top", "vs" between named products, "alternatives", "review", "compared", "which is best". Note: "vs" between abstract concepts (e.g. "commodity vs non commodity content") is informational, not commercial.

**transactional** — Direct action intent: buy, subscribe, download, sign up, get pricing. Signals: "buy", "download", "subscribe", "pricing", "free trial", "cost", "get access".

**other** — Catch-all: bare proper names without a news context, single generic terms, internal business jargon, ambiguous queries that do not fit any above category.

## Rules

1. For **news**, both a named entity AND a news/event signal are required. A lone proper name or partial name without a news-context modifier → **other**.
2. Queries about SEO tools, SEO strategies, or Google products used as topics → **informational**, even if "news" or "discover" appears in the tool/platform name (e.g. "how to rank on google news", "google discover analysis").
3. "vs" between abstract content concepts → **informational**. "vs" between named products/tools → **commercial**.
4. Call classify_query once for every query in the batch. Do not skip any.
5. Never output "branded" — that category is handled upstream before this call.`

// ── Tool schema ─────────────────────────────────────────────────────────────

const CLASSIFY_TOOL = {
  name: 'classify_query',
  description: 'Record the classification for one search query.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The exact query string being classified.',
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
    required: ['query', 'category', 'entities', 'reasoning'],
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
  query: string
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

  const userContent = queries.map((q, i) => `${i + 1}. ${q}`).join('\n')

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

    if (resp.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error('Claude 429: max retries exceeded')
      const retryAfter = Number(resp.headers.get('retry-after') ?? 0)
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

// ── Exported: classify queries in batches with incomplete-response retry ────

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
    let remaining = queries.slice(batchStart, batchStart + BATCH_SIZE)

    for (let attempt = 0; attempt < MAX_COMPLETION && remaining.length > 0; attempt++) {
      const { toolUses, usage } = await callClaude(remaining, brandedTerms, apiKey)

      metrics.cache_creation_input_tokens += usage.cache_creation_input_tokens
      metrics.cache_read_input_tokens += usage.cache_read_input_tokens
      metrics.input_tokens += usage.input_tokens
      metrics.output_tokens += usage.output_tokens

      const classified = new Set<string>()
      for (const tu of toolUses) {
        if (tu.query && !classified.has(tu.query)) {
          classified.add(tu.query)
          results.push({
            query: tu.query,
            category: tu.category,
            entities: tu.entities ?? [],
            reasoning: tu.reasoning ?? '',
          })
        }
      }

      remaining = remaining.filter(q => !classified.has(q))
    }

    // Queries still unclassified after MAX_COMPLETION attempts → default 'other'
    for (const q of remaining) {
      console.warn(`classifyBatch: no result for "${q}" after ${MAX_COMPLETION} attempts — defaulting to other`)
      results.push({ query: q, category: 'other', entities: [], reasoning: 'classification incomplete after max retries' })
    }
  }

  return { results, metrics }
}
