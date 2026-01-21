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
  
  // Calculate max clicks for sizing
  const maxClicks = useMemo(() => {
    return Math.max(...entityStats.map(e => e.totalClicksCurrent), 1);
  }, [entityStats]);
  
  // Get font size based on clicks (relative to max)
  const getFontSize = (clicks: number): string => {
    const ratio = clicks / maxClicks;
    if (ratio > 0.5) return 'text-base font-bold';
    if (ratio > 0.25) return 'text-sm font-semibold';
    if (ratio > 0.1) return 'text-sm font-medium';
    return 'text-xs';
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

  const renderEntityTag = (entity: EntityStats, type: 'rising' | 'stable' | 'declining') => {
    const colorClasses = {
      rising: 'bg-accent/50 border-accent text-accent-foreground hover:bg-accent dark:bg-accent/30',
      stable: 'bg-muted border-border text-foreground hover:bg-muted/80',
      declining: 'bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20',
    };
    
    const Icon = type === 'rising' ? TrendingUp : type === 'declining' ? TrendingDown : Minus;
    const iconColor = type === 'rising' ? 'text-[hsl(var(--chart-positive))]' : type === 'declining' ? 'text-destructive' : 'text-muted-foreground';
    
    return (
      <button
        key={entity.entity}
        onClick={() => handleEntityClick(entity)}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full 
          border transition-all hover:scale-105 cursor-pointer
          ${colorClasses[type]}
          ${getFontSize(entity.totalClicksCurrent)}
        `}
      >
        <span className="capitalize">{entity.entity}</span>
        <Icon className={`w-3 h-3 ${iconColor}`} />
      </button>
    );
  };

  const renderColumn = (title: string, entities: EntityStats[], type: 'rising' | 'stable' | 'declining', icon: React.ReactNode) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b">
        {icon}
        <h4 className="font-medium text-sm text-muted-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">({entities.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {entities.slice(0, 10).map(entity => renderEntityTag(entity, type))}
        {entities.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No entities</span>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {renderColumn(
          'Rising', 
          rising, 
          'rising',
          <TrendingUp className="w-4 h-4 text-[hsl(var(--chart-positive))]" />
        )}
        {renderColumn(
          'Stable', 
          stable, 
          'stable',
          <Minus className="w-4 h-4 text-muted-foreground" />
        )}
        {renderColumn(
          'Declining', 
          declining, 
          'declining',
          <TrendingDown className="w-4 h-4 text-destructive" />
        )}
      </div>
      
      {/* Entity Detail Modal */}
      <Dialog open={!!selectedEntity} onOpenChange={() => setSelectedEntity(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {selectedEntity?.entity}
              {selectedEntity && selectedEntity.clicksChangePercent > 0 ? (
                <span className="text-sm font-normal text-[hsl(var(--chart-positive))] flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  +{selectedEntity.clicksChangePercent.toFixed(1)}%
                </span>
              ) : selectedEntity && selectedEntity.clicksChangePercent < 0 ? (
                <span className="text-sm font-normal text-destructive flex items-center gap-1">
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
