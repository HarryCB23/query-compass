import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TierDot, TrendIndicator, CategoryTag } from '@/components/ui/metric-card';
import type { QueryData, QueryCategory } from '@/types/query';
import { scoreQuery, type RiskTier } from '@/lib/riskScoring';
import { cn } from '@/lib/utils';


export interface SerpSnapshotData {
  captured_at: string
  has_ai_overview: boolean
  has_top_stories: boolean
  has_featured_snippet: boolean
  has_video: boolean
  has_local_pack: boolean
  has_shopping: boolean
  publisher_in_ai_overview: boolean
  publisher_in_top_stories: boolean
  publisher_in_featured_snippet: boolean
  publisher_organic_position: number | null
  publisher_in_organic_top_3: boolean
  top_organic_domains: string[]
  top_stories_domains: string[]
}

// Feature presence dot — variant controls colour.
function SerpDot({ value, variant = 'neutral' }: { value: boolean; variant?: 'risk' | 'neutral' }) {
  return (
    <span className={cn(
      'inline-block w-2 h-2 rounded-full',
      value
        ? variant === 'risk' ? 'bg-risk' : 'bg-chart-neutral'
        : 'bg-muted-foreground/20',
    )} />
  )
}

interface QueryTableProps {
  data: QueryData[];
  categoryFilter?: QueryCategory | 'all';
  onCategoryFilterChange?: (category: QueryCategory | 'all') => void;
  serpSnapshots?: Map<string, SerpSnapshotData>;
}

type SortKey =
  | 'query' | 'clicksCurrent' | 'clicksChange'
  | 'impressionsCurrent' | 'impressionsChange'
  | 'category' | 'tier' | 'estLost';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 100;

function ageLabel(capturedAt: string): string {
  const diffMs = Date.now() - new Date(capturedAt).getTime()
  const h = Math.floor(diffMs / 3_600_000)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TIER_ORDER: Record<RiskTier, number> = { high: 0, medium: 1, low: 2 }

export function QueryTable({ data, categoryFilter = 'all', onCategoryFilterChange: _onCatChange, serpSnapshots }: QueryTableProps) {
  const [sortKey, setSortKey]           = useState<SortKey>('clicksCurrent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm]     = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  const showSerp = !!serpSnapshots && serpSnapshots.size > 0;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    if (searchTerm) {
      result = result.filter(q => q.query.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (categoryFilter !== 'all') {
      result = result.filter(q => q.category === categoryFilter);
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'query':              comparison = a.query.localeCompare(b.query); break;
        case 'clicksCurrent':      comparison = a.clicksCurrent - b.clicksCurrent; break;
        case 'clicksChange':       comparison = a.clicksChangePercent - b.clicksChangePercent; break;
        case 'impressionsCurrent': comparison = a.impressionsCurrent - b.impressionsCurrent; break;
        case 'impressionsChange':  comparison = a.impressionsChangePercent - b.impressionsChangePercent; break;
        case 'category':           comparison = a.category.localeCompare(b.category); break;
        case 'tier': {
          const tA = serpSnapshots ? scoreQuery(serpSnapshots.get(a.query) ?? null, a.clicksCurrent, a.clicksPrevious).tier : 'low';
          const tB = serpSnapshots ? scoreQuery(serpSnapshots.get(b.query) ?? null, b.clicksCurrent, b.clicksPrevious).tier : 'low';
          comparison = TIER_ORDER[tA] - TIER_ORDER[tB];
          break;
        }
        case 'estLost': {
          const lA = serpSnapshots ? scoreQuery(serpSnapshots.get(a.query) ?? null, a.clicksCurrent, a.clicksPrevious).estLostCurrent : 0;
          const lB = serpSnapshots ? scoreQuery(serpSnapshots.get(b.query) ?? null, b.clicksCurrent, b.clicksPrevious).estLostCurrent : 0;
          comparison = lA - lB;
          break;
        }
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, searchTerm, categoryFilter, sortKey, sortDirection, serpSnapshots]);

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="w-4 h-4 text-muted-foreground/50" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="w-4 h-4 text-foreground" />
      : <ArrowDown className="w-4 h-4 text-foreground" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search queries…"
            className="pl-10"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedData.length} of {data.length} queries
        </p>
      </div>

      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('query')}>
                <div className="flex items-center gap-2">Query <SortIcon columnKey="query" /></div>
              </th>
              <th className="text-left font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('category')}>
                <div className="flex items-center gap-2">Category <SortIcon columnKey="category" /></div>
              </th>
              <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('clicksCurrent')}>
                <div className="flex items-center justify-end gap-2">Clicks <SortIcon columnKey="clicksCurrent" /></div>
              </th>
              <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('clicksChange')}>
                <div className="flex items-center justify-end gap-2">Δ Clicks <SortIcon columnKey="clicksChange" /></div>
              </th>
              <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('impressionsCurrent')}>
                <div className="flex items-center justify-end gap-2">Impressions <SortIcon columnKey="impressionsCurrent" /></div>
              </th>
              <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('impressionsChange')}>
                <div className="flex items-center justify-end gap-2">Δ Impr. <SortIcon columnKey="impressionsChange" /></div>
              </th>
              {showSerp && (
                <>
                  <th className="text-left font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('tier')}>
                    <div className="flex items-center gap-2">Tier <SortIcon columnKey="tier" /></div>
                  </th>
                  <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('estLost')}>
                    <div className="flex items-center justify-end gap-2">Est. Lost <SortIcon columnKey="estLost" /></div>
                  </th>
                  <th className="text-center font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider">AIO</th>
                  <th className="text-center font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider">Top Stories</th>
                  <th className="text-center font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider">Feat. Snippet</th>
                  <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider">Org. Pos.</th>
                  <th className="text-right font-medium text-muted-foreground p-3 text-xs uppercase tracking-wider">Age</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedData.slice(0, visibleCount).map((row, index) => {
              const snap = serpSnapshots?.get(row.query)
              const rs   = showSerp ? scoreQuery(snap ?? null, row.clicksCurrent, row.clicksPrevious) : null
              return (
                <tr key={index} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium max-w-xs truncate">{row.query}</td>
                  <td className="p-3">
                    {row.classificationReasoning ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CategoryTag category={row.category} className="cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          {row.classificationReasoning}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <CategoryTag category={row.category} />
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">{row.clicksCurrent.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <TrendIndicator
                      value={Math.abs(row.clicksChangePercent)}
                      direction={row.clicksChangePercent > 0 ? 'up' : row.clicksChangePercent < 0 ? 'down' : 'neutral'}
                    />
                  </td>
                  <td className="p-3 text-right font-mono">{row.impressionsCurrent.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <TrendIndicator
                      value={Math.abs(row.impressionsChangePercent)}
                      direction={row.impressionsChangePercent > 0 ? 'up' : row.impressionsChangePercent < 0 ? 'down' : 'neutral'}
                    />
                  </td>
                  {showSerp && rs && (
                    <>
                      {/* Tier */}
                      <td className="p-3">
                        {rs.scored ? <TierDot tier={rs.tier} /> : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      {/* Est. Lost */}
                      <td className="p-3 text-right">
                        {rs.scored ? (
                          <span className={cn(
                            'font-mono text-xs',
                            rs.tier === 'high'   ? 'text-risk font-semibold'
                            : rs.tier === 'medium' ? 'text-foreground'
                            : 'text-muted-foreground/50',
                          )}>
                            {rs.estLostCurrent > 0
                              ? `~${Math.round(rs.estLostCurrent).toLocaleString()}`
                              : '—'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                      {/* AIO */}
                      <td className="p-3 text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default"><SerpDot value={snap.has_ai_overview} variant="risk" /></span>
                            </TooltipTrigger>
                            {snap.has_ai_overview && (
                              <TooltipContent className="text-xs">
                                {snap.publisher_in_ai_overview ? 'Publisher cited in AIO' : 'AIO present — publisher not cited'}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      {/* Top Stories */}
                      <td className="p-3 text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default"><SerpDot value={snap.has_top_stories} /></span>
                            </TooltipTrigger>
                            {snap.has_top_stories && (
                              <TooltipContent className="text-xs">
                                {snap.publisher_in_top_stories ? 'Publisher in Top Stories' : 'Top Stories present — publisher absent'}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      {/* Featured Snippet */}
                      <td className="p-3 text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default"><SerpDot value={snap.has_featured_snippet} /></span>
                            </TooltipTrigger>
                            {snap.has_featured_snippet && (
                              <TooltipContent className="text-xs">
                                {snap.publisher_in_featured_snippet
                                  ? 'Publisher owns Featured Snippet'
                                  : snap.top_organic_domains[0]
                                    ? `Featured Snippet owned by ${snap.top_organic_domains[0]}`
                                    : 'Featured Snippet present — publisher absent'}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      {/* Org. Pos. */}
                      <td className="p-3 text-right font-mono text-xs">
                        {snap
                          ? (snap.publisher_organic_position ?? <span className="text-muted-foreground/40">—</span>)
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {/* Age */}
                      <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                        {snap ? ageLabel(snap.captured_at) : <span className="text-muted-foreground/30">—</span>}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filteredAndSortedData.length > visibleCount && (
          <div className="p-4 text-center bg-muted/30">
            <p className="text-sm text-muted-foreground mb-3">
              Showing {visibleCount} of {filteredAndSortedData.length} queries
            </p>
            <Button
              variant="outline"
              onClick={() => setVisibleCount(prev => prev + ITEMS_PER_PAGE)}
            >
              Show next {Math.min(ITEMS_PER_PAGE, filteredAndSortedData.length - visibleCount)} queries
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
