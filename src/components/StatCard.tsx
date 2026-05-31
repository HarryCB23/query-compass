import { cn } from '@/lib/utils';
import { TrendIndicator } from '@/components/ui/metric-card';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel = 'vs last period',
  icon,
  className,
}: StatCardProps) {
  return (
    <div className={cn('stat-card group', className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="eyebrow-label">{title}</p>
          <p className="text-3xl font-bold tracking-tight text-foreground">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
        {icon && (
          <div className="p-2.5 bg-muted rounded-lg text-muted-foreground transition-colors group-hover:bg-muted/80">
            {icon}
          </div>
        )}
      </div>

      {change !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <TrendIndicator
            value={Math.abs(change)}
            direction={change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'}
          />
          <span className="text-xs text-muted-foreground">{changeLabel}</span>
        </div>
      )}
    </div>
  );
}
