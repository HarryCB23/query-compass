import { describe, it, expect } from 'vitest'
import {
  scoreQuery,
  aggregateRisk,
  tierOf,
  CTR_DROP,
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
    ...overrides,
  }
}

// ── tierOf ────────────────────────────────────────────────────────────────────

describe('tierOf', () => {
  it('AIO present, no Top Stories → high', () => {
    expect(tierOf(makeSnap({ has_ai_overview: true }))).toBe('high')
    expect(tierOf(makeSnap({ has_ai_overview: true, has_video: true }))).toBe('high')
  })

  it('AIO + Top Stories co-occurrence → medium (AIO is above TS, cannibalises)', () => {
    expect(tierOf(makeSnap({ has_ai_overview: true, has_top_stories: true }))).toBe('medium')
    expect(tierOf(makeSnap({ has_ai_overview: true, has_top_stories: true, has_video: true }))).toBe('medium')
  })

  it('Top Stories only, no AIO → low', () => {
    expect(tierOf(makeSnap({ has_top_stories: true }))).toBe('low')
    expect(tierOf(makeSnap({ has_top_stories: true, has_video: true }))).toBe('low')
  })

  it('Top Stories, no AIO → low (even with video)', () => {
    expect(tierOf(makeSnap({ has_top_stories: true }))).toBe('low')
    expect(tierOf(makeSnap({ has_top_stories: true, has_video: true }))).toBe('low')
    expect(tierOf(makeSnap({ has_top_stories: true, has_local_pack: true, has_shopping: true }))).toBe('low')
  })

  it('rich SERP features, no AIO, no TS → medium', () => {
    expect(tierOf(makeSnap({ has_video: true }))).toBe('medium')
    expect(tierOf(makeSnap({ has_local_pack: true }))).toBe('medium')
    expect(tierOf(makeSnap({ has_shopping: true }))).toBe('medium')
    expect(tierOf(makeSnap({ has_featured_snippet: true }))).toBe('medium')
    expect(tierOf(makeSnap({ has_video: true, has_shopping: true }))).toBe('medium')
  })

  it('clean SERP (no features) → low', () => {
    expect(tierOf(makeSnap())).toBe('low')
  })
})

// ── scoreQuery ────────────────────────────────────────────────────────────────

describe('scoreQuery', () => {
  it('null snapshot → scored false, all zeros', () => {
    const r = scoreQuery(null, 500, 400)
    expect(r.scored).toBe(false)
    expect(r.ctrDrop).toBe(0)
    expect(r.estLostCurrent).toBe(0)
    expect(r.estLostLatent).toBe(0)
    expect(r.riskKind).toBe('none')
  })

  it('undefined snapshot → scored false', () => {
    expect(scoreQuery(undefined, 100, null).scored).toBe(false)
  })

  it('AIO present → tier high, ctrDrop 0.75, riskKind ai', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 1000, 800)
    expect(r.tier).toBe('high')
    expect(r.ctrDrop).toBe(CTR_DROP.high)
    expect(r.riskKind).toBe('ai')
    expect(r.scored).toBe(true)
  })

  it('AIO + Top Stories → medium, ctrDrop 0.15, riskKind serp', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true, has_top_stories: true, has_video: true }), 100, null)
    expect(r.tier).toBe('medium')
    expect(r.ctrDrop).toBe(CTR_DROP.medium)
    expect(r.riskKind).toBe('serp')
  })

  it('AIO without Top Stories → high', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true, has_video: true }), 100, null)
    expect(r.tier).toBe('high')
    expect(r.ctrDrop).toBe(0.75)
  })

  it('Top Stories only → tier low, ctrDrop 0.0', () => {
    const r = scoreQuery(makeSnap({ has_top_stories: true }), 500, 300)
    expect(r.tier).toBe('low')
    expect(r.ctrDrop).toBe(0.0)
    expect(r.estLostCurrent).toBe(0)
    expect(r.riskKind).toBe('none')
  })

  it('Top Stories + video → still low (TS wins over video)', () => {
    const r = scoreQuery(makeSnap({ has_top_stories: true, has_video: true }), 200, null)
    expect(r.tier).toBe('low')
  })

  it('Shopping/local/FS/video only → tier medium, ctrDrop 0.15, riskKind serp', () => {
    for (const feature of ['has_video', 'has_local_pack', 'has_shopping', 'has_featured_snippet'] as const) {
      const r = scoreQuery(makeSnap({ [feature]: true }), 1000, null)
      expect(r.tier).toBe('medium')
      expect(r.ctrDrop).toBe(CTR_DROP.medium)
      expect(r.riskKind).toBe('serp')
    }
  })

  it('clean SERP → low, estLostCurrent 0', () => {
    const r = scoreQuery(makeSnap(), 300, 250)
    expect(r.tier).toBe('low')
    expect(r.estLostCurrent).toBe(0)
    expect(r.riskKind).toBe('none')
  })

  it('estLostCurrent = clicksCurrent × ctrDrop', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 1000, null)
    expect(r.estLostCurrent).toBeCloseTo(1000 * 0.75)

    const r2 = scoreQuery(makeSnap({ has_video: true }), 200, null)
    expect(r2.estLostCurrent).toBeCloseTo(200 * 0.15)
  })

  it('clicksCurrent=0, clicksPrevious>0, AIO → estLostCurrent 0, estLostLatent = prev × 0.75', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 0, 500)
    expect(r.scored).toBe(true)
    expect(r.tier).toBe('high')
    expect(r.estLostCurrent).toBe(0)
    expect(r.estLostLatent).toBeCloseTo(500 * 0.75)
  })

  it('null clicksPrevious → estLostLatent 0', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 100, null)
    expect(r.estLostLatent).toBe(0)
  })

  it('clicksCurrent>0, clicksPrevious>0 → estLostLatent 0 (not a dormant query)', () => {
    const r = scoreQuery(makeSnap({ has_ai_overview: true }), 100, 200)
    expect(r.estLostLatent).toBe(0)
  })
})

// ── aggregateRisk ─────────────────────────────────────────────────────────────

describe('aggregateRisk', () => {
  it('empty → zeroes, no latent', () => {
    const r = aggregateRisk([])
    expect(r.blendedComposite).toBe(0)
    expect(r.aiComponent).toBe(0)
    expect(r.serpComponent).toBe(0)
    expect(r.latent.composite).toBeNull()
    expect(r.coverage.scored).toBe(0)
    expect(r.coverage.total).toBe(0)
  })

  it('all unscored → composites 0, scored 0', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(null, 1000, 500), clicksCurrent: 1000, clicksPrevious: 500 },
    ]
    const r = aggregateRisk(queries)
    expect(r.coverage.scored).toBe(0)
    expect(r.blendedComposite).toBe(0)
  })

  it('single AIO query → blended = aiComponent = 0.75, serp = 0', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 1000, 800), clicksCurrent: 1000, clicksPrevious: 800 },
    ]
    const r = aggregateRisk(queries)
    expect(r.blendedComposite).toBeCloseTo(0.75)
    expect(r.aiComponent).toBeCloseTo(0.75)
    expect(r.serpComponent).toBe(0)
  })

  it('blendedComposite = aiComponent + serpComponent', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 1000, null), clicksCurrent: 1000, clicksPrevious: null },
      { score: scoreQuery(makeSnap({ has_video: true }),        1000, null), clicksCurrent: 1000, clicksPrevious: null },
    ]
    const r = aggregateRisk(queries)
    // aiLost = 1000×0.75, serpLost = 1000×0.15, total = 2000
    // blended = (750+150)/2000 = 0.45
    expect(r.blendedComposite).toBeCloseTo(0.45)
    expect(r.aiComponent).toBeCloseTo(750 / 2000)
    expect(r.serpComponent).toBeCloseTo(150 / 2000)
    expect(r.blendedComposite).toBeCloseTo(r.aiComponent + r.serpComponent)
  })

  it('Top Stories queries → AI component 0 (low tier contributes nothing)', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_top_stories: true }), 1000, null), clicksCurrent: 1000, clicksPrevious: null },
    ]
    const r = aggregateRisk(queries)
    expect(r.blendedComposite).toBe(0)
    expect(r.aiComponent).toBe(0)
    expect(r.buckets.low.queryCount).toBe(1)
  })

  it('latent queries detected: clicks_current=0, clicks_previous>0, AIO', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 0,    500), clicksCurrent: 0,    clicksPrevious: 500 },
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 1000, 800), clicksCurrent: 1000, clicksPrevious: 800 },
    ]
    const r = aggregateRisk(queries)
    expect(r.latent.queryCount).toBe(1)
    expect(r.latent.previousClicks).toBe(500)
    expect(r.latent.estLostLatent).toBeCloseTo(500 * 0.75)
    expect(r.latent.composite).toBeCloseTo(0.75)
    // blended only uses queries with clicks_current > 0
    expect(r.blendedComposite).toBeCloseTo(0.75)
  })

  it('bucket counts are correct', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 100, null), clicksCurrent: 100, clicksPrevious: null },
      { score: scoreQuery(makeSnap({ has_video: true }),        200, null), clicksCurrent: 200, clicksPrevious: null },
      { score: scoreQuery(makeSnap(),                           50,  null), clicksCurrent: 50,  clicksPrevious: null },
    ]
    const r = aggregateRisk(queries)
    expect(r.buckets.high.queryCount).toBe(1)
    expect(r.buckets.high.currentClicks).toBe(100)
    expect(r.buckets.high.estLostClicks).toBeCloseTo(75)
    expect(r.buckets.medium.queryCount).toBe(1)
    expect(r.buckets.medium.currentClicks).toBe(200)
    expect(r.buckets.medium.estLostClicks).toBeCloseTo(30)
    expect(r.buckets.low.queryCount).toBe(1)
    expect(r.buckets.low.estLostClicks).toBe(0)
  })

  it('coverage.scoredClickPct reflects scored proportion of total clicks', () => {
    const queries: ScoredQuery[] = [
      { score: scoreQuery(makeSnap({ has_ai_overview: true }), 1000, null), clicksCurrent: 1000, clicksPrevious: null },
      { score: scoreQuery(null,                                1000, null), clicksCurrent: 1000, clicksPrevious: null },
    ]
    const r = aggregateRisk(queries)
    expect(r.coverage.scored).toBe(1)
    expect(r.coverage.total).toBe(2)
    expect(r.coverage.scoredClickPct).toBeCloseTo(50)
  })
})
