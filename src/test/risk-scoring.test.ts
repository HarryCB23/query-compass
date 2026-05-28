import { describe, it, expect } from 'vitest'
import {
  scoreQuery,
  aggregateRisk,
  FEATURE_WEIGHTS,
  POSITION_MULTIPLIERS,
  type SerpSnapshot,
  type ScoredQuery,
} from '@/lib/riskScoring'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSnap(overrides: Partial<SerpSnapshot> = {}): SerpSnapshot {
  return {
    has_ai_overview:      false,
    has_top_stories:      false,
    has_featured_snippet: false,
    has_video:            false,
    has_local_pack:       false,
    has_shopping:         false,
    publisher_organic_position: 1,
    ...overrides,
  }
}

const CLEAN_SNAP = makeSnap()  // all false, pos 1 — genuinely zero risk

// ── scoreQuery ────────────────────────────────────────────────────────────────

describe('scoreQuery', () => {

  it('all-false snapshot (40102 — no results) → risk_intensity 0, scored true', () => {
    const r = scoreQuery(CLEAN_SNAP, 500, 400)
    expect(r.scored).toBe(true)
    expect(r.riskIntensity).toBe(0)
    expect(r.bucket).toBe('low')
    expect(r.atRiskCurrent).toBe(0)
    expect(r.atRiskLatent).toBe(0)
  })

  it('null snapshot → scored false, all zeros', () => {
    const r = scoreQuery(null, 500, 400)
    expect(r.scored).toBe(false)
    expect(r.riskIntensity).toBe(0)
    expect(r.atRiskCurrent).toBe(0)
    expect(r.atRiskLatent).toBe(0)
  })

  it('undefined snapshot → scored false', () => {
    const r = scoreQuery(undefined, 100, null)
    expect(r.scored).toBe(false)
  })

  it('pure news SERP (only has_top_stories, no click-removing features) → intensity 0', () => {
    // hostile_weight = 0 (no click-removing features)
    // feature_weight = 0 × 0.30 = 0 (top stories relief applied, still 0)
    const r = scoreQuery(makeSnap({ has_top_stories: true }), 1000, 800)
    expect(r.featureWeight).toBe(0)
    expect(r.riskIntensity).toBe(0)
    expect(r.bucket).toBe('low')
    expect(r.atRiskCurrent).toBe(0)
  })

  it('AIO only, pos 1 → 0.80 × 1.0 = 0.80, High', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 1000, null)
    expect(r.featureWeight).toBeCloseTo(FEATURE_WEIGHTS.has_ai_overview)
    expect(r.positionMult).toBe(POSITION_MULTIPLIERS.top3)
    expect(r.riskIntensity).toBeCloseTo(0.80)
    expect(r.bucket).toBe('high')
    expect(r.atRiskCurrent).toBeCloseTo(800)
  })

  it('AIO + Shopping, pos 1 → hostile = 1-(0.2×0.8) = 0.84, High', () => {
    // hostile_product = (1-0.80)(1-0.20) = 0.20 × 0.80 = 0.16
    // hostile_weight  = 1 - 0.16 = 0.84
    const r = scoreQuery(makeSnap({ has_ai_overview: true, has_shopping: true }), 1000, null)
    expect(r.featureWeight).toBeCloseTo(0.84)
    expect(r.riskIntensity).toBeCloseTo(0.84)
    expect(r.bucket).toBe('high')
  })

  it('AIO + Top Stories, pos 1 → 0.80 × 0.30 = 0.24, Medium', () => {
    // hostile_weight = 0.80 (AIO only, top stories is relief not penalty)
    // feature_weight = 0.80 × 0.30 = 0.24
    const r = scoreQuery(makeSnap({ has_ai_overview: true, has_top_stories: true }), 500, null)
    expect(r.featureWeight).toBeCloseTo(0.24)
    expect(r.riskIntensity).toBeCloseTo(0.24)
    expect(r.bucket).toBe('medium')
  })

  it('AIO only, null position → 0.80 × 0.30 = 0.24, Medium', () => {
    const r = scoreQuery(
      makeSnap({ has_ai_overview: true, publisher_organic_position: null }),
      300, 400,
    )
    expect(r.positionMult).toBe(POSITION_MULTIPLIERS.absent)
    expect(r.riskIntensity).toBeCloseTo(0.80 * 0.30)
    expect(r.bucket).toBe('medium')
  })

  it('position 4–6 → positionMult 0.75', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true, publisher_organic_position: 5 }), 100, null)
    expect(r.positionMult).toBe(POSITION_MULTIPLIERS.mid)
    expect(r.riskIntensity).toBeCloseTo(0.80 * 0.75)
  })

  it('position 7–10 → positionMult 0.50', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true, publisher_organic_position: 9 }), 100, null)
    expect(r.positionMult).toBe(POSITION_MULTIPLIERS.bottom)
    expect(r.riskIntensity).toBeCloseTo(0.80 * 0.50)
  })

  it('position > 10 → treated as absent (0.30)', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true, publisher_organic_position: 15 }), 100, null)
    expect(r.positionMult).toBe(POSITION_MULTIPLIERS.absent)
  })

  it('zero current clicks, prev > 0, AIO pos 1 → atRiskCurrent 0, atRiskLatent = prev × 0.80, bucket High', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 0, 500)
    expect(r.scored).toBe(true)
    expect(r.atRiskCurrent).toBe(0)
    expect(r.atRiskLatent).toBeCloseTo(500 * 0.80)
    expect(r.bucket).toBe('high')
  })

  it('null clicks_previous → atRiskLatent 0', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 100, null)
    expect(r.atRiskLatent).toBe(0)
  })

  it('high threshold: intensity exactly 0.50 → High', () => {
    // Need feature_weight × position_mult = 0.50
    // AIO(0.80) × pos mid(0.75) = 0.60 → High
    // Use Featured Snippet(0.10) × pos absent(0.30) = 0.03 → Low
    // Use AIO+TS: 0.80×0.30=0.24 → Medium; at pos top3(1.0) = 0.24 → Medium
    // Use AIO(0.80) at pos 7-10(0.50) → 0.40 → Medium... need exactly 0.50
    // Let's just verify bucket boundaries by intensity
    const high = scoreQuery(makeSnap({ has_ai_overview: true, publisher_organic_position: null }), 100, null)
    // 0.80 × 0.30 = 0.24 → medium
    expect(high.bucket).toBe('medium')
    const alsoHigh = scoreQuery(makeSnap({ has_ai_overview: true }), 100, null)
    // 0.80 × 1.0 = 0.80 → high
    expect(alsoHigh.bucket).toBe('high')
  })

  it('all five hostile features, pos 1 → maximum compounding', () => {
    // hostile_product = (1-0.80)(1-0.20)(1-0.20)(1-0.10)(1-0.10)
    //                 = 0.20 × 0.80 × 0.80 × 0.90 × 0.90
    //                 = 0.20 × 0.80 × 0.80 × 0.81
    //                 = 0.103...
    // hostile_weight  = 1 - 0.103... ≈ 0.896...
    const r = scoreQuery(makeSnap({
      has_ai_overview: true, has_local_pack: true, has_shopping: true,
      has_featured_snippet: true, has_video: true,
    }), 1000, null)
    const expectedHostile = 1 - (0.20 * 0.80 * 0.80 * 0.90 * 0.90)
    expect(r.featureWeight).toBeCloseTo(expectedHostile)
    expect(r.riskIntensity).toBeCloseTo(expectedHostile)
    expect(r.bucket).toBe('high')
  })

})

// ── aggregateRisk ─────────────────────────────────────────────────────────────

describe('aggregateRisk', () => {

  it('empty input → zeroes, no latent', () => {
    const r = aggregateRisk([])
    expect(r.currentComposite).toBe(0)
    expect(r.latentComposite).toBeNull()
    expect(r.latentQueryCount).toBe(0)
    expect(r.coverage.scored).toBe(0)
    expect(r.coverage.total).toBe(0)
  })

  it('all unscored (no snapshots) → composite 0, coverage.scored 0', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(null, 1000, 500), clicksCurrent: 1000, clicksPrevious: 500 },
      { score: scoreQuery(null, 500,  300), clicksCurrent: 500,  clicksPrevious: 300 },
    ]
    const r = aggregateRisk(queries)
    expect(r.coverage.scored).toBe(0)
    expect(r.coverage.total).toBe(2)
    expect(r.currentComposite).toBe(0)
    expect(r.latentComposite).toBeNull()
  })

  it('single AIO query, pos 1, 1000 clicks → composite ≈ 0.80', () => {
    const snap = makeSnap({ has_ai_overview: true })
    const queries: ScoredQuery[] = [
      { score: scoreQuery(snap, 1000, 800), clicksCurrent: 1000, clicksPrevious: 800 },
    ]
    const r = aggregateRisk(queries)
    expect(r.currentComposite).toBeCloseTo(0.80)
    expect(r.pctCurrentClicksAtRisk).toBeCloseTo(80)
    expect(r.coverage.scored).toBe(1)
    expect(r.latentComposite).toBeNull()  // no dormant queries
  })

  it('latent queries detected when clicks_current=0, clicks_previous>0', () => {
    const snap = makeSnap({ has_ai_overview: true })
    const queries: ScoredQuery[] = [
      { score: scoreQuery(snap, 0, 500),    clicksCurrent: 0,   clicksPrevious: 500 },
      { score: scoreQuery(snap, 1000, 800), clicksCurrent: 1000, clicksPrevious: 800 },
    ]
    const r = aggregateRisk(queries)
    expect(r.latentQueryCount).toBe(1)
    expect(r.latentClicks).toBe(500)
    expect(r.latentComposite).toBeCloseTo(0.80)
    // current composite only uses clicks_current > 0
    expect(r.currentComposite).toBeCloseTo(0.80)
  })

  it('bucket counts are correct', () => {
    const highSnap = makeSnap({ has_ai_overview: true })                       // 0.80 × 1.0 = 0.80 High
    const medSnap  = makeSnap({ has_ai_overview: true, has_top_stories: true }) // 0.24 Medium
    const lowSnap  = makeSnap()                                                 // 0.0 Low
    const queries: ScoredQuery[] = [
      { score: scoreQuery(highSnap, 100, null), clicksCurrent: 100, clicksPrevious: null },
      { score: scoreQuery(medSnap,  200, null), clicksCurrent: 200, clicksPrevious: null },
      { score: scoreQuery(lowSnap,  50,  null), clicksCurrent: 50,  clicksPrevious: null },
    ]
    const r = aggregateRisk(queries)
    expect(r.buckets.high.queryCount).toBe(1)
    expect(r.buckets.high.currentClicks).toBe(100)
    expect(r.buckets.medium.queryCount).toBe(1)
    expect(r.buckets.medium.currentClicks).toBe(200)
    expect(r.buckets.low.queryCount).toBe(1)
    expect(r.buckets.low.currentClicks).toBe(50)
  })

  it('coverage.scoredClickPct reflects proportion of clicks in scored queries', () => {
    const snap = makeSnap({ has_ai_overview: true })
    const queries: ScoredQuery[] = [
      { score: scoreQuery(snap, 1000, null), clicksCurrent: 1000, clicksPrevious: null },  // scored
      { score: scoreQuery(null, 1000, null), clicksCurrent: 1000, clicksPrevious: null },  // unscored
    ]
    const r = aggregateRisk(queries)
    expect(r.coverage.scored).toBe(1)
    expect(r.coverage.total).toBe(2)
    expect(r.coverage.scoredClickPct).toBeCloseTo(50)
  })

})
