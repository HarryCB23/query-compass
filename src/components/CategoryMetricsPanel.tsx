import { TrendingUp, TrendingDown, Minus, MousePointer, Eye, Target, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/query';

interface CategoryMetricsPanelProps {
  stats: CategoryStats;
  className?: string;
}

interface MetricCardProps {
  label: string;
  currentValue: string | number;
  previousValue: string | number;
  change: number;
  changeLabel?: string;
  icon: React.ReactNode;
  invertColors?: boolean; // For position where lower is better
}

function MetricCard({ 
  label, 
  currentValue, 
  previousValue, 
  change, 
  changeLabel = 'change',
  icon,
  invertColors = false
}: MetricCardProps) {
  const isPositive = invertColors ? change < 0 : change > 0;
  const isNegative = invertColors ? change > 0 : change < 0;
  const isNeutral = change === 0;

  return (
    <div className="p-4 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-primary/10 rounded">
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">
          {typeof currentValue === 'number' ? currentValue.toLocaleString() : currentValue}
        </span>
        <span className="text-sm text-muted-foreground">
          from {typeof previousValue === 'number' ? previousValue.toLocaleString() : previousValue}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1">
      <span className={cn(
          'inline-flex items-center gap-1 text-sm font-medium',
          isPositive && 'text-[hsl(var(--chart-positive))]',
          isNegative && 'text-destructive',
          isNeutral && 'text-muted-foreground'
        )}>
          {isPositive && <TrendingUp className="w-3.5 h-3.5" />}
          {isNegative && <TrendingDown className="w-3.5 h-3.5" />}
          {isNeutral && <Minus className="w-3.5 h-3.5" />}
          {change > 0 && '+'}{change.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">{changeLabel}</span>
      </div>
    </div>
  );
}

export function CategoryMetricsPanel({ stats, className }: CategoryMetricsPanelProps) {
  const categoryColor = CATEGORY_COLORS[stats.category];
  
  return (
    <div className={cn('p-6 bg-card border rounded-xl', className)}>
      <div className="flex items-center gap-3 mb-6">
        <div 
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <h3 className="text-lg font-semibold text-foreground">
          {CATEGORY_LABELS[stats.category]} Performance
        </h3>
        <span className="text-sm text-muted-foreground">
          ({stats.queryCount.toLocaleString()} queries)
        </span>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Clicks"
          currentValue={stats.totalClicksCurrent}
          previousValue={stats.totalClicksPrevious}
          change={stats.clicksChangePercent}
          icon={<MousePointer className="w-4 h-4 text-primary" />}
        />
        <MetricCard
          label="Impressions"
          currentValue={stats.totalImpressionsCurrent}
          previousValue={stats.totalImpressionsPrevious}
          change={stats.impressionsChangePercent}
          icon={<Eye className="w-4 h-4 text-primary" />}
        />
        <MetricCard
          label="Avg Position"
          currentValue={stats.avgPositionCurrent.toFixed(1)}
          previousValue={stats.avgPositionPrevious.toFixed(1)}
          change={stats.positionChange}
          invertColors={true}
          icon={<Target className="w-4 h-4 text-primary" />}
        />
        <MetricCard
          label="Avg CTR"
          currentValue={`${stats.avgCtrCurrent.toFixed(2)}%`}
          previousValue={`${stats.avgCtrPrevious.toFixed(2)}%`}
          change={stats.ctrChange}
          icon={<Percent className="w-4 h-4 text-primary" />}
        />
      </div>
    </div>
  );
}