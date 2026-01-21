import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { QueryData, QueryCategory } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';

interface TopShiftingQueriesProps {
  queries: QueryData[];
  category: QueryCategory;
  limit?: number;
}

export function TopShiftingQueries({ queries, category, limit = 20 }: TopShiftingQueriesProps) {
  const topQueries = useMemo(() => {
    return queries
      .filter(q => q.category === category)
      .sort((a, b) => Math.abs(b.clicksChange) - Math.abs(a.clicksChange))
      .slice(0, limit);
  }, [queries, category, limit]);
  
  if (topQueries.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No queries in {CATEGORY_LABELS[category]} category.
      </div>
    );
  }
  
  return (
    <div className="space-y-1">
      {topQueries.map((query, index) => {
        const isPositive = query.clicksChange > 0;
        const isNegative = query.clicksChange < 0;
        
        return (
          <div 
            key={index}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs text-muted-foreground w-5">{index + 1}</span>
              <span className="truncate text-sm">{query.query}</span>
            </div>
            
            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-sm font-medium">
                  {query.clicksCurrent.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  clicks
                </div>
              </div>
              
              <div className={`
                flex items-center gap-1 min-w-20 justify-end text-sm font-medium
                ${isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : 'text-muted-foreground'}
              `}>
                {isPositive ? (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    +{query.clicksChange.toLocaleString()}
                  </>
                ) : isNegative ? (
                  <>
                    <TrendingDown className="w-4 h-4" />
                    {query.clicksChange.toLocaleString()}
                  </>
                ) : (
                  <>
                    <Minus className="w-4 h-4" />
                    0
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
