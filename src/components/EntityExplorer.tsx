import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, MousePointer, Eye, BarChart3 } from 'lucide-react';
import { extractEntityStats, type EntityStats } from '@/lib/entityExtractor';
import type { QueryData } from '@/types/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EntityExplorerProps {
  queries: QueryData[];
  onEntitySelect?: (entity: string, queries: QueryData[]) => void;
}

export function EntityExplorer({ queries, onEntitySelect }: EntityExplorerProps) {
  const [selectedEntity, setSelectedEntity] = useState<EntityStats | null>(null);
  
  const entityStats = useMemo(() => {
    return extractEntityStats(queries);
  }, [queries]);
  
  // Split entities into rising, stable, declining
  const { rising, stable, declining } = useMemo(() => {
    const threshold = 5; // ±5% considered stable
    return {
      rising: entityStats.filter(e => e.clicksChangePercent > threshold),
      stable: entityStats.filter(e => Math.abs(e.clicksChangePercent) <= threshold),
      declining: entityStats.filter(e => e.clicksChangePercent < -threshold),
    };
  }, [entityStats]);
  
  const handleEntityClick = (entity: EntityStats) => {
    setSelectedEntity(entity);
  };
  
  const handleFilterByEntity = () => {
    if (selectedEntity && onEntitySelect) {
      onEntitySelect(selectedEntity.entity, selectedEntity.queries);
    }
    setSelectedEntity(null);
  };

  const renderEntityRow = (entity: EntityStats, type: 'rising' | 'stable' | 'declining') => {
    const Icon = type === 'rising' ? TrendingUp : type === 'declining' ? TrendingDown : Minus;
    
    const rowClass = type === 'rising' 
      ? 'entity-row entity-row-rising' 
      : type === 'declining' 
        ? 'entity-row entity-row-declining' 
        : 'entity-row entity-row-stable';

    const iconClass = type === 'rising' 
      ? 'text-emerald-600' 
      : type === 'declining' 
        ? 'text-rose-500' 
        : 'text-slate-400';

    const changeClass = type === 'rising' 
      ? 'text-emerald-600' 
      : type === 'declining' 
        ? 'text-rose-500' 
        : 'text-muted-foreground';
    
    return (
      <button
        key={entity.entity}
        onClick={() => handleEntityClick(entity)}
        className={rowClass}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="capitalize font-medium text-sm text-foreground truncate">
            {entity.entity}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-medium tabular-nums ${changeClass}`}>
            {type === 'rising' && '+'}
            {entity.clicksChangePercent.toFixed(0)}%
          </span>
          <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
        </div>
      </button>
    );
  };

  const renderColumn = (
    title: string, 
    entities: EntityStats[], 
    type: 'rising' | 'stable' | 'declining', 
    icon: React.ReactNode,
    accentColor: string
  ) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-4">
        <div className={`p-1.5 rounded-md ${accentColor}`}>
          {icon}
        </div>
        <div>
          <span className="overline">{title}</span>
          <span className="text-xs text-muted-foreground ml-2">({entities.length})</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {entities.slice(0, 8).map(entity => renderEntityRow(entity, type))}
        {entities.length === 0 && (
          <div className="text-xs text-muted-foreground italic py-4 text-center">
            No entities
          </div>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {renderColumn(
          'Rising', 
          rising, 
          'rising',
          <TrendingUp className="w-4 h-4 text-emerald-600" />,
          'bg-emerald-50'
        )}
        {renderColumn(
          'Stable', 
          stable, 
          'stable',
          <Minus className="w-4 h-4 text-slate-500" />,
          'bg-slate-100'
        )}
        {renderColumn(
          'Declining', 
          declining, 
          'declining',
          <TrendingDown className="w-4 h-4 text-rose-500" />,
          'bg-rose-50'
        )}
      </div>
      
      {/* Entity Detail Modal */}
      <Dialog open={!!selectedEntity} onOpenChange={() => setSelectedEntity(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {selectedEntity?.entity}
              {selectedEntity && selectedEntity.clicksChangePercent > 0 ? (
                <span className="text-sm font-normal text-emerald-600 flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  +{selectedEntity.clicksChangePercent.toFixed(1)}%
                </span>
              ) : selectedEntity && selectedEntity.clicksChangePercent < 0 ? (
                <span className="text-sm font-normal text-rose-500 flex items-center gap-1">
                  <TrendingDown className="w-4 h-4" />
                  {selectedEntity.clicksChangePercent.toFixed(1)}%
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          
          {selectedEntity && (
            <div className="space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-4 glass-card rounded-xl">
                  <div className="text-2xl font-bold tracking-tight">{selectedEntity.queryCount}</div>
                  <div className="overline mt-1">Queries</div>
                </div>
                <div className="text-center p-4 glass-card rounded-xl">
                  <div className="text-2xl font-bold tracking-tight flex items-center justify-center gap-1.5">
                    <MousePointer className="w-4 h-4 text-primary" />
                    {selectedEntity.totalClicksCurrent.toLocaleString()}
                  </div>
                  <div className="overline mt-1">Current Clicks</div>
                </div>
                <div className="text-center p-4 glass-card rounded-xl">
                  <div className="text-2xl font-bold tracking-tight flex items-center justify-center gap-1.5">
                    <Eye className="w-4 h-4 text-primary" />
                    {selectedEntity.totalImpressionsCurrent.toLocaleString()}
                  </div>
                  <div className="overline mt-1">Impressions</div>
                </div>
              </div>
              
              {/* Top Queries */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2 text-sm">
                  <BarChart3 className="w-4 h-4 text-primary" />
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
                    ))
                  }
                </div>
              </div>
              
              {onEntitySelect && (
                <Button onClick={handleFilterByEntity} className="w-full">
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
