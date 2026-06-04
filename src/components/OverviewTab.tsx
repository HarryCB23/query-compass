/**
 * OverviewTab — Phase 6.2e: combined Overview + Risk Summary.
 *
 * Governing rule: red = AI-driven risk only.
 * DATA / AGGREGATION: unchanged from Phase 6.1 + Risk Summary metrics added.
 */
import { useMemo } from 'react'
import { CategoryTag, MetricCard, TierDot, KPITile, DataTable, type DataColumn } from '@/components/ui/metric-card'
import type { QueryData, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import {
  scoreQuery,
  aggregateRisk,
  aggregateByCategory,
  type ScoredQuery,
  type AggregateRisk,
} from '@/lib/riskScoring'

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

function pct(n: number | null | undefined, decimals = 1): string {
  return `${(n ?? 0).toFixed(decimals)}%`
}

// ── Category risk row (deep table) ────────────────────────────────────────────

function CategoryRiskRow({ cat, agg }: { cat: QueryCategory; agg: AggregateRisk }) {
  const { coverage, blendedComposite, aiComponent, serpComponent, buckets } = agg
  if (coverage.total === 0) return null
  return (
    <tr className="border-b border-border/40 hover:bg-muted/40 transition-colors">
      <td className="py-2.5 pr-4 text-sm font-medium w-36">
        {CATEGORY_LABELS[cat]}
      </td>
      <td className="py-2.5 pr-4 min-w-[130px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-chart-neutral"
              style={{ width: `${Math.min(100, blendedComposite * 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums text-foreground w-8 text-right">
            {(blendedComposite * 100).toFixed(0)}%
          </span>
        </div>
      </td>
      <td className="py-2.5 pr-4 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {coverage.scored}/{coverage.total}
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {(aiComponent * 100).toFixed(0)}% AI · {(serpComponent * 100).toFixed(0)}% rich
      </td>
      <td className="py-2.5">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <TierDot tier="high"   showLabel={false} />{buckets.high.queryCount}
          <span className="mx-0.5 text-border">·</span>
          <TierDot tier="medium" showLabel={false} />{buckets.medium.queryCount}
          <span className="mx-0.5 text-border">·</span>
          <TierDot tier="low"    showLabel={false} />{buckets.low.queryCount}
        </span>
      </td>
    </tr>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  classifiedData: QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
  onNavigateToQueries: (category?: QueryCategory) => void
}

// ── Tier breakdown config ──────────────────────────────────────────────────────

interface TierRow {
  tier: 'high' | 'medium' | 'low'
  desc: string
  queryCount: number
  currentClicks: number
  estLost: number
}

const tierColumns: DataColumn<TierRow>[] = [
  {
    key: 'tier', header: 'Tier',
    render: r => (
      <span className="inline-flex items-center gap-2">
        <TierDot tier={r.tier} />
        <span className="text-xs text-muted-foreground">{r.desc}</span>
      </span>
    ),
  },
  {
    key: 'queries', header: 'Queries', align: 'right',
    render: r => <span className="font-mono text-xs">{r.queryCount.toLocaleString()}</span>,
  },
  {
    key: 'clicks', header: 'Curr. Clicks', align: 'right',
    render: r => <span className="font-mono text-xs">{r.currentClicks.toLocaleString()}</span>,
  },
  {
    key: 'lost', header: 'Est. Lost', align: 'right',
    render: r => (
      <span className={[
        'font-mono text-xs',
        r.tier === 'high'   ? 'text-risk font-semibold'
        : r.tier === 'medium' ? 'text-foreground'
        : 'text-muted-foreground/50',
      ].join(' ')}>
        {r.estLost > 0
          ? `~${r.estLost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : '—'}
      </span>
    ),
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function OverviewTab({ classifiedData, serpSnapshots, onNavigateToQueries }: OverviewTabProps) {

  // ── Core aggregation ────────────────────────────────────────────────────────

  const scoredQueries = useMemo((): Array<ScoredQuery & { category: string; query: string }> =>
    classifiedData.map(q => ({
      score:          scoreQuery(serpSnapshots.get(q.query) ?? null, q.clicksCurrent, q.clicksPrevious),
      clicksCurrent:  q.clicksCurrent,
      clicksPrevious: q.clicksPrevious,
      category:       q.category,
      query:          q.query,
    })),
  [classifiedData, serpSnapshots])

  const overall = useMemo(() => aggregateRisk(scoredQueries), [scoredQueries])
  const byCat   = useMemo(() => aggregateByCategory(scoredQueries, CATEGORIES), [scoredQueries])

  const { blendedComposite, pctQueriesAtRisk, latent, buckets } = overall

  // ── SERP coverage counts (for KPI strip + supporting text) ─────────────────

  const serpCoverage = useMemo(() => {
    let aioCount = 0, tsCount = 0, fsCount = 0
    serpSnapshots.forEach(snap => {
      if (snap.has_ai_overview)       aioCount++
      if (snap.has_top_stories)       tsCount++
      if (snap.has_featured_snippet)  fsCount++
    })
    const total = serpSnapshots.size
    return {
      aioCount, tsCount, fsCount, total,
      aioPct: total > 0 ? (aioCount / total) * 100 : 0,
      tsPct:  total > 0 ? (tsCount  / total) * 100 : 0,
      fsPct:  total > 0 ? (fsCount  / total) * 100 : 0,
    }
  }, [serpSnapshots])

  // ── News SERP-state ─────────────────────────────────────────────────────────

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
      withTS:    { queries: withTS.length,    clicks: tsClicks,   pct: totalClicks > 0 ? (tsClicks   / totalClicks) * 100 : 0 },
      withoutTS: { queries: withoutTS.length, clicks: noTsClicks, pct: totalClicks > 0 ? (noTsClicks / totalClicks) * 100 : 0 },
      lowCoverage,
    }
  }, [classifiedData, serpSnapshots])

  // ── Top 8 loss queries ──────────────────────────────────────────────────────

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

  // ── Category rows sorted by est. lost ──────────────────────────────────────

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

  // ── Tier rows ───────────────────────────────────────────────────────────────

  const tierRows: TierRow[] = [
    { tier: 'high',   desc: 'AIO present',     queryCount: buckets.high.queryCount,   currentClicks: buckets.high.currentClicks,   estLost: buckets.high.estLostClicks   },
    { tier: 'medium', desc: 'Rich SERP',        queryCount: buckets.medium.queryCount, currentClicks: buckets.medium.currentClicks, estLost: buckets.medium.estLostClicks },
    { tier: 'low',    desc: 'Clean / news TS',  queryCount: buckets.low.queryCount,    currentClicks: buckets.low.currentClicks,    estLost: buckets.low.estLostClicks    },
  ]

  // ── DataTable columns (top loss) ────────────────────────────────────────────

  type LossRow = typeof topLossQueries[number]

  const lossColumns: DataColumn<LossRow>[] = [
    {
      key: 'rank', header: '#',
      render: (_r, i) => <span className="text-xs text-muted-foreground">{i + 1}</span>,
      className: 'w-8',
    },
    {
      key: 'query', header: 'Query',
      render: (r) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[260px]">{r.query}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <CategoryTag category={r.category} />
            <TierDot tier={r.tier} showLabel={false} />
            <span className="text-xs text-muted-foreground">{r.clicks.toLocaleString()} clicks</span>
          </div>
        </div>
      ),
    },
    {
      key: 'tier', header: 'Tier',
      render: (r) => <TierDot tier={r.tier} />,
    },
    {
      key: 'estLost', header: 'Est. Lost', align: 'right',
      render: (r) => (
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-risk">~{Math.round(r.estLost).toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">clicks</p>
        </div>
      ),
    },
  ]

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (serpSnapshots.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data enriched yet.</p>
        <p className="text-xs text-muted-foreground/60">
          Use the Enrich SERP button to fetch SERP data, then check back here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── 4-KPI strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard className="bg-risk-subtle/30">
          <KPITile
            label="Estimated Click Loss"
            value={`≈${pct(blendedComposite * 100, 1)}`}
            caption="to SERP features"
          />
        </MetricCard>
        <MetricCard>
          <KPITile
            label="Queries at Risk"
            value={`${pctQueriesAtRisk.toFixed(1)}%`}
            caption="of scored queries (AIO or rich SERP)"
          />
        </MetricCard>
        <MetricCard>
          <KPITile
            label="AI Overview Coverage"
            value={`${serpCoverage.aioPct.toFixed(1)}%`}
            caption={`${serpCoverage.aioCount.toLocaleString()} of ${serpCoverage.total.toLocaleString()} queries`}
            valueClassName="text-risk"
          />
        </MetricCard>
        <MetricCard>
          <KPITile
            label="Latent Risk"
            value={latent?.composite != null ? `≈${(latent.composite * 100).toFixed(1)}%` : '—'}
            caption="recurring loss"
          />
        </MetricCard>
      </div>

      {/* Supporting text */}
      <p className="text-xs text-muted-foreground -mt-2">
        Top Stories present on {serpCoverage.tsPct.toFixed(0)}% of queries ({serpCoverage.tsCount.toLocaleString()} of {serpCoverage.total.toLocaleString()})
        {' · '}
        Featured Snippet on {serpCoverage.fsPct.toFixed(0)}% ({serpCoverage.fsCount.toLocaleString()})
      </p>

      {/* ── News SERP-state snapshot ──────────────────────────────────────── */}
      {newsSerpState && (
        <MetricCard title="Your news coverage right now">
          {newsSerpState.lowCoverage && (
            <p className="text-xs text-muted-foreground mb-3">
              Based on {newsSerpState.enrichedCount} of {newsSerpState.totalQueries} news queries enriched
            </p>
          )}
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

      {/* ── Top queries by estimated click loss ──────────────────────────── */}
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

      {/* ── Risk by category (deep table) ────────────────────────────────── */}
      {catRows.length > 0 && (
        <MetricCard title="Risk by category">
          <p className="text-xs text-muted-foreground -mt-2 mb-4">
            Blended risk % · scored ratio · AI + Rich split · tier dot counts
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-2 text-eyebrow pr-4">Category</th>
                <th className="text-left pb-2 text-eyebrow pr-4">Blended risk</th>
                <th className="text-right pb-2 text-eyebrow pr-4">Scored</th>
                <th className="text-left pb-2 text-eyebrow pr-4">AI + Rich split</th>
                <th className="text-left pb-2 text-eyebrow">Tiers</th>
              </tr>
            </thead>
            <tbody>
              {catRows.map(({ cat, agg }) => (
                <CategoryRiskRow key={cat} cat={cat} agg={agg} />
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-2">
            {catRows.map(({ cat }) => (
              <button
                key={cat}
                onClick={() => onNavigateToQueries(cat)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/60 rounded px-2 py-0.5 hover:border-border"
              >
                {CATEGORY_LABELS[cat]} →
              </button>
            ))}
          </div>
        </MetricCard>
      )}

      {/* ── Tier breakdown + logic ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <MetricCard title="Tier Breakdown">
          <DataTable
            columns={tierColumns}
            rows={tierRows}
            rowKey={r => r.tier}
          />
        </MetricCard>

        <MetricCard title="Tier Logic">
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">High (AIO)</span>
              {' '}— AI Overview present, no Top Stories. 75% modelled CTR loss.
            </p>
            <p>
              <span className="font-medium text-foreground">Medium (Rich SERP)</span>
              {' '}— AIO + Top Stories co-occurrence, or Video / Local Pack / Featured Snippet alone. 15% modelled CTR loss.
            </p>
            <p>
              <span className="font-medium text-foreground">Low</span>
              {' '}— Top Stories only (no AIO), or clean SERP. No modelled loss.
            </p>
            <p className="text-muted-foreground/60">
              AIO + TS → Medium: AIO renders above the Top Stories carousel, cannibalising organic CTR regardless of TS presence.
            </p>
          </div>
        </MetricCard>
      </div>

    </div>
  )
}
