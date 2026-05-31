import { useMemo } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
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
      <div className="text-center py-8 text-muted-foreground text-sm">
        No queries in {CATEGORY_LABELS[category]} category.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {topQueries.map((query, index) => {
        const isPositive = query.clicksChange > 0;
        const isNegative = query.clicksChange < 0;

        return (
          <div
            key={index}
            className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors group"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-[10px] font-medium text-muted-foreground w-5 tabular-nums">
                {index + 1}
              </span>
              <span className="truncate text-sm text-foreground group-hover:text-foreground/80">
                {query.query}
              </span>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {query.clicksCurrent.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">clicks</div>
              </div>

              <div className="flex items-center gap-1 min-w-20 justify-end text-xs font-medium tabular-nums text-muted-foreground">
                {isPositive ? <ArrowUp className="w-3 h-3 shrink-0" /> : isNegative ? <ArrowDown className="w-3 h-3 shrink-0" /> : <Minus className="w-3 h-3 shrink-0" />}
                <span>{isPositive && '+'}{query.clicksChange.toLocaleString()}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
