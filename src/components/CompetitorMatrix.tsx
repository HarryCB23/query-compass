import { useMemo, useState } from 'react'
import { Globe, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { aggregateCompetitorDomains, type DomainStats } from '@/lib/serpAggregations'
import type { QueryData } from '@/types/query'
import type { SerpSnapshotData } from '@/components/QueryTable'
import { cn } from '@/lib/utils'

const DEFAULT_ROWS = 15

type SortKey = 'domain' | 'organicCount' | 'topStoriesCount' | 'total'
type SortDir = 'asc' | 'desc'

function LogoCell({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false)
  if (errored) return <Globe className="w-4 h-4 text-muted-foreground/50 shrink-0" />
  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt=""
      width={16}
      height={16}
      className="rounded-sm shrink-0 object-contain"
      onError={() => setErrored(true)}
    />
  )
}

interface CompetitorMatrixProps {
  queries:       QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
}

export function CompetitorMatrix({ queries, serpSnapshots }: CompetitorMatrixProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showAll, setShowAll] = useState(false)

  const querySet = useMemo(() => new Set(queries.map(q => q.query)), [queries])

  const rows: DomainStats[] = useMemo(() => {
    // Build a filtered snapshot map for the active queries only
    const filtered = new Map<string, SerpSnapshotData>()
    for (const [query, snap] of serpSnapshots) {
      if (querySet.has(query)) filtered.set(query, snap)
    }
    return aggregateCompetitorDomains(filtered)
  }, [serpSnapshots, querySet])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'domain')          cmp = a.domain.localeCompare(b.domain)
      else if (sortKey === 'organicCount')    cmp = a.organicCount    - b.organicCount
      else if (sortKey === 'topStoriesCount') cmp = a.topStoriesCount - b.topStoriesCount
      else                               cmp = a.total - b.total
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_ROWS)

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/40" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-foreground" />
      : <ArrowDown className="w-3.5 h-3.5 text-foreground" />
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        No domain data in current selection.
      </p>
    )
  }

  const thCls = 'p-2 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors select-none'
  const tdCls = 'p-2 text-sm'

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={cn(thCls, 'text-left')} onClick={() => handleSort('domain')}>
                <div className="flex items-center gap-1.5">Domain <SortIcon col="domain" /></div>
              </th>
              <th className={cn(thCls, 'text-right')} onClick={() => handleSort('organicCount')}>
                <div className="flex items-center justify-end gap-1.5">Organic <SortIcon col="organicCount" /></div>
              </th>
              <th className={cn(thCls, 'text-right')} onClick={() => handleSort('topStoriesCount')}>
                <div className="flex items-center justify-end gap-1.5">Top Stories <SortIcon col="topStoriesCount" /></div>
              </th>
              <th className={cn(thCls, 'text-right')} onClick={() => handleSort('total')}>
                <div className="flex items-center justify-end gap-1.5">Total <SortIcon col="total" /></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.domain} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className={cn(tdCls, 'font-medium')}>
                  <div className="flex items-center gap-2">
                    <LogoCell domain={row.domain} />
                    <span className="truncate max-w-[220px]" title={row.domain}>{row.domain}</span>
                  </div>
                </td>
                <td className={cn(tdCls, 'text-right tabular-nums text-muted-foreground')}>
                  {row.organicCount > 0 ? row.organicCount.toLocaleString() : '—'}
                </td>
                <td className={cn(tdCls, 'text-right tabular-nums text-muted-foreground')}>
                  {row.topStoriesCount > 0 ? row.topStoriesCount.toLocaleString() : '—'}
                </td>
                <td className={cn(tdCls, 'text-right tabular-nums font-medium')}>
                  {row.total.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && sorted.length > DEFAULT_ROWS && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
            Show all {sorted.length} domains
          </Button>
        </div>
      )}
    </div>
  )
}
