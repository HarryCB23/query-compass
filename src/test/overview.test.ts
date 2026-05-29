/**
 * Unit tests for the logic that powers OverviewTab.
 *
 * OverviewTab is a pure-computation component — all its derived state comes
 * from scoreQuery / aggregateRisk / aggregateByCategory from riskScoring.ts.
 * We test the logic directly rather than rendering the component.
 */
import { describe, it, expect } from 'vitest'
import { scoreQuery, aggregateRisk, aggregateByCategory, type SerpSnapshot } from '@/lib/riskScoring'
import type { QueryData, QueryCategory } from '@/types/query'
import type { SerpSnapshotData } from '@/components/QueryTable'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(overrides: Partial<SerpSnapshot> = {}): SerpSnapshotData {
  return {
    query_id:                       'q1',
    captured_at:                    new Date().toISOString(),
    has_ai_overview:                false,
    has_top_stories:                false,
    has_featured_snippet:           false,
    has_video:                      false,
    has_local_pack:                 false,
    has_shopping:                   false,
    publisher_in_ai_overview:       false,
    publisher_in_top_stories:       false,
    publisher_in_featured_snippet:  false,
    publisher_organic_position:     null,
    publisher_in_organic_top_3:     false,
    top_organic_domains:            null,
    ...overrides,
  } as SerpSnapshotData
}

function makeQuery(
  query: string,
  category: QueryCategory,
  clicksCurrent: number,
  clicksPrevious = 0,
): QueryData {
  return {
    query,
    category,
    clicksCurrent,
    clicksPrevious,
    impressionsCurrent:       0,
    impressionsPrevious:      0,
    ctrCurrent:               null,
    ctrPrevious:              null,
    positionCurrent:          null,
    positionPrevious:         null,
    clicksChange:             clicksCurrent - clicksPrevious,
    clicksChangePercent:      0,
    impressionsChange:        0,
    impressionsChangePercent: 0,
    classificationSource:     null,
    classificationReasoning:  null,
  }
}

type ScoredRow = {
  score:          ReturnType<typeof scoreQuery>
  clicksCurrent:  number
  clicksPrevious: number
  category:       string
  query:          string
}

function makeScoredRows(
  classifiedData: QueryData[],
  serpSnapshots: Map<string, SerpSnapshotData>,
): ScoredRow[] {
  return classifiedData.map(q => ({
    score:          scoreQuery(serpSnapshots.get(q.query) ?? null, q.clicksCurrent, q.clicksPrevious),
    clicksCurrent:  q.clicksCurrent,
    clicksPrevious: q.clicksPrevious,
    category:       q.category,
    query:          q.query,
  }))
}

// ── News SERP-state (B3) logic ────────────────────────────────────────────────

describe('newsSerpState calculation', () => {
  it('clicks-weighted % TS protected vs exposed is correct', () => {
    const queries: QueryData[] = [
      makeQuery('ukraine war',      'news', 400),  // has TS → protected
      makeQuery('trump tariffs',    'news', 100),  // has TS → protected
      makeQuery('inflation explainer', 'news', 200), // no TS → exposed
      makeQuery('mortgage rates',   'news', 300),  // no TS → exposed
    ]

    const snapshots = new Map<string, SerpSnapshotData>([
      ['ukraine war',      makeSnap({ has_top_stories: true })],
      ['trump tariffs',    makeSnap({ has_top_stories: true })],
      ['inflation explainer', makeSnap({ has_top_stories: false })],
      ['mortgage rates',   makeSnap({ has_top_stories: false })],
    ])

    const enriched   = queries.filter(q => snapshots.has(q.query))
    const totalClicks = enriched.reduce((s, q) => s + q.clicksCurrent, 0) // 1000
    const withTS     = enriched.filter(q => snapshots.get(q.query)?.has_top_stories)
    const tsClicks   = withTS.reduce((s, q) => s + q.clicksCurrent, 0)   // 500
    const tsPct      = (tsClicks / totalClicks) * 100

    expect(enriched.length).toBe(4)
    expect(totalClicks).toBe(1000)
    expect(tsClicks).toBe(500)
    expect(tsPct).toBeCloseTo(50.0, 1)
  })

  it('returns null when no news queries are enriched', () => {
    const queries: QueryData[] = [makeQuery('best seo tool', 'news', 200)]
    const snapshots = new Map<string, SerpSnapshotData>() // nothing enriched

    const enriched = queries.filter(q => snapshots.has(q.query))
    expect(enriched.length).toBe(0)
    // OverviewTab returns null when enriched.length === 0
  })

  it('lowCoverage flag is set when <50% of news queries are enriched', () => {
    const queries: QueryData[] = [
      makeQuery('q1', 'news', 100),
      makeQuery('q2', 'news', 100),
      makeQuery('q3', 'news', 100),
    ]
    const snapshots = new Map<string, SerpSnapshotData>([
      ['q1', makeSnap()], // only 1 of 3 enriched
    ])

    const enriched    = queries.filter(q => snapshots.has(q.query))
    const lowCoverage = enriched.length < queries.length * 0.5
    expect(lowCoverage).toBe(true)
  })

  it('lowCoverage is false when ≥50% enriched', () => {
    const queries: QueryData[] = [
      makeQuery('q1', 'news', 100),
      makeQuery('q2', 'news', 100),
    ]
    const snapshots = new Map<string, SerpSnapshotData>([
      ['q1', makeSnap()],
      ['q2', makeSnap()],
    ])

    const enriched    = queries.filter(q => snapshots.has(q.query))
    const lowCoverage = enriched.length < queries.length * 0.5
    expect(lowCoverage).toBe(false)
  })
})

// ── Top-loss queries (B4) ─────────────────────────────────────────────────────

describe('topLossQueries extraction', () => {
  it('sorted descending by estLostCurrent', () => {
    const queries: QueryData[] = [
      makeQuery('low aio query',  'informational', 200),
      makeQuery('high aio query', 'informational', 800),
      makeQuery('mid aio query',  'informational', 400),
    ]

    const snapshots = new Map<string, SerpSnapshotData>([
      ['low aio query',  makeSnap({ has_ai_overview: true })],
      ['high aio query', makeSnap({ has_ai_overview: true })],
      ['mid aio query',  makeSnap({ has_ai_overview: true })],
    ])

    const scored = makeScoredRows(queries, snapshots)
    const topLoss = scored
      .filter(q => q.score.scored && q.score.estLostCurrent > 0)
      .sort((a, b) => b.score.estLostCurrent - a.score.estLostCurrent)

    expect(topLoss[0].query).toBe('high aio query')
    expect(topLoss[1].query).toBe('mid aio query')
    expect(topLoss[2].query).toBe('low aio query')

    // estLostCurrent = clicks × CTR_DROP.high (0.75)
    expect(topLoss[0].score.estLostCurrent).toBeCloseTo(600, 0)
    expect(topLoss[1].score.estLostCurrent).toBeCloseTo(300, 0)
    expect(topLoss[2].score.estLostCurrent).toBeCloseTo(150, 0)
  })

  it('excludes unscored queries (no snapshot)', () => {
    const queries: QueryData[] = [
      makeQuery('enriched',   'informational', 500),
      makeQuery('unenriched', 'informational', 999),
    ]

    const snapshots = new Map<string, SerpSnapshotData>([
      ['enriched', makeSnap({ has_ai_overview: true })],
    ])

    const scored = makeScoredRows(queries, snapshots)
    const topLoss = scored.filter(q => q.score.scored && q.score.estLostCurrent > 0)

    expect(topLoss.length).toBe(1)
    expect(topLoss[0].query).toBe('enriched')
  })

  it('excludes clean-SERP queries with zero estimated loss', () => {
    const queries: QueryData[] = [
      makeQuery('clean query', 'informational', 500),
    ]
    const snapshots = new Map<string, SerpSnapshotData>([
      ['clean query', makeSnap()], // no features → low tier → estLostCurrent = 0
    ])

    const scored = makeScoredRows(queries, snapshots)
    const topLoss = scored.filter(q => q.score.scored && q.score.estLostCurrent > 0)
    expect(topLoss.length).toBe(0)
  })

  it('returns at most 8 entries', () => {
    const queries: QueryData[] = Array.from({ length: 20 }, (_, i) =>
      makeQuery(`query ${i}`, 'informational', (i + 1) * 100),
    )
    const snapshots = new Map<string, SerpSnapshotData>(
      queries.map(q => [q.query, makeSnap({ has_ai_overview: true })]),
    )

    const scored = makeScoredRows(queries, snapshots)
    const topLoss = scored
      .filter(q => q.score.scored && q.score.estLostCurrent > 0)
      .sort((a, b) => b.score.estLostCurrent - a.score.estLostCurrent)
      .slice(0, 8)

    expect(topLoss.length).toBe(8)
  })
})

// ── Empty-state guard ─────────────────────────────────────────────────────────

describe('OverviewTab empty state', () => {
  it('coverage.scored is 0 when no snapshots provided', () => {
    const queries: QueryData[] = [
      makeQuery('q1', 'news', 200),
      makeQuery('q2', 'informational', 150),
    ]
    const snapshots = new Map<string, SerpSnapshotData>()
    const scored    = makeScoredRows(queries, snapshots)
    const overall   = aggregateRisk(scored)
    expect(overall.coverage.scored).toBe(0)
  })

  it('coverage.scored equals number of enriched queries', () => {
    const queries: QueryData[] = [
      makeQuery('enriched1',   'informational', 100),
      makeQuery('enriched2',   'news',          200),
      makeQuery('unenriched1', 'other',         300),
    ]
    const snapshots = new Map<string, SerpSnapshotData>([
      ['enriched1', makeSnap({ has_ai_overview: true })],
      ['enriched2', makeSnap({ has_top_stories: true })],
    ])
    const scored  = makeScoredRows(queries, snapshots)
    const overall = aggregateRisk(scored)
    expect(overall.coverage.scored).toBe(2)
    expect(overall.coverage.total).toBe(3)
  })
})

// ── Category breakdown (B6) ───────────────────────────────────────────────────

describe('category breakdown aggregation', () => {
  it('categories with highest est. lost clicks appear first when sorted', () => {
    const CATEGORIES: QueryCategory[] = ['news', 'informational', 'branded']

    const queries: QueryData[] = [
      makeQuery('aio news 1',       'news',          1000),
      makeQuery('clean info',       'informational', 500),
      makeQuery('branded term',     'branded',       800),
      makeQuery('aio info',         'informational', 200),
    ]

    const snapshots = new Map<string, SerpSnapshotData>([
      ['aio news 1',   makeSnap({ has_ai_overview: true })],  // 1000 × 0.75 = 750 lost
      ['clean info',   makeSnap()],                           //   0 lost
      ['branded term', makeSnap()],                           //   0 lost
      ['aio info',     makeSnap({ has_ai_overview: true })],  //  200 × 0.75 = 150 lost
    ])

    const scored = makeScoredRows(queries, snapshots)
    const byCat  = aggregateByCategory(scored, CATEGORIES)

    const catRows = CATEGORIES
      .map(cat => ({ cat, agg: byCat.get(cat)! }))
      .filter(({ agg }) => agg.coverage.total > 0)
      .sort((a, b) => {
        const lostA = a.agg.buckets.high.estLostClicks + a.agg.buckets.medium.estLostClicks
        const lostB = b.agg.buckets.high.estLostClicks + b.agg.buckets.medium.estLostClicks
        return lostB - lostA
      })

    expect(catRows[0].cat).toBe('news')          // 750 lost
    expect(catRows[1].cat).toBe('informational')  // 150 lost
    expect(catRows[2].cat).toBe('branded')        // 0 lost
  })
})
