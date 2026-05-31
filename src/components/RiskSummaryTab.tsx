/**
 * RiskSummaryTab — Phase 6.2c redesign on design system.
 * Red = AI-driven risk only. All colours via tokens. No amber/emerald/rose.
 */
import { useMemo } from 'react'
import type { QueryData, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import {
  MetricCard, HeroNumber, KPITile, TierDot,
  DataTable, type DataColumn,
} from '@/components/ui/metric-card'
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

interface RiskSummaryTabProps {
  classifiedData: QueryData[]
  serpSnapshots:  Map<string, SerpSnapshotData>
}

// ── Tier breakdown table ───────────────────────────────────────────────────────

interface TierRow {
  tier:          'high' | 'medium' | 'low'
  desc:          string
  queryCount:    number
  currentClicks: number
  estLost:       number
}

const tierColumns: DataColumn<TierRow>[] = [
  {
    key:    'tier',
    header: 'Tier',
    render: r => (
      <span className="inline-flex items-center gap-2">
        <TierDot tier={r.tier} />
        <span className="text-xs text-muted-foreground">{r.desc}</span>
      </span>
    ),
  },
  {
    key:    'queries',
    header: 'Queries',
    align:  'right',
    render: r => <span className="font-mono text-xs">{r.queryCount.toLocaleString()}</span>,
  },
  {
    key:    'clicks',
    header: 'Curr. Clicks',
    align:  'right',
    render: r => <span className="font-mono text-xs">{r.currentClicks.toLocaleString()}</span>,
  },
  {
    key:    'lost',
    header: 'Est. Lost',
    align:  'right',
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

// ── Category risk row ──────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function RiskSummaryTab({ classifiedData, serpSnapshots }: RiskSummaryTabProps) {
  // All hooks before any conditional return (fixes pre-existing violation)
  const scoredQueries = useMemo((): Array<ScoredQuery & { category: string }> =>
    classifiedData.map(q => ({
      score:          scoreQuery(serpSnapshots.get(q.query) ?? null, q.clicksCurrent, q.clicksPrevious),
      clicksCurrent:  q.clicksCurrent,
      clicksPrevious: q.clicksPrevious,
      category:       q.category,
    })),
  [classifiedData, serpSnapshots])

  const overall = useMemo(() => aggregateRisk(scoredQueries), [scoredQueries])
  const byCat   = useMemo(() => aggregateByCategory(scoredQueries, CATEGORIES), [scoredQueries])

  if (serpSnapshots.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data for this location yet.</p>
        <p className="text-muted-foreground/60 text-xs">
          Enrich SERP data first, then check back here for risk scores.
        </p>
      </div>
    )
  }

  const { blendedComposite, aiComponent, serpComponent, pctQueriesAtRisk,
          buckets, latent, coverage } = overall

  const tierRows: TierRow[] = [
    { tier: 'high',   desc: 'AIO 75%',       queryCount: buckets.high.queryCount,   currentClicks: buckets.high.currentClicks,   estLost: buckets.high.estLostClicks   },
    { tier: 'medium', desc: 'rich 15%\u2020', queryCount: buckets.medium.queryCount, currentClicks: buckets.medium.currentClicks, estLost: buckets.medium.estLostClicks },
    { tier: 'low',    desc: 'clean / news',   queryCount: buckets.low.queryCount,    currentClicks: buckets.low.currentClicks,    estLost: buckets.low.estLostClicks    },
  ]

  return (
    <div className="container py-8 space-y-6">

      {/* ── Row 1: hero + KPI tiles ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        <MetricCard riskAccent className="md:col-span-1">
          <div className="flex flex-col items-center text-center gap-1">
            <HeroNumber
              value={`≈${(blendedComposite * 100).toFixed(1)}%`}
              label="Estimated Click Loss"
              subline="of current clicks lost to SERP features"
              valueClassName="text-risk"
            />
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              = {(aiComponent * 100).toFixed(1)}% AI Overviews
              {' + '}
              {(serpComponent * 100).toFixed(1)}% busy SERPs
            </p>
          </div>
        </MetricCard>

        <MetricCard className="md:col-span-2">
          <div className="grid grid-cols-2 gap-6">
            <KPITile
              label="Queries at Risk"
              value={`${pctQueriesAtRisk.toFixed(1)}%`}
              caption="of scored queries (AIO or rich SERP)"
            />
            <KPITile
              label="Coverage"
              value={coverage.scored.toLocaleString()}
              caption={`of ${coverage.total.toLocaleString()} total · ${coverage.scoredClickPct.toFixed(0)}% of clicks`}
            />
            <KPITile
              label="AI Overview component"
              value={`${(aiComponent * 100).toFixed(1)}%`}
              caption="AIO queries at 75% CTR drop"
              valueClassName="text-risk"
            />
            <KPITile
              label="Rich SERP component"
              value={`${(serpComponent * 100).toFixed(1)}%`}
              caption="video / local / FS at 15% (provisional)"
            />
          </div>
        </MetricCard>
      </div>

      {/* ── Latent callout ────────────────────────────────────────────────── */}
      {(latent?.queryCount ?? 0) > 0 && latent?.composite != null && (
        <MetricCard riskAccent>
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Latent / Recurring Risk</p>
              <p className="text-xs text-muted-foreground mt-1">
                {latent.queryCount.toLocaleString()}{' '}
                {latent.queryCount === 1 ? 'query' : 'queries'} with zero current clicks
                but {(latent.previousClicks ?? 0).toLocaleString()} previous-period clicks, on at-risk SERPs.
                Est. {(latent.estLostLatent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} clicks
                lost when they resurface.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-data-num text-risk tabular-nums">
                ≈{(latent.composite * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">weighted composite</p>
            </div>
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
            footer={
              <p className="text-[10px] text-muted-foreground/50">
                † Medium tier CTR drop is provisional — to be replaced with measured
                pixel-displacement data in Phase 4.5.
              </p>
            }
          />
        </MetricCard>

        <MetricCard title="Tier Logic">
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">High (AIO)</span>
              {' '}— AI Overview present, no Top Stories.
              Estimated 75% CTR loss from organic results.
            </p>
            <p>
              <span className="font-medium text-foreground">Medium (Rich SERP)</span>
              {' '}— AIO + Top Stories co-occurrence (AIO above TS, cannibalises despite carousel),
              or Video / Local Pack / Shopping / Featured Snippet with no AIO. 15% drop.
            </p>
            <p>
              <span className="font-medium text-foreground">Low</span>
              {' '}— Top Stories only (no AIO), or clean SERP with no click-removing features.
              0% modelled loss.
            </p>
            <p className="text-muted-foreground/60">
              AIO + Top Stories → Medium: AIO renders at rank 1 above the Top Stories carousel
              and cannibalises organic CTR even on news SERPs.
            </p>
          </div>
        </MetricCard>
      </div>

      {/* ── Risk by category ──────────────────────────────────────────────── */}
      <MetricCard title="Risk by Category">
        <p className="text-xs text-muted-foreground -mt-2 mb-4">
          News/Entities AI component should be low — Top Stories protection keeps them at Low tier.
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
            {CATEGORIES.map(cat => {
              const agg = byCat.get(cat)
              if (!agg) return null
              return <CategoryRiskRow key={cat} cat={cat} agg={agg} />
            })}
          </tbody>
        </table>
      </MetricCard>

    </div>
  )
}
