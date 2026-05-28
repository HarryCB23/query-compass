import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CategoryBadge } from './CategoryBadge';
import type { QueryData, QueryCategory } from '@/types/query';
import { scoreQuery, type RiskTier } from '@/lib/riskScoring';
import { cn } from '@/lib/utils';

// Small pill showing classification source — informative but visually quiet.
function SourceBadge({ source }: { source: QueryData['classificationSource'] }) {
  if (!source) {
    return <span className="text-[10px] font-mono text-muted-foreground/40 select-none" title="Not yet classified">~</span>
  }
  if (source === 'pattern') {
    return (
      <span className="inline-flex items-center text-[10px] font-mono text-muted-foreground/60 border border-border/60 rounded px-1 leading-4 select-none">
        pat
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-[10px] font-mono text-violet-400 border border-violet-500/30 rounded px-1 leading-4 select-none">
      AI
    </span>
  )
}

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
}

interface QueryTableProps {
  data: QueryData[];
  categoryFilter?: QueryCategory | 'all';
  onCategoryFilterChange?: (category: QueryCategory | 'all') => void;
  // keyed by query_text; when present + non-empty, SERP columns are shown
  serpSnapshots?: Map<string, SerpSnapshotData>;
}

type SortKey = 'query' | 'clicksCurrent' | 'clicksChange' | 'impressionsCurrent' | 'impressionsChange' | 'category' | 'estLost';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 100;

// Relative age: "2h ago", "3d ago", etc.
function ageLabel(capturedAt: string): string {
  const diffMs = Date.now() - new Date(capturedAt).getTime()
  const h = Math.floor(diffMs / 3_600_000)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Tier chip for risk column
function TierBadge({ tier }: { tier: RiskTier }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
      tier === 'high'   && 'bg-rose-500/15 text-rose-400',
      tier === 'medium' && 'bg-amber-500/15 text-amber-400',
      tier === 'low'    && 'bg-emerald-500/15 text-emerald-400',
    )}>
      {tier === 'high' ? 'AIO' : tier === 'medium' ? 'rich' : 'low'}
    </span>
  )
}

// Feature pill: filled dot = true, empty = false
function SerpBool({ value }: { value: boolean }) {
  return (
    <span className={cn(
      'inline-block w-2 h-2 rounded-full',
      value ? 'bg-emerald-500' : 'bg-muted-foreground/20',
    )} />
  )
}

export function QueryTable({ data, categoryFilter = 'all', onCategoryFilterChange, serpSnapshots }: QueryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('clicksCurrent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm] = useState('');
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
      result = result.filter(q =>
        q.query.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (categoryFilter !== 'all') {
      result = result.filter(q => q.category === categoryFilter);
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'query':           comparison = a.query.localeCompare(b.query); break;
        case 'clicksCurrent':   comparison = a.clicksCurrent - b.clicksCurrent; break;
        case 'clicksChange':    comparison = a.clicksChangePercent - b.clicksChangePercent; break;
        case 'impressionsCurrent': comparison = a.impressionsCurrent - b.impressionsCurrent; break;
        case 'impressionsChange':  comparison = a.impressionsChangePercent - b.impressionsChangePercent; break;
        case 'category':        comparison = a.category.localeCompare(b.category); break;
        case 'estLost': {
          const lostA = serpSnapshots ? scoreQuery(serpSnapshots.get(a.query) ?? null, a.clicksCurrent, a.clicksPrevious).estLostCurrent : 0;
          const lostB = serpSnapshots ? scoreQuery(serpSnapshots.get(b.query) ?? null, b.clicksCurrent, b.clicksPrevious).estLostCurrent : 0;
          comparison = lostA - lostB;
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
      ? <ArrowUp className="w-4 h-4 text-primary" />
      : <ArrowDown className="w-4 h-4 text-primary" />;
  };

  const formatChange = (change: number, isPercent: boolean = false) => {
    const prefix = change > 0 ? '+' : '';
    const suffix = isPercent ? '%' : '';
    const value = isPercent ? change.toFixed(1) : change.toLocaleString();
    return (
      <span className={cn(
        change > 0 && 'change-positive',
        change < 0 && 'change-negative',
        change === 0 && 'change-neutral'
      )}>
        {prefix}{value}{suffix}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search queries..."
            className="pl-10"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedData.length} of {data.length} queries
        </p>
      </div>

      <div className="overflow-x-auto border rounded-xl">
        <table className="data-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('query')}>
                <div className="flex items-center gap-2">Query <SortIcon columnKey="query" /></div>
              </th>
              <th className="cursor-pointer hover:bg-muted transition-colors" onClick={() => handleSort('category')}>
                <div className="flex items-center gap-2">Category <SortIcon columnKey="category" /></div>
              </th>
              <th className="cursor-pointer hover:bg-muted transition-colors text-right" onClick={() => handleSort('clicksCurrent')}>
                <div className="flex items-center justify-end gap-2">Clicks <SortIcon columnKey="clicksCurrent" /></div>
              </th>
              <th className="cursor-pointer hover:bg-muted transition-colors text-right" onClick={() => handleSort('clicksChange')}>
                <div className="flex items-center justify-end gap-2">Δ Clicks <SortIcon columnKey="clicksChange" /></div>
              </th>
              <th className="cursor-pointer hover:bg-muted transition-colors text-right" onClick={() => handleSort('impressionsCurrent')}>
                <div className="flex items-center justify-end gap-2">Impressions <SortIcon columnKey="impressionsCurrent" /></div>
              </th>
              <th className="cursor-pointer hover:bg-muted transition-colors text-right" onClick={() => handleSort('impressionsChange')}>
                <div className="flex items-center justify-end gap-2">Δ Impr. <SortIcon columnKey="impressionsChange" /></div>
              </th>
              {showSerp && (
                <>
                  <th className="cursor-pointer hover:bg-muted transition-colors text-right" onClick={() => handleSort('estLost')}>
                    <div className="flex items-center justify-end gap-2 text-xs">Est. Lost <SortIcon columnKey="estLost" /></div>
                  </th>
                  <th className="text-center text-xs">AIO</th>
                  <th className="text-center text-xs">Top Stories</th>
                  <th className="text-center text-xs">Feat. Snippet</th>
                  <th className="text-right text-xs">Org. Pos.</th>
                  <th className="text-right text-xs">Age</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedData.slice(0, visibleCount).map((row, index) => {
              const snap = serpSnapshots?.get(row.query)
              return (
                <tr key={index} className="animate-fade-in" style={{ animationDelay: `${Math.min(index, 20) * 10}ms` }}>
                  <td className="font-medium max-w-xs truncate">{row.query}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {row.classificationReasoning ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help"><CategoryBadge category={row.category} /></span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            {row.classificationReasoning}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <CategoryBadge category={row.category} />
                      )}
                      <SourceBadge source={row.classificationSource} />
                    </div>
                  </td>
                  <td className="text-right font-mono">{row.clicksCurrent.toLocaleString()}</td>
                  <td className="text-right font-mono">{formatChange(row.clicksChangePercent, true)}</td>
                  <td className="text-right font-mono">{row.impressionsCurrent.toLocaleString()}</td>
                  <td className="text-right font-mono">{formatChange(row.impressionsChangePercent, true)}</td>
                  {showSerp && (() => {
                    const rs = scoreQuery(snap ?? null, row.clicksCurrent, row.clicksPrevious)
                    return (
                      <td className="text-right">
                        {rs.scored ? (
                          <div className="flex items-center justify-end gap-1">
                            <TierBadge tier={rs.tier} />
                            {rs.estLostCurrent > 0 && (
                              <span className={cn(
                                'font-mono text-xs',
                                rs.tier === 'high' ? 'text-rose-400' : 'text-amber-400',
                              )}>
                                ~{Math.round(rs.estLostCurrent).toLocaleString()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    )
                  })()}
                  {showSerp && (
                    <>
                      <td className="text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <SerpBool value={snap.has_ai_overview} />
                              </span>
                            </TooltipTrigger>
                            {snap.has_ai_overview && (
                              <TooltipContent className="text-xs">
                                {snap.publisher_in_ai_overview ? 'Publisher cited in AIO' : 'AIO present — publisher not cited'}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <SerpBool value={snap.has_top_stories} />
                              </span>
                            </TooltipTrigger>
                            {snap.has_top_stories && (
                              <TooltipContent className="text-xs">
                                {snap.publisher_in_top_stories ? 'Publisher in Top Stories' : 'Top Stories present — publisher absent'}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="text-center">
                        {snap ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <SerpBool value={snap.has_featured_snippet} />
                              </span>
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
                      <td className="text-right font-mono text-xs">
                        {snap
                          ? (snap.publisher_organic_position ?? <span className="text-muted-foreground/40">—</span>)
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="text-right font-mono text-xs text-muted-foreground">
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
