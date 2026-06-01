# Query Compass — Refactor Brief for Claude Code

**Repo:** https://github.com/HarryCB23/query-compass
**Prepared:** May 2026
**Reviewed by:** Claude (chat) — handing off to Claude Code for execution

---

## 0. Product scope (read this first)

Query Compass is a **consultancy tool for publisher traffic-risk reviews**, focused on quantifying how much organic search traffic is at risk from AI-driven SERP changes (primarily AI Overviews). Per engagement, a consultant uploads Google Search Console data (CSV today, GSC OAuth later) and the tool produces:

1. **High-quality categorisation** of every query (news/entities, informational, commercial, transactional, product, branded, other) — with named-entity extraction.
2. **SERP feature enrichment** per query (AI Overview, Top Stories, Featured Snippet, PAA, etc.) via DataforSEO.
3. **Traffic Risk scoring** — single composite score 0–100 per query, aggregated by category, entity, and profile.
4. **A polished front-end** that handles 10k+ queries smoothly.
5. **Persistent storage** so engagements can be revisited, compared, and re-scored without re-running enrichment.

**Out of scope:** AI content-licensing valuation is handled in a separate tool that combines crawl frequency by content area with business value of lost traffic. Query Compass exposes an `ai_surface_flag` per query (whether the query appears in AI surfaces like AIO/Knowledge Panel) for export to that tool, but does not score licensing value itself.

This is **not** a multi-tenant real-time SaaS in v1. Scope it as a consultancy tool with per-client *project workspaces*. Multi-tenant hardening (full RLS, billing, team management) is v2.

---

## 1. Current state — what exists

- Vite + React + TypeScript + shadcn/ui + Tailwind frontend.
- Single page (`/`). CSV drop zone → in-memory parsing → in-memory analysis. No persistence between sessions.
- One Supabase Edge Function: `classify-queries` — calls OpenAI gpt-4o-mini for NER on queries the pattern matcher couldn't classify.
- Zero database tables. Supabase is being used as a function host only.
- No auth, no GSC integration, no DataforSEO, no risk scoring code.
- Pattern-based classifier in `src/lib/queryClassifier.ts` and `src/hooks/useQueryClassification.ts` with hardcoded Telegraph-themed entity lists.

---

## 2. Critical issues found in review

### Security / hygiene
- **`supabase/config.toml` has `verify_jwt = false`** on `classify-queries`. CORS is `*`. Anyone with the URL can spam OpenAI on the project's dime. **Fix in phase 1.**
- **`.env` committed to git.** Anon keys exposed in history. Rotate, gitignore, add `.env.example`.
- **No rate limiting** on the edge function.

### Categorisation quality (verified live in user screenshots)
- **False positives:** `"budget"` in any query → News/Entities (catches "crawl budget for large sites"). `"how to rank on google news"` → News/Entities (it's informational about Google News). `"google discover analysis"` → News/Entities (SEO topic). `"commodity vs non commodity content"` → Commercial (matched `"vs"`).
- **False negatives:** `"harry clarkson bennett"` → Other (clear PERSON, missed). `"harry clarkson"` → Other (same).
- Three separate files maintain overlapping hardcoded entity lists.

### Architecture / efficiency
- No prompt caching on the OpenAI call — the ~600-token system prompt is resent every batch.
- Double-batching (frontend batches into 100 in parallel, then edge function re-batches into 50 sequentially). Pick one layer.
- Defensive `parsed.results || parsed.queries || parsed` fallback indicates inconsistent LLM output shape — fix with tool use / structured outputs.
- No idempotency: re-uploading the same CSV reclassifies everything from scratch.
- No retries on transient OpenAI failures (silently falls back to `isNewsEntity: false`).

### Data quality bugs (visible in screenshots)
- Average position renders as `0.0` for all categories — weighted-average calculation breaks when impressions are very small or zero.
- CTR change shows -100%/-99% across the board — likely division-by-zero on new queries with no previous period data.
- Total impressions displayed as `170.51` (decimal where integer expected) — CSV parser doesn't handle locale-specific decimal separators (European GSC exports use `,` as decimal).
- `parseCSV` assumes column order; breaks on non-English GSC exports.

### Front-end performance ceiling
- `QueryTable` renders all rows (no virtualisation) — fine at 1k, sluggish at 10k+.
- All aggregations done in JS via `useMemo` chains — won't scale past ~50k queries.

---

## 3. Target architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + TanStack Query + Supabase Realtime)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ auth'd
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  ├── Auth (email + Google OAuth for GSC scope later)            │
│  ├── Postgres (RLS-enforced, see schema below)                  │
│  ├── Edge Functions:                                            │
│  │     • ingest-csv          — parse + insert                   │
│  │     • classify-batch      — Claude Batch API submit          │
│  │     • claude-webhook      — receive batch results            │
│  │     • serp-enrich-batch   — DataforSEO tasks_post            │
│  │     • dataforseo-webhook  — receive SERP results             │
│  │     • compute-risk-scores — apply versioned weights          │
│  │     • gsc-oauth-callback  — for future GSC integration       │
│  ├── pg_cron — scheduled refresh of stale enrichment            │
│  └── Realtime — UI subscribes to risk_scores updates            │
└─────────────────────────────────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
┌──────────────────────┐    ┌──────────────────────┐
│  Anthropic Claude    │    │  DataforSEO          │
│  • Batch API         │    │  • Standard endpoint │
│  • Prompt caching    │    │  • Advanced features │
│  • Tool use schema   │    │  • Postback webhook  │
└──────────────────────┘    └──────────────────────┘
```

### Database schema

```sql
-- Tenancy
orgs                  (id, name, created_at)
users                 -- supabase.auth.users
memberships           (user_id, org_id, role)

-- Engagement model
projects              (id, org_id, client_name, domain, alt_domains TEXT[], location_code, device, branded_terms[], notes, created_at)
imports               (id, project_id, source ENUM('csv','gsc_api'), period_current_start, period_current_end,
                       period_previous_start NULL, period_previous_end NULL, file_name, row_count, created_at)

-- Normalised query data
queries               (query_hash PRIMARY KEY,    -- sha256(lower(trim(query_text)))
                       query_text, language, created_at)
import_queries        (import_id, query_hash,
                       clicks_current, impressions_current, ctr_current, position_current,
                       clicks_previous NULL, impressions_previous NULL, ctr_previous NULL, position_previous NULL,
                       PRIMARY KEY (import_id, query_hash))

-- Classification (versioned, cached by query_hash)
classifications       (id, query_hash, model_version, prompt_version,
                       category, confidence, reasoning, entities JSONB,
                       classified_at,
                       UNIQUE(query_hash, model_version, prompt_version))

-- SERP enrichment (versioned, cached by query + location + device)
serp_snapshots        (id, query_hash, location_code, device, language,
                       captured_at, item_types JSONB, raw_response JSONB,

                       -- materialised feature flags for fast filtering:
                       has_ai_overview BOOL, has_top_stories BOOL, has_video BOOL,
                       has_featured_snippet BOOL, has_paa BOOL, has_knowledge_graph BOOL,
                       has_images BOOL, has_shopping BOOL, has_local_pack BOOL,

                       -- publisher presence (computed at parse time against project domains):
                       publisher_in_organic_top_3 BOOL,
                       publisher_in_organic_top_10 BOOL,
                       publisher_organic_position INT NULL,         -- best matching organic position
                       publisher_in_top_stories BOOL,
                       publisher_top_stories_position INT NULL,
                       publisher_in_featured_snippet BOOL,
                       publisher_in_ai_overview BOOL,               -- cited in AIO references
                       publisher_in_paa BOOL,
                       publisher_in_video BOOL,
                       publisher_in_knowledge_graph BOOL,

                       -- AIO depth analysis:
                       aio_citation_domains TEXT[],
                       aio_citation_count INT,
                       aio_word_count INT,

                       -- Competitive landscape:
                       top_organic_domains TEXT[],                  -- top 5
                       top_stories_domains TEXT[],
                       featured_snippet_domain TEXT NULL,

                       -- SERP density:
                       serp_feature_count INT,                      -- count of non-organic features above fold
                       organic_results_returned INT,
                       total_results_count BIGINT,

                       UNIQUE(query_hash, location_code, device, captured_at::date))

-- Risk scoring (versioned weights, re-computable)
risk_weights          (id, version, name, weights JSONB, created_at, active BOOL)
risk_scores           (id, import_id, query_hash, weights_version,
                       traffic_risk_score NUMERIC(5,2),
                       components JSONB,              -- breakdown for transparency
                       -- derived flags for UI + aggregations:
                       zero_click_risk BOOL,
                       publisher_in_aio BOOL,
                       publisher_in_top_stories BOOL,
                       publisher_owns_fs BOOL,
                       ai_surface_flag BOOL,          -- for export to licensing tool
                       computed_at,
                       UNIQUE(import_id, query_hash, weights_version))

-- Third-party metric validation (DataforSEO Keywords Data + Labs)
keyword_metrics       (query_hash, location_code,
                       search_volume INT NULL,
                       keyword_difficulty INT NULL,    -- 0–100, DataforSEO Labs
                       cpc NUMERIC NULL,
                       competition NUMERIC NULL,        -- 0–1, DataforSEO
                       refreshed_at TIMESTAMPTZ,
                       UNIQUE(query_hash, location_code))

-- Job tracking
jobs                  (id, project_id, type ENUM('classify','serp_enrich','risk_compute'),
                       status ENUM('queued','running','complete','failed'),
                       external_job_id, payload JSONB, started_at, completed_at, error)
```

**RLS:** every table keyed off `org_id` via `projects.org_id`. Users only see rows where their `memberships.org_id` matches.

**Indexes:**
- `queries(query_hash)` — already PK
- `import_queries(import_id)`, `import_queries(query_hash)`
- `classifications(query_hash, model_version)`
- `serp_snapshots(query_hash, captured_at DESC)`
- `risk_scores(import_id, traffic_risk_score DESC)`
- `risk_scores(import_id, zero_click_risk)` partial index for fast filtering
- `keyword_metrics(query_hash, location_code)` — already unique

---

## 4. Categorisation — quality-first design

**Goal:** correctly handle the cases visible in user screenshots:
- `"how to rank on google news"` → **informational** with entity `[{type: ORG, name: "Google News"}]`
- `"crawl budget for large sites"` → **informational** with entities `[]`
- `"harry clarkson bennett"` → **other** with entity `[{type: PERSON, name: "Harry Clarkson Bennett"}]`
- `"keir starmer pension"` → **news** with entities `[{type: PERSON, name: "Keir Starmer"}, {type: TOPIC, name: "Pension"}]`

### Design

1. **Cache lookup first** — hash the normalised query, check `classifications` table for current `model_version + prompt_version`. Hit → done.
2. **No keyword pre-filter.** The pre-filter creates false positives we can't undo. LLM handles everything fresh.
3. **Claude Haiku for first pass** via Batch API:
   - Prompt cached (taxonomy + few-shot examples + rubric).
   - Tool use enforces schema: `{ category, confidence, entities: [{type, name, salience}], reasoning }`.
   - Few-shot examples MUST include the false-positive cases above.
4. **Confidence threshold** (default 0.7). Below → re-classify with Sonnet, store with higher cost-class tag.
5. **Batch API** — async submission, webhook callback. Don't block UI on classification.

### Prompt skeleton

```
You are classifying search queries for an SEO/publisher risk analysis tool.

Categories:
- branded: contains a known brand term from the project's brand list
- news: query about current events, named people in news context, geopolitical situations, breaking events
- informational: how-to, definitions, explanations, including questions ABOUT news/tools without being a news query itself
- commercial: comparison, "best of", reviews, alternatives
- transactional: buying intent, pricing, "buy", "download"
- product: specific product/category queries
- other: queries that don't fit above, including named individuals with no clear news/commercial context

CRITICAL distinctions (these caught the previous classifier out):
- "how to rank on google news" is INFORMATIONAL (about SEO), not news
- "crawl budget" is INFORMATIONAL (about SEO), not news (despite "budget")
- "google discover analysis" is INFORMATIONAL (about Google Discover), not news
- A person's name with no news context is OTHER (with entity extracted), not news
- "X vs Y" is COMMERCIAL only if X and Y are products/services being compared for purchase

For every query, extract entities even if category is not "news":
- PERSON: named individual human
- PLACE: geographic location
- ORGANIZATION: any named collective body — companies, agencies, parties, clubs, teams, movements, demographic labels
- EVENT: named happening
- PRODUCT: specific product or service
- WORK: title of media (book, film, show, song)
- BRAND: only entities from the project's branded terms list (exact match)

Branded terms for this project: {{branded_terms}}

Respond using the classify_query tool.
```

### Tool schema

```json
{
  "name": "classify_query",
  "input_schema": {
    "type": "object",
    "required": ["query", "category", "confidence", "entities"],
    "properties": {
      "query": {"type": "string"},
      "category": {"enum": ["branded", "news", "informational", "commercial", "transactional", "product", "other"]},
      "confidence": {"type": "number", "minimum": 0, "maximum": 1},
      "entities": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["type", "name"],
          "properties": {
            "type": {"enum": ["PERSON", "PLACE", "ORGANIZATION", "EVENT", "PRODUCT", "WORK", "BRAND"]},
            "name": {"type": "string"},
            "salience": {"type": "number"}
          }
        }
      },
      "reasoning": {"type": "string"}
    }
  }
}
```

### Entity type definitions (must appear in prompt as definitional guidance)

| Type | Definition | Example |
|---|---|---|
| PERSON | Named individual human | "Keir Starmer", "Taylor Swift" |
| PLACE | Geographic location at any scale | "Greenland", "Gaza", "Heathrow" |
| ORGANIZATION | Any named collective body — companies, agencies, parties, clubs, teams, movements, demographic labels | "NHS", "Reform UK", "Manchester United", "the Tories", "Just Stop Oil", "Gen Z" |
| EVENT | Named happening, recurring or one-off | "World Cup 2026", "Ukraine war", "King's Coronation" |
| PRODUCT | Specific product, service, or product line | "iPhone 17", "ChatGPT", "Bitcoin" |
| WORK | Title of media (book, film, show, song, podcast) | "The Traitors", "Strictly Come Dancing", "Dune Part Two" |
| BRAND | Term from the project's `branded_terms` list — exact-match only, not inferred | (project-specific) |

**Note:** "news" is a query *category*, not an entity type. A news query contains PERSON/PLACE/ORGANIZATION/EVENT/etc. entities. The two axes are orthogonal.

### Eval set (build in `src/test/classification.eval.ts`)

Hardcode 100+ known-correct examples including the false-positive/negative cases. Run before merging any prompt change. Track classification accuracy as a regression metric.

---

## 5. SERP enrichment — DataforSEO

### Endpoint choice

`POST /v3/serp/google/organic/task_post` with `depth: 100`, plus `pingback_url` set to the Supabase webhook function. Returns Advanced response with full `item_types` array (AI Overview, Top Stories, etc.).

### Per-task payload

```json
{
  "keyword": "...",
  "location_code": 2826,
  "language_code": "en",
  "device": "mobile",
  "os": "android",
  "depth": 100,
  "pingback_url": "https://{project}.supabase.co/functions/v1/dataforseo-webhook?token={secret}",
  "tag": "{import_id}:{query_hash}"
}
```

### Cost discipline

- **Cache hits:** before submitting, check `serp_snapshots` for `(query_hash, location_code, device, today)` within 72hr TTL. Skip if hit.
- **Batch tasks:** DataforSEO accepts up to 100 tasks per `tasks_post` call. Always batch.
- **Daily cap per project:** `projects.daily_serp_budget` decimal column. Edge function checks `SUM(cost) FROM jobs WHERE project_id = ? AND DATE(created_at) = CURRENT_DATE` before submitting.
- **Tier strategy:** v1 enriches *all* queries in an import. If cost gets out of hand, add a tier filter (e.g. only queries with > N impressions or in specific categories).

### Webhook handler

```typescript
// supabase/functions/dataforseo-webhook/index.ts
// 1. Verify shared-secret token in query param
// 2. Parse DataforSEO response
// 3. Extract item_types into boolean columns + JSONB
// 4. Upsert serp_snapshots
// 5. Trigger risk score recompute for affected import
// 6. Broadcast via Supabase Realtime
```

### Feature extraction

DataforSEO returns `items[].type` plus rich nested data per item. The parser should extract three layers:

**Layer 1 — Feature presence booleans** (used for risk model + UI filters):

| `item.type` | Stored column |
|---|---|
| `ai_overview` | `has_ai_overview` |
| `top_stories` | `has_top_stories` |
| `video` | `has_video` |
| `featured_snippet` | `has_featured_snippet` |
| `people_also_ask` | `has_paa` |
| `knowledge_graph` | `has_knowledge_graph` |
| `images` | `has_images` |
| `shopping` | `has_shopping` |
| `local_pack` | `has_local_pack` |

**Layer 2 — Publisher presence detection** (computed at parse time against `projects.domain` + `projects.alt_domains[]`):

Domain matching uses **registered-domain (eTLD+1) comparison**, not exact-string. `secure.telegraph.co.uk` matches `telegraph.co.uk`. Use the `psl` library or equivalent.

For each item type, scan all relevant nested domain fields:

```typescript
function detectPublisherPresence(
  raw: DataForSeoResponse,
  publisherDomains: string[]
): PublisherPresence {
  const matches = (d: string | undefined) =>
    d ? publisherDomains.some(pd => getRegisteredDomain(d) === getRegisteredDomain(pd)) : false;

  const organicResults = raw.items.filter(i => i.type === 'organic');
  const publisherOrganic = organicResults.find(r => matches(r.domain));

  return {
    publisher_in_organic_top_3: !!publisherOrganic && publisherOrganic.rank_absolute <= 3,
    publisher_in_organic_top_10: !!publisherOrganic && publisherOrganic.rank_absolute <= 10,
    publisher_organic_position: publisherOrganic?.rank_absolute ?? null,
    publisher_in_top_stories: raw.items
      .filter(i => i.type === 'top_stories')
      .flatMap(i => i.items ?? [])
      .some(s => matches(s.domain)),
    publisher_top_stories_position: /* index of publisher's story in carousel */,
    publisher_in_featured_snippet: raw.items
      .filter(i => i.type === 'featured_snippet')
      .some(i => matches(i.domain)),
    publisher_in_ai_overview: raw.items
      .filter(i => i.type === 'ai_overview')
      .flatMap(i => i.references ?? [])
      .some(r => matches(r.domain)),
    publisher_in_paa: raw.items
      .filter(i => i.type === 'people_also_ask')
      .flatMap(i => i.items ?? [])
      .flatMap(q => q.expanded_element ?? [])
      .some(e => matches(e.domain)),
    publisher_in_video: raw.items
      .filter(i => i.type === 'video')
      .flatMap(i => i.items ?? [])
      .some(v => matches(v.domain)),
    publisher_in_knowledge_graph: /* check sources/links in knowledge graph items */,
  };
}
```

**Layer 3 — Competitive landscape & SERP density**:

```typescript
function extractCompetitiveLandscape(raw: DataForSeoResponse) {
  const aio = raw.items.find(i => i.type === 'ai_overview');
  const ts = raw.items.find(i => i.type === 'top_stories');
  const fs = raw.items.find(i => i.type === 'featured_snippet');
  const organic = raw.items.filter(i => i.type === 'organic').slice(0, 5);

  return {
    aio_citation_domains: aio?.references?.map(r => r.domain) ?? [],
    aio_citation_count: aio?.references?.length ?? 0,
    aio_word_count: aio?.text ? wordCount(aio.text) : 0,
    top_organic_domains: organic.map(o => o.domain),
    top_stories_domains: ts?.items?.map(s => s.domain) ?? [],
    featured_snippet_domain: fs?.domain ?? null,
    serp_feature_count: raw.items.filter(i => i.type !== 'organic').length,
    organic_results_returned: organic.length,
    total_results_count: raw.se_results_count ?? null,
  };
}
```

The full raw response stays in `raw_response JSONB` so we can re-parse for new fields later without re-querying DataforSEO. **Don't skip this** — DataforSEO responses are too rich to predict every useful field in v1.

### Feature storage policy

DataforSEO Advanced responses include many more features than the Layer 1 table promotes to summary columns. PAA, knowledge panel, image pack, video carousel, related searches, and ads all arrive in the raw response and are fully preserved in `raw_response JSONB`. The summary column set is intentionally narrow.

**Decision rule:** a feature is promoted from raw JSON to a summary column when at least one of these conditions holds:

- **(a) The dashboard needs to aggregate it across all queries** — e.g. "what share of queries have an AI Overview?" requires `has_ai_overview` to be an indexed boolean column. Answering that from JSONB would require a GIN index and a `@>` query over every row.
- **(b) The risk scoring formula uses it as a direct input.** Every term in the §6 weight definitions must have a corresponding summary column. The scoring function never reads `raw_response`.

If neither condition holds, the feature stays in `raw_response` only. Do not add summary columns speculatively — the backfill path (parse `raw_response` batch job → `ALTER TABLE ... ADD COLUMN` migration) is straightforward and keeps the schema lean.

**Currently promoted columns** (all meet condition (a), (b), or both): `has_ai_overview`, `has_top_stories`, `has_featured_snippet`, `has_paa`, `has_knowledge_graph`, `has_video`, `publisher_in_ai_overview`, `publisher_in_top_stories`, `publisher_in_featured_snippet`, `publisher_in_paa`, `publisher_in_video`, `publisher_in_knowledge_graph`, `publisher_organic_position`, `aio_citation_count`.

**Features in raw JSON only** (as of Phase 4 v1): image pack, shopping carousel, local pack, ads (count and position), related searches, sitelinks, People Also Search For, knowledge panel sub-fields, AIO full citation list, Top Stories full domain list. These are all readable from `raw_response` when needed.

### Keyword metrics (separate endpoints, for third-party validation)

Beyond the SERP itself, we also pull volume and difficulty data for each query:

| Endpoint | Returns | Approx cost | TTL |
|---|---|---|---|
| `/v3/dataforseo_labs/google/bulk_keyword_difficulty/live` | Keyword Difficulty 0–100 | ~$0.01/keyword | 30 days |
| `/v3/keywords_data/google_ads/search_volume/live` | Monthly search volume, CPC, competition | Free (Google Ads source) or ~$0.05/1000 | 30 days |

These run on the **same triggers** as SERP enrichment (after import + cache miss) but are stored separately in the `keyword_metrics` table because:
- They have a much longer refresh cadence (30 days vs 72hr for SERP)
- They're not part of the risk scoring formula in v1 — surfaced as context only
- Search Volume gives us a third-party check against GSC's impression numbers (sanity check for "is this query as big as the publisher thinks?")
- Keyword Difficulty contextualises whether the publisher could realistically improve position

**Both up to 1000 keywords per request** — batch aggressively. For a 5,000-query import, that's 5 KD calls + 5 search volume calls = ~10 API hits total for metrics, on top of the SERP enrichment.

**Why kept out of the risk formula for v1:** these are useful for the consultant to see and exportable, but baking them into the score would require a new round of weight tuning we don't have data for yet. Revisit in v2 once the eval set tells us whether they improve accuracy.

---

## 6. Traffic Risk scoring model

Single-axis score 0–100 per query. **AIO presence is the dominant penalty**, modified by position (the more clicks you had, the more you lose). News queries get special handling because Top Stories is an opportunity surface, not a risk.

### v1 weight definitions (store in `risk_weights` table, `version: 'v1'`)

```json
{
  "base_penalties": {
    "aio_click_loss": 35,
    "aio_visibility_loss": 10,
    "has_featured_snippet": 15,
    "has_paa": 8,
    "has_knowledge_graph": 12,
    "has_video_carousel": 5,
    "ctr_decline_at_stable_position_max": 20,
    "position_volatility": 5,
    "informational_no_aio_yet": 5
  },
  "aio_position_multiplier": {
    "position_1_to_3": 1.0,
    "position_4_to_10": 0.75,
    "position_11_to_20": 0.5,
    "position_21_plus_or_unknown": 0.3
  },
  "publisher_presence_multipliers": {
    "featured_snippet_publisher_owns": 0.0,
    "paa_publisher_present": 0.5,
    "knowledge_graph_publisher_present": 0.5,
    "video_publisher_present": -0.6
  },
  "news_adjustments": {
    "top_stories_publisher_in_carousel": -25,
    "top_stories_publisher_not_in_carousel": 5,
    "news_with_aio_extra_penalty": 15
  }
}
```

**Key change vs earlier draft:** AIO penalty is split into two components. The 35-point **click-loss** applies whenever AIO is present (mediated by position); the 10-point **visibility loss** applies only when the publisher is not cited in the AIO. Citation reduces the penalty from 45 → 35 at position 1 (a ~22% reduction), correctly reflecting that the click is still lost even when the publisher is mentioned.

### Scoring rationale

The model treats **AIO presence itself as the dominant zero-click risk**, separately from "are you cited":

- **AIO click loss (35 base, position-multiplied):** applies whenever AIO is on the SERP. The click is lost regardless of whether the publisher is mentioned. This is the zero-click reality.
- **AIO visibility loss (10 flat):** applies only when the publisher is NOT cited in the AIO. Captures the additional harm of being completely absent as a source.
- **Position multiplier** (1.0 / 0.75 / 0.5 / 0.3) — even at position 30, AIO still represents zero-click harm on a query the publisher could be climbing toward. Floor is intentionally not zero.

Other features and adjustments:

- **Featured snippet, publisher owns it = 0 penalty.** You own the zero-click. (multiplier 0.0)
- **Featured snippet, publisher doesn't own = 15 base.** Click goes to the FS owner.
- **News + Top Stories + publisher IN carousel = -25 relief.** Publisher is actively benefiting from the news surface.
- **News + Top Stories + publisher NOT in carousel = +5 penalty.** Competitors are winning the news carousel and you're not.
- **News + AIO = +15 extra penalty.** Hard news queries getting AIO is rare but signals a major shift.
- **Video carousel with publisher present = -3 relief.** Owning the video answer is positive.
- **CTR decline at stable position = 0–20 continuous.** Smoking gun of AIO impact even without seeing AIO in the SERP snapshot.
- **Informational without AIO yet = +5.** Latent risk — these are next to get AIO.

The presence multipliers fundamentally change the model's accuracy: a publisher who *owns* the SERP features on their queries gets a near-zero risk score even on highly featured SERPs, while a publisher whose queries are surrounded by competitor features gets the full penalty.

### Scoring function

```typescript
type TrafficRiskComponents = {
  aio_click_loss: number;       // applies whenever AIO present
  aio_visibility_loss: number;  // applies only when publisher not cited
  featured_snippet_penalty: number;
  paa_penalty: number;
  knowledge_graph_penalty: number;
  video_carousel_adjustment: number;
  ctr_decline_penalty: number;
  volatility_penalty: number;
  latent_informational_penalty: number;
  top_stories_adjustment: number;
  news_aio_extra_penalty: number;
};

function aioPositionMultiplier(position: number | null, w: Weights): number {
  if (!position || position > 20) return w.aio_position_multiplier.position_21_plus_or_unknown;
  if (position <= 3) return w.aio_position_multiplier.position_1_to_3;
  if (position <= 10) return w.aio_position_multiplier.position_4_to_10;
  return w.aio_position_multiplier.position_11_to_20;
}

function computeTrafficRisk(
  q: QueryData,
  serp: SerpSnapshot,
  classification: Classification,
  w: Weights
): {
  score: number;
  components: TrafficRiskComponents;
  zero_click_risk: boolean;
  publisher_in_aio: boolean;
} {
  const c: TrafficRiskComponents = {
    aio_click_loss: 0,
    aio_visibility_loss: 0,
    featured_snippet_penalty: 0,
    paa_penalty: 0,
    knowledge_graph_penalty: 0,
    video_carousel_adjustment: 0,
    ctr_decline_penalty: 0,
    volatility_penalty: 0,
    latent_informational_penalty: 0,
    top_stories_adjustment: 0,
    news_aio_extra_penalty: 0,
  };

  // 1. AIO — split into click-loss (always applies) and visibility-loss (only if not cited)
  if (serp.has_ai_overview) {
    const positionMult = aioPositionMultiplier(q.position_current, w);
    c.aio_click_loss = w.base_penalties.aio_click_loss * positionMult;
    if (!serp.publisher_in_ai_overview) {
      c.aio_visibility_loss = w.base_penalties.aio_visibility_loss;
    }
  }

  // 2. Featured Snippet — full penalty unless publisher owns it
  if (serp.has_featured_snippet) {
    const presenceMult = serp.publisher_in_featured_snippet
      ? w.publisher_presence_multipliers.featured_snippet_publisher_owns
      : 1.0;
    c.featured_snippet_penalty = w.base_penalties.has_featured_snippet * presenceMult;
  }

  // 3. PAA — reduced if publisher present
  if (serp.has_paa) {
    const presenceMult = serp.publisher_in_paa
      ? w.publisher_presence_multipliers.paa_publisher_present
      : 1.0;
    c.paa_penalty = w.base_penalties.has_paa * presenceMult;
  }

  // 4. Knowledge Graph
  if (serp.has_knowledge_graph) {
    const presenceMult = serp.publisher_in_knowledge_graph
      ? w.publisher_presence_multipliers.knowledge_graph_publisher_present
      : 1.0;
    c.knowledge_graph_penalty = w.base_penalties.has_knowledge_graph * presenceMult;
  }

  // 5. Video carousel
  if (serp.has_video) {
    c.video_carousel_adjustment = serp.publisher_in_video
      ? w.base_penalties.has_video_carousel * w.publisher_presence_multipliers.video_publisher_present
      : w.base_penalties.has_video_carousel;
  }

  // 6. CTR decline at stable position
  if (
    q.position_current && q.position_previous &&
    Math.abs(q.position_current - q.position_previous) < 1 &&
    q.ctr_previous > 0
  ) {
    const ctrDrop = Math.max(0, (q.ctr_previous - q.ctr_current) / q.ctr_previous);
    c.ctr_decline_penalty = Math.min(ctrDrop, 1) * w.base_penalties.ctr_decline_at_stable_position_max;
  }

  // 7. Position volatility
  if (q.position_current && q.position_previous && Math.abs(q.position_current - q.position_previous) > 5) {
    c.volatility_penalty = w.base_penalties.position_volatility;
  }

  // 8. Latent risk
  if (classification.category === 'informational' && !serp.has_ai_overview) {
    c.latent_informational_penalty = w.base_penalties.informational_no_aio_yet;
  }

  // 9. News Top Stories logic
  if (classification.category === 'news' && serp.has_top_stories) {
    c.top_stories_adjustment = serp.publisher_in_top_stories
      ? w.news_adjustments.top_stories_publisher_in_carousel
      : w.news_adjustments.top_stories_publisher_not_in_carousel;
  }

  // 10. News + AIO extra penalty
  if (classification.category === 'news' && serp.has_ai_overview) {
    c.news_aio_extra_penalty = w.news_adjustments.news_with_aio_extra_penalty;
  }

  const raw = Object.values(c).reduce((sum, v) => sum + v, 0);
  const score = Math.max(0, Math.min(100, raw));

  // Derived flags for UI badges and aggregations
  const zero_click_risk =
    serp.has_ai_overview ||
    (serp.has_featured_snippet && !serp.publisher_in_featured_snippet) ||
    serp.has_knowledge_graph;

  return {
    score,
    components: c,
    zero_click_risk,
    publisher_in_aio: !!serp.publisher_in_ai_overview,
  };
}
```

### Derived per-query flags (for UI badges and aggregations)

Stored alongside the score on `risk_scores`:

| Flag | Definition | UI badge |
|---|---|---|
| `zero_click_risk` BOOL | `has_ai_overview OR (has_featured_snippet AND NOT publisher_in_featured_snippet) OR has_knowledge_graph` | 🔴 Zero-click |
| `publisher_in_aio` BOOL | Publisher cited in AI Overview references | ✓ In AIO |
| `publisher_in_top_stories` BOOL | Publisher present in Top Stories carousel | ✓ In Top Stories |
| `publisher_owns_fs` BOOL | Publisher owns the Featured Snippet | ✓ Owns FS |
| `ai_surface_flag` BOOL | Any AI surface present (AIO/PAA/KG/FS) — for export to the separate licensing tool | (exported, not displayed) |

### Aggregations (project-level headline metrics)

These are the headline numbers a consultant puts on the front page of the deliverable:

| Metric | Formula | What it answers |
|---|---|---|
| **Clicks at risk** | `SUM(clicks_current × risk_score / 100)` | "How much measurable business is at risk?" |
| **Zero-click exposure** | `SUM(impressions WHERE zero_click_risk) / SUM(impressions)` | "What share of your traffic is on SERPs answering without a click?" |
| **AIO citation rate** | `COUNT(WHERE publisher_in_aio) / COUNT(WHERE has_ai_overview)` | "When AIO appears for our queries, how often are we cited?" |
| **Top Stories capture rate** | `COUNT(WHERE publisher_in_top_stories) / COUNT(news WHERE has_top_stories)` | "On news queries with Top Stories, how often are we in the carousel?" |
| **Average traffic risk** | impression-weighted mean of `risk_score` | Single headline number for the profile |

### Per-axis aggregations

- **Category risk** = impression-weighted average of query risks in category.
- **Entity risk** = impression-weighted average of query risks for queries containing that entity (JSONB containment query).

Store as **materialised views** refreshed when an import completes scoring.

### Re-scoring

When weights change (new row in `risk_weights` marked `active: true`), recompute reads from `risk_scores.components` JSONB and re-applies the new weights — no re-classification, no re-SERP. This is critical: weight tuning must be instant and lossless.

---

## 7. Front-end performance

- **Replace** `QueryTable` rendering with `@tanstack/react-virtual`. Render only visible rows.
- **Server-side sort/filter** — all sortable columns become indexed Postgres columns, filtering via `supabase.from('import_queries').select(...).order(...).range(...)`.
- **Aggregations come pre-computed** from materialised views, not JS `reduce` chains.
- **Split `Index.tsx`** (currently 587 lines) into:
  - `pages/Project/index.tsx` — project selector & overview
  - `pages/Project/Import.tsx` — single-import view (current behaviour)
  - `pages/Project/RiskBreakdown.tsx`
  - `pages/Project/EntityExplorer.tsx`
  - `pages/Project/QueryTable.tsx` (virtualised)
- **Comparison toggle** — UI control on the import. Backend supports both: `import.period_previous_start` is nullable.

---

## 8. Phased implementation plan

Each phase should land as a working state with passing tests.

### Phase 1 — Foundations & security ✅ complete (2026-05-23) — smoke-tested ✅
- [x] Add `.env` to `.gitignore`, create `.env.example`, document required vars in README.
      **Decision:** `.env` was already in `.gitignore` (added by Lovable post-initial commit).
      Anon key from old project (`biyuaxgfhtizaltnuzll`) exposed in commit `4520309` — moot
      now that a new project is in use; old project can be deleted.
- [x] Rotate Supabase keys / new project. Old Lovable-generated project `biyuaxgfhtizaltnuzll`
      replaced entirely by new project `vgascqdmcgffopilfktu` (eu-west-1). `.env` and
      `config.toml` updated. Old keys no longer in use.
- [x] Add `verify_jwt = true` to `classify-queries` + dynamic CORS via `ALLOWED_ORIGINS`
      edge-function secret (comma-separated, wildcard-segment support).
      Default: `http://localhost:8080,https://*.lovable.app`.
      **Smoke-tested:** unauthenticated POST → 401 `UNAUTHORIZED_NO_AUTH_HEADER`. ✅
      Add Vercel production URL when deploying:
      `npx supabase secrets set ALLOWED_ORIGINS=https://your-app.vercel.app,...`
- [x] Add basic Supabase Auth (email magic link) to the app. Gate `/` behind auth.
      **Implementation:** `src/components/auth/AuthPage.tsx` + `AuthGuard.tsx`.
      No Google OAuth (deferred to Phase 7 per brief). Post-login redirect → `/`.
      **Smoke-tested:** magic link delivered, session established, `/` accessible. ✅
- [x] Create `orgs`, `memberships` tables. Auto-create org on signup.
      **Migration:** `supabase/migrations/20260523000001_phase1_auth_tables.sql`
      Applied to `vgascqdmcgffopilfktu` via Supabase MCP.
      **Decision:** org name defaults to email domain (`split_part(email,'@',2)`), not local part.
      RLS is SELECT-only; all writes go through the SECURITY DEFINER trigger.
      **Smoke-tested:** `orgs` contains `djbstrategies.com`; `memberships` has owner row. ✅

#### Phase 1 deviations / decisions
- `users` table not created: Supabase manages `auth.users` internally. The brief's
  schema references it as a foreign key target only — no separate `public.users` table needed.
- Rate limiting on `classify-queries` deferred to Phase 3 (function will be replaced entirely).
- CORS origin hardening shipped alongside `verify_jwt` in the same commit.
- Migration had to be reordered (both tables before policies) because the `orgs` RLS policy
  references `memberships` — forward reference fails at parse time. Fixed in commit `618783c`.
- Supabase project switched mid-phase: old project was under Lovable's account (inaccessible
  via CLI/MCP); new project `vgascqdmcgffopilfktu` is under the HarryCB23 org.
- `classify-queries` deployed to new project via `npx supabase functions deploy`.

### Phase 2 — Schema & persistence ✅ complete (2026-05-23) — smoke-tested ✅

- [x] Migrate all tables in section 3. RLS on everything.
      **Migration:** `supabase/migrations/20260523000002_phase2_schema.sql`
      Applied to `vgascqdmcgffopilfktu` via Supabase MCP.
      Includes: `get_my_org_ids()` RLS helper, `projects`, `imports`, `queries`,
      `import_queries`, `classifications`, `serp_snapshots`, `risk_weights`,
      `risk_scores`, `keyword_metrics`, `jobs`.
      **serp_snapshots unique index:** functional `(captured_at::date)` not allowed
      (STABLE, not IMMUTABLE) — fixed by adding `captured_date date` column instead.
      Rollback: `supabase/migrations/rollbacks/20260523000002_rollback.sql`
- [x] Refactor CSV upload to persist via `imports` + `import_queries`.
      **Edge function:** `supabase/functions/ingest-csv/index.ts` (verify_jwt = true).
      Server-side membership check, SHA-256 query dedup, 2 000-row batch inserts.
      25 000-row soft advisory warning in UI.
- [x] Build project selector UI. Each upload tied to a project.
      **New pages:** `ProjectSelector`, `ProjectOverview`, `ProjectSettings`, `ImportView`.
      **New component:** `CreateProjectDialog` (client_name, domain, branded_terms).
      **Route tree:** `/projects`, `/projects/:id`, `/projects/:id/settings`,
      `/projects/:id/imports/:importId`. Root `/` redirects to `/projects`.
- [x] Fix CSV parsing bugs: locale-aware decimal parsing, header-name based column mapping.
      **Shared module:** `supabase/functions/_shared/csvParser.ts` (Deno-native).
      **Tests:** `supabase/functions/_shared/csvParser.test.ts` (14 test cases).
      CTR stored as fraction (0.025 = 2.5 %) in DB; UI multiplies by 100.
- [x] Fix position math: treat missing/zero as `null`, exclude from weighted averages.
      **Fix in:** `src/pages/Index.tsx` (Commit E) and `src/pages/ImportView.tsx`.
      Weighted average now uses only rows where position is non-null, with those
      rows' impressions as the denominator. CTR null-guarded in CSV download.

#### Phase 2 deviations / decisions
- Dev/prod isolation: single project with `BEGIN/COMMIT` migration hygiene + rollback
  files. No separate dev project at this stage (no live client data yet).
- `queries` table is global (not org-scoped) to avoid duplicate Phase 3 AI-classification
  work for queries that appear across multiple projects.
- `serp_snapshots` unique index uses a `captured_date date` column rather than a
  functional expression on `captured_at`, because `timestamptz::date` is STABLE not
  IMMUTABLE and cannot appear in a standard unique index.
- `risk_weights` single-active constraint: partial unique index `WHERE active = true`
  (enforces at most one active row at DB level).
- Branded terms removed from ImportView inline editor; directed to Project Settings
  to keep ImportView read-only from a data perspective.
- `migrations/README.md` added: documents `BEGIN/COMMIT` and rollback conventions.

#### Phase 2 smoke test log (2026-05-23)
11-step test sequence executed and confirmed:
1. `/projects` loads (empty state) — no errors in console ✓ (verified after deploy)
2. "New project" dialog opens — 3-field form renders ✓
3. Create project "Test Client" / "testclient.com" / branded terms "testbrand" — saves,
   card appears in project list ✓
4. Click project card — `/projects/:id` loads with upload dropzone ✓
5. Drop a 5-row GSC CSV — 25k advisory not shown (under limit); spinner shows,
   navigates to `/projects/:id/imports/:importId` ✓
6. Import analysis page loads — all 5 queries visible in QueryTable ✓
7. Verify CTR displayed as percentage (not fraction) ✓
8. Verify weighted-average position not NaN ✓
9. Navigate to Project Settings — edit branded term, save, return to ImportView —
   branded term applied in reclassification ✓
10. `supabase SQL: select count(*) from import_queries` — count matches row count ✓
11. Log out and visit `/projects` — redirected to `/login` ✓

### Phase 3 — Claude classification
- [ ] Build `classify-batch` edge function: submits to Claude Batch API.
- [ ] Build `claude-webhook` edge function: receives results, upserts `classifications`.
- [ ] Implement tool-use schema per section 4. Prompt caching enabled.
- [ ] Implement cache hit lookup before submitting.
- [ ] Build eval set (`src/test/classification.eval.ts`) covering the false-positive cases. CI runs eval on every PR touching prompts.
- [ ] Delete `queryClassifier.ts` keyword lists; pattern matcher only used pre-LLM if cache hit.
- [ ] UI: classification status badge, model_version visible, manual re-classify button.

### Phase 4 — DataforSEO enrichment
- [ ] Build `serp-enrich-batch` and `dataforseo-webhook` edge functions per section 5.
- [ ] Add DataforSEO credentials to Supabase secrets.
- [ ] Per-project location_code + device config in UI; `domain` + `alt_domains[]` populated for publisher presence matching.
- [ ] Implement eTLD+1 domain matcher (use `psl` library or equivalent).
- [ ] Cache hit lookup before enrichment.
- [ ] Daily budget enforcement.
- [ ] Build `fetch-keyword-metrics` edge function for Keyword Difficulty + Search Volume (separate refresh cadence, longer TTL).
- [ ] UI: SERP feature badges on query table, filter by feature, publisher presence indicators per surface.

### Phase 4.5 — Pixel-displacement via SERP Screenshot ❌ CLOSED AS INFEASIBLE

#### Finding

The DataforSEO Screenshot endpoint (`/v3/serp/screenshot/*`) returns **PNG images**, not
structured per-element pixel coordinates. The `rectangle` field exists in the organic
Advanced SERP response schema but is **never populated** — verified across:

- 3 fixtures (aio_heavy, news_ts, mixed) via `task_get/advanced` — 0 non-null rectangles
  across 42 items (mobile + desktop, both tested)
- All screenshot-specific endpoint paths return 404 or 40402 ("Invalid Path")
- `screenshot:1` parameter on the organic endpoint is silently accepted (20100) but
  produces identical null-rectangle results — no effect
- `/v3/appendix/user_data` confirms `serp.screenshot daily_limit: 0` — product disabled
  on this account plan

There is no DataforSEO endpoint that provides automated per-query y-coordinates for
SERP elements. The linear CTR-scaling model and the pixel-based AIO-above-TS rule both
require data that does not exist as a queryable structured source from this provider.

#### Outcome

**Phase 5 flat-tier model (75%/15%/0%) is the final v1 risk model**, grounded in
published CTR studies. Linear CTR scaling within tiers is deferred indefinitely pending
a viable structured-pixel data source (e.g., a custom headless-browser pipeline).

One deliverable from Phase 4.5 **was** shipped: the AIO+TS co-occurrence rule — using
`rank_absolute` order as a visual proxy (AIO always renders at rank 1, Top Stories at
rank 1–3; fixture investigation confirmed AIO rank_absolute=1 on "what is inflation").
This is a zero-infrastructure change to `tierOf()`: `has_ai_overview AND has_top_stories → Medium`.

#### Schema outcome

- `serp_jobs.task_type` — **KEPT**. Future-proofs other task types; harmless default `'organic'`.
- `serp_snapshots.aio_pixel_y`, `top_stories_pixel_y` — **DROPPED** (migration
  `20260529000002_drop_unused_pixel_y_columns`). Unpopulatable; leaving them creates
  permanent confusion ("why are these always null?").
- `serp_snapshots.pixels_above_first_organic`, `publisher_pixel_height` — **KEPT** nullable.
  These pre-existed from Phase 4 and reflect a real-but-deferred concept; they slot in if a
  CV pipeline ever materialises.

#### Fixtures retained

`src/test/fixtures/screenshot/{aio_heavy,news_ts,mixed}.json` — kept as response-shape
reference. If the screenshot product is ever activated (account upgrade), these fixtures
confirm the item structure the parser should expect, with rectangles currently null.

### Phase 5 — Traffic Risk scoring ✅ SHIPPED

#### Model evolution (retro)

Three models were evaluated before landing on the shipped design:

1. **Additive 0–100 score** _(rejected before shipping)_ — `risk_scores` / `risk_weights`
   tables + `compute-risk-scores` edge function built from a draft brief. Rejected because
   arbitrary weight values produce an uninterpretable number and it conflates features that
   have very different click-removal magnitudes. Tables dropped in
   `20260528000002_drop_premature_phase5_tables.sql`.

2. **Multiplicative intensity** _(rejected after prototyping)_ — `hostile_weight = 1 − Π(1 − wᵢ)`
   with a `position_mult` (0.30–1.00 based on organic rank). Rejected because the
   position multiplier buried AIO queries in Medium when the publisher ranked poorly —
   precisely the queries that most need a High signal. Also produced a 0-High bucket
   (no queries reaching ≥ 0.50 intensity) on a real corpus, making the High tier
   meaningless in practice.

3. **Tiered CTR-drop** _(shipped)_ — tier assigned by priority rules, then a fixed CTR-drop
   percentage applied to clicks_current. Won because: (a) interpretable — "AIO present,
   estimated 75% CTR loss" explains itself to a consultant; (b) grounded in published
   CTR research (AIO ~75% organic drop); (c) correctly surfaces every AIO query in High
   regardless of publisher position; (d) latent/recurring metric falls out naturally from
   clicks_previous without extra modelling.

#### Locked tier model (client-side, no DB storage in v1)

**Priority order — first match wins** _(updated Phase 4.5 close-out: AIO+TS co-occurrence rule added)_:

| Priority | Condition | Tier | CTR-drop |
|---|---|---|---|
| 1 | `has_ai_overview ∧ has_top_stories` | Medium | 15% |
| 2 | `has_top_stories` (no AIO) | Low | 0% |
| 3 | `has_ai_overview` (no TS) | High | 75% |
| 4 | `has_video ∨ has_local_pack ∨ has_shopping ∨ has_featured_snippet` | Medium | 15% |
| 5 | else (clean SERP) | Low | 0% |

AIO+TS co-occurrence → Medium: AIO always renders at `rank_absolute=1` (confirmed in
fixtures), above the Top Stories carousel. The carousel still distributes publisher content,
but AIO cannibalises enough clicks to push the query out of the Low tier. `rank_absolute`
order is the proxy for vertical position; no pixel data needed.

Top Stories alone (no AIO) → Low unconditionally. A news SERP with Top Stories but no
AIO is publisher-friendly; the publisher is distributed via the carousel.

Medium CTR-drop (15%) remains a reasonable placeholder. Phase 4.5 pixel-displacement work
was closed as infeasible (DataforSEO Screenshot product disabled on this account; `rectangle`
field always null; `daily_limit: 0`). The 15% figure is not measured but is conservative
and directionally correct for rich-SERP layouts.

**Per-query outputs:**
```
estLostCurrent = clicks_current × ctrDrop
estLostLatent  = clicks_previous × ctrDrop   (only when clicks_current = 0 AND clicks_previous > 0)
```

**Project / category composite:**
```
blendedComposite = (aiLost + serpLost) / Σ clicks_current   (scored queries only)
aiComponent      = aiLost   / Σ clicks_current
serpComponent    = serpLost / Σ clicks_current
```

Latent/recurring metric: queries with `clicks_current = 0` and `clicks_previous > 0` on
at-risk SERPs are surfaced separately — these are dormant queries (often news) that drove
traffic in the previous period and may resurface.

#### Implementation (all shipped)

- [x] `src/lib/riskScoring.ts` — `tierOf()`, `scoreQuery()`, `aggregateRisk()`, `aggregateByCategory()`; CTR_DROP constants; fully typed
- [x] `src/test/risk-scoring.test.ts` — 26 unit tests covering all tier rules, estLost maths, latent logic, composite arithmetic, coverage stats
- [x] `src/components/RiskSummaryTab.tsx` — hero composite, AI/SERP composition line, tier breakdown table, latent callout, category breakdown
- [x] `src/components/QueryTable.tsx` — Est. Lost column, TierBadge chip, sortable by estLost
- [x] `src/pages/ImportView.tsx` — Risk Summary tab; paginated SERP snapshot fetch

#### Bugs caught this phase

1. **1000-row fetch cap (silent data truncation):** PostgREST `max_rows=1000` overrides
   `.range(0, 9999)` — the single-call range fix was silently capped at 1000 rows,
   returning only 54% of SERP data (1000/1867 snapshots). Fixed with a paginated loop
   (`.range(from, from + PAGE - 1)`, break when `data.length < PAGE`).
   Affected: AI Surfaces tab and Risk Summary tab both showed wrong counts until fixed.

2. **AIO / Top Stories tier-priority inversion:** `tierOf()` initially checked
   `has_ai_overview` before `has_top_stories`, classifying 28 co-occurrence queries at
   location 1006886 as High instead of Low. Fixed by moving the Top Stories check first
   in `tierOf()`. UI Tier Logic explainer card was always correct; the code lagged behind.

#### Finding: News/Entities bifurcation

At location 1006886, 1508 news queries split into:
- **~34% breaking news** — Top Stories present → Low tier (publisher distributed via carousel)
- **~18% AIO-exposed** — AI Overview, no Top Stories → High tier (evergreen/encyclopedic queries
  where Google answers directly: "russo-ukrainian war", "israel hamas war", "imran khan news")
- **~48% medium / other** — video, PAA-heavy, or clean SERPs

This bifurcation — breaking-news (Top Stories protected) vs evergreen-entity (AIO-exposed) —
is a meaningful sub-split within the News category. **Candidate for a later phase:**
auto-classify news queries as `news_breaking` vs `news_evergreen` based on Top Stories
presence and use this to set editorial priority in the risk view.

#### Phase 6+ candidates (NOT in v1)
PAA presence (`has_paa`), Knowledge Graph (`has_knowledge_graph`), publisher presence
in PAA/KG (`publisher_in_paa`, `publisher_in_knowledge_graph`, `publisher_in_video`),
measured pixel-displacement CTR drops replacing the 15% PROVISIONAL medium figure
(Phase 4.5), breaking-vs-evergreen news sub-split, CTR-decline volatility,
weight tuning UI, DB-stored scores, materialised aggregations.

### Phase 6.1 — Overview tab + cleanups ✅ CLOSED

#### Scope shipped

- **Overview tab as default landing** (`?tab=overview`). Sections:
  - **B2 Hero composite** — blended click-loss %, AI vs SERP component split, 4 sub-metrics
    (coverage, latent queries, AIO exposure, Top Stories exposure).
  - **B3 News SERP-state panel** — Top Stories-protected vs exposed, clicks-weighted %,
    low-coverage caveat, temporal framing ("right now" snapshot, not stable classification).
  - **B4 Top 8 loss queries** — sorted by `estLostCurrent` descending; tier chip + category badge.
  - **B5 Latent/recurring risk callout** — amber card; queries with zero current clicks but
    non-zero previous clicks on at-risk SERPs.
  - **B6 Category breakdown** — compact horizontal bars sorted by est. lost clicks;
    click-to-navigate into Queries tab with category pre-filtered.
  - Empty state guard when `coverage.scored === 0` (no SERP enrichment yet).

- **Cleanups:**
  - Supabase types regenerated from live schema (`generate_typescript_types`); `tsc --noEmit`
    clean. Key change: `serp_jobs.task_type` added, `aio_pixel_y`/`top_stories_pixel_y` absent.
  - AI Surfaces 1000-row cap — **verified fixed** (paginated fetch was already patched in Phase 5;
    AI Surfaces reads from the same `serpSnapshots` Map and inherits the fix). Confirmed
    1868/1868 snapshots loading correctly at the STOP 1 checkpoint.
  - `ingest-csv` single-period header detection — **verified correct** (parser already handled
    plain `Clicks`/`Impressions`/etc. headers via `detectColumn` fallback). Deliverable was
    3 new Deno unit tests + 1 synthetic CSV fixture confirming the behaviour, not a code fix.

- **Test count after Phase 6.1: 71 Vitest + 24 Deno = 95 total**
  - Vitest: example (1), overview (11), risk-scoring (27), serp-parser (32) — all passing.
  - Deno: csvParser (24, includes 3 new single-period tests added this phase).

#### Key decision logged: breaking vs evergreen news bifurcation — dropped

Considered auto-classifying news queries as `news_breaking` (Top Stories present) vs
`news_evergreen` (AIO-exposed, no TS) as a stable sub-category. Dropped because:

Top Stories presence is Google's snapshot judgment of newsworthiness at enrichment time,
not a stable query attribute. A query like "Tom Cruise" can flip between Breaking and
Evergreen as news cycles change. Labelling it as a permanent classification would imply
stability the data does not have.

The insight survives as the **B3 news SERP-state panel** on the Overview tab — explicitly
framed as "right now" (a temporal observation, not a classification). The correct home for
observing the flip over time is Phase 6.3 (cross-import trends), where change between
enrichment snapshots can be visualised honestly.

### Phase 6.2 — Design system established + applied app-wide ✅ CLOSED

#### Scope shipped

**6.2a — Token foundation**
- Pure-grey neutral CSS variable system (no coloured shadows, no dark scaffold remnants).
- Custom tokens: `--risk`, `--tier-high/medium/low`, `--chart-risk/neutral/muted`.
- Governing rule established: **red = AI-driven risk only.** No green/orange/amber/purple/teal anywhere in the product.

**6.2b — Design system primitives (`/design` route)**
- `MetricCard`, `HeroNumber`, `TierDot`, `KPITile`, `TrendIndicator` (monochrome, weight encodes magnitude).
- `VerticalBarChart`, `GroupedVerticalBarChart`, `DonutChart`, `DataTable`.
- `/design` route is the living style guide. All tab rebuilds reference it.

**6.2c — Applied to all four tabs**
- **Overview** — rebuilt 6.2b (ref: closed).
- **Risk Summary** — full rebuild: MetricCard/HeroNumber/KPITile/DataTable/TierDot. Fixed pre-existing hooks-after-early-return violation. No amber/emerald/rose.
- **AI Surfaces** — full rebuild: Panel A grouped vertical bar (AIO red vs TS dark grey), Panel B KPITiles, Panel C DonutChart FS ownership. Ad-hoc colours removed.
- **Queries** — restyle: MetricCard+KPITile stats row, MetricCard chart sections, TierDot column, TrendIndicator for Δ cells, monochrome feature dots, no CategoryBadge.

**Opening cleanup**
- `expires_at` filter removed from `loadSerpSnapshots` — snapshots are point-in-time consultancy records, not perishable live data.

**6.2 sign-off refinements**
- AI Surfaces category filter label changed from placeholder "Filter B–D:" to "Filter by category:".
- Overview "Risk by category" chart switched from vertical (`VerticalBarChart`) to horizontal (`HorizontalBarChart`, new primitive) — auto-height from row count, full `CATEGORY_LABELS` on Y-axis, prevents News from crowding out smaller categories on the value axis.
- `HorizontalBarChart` added to `charts.tsx` (recharts `layout="vertical"`, Y-axis labels, right-side value `LabelList`, auto-height).

**Colour sweep outcome**
- `grep -rE "text-(amber|emerald|rose|orange|purple|teal|pink|blue)-[0-9]" src/` → 0 matches.
- `grep -rE "bg-(amber|emerald|rose|orange|purple|teal|pink|blue)-[0-9]" src/` → 0 matches.

#### Design system reference
- Primitives: `MetricCard`, `HeroNumber`, `TierDot`, `KPITile`, `TrendIndicator`, `VerticalBarChart`, `HorizontalBarChart`, `GroupedVerticalBarChart`, `DonutChart`, `DataTable`.
- All in `src/components/ui/metric-card.tsx` and `src/components/ui/charts.tsx`.
- Token reference: `src/index.css` `:root` block.
- Living style guide: `/design` route (dev only, no auth guard).

#### Phase 6.2d polish candidates (identified after seeing all four tabs together)
- QueryTable virtualisation for >1 000 rows (currently paginates at 100).
- Tier column sortability (added in 6.2c) exposes a UX gap: default sort is by clicks, not risk — may want risk-first default when SERP data is present.
- `CategoryBadge` is now monochrome; categories are distinguishable by label only. A subtle single-character prefix or icon treatment may aid scanning in the query table.
- Top competing domains panel in AI Surfaces could benefit from a DataTable treatment for consistency.

#### Phase 6.3 candidates (deferred — no immediate trigger)

- PDF / CSV export of risk analysis for client deliverables.
- Project-level summary across imports (depends on 6.3 data shape).

#### Phase 6.4 (deferred — blocked on data)

- Cross-import aggregation and trend over time.
- Requires a second GSC import on the same project to test meaningfully.
- Do not start until at least one real engagement has produced two imports.

---

### Phase 6 — Front-end polish at scale
- [ ] Virtualised `QueryTable`.
- [ ] Server-side sort/filter/paginate.
- [ ] Comparison view toggle.
- [ ] Realtime subscription to risk score updates during enrichment.
- [ ] Loading states, skeleton screens, optimistic UI.

### Phase 7 — GSC API integration
- [ ] Google OAuth flow with `webmasters.readonly` scope.
- [ ] Store encrypted refresh tokens in `projects.gsc_refresh_token`.
- [ ] Edge function: pull last 16 months of query data via GSC API.
- [ ] Scheduled refresh via `pg_cron`.

---

## 9. Testing approach

- **Unit:** classification eval set, scoring function, CSV parser (incl. locale variants), SERP feature extraction.
- **Integration:** edge functions tested with mocked Claude / DataforSEO responses.
- **E2E:** Playwright — upload CSV, wait for classification, assert risk scores appear.
- **Eval CI:** classification accuracy must not regress below 95% on the eval set for any PR touching prompts.

---

## 10. Environment variables (final list)

```bash
# Public (frontend)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

# Supabase secrets (Edge Function env)
ANTHROPIC_API_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
DATAFORSEO_WEBHOOK_SECRET=
SUPABASE_SERVICE_ROLE_KEY=    # for edge functions writing to DB
GOOGLE_OAUTH_CLIENT_ID=       # phase 7
GOOGLE_OAUTH_CLIENT_SECRET=   # phase 7
```

Document all of these in `.env.example`.

---

## 11. Out of scope for v1 (note for later)

- **AI content-licensing valuation** — handled in a separate tool combining crawl frequency × business value of lost traffic. Query Compass surfaces `ai_surface_flag` per query for that tool to consume; nothing more.
- Real-time multi-user collaboration on a project
- Team management beyond simple memberships
- Billing / Stripe
- White-label / multi-org-per-user
- Historical SERP trending (we only store latest snapshot per `(query, location, device, day)`)
- Custom risk weights per client (the weights table supports it, but the UI doesn't ship in v1)

---

## Notes for Claude Code

- Use `bun` as the package manager (bun.lockb is present and committed).
- All Edge Functions should be Deno-compatible TypeScript with strict typing.
- Migrations go in `supabase/migrations/` with timestamped filenames.
- Use Supabase CLI (`npx supabase`) for local dev, including local Postgres for testing.
- Don't touch the `lovable-tagger` plugin in vite.config — keeping Lovable round-trip working is useful for UI tweaks.
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`).
- Always run the classification eval before merging anything that touches prompts.

---

## Phase 2 Retrospective — ingest-csv bugs and lessons

**Summary:** The `ingest-csv` edge function went through 10 deployed versions across one session to reach a fully working state. Every bug was caused by an assumption that held in a browser/Node context but failed in Deno's edge function sandbox or against Supabase's hosted PostgREST. None of the bugs were subtle logic errors — all were infrastructure-layer surprises that a pre-flight checklist would have caught.

### The 8 bugs, in order of discovery

| # | Bug | Root cause | Fix |
|---|-----|-----------|-----|
| 1 | All authenticated requests returned 401 | `supabase.auth.getUser()` called without JWT argument; Deno has no session storage so it always returns null in a server context | Pass extracted token directly: `auth.getUser(jwt)`, then replaced with a direct `fetch(/auth/v1/user)` to avoid instantiating a second client |
| 2 | `WORKER_RESOURCE_LIMIT 546` — memory OOM on every CSV upload | `while (i <= line.length)` off-by-one in `tokeniseLine`: at `i === line.length`, `line[i]` is `undefined`, the else branch pushes `''` without incrementing `i`, outer condition still true — infinite loop fills `fields[]` until 150 MB OOM | Changed to `while (i < line.length)` |
| 3 | Speculative: O(n²) `.find()` in the hot path | When chasing the OOM, a potential quadratic lookup was pre-emptively replaced with a `Map` for O(1) lookup | Not the actual cause of OOM, but correct regardless |
| 4 | Speculative: unbounded `Promise.all` concurrency | When chasing the OOM, SHA-256 hashing over N rows in one `Promise.all` was chunked to 100 at a time | Not the actual OOM cause, but correct for large files |
| 5 | All metric columns null after successful upload | `HEADER_ALIASES` exact-match map silently dropped GSC date-range headers: `"Last 28 days Clicks"`, `"Same period last year Clicks"`, etc. — none of those strings appear in the alias map | Replaced alias map with substring-based `detectColumn()`: match on `includes('clicks')`, classify as previous if header contains `previous / same period / last year / yoy` etc. |
| 6 | `"Failed to fetch query IDs"` 500 after v7 | PostgREST `.in()` builds a GET URL; 1,867 SHA-256 hashes = ~130 KB URL — Deno's `fetch()` rejects with `TypeError: Invalid URL` | Chunk the `.in()` fetch to 500 hashes per request (FETCH_CHUNK = 500) |
| 7 | Fetch still 400ing at FETCH_CHUNK = 500 | Cloudflare sits in front of Supabase PostgREST and enforces an 8 KB URL limit; 500 hashes × 67 chars = ~33 KB → 400 Bad Request | Reduce FETCH_CHUNK to 100 (100 × 67 chars ≈ 6.7 KB — safely under Cloudflare's 8 KB limit) |
| 8 | ImportView shows max 1,000 rows despite `.limit(50_000)` in query | PostgREST has a server-side `max_rows` cap (default 1,000 on Supabase) that overrides the client `.limit()` call entirely | Replace single `.limit()` fetch with paginated `.range()` loop: fetch 1,000 rows per request until page returns < 1,000 rows |

### Complexity checklist for Phases 3–6

All future phases involve processing row-volume data (classifications, SERP results, risk scores). Before writing any function that iterates over rows, verify:

1. **O(1) lookups only.** Build a `Map<key, value>` before the loop; never call `.find()`, `.filter()[0]`, or object property lookup inside a per-row loop. O(n²) on 25k rows will OOM or time out.

2. **Bounded `Promise.all` concurrency.** Never `Promise.all(rows.map(async r => ...))` over a large array. Chunk to at most 100 concurrent promises and `await` each chunk before starting the next.

3. **URL length when using PostgREST `.in()`.** Each SHA-256 hash is 64 chars; URL-encoded commas add ~3 chars each. At 100 items per batch the URL is ~6.7 KB — under Cloudflare's 8 KB proxy limit. **Hard cap: 100 items per `.in()` call.**

4. **Header detection: substring/regex, not exact-match alias tables.** GSC export headers vary by date range and locale ("Last 7/28/90/365 days Clicks", "Clics des 28 derniers jours", etc.). An alias table will silently miss variants. Use `includes()` or regex pattern matching.

5. **Supabase select default is 1,000 rows.** The PostgREST server-side `max_rows` cap (1,000) overrides any client `.limit()` call. Any list view that can return > 1,000 rows **must** use a paginated `.range()` loop, not `.limit()`.

6. **Deno auth context.** `supabase.auth.getUser()` always returns null in Deno edge functions — there is no session storage. Always pass the JWT explicitly: `auth.getUser(token)` or verify via a direct `fetch(/auth/v1/user)` with the token in the Authorization header.

---

## Appendix A — Live schema (supersedes section 3 where they differ)

The schema applied to `vgascqdmcgffopilfktu` via migration `20260523000002_phase2_schema.sql` differs from the section 3 spec in three places. **This appendix is the authoritative reference for Phases 3–7. Section 3 is retained for context only.**

### Divergence 1 — `queries` primary key

| | Section 3 spec | Live schema |
|---|---|---|
| PK | `query_hash text PRIMARY KEY` | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| Unique | _(PK was hash)_ | `query_hash text NOT NULL UNIQUE` |

**Decision made:** keep the live schema. UUID PKs are the Supabase default and FK references from `import_queries`, `classifications`, `serp_snapshots`, `keyword_metrics` all use `query_id uuid`. Changing to a hash PK would require a new migration touching five tables. The `query_hash` unique constraint provides the same dedup guarantee. All Phases 3–7 reference `queries.id` (UUID) as the FK target.

### Divergence 2 — `imports` period columns

| | Section 3 spec | Live schema |
|---|---|---|
| Current period | `period_current_start date`, `period_current_end date` | `period_start date`, `period_end date` |
| Previous period | `period_previous_start date`, `period_previous_end date` | _(not present)_ |

**Decision made:** keep the live schema. The two-column form (`period_start`, `period_end`) is sufficient for Phase 2 CSV imports where neither bound is known. Previous-period date bounds can be added as nullable columns in a Phase 7 migration when GSC OAuth imports supply them. Do not reference `period_current_*` or `period_previous_*` in any new code.

### Divergence 3 — `queries` language column

| | Section 3 spec | Live schema |
|---|---|---|
| Language | `language text` | _(column not present)_ |

**Decision made:** omit for now. Language detection adds a dependency (e.g. `franc` or a Claude call) with unclear v1 value. Add via a zero-downtime `ALTER TABLE queries ADD COLUMN language text` migration in Phase 3 if the classification prompt needs it. Do not assume this column exists.

### Full live schema summary (key tables)

```sql
-- queries (global deduplicated bank)
id           uuid        PK
query_text   text        NOT NULL
query_hash   text        NOT NULL UNIQUE   -- sha256(lower(trim(query_text)))
created_at   timestamptz NOT NULL DEFAULT now()

-- imports (one row per CSV/GSC upload)
id           uuid        PK
project_id   uuid        FK → projects.id
file_name    text
source       text        CHECK (csv | gsc)
period_start date                          -- NULL for CSV (date range unknown)
period_end   date                          -- NULL for CSV
row_count    int
created_at   timestamptz NOT NULL DEFAULT now()

-- import_queries (join: import ↔ query, with per-row metrics)
id                   uuid        PK
import_id            uuid        FK → imports.id  ON DELETE CASCADE
query_id             uuid        FK → queries.id
clicks_current       int
impressions_current  int
ctr_current          numeric(6,4)   -- fraction: 0.0250 = 2.5 %
position_current     numeric(6,2)
clicks_previous      int
impressions_previous int
ctr_previous         numeric(6,4)
position_previous    numeric(6,2)
UNIQUE (import_id, query_id)
```

All other tables (`classifications`, `serp_snapshots`, `risk_weights`, `risk_scores`, `keyword_metrics`, `jobs`) match section 3 exactly.

---

## Phase 3 Retrospective — Claude classification iterations and lessons

**Summary:** Phase 3 took the classification from a keyword/pattern system to a fully LLM-driven pipeline. The path required four prompt versions, a root-cause fix for a production timeout, and a discovered UI bug at the very end. Every issue was caused by an implicit assumption about how Claude would respond, or about how data would flow between the edge function and the frontend.

### The four prompt iterations

#### v0 — Pattern/keyword classifier (pre-Phase 3, in use at end of Phase 2)

Simple JavaScript regex + keyword lists. Branded terms filtered first via exact/partial match; remaining queries assigned a category by checking for presence of words like "how", "best", "buy", "vs". No entity understanding, no context.

**Structural weakness:** every rule was a positive match — if nothing matched, the query fell through to `other`. This meant any query the author hadn't anticipated was silently wrong.

---

#### v1 — Initial Claude implementation

Introduced Claude Haiku via the Messages API with `tool_choice: any` and a `classify_query` tool. System prompt established the six categories with basic definitions. Tool schema required Claude to echo back the original query text as `query: string`, which was then matched against the input array by string equality.

**What v1 revealed (false positives from production data):**

- `"how to rank on google news"` → classified as `news` (the word "news" triggered it)
- `"crawl budget for large sites"` → classified as `news` ("budget" matched budget-cycle news pattern)
- `"google discover analysis"` → classified as `news` ("Discover" is a Google product, not a news concept)
- `"commodity vs non commodity content"` → classified as `commercial` ("vs" triggered product-comparison rule)

These were discovered when the first real Telegraph CSV was run and the `other` bucket was inspected manually. v1's category definitions lacked explicit exclusions for SEO-tool queries and abstract-concept comparisons.

---

#### v2 — False-positive fixes

Rewrote category definitions to add explicit disambiguation rules:

- SEO tools, Google products, SEO strategies → **informational** even if "news" or "discover" appears in the name (Rule 2)
- "vs" between abstract content concepts → **informational**; "vs" between named products → **commercial** (Rule 3)
- News queries require both a named entity AND a news/event signal (Rule 1)

Also added the `PROMPT_VERSION` constant and `prompt_version` column on `classifications` so re-runs could coexist with old data.

**What v2 revealed (production run on 1,867-query CSV):**

- **504 IDLE_TIMEOUT** on the edge function. Root cause (found post-mortem): queries containing embedded double quotes (e.g. `russia "evading draft" claims`) caused Claude's echoed `query` string to come back with escaped or typographic quotes that didn't match the plain-ASCII input. The string-equality match failed → the retry loop fired three times per failed query → cumulative wall-clock time exceeded the 30-second edge function limit.
- **`other` bucket still large (640 queries).** Bare named entities like `trump`, `iran`, `harry clarkson bennett` were falling into `other` because v2 required a news signal alongside the entity. Publisher context was being ignored: on a news site, a bare entity name is a news query.

---

#### v3 — Index-based matching + publisher-context rules

Two structural changes and two new prompt rules:

**Structural: index-based tool schema.** Replaced `query: string` with `query_index: integer` (1-based position in the numbered list). Claude now returns a position number, not echoed text. Matching is `tu.query_index - 1` array index — immune to any characters in the query string. The retry loop for incomplete responses was also removed; missing indices now default to `other` with a `console.warn` (non-transient, retrying never helps).

**Structural: CHUNK_SIZE 250 → 150.** Defensive reduction to keep each edge-function invocation well inside the 30-second wall-clock limit even if Claude is slow on a batch.

**Rule 5 — bare named entities → news.** `PERSON`, `PLACE`, `ORGANIZATION` entities with no other intent modifier → `news` with that entity extracted. Rationale: this tool serves news publishers; someone searching a bare entity name on a news publisher's site is looking for news content. Exceptions: bare PRODUCT name → `product`; bare WORK title → `other`; entity + commercial modifier → `commercial`; entity + informational modifier → `informational`.

**Rule 7 — generic news-intent keywords → news.** `"latest news"`, `"breaking news"`, `"world news"`, `"headlines"` → `news` even with no named entity. Search intent is explicitly news-seeking.

**v3 eval results (81 labelled cases):**
- Raw accuracy: 93.8% (76/81)
- After correcting two stale eval labels (both v3 rule 5 reclassifications): 96.3% (78/81)
- 3 genuine model errors remaining: `interest rates bank of england` (model: news, label: informational), `seo` and `content marketing` (model: informational, label: other)

**Final DB state after v3 production run:** 1,816 queries at `claude-haiku-4-5-20251001 / v3`; 51 at `pattern / v0` (branded). Distribution: 1,508 news (80.8%), 167 other (8.9%), 111 informational (5.9%), 51 branded (2.7%), 26 product (1.4%), 4 commercial (0.2%).

---

### The UI merge bug — cross-version row leakage

After the v3 production run, the ImportView classification breakdown was showing inconsistent counts. Investigation found that the `classifications` table contained **both v2 and v3 rows** for each query — the first run had created v2 rows, the second run upserted v3 rows alongside them (the upsert key was `(query_id, model_version, prompt_version)`, so different `prompt_version` values create separate rows rather than replacing).

`loadClassifications` was selecting `classifications.*` with no `prompt_version` filter. With multiple rows per `query_id`, the join was returning whichever row PostgREST happened to return first — non-deterministic across refreshes.

**Two-part fix:**

1. **DB cleanup:** `DELETE FROM classifications WHERE prompt_version = 'v2'`. Confirmed via `SELECT model_version, prompt_version, COUNT(*) FROM classifications GROUP BY 1, 2` — only `v3 / 1816` and `v0 / 51` remained.

2. **UI filter:** `loadClassifications` now adds `.or('prompt_version.eq.${CLASSIFIER_PROMPT_VERSION},model_version.eq.pattern')` so it reads exactly the current prompt version plus the pattern-matched branded rows. The constant `CLASSIFIER_PROMPT_VERSION` lives in `src/lib/classifierVersion.ts` and must stay in sync with `PROMPT_VERSION` in `claudeClassifier.ts` — both are annotated with a comment to this effect.

**Lesson:** any pipeline that can produce multiple rows for the same logical entity (query + model + version) must filter reads to the intended version explicitly. A missing `WHERE prompt_version = ?` is a silent correctness bug — counts and distributions look plausible but are wrong.

### Phase 3 complexity checklist addendum

Beyond the Phase 2 checklist (URL lengths, pagination, auth context), Phase 3 adds:

1. **Never match LLM output to input by string equality.** Use a positional index (1-based integer) or a stable UUID assigned before the call. Any transformation Claude applies to echoed text — escaping, typographic quotes, truncation — will silently break string matching.

2. **Remove retry loops for non-transient failures.** If Claude doesn't return a result for a given query, re-calling the same prompt won't help — it's a model behaviour, not a transient error. Default gracefully and log the miss. Reserve retries for HTTP 429/5xx only.

3. **Filter DB reads to the current prompt version.** When a pipeline can produce multiple rows per entity across versions, every read must include a `prompt_version = ?` filter. The upsert key must also be scoped by version to allow coexistence during a migration window.

4. **Keep prompt version constants co-located and annotated.** A version string that must match across two files (edge function + frontend) will drift unless both files carry a comment pointing to each other. Add the sync comment when you create the pairing, not after the first drift.

---

## Appendix B — Forward-looking design notes

These notes capture design decisions made during Phase 2 and Phase 3 that should inform Phase 4–6 implementation. They are not specifications — the details will be worked out phase by phase — but they reflect constraints discovered in production that would be expensive to design around later.

### Three-tab UX direction (Phases 4–6)

The current ImportView is a single flat table of queries with classification badges. As SERP enrichment and risk scoring land in Phases 4 and 5, the page will need to surface three distinct datasets without overwhelming the consultant:

| Tab | Contents | Primary Phase |
|-----|----------|---------------|
| **Queries** | Query table with classification, GSC metrics, risk score, SERP feature badges. Sort/filter by category, risk tier, SERP feature presence. | Phase 5 |
| **SERP Analysis** | Per-query SERP breakdown: which features appeared, publisher presence per surface, competitive domain landscape. Entry point for drilling into a specific query's SERP. | Phase 4 |
| **Risk Summary** | Project-level headline metrics (Clicks at risk, Zero-click exposure %, AIO citation rate, Top Stories capture rate). Category and entity risk breakdowns. Weight tuning (admin). | Phase 5 |

**Implication for Phase 4:** the SERP enrichment UI doesn't need to live inside the query table. Design it as a separate tab from the start; retrofitting a tab system onto a flat page is significantly more disruptive than building it with tabs initially.

### Per-row SERP summary fields vs raw JSON split

The `serp_snapshots` table stores `raw_response JSONB` (full DataforSEO response) alongside a set of pre-extracted boolean/integer summary columns (`has_ai_overview`, `has_featured_snippet`, `publisher_in_ai_overview`, etc.).

**The split is intentional and must be preserved:**

- Summary columns are used for all UI display, filtering, sorting, and risk-score computation. They are indexed. They are cheap to read.
- `raw_response` is never read by the application in normal operation. It exists so that when we need a new field from the DataforSEO response (e.g. a new SERP feature type, a deeper reference field), we can re-parse without re-querying DataforSEO. DataforSEO responses are rich and not fully predictable.

**Do not read `raw_response` in any query that runs per-row or per-page-load.** Only read it in a one-off migration or backfill job. If a new SERP field is needed, add it as a summary column via migration and backfill from `raw_response` in a batch job.

**Indexing guidance:** index `has_ai_overview`, `has_featured_snippet`, `has_top_stories` as individual boolean columns (partial indexes `WHERE has_ai_overview = true` are efficient for low-cardinality columns). Do not index `raw_response` — GIN indexes on large JSONB columns are expensive to maintain.

**Additional summary columns planned for Phase 4** (meet the graduation criteria above):

- `pixels_above_first_organic` `integer` — total vertical pixel height of search box, ads, and all SERP features rendered above the first organic result. This is a risk-scoring input: it gives the precise magnitude of feature displacement, superseding the binary `has_ai_overview` flag as the primary risk measure when both are available. Sourced from DataforSEO Advanced per-element `rectangle` data. Computed at webhook-receipt time; do not re-derive per query from `raw_response`.

- `publisher_pixel_height` `integer, nullable` — vertical pixel position (top edge) of the publisher's first organic result on the page, or `null` if the publisher is not on page 1. This is a visibility metric only — descriptive context for the consultant, not a risk-score input. Also sourced from per-element `rectangle` data, computed at webhook time.

### AI-Risk vs AI-Visibility separation (Phase 5)

The risk scoring model (section 6) is a single 0–100 traffic-risk score. As the product matures, there is a natural split into two separate axes that consultants will want to report independently:

**AI Traffic Risk** — "How much of this publisher's existing traffic is at risk from AI-generated answers?"
- Driven by: AIO presence, featured snippet ownership, knowledge graph, CTR decline at stable position
- Audience: editorial leadership, commercial teams — "how much business are we losing?"
- Export target: the main Query Compass deliverable

**AI Visibility** — "Is this publisher appearing as a source in AI-generated answers?"
- Driven by: publisher citation in AIO, publisher presence in PAA expanded answers, `ai_surface_flag`
- Audience: licensing discussions, brand teams — "are we being used without credit?"
- Export target: a separate AI content-licensing tool (noted in §11 out-of-scope); `ai_surface_flag` per query is the handoff interface

**Phase 5 implementation guidance:** build the single 0–100 risk score first (as specified in section 6). Store `components JSONB` on `risk_scores` so the score is fully decomposable. When the split is formalised, the visibility components (`aio_visibility_loss`, `publisher_in_aio`, `publisher_in_top_stories`) can be factored out of the existing components without recomputation. Do not conflate the two axes in the UI labelling — call the score "Traffic Risk" from day one, not "AI Risk" or "AI Score", so the split is clean when it arrives.

**Pixel height as a risk-input refinement, not a new axis.** `pixels_above_first_organic` is a continuous refinement of the feature-presence risk inputs — it makes "AIO is present" more precise by replacing the binary flag with "AIO consumes N pixels above organic". This sits entirely within the AI Traffic Risk axis: it measures displacement magnitude, not citation/visibility. The §6 weight `aio_click_loss` should be updated in Phase 5 to accept `pixels_above_first_organic` as a continuous input when available, falling back to the binary multiplier when it is null. `publisher_pixel_height`, by contrast, is pure visibility: it tells the consultant how far down the page their result appears, but carries no penalty in the risk formula.

**Phase 4.5 candidate — SERP Screenshot endpoint for pixel geometry.** DataforSEO's pixel/rectangle data (the `rectangle.y` field used for `pixels_above_first_organic` and `publisher_pixel_height`) is on a separate product: `/v3/serp/screenshot/*`. It is not available on `/v3/serp/google/organic/task_post` regardless of `postback_data` parameter or plan tier. The two columns exist in `serp_snapshots` and are always null in Phase 4. Phase 4.5 would add a second optional submission path: after the organic task completes, optionally submit a screenshot task for the same query and populate the pixel columns from its result. Cost implication: ~$0.0006/query additional, approximately doubling enrichment cost when enabled. Phase 5 risk scoring uses binary `has_ai_overview` as the AIO displacement input; pixel precision is a refinement the consultant can opt into once the cost is understood.
