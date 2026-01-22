import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
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
            tickFormatter={(value) => value.toLocaleString()}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.08)',
              padding: '12px 16px',
            }}
            labelStyle={{
              color: 'hsl(var(--foreground))',
              fontWeight: 600,
              marginBottom: '4px',
            }}
            formatter={(value: number) => value.toLocaleString()}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <Legend 
            wrapperStyle={{ 
              paddingTop: '16px',
              fontSize: '12px',
            }}
          />
          <Bar 
            dataKey="previous" 
            name="Last Period" 
            fill="hsl(var(--muted-foreground))"
            opacity={0.25}
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
          <Bar 
            dataKey="current" 
            name="Current Period" 
            radius={[6, 6, 0, 0]}
            barSize={32}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={CATEGORY_COLORS[entry.categoryKey as QueryCategory]}
                fillOpacity={0.9}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
