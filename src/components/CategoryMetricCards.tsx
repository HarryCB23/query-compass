import { TrendingUp, TrendingDown, Minus, Target, Percent } from 'lucide-react';
import type { CategoryStats, QueryCategory } from '@/types/query';
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
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {sortedStats.map((stat) => {
        const value = metric === 'position' ? stat.avgPositionCurrent : stat.avgCtrCurrent;
        const change = metric === 'position' ? stat.positionChange : stat.ctrChange;
        
        // For position: negative change = improvement (moved up in rankings)
        // For CTR: positive change = improvement
        const isImproved = metric === 'position' ? change < 0 : change > 0;
        const isDeclined = metric === 'position' ? change > 0 : change < 0;
        
        return (
          <div 
            key={stat.category}
            className="p-4 rounded-xl border bg-card hover:shadow-md transition-shadow"
            style={{ borderLeftColor: CATEGORY_COLORS[stat.category], borderLeftWidth: '3px' }}
          >
            <div className="text-xs text-muted-foreground mb-1">
              {CATEGORY_LABELS[stat.category]}
            </div>
            
            <div className="text-2xl font-bold">
              {metric === 'position' 
                ? value.toFixed(1) 
                : `${value.toFixed(1)}%`
              }
            </div>
            
            <div className={`
              flex items-center gap-1 text-sm mt-1
              ${isImproved 
                ? 'text-emerald-500' 
                : isDeclined 
                  ? 'text-rose-500' 
                  : 'text-muted-foreground'
              }
            `}>
              {isImproved ? (
                <TrendingUp className="w-3 h-3" />
              ) : isDeclined ? (
                <TrendingDown className="w-3 h-3" />
              ) : (
                <Minus className="w-3 h-3" />
              )}
              <span>
                {Math.abs(change).toFixed(1)}%
                {metric === 'position' && (
                  <span className="text-xs ml-0.5">
                    {isImproved ? '↑' : isDeclined ? '↓' : ''}
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
