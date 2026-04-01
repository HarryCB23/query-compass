import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

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
  className 
}: StatCardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change === 0;

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
          <div className="p-2.5 bg-primary/10 rounded-lg text-primary transition-colors group-hover:bg-primary/15">
            {icon}
          </div>
        )}
      </div>
      
      {change !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1 text-sm font-medium tabular-nums',
            isPositive && 'text-emerald-600',
            isNegative && 'text-rose-500',
            isNeutral && 'text-muted-foreground'
          )}>
            {isPositive && <TrendingUp className="w-3.5 h-3.5" />}
            {isNegative && <TrendingDown className="w-3.5 h-3.5" />}
            {isNeutral && <Minus className="w-3.5 h-3.5" />}
            {isPositive && '+'}{change.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">{changeLabel}</span>
        </div>
      )}
    </div>
  );
}
