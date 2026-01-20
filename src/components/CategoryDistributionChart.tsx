import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  Cell
} from 'recharts';
import type { CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/types/query';

interface CategoryDistributionChartProps {
  stats: CategoryStats[];
  dataKey?: 'clicks' | 'impressions';
}

export function CategoryDistributionChart({ 
  stats, 
  dataKey = 'clicks' 
}: CategoryDistributionChartProps) {
  const chartData = stats.map(stat => ({
    category: CATEGORY_LABELS[stat.category],
    categoryKey: stat.category,
    current: dataKey === 'clicks' ? stat.totalClicksCurrent : stat.totalImpressionsCurrent,
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
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="category" 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickFormatter={(value) => value.toLocaleString()}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
            formatter={(value: number) => value.toLocaleString()}
          />
          <Legend />
          <Bar 
            dataKey="previous" 
            name="Last Year" 
            fill="hsl(var(--muted-foreground))"
            opacity={0.5}
            radius={[4, 4, 0, 0]}
          />
          <Bar 
            dataKey="current" 
            name="Current Period" 
            radius={[4, 4, 0, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={CATEGORY_COLORS[entry.categoryKey as QueryCategory]} 
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
