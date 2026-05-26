import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBadge } from './CategoryBadge'
import type { QueryData, QueryCategory } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import { cn } from '@/lib/utils'

interface AiSurfacesTabProps {
  classifiedData: QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
  locationCode: number
}

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

function ProgressBar({ value, max, colorClass }: { value: number; max: number; colorClass?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', colorClass ?? 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-10 text-right">{pct}%</span>
    </div>
  )
}

export default function AiSurfacesTab({ classifiedData, serpSnapshots, locationCode: _locationCode }: AiSurfacesTabProps) {
  const enrichedQueries = useMemo(
    () => classifiedData.filter(q => serpSnapshots.has(q.query)),
    [classifiedData, serpSnapshots],
  )

  const enrichedCount = enrichedQueries.length
  const hasData = enrichedCount > 0

  // ── Panel 1: AIO coverage by category ────────────────────────────────────

  const aioCoverage = useMemo(() => {
    return CATEGORIES.map(cat => {
      const catQueries = enrichedQueries.filter(q => q.category === cat)
      const withAio = catQueries.filter(q => serpSnapshots.get(q.query)?.has_ai_overview).length
      const pubInAio = catQueries.filter(q => serpSnapshots.get(q.query)?.publisher_in_ai_overview).length
      return { cat, total: catQueries.length, withAio, pubInAio }
    }).filter(r => r.total > 0)
  }, [enrichedQueries, serpSnapshots])

  // ── Panel 2: Top Stories coverage ────────────────────────────────────────

  const topStoriesCoverage = useMemo(() => {
    return CATEGORIES.map(cat => {
      const catQueries = enrichedQueries.filter(q => q.category === cat)
      const withTS = catQueries.filter(q => serpSnapshots.get(q.query)?.has_top_stories).length
      const pubInTS = catQueries.filter(q => serpSnapshots.get(q.query)?.publisher_in_top_stories).length
      return { cat, total: catQueries.length, withTS, pubInTS }
    }).filter(r => r.total > 0)
  }, [enrichedQueries, serpSnapshots])

  // ── Panel 3: Featured Snippet ownership ──────────────────────────────────

  const fsCoverage = useMemo(() => {
    const withFs = enrichedQueries.filter(q => serpSnapshots.get(q.query)?.has_featured_snippet)
    const pubOwns = withFs.filter(q => serpSnapshots.get(q.query)?.publisher_in_featured_snippet).length
    const competitor = withFs.length - pubOwns
    return { total: withFs.length, pubOwns, competitor }
  }, [enrichedQueries, serpSnapshots])

  // ── Panel 4: SERP busyness ────────────────────────────────────────────────

  const busyness = useMemo(() => {
    const features = [
      { label: 'AI Overview',       key: 'has_ai_overview',       colorClass: 'bg-violet-500' },
      { label: 'Top Stories',       key: 'has_top_stories',       colorClass: 'bg-orange-500' },
      { label: 'Featured Snippet',  key: 'has_featured_snippet',  colorClass: 'bg-cyan-500'   },
    ] as const
    return features.map(f => ({
      label: f.label,
      colorClass: f.colorClass,
      count: enrichedQueries.filter(q => (serpSnapshots.get(q.query) as Record<string, unknown>)?.[f.key]).length,
    }))
  }, [enrichedQueries, serpSnapshots])

  // ── Panel 6: Top competing domains ───────────────────────────────────────

  const topDomains = useMemo(() => {
    const freq = new Map<string, number>()
    for (const q of enrichedQueries) {
      const snap = serpSnapshots.get(q.query)
      if (!snap) continue
      for (const d of snap.top_organic_domains ?? []) {
        freq.set(d, (freq.get(d) ?? 0) + 1)
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
  }, [enrichedQueries, serpSnapshots])

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">
          No SERP data for this location yet.
        </p>
        <p className="text-muted-foreground/60 text-xs">
          Use the Enrich SERP button to fetch data, then check back here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Based on {enrichedCount.toLocaleString()} enriched {enrichedCount === 1 ? 'query' : 'queries'} of {classifiedData.length.toLocaleString()} total.
      </p>

      {/* Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Panel 1 – AIO coverage by category */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">AI Overview Coverage by Category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {aioCoverage.map(({ cat, total, withAio, pubInAio }) => (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between">
                  <CategoryBadge category={cat} />
                  <span className="text-xs text-muted-foreground font-mono">
                    {withAio}/{total} queries
                    {pubInAio > 0 && (
                      <span className="ml-1 text-violet-400">({pubInAio} cited)</span>
                    )}
                  </span>
                </div>
                <ProgressBar value={withAio} max={total} colorClass="bg-violet-500" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Panel 2 – Top Stories coverage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Top Stories Coverage by Category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topStoriesCoverage.map(({ cat, total, withTS, pubInTS }) => (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between">
                  <CategoryBadge category={cat} />
                  <span className="text-xs text-muted-foreground font-mono">
                    {withTS}/{total} queries
                    {pubInTS > 0 && (
                      <span className="ml-1 text-orange-400">({pubInTS} featured)</span>
                    )}
                  </span>
                </div>
                <ProgressBar value={withTS} max={total} colorClass="bg-orange-500" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Panel 3 – Featured Snippet ownership */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Featured Snippet Ownership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Queries with a Featured Snippet</span>
              <span className="font-mono">{fsCoverage.total}</span>
            </div>
            {fsCoverage.total > 0 && (
              <>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Publisher owns</span>
                    <span className="font-mono text-emerald-400">{fsCoverage.pubOwns}</span>
                  </div>
                  <ProgressBar value={fsCoverage.pubOwns} max={fsCoverage.total} colorClass="bg-emerald-500" />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Competitor owns</span>
                    <span className="font-mono text-rose-400">{fsCoverage.competitor}</span>
                  </div>
                  <ProgressBar value={fsCoverage.competitor} max={fsCoverage.total} colorClass="bg-rose-500" />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Panel 4 – SERP feature prevalence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">SERP Feature Prevalence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {busyness.map(({ label, colorClass, count }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{label}</span>
                  <span className="font-mono">{count} / {enrichedCount}</span>
                </div>
                <ProgressBar value={count} max={enrichedCount} colorClass={colorClass} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Panel 5 – Pixel-height placeholder */}
        <Card className="border-dashed opacity-60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Pixel-Displacement Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Coming in Phase 4.5 — measures how far SERP features push organic results below the fold.
            </p>
          </CardContent>
        </Card>

        {/* Panel 6 – Top competing domains */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Top Competing Domains</CardTitle>
          </CardHeader>
          <CardContent>
            {topDomains.length === 0 ? (
              <p className="text-xs text-muted-foreground">No organic domain data available.</p>
            ) : (
              <div className="space-y-1.5">
                {topDomains.map(([domain, count]) => (
                  <div key={domain} className="space-y-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono truncate max-w-[200px]" title={domain}>{domain}</span>
                      <span className="text-muted-foreground font-mono shrink-0 ml-2">{count}</span>
                    </div>
                    <ProgressBar value={count} max={topDomains[0][1]} colorClass="bg-sky-500" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
