/**
 * RiskSummaryTab — Phase 5 tiered CTR-drop risk view.
 *
 * All scoring is client-side via riskScoring.ts (pure, no DB calls).
 * medium tier (rich SERP) is PROVISIONAL until Phase 4.5 pixel-displacement data.
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

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function pctStr(n: number | null | undefined, decimals = 1) {
  return `${(n ?? 0).toFixed(decimals)}%`
}

function TierChip({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      tier === 'high'   && 'bg-rose-500/15 text-rose-400',
      tier === 'medium' && 'bg-amber-500/15 text-amber-400',
      tier === 'low'    && 'bg-emerald-500/15 text-emerald-400',
    )}>
      {tier === 'high' ? 'AIO' : tier === 'medium' ? 'Rich' : 'Low'}
    </span>
  )
}

function MiniBar({ value, max, colorClass }: { value: number; max: number; colorClass: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn('h-full rounded-full', colorClass)} style={{ width: `${w}%` }} />
    </div>
  )
}

// ── Category row ──────────────────────────────────────────────────────────────

function CategoryRow({ cat, agg }: { cat: QueryCategory; agg: AggregateRisk }) {
  const { coverage, blendedComposite, aiComponent, serpComponent, buckets } = agg
  if (coverage.total === 0) return null

  const blendedColor =
    blendedComposite >= 0.50 ? 'text-rose-400'
    : blendedComposite >= 0.15 ? 'text-amber-400'
    : 'text-emerald-400'

  return (
    <tr className="border-t border-border/50">
      <td className="py-2 pr-3"><CategoryBadge category={cat} /></td>
      <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
        {coverage.scored}/{coverage.total}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1">
            <MiniBar
              value={blendedComposite * 100}
              max={100}
              colorClass={blendedComposite >= 0.50 ? 'bg-rose-500' : blendedComposite >= 0.15 ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </div>
          <span className={cn('text-xs font-mono w-9 text-right shrink-0', blendedColor)}>
            {pctStr(blendedComposite * 100, 0)}
          </span>
        </div>
      </td>
      <td className="py-2 pr-3 font-mono text-xs">
        <span className="text-rose-400/80">{pctStr(aiComponent * 100, 0)} AI</span>
        <span className="text-muted-foreground/50 mx-1">+</span>
        <span className="text-amber-400/80">{pctStr(serpComponent * 100, 0)} rich</span>
      </td>
      <td className="py-2 font-mono text-xs text-muted-foreground">
        <span className="text-rose-400">{buckets.high.queryCount}H</span>
        <span className="mx-0.5">·</span>
        <span className="text-amber-400">{buckets.medium.queryCount}M</span>
        <span className="mx-0.5">·</span>
        <span className="text-emerald-400">{buckets.low.queryCount}L</span>
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RiskSummaryTab({ classifiedData, serpSnapshots }: RiskSummaryTabProps) {
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

  // Score every query (scored=false when no snapshot)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const scoredQueries = useMemo((): Array<ScoredQuery & { category: string }> =>
    classifiedData.map(q => ({
      score:          scoreQuery(serpSnapshots.get(q.query) ?? null, q.clicksCurrent, q.clicksPrevious),
      clicksCurrent:  q.clicksCurrent,
      clicksPrevious: q.clicksPrevious,
      category:       q.category,
    })),
  [classifiedData, serpSnapshots])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const overall = useMemo(() => aggregateRisk(scoredQueries), [scoredQueries])
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const byCat   = useMemo(() => aggregateByCategory(scoredQueries, CATEGORIES), [scoredQueries])

  const { blendedComposite, aiComponent, serpComponent, pctQueriesAtRisk,
          buckets, latent, coverage } = overall

  const heroColor =
    blendedComposite >= 0.50 ? 'text-rose-400'
    : blendedComposite >= 0.15 ? 'text-amber-400'
    : 'text-emerald-400'

  return (
    <div className="space-y-6">

      {/* ── Row 1: hero + breakdown ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Hero */}
        <Card className="md:col-span-1">
          <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Estimated Click Loss</p>
            <p className={cn('text-5xl font-bold tabular-nums', heroColor)}>
              ≈{pctStr(blendedComposite * 100, 1)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">of current clicks lost to SERP features</p>
            <div className="w-full mt-3 space-y-1">
              <MiniBar
                value={blendedComposite * 100}
                max={100}
                colorClass={blendedComposite >= 0.50 ? 'bg-rose-500' : blendedComposite >= 0.15 ? 'bg-amber-500' : 'bg-emerald-500'}
              />
            </div>
            {/* Composition line */}
            <p className="text-[11px] text-muted-foreground mt-2 font-mono">
              = <span className="text-rose-400">{pctStr(aiComponent * 100, 1)} AI Overviews</span>
              {' + '}
              <span className="text-amber-400">{pctStr(serpComponent * 100, 1)} busy SERPs</span>
            </p>
          </CardContent>
        </Card>

        {/* Sub-metrics */}
        <Card className="md:col-span-2">
          <CardContent className="pt-6 pb-5 grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">% Queries at Risk</p>
              <p className="text-2xl font-semibold font-mono">{pctStr(pctQueriesAtRisk, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">of scored queries (AIO or rich SERP)</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Coverage</p>
              <p className="text-2xl font-semibold font-mono">{coverage.scored.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                of {coverage.total.toLocaleString()} queries scored
                {' · '}{pctStr(coverage.scoredClickPct, 0)} of clicks
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">AI Overview component</p>
              <p className="text-2xl font-semibold font-mono text-rose-400">{pctStr(aiComponent * 100, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">AIO queries at 75% CTR drop</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Rich SERP component</p>
              <p className="text-2xl font-semibold font-mono text-amber-400">{pctStr(serpComponent * 100, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                video / local / shopping / FS at 15%
                <span className="text-muted-foreground/50 ml-1">(provisional)</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Latent callout ─────────────────────────────────────────────────── */}
      {(latent?.queryCount ?? 0) > 0 && latent?.composite != null && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4 flex items-start gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-400">Latent / Recurring Risk</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {latent.queryCount.toLocaleString()}{' '}
                {latent.queryCount === 1 ? 'query' : 'queries'} with zero current clicks
                but {(latent.previousClicks ?? 0).toLocaleString()} previous-period clicks, on at-risk SERPs.
                Est. {(latent.estLostLatent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} clicks
                lost when they resurface.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold font-mono text-amber-400">
                ≈{pctStr(latent.composite * 100, 1)}
              </p>
              <p className="text-[10px] text-muted-foreground">weighted composite</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Bucket breakdown ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Tier Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left pb-2 font-normal">Tier</th>
                  <th className="text-right pb-2 font-normal">Queries</th>
                  <th className="text-right pb-2 font-normal">Curr. Clicks</th>
                  <th className="text-right pb-2 font-normal">Est. Lost</th>
                </tr>
              </thead>
              <tbody>
                {(['high', 'medium', 'low'] as const).map(t => (
                  <tr key={t} className="border-t border-border/50">
                    <td className="py-2">
                      <TierChip tier={t} />
                      {t === 'high'   && <span className="ml-1.5 text-xs text-muted-foreground">AIO 75%</span>}
                      {t === 'medium' && <span className="ml-1.5 text-xs text-muted-foreground/60">rich 15%†</span>}
                      {t === 'low'    && <span className="ml-1.5 text-xs text-muted-foreground">clean / news</span>}
                    </td>
                    <td className="py-2 text-right font-mono">{buckets[t].queryCount.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">{buckets[t].currentClicks.toLocaleString()}</td>
                    <td className={cn(
                      'py-2 text-right font-mono',
                      t === 'high' ? 'text-rose-400' : t === 'medium' ? 'text-amber-400' : 'text-muted-foreground/40',
                    )}>
                      {buckets[t].estLostClicks > 0
                        ? `~${buckets[t].estLostClicks.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground/50 mt-3">
              † Medium tier CTR drop is provisional — to be replaced with measured
              pixel-displacement data in Phase 4.5.
            </p>
          </CardContent>
        </Card>

        {/* Model note */}
        <Card className="border-dashed opacity-70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Tier Logic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p><span className="text-rose-400 font-medium">High (AIO)</span> — AI Overview present.
              Estimated 75% CTR loss from organic results.</p>
            <p><span className="text-amber-400 font-medium">Medium (Rich SERP)</span> — Video, Local Pack,
              Shopping, or Featured Snippet; no AIO. 15% drop (provisional).</p>
            <p><span className="text-emerald-400 font-medium">Low</span> — Top Stories present (publisher-friendly
              news SERP), or clean SERP with no click-removing features. 0% modelled loss.</p>
            <p className="text-muted-foreground/60">
              Top Stories always resolves Low even when other features also present —
              it signals a news query where the publisher is likely distributed.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Category breakdown ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Risk by Category</CardTitle>
          <p className="text-xs text-muted-foreground">
            News/Entities AI component should be low — Top Stories protection keeps them at Low tier.
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left pb-2 font-normal">Category</th>
                <th className="text-right pb-2 font-normal pr-3">Scored</th>
                <th className="text-left pb-2 font-normal pr-3">Blended</th>
                <th className="text-left pb-2 font-normal pr-3">AI + Rich split</th>
                <th className="text-left pb-2 font-normal">Tiers</th>
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
