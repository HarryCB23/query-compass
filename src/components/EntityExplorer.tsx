import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, X, MousePointer, Eye, BarChart3 } from 'lucide-react';
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
  
  // Calculate max clicks for sizing
  const maxClicks = useMemo(() => {
    return Math.max(...entityStats.map(e => e.totalClicksCurrent), 1);
  }, [entityStats]);
  
  // Get font size based on clicks (relative to max)
  const getFontSize = (clicks: number): string => {
    const ratio = clicks / maxClicks;
    if (ratio > 0.5) return 'text-xl font-bold';
    if (ratio > 0.25) return 'text-lg font-semibold';
    if (ratio > 0.1) return 'text-base font-medium';
    return 'text-sm';
  };
  
  const handleEntityClick = (entity: EntityStats) => {
    setSelectedEntity(entity);
  };
  
  const handleFilterByEntity = () => {
    if (selectedEntity && onEntitySelect) {
      onEntitySelect(selectedEntity.entity, selectedEntity.queries);
    }
    setSelectedEntity(null);
  };
  
  if (entityStats.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No news entities detected in your queries.
      </div>
    );
  }
  
  return (
    <>
      <div className="flex flex-wrap gap-2">
      {entityStats.slice(0, 30).map((entity) => {
          const isPositive = entity.clicksChangePercent > 0;
          const isNegative = entity.clicksChangePercent < 0;
          
          return (
            <button
              key={entity.entity}
              onClick={() => handleEntityClick(entity)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full 
                border transition-all hover:scale-105 cursor-pointer
                ${isPositive 
                  ? 'bg-accent/50 border-accent hover:bg-accent' 
                  : isNegative 
                    ? 'bg-destructive/10 border-destructive/30 hover:bg-destructive/20'
                    : 'bg-muted border-border hover:bg-muted/80'
                }
                ${getFontSize(entity.totalClicksCurrent)}
              `}
            >
              <span className="capitalize">{entity.entity}</span>
              {isPositive ? (
                <TrendingUp className="w-3 h-3 text-primary" />
              ) : isNegative ? (
                <TrendingDown className="w-3 h-3 text-destructive" />
              ) : (
                <Minus className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>
      
      {/* Entity Detail Modal */}
      <Dialog open={!!selectedEntity} onOpenChange={() => setSelectedEntity(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {selectedEntity?.entity}
              {selectedEntity && selectedEntity.clicksChangePercent > 0 ? (
                <span className="text-sm font-normal text-emerald-500 flex items-center gap-1">
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
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{selectedEntity.queryCount}</div>
                  <div className="text-xs text-muted-foreground">Queries</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold flex items-center justify-center gap-1">
                    <MousePointer className="w-4 h-4 text-primary" />
                    {selectedEntity.totalClicksCurrent.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Current Clicks</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold flex items-center justify-center gap-1">
                    <Eye className="w-4 h-4 text-primary" />
                    {selectedEntity.totalImpressionsCurrent.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Impressions</div>
                </div>
              </div>
              
              {/* Top Queries */}
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Top Queries
                </h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {selectedEntity.queries
                    .sort((a, b) => b.clicksCurrent - a.clicksCurrent)
                    .slice(0, 10)
                    .map((q, i) => (
                      <div 
                        key={i} 
                        className="flex justify-between items-center text-sm py-1 px-2 rounded hover:bg-muted"
                      >
                        <span className="truncate flex-1">{q.query}</span>
                        <span className="text-muted-foreground ml-2">
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
