import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from 'recharts';
import type { CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/types/query';

interface CategoryChangeChartProps {
  stats: CategoryStats[];
}

export function CategoryChangeChart({ stats }: CategoryChangeChartProps) {
  const chartData = stats
    .map(stat => ({
      category: CATEGORY_LABELS[stat.category],
      categoryKey: stat.category,
      change: stat.clicksChangePercent,
      absoluteChange: stat.clicksChange,
    }))
    .sort((a, b) => b.change - a.change);

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          layout="vertical"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal />
          <XAxis 
            type="number"
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)}%`}
          />
          <YAxis 
            type="category"
            dataKey="category"
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            width={100}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
            formatter={(value: number, name: string, props: any) => [
              `${value > 0 ? '+' : ''}${value.toFixed(1)}% (${props.payload.absoluteChange > 0 ? '+' : ''}${props.payload.absoluteChange.toLocaleString()} clicks)`,
              'Change'
            ]}
          />
          <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Bar 
            dataKey="change" 
            radius={[0, 4, 4, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.change >= 0 ? 'hsl(var(--chart-positive))' : 'hsl(var(--chart-negative))'} 
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
