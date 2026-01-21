import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/query';

interface CategoryMetricCardsProps {
  stats: CategoryStats[];
  metric: 'position' | 'ctr';
}

export function CategoryMetricCards({ stats, metric }: CategoryMetricCardsProps) {
  const filteredStats = stats.filter(s => s.queryCount > 0);
  
  // Sort by current value - for position, lower is better so sort ascending
  // For CTR, higher is better so sort descending
  const sortedStats = [...filteredStats].sort((a, b) => {
    if (metric === 'position') {
      return a.avgPositionCurrent - b.avgPositionCurrent;
    }
    return b.avgCtrCurrent - a.avgCtrCurrent;
  });

  // Split into two rows: first 4, then remaining 3
  const firstRow = sortedStats.slice(0, 4);
  const secondRow = sortedStats.slice(4, 7);
  
  const renderCard = (stat: CategoryStats) => {
    const value = metric === 'position' ? stat.avgPositionCurrent : stat.avgCtrCurrent;
    const change = metric === 'position' ? stat.positionChange : stat.ctrChange;
    
    // For position: negative change = improvement (moved up in rankings)
    // For CTR: positive change = improvement
    const isImproved = metric === 'position' ? change < 0 : change > 0;
    const isDeclined = metric === 'position' ? change > 0 : change < 0;
    
    return (
      <div 
        key={stat.category}
        className="p-4 rounded-xl border bg-card hover:shadow-md transition-all"
        style={{ borderLeftColor: CATEGORY_COLORS[stat.category], borderLeftWidth: '4px' }}
      >
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {CATEGORY_LABELS[stat.category]}
        </div>
        
        <div className="text-3xl font-bold text-foreground">
          {metric === 'position' 
            ? value.toFixed(1) 
            : `${value.toFixed(1)}%`
          }
        </div>
        
        <div className={`
          flex items-center gap-1.5 text-sm mt-2
          ${isImproved 
            ? 'text-emerald-500' 
            : isDeclined 
              ? 'text-rose-500' 
              : 'text-muted-foreground'
          }
        `}>
          <span className="font-medium">
            {Math.abs(change).toFixed(1)}%
          </span>
          {isImproved ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : isDeclined ? (
            <TrendingDown className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
        </div>
      </div>
    );
  };
  
  return (
    <div className="space-y-3">
      {/* First row - 4 items */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {firstRow.map(renderCard)}
      </div>
      
      {/* Second row - 3 items */}
      {secondRow.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {secondRow.map(renderCard)}
        </div>
      )}
    </div>
  );
}
