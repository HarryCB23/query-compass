/**
 * riskScoring.ts — locked Phase 5 traffic-risk model.
 *
 * Formula (multiplicative, client-side, no DB storage in v1):
 *
 *   hostile_weight = 1 − Π(1 − wᵢ)   over present click-removing features
 *   feature_weight = has_top_stories ? hostile_weight × 0.30 : hostile_weight
 *     ↳ Top Stories = unconditional 70% relief, NOT a penalty
 *   position_mult  = pos 1–3→1.0 | 4–6→0.75 | 7–10→0.50 | null/other→0.30
 *   risk_intensity = feature_weight × position_mult   (0–1, volume-independent)
 *   at_risk_clicks = clicks_current × risk_intensity
 *
 * Weights are constants here — not stored in the DB (v1 design decision, locked).
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Click-removing SERP features and their independent weights. */
export const FEATURE_WEIGHTS = {
  has_ai_overview:      0.80,
  has_local_pack:       0.20,
  has_shopping:         0.20,
  has_featured_snippet: 0.10,
  has_video:            0.10,
} as const

/** Top Stories applies unconditional 70% relief to hostile_weight. */
export const TOP_STORIES_RELIEF = 0.30

/** Position multiplier lookup. Positions >10 are treated as absent (not ranking). */
export const POSITION_MULTIPLIERS = {
  top3:   1.00,  // 1–3
  mid:    0.75,  // 4–6
  bottom: 0.50,  // 7–10
  absent: 0.30,  // null or >10
} as const

/** risk_intensity thresholds for bucket assignment. */
export const BUCKET_THRESHOLDS = {
  high:   0.50,
  medium: 0.20,
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskBucket = 'high' | 'medium' | 'low'

/**
 * Minimal snapshot shape needed for scoring.
 * Compatible with (and a subset of) SerpSnapshotData from QueryTable.tsx.
 */
export interface SerpSnapshot {
  has_ai_overview:      boolean
  has_top_stories:      boolean
  has_featured_snippet: boolean
  has_video:            boolean
  has_local_pack:       boolean
  has_shopping:         boolean
  publisher_organic_position: number | null
}

export interface QueryScore {
  featureWeight:  number
  positionMult:   number
  riskIntensity:  number
  bucket:         RiskBucket
  atRiskCurrent:  number   // clicks_current × risk_intensity
  atRiskLatent:   number   // (clicks_previous ?? 0) × risk_intensity
  scored:         boolean  // false when snapshot is null (unenriched query)
}

export interface ScoredQuery {
  score:          QueryScore
  clicksCurrent:  number
  clicksPrevious: number | null
}

export interface AggregateRisk {
  /** Σ(atRiskCurrent) / Σ(clicks_current) for scored queries with clicks_current > 0. */
  currentComposite:       number
  pctCurrentClicksAtRisk: number   // same × 100
  /** Scored queries with riskIntensity > 0 / total scored. */
  pctQueriesAtRisk:       number
  /** null when there are no latent queries (single-period upload or none dormant). */
  latentComposite:        number | null
  latentQueryCount:       number
  /** Σ clicks_previous for latent queries (clicks_current=0, clicks_previous>0). */
  latentClicks:           number
  buckets: {
    high:   { queryCount: number; currentClicks: number }
    medium: { queryCount: number; currentClicks: number }
    low:    { queryCount: number; currentClicks: number }
  }
  coverage: {
    scored:         number   // queries with a snapshot
    total:          number   // all queries
    scoredClickPct: number   // % of clicks_current represented by scored queries
  }
}

// ── Core scoring function ─────────────────────────────────────────────────────

/**
 * Score a single query. Pass snapshot=null for unenriched (unscored) queries.
 * All zero-current-click queries are still scored if they have a snapshot.
 */
export function scoreQuery(
  snapshot: SerpSnapshot | null | undefined,
  clicksCurrent: number,
  clicksPrevious: number | null,
): QueryScore {
  if (!snapshot) {
    return {
      featureWeight: 0, positionMult: 0, riskIntensity: 0,
      bucket: 'low', atRiskCurrent: 0, atRiskLatent: 0, scored: false,
    }
  }

  // hostile_weight = 1 − Π(1 − wᵢ) over features that are present
  const hostileProduct = (Object.entries(FEATURE_WEIGHTS) as [keyof SerpSnapshot, number][])
    .reduce((prod, [key, w]) => snapshot[key] ? prod * (1 - w) : prod, 1)
  const hostileWeight = 1 - hostileProduct

  // Top Stories: unconditional 70% relief (multiplied, not subtracted)
  const featureWeight = snapshot.has_top_stories
    ? hostileWeight * TOP_STORIES_RELIEF
    : hostileWeight

  // Position multiplier
  const pos = snapshot.publisher_organic_position
  const positionMult =
    pos === null || pos > 10 ? POSITION_MULTIPLIERS.absent
    : pos <= 3               ? POSITION_MULTIPLIERS.top3
    : pos <= 6               ? POSITION_MULTIPLIERS.mid
                             : POSITION_MULTIPLIERS.bottom

  const riskIntensity = featureWeight * positionMult
  const bucket: RiskBucket =
    riskIntensity >= BUCKET_THRESHOLDS.high   ? 'high'
    : riskIntensity >= BUCKET_THRESHOLDS.medium ? 'medium'
    : 'low'

  return {
    featureWeight,
    positionMult,
    riskIntensity,
    bucket,
    atRiskCurrent: clicksCurrent * riskIntensity,
    atRiskLatent:  (clicksPrevious ?? 0) * riskIntensity,
    scored: true,
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** Aggregate scored queries into project-level (or category-level) metrics. */
export function aggregateRisk(queries: ScoredQuery[]): AggregateRisk {
  const scored  = queries.filter(q => q.score.scored)
  const total   = queries.length

  // ── Coverage ──────────────────────────────────────────────────────────────
  const totalClicks  = queries.reduce((s, q) => s + q.clicksCurrent, 0)
  const scoredClicks = scored.reduce((s, q) => s + q.clicksCurrent, 0)
  const scoredClickPct = totalClicks > 0 ? (scoredClicks / totalClicks) * 100 : 0

  // ── Current risk — only scored queries with clicks_current > 0 ────────────
  const currentBase = scored.filter(q => q.clicksCurrent > 0)
  const sumARC    = currentBase.reduce((s, q) => s + q.score.atRiskCurrent, 0)
  const sumClicks = currentBase.reduce((s, q) => s + q.clicksCurrent, 0)
  const currentComposite = sumClicks > 0 ? sumARC / sumClicks : 0

  // ── Latent risk — scored, clicks_current=0, clicks_previous>0 ────────────
  const latent = scored.filter(q => q.clicksCurrent === 0 && (q.clicksPrevious ?? 0) > 0)
  const sumLatentARL = latent.reduce((s, q) => s + q.score.atRiskLatent, 0)
  const sumLatentPrev = latent.reduce((s, q) => s + (q.clicksPrevious ?? 0), 0)
  const latentComposite = latent.length > 0 && sumLatentPrev > 0
    ? sumLatentARL / sumLatentPrev
    : null

  // ── pctQueriesAtRisk — scored queries where intensity > 0 ─────────────────
  const atRiskCount  = scored.filter(q => q.score.riskIntensity > 0).length
  const pctQueriesAtRisk = scored.length > 0 ? (atRiskCount / scored.length) * 100 : 0

  // ── Buckets (over all scored queries) ────────────────────────────────────
  const buckets = {
    high:   { queryCount: 0, currentClicks: 0 },
    medium: { queryCount: 0, currentClicks: 0 },
    low:    { queryCount: 0, currentClicks: 0 },
  }
  for (const q of scored) {
    const b = buckets[q.score.bucket]
    b.queryCount++
    b.currentClicks += q.clicksCurrent
  }

  return {
    currentComposite,
    pctCurrentClicksAtRisk: currentComposite * 100,
    pctQueriesAtRisk,
    latentComposite,
    latentQueryCount: latent.length,
    latentClicks: sumLatentPrev,
    buckets,
    coverage: {
      scored: scored.length,
      total,
      scoredClickPct,
    },
  }
}

/** Aggregate by category. Returns a Map so callers can look up by category key. */
export function aggregateByCategory(
  queries: Array<ScoredQuery & { category: string }>,
  categories: string[],
): Map<string, AggregateRisk> {
  const result = new Map<string, AggregateRisk>()
  for (const cat of categories) {
    result.set(cat, aggregateRisk(queries.filter(q => q.category === cat)))
  }
  return result
}
