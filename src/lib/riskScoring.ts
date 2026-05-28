/**
 * riskScoring.ts — Phase 5 tiered CTR-drop model.
 *
 * Tier assignment (priority order — first match wins):
 *   has_ai_overview                                       → high  (AI cannibalisation)
 *   has_top_stories                                       → low   (publisher-friendly news SERP)
 *   has_video | has_local_pack | has_shopping | has_fs    → medium (SERP competition, not AI)
 *   else                                                  → low
 *
 * CTR-drop constants (tunable):
 *   high   0.75  — AIO estimated 75% CTR reduction
 *   medium 0.15  — PROVISIONAL: placeholder until pixel-displacement data (Phase 4.5)
 *   low    0.00
 *
 * Per-query output:
 *   estLostCurrent = clicksCurrent × ctrDrop
 *   estLostLatent  = clicksPrevious × ctrDrop  (only when clicksCurrent=0 & prev>0)
 *
 * Project composite:
 *   blendedComposite = (aiLost + serpLost) / Σ clicksCurrent (scored)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Estimated CTR reduction by tier.
 * medium is PROVISIONAL — will be replaced with measured pixel-displacement
 * CTR drop in Phase 4.5 once pixel-height data is available.
 */
export const CTR_DROP = {
  high:   0.75,
  medium: 0.15,  // PROVISIONAL — Phase 4.5 pixel-displacement data pending
  low:    0.00,
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskTier = 'high' | 'medium' | 'low'
export type RiskKind = 'ai' | 'serp' | 'none'

/**
 * Minimal snapshot fields needed for tier assignment.
 * Compatible with SerpSnapshotData from QueryTable.tsx.
 */
export interface SerpSnapshot {
  has_ai_overview:      boolean
  has_top_stories:      boolean
  has_featured_snippet: boolean
  has_video:            boolean
  has_local_pack:       boolean
  has_shopping:         boolean
}

export interface QueryScore {
  scored:          boolean   // false when snapshot is null (unenriched)
  tier:            RiskTier
  ctrDrop:         number
  estLostCurrent:  number    // clicksCurrent × ctrDrop
  estLostLatent:   number    // clicksPrevious × ctrDrop (latent) else 0
  riskKind:        RiskKind  // 'ai' | 'serp' | 'none'
}

export interface ScoredQuery {
  score:          QueryScore
  clicksCurrent:  number
  clicksPrevious: number | null
}

export interface AggregateRisk {
  /** (aiLost + serpLost) / Σ clicksCurrent for scored queries. */
  blendedComposite:  number
  /** aiLost / Σ clicksCurrent */
  aiComponent:       number
  /** serpLost / Σ clicksCurrent */
  serpComponent:     number
  /** (high + medium count) / scored count */
  pctQueriesAtRisk:  number
  buckets: {
    high:   { queryCount: number; currentClicks: number; estLostClicks: number }
    medium: { queryCount: number; currentClicks: number; estLostClicks: number }
    low:    { queryCount: number; currentClicks: number; estLostClicks: number }
  }
  latent: {
    queryCount:     number
    previousClicks: number
    estLostLatent:  number
    /** null when there are no latent queries. */
    composite:      number | null
  }
  coverage: {
    scored:         number
    total:          number
    scoredClickPct: number
  }
}

// ── Tier assignment ───────────────────────────────────────────────────────────

/** Assign a risk tier to a snapshot. Priority order: first match wins. */
export function tierOf(snapshot: SerpSnapshot): RiskTier {
  if (snapshot.has_ai_overview) return 'high'
  if (snapshot.has_top_stories) return 'low'
  if (
    snapshot.has_video ||
    snapshot.has_local_pack ||
    snapshot.has_shopping ||
    snapshot.has_featured_snippet
  ) return 'medium'
  return 'low'
}

// ── Core scoring function ─────────────────────────────────────────────────────

/**
 * Score a single query. Pass snapshot=null/undefined for unenriched queries.
 * Unscored queries are excluded from all aggregates; counted in coverage.
 */
export function scoreQuery(
  snapshot: SerpSnapshot | null | undefined,
  clicksCurrent: number,
  clicksPrevious: number | null,
): QueryScore {
  if (!snapshot) {
    return {
      scored: false, tier: 'low', ctrDrop: 0,
      estLostCurrent: 0, estLostLatent: 0, riskKind: 'none',
    }
  }

  const tier    = tierOf(snapshot)
  const ctrDrop = CTR_DROP[tier]
  const isLatent = clicksCurrent === 0 && (clicksPrevious ?? 0) > 0

  return {
    scored:         true,
    tier,
    ctrDrop,
    estLostCurrent: clicksCurrent * ctrDrop,
    estLostLatent:  isLatent ? (clicksPrevious ?? 0) * ctrDrop : 0,
    riskKind:       tier === 'high' ? 'ai' : tier === 'medium' ? 'serp' : 'none',
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** Aggregate scored queries into project-level (or category-level) metrics. */
export function aggregateRisk(queries: ScoredQuery[]): AggregateRisk {
  const scored = queries.filter(q => q.score.scored)
  const total  = queries.length

  // Coverage
  const totalClicks  = queries.reduce((s, q) => s + q.clicksCurrent, 0)
  const scoredClicks = scored.reduce((s, q) => s + q.clicksCurrent, 0)
  const scoredClickPct = totalClicks > 0 ? (scoredClicks / totalClicks) * 100 : 0

  // Composite (only scored queries with clicks_current > 0)
  const withClicks = scored.filter(q => q.clicksCurrent > 0)
  const sumCurrentClicks = withClicks.reduce((s, q) => s + q.clicksCurrent, 0)
  const aiLost   = withClicks.filter(q => q.score.tier === 'high').reduce((s, q) => s + q.score.estLostCurrent, 0)
  const serpLost = withClicks.filter(q => q.score.tier === 'medium').reduce((s, q) => s + q.score.estLostCurrent, 0)
  const blendedComposite = sumCurrentClicks > 0 ? (aiLost + serpLost) / sumCurrentClicks : 0
  const aiComponent      = sumCurrentClicks > 0 ? aiLost   / sumCurrentClicks : 0
  const serpComponent    = sumCurrentClicks > 0 ? serpLost / sumCurrentClicks : 0

  // pctQueriesAtRisk — high or medium tier
  const atRiskCount = scored.filter(q => q.score.tier !== 'low').length
  const pctQueriesAtRisk = scored.length > 0 ? (atRiskCount / scored.length) * 100 : 0

  // Buckets (all scored queries, including zero-click)
  const buckets = {
    high:   { queryCount: 0, currentClicks: 0, estLostClicks: 0 },
    medium: { queryCount: 0, currentClicks: 0, estLostClicks: 0 },
    low:    { queryCount: 0, currentClicks: 0, estLostClicks: 0 },
  }
  for (const q of scored) {
    const b = buckets[q.score.tier]
    b.queryCount++
    b.currentClicks  += q.clicksCurrent
    b.estLostClicks  += q.score.estLostCurrent
  }

  // Latent — scored, clicks_current=0, clicks_previous>0
  const latentQueries = scored.filter(q => q.clicksCurrent === 0 && (q.clicksPrevious ?? 0) > 0)
  const latentPrevClicks = latentQueries.reduce((s, q) => s + (q.clicksPrevious ?? 0), 0)
  const latentLost       = latentQueries.reduce((s, q) => s + q.score.estLostLatent, 0)
  const latentComposite  = latentQueries.length > 0 && latentPrevClicks > 0
    ? latentLost / latentPrevClicks
    : null

  return {
    blendedComposite,
    aiComponent,
    serpComponent,
    pctQueriesAtRisk,
    buckets,
    latent: {
      queryCount:     latentQueries.length,
      previousClicks: latentPrevClicks,
      estLostLatent:  latentLost,
      composite:      latentComposite,
    },
    coverage: { scored: scored.length, total, scoredClickPct },
  }
}

/** Aggregate by category. Returns a Map keyed by category string. */
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
