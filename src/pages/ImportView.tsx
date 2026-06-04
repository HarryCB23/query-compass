/**
 * ImportView — loads a single import, classifications, and SERP snapshots.
 *
 * Tabs (via ?tab= search param):
 *   queries     — existing analysis view + SERP columns
 *   ai-surfaces — AIO/Top Stories/FS/busyness panels
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { CLASSIFIER_PROMPT_VERSION } from '@/lib/classifierVersion'
import { classifyQuery } from '@/lib/queryClassifier'
import { SERP_LOCATIONS, locationLabel } from '@/lib/serpLocations'
import { CategoryDistributionChart } from '@/components/CategoryDistributionChart'
import { CategoryChangeChart } from '@/components/CategoryChangeChart'
import { CategoryMetricsPanel } from '@/components/CategoryMetricsPanel'
import { CategoryScatterChart } from '@/components/CategoryScatterChart'
import { QueryTable, type SerpSnapshotData } from '@/components/QueryTable'
import { CategoryFilter } from '@/components/CategoryFilter'
import { EntityBubbleChart } from '@/components/EntityBubbleChart'
import { TopShiftingQueries } from '@/components/TopShiftingQueries'
import AiSurfacesTab from '@/components/AiSurfacesTab'
import { MetricCard, KPITile, TrendIndicator } from '@/components/ui/metric-card'
import OverviewTab from '@/components/OverviewTab'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft, BarChart3, TrendingUp, Search,
  Target, Percent, Users, Filter, Download, Sparkles, Loader2, Globe,
} from 'lucide-react'
import { UserMenu } from '@/components/UserMenu'
import type { QueryData, CategoryStats, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'
import { toast } from 'sonner'

const TASK_COST = 0.0006

interface ClassificationInfo {
  category: QueryCategory
  source: 'ai-haiku' | 'pattern'
  reasoning: string | null
}

export default function ImportView() {
  const { projectId, importId } = useParams<{ projectId: string; importId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') ?? 'overview') as 'overview' | 'queries' | 'ai-surfaces'

  // ── Core data ─────────────────────────────────────────────────────────────
  const [projectName, setProjectName]         = useState<string>('')
  const [brandedTerms, setBrandedTerms]       = useState<string[]>([])
  const [queryData, setQueryData]             = useState<QueryData[]>([])
  const [classifications, setClassifications] = useState<Map<string, ClassificationInfo>>(new Map())
  const [loading, setLoading]                 = useState(true)
  const [classifyState, setClassifyState]     = useState<'idle' | 'classifying' | 'done'>('idle')
  const [classifyProgress, setClassifyProgress] = useState('')
  const [categoryFilter, setCategoryFilter]   = useState<QueryCategory | 'all'>('all')
  const [entityFilter, setEntityFilter]       = useState<string | null>(null)

  // ── SERP state ─────────────────────────────────────────────────────────────
  const [locationCode, setLocationCode]       = useState<number>(2826)
  const [serpSnapshots, setSerpSnapshots]     = useState<Map<string, SerpSnapshotData>>(new Map())
  const [enrichState, setEnrichState]         = useState<'idle' | 'submitting' | 'polling' | 'done'>('idle')
  const [enrichProgress, setEnrichProgress]   = useState('')
  const [enrichModalOpen, setEnrichModalOpen] = useState(false)
  const [modalLocation, setModalLocation]     = useState<number>(2826)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stable ref for query_id data
  const queryIdDataRef = useRef<{ ids: string[]; idToText: Map<string, string> }>({
    ids: [],
    idToText: new Map(),
  })

  // ── Load SERP snapshots for current location ───────────────────────────────

  const loadSerpSnapshots = useCallback(async (loc: number) => {
    const { ids, idToText } = queryIdDataRef.current
    if (ids.length === 0) return

    // Paginate in 1000-row pages — PostgREST max_rows=1000 overrides any
    // single .range() call wider than 1000 (see Phase 2 retrospective).
    // Filter to this import's query_ids in-memory to avoid URL-length issues
    // from large .in() arrays (Cloudflare 8KB limit).
    const idSet = new Set(ids)
    const byText = new Map<string, SerpSnapshotData>()
    const PAGE = 1000
    const COLS = [
      'query_id,captured_at',
      'has_ai_overview,has_top_stories,has_featured_snippet,has_video,has_local_pack,has_shopping',
      'publisher_in_ai_overview,publisher_in_top_stories,publisher_in_featured_snippet',
      'publisher_organic_position,publisher_in_organic_top_3,top_organic_domains,top_stories_domains',
    ].join(',')
    let from = 0

    while (true) {
      const { data } = await supabase
        .from('serp_snapshots')
        .select(COLS)
        .eq('location_code', loc)
        .range(from, from + PAGE - 1)

      if (!data || data.length === 0) break

      for (const row of data) {
        if (!idSet.has(row.query_id)) continue
        const text = idToText.get(row.query_id)
        if (text) byText.set(text, row as SerpSnapshotData)
      }

      if (data.length < PAGE) break
      from += PAGE
    }

    setSerpSnapshots(byText)
  }, [])

  // ── Fetch classifications from DB ──────────────────────────────────────────

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
        if (!existing || (source === 'ai-haiku' && existing.source !== 'ai-haiku')) {
          rawMap.set(row.query_id, {
            category: row.category as QueryCategory,
            source,
            reasoning: (row.reasoning as string | null) ?? null,
          })
        }
      }
    }

    const textMap = new Map<string, ClassificationInfo>()
    for (const [qid, info] of rawMap) {
      const text = idToText.get(qid)
      if (text) textMap.set(text, info)
    }
    setClassifications(textMap)
  }, [])

  // ── Classify handler ───────────────────────────────────────────────────────

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

  // ── Enrich SERP handlers ───────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const startPolling = useCallback(() => {
    if (!importId) return
    stopPolling()

    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('serp_jobs')
        .select('status')
        .eq('import_id', importId)

      if (!data) return

      const counts = { complete: 0, error: 0, other: 0 }
      for (const j of data) {
        if (j.status === 'complete')      counts.complete++
        else if (j.status === 'error')    counts.error++
        else                              counts.other++
      }

      const done  = counts.complete + counts.error
      const total = done + counts.other

      setEnrichProgress(`Fetching results… ${done.toLocaleString()} of ${total.toLocaleString()} complete`)

      if (counts.other === 0) {
        stopPolling()
        setEnrichState('done')
        setEnrichProgress('')
        await loadSerpSnapshots(locationCode)
        toast.success(`SERP data ready — ${counts.complete} snapshots fetched`)
      }
    }, 10_000)
  }, [importId, locationCode, loadSerpSnapshots, stopPolling])

  const handleEnrichClick = useCallback(() => {
    setModalLocation(locationCode)
    setEnrichModalOpen(true)
  }, [locationCode])

  const handleEnrichConfirm = useCallback(async () => {
    if (!importId) return
    setEnrichModalOpen(false)
    setEnrichState('submitting')

    const total = queryData.length
    const CHUNK = 100
    let offset = 0

    try {
      while (offset < total) {
        setEnrichProgress(`Submitting ${Math.min(offset + CHUNK, total).toLocaleString()} of ${total.toLocaleString()}…`)

        let result = await supabase.functions.invoke('enrich-serp', {
          body: { importId, chunkOffset: offset, chunkLimit: CHUNK, locationCode: modalLocation },
        })

        if (result.error) {
          const errMsg = result.error instanceof Error ? result.error.message : String(result.error)
          if (errMsg.includes('401') || errMsg.toLowerCase().includes('unauthorized')) {
            await supabase.auth.refreshSession()
            result = await supabase.functions.invoke('enrich-serp', {
              body: { importId, chunkOffset: offset, chunkLimit: CHUNK, locationCode: modalLocation },
            })
          }
          if (result.error) throw result.error
        }

        offset += CHUNK
      }

      // Switch location to the one we just submitted for
      setLocationCode(modalLocation)
      setEnrichState('polling')
      startPolling()
    } catch (err) {
      toast.error('SERP enrichment failed: ' + (err instanceof Error ? err.message : String(err)))
      setEnrichState('idle')
      setEnrichProgress('')
    }
  }, [importId, queryData.length, modalLocation, startPolling])

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling])

  // ── Load project + import_queries ─────────────────────────────────────────

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
      supabase.from('projects')
        .select('client_name, branded_terms, default_location_code')
        .eq('id', projectId)
        .single(),
      fetchAllRows(),
    ]).then(async ([{ data: proj }, rows]) => {
      if (proj) {
        setProjectName(proj.client_name)
        setBrandedTerms(proj.branded_terms)
        const loc = proj.default_location_code ?? 2826
        setLocationCode(loc)
        setModalLocation(loc)
      }
      if (!rows) { setLoading(false); return }

      const idToText = new Map<string, string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rows as any[]) {
        idToText.set(r.query_id as string, (r.queries as { query_text: string }).query_text)
      }
      const ids = Array.from(idToText.keys())
      queryIdDataRef.current = { ids, idToText }

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

  // Load snapshots whenever location changes (and query IDs are available)
  useEffect(() => {
    if (!loading && queryIdDataRef.current.ids.length > 0) {
      loadSerpSnapshots(locationCode)
    }
  }, [locationCode, loading, loadSerpSnapshots])

  // ── Derived data ───────────────────────────────────────────────────────────

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
      const patternCat = classifyQuery(q.query, { brandedTerms })
      return {
        ...q,
        category: patternCat,
        classificationSource: patternCat === 'branded' ? 'pattern' as const : null,
        classificationReasoning: null,
      }
    }),
  [queryData, brandedTerms, classifications])

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

  // ── Enrich modal cost estimate ─────────────────────────────────────────────
  const willSubmit = queryData.length - serpSnapshots.size
  const estimatedCost = willSubmit * TASK_COST

  if (loading) return <p className="text-muted-foreground text-center py-20">Loading import…</p>

  const enrichBusy = enrichState === 'submitting' || enrichState === 'polling'

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ───────────────────────────────────────────────────────── */}
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
            {/* Enrich SERP button */}
            <Button
              onClick={handleEnrichClick}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={enrichBusy}
            >
              {enrichBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {enrichProgress || 'Enriching…'}
                </>
              ) : enrichState === 'done' ? (
                <>
                  <Globe className="w-4 h-4" />
                  Re-enrich SERP
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" />
                  Enrich SERP
                </>
              )}
            </Button>

            {/* Classify button */}
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
                Settings
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────── */}
        <div className="container flex items-center gap-1 pb-0 border-t border-border/50">
          {(['overview', 'queries', 'ai-surfaces'] as const).map(t => (
            <button
              key={t}
              onClick={() => setSearchParams(t === 'overview' ? {} : { tab: t })}
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'overview' ? 'Overview' : t === 'queries' ? 'Queries' : 'AI Surfaces'}
            </button>
          ))}

          {/* Location selector — shown in header for both tabs */}
          <div className="ml-auto flex items-center gap-2 py-1.5">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            <Select
              value={String(locationCode)}
              onValueChange={v => setLocationCode(Number(v))}
            >
              <SelectTrigger className="h-7 text-xs w-44 border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERP_LOCATIONS.map(l => (
                  <SelectItem key={l.code} value={String(l.code)} className="text-xs">
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {serpSnapshots.size > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {serpSnapshots.size.toLocaleString()} enriched
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      {tab === 'overview' ? (
        <main className="container py-8 animate-fade-in">
          <OverviewTab
            classifiedData={classifiedData}
            serpSnapshots={serpSnapshots}
            onNavigateToQueries={(category) => {
              if (category) {
                setCategoryFilter(category)
              }
              setSearchParams({ tab: 'queries' })
            }}
          />
        </main>
      ) : tab === 'ai-surfaces' ? (
        <AiSurfacesTab
          classifiedData={classifiedData}
          serpSnapshots={serpSnapshots}
          locationCode={locationCode}
        />
      ) : (
        <main className="container py-8 space-y-8 animate-fade-in">
          {/* Stats */}
          {(() => {
            const biggestShift = [...categoryStats].sort((a, b) => Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent))[0]
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard>
                  <KPITile label="Total Queries" value={overallStats.queryCount.toLocaleString()} />
                </MetricCard>
                <MetricCard>
                  <KPITile
                    label="Total Clicks"
                    value={overallStats.totalClicksCurrent.toLocaleString()}
                    trend={{ value: Math.abs(overallStats.clicksChange), direction: overallStats.clicksChange > 0 ? 'up' : overallStats.clicksChange < 0 ? 'down' : 'neutral' }}
                  />
                </MetricCard>
                <MetricCard>
                  <KPITile
                    label="Total Impressions"
                    value={overallStats.totalImpressionsCurrent.toLocaleString()}
                    trend={{ value: Math.abs(overallStats.impressionsChange), direction: overallStats.impressionsChange > 0 ? 'up' : overallStats.impressionsChange < 0 ? 'down' : 'neutral' }}
                  />
                </MetricCard>
                <MetricCard>
                  <KPITile
                    label="Biggest Shift"
                    value={CATEGORY_LABELS[biggestShift?.category ?? 'other']}
                    trend={biggestShift ? { value: Math.abs(biggestShift.clicksChangePercent), direction: biggestShift.clicksChangePercent > 0 ? 'up' : biggestShift.clicksChangePercent < 0 ? 'down' : 'neutral' } : undefined}
                  />
                </MetricCard>
              </div>
            )
          })()}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetricCard title="Clicks by Category">
              <CategoryDistributionChart stats={categoryStats} dataKey="clicks" />
            </MetricCard>
            <MetricCard title="Category Change (% Clicks)">
              <CategoryChangeChart stats={categoryStats} />
            </MetricCard>
          </div>

          <MetricCard title="Position vs CTR by Category">
            <CategoryScatterChart stats={categoryStats} />
          </MetricCard>

          {/* Entity bubble chart */}
          <MetricCard title="News Entity Explorer">
            <EntityBubbleChart queries={classifiedData} serpSnapshots={serpSnapshots} />
          </MetricCard>

          {/* Category filter */}
          <MetricCard title={entityFilter ? `Filter by Category — "${entityFilter}"` : 'Filter by Category'}>
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
          </MetricCard>

          {selectedCategoryStats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CategoryMetricsPanel stats={selectedCategoryStats} />
              <MetricCard title="Top 20 Shifting Queries">
                <div className="max-h-80 overflow-y-auto">
                  <TopShiftingQueries queries={classifiedData} category={categoryFilter as QueryCategory} limit={20} />
                </div>
              </MetricCard>
            </div>
          )}

          {/* Query table */}
          <MetricCard title={entityFilter ? `Query Details — filtered by "${entityFilter}"` : 'Query Details'}>
            <QueryTable
              data={entityFilter ? classifiedData.filter(q => q.query.toLowerCase().includes(entityFilter.toLowerCase())) : classifiedData}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              serpSnapshots={serpSnapshots}
            />
          </MetricCard>
        </main>
      )}

      {/* ── Enrich SERP modal ─────────────────────────────────────────────── */}
      <Dialog open={enrichModalOpen} onOpenChange={setEnrichModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enrich SERP data</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Select
                value={String(modalLocation)}
                onValueChange={v => setModalLocation(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERP_LOCATIONS.map(l => (
                    <SelectItem key={l.code} value={String(l.code)}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total queries</span>
                <span className="font-mono">{queryData.length.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already cached</span>
                <span className="font-mono">{(modalLocation === locationCode ? serpSnapshots.size : 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-medium border-t border-border/50 pt-1 mt-1">
                <span>Will submit</span>
                <span className="font-mono">
                  ~{(queryData.length - (modalLocation === locationCode ? serpSnapshots.size : 0)).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Estimated cost</span>
                <span className="font-mono">
                  ${((queryData.length - (modalLocation === locationCode ? serpSnapshots.size : 0)) * TASK_COST).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrichModalOpen(false)}>Cancel</Button>
            <Button onClick={handleEnrichConfirm}>Confirm &amp; enrich</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
