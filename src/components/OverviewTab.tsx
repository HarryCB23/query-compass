/**
 * OverviewTab — Phase 6.2b reskin on the design system.
 *
 * DATA / AGGREGATION: identical to Phase 6.1 — no logic changes.
 * PRESENTATION: all primitives + tokens; zero hardcoded colours.
 *
 * Governing rule: red = AI-driven risk only.
 * Dark grey = publisher-owned / protected. Light grey = scaffolding.
 */
import { useMemo } from 'react'
import { CategoryBadge } from './CategoryBadge'
import { MetricCard, HeroNumber, TierDot, KPITile, DataTable, type DataColumn } from '@/components/ui/metric-card'
import { VerticalBarChart, RISK_COLOR, NEUTRAL_COLOR, MUTED_COLOR } from '@/components/ui/charts'
import type { QueryData, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import {
  scoreQuery,
  aggregateRisk,
  aggregateByCategory,
  type ScoredQuery,
} from '@/lib/riskScoring'

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined, decimals = 1): string {
  return `${(n ?? 0).toFixed(decimals)}%`
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  classifiedData: QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
  onNavigateToQueries: (category?: QueryCategory) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OverviewTab({ classifiedData, serpSnapshots, onNavigateToQueries }: OverviewTabProps) {

  // ── Core aggregation (unchanged from Phase 6.1) ────────────────────────────

  const scoredQueries = useMemo((): Array<ScoredQuery & { category: string; query: string }> =>
    classifiedData.map(q => ({
      score:          scoreQuery(serpSnapshots.get(q.query) ?? null, q.clicksCurrent, q.clicksPrevious),
      clicksCurrent:  q.clicksCurrent,
      clicksPrevious: q.clicksPrevious,
      category:       q.category,
      query:          q.query,
    })),
  [classifiedData, serpSnapshots])

  const overall  = useMemo(() => aggregateRisk(scoredQueries), [scoredQueries])
  const byCat    = useMemo(() => aggregateByCategory(scoredQueries, CATEGORIES), [scoredQueries])

  const { blendedComposite, aiComponent, serpComponent, latent, coverage } = overall

  // ── B3: News SERP-state ────────────────────────────────────────────────────

  const newsSerpState = useMemo(() => {
    const newsQueries = classifiedData.filter(q => q.category === 'news')
    const enriched    = newsQueries.filter(q => serpSnapshots.has(q.query))
    if (enriched.length === 0) return null

    const totalClicks = enriched.reduce((s, q) => s + q.clicksCurrent, 0)
    const withTS      = enriched.filter(q => serpSnapshots.get(q.query)?.has_top_stories)
    const withoutTS   = enriched.filter(q => !serpSnapshots.get(q.query)?.has_top_stories)
    const tsClicks    = withTS.reduce((s, q) => s + q.clicksCurrent, 0)
    const noTsClicks  = withoutTS.reduce((s, q) => s + q.clicksCurrent, 0)
    const lowCoverage = enriched.length < newsQueries.length * 0.5

    return {
      totalQueries:  newsQueries.length,
      enrichedCount: enriched.length,
      totalClicks,
      withTS:   { queries: withTS.length,    clicks: tsClicks,   pct: totalClicks > 0 ? (tsClicks   / totalClicks) * 100 : 0 },
      withoutTS:{ queries: withoutTS.length, clicks: noTsClicks, pct: totalClicks > 0 ? (noTsClicks / totalClicks) * 100 : 0 },
      lowCoverage,
    }
  }, [classifiedData, serpSnapshots])

  // ── B4: Top 8 loss queries ─────────────────────────────────────────────────

  const topLossQueries = useMemo(() => {
    return scoredQueries
      .filter(q => q.score.scored && q.score.estLostCurrent > 0)
      .sort((a, b) => b.score.estLostCurrent - a.score.estLostCurrent)
      .slice(0, 8)
      .map(q => {
        const qData = classifiedData.find(d => d.query === q.query)
        return {
          query:    q.query,
          category: q.category as QueryCategory,
          tier:     q.score.tier,
          clicks:   q.clicksCurrent,
          estLost:  q.score.estLostCurrent,
          reasoning: qData?.classificationReasoning ?? null,
        }
      })
  }, [scoredQueries, classifiedData])

  // ── B6: Category breakdown sorted by est. lost clicks ─────────────────────

  const catRows = useMemo(() => {
    return CATEGORIES
      .map(cat => ({ cat, agg: byCat.get(cat)! }))
      .filter(({ agg }) => agg.coverage.total > 0)
      .sort((a, b) => {
        const lostA = a.agg.buckets.high.estLostClicks + a.agg.buckets.medium.estLostClicks
        const lostB = b.agg.buckets.high.estLostClicks + b.agg.buckets.medium.estLostClicks
        return lostB - lostA
      })
  }, [byCat])

  // ── Bar chart data for B6 ──────────────────────────────────────────────────

  const CAT_SHORT: Record<QueryCategory, string> = {
    branded:       'Brand',
    informational: 'Info',
    news:          'News',
    product:       'Prod',
    commercial:    'Comm',
    transactional: 'Trans',
    other:         'Other',
  }

  const barChartData = useMemo(() =>
    catRows.map(({ cat, agg }) => ({
      label: CAT_SHORT[cat],
      value: Math.round(agg.buckets.high.estLostClicks + agg.buckets.medium.estLostClicks),
      cat,
    })),
  [catRows])

  // ── DataTable columns for top-loss queries ─────────────────────────────────

  type LossRow = typeof topLossQueries[number]

  const lossColumns: DataColumn<LossRow>[] = [
    {
      key: 'rank',
      header: '#',
      render: (_r, i) => (
        <span className="text-xs text-muted-foreground w-4 block">{i + 1}</span>
      ),
      className: 'w-8',
    },
    {
      key: 'query',
      header: 'Query',
      render: (r) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[260px]">{r.query}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <CategoryBadge category={r.category} />
            <TierDot tier={r.tier} showLabel={false} />
            <span className="text-xs text-muted-foreground">{r.clicks.toLocaleString()} clicks</span>
          </div>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (r) => <TierDot tier={r.tier} />,
    },
    {
      key: 'estLost',
      header: 'Est. Lost',
      align: 'right',
      render: (r) => (
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-risk">~{Math.round(r.estLost).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">clicks</p>
        </div>
      ),
    },
  ]

  // ── Empty state ────────────────────────────────────────────────────────────

  if (coverage.scored === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data enriched yet.</p>
        <p className="text-xs text-muted-foreground/60">
          Use the Enrich SERP button to fetch SERP data, then check back here.
        </p>
      </div>
    )
  }

  const estLostTotal = Math.round(
    overall.buckets.high.estLostClicks + overall.buckets.medium.estLostClicks,
  )

  return (
    <div className="space-y-6">

      {/* ── B2: Hero composite ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Hero number */}
        <MetricCard className="md:col-span-1 flex flex-col items-center justify-center">
          <HeroNumber
            value={`≈${pct(blendedComposite * 100, 1)}`}
            label="Estimated Click Loss"
            subline="of current clicks lost to SERP features"
          />

          {/* Composition bar: AI (red) | SERP (dark) | clean (muted track) */}
          <div className="w-full mt-5">
            <div className="h-1.5 w-full rounded-full bg-chart-muted overflow-hidden flex">
              <div
                className="h-full bg-chart-risk transition-all"
                style={{ width: `${Math.min(100, aiComponent * 100)}%` }}
              />
              <div
                className="h-full bg-chart-neutral transition-all"
                style={{ width: `${Math.min(100 - aiComponent * 100, serpComponent * 100)}%` }}
              />
            </div>
          </div>

          {/* Composition label */}
          <p className="text-[11px] text-muted-foreground mt-2 font-mono">
            = <span className="text-risk">{pct(aiComponent * 100, 1)} AI Overviews</span>
            {' + '}
            <span className="text-foreground/60">{pct(serpComponent * 100, 1)} busy SERPs</span>
          </p>
        </MetricCard>

        {/* 4 KPI tiles */}
        <MetricCard className="md:col-span-2">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            <KPITile
              label="Enriched Queries"
              value={coverage.scored.toLocaleString()}
              caption={`of ${coverage.total.toLocaleString()} total · ${pct(coverage.scoredClickPct, 0)} of clicks`}
            />
            <KPITile
              label="AI Overview component"
              value={pct(aiComponent * 100, 1)}
              caption="AIO queries at 75% CTR drop"
              valueClassName="text-risk"
            />
            <KPITile
              label="Rich SERP component"
              value={pct(serpComponent * 100, 1)}
              caption="video / local / shopping / FS at 15%"
            />
            <KPITile
              label="Est. lost clicks"
              value={`~${estLostTotal.toLocaleString()}`}
              caption="across enriched queries"
            />
          </div>
        </MetricCard>
      </div>

      {/* ── B3: News SERP-state snapshot ─────────────────────────────────── */}
      {newsSerpState && (
        <MetricCard title="Your news coverage right now">
          {newsSerpState.lowCoverage && (
            <p className="text-xs text-muted-foreground mb-3">
              Based on {newsSerpState.enrichedCount} of {newsSerpState.totalQueries} news queries enriched
            </p>
          )}

          {/* Two-segment bar: protected (dark) / exposed (red) */}
          <div className="h-3 w-full rounded-full overflow-hidden flex">
            <div
              className="h-full bg-chart-neutral rounded-l-full"
              style={{ width: `${newsSerpState.withTS.pct}%` }}
              title={`Top Stories present — ${pct(newsSerpState.withTS.pct)} of news clicks`}
            />
            <div
              className="h-full bg-risk flex-1 rounded-r-full"
              title={`No Top Stories — ${pct(newsSerpState.withoutTS.pct)} of news clicks`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div className="flex gap-2 items-start">
              <span className="w-2.5 h-2.5 rounded-full bg-chart-neutral mt-1 shrink-0" />
              <div>
                <p className="font-medium">{pct(newsSerpState.withTS.pct, 0)} of news traffic</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  on SERPs with Top Stories — largely protected
                  <br />
                  <span className="text-muted-foreground/60">
                    {newsSerpState.withTS.queries.toLocaleString()} queries ·{' '}
                    {newsSerpState.withTS.clicks.toLocaleString()} clicks
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="w-2.5 h-2.5 rounded-full bg-risk mt-1 shrink-0" />
              <div>
                <p className="font-medium">{pct(newsSerpState.withoutTS.pct, 0)} of news traffic</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  on SERPs without Top Stories — more exposed
                  <br />
                  <span className="text-muted-foreground/60">
                    {newsSerpState.withoutTS.queries.toLocaleString()} queries ·{' '}
                    {newsSerpState.withoutTS.clicks.toLocaleString()} clicks
                  </span>
                </p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/50 mt-4">
            SERP state is captured at enrichment time and may shift as news cycles change.
          </p>
        </MetricCard>
      )}

      {/* ── B5: Latent / recurring risk ───────────────────────────────────── */}
      {(latent?.queryCount ?? 0) > 0 && latent?.composite != null && (
        <MetricCard riskAccent>
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <p className="text-eyebrow text-risk mb-1">Latent / Recurring Risk</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {latent.queryCount.toLocaleString()}{' '}
                {latent.queryCount === 1 ? 'query' : 'queries'} with zero current clicks
                but {(latent.previousClicks ?? 0).toLocaleString()} previous-period clicks, on at-risk SERPs.
                Est. {(latent.estLostLatent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} clicks
                lost when they resurface.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-data-num text-risk">≈{pct(latent.composite * 100, 1)}</p>
              <p className="text-[10px] text-muted-foreground">weighted composite</p>
            </div>
          </div>
        </MetricCard>
      )}

      {/* ── B4: Top loss queries ──────────────────────────────────────────── */}
      {topLossQueries.length > 0 && (
        <MetricCard title="Top queries by estimated click loss">
          <DataTable
            columns={lossColumns}
            rows={topLossQueries}
            rowKey={(r) => r.query}
            footer={
              <button
                onClick={() => onNavigateToQueries()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all in Queries tab →
              </button>
            }
          />
        </MetricCard>
      )}

      {/* ── B6: Risk by category ──────────────────────────────────────────── */}
      {catRows.length > 0 && (
        <MetricCard title="Risk by category">
          <p className="text-xs text-muted-foreground mb-4">
            Estimated click loss · click a category badge to filter Queries tab
          </p>

          {/* Category nav badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {catRows.map(({ cat }) => (
              <button
                key={cat}
                onClick={() => onNavigateToQueries(cat)}
                className="hover:opacity-75 transition-opacity"
                title={`View ${CATEGORY_LABELS[cat]} queries`}
              >
                <CategoryBadge category={cat} />
              </button>
            ))}
          </div>

          {/* Vertical bar chart — all bars red, sorted by est. lost */}
          <VerticalBarChart
            data={barChartData}
            barColor={RISK_COLOR}
            height={200}
            valueFormatter={(v) => v > 0 ? `~${v.toLocaleString()}` : '0'}
          />

          {/* Detail rows */}
          <div className="mt-4 space-y-1">
            {catRows.map(({ cat, agg }) => {
              const estLost = Math.round(agg.buckets.high.estLostClicks + agg.buckets.medium.estLostClicks)
              return (
                <div key={cat} className="flex items-center gap-3 text-xs text-muted-foreground py-0.5">
                  <span className="w-10 font-mono shrink-0">{CAT_SHORT[cat]}</span>
                  <span>{agg.coverage.total.toLocaleString()} queries</span>
                  {estLost > 0 && (
                    <span className="text-risk font-medium ml-auto">~{estLost.toLocaleString()} est. lost</span>
                  )}
                </div>
              )
            })}
          </div>
        </MetricCard>
      )}

    </div>
  )
}
