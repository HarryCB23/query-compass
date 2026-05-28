/**
 * RiskSummaryTab — Phase 5 traffic-risk view.
 *
 * All scoring is client-side via riskScoring.ts (pure, no DB calls).
 * Receives classifiedData + serpSnapshots as props from ImportView.
 *
 * Metrics:
 *   Current Risk   — Σ(at_risk_current) / Σ(clicks_current) for scored queries
 *   Latent Risk    — weighted composite over dormant queries (clicks_current=0,
 *                    clicks_previous>0), shown only when comparison data exists
 *   Bucket table   — High / Medium / Low breakdown
 *   Category table — per-category current composite + bucket distribution
 *   Coverage line  — "scored N of M queries (Y% of current clicks)"
 */
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBadge } from './CategoryBadge'
import type { QueryData, QueryCategory } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import {
  scoreQuery,
  aggregateRisk,
  aggregateByCategory,
  type ScoredQuery,
  type AggregateRisk,
} from '@/lib/riskScoring'
import { cn } from '@/lib/utils'

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

interface RiskSummaryTabProps {
  classifiedData: QueryData[]
  serpSnapshots:  Map<string, SerpSnapshotData>
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function pct(n: number, decimals = 1) {
  return `${n.toFixed(decimals)}%`
}

function BucketChip({ bucket }: { bucket: 'high' | 'medium' | 'low' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      bucket === 'high'   && 'bg-rose-500/15 text-rose-400',
      bucket === 'medium' && 'bg-amber-500/15 text-amber-400',
      bucket === 'low'    && 'bg-emerald-500/15 text-emerald-400',
    )}>
      {bucket}
    </span>
  )
}

function ProgressBar({ value, max, colorClass }: { value: number; max: number; colorClass?: string }) {
  const pctVal = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', colorClass ?? 'bg-primary')}
        style={{ width: `${pctVal}%` }}
      />
    </div>
  )
}

function CompositeBar({ composite }: { composite: number }) {
  const colorClass =
    composite >= 0.50 ? 'bg-rose-500'
    : composite >= 0.20 ? 'bg-amber-500'
    : 'bg-emerald-500'
  return (
    <div className="space-y-1">
      <ProgressBar value={composite * 100} max={100} colorClass={colorClass} />
    </div>
  )
}

// ── Category row ──────────────────────────────────────────────────────────────

function CategoryRow({ cat, agg }: { cat: QueryCategory; agg: AggregateRisk }) {
  const { coverage, currentComposite, buckets } = agg
  if (coverage.total === 0) return null

  return (
    <tr className="border-t border-border/50">
      <td className="py-2 pr-4">
        <CategoryBadge category={cat} />
      </td>
      <td className="py-2 pr-4 text-right font-mono text-sm">
        {coverage.scored} / {coverage.total}
      </td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="flex-1">
            <CompositeBar composite={currentComposite} />
          </div>
          <span className={cn(
            'text-xs font-mono w-10 text-right shrink-0',
            currentComposite >= 0.50 ? 'text-rose-400'
            : currentComposite >= 0.20 ? 'text-amber-400'
            : 'text-emerald-400',
          )}>
            {pct(currentComposite * 100, 0)}
          </span>
        </div>
      </td>
      <td className="py-2 font-mono text-xs text-muted-foreground">
        <span className="text-rose-400">{buckets.high.queryCount}H</span>
        {' · '}
        <span className="text-amber-400">{buckets.medium.queryCount}M</span>
        {' · '}
        <span className="text-emerald-400">{buckets.low.queryCount}L</span>
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RiskSummaryTab({ classifiedData, serpSnapshots }: RiskSummaryTabProps) {
  const hasSnapshots = serpSnapshots.size > 0

  // Score every query (unscored if no snapshot)
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

  if (!hasSnapshots) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data for this location yet.</p>
        <p className="text-muted-foreground/60 text-xs">
          Enrich SERP data first, then check back here for risk scores.
        </p>
      </div>
    )
  }

  const { currentComposite, pctCurrentClicksAtRisk, pctQueriesAtRisk,
          latentComposite, latentQueryCount, latentClicks,
          buckets, coverage } = overall

  const compositeColor =
    currentComposite >= 0.50 ? 'text-rose-400'
    : currentComposite >= 0.20 ? 'text-amber-400'
    : 'text-emerald-400'

  const showLatent = latentQueryCount > 0 && latentComposite !== null

  return (
    <div className="space-y-6">

      {/* ── Row 1: hero + sub-metrics ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Hero */}
        <Card className="md:col-span-1">
          <CardContent className="pt-6 pb-4 flex flex-col items-center justify-center text-center gap-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Risk</p>
            <p className={cn('text-5xl font-bold tabular-nums', compositeColor)}>
              {pct(pctCurrentClicksAtRisk, 1)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">of current clicks on at-risk SERPs</p>
            <div className="w-full mt-3">
              <CompositeBar composite={currentComposite} />
            </div>
          </CardContent>
        </Card>

        {/* Sub-metrics */}
        <Card className="md:col-span-2">
          <CardContent className="pt-6 pb-4 grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">% Queries at Risk</p>
              <p className="text-2xl font-semibold font-mono">{pct(pctQueriesAtRisk, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">of scored queries (intensity &gt; 0)</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Scored Queries</p>
              <p className="text-2xl font-semibold font-mono">{coverage.scored.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                of {coverage.total.toLocaleString()} total
                {' · '}{pct(coverage.scoredClickPct, 0)} of clicks
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Latent / recurring risk callout ────────────────────────────────── */}
      {showLatent && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 flex items-start gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400">
                Latent / Recurring Risk
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {latentQueryCount.toLocaleString()} recently-active{' '}
                {latentQueryCount === 1 ? 'query' : 'queries'} now at zero current
                clicks ({latentClicks.toLocaleString()} previous-period clicks)
                on at-risk SERPs.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold font-mono text-amber-400">
                {pct(latentComposite * 100, 1)}
              </p>
              <p className="text-[10px] text-muted-foreground">weighted composite</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Row 2: bucket table + category breakdown ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Bucket breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Risk Bucket Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">High ≥50% · Medium 20–50% · Low &lt;20%</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left pb-2 font-normal">Bucket</th>
                  <th className="text-right pb-2 font-normal">Queries</th>
                  <th className="text-right pb-2 font-normal">Current Clicks</th>
                </tr>
              </thead>
              <tbody>
                {(['high', 'medium', 'low'] as const).map(b => (
                  <tr key={b} className="border-t border-border/50">
                    <td className="py-2"><BucketChip bucket={b} /></td>
                    <td className="py-2 text-right font-mono">{buckets[b].queryCount.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">{buckets[b].currentClicks.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Model note */}
        <Card className="border-dashed opacity-70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">How Risk is Calculated</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              <span className="text-foreground/80 font-medium">hostile_weight</span> = multiplicative
              combination of click-removing features (AIO 80%, Local Pack 20%,
              Shopping 20%, Feat. Snippet 10%, Video 10%).
            </p>
            <p>
              <span className="text-foreground/80 font-medium">Top Stories</span> applies
              70% unconditional relief to hostile_weight — not a penalty.
            </p>
            <p>
              <span className="text-foreground/80 font-medium">position_mult</span>:
              pos 1–3 → 1.0 · 4–6 → 0.75 · 7–10 → 0.50 · not ranking → 0.30
            </p>
            <p>
              <span className="text-foreground/80 font-medium">risk_intensity</span> = hostile_weight
              × position_mult. <span className="text-foreground/80 font-medium">at_risk_clicks</span> = clicks
              × risk_intensity.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Category breakdown ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Risk by Category</CardTitle>
          <p className="text-xs text-muted-foreground">
            News and Entities should land Low — that's a sanity check on the model.
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left pb-2 font-normal">Category</th>
                <th className="text-right pb-2 font-normal pr-4">Scored</th>
                <th className="text-left pb-2 font-normal pr-4">Current Risk</th>
                <th className="text-left pb-2 font-normal">Buckets</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map(cat => {
                const agg = byCat.get(cat)
                if (!agg) return null
                return <CategoryRow key={cat} cat={cat} agg={agg} />
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

    </div>
  )
}
