/**
 * ImportView — loads a single import from the DB, fetches AI classifications
 * from the classifications table, and merges them with client-side branded
 * term detection as a fallback for unclassified queries.
 *
 * Classification precedence: DB (ai-haiku) > DB (pattern) > client-side branded check
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { CLASSIFIER_PROMPT_VERSION } from '@/lib/classifierVersion'
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
import {
  ArrowLeft, BarChart3, TrendingUp, MousePointer, Eye, Search,
  Target, Percent, Users, Filter, Download, Sparkles, Loader2,
} from 'lucide-react'
import { UserMenu } from '@/components/UserMenu'
import type { QueryData, CategoryStats, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import { toast } from 'sonner'

interface ClassificationInfo {
  category: QueryCategory
  source: 'ai-haiku' | 'pattern'
  reasoning: string | null
}

export default function ImportView() {
  const { projectId, importId } = useParams<{ projectId: string; importId: string }>()
  const navigate = useNavigate()

  const [projectName, setProjectName]         = useState<string>('')
  const [brandedTerms, setBrandedTerms]       = useState<string[]>([])
  const [queryData, setQueryData]             = useState<QueryData[]>([])
  const [classifications, setClassifications] = useState<Map<string, ClassificationInfo>>(new Map())
  const [loading, setLoading]                 = useState(true)
  const [classifyState, setClassifyState]     = useState<'idle' | 'classifying' | 'done'>('idle')
  const [classifyProgress, setClassifyProgress] = useState('')
  const [categoryFilter, setCategoryFilter]   = useState<QueryCategory | 'all'>('all')
  const [entityFilter, setEntityFilter]       = useState<string | null>(null)

  // Stable ref — holds query_id data so handleClassify can re-fetch classifications
  // without needing ids/idToText in its dependency array.
  const queryIdDataRef = useRef<{ ids: string[]; idToText: Map<string, string> }>({
    ids: [],
    idToText: new Map(),
  })

  // ── Fetch classifications from DB ──────────────────────────────────────────
  // Chunked .in() at 100 UUIDs. Prefers ai-haiku over pattern when both exist.
  // Returns a Map keyed by query_text for direct merge into QueryData.

  const loadClassifications = useCallback(async (
    ids: string[],
    idToText: Map<string, string>,
  ) => {
    if (ids.length === 0) return
    const CHUNK = 100
    const rawMap = new Map<string, ClassificationInfo>()

    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await supabase
        .from('classifications')
        .select('query_id, category, model_version, reasoning')
        .in('query_id', ids.slice(i, i + CHUNK))
        .or(`prompt_version.eq.${CLASSIFIER_PROMPT_VERSION},model_version.eq.pattern`)

      if (!data) continue
      for (const row of data) {
        const source: 'ai-haiku' | 'pattern' =
          (row.model_version as string).startsWith('claude-') ? 'ai-haiku' : 'pattern'
        const existing = rawMap.get(row.query_id)
        // ai-haiku beats pattern; first write wins within same tier
        if (!existing || (source === 'ai-haiku' && existing.source !== 'ai-haiku')) {
          rawMap.set(row.query_id, {
            category: row.category as QueryCategory,
            source,
            reasoning: (row.reasoning as string | null) ?? null,
          })
        }
      }
    }

    // Re-key from query_id → query_text for useMemo merge
    const textMap = new Map<string, ClassificationInfo>()
    for (const [qid, info] of rawMap) {
      const text = idToText.get(qid)
      if (text) textMap.set(text, info)
    }
    setClassifications(textMap)
  }, [])

  // ── "Classify with Claude" handler — client-driven chunking ───────────────

  const handleClassify = useCallback(async () => {
    if (!projectId || !importId) return
    setClassifyState('classifying')
    setClassifyProgress('')

    const CHUNK_SIZE = 150
    const total = queryData.length
    let processed = 0

    try {
      while (processed < total) {
        setClassifyProgress(`Classifying ${processed.toLocaleString()} of ${total.toLocaleString()} queries…`)

        let result = await supabase.functions.invoke('classify-queries', {
          body: { import_id: importId, project_id: projectId, offset: processed, limit: CHUNK_SIZE },
        })

        if (result.error) {
          const errMsg = result.error instanceof Error ? result.error.message : String(result.error)
          if (errMsg.includes('401') || errMsg.toLowerCase().includes('unauthorized')) {
            await supabase.auth.refreshSession()
            result = await supabase.functions.invoke('classify-queries', {
              body: { import_id: importId, project_id: projectId, offset: processed, limit: CHUNK_SIZE },
            })
          }
          if (result.error) throw result.error
        }

        processed += Math.min(CHUNK_SIZE, total - processed)
      }

      setClassifyProgress('')
      const { ids, idToText } = queryIdDataRef.current
      await loadClassifications(ids, idToText)
      setClassifyState('done')
      toast.success(`${total.toLocaleString()} quer${total === 1 ? 'y' : 'ies'} classified`)
    } catch (err) {
      setClassifyProgress('')
      toast.error('Classification failed: ' + (err instanceof Error ? err.message : String(err)))
      setClassifyState('idle')
    }
  }, [projectId, importId, queryData.length, loadClassifications])

  // ── Load project + import_queries, then classifications ───────────────────

  useEffect(() => {
    if (!projectId || !importId) return
    setLoading(true)
    setClassifyState('idle')

    const PAGE_SIZE = 1000

    const fetchAllRows = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRows: any[] = []
      let page = 0
      while (true) {
        const from = page * PAGE_SIZE
        const { data, error } = await supabase
          .from('import_queries')
          .select(`
            query_id,
            clicks_current, impressions_current, ctr_current, position_current,
            clicks_previous, impressions_previous, ctr_previous, position_previous,
            queries!inner(query_text)
          `)
          .eq('import_id', importId)
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        if (data && data.length > 0) allRows.push(...data)
        if (!data || data.length < PAGE_SIZE) break
        page++
      }
      return allRows
    }

    Promise.all([
      supabase.from('projects').select('client_name, branded_terms').eq('id', projectId).single(),
      fetchAllRows(),
    ]).then(async ([{ data: proj }, rows]) => {
      if (proj) {
        setProjectName(proj.client_name)
        setBrandedTerms(proj.branded_terms)
      }
      if (!rows) { setLoading(false); return }

      // Build query_id ↔ query_text maps for classification lookup + re-fetch
      const idToText = new Map<string, string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rows as any[]) {
        idToText.set(r.query_id as string, (r.queries as { query_text: string }).query_text)
      }
      const ids = Array.from(idToText.keys())
      queryIdDataRef.current = { ids, idToText }

      // Parse raw rows into QueryData (category defaults to 'other'; merge happens in useMemo)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: QueryData[] = (rows as any[]).map(r => {
        const query                    = (r.queries as { query_text: string }).query_text
        const clicksCurrent            = r.clicks_current       ?? 0
        const clicksPrevious           = r.clicks_previous      ?? 0
        const impressionsCurrent       = r.impressions_current  ?? 0
        const impressionsPrevious      = r.impressions_previous ?? 0
        const ctrCurrent               = r.ctr_current   != null ? r.ctr_current  * 100 : null
        const ctrPrevious              = r.ctr_previous  != null ? r.ctr_previous * 100 : null
        const positionCurrent          = r.position_current  ?? null
        const positionPrevious         = r.position_previous ?? null
        const clicksChange             = clicksCurrent - clicksPrevious
        const clicksChangePercent      = clicksPrevious > 0
          ? ((clicksCurrent - clicksPrevious) / clicksPrevious) * 100
          : clicksCurrent > 0 ? 100 : 0
        const impressionsChange        = impressionsCurrent - impressionsPrevious
        const impressionsChangePercent = impressionsPrevious > 0
          ? ((impressionsCurrent - impressionsPrevious) / impressionsPrevious) * 100
          : impressionsCurrent > 0 ? 100 : 0
        return {
          query,
          clicksCurrent, clicksPrevious,
          impressionsCurrent, impressionsPrevious,
          ctrCurrent, ctrPrevious,
          positionCurrent, positionPrevious,
          category: 'other' as QueryCategory,
          clicksChange, clicksChangePercent,
          impressionsChange, impressionsChangePercent,
          classificationSource: null,
          classificationReasoning: null,
        }
      })

      setQueryData(parsed)
      await loadClassifications(ids, idToText)
      setLoading(false)
    }).catch((err: Error) => {
      toast.error('Failed to load import: ' + err.message)
      setLoading(false)
    })
  }, [projectId, importId, loadClassifications])

  // ── Merge DB classifications; branded check covers unclassified queries ───

  const classifiedData = useMemo((): QueryData[] =>
    queryData.map(q => {
      const dbClass = classifications.get(q.query)
      if (dbClass) {
        return {
          ...q,
          category: dbClass.category,
          classificationSource: dbClass.source,
          classificationReasoning: dbClass.reasoning,
        }
      }
      // No DB row — client-side branded check as fallback
      const patternCat = classifyQuery(q.query, { brandedTerms })
      return {
        ...q,
        category: patternCat,
        classificationSource: patternCat === 'branded' ? 'pattern' as const : null,
        classificationReasoning: null,
      }
    }),
  [queryData, brandedTerms, classifications])

  // ── Category stats ─────────────────────────────────────────────────────────

  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: QueryCategory[] = ['branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other']
    return categories.map(category => {
      const qs = classifiedData.filter(q => q.category === category)
      const totalClicksCurrent        = qs.reduce((s, q) => s + q.clicksCurrent,  0)
      const totalClicksPrevious       = qs.reduce((s, q) => s + q.clicksPrevious, 0)
      const totalImpressionsCurrent   = qs.reduce((s, q) => s + q.impressionsCurrent,  0)
      const totalImpressionsPrevious  = qs.reduce((s, q) => s + q.impressionsPrevious, 0)

      const posCur  = qs.filter(q => q.positionCurrent  != null)
      const posPrev = qs.filter(q => q.positionPrevious != null)
      const posWtCur  = posCur.reduce((s, q) => s + q.impressionsCurrent,  0)
      const posWtPrev = posPrev.reduce((s, q) => s + q.impressionsPrevious, 0)
      const avgPositionCurrent  = posWtCur  > 0 ? posCur.reduce((s, q)  => s + q.positionCurrent!  * q.impressionsCurrent,  0) / posWtCur  : 0
      const avgPositionPrevious = posWtPrev > 0 ? posPrev.reduce((s, q) => s + q.positionPrevious! * q.impressionsPrevious, 0) / posWtPrev : 0

      const avgCtrCurrent  = totalImpressionsCurrent  > 0 ? (totalClicksCurrent  / totalImpressionsCurrent)  * 100 : 0
      const avgCtrPrevious = totalImpressionsPrevious > 0 ? (totalClicksPrevious / totalImpressionsPrevious) * 100 : 0

      const clicksChange             = totalClicksCurrent - totalClicksPrevious
      const clicksChangePercent      = totalClicksPrevious > 0 ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 : totalClicksCurrent > 0 ? 100 : 0
      const impressionsChangePercent = totalImpressionsPrevious > 0 ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 : totalImpressionsCurrent > 0 ? 100 : 0
      const positionChange           = avgPositionPrevious > 0 ? ((avgPositionCurrent - avgPositionPrevious) / avgPositionPrevious) * 100 : 0
      const ctrChange                = avgCtrPrevious > 0 ? ((avgCtrCurrent - avgCtrPrevious) / avgCtrPrevious) * 100 : avgCtrCurrent > 0 ? 100 : 0

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
    const positionChange    = avgPositionPrevious      > 0 ? ((avgPositionCurrent - avgPositionPrevious)           / avgPositionPrevious)      * 100 : 0

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
      r.ctrCurrent    != null ? r.ctrCurrent.toFixed(2)    : '',
      r.ctrPrevious   != null ? r.ctrPrevious.toFixed(2)   : '',
      r.positionCurrent  != null ? r.positionCurrent.toFixed(2)  : '',
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
            <Button
              onClick={handleClassify}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={classifyState === 'classifying'}
            >
              {classifyState === 'classifying' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {classifyProgress || 'Classifying…'}
                </>
              ) : classifyState === 'done' ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  Classified
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Classify with Claude
                </>
              )}
            </Button>
            <Button onClick={handleDownloadCSV} variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" />Download CSV
            </Button>
            <Link to={`/projects/${projectId}/settings`}>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Edit branded terms in Settings
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-8 animate-fade-in">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Queries"      value={overallStats.queryCount}              icon={<Search       className="w-5 h-5 text-primary" />} />
          <StatCard title="Total Clicks"       value={overallStats.totalClicksCurrent}      change={overallStats.clicksChange}      icon={<MousePointer className="w-5 h-5 text-primary" />} />
          <StatCard title="Total Impressions"  value={overallStats.totalImpressionsCurrent} change={overallStats.impressionsChange}  icon={<Eye          className="w-5 h-5 text-primary" />} />
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
