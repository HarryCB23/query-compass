import { MousePointer, Eye, Target, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';
import { TrendIndicator } from '@/components/ui/metric-card';

interface CategoryMetricsPanelProps {
  stats: CategoryStats;
  className?: string;
}

interface PanelCardProps {
  label: string;
  currentValue: string | number;
  previousValue: string | number;
  change: number;
  changeLabel?: string;
  icon: React.ReactNode;
  invertDirection?: boolean;
}

function PanelCard({
  label,
  currentValue,
  previousValue,
  change,
  changeLabel = 'change',
  icon,
  invertDirection = false,
}: PanelCardProps) {
  const direction: 'up' | 'down' | 'neutral' = invertDirection
    ? change < 0 ? 'up' : change > 0 ? 'down' : 'neutral'
    : change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';

  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col h-full">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-muted rounded-lg text-muted-foreground">
          {icon}
        </div>
        <span className="text-eyebrow">{label}</span>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <span className="text-3xl font-bold tracking-tight text-foreground">
          {typeof currentValue === 'number' ? currentValue.toLocaleString() : currentValue}
        </span>
        <span className="text-xs text-muted-foreground mt-1.5">
          from {typeof previousValue === 'number' ? previousValue.toLocaleString() : previousValue}
        </span>
      </div>

      <div className="mt-4 pt-3 flex items-center gap-2">
        <TrendIndicator value={Math.abs(change)} direction={direction} />
        <span className="text-xs text-muted-foreground">{changeLabel}</span>
      </div>
    </div>
  );
}

export function CategoryMetricsPanel({ stats, className }: CategoryMetricsPanelProps) {
  return (
    <div className={cn('bg-card border border-border rounded-lg p-6', className)}>
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {CATEGORY_LABELS[stats.category]} Performance
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          ({stats.queryCount.toLocaleString()} queries)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <PanelCard
          label="Clicks"
          currentValue={stats.totalClicksCurrent}
          previousValue={stats.totalClicksPrevious}
          change={stats.clicksChangePercent}
          icon={<MousePointer className="w-4 h-4" />}
        />
        <PanelCard
          label="Impressions"
          currentValue={stats.totalImpressionsCurrent}
          previousValue={stats.totalImpressionsPrevious}
          change={stats.impressionsChangePercent}
          icon={<Eye className="w-4 h-4" />}
        />
        <PanelCard
          label="Avg Position"
          currentValue={stats.avgPositionCurrent.toFixed(1)}
          previousValue={stats.avgPositionPrevious.toFixed(1)}
          change={stats.positionChange}
          invertDirection={true}
          icon={<Target className="w-4 h-4" />}
        />
        <PanelCard
          label="Avg CTR"
          currentValue={`${stats.avgCtrCurrent.toFixed(2)}%`}
          previousValue={`${stats.avgCtrPrevious.toFixed(2)}%`}
          change={stats.ctrChange}
          icon={<Percent className="w-4 h-4" />}
        />
      </div>
    </div>
  );
}
