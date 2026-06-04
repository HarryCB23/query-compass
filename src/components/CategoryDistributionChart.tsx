import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';
import { FOREGROUND_COLOR, RISK_DEEP_COLOR } from '@/components/ui/charts';

interface CategoryDistributionChartProps {
  stats: CategoryStats[];
  dataKey?: 'clicks' | 'impressions';
}

export function CategoryDistributionChart({
  stats,
  dataKey = 'clicks',
}: CategoryDistributionChartProps) {
  const chartData = stats.map(stat => ({
    category: CATEGORY_LABELS[stat.category],
    current:  dataKey === 'clicks' ? stat.totalClicksCurrent  : stat.totalImpressionsCurrent,
    previous: dataKey === 'clicks' ? stat.totalClicksPrevious : stat.totalImpressionsPrevious,
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          barGap={4}
        >
          <XAxis
            dataKey="category"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v.toLocaleString()}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              padding: '12px 16px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600, marginBottom: '4px' }}
            formatter={(value: number) => value.toLocaleString()}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <Legend
            wrapperStyle={{ paddingTop: '16px', fontSize: '12px' }}
          />
          <Bar
            dataKey="previous"
            name="Last Period"
            fill={RISK_DEEP_COLOR}
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
          <Bar
            dataKey="current"
            name="Current Period"
            fill={FOREGROUND_COLOR}
            radius={[6, 6, 0, 0]}
            barSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
