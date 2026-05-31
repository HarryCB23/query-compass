import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, MousePointer, Eye, BarChart3, ArrowUpDown, Filter, LayoutGrid, List } from 'lucide-react';
import { extractEntityStats, type EntityStats } from '@/lib/entityExtractor';
import type { QueryData } from '@/types/query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';

interface EntityExplorerProps {
  queries: QueryData[];
  onEntitySelect?: (entity: string, queries: QueryData[]) => void;
}

type SortOption = 'growth' | 'volume' | 'new';
type ViewMode  = 'list' | 'grid';

// Monochrome sparkline — all strokes use foreground-muted.
function Sparkline({ data }: { data: number[] }) {
  const max   = Math.max(...data);
  const min   = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 48;
    const y = 12 - ((value - min) / range) * 10;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="48" height="14" className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        className="stroke-muted-foreground/60 stroke-[1.5]"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function generateSparklineData(current: number, previous: number): number[] {
  const change = current - previous;
  const steps  = 6;
  const data: number[] = [];
  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const variance = (Math.random() - 0.5) * Math.abs(change) * 0.3;
    data.push(previous + change * progress + variance);
  }
  return data;
}

export function EntityExplorer({ queries, onEntitySelect }: EntityExplorerProps) {
  const [selectedEntity, setSelectedEntity] = useState<EntityStats | null>(null);
  const [sortBy, setSortBy]   = useState<SortOption>('volume');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const entityStats = useMemo(() => extractEntityStats(queries), [queries]);

  const { rising, stable, declining } = useMemo(() => {
    const threshold = 5;
    let risingList   = entityStats.filter(e => e.clicksChangePercent >  threshold);
    let stableList   = entityStats.filter(e => Math.abs(e.clicksChangePercent) <= threshold);
    let decliningList = entityStats.filter(e => e.clicksChangePercent < -threshold);

    const sortFn = (a: EntityStats, b: EntityStats) => {
      if (sortBy === 'growth') return Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent);
      if (sortBy === 'volume') return b.totalClicksCurrent - a.totalClicksCurrent;
      return (b.totalClicksPrevious === 0 ? 1 : 0) - (a.totalClicksPrevious === 0 ? 1 : 0);
    };

    return {
      rising:   risingList.sort(sortFn),
      stable:   stableList.sort(sortFn),
      declining: decliningList.sort(sortFn),
    };
  }, [entityStats, sortBy]);

  const getTopDriver = (entity: EntityStats): string => {
    const sorted = [...entity.queries].sort((a, b) => b.clicksCurrent - a.clicksCurrent);
    const top = sorted[0];
    return top ? `Driver: ${top.query}` : '';
  };

  const formatAggregatedClicks = (entity: EntityStats): string => {
    const total = entity.totalClicksCurrent;
    return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString();
  };

  const renderEntityRow = (entity: EntityStats, type: 'rising' | 'stable' | 'declining') => {
    const sparklineData = generateSparklineData(entity.totalClicksCurrent, entity.totalClicksPrevious);
    const topDriver     = getTopDriver(entity);

    return (
      <button
        key={entity.entity}
        onClick={() => setSelectedEntity(entity)}
        className={cn(
          'w-full px-3 py-2.5 flex items-center gap-3',
          'bg-card/50 hover:bg-muted/50 transition-colors',
          'border-l-2 rounded-r-md',
          type === 'declining' ? 'border-l-foreground/40' : 'border-l-border',
        )}
      >
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="capitalize font-medium text-sm text-foreground truncate">
              {entity.entity}
            </span>
            {entity.queryCount > 1 && (
              <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
                {entity.queryCount} queries
              </span>
            )}
          </div>
          {topDriver && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{topDriver}</div>
          )}
        </div>
        <Sparkline data={sparklineData} />
        <span className="text-xs font-semibold tabular-nums w-12 text-right text-muted-foreground">
          {type === 'rising' && '+'}{entity.clicksChangePercent.toFixed(0)}%
        </span>
        <span className="text-xs text-muted-foreground tabular-nums w-16 text-right" title={`Total: ${entity.totalClicksCurrent.toLocaleString()} clicks`}>
          {formatAggregatedClicks(entity)}
        </span>
      </button>
    );
  };

  const renderGridCard = (entity: EntityStats, type: 'rising' | 'stable' | 'declining') => {
    const sparklineData = generateSparklineData(entity.totalClicksCurrent, entity.totalClicksPrevious);
    const topDriver     = getTopDriver(entity);

    return (
      <button
        key={entity.entity}
        onClick={() => setSelectedEntity(entity)}
        className={cn(
          'p-3 flex flex-col gap-2',
          'bg-card/50 hover:bg-muted/50 transition-colors',
          'border-l-2 rounded-lg border border-border/50',
          type === 'declining' ? 'border-l-foreground/40' : 'border-l-border',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="capitalize font-medium text-sm text-foreground truncate">
              {entity.entity}
            </span>
            {entity.queryCount > 1 && (
              <span className="text-[9px] text-muted-foreground bg-muted/50 px-1 py-0.5 rounded-full flex-shrink-0">
                {entity.queryCount}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold tabular-nums flex-shrink-0 text-muted-foreground">
            {type === 'rising' && '+'}{entity.clicksChangePercent.toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Sparkline data={sparklineData} />
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatAggregatedClicks(entity)}
          </span>
        </div>
        {topDriver && (
          <div className="text-[10px] text-muted-foreground truncate text-left">{topDriver}</div>
        )}
      </button>
    );
  };

  const renderColumn = (
    title: string,
    entities: EntityStats[],
    type: 'rising' | 'stable' | 'declining',
    icon: React.ReactNode,
  ) => (
    <div className="flex-1 min-w-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-3 mb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">({entities.length})</span>
        </div>
      </div>
      <div className={cn(viewMode === 'list' ? 'space-y-1' : 'grid grid-cols-1 gap-2')}>
        {entities.slice(0, 10).map(entity =>
          viewMode === 'list' ? renderEntityRow(entity, type) : renderGridCard(entity, type)
        )}
        {entities.length === 0 && (
          <div className="text-xs text-muted-foreground italic py-6 text-center">No entities</div>
        )}
        {entities.length > 10 && (
          <div className="text-xs text-muted-foreground text-center py-2">+{entities.length - 10} more</div>
        )}
      </div>
    </div>
  );

  if (entityStats.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No news entities detected in your queries.
      </div>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowUpDown className="w-4 h-4" />
            <span>Sort by</span>
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="volume">Highest Volume</SelectItem>
              <SelectItem value="growth">Highest Growth %</SelectItem>
              <SelectItem value="new">New Entries</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as ViewMode)}>
          <ToggleGroupItem value="list" aria-label="List view" className="h-8 w-8 p-0">
            <List className="w-4 h-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8 w-8 p-0">
            <LayoutGrid className="w-4 h-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Three columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {renderColumn('Rising',   rising,   'rising',   <TrendingUp   className="w-4 h-4 text-muted-foreground" />)}
        {renderColumn('Stable',   stable,   'stable',   <Minus        className="w-4 h-4 text-muted-foreground" />)}
        {renderColumn('Declining', declining, 'declining', <TrendingDown className="w-4 h-4 text-muted-foreground" />)}
      </div>

      {/* Entity Detail Modal */}
      <Dialog open={!!selectedEntity} onOpenChange={() => setSelectedEntity(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {selectedEntity?.entity}
              {selectedEntity && selectedEntity.clicksChangePercent !== 0 && (
                <span className="text-sm font-normal text-muted-foreground flex items-center gap-1">
                  {selectedEntity.clicksChangePercent > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {selectedEntity.clicksChangePercent > 0 && '+'}{selectedEntity.clicksChangePercent.toFixed(1)}%
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedEntity && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-4 bg-card border border-border rounded-lg">
                  <div className="text-2xl font-bold tracking-tight">{selectedEntity.queryCount}</div>
                  <div className="text-eyebrow mt-1">Queries</div>
                </div>
                <div className="text-center p-4 bg-card border border-border rounded-lg">
                  <div className="text-2xl font-bold tracking-tight flex items-center justify-center gap-1.5">
                    <MousePointer className="w-4 h-4 text-muted-foreground" />
                    {selectedEntity.totalClicksCurrent.toLocaleString()}
                  </div>
                  <div className="text-eyebrow mt-1">Current Clicks</div>
                </div>
                <div className="text-center p-4 bg-card border border-border rounded-lg">
                  <div className="text-2xl font-bold tracking-tight flex items-center justify-center gap-1.5">
                    <Eye className="w-4 h-4 text-muted-foreground" />
                    {selectedEntity.totalImpressionsCurrent.toLocaleString()}
                  </div>
                  <div className="text-eyebrow mt-1">Impressions</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2 text-sm">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  Top Queries
                </h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {selectedEntity.queries
                    .sort((a, b) => b.clicksCurrent - a.clicksCurrent)
                    .slice(0, 10)
                    .map((q, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center text-sm py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <span className="truncate flex-1 text-foreground">{q.query}</span>
                        <span className="text-muted-foreground ml-2 tabular-nums text-xs">
                          {q.clicksCurrent.toLocaleString()} clicks
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {onEntitySelect && (
                <Button onClick={() => { onEntitySelect(selectedEntity.entity, selectedEntity.queries); setSelectedEntity(null); }} className="w-full">
                  Filter Dashboard by "{selectedEntity.entity}"
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
