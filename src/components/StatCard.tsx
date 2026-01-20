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
  changeLabel = 'vs last year',
  icon,
  className 
}: StatCardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change === 0;

  return (
    <div className={cn('stat-card', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold text-foreground">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
        {icon && (
          <div className="p-2 bg-primary/10 rounded-lg">
            {icon}
          </div>
        )}
      </div>
      
      {change !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1 text-sm font-medium',
            isPositive && 'change-positive',
            isNegative && 'change-negative',
            isNeutral && 'change-neutral'
          )}>
            {isPositive && <TrendingUp className="w-4 h-4" />}
            {isNegative && <TrendingDown className="w-4 h-4" />}
            {isNeutral && <Minus className="w-4 h-4" />}
            {isPositive && '+'}{change.toFixed(1)}%
          </span>
          <span className="text-sm text-muted-foreground">{changeLabel}</span>
        </div>
      )}
    </div>
  );
}
