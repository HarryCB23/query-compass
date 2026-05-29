/**
 * OverviewTab — Phase 6.1 single-import overview for client delivery.
 *
 * Sections:
 *   B2. Hero composite (blendedComposite, AI/SERP split, coverage)
 *   B3. News SERP-state snapshot (TS-protected vs exposed, clicks-weighted)
 *   B4. Top 8 loss queries by estLostCurrent
 *   B5. Latent / recurring risk callout
 *   B6. Category breakdown — compact horizontal bars sorted by est. lost clicks
 *
 * All aggregation is client-side via riskScoring.ts (pure, no DB calls).
 * Framing rule: SERP state is temporal ("right now") — never permanent labels.
 */
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBadge } from './CategoryBadge'
import type { QueryData, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import {
  scoreQuery,
  aggregateRisk,
  aggregateByCategory,
  type ScoredQuery,
} from '@/lib/riskScoring'
import { cn } from '@/lib/utils'

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined, decimals = 1): string {
  return `${(n ?? 0).toFixed(decimals)}%`
}

function TierChip({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0',
      tier === 'high'   && 'bg-rose-500/15 text-rose-400',
      tier === 'medium' && 'bg-amber-500/15 text-amber-400',
      tier === 'low'    && 'bg-emerald-500/15 text-emerald-400',
    )}>
      {tier === 'high' ? 'AIO' : tier === 'medium' ? 'Rich' : 'Low'}
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  classifiedData: QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
  onNavigateToQueries: (category?: QueryCategory) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OverviewTab({ classifiedData, serpSnapshots, onNavigateToQueries }: OverviewTabProps) {

  // ── Core aggregation ───────────────────────────────────────────────────────

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

  const heroColor =
    blendedComposite >= 0.50 ? 'text-rose-400'
    : blendedComposite >= 0.15 ? 'text-amber-400'
    : 'text-emerald-400'

  const heroBarColor =
    blendedComposite >= 0.50 ? 'bg-rose-500'
    : blendedComposite >= 0.15 ? 'bg-amber-500'
    : 'bg-emerald-500'

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
      totalQueries:      newsQueries.length,
      enrichedCount:     enriched.length,
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
          query:       q.query,
          category:    q.category as QueryCategory,
          tier:        q.score.tier,
          clicks:      q.clicksCurrent,
          estLost:     q.score.estLostCurrent,
          reasoning:   qData?.classificationReasoning ?? null,
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

  const maxCatLost = useMemo(() => {
    return Math.max(1, ...catRows.map(({ agg }) =>
      agg.buckets.high.estLostClicks + agg.buckets.medium.estLostClicks,
    ))
  }, [catRows])

  // ── Empty state ────────────────────────────────────────────────────────────

  if (coverage.scored === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data enriched yet.</p>
        <p className="text-muted-foreground/60 text-xs">
          Use the Enrich SERP button to fetch SERP data, then check back here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── B2: Hero composite ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Estimated Click Loss</p>
            <p className={cn('text-5xl font-bold tabular-nums', heroColor)}>
              ≈{pct(blendedComposite * 100, 1)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">of current clicks lost to SERP features</p>
            <div className="w-full mt-3">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full', heroBarColor)}
                  style={{ width: `${Math.min(100, blendedComposite * 100)}%` }} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 font-mono">
              = <span className="text-rose-400">{pct(aiComponent * 100, 1)} AI Overviews</span>
              {' + '}
              <span className="text-amber-400">{pct(serpComponent * 100, 1)} busy SERPs</span>
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="pt-6 pb-5 grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Enriched Queries</p>
              <p className="text-2xl font-semibold font-mono">{coverage.scored.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                of {coverage.total.toLocaleString()} total · {pct(coverage.scoredClickPct, 0)} of clicks
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">AI Overview component</p>
              <p className="text-2xl font-semibold font-mono text-rose-400">{pct(aiComponent * 100, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">AIO queries at 75% CTR drop</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Rich SERP component</p>
              <p className="text-2xl font-semibold font-mono text-amber-400">{pct(serpComponent * 100, 1)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">video / local / shopping / FS at 15%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Est. lost clicks</p>
              <p className="text-2xl font-semibold font-mono">
                ~{Math.round(
                  (overall.buckets.high.estLostClicks + overall.buckets.medium.estLostClicks)
                ).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">across enriched queries</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── B3: News SERP-state snapshot ─────────────────────────────────── */}
      {newsSerpState && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Your news coverage right now</CardTitle>
            {newsSerpState.lowCoverage && (
              <p className="text-xs text-muted-foreground/60">
                Based on {newsSerpState.enrichedCount} of {newsSerpState.totalQueries} news queries enriched
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Two-segment bar */}
            <div className="h-3 w-full rounded-full overflow-hidden flex gap-px">
              <div
                className="bg-emerald-500/70 rounded-l-full"
                style={{ width: `${newsSerpState.withTS.pct}%` }}
                title={`Top Stories present — ${pct(newsSerpState.withTS.pct)} of news clicks`}
              />
              <div
                className="bg-amber-500/70 rounded-r-full flex-1"
                title={`No Top Stories — ${pct(newsSerpState.withoutTS.pct)} of news clicks`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex gap-2 items-start">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70 mt-1 shrink-0" />
                <div>
                  <p className="font-medium">
                    {pct(newsSerpState.withTS.pct, 0)} of news traffic
                  </p>
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
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70 mt-1 shrink-0" />
                <div>
                  <p className="font-medium">
                    {pct(newsSerpState.withoutTS.pct, 0)} of news traffic
                  </p>
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

            <p className="text-[11px] text-muted-foreground/50">
              SERP state is captured at enrichment time and may shift as news cycles change.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── B5: Latent callout ───────────────────────────────────────────── */}
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
                ≈{pct(latent.composite * 100, 1)}
              </p>
              <p className="text-[10px] text-muted-foreground">weighted composite</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── B4: Top loss queries ─────────────────────────────────────────── */}
      {topLossQueries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Top queries by estimated click loss</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topLossQueries.map((q, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-t border-border/50 first:border-0">
                  <span className="text-xs text-muted-foreground/40 font-mono w-4 shrink-0 pt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{q.query}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <CategoryBadge category={q.category} />
                      <TierChip tier={q.tier} />
                      <span className="text-[11px] text-muted-foreground">
                        {q.clicks.toLocaleString()} clicks
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn(
                      'text-sm font-mono font-semibold',
                      q.tier === 'high' ? 'text-rose-400' : 'text-amber-400',
                    )}>
                      ~{Math.round(q.estLost).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">est. lost</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/50">
              <button
                onClick={() => onNavigateToQueries()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all in Queries tab →
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── B6: Category breakdown ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Risk by category</CardTitle>
          <p className="text-xs text-muted-foreground">Sorted by estimated click loss · click category to filter Queries tab</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {catRows.map(({ cat, agg }) => {
              const estLost = agg.buckets.high.estLostClicks + agg.buckets.medium.estLostClicks
              const barW    = maxCatLost > 0 ? (estLost / maxCatLost) * 100 : 0
              const barColor =
                agg.blendedComposite >= 0.50 ? 'bg-rose-500'
                : agg.blendedComposite >= 0.15 ? 'bg-amber-500'
                : 'bg-emerald-500'

              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => onNavigateToQueries(cat)}
                      className="shrink-0 hover:opacity-80 transition-opacity"
                      title={`View ${CATEGORY_LABELS[cat]} queries`}
                    >
                      <CategoryBadge category={cat} />
                    </button>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', barColor)} style={{ width: `${barW}%` }} />
                    </div>
                    <span className={cn(
                      'text-xs font-mono w-12 text-right shrink-0',
                      agg.blendedComposite >= 0.50 ? 'text-rose-400'
                      : agg.blendedComposite >= 0.15 ? 'text-amber-400'
                      : 'text-muted-foreground',
                    )}>
                      {pct(agg.blendedComposite * 100, 0)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-1">
                    {agg.coverage.total.toLocaleString()} queries
                    {agg.coverage.total > 0 && ` · ${agg.buckets.high.currentClicks + agg.buckets.medium.currentClicks + agg.buckets.low.currentClicks} clicks`}
                    {estLost > 0 && (
                      <span className={agg.blendedComposite >= 0.50 ? ' text-rose-400/70' : ' text-amber-400/70'}>
                        {' '}· ~{Math.round(estLost).toLocaleString()} est. lost
                      </span>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
