import { TrendingUp, TrendingDown, Minus, MousePointer, Eye, Target, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/SectionHeader';
import type { CategoryStats } from '@/types/query';
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
  invertColors?: boolean;
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
    <div className="glass-card p-5 flex flex-col h-full">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-primary/10 rounded-lg text-primary">
          {icon}
        </div>
        <span className="overline">{label}</span>
      </div>
      
      <div className="flex-1 flex flex-col justify-center">
        <span className="text-3xl font-bold tracking-tight text-foreground">
          {typeof currentValue === 'number' ? currentValue.toLocaleString() : currentValue}
        </span>
        <span className="text-xs text-muted-foreground mt-1.5">
          from {typeof previousValue === 'number' ? previousValue.toLocaleString() : previousValue}
        </span>
      </div>
      
      <div className="mt-4 pt-3">
        <span className={cn(
          'inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums',
          isPositive && 'text-emerald-600',
          isNegative && 'text-rose-500',
          isNeutral && 'text-muted-foreground'
        )}>
          {isPositive && <TrendingUp className="w-3.5 h-3.5" />}
          {isNegative && <TrendingDown className="w-3.5 h-3.5" />}
          {isNeutral && <Minus className="w-3.5 h-3.5" />}
          {change > 0 && '+'}{change.toFixed(1)}% {changeLabel}
        </span>
      </div>
    </div>
  );
}

export function CategoryMetricsPanel({ stats, className }: CategoryMetricsPanelProps) {
  const categoryColor = CATEGORY_COLORS[stats.category];
  
  return (
    <div className={cn('glass-card p-6', className)}>
      <div className="flex items-center gap-3 mb-6">
        <div 
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {CATEGORY_LABELS[stats.category]} Performance
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          ({stats.queryCount.toLocaleString()} queries)
        </span>
      </div>
      
      {/* 2x2 Quadrant Grid */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          label="Clicks"
          currentValue={stats.totalClicksCurrent}
          previousValue={stats.totalClicksPrevious}
          change={stats.clicksChangePercent}
          icon={<MousePointer className="w-4 h-4" />}
        />
        <MetricCard
          label="Impressions"
          currentValue={stats.totalImpressionsCurrent}
          previousValue={stats.totalImpressionsPrevious}
          change={stats.impressionsChangePercent}
          icon={<Eye className="w-4 h-4" />}
        />
        <MetricCard
          label="Avg Position"
          currentValue={stats.avgPositionCurrent.toFixed(1)}
          previousValue={stats.avgPositionPrevious.toFixed(1)}
          change={stats.positionChange}
          invertColors={true}
          icon={<Target className="w-4 h-4" />}
        />
        <MetricCard
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
