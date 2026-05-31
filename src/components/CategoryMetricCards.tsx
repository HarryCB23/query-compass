import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';
import { TrendIndicator } from '@/components/ui/metric-card';

interface CategoryMetricCardsProps {
  stats: CategoryStats[];
  metric: 'position' | 'ctr';
}

export function CategoryMetricCards({ stats, metric }: CategoryMetricCardsProps) {
  const filteredStats = stats.filter(s => s.queryCount > 0);

  const sortedStats = [...filteredStats].sort((a, b) => {
    if (metric === 'position') return a.avgPositionCurrent - b.avgPositionCurrent;
    return b.avgCtrCurrent - a.avgCtrCurrent;
  });

  const firstRow  = sortedStats.slice(0, 4);
  const secondRow = sortedStats.slice(4, 7);

  const renderCard = (stat: CategoryStats) => {
    const value  = metric === 'position' ? stat.avgPositionCurrent : stat.avgCtrCurrent;
    const change = metric === 'position' ? stat.positionChange : stat.ctrChange;

    // For position: negative = improvement (moved up). For CTR: positive = improvement.
    const direction: 'up' | 'down' | 'neutral' =
      metric === 'position'
        ? change < 0 ? 'up' : change > 0 ? 'down' : 'neutral'
        : change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';

    return (
      <div key={stat.category} className="bg-card border border-border rounded-lg p-4">
        <div className="text-eyebrow mb-2">{CATEGORY_LABELS[stat.category]}</div>
        <div className="text-2xl font-bold tracking-tight text-foreground">
          {metric === 'position' ? value.toFixed(1) : `${value.toFixed(1)}%`}
        </div>
        <div className="mt-1.5">
          <TrendIndicator value={Math.abs(change)} direction={direction} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {firstRow.map(renderCard)}
      </div>
      {secondRow.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {secondRow.map(renderCard)}
        </div>
      )}
    </div>
  );
}
