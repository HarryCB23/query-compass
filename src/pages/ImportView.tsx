/**
 * ImportView — loads a single import from the DB and runs local pattern
 * classification. No AI toggle, no inline branded-terms editor (use
 * Project Settings to change branded terms).
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { classifyQuery } from '@/lib/queryClassifier'
import { StatCard } from '@/components/StatCard'
import { CategoryDistributionChart } from '@/components/CategoryDistributionChart'
import { CategoryChangeChart } from '@/components/CategoryChangeChart'
import { CategoryMetricCards } from '@/components/CategoryMetricCards'
import { CategoryMetricsPanel } from '@/components/CategoryMetricsPanel'
import { QueryTable } from '@/components/QueryTable'
import { CategoryFilter } from '@/components/CategoryFilter'
import { EntityExplorer } from '@/components/EntityExplorer'
import { TopShiftingQueries } from '@/components/TopShiftingQueries'
import { SectionHeader } from '@/components/SectionHeader'
import { Button } from '@/components/ui/button'
import { ArrowLeft, BarChart3, TrendingUp, MousePointer, Eye, Search, Target, Percent, Users, Filter, Download } from 'lucide-react'
import type { QueryData, CategoryStats, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import { toast } from 'sonner'

export default function ImportView() {
  const { projectId, importId } = useParams<{ projectId: string; importId: string }>()
  const navigate = useNavigate()

  const [projectName, setProjectName]     = useState<string>('')
  const [brandedTerms, setBrandedTerms]   = useState<string[]>([])
  const [queryData, setQueryData]         = useState<QueryData[]>([])
  const [loading, setLoading]             = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<QueryCategory | 'all'>('all')
  const [entityFilter, setEntityFilter]   = useState<string | null>(null)

  // Load project (for branded terms) + import_queries joined to queries
  useEffect(() => {
    if (!projectId || !importId) return
    setLoading(true)

    Promise.all([
      supabase.from('projects').select('client_name, branded_terms').eq('id', projectId).single(),
      supabase
        .from('import_queries')
        .select(`
          clicks_current, impressions_current, ctr_current, position_current,
          clicks_previous, impressions_previous, ctr_previous, position_previous,
          queries!inner(query_text)
        `)
        .eq('import_id', importId)
        .limit(50_000),
    ]).then(([{ data: proj }, { data: rows, error: rowErr }]) => {
      if (proj) {
        setProjectName(proj.client_name)
        setBrandedTerms(proj.branded_terms)
      }
      if (rowErr) { toast.error('Failed to load import: ' + rowErr.message); setLoading(false); return }
      if (!rows) { setLoading(false); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: QueryData[] = rows.map((r: any) => {
        const query = r.queries.query_text as string
        const clicksCurrent       = r.clicks_current       ?? 0
        const clicksPrevious      = r.clicks_previous      ?? 0
        const impressionsCurrent  = r.impressions_current  ?? 0
        const impressionsPrevious = r.impressions_previous ?? 0
        // CTR stored as fraction in DB — multiply by 100 for display
        const ctrCurrent          = r.ctr_current   != null ? r.ctr_current * 100   : null
        const ctrPrevious         = r.ctr_previous  != null ? r.ctr_previous * 100  : null
        const positionCurrent     = r.position_current  ?? null
        const positionPrevious    = r.position_previous ?? null
        const clicksChange        = clicksCurrent - clicksPrevious
        const clicksChangePercent = clicksPrevious > 0
          ? ((clicksCurrent - clicksPrevious) / clicksPrevious) * 100
          : clicksCurrent > 0 ? 100 : 0
        const impressionsChange        = impressionsCurrent - impressionsPrevious
        const impressionsChangePercent = impressionsPrevious > 0
          ? ((impressionsCurrent - impressionsPrevious) / impressionsPrevious) * 100
          : impressionsCurrent > 0 ? 100 : 0

        return {
          query,
          clicksCurrent,
          clicksPrevious,
          impressionsCurrent,
          impressionsPrevious,
          ctrCurrent,
          ctrPrevious,
          positionCurrent,
          positionPrevious,
          category: 'other' as QueryCategory,
          clicksChange,
          clicksChangePercent,
          impressionsChange,
          impressionsChangePercent,
        }
      })

      setQueryData(parsed)
      setLoading(false)
    })
  }, [projectId, importId])

  // Re-classify whenever branded terms or raw data changes
  const classifiedData = useMemo((): QueryData[] =>
    queryData.map(q => ({
      ...q,
      category: classifyQuery(q.query, { brandedTerms }),
    })),
  [queryData, brandedTerms])

  // Category stats (weighted-average position, null-safe)
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: QueryCategory[] = ['branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other']
    return categories.map(category => {
      const qs = classifiedData.filter(q => q.category === category)
      const totalClicksCurrent       = qs.reduce((s, q) => s + q.clicksCurrent,  0)
      const totalClicksPrevious      = qs.reduce((s, q) => s + q.clicksPrevious, 0)
      const totalImpressionsCurrent  = qs.reduce((s, q) => s + q.impressionsCurrent,  0)
      const totalImpressionsPrevious = qs.reduce((s, q) => s + q.impressionsPrevious, 0)

      const posCur  = qs.filter(q => q.positionCurrent  != null)
      const posPrev = qs.filter(q => q.positionPrevious != null)
      const posWtCur  = posCur.reduce((s, q) => s + q.impressionsCurrent,  0)
      const posWtPrev = posPrev.reduce((s, q) => s + q.impressionsPrevious, 0)
      const avgPositionCurrent  = posWtCur  > 0 ? posCur.reduce((s, q)  => s + q.positionCurrent!  * q.impressionsCurrent,  0) / posWtCur  : 0
      const avgPositionPrevious = posWtPrev > 0 ? posPrev.reduce((s, q) => s + q.positionPrevious! * q.impressionsPrevious, 0) / posWtPrev : 0

      const avgCtrCurrent  = totalImpressionsCurrent  > 0 ? (totalClicksCurrent  / totalImpressionsCurrent)  * 100 : 0
      const avgCtrPrevious = totalImpressionsPrevious > 0 ? (totalClicksPrevious / totalImpressionsPrevious) * 100 : 0

      const clicksChange            = totalClicksCurrent - totalClicksPrevious
      const clicksChangePercent     = totalClicksPrevious > 0 ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 : totalClicksCurrent > 0 ? 100 : 0
      const impressionsChangePercent= totalImpressionsPrevious > 0 ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 : totalImpressionsCurrent > 0 ? 100 : 0
      const positionChange          = avgPositionPrevious > 0 ? ((avgPositionCurrent - avgPositionPrevious) / avgPositionPrevious) * 100 : 0
      const ctrChange               = avgCtrPrevious > 0 ? ((avgCtrCurrent - avgCtrPrevious) / avgCtrPrevious) * 100 : avgCtrCurrent > 0 ? 100 : 0

      return {
        category,
        totalClicksCurrent, totalClicksPrevious,
        totalImpressionsCurrent, totalImpressionsPrevious,
        queryCount: qs.length,
        clicksChange, clicksChangePercent, impressionsChangePercent,
        avgPositionCurrent, avgPositionPrevious, positionChange,
        avgCtrCurrent, avgCtrPrevious, ctrChange,
      }
    })
  }, [classifiedData])

  const overallStats = useMemo(() => {
    const totalClicksCurrent       = classifiedData.reduce((s, q) => s + q.clicksCurrent,  0)
    const totalClicksPrevious      = classifiedData.reduce((s, q) => s + q.clicksPrevious, 0)
    const totalImpressionsCurrent  = classifiedData.reduce((s, q) => s + q.impressionsCurrent,  0)
    const totalImpressionsPrevious = classifiedData.reduce((s, q) => s + q.impressionsPrevious, 0)

    const posCur  = classifiedData.filter(q => q.positionCurrent  != null)
    const posPrev = classifiedData.filter(q => q.positionPrevious != null)
    const posWtCur  = posCur.reduce((s, q) => s + q.impressionsCurrent,  0)
    const posWtPrev = posPrev.reduce((s, q) => s + q.impressionsPrevious, 0)
    const avgPositionCurrent  = posWtCur  > 0 ? posCur.reduce((s, q)  => s + q.positionCurrent!  * q.impressionsCurrent,  0) / posWtCur  : 0
    const avgPositionPrevious = posWtPrev > 0 ? posPrev.reduce((s, q) => s + q.positionPrevious! * q.impressionsPrevious, 0) / posWtPrev : 0

    const clicksChange      = totalClicksPrevious      > 0 ? ((totalClicksCurrent - totalClicksPrevious)           / totalClicksPrevious)      * 100 : 0
    const impressionsChange = totalImpressionsPrevious > 0 ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 : 0
    const positionChange    = avgPositionPrevious       > 0 ? ((avgPositionCurrent - avgPositionPrevious)           / avgPositionPrevious)       * 100 : 0

    return { totalClicksCurrent, totalClicksPrevious, totalImpressionsCurrent, totalImpressionsPrevious, clicksChange, impressionsChange, queryCount: classifiedData.length, avgPositionCurrent, avgPositionPrevious, positionChange }
  }, [classifiedData])

  const selectedCategoryStats = useMemo(() =>
    categoryFilter === 'all' ? null : categoryStats.find(s => s.category === categoryFilter) ?? null,
  [categoryFilter, categoryStats])

  const categoryCounts = useMemo(() => {
    const counts: Record<QueryCategory | 'all', number> = { all: classifiedData.length, branded: 0, informational: 0, news: 0, product: 0, commercial: 0, transactional: 0, other: 0 }
    classifiedData.forEach(q => { counts[q.category]++ })
    return counts
  }, [classifiedData])

  const handleDownloadCSV = useCallback(() => {
    const headers = ['Query','Category','Clicks (Current)','Clicks (Previous)','Clicks Change','Clicks Change %','Impressions (Current)','Impressions (Previous)','CTR (Current)','CTR (Previous)','Position (Current)','Position (Previous)']
    const rows = classifiedData.map(r => [
      `"${r.query.replace(/"/g, '""')}"`,
      r.category,
      r.clicksCurrent, r.clicksPrevious,
      r.clicksChange, r.clicksChangePercent.toFixed(2),
      r.impressionsCurrent, r.impressionsPrevious,
      r.ctrCurrent != null ? r.ctrCurrent.toFixed(2) : '',
      r.ctrPrevious != null ? r.ctrPrevious.toFixed(2) : '',
      r.positionCurrent != null ? r.positionCurrent.toFixed(2) : '',
      r.positionPrevious != null ? r.positionPrevious.toFixed(2) : '',
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `import-${importId}-classified.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    toast.success('CSV downloaded')
  }, [classifiedData, importId])

  if (loading) return <p className="text-muted-foreground text-center py-20">Loading import…</p>

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${projectId}`)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold text-foreground">{projectName}</h1>
              <p className="text-xs text-muted-foreground">Import analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleDownloadCSV} variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />Download CSV
            </Button>
            <Link to={`/projects/${projectId}/settings`}>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Edit branded terms in Settings
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-8 animate-fade-in">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Queries"      value={overallStats.queryCount}              icon={<Search   className="w-5 h-5 text-primary" />} />
          <StatCard title="Total Clicks"       value={overallStats.totalClicksCurrent}      change={overallStats.clicksChange}      icon={<MousePointer className="w-5 h-5 text-primary" />} />
          <StatCard title="Total Impressions"  value={overallStats.totalImpressionsCurrent} change={overallStats.impressionsChange}  icon={<Eye      className="w-5 h-5 text-primary" />} />
          <StatCard title="Biggest Shift"
            value={CATEGORY_LABELS[[...categoryStats].sort((a, b) => Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent))[0]?.category ?? 'other']}
            change={[...categoryStats].sort((a, b) => Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent))[0]?.clicksChangePercent ?? 0}
            icon={<TrendingUp className="w-5 h-5 text-primary" />}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 glass-card">
            <SectionHeader icon={<BarChart3 className="w-4 h-4" />} title="Clicks by Category" />
            <CategoryDistributionChart stats={categoryStats} dataKey="clicks" />
          </div>
          <div className="p-6 glass-card">
            <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Category Change (% Clicks)" />
            <CategoryChangeChart stats={categoryStats} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 glass-card">
            <SectionHeader icon={<Target className="w-4 h-4" />} title="Average Position by Category" subtitle="(lower is better)" />
            <CategoryMetricCards stats={categoryStats} metric="position" />
          </div>
          <div className="p-6 glass-card">
            <SectionHeader icon={<Percent className="w-4 h-4" />} title="CTR by Category" />
            <CategoryMetricCards stats={categoryStats} metric="ctr" />
          </div>
        </div>

        {/* Entity explorer */}
        <div className="p-6 glass-card">
          <SectionHeader icon={<Users className="w-4 h-4" />} title="News Entity Explorer" subtitle="Click an entity to see performance" />
          <EntityExplorer queries={classifiedData} onEntitySelect={(entity, queries) => {
            setEntityFilter(entity); setCategoryFilter('news')
            toast.success(`Filtered to "${entity}" — ${queries.length} queries`)
          }} />
        </div>

        {/* Category filter */}
        <div className="p-6 glass-card">
          <SectionHeader icon={<Filter className="w-4 h-4" />} title="Filter by Category" subtitle={entityFilter ? `Filtered: "${entityFilter}"` : undefined} />
          {entityFilter && (
            <Button variant="ghost" size="sm" onClick={() => setEntityFilter(null)} className="text-xs mb-4">
              Clear entity filter
            </Button>
          )}
          <CategoryFilter
            selected={categoryFilter}
            onChange={cat => { setCategoryFilter(cat); if (cat !== 'news') setEntityFilter(null) }}
            counts={categoryCounts}
          />
        </div>

        {selectedCategoryStats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CategoryMetricsPanel stats={selectedCategoryStats} />
            <div className="p-6 glass-card">
              <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Top 20 Shifting Queries" subtitle="by absolute click change" />
              <div className="max-h-80 overflow-y-auto">
                <TopShiftingQueries queries={classifiedData} category={categoryFilter as QueryCategory} limit={20} />
              </div>
            </div>
          </div>
        )}

        {/* Query table */}
        <div className="p-6 glass-card">
          <SectionHeader icon={<Search className="w-4 h-4" />} title="Query Details" subtitle={entityFilter ? `Filtered by "${entityFilter}"` : undefined} />
          <QueryTable
            data={entityFilter ? classifiedData.filter(q => q.query.toLowerCase().includes(entityFilter.toLowerCase())) : classifiedData}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
          />
        </div>
      </main>
    </div>
  )
}
