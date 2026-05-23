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

### Phase 1 — Foundations & security
- [ ] Add `.env` to `.gitignore`, create `.env.example`, document required vars in README.
- [ ] Rotate Supabase keys (anon + service). Update Vercel/Lovable env.
- [ ] Add `verify_jwt = true` to `classify-queries` OR add shared-secret header check (whichever ships faster — JWT requires auth flow).
- [ ] Add basic Supabase Auth (email magic link) to the app. Gate `/` behind auth.
- [ ] Create `orgs`, `users`, `memberships` tables. Auto-create org on signup.

### Phase 2 — Schema & persistence
- [ ] Migrate all tables in section 3. RLS on everything.
- [ ] Refactor CSV upload to persist via `imports` + `import_queries`.
- [ ] Build project selector UI. Each upload tied to a project.
- [ ] Fix CSV parsing bugs: locale-aware decimal parsing, header-name based column mapping (not position).
- [ ] Fix position math: treat missing/zero as `null`, exclude from weighted averages.

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

### Phase 5 — Traffic Risk scoring
- [ ] `risk_weights` table seeded with v1 weights from section 6.
- [ ] `compute-risk-scores` edge function applies weights to (classification + SERP + metrics).
- [ ] Implement derived flags: `zero_click_risk`, `publisher_in_aio`, `publisher_in_top_stories`, `publisher_owns_fs`, `ai_surface_flag`.
- [ ] Materialised views for category, entity, profile aggregations.
- [ ] Headline metrics on project dashboard: **Clicks at risk**, **Zero-click exposure %**, **AIO citation rate**, **Top Stories capture rate**, **Average traffic risk**.
- [ ] UI: per-query risk score with component breakdown popover (transparency for consultants explaining numbers to clients).
- [ ] Per-query badges: 🔴 Zero-click, ✓ In AIO, ✓ In Top Stories, ✓ Owns FS.
- [ ] Weight tuning UI (admin only) — slider per weight, live re-score preview using stored `components` JSONB.

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

- Use `npm` (not bun) for consistency; remove `bun.lockb` from repo.
- All Edge Functions should be Deno-compatible TypeScript with strict typing.
- Migrations go in `supabase/migrations/` with timestamped filenames.
- Use Supabase CLI (`npx supabase`) for local dev, including local Postgres for testing.
- Don't touch the `lovable-tagger` plugin in vite.config — keeping Lovable round-trip working is useful for UI tweaks.
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`).
- Always run the classification eval before merging anything that touches prompts.
