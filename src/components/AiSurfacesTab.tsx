/**
 * AiSurfacesTab — Phase 6.2c redesign on design system.
 * Red = AI-driven risk only. All colours via tokens. No ad-hoc colours.
 *
 * Panel A — Coverage by category (grouped vertical bar: AIO red, TS dark grey)
 * Panel B — SERP feature prevalence (KPITiles, category-filtered)
 * Panel C — Featured Snippet ownership (DonutChart, category-filtered)
 * Panel D — Top competing domains (bar list, category-filtered)
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { MetricCard, KPITile, type DataColumn, DataTable } from '@/components/ui/metric-card'
import {
  GroupedVerticalBarChart, DonutChart,
  RISK_COLOR, NEUTRAL_COLOR, MUTED_COLOR,
  type GroupedBarSeries, type DonutSegment,
} from '@/components/ui/charts'
import type { QueryData, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import type { SerpSnapshotData } from './QueryTable'
import { CompetitorMatrix } from './CompetitorMatrix'
import { cn } from '@/lib/utils'

interface AiSurfacesTabProps {
  classifiedData: QueryData[]
  serpSnapshots:  Map<string, SerpSnapshotData>
  locationCode:   number
}

const CATEGORIES: QueryCategory[] = [
  'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other',
]

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AiSurfacesTab({ classifiedData, serpSnapshots, locationCode: _locationCode }: AiSurfacesTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<QueryCategory | null>(null)

  const enrichedQueries = useMemo(
    () => classifiedData.filter(q => serpSnapshots.has(q.query)),
    [classifiedData, serpSnapshots],
  )

  const activeQueries = useMemo(
    () => selectedCategory ? enrichedQueries.filter(q => q.category === selectedCategory) : enrichedQueries,
    [enrichedQueries, selectedCategory],
  )

  const enrichedCount = enrichedQueries.length
  const activeCount   = activeQueries.length
  const hasData = enrichedCount > 0

  function toggleCategory(cat: QueryCategory) {
    setSelectedCategory(prev => prev === cat ? null : cat)
  }

  // ── Panel A: coverage by category — always unfiltered ─────────────────────

  const coverageChartData = useMemo(() => {
    return CATEGORIES.map(cat => {
      const catQ  = enrichedQueries.filter(q => q.category === cat)
      const total = catQ.length
      if (total === 0) return null
      const withAio = catQ.filter(q => serpSnapshots.get(q.query)?.has_ai_overview).length
      const withTS  = catQ.filter(q => serpSnapshots.get(q.query)?.has_top_stories).length
      return {
        label: CATEGORY_LABELS[cat].replace('/', '/\u200B'),   // allow line-break on slash
        aio:   Math.round((withAio / total) * 100),
        ts:    Math.round((withTS  / total) * 100),
      }
    }).filter(Boolean) as Array<{ label: string; aio: number; ts: number }>
  }, [enrichedQueries, serpSnapshots])

  const coverageSeries: GroupedBarSeries[] = [
    { key: 'aio', name: 'AI Overview',  color: RISK_COLOR    },
    { key: 'ts',  name: 'Top Stories',  color: NEUTRAL_COLOR },
  ]

  // ── Panel B: SERP feature prevalence (filtered) ───────────────────────────

  const serpPrevalence = useMemo(() => {
    const n   = activeCount
    const aio = activeQueries.filter(q => serpSnapshots.get(q.query)?.has_ai_overview).length
    const ts  = activeQueries.filter(q => serpSnapshots.get(q.query)?.has_top_stories).length
    const fs  = activeQueries.filter(q => serpSnapshots.get(q.query)?.has_featured_snippet).length
    return { aio, ts, fs, n }
  }, [activeQueries, serpSnapshots, activeCount])

  // ── Panel C: Featured Snippet ownership (filtered) ────────────────────────

  const fsCoverage = useMemo(() => {
    const withFs    = activeQueries.filter(q => serpSnapshots.get(q.query)?.has_featured_snippet)
    const pubOwns   = withFs.filter(q => serpSnapshots.get(q.query)?.publisher_in_featured_snippet).length
    const competitor = withFs.length - pubOwns
    return { total: withFs.length, pubOwns, competitor }
  }, [activeQueries, serpSnapshots])

  const fsSegments: DonutSegment[] = useMemo(() => [
    { value: fsCoverage.pubOwns,    color: NEUTRAL_COLOR, label: 'Publisher owns'  },
    { value: fsCoverage.competitor, color: RISK_COLOR,    label: 'Competitor owns' },
  ], [fsCoverage])

  const fsCenterPct = fsCoverage.total > 0
    ? Math.round((fsCoverage.competitor / fsCoverage.total) * 100)
    : 0
  const fsCenterIsCompetitor = fsCoverage.total === 0 || fsCoverage.competitor >= fsCoverage.pubOwns


  // ── Empty state ───────────────────────────────────────────────────────────

  if (!hasData) {
    return (
      <div className="container py-8 flex flex-col items-center justify-center py-24 text-center gap-3">
        <p className="text-muted-foreground text-sm">No SERP data for this location yet.</p>
        <p className="text-muted-foreground/60 text-xs">
          Use the Enrich SERP button to fetch data, then check back here.
        </p>
      </div>
    )
  }

  const pct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}%` : '0%'

  return (
    <div className="container py-8 space-y-6">

      {/* ── Panel A — coverage by category (unfiltered) ───────────────────── */}
      <MetricCard title="Coverage by category">
        {/* Legend */}
        <div className="flex items-center gap-6 mb-4">
          {coverageSeries.map(s => (
            <div key={s.key} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              {s.name}
            </div>
          ))}
          <span className="text-xs text-muted-foreground/60 ml-auto">% of enriched queries in each category</span>
        </div>
        <GroupedVerticalBarChart data={coverageChartData} series={coverageSeries} />
      </MetricCard>

      {/* ── Category filter (for Panels B, C, D) ─────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filter by category:</span>
        <button
          onClick={() => setSelectedCategory(null)}
          className={cn(
            'px-3 py-1 text-xs rounded-md border transition-colors',
            selectedCategory === null
              ? 'bg-foreground text-background border-foreground'
              : 'bg-background border-border text-muted-foreground hover:text-foreground',
          )}
        >
          All
        </button>
        {CATEGORIES.filter(cat => enrichedQueries.some(q => q.category === cat)).map(cat => (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            className={cn(
              'px-3 py-1 text-xs rounded-md border transition-colors',
              selectedCategory === cat
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground/60">
          {selectedCategory
            ? `${activeCount.toLocaleString()} of ${enrichedCount.toLocaleString()} queries`
            : `${enrichedCount.toLocaleString()} enriched ${enrichedCount === 1 ? 'query' : 'queries'}`}
        </span>
      </div>

      {/* ── Panels B + C ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Panel B — SERP feature prevalence */}
        <MetricCard title="SERP feature prevalence">
          <div className="grid grid-cols-3 gap-4">
            <KPITile
              label="AI Overview"
              value={serpPrevalence.aio.toLocaleString()}
              caption={`${pct(serpPrevalence.aio, serpPrevalence.n)} of enriched queries`}
              valueClassName="text-risk"
            />
            <KPITile
              label="Top Stories"
              value={serpPrevalence.ts.toLocaleString()}
              caption={`${pct(serpPrevalence.ts, serpPrevalence.n)} of enriched queries`}
            />
            <KPITile
              label="Featured Snippet"
              value={serpPrevalence.fs.toLocaleString()}
              caption={`${pct(serpPrevalence.fs, serpPrevalence.n)} of enriched queries`}
            />
          </div>
        </MetricCard>

        {/* Panel C — Featured Snippet ownership */}
        <MetricCard title="Featured Snippet ownership">
          {fsCoverage.total === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No Featured Snippets in this selection.
            </p>
          ) : (
            <div className="flex items-center gap-8">
              <DonutChart
                segments={fsSegments}
                centerLabel={fsCenterIsCompetitor ? `${fsCenterPct}%` : `${100 - fsCenterPct}%`}
                centerSubline={fsCenterIsCompetitor ? 'competitor' : 'publisher'}
                size={140}
              />
              <div className="space-y-3 flex-1">
                {fsSegments.map(s => {
                  const count = s.label === 'Publisher owns' ? fsCoverage.pubOwns : fsCoverage.competitor
                  const p = Math.round((count / fsCoverage.total) * 100)
                  return (
                    <div key={s.label} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-muted-foreground flex-1">{s.label}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                      <span className="text-muted-foreground text-xs w-8 text-right">{p}%</span>
                    </div>
                  )
                })}
                <p className="text-[10px] text-muted-foreground/60 pt-1">
                  of {fsCoverage.total} queries with a Featured Snippet
                </p>
              </div>
            </div>
          )}
        </MetricCard>
      </div>

      {/* ── Panel D — competitor matrix ───────────────────────────────────── */}
      <MetricCard title="Top competing domains">
        <CompetitorMatrix queries={activeQueries} serpSnapshots={serpSnapshots} />
      </MetricCard>

    </div>
  )
}
