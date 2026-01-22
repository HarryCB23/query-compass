import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from 'recharts';
import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';

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
          <XAxis 
            type="number"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)}%`}
          />
          <YAxis 
            type="category"
            dataKey="category"
            tick={{ fontSize: 12, fill: 'hsl(var(--foreground))', fontWeight: 500 }}
            tickLine={false}
            axisLine={false}
            width={100}
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
            formatter={(value: number, name: string, props: any) => [
              `${value > 0 ? '+' : ''}${value.toFixed(1)}% (${props.payload.absoluteChange > 0 ? '+' : ''}${props.payload.absoluteChange.toLocaleString()} clicks)`,
              'Change'
            ]}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1} />
          <Bar 
            dataKey="change" 
            radius={[0, 6, 6, 0]}
            barSize={24}
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.change >= 0 ? 'hsl(160, 84%, 39%)' : 'hsl(350, 89%, 60%)'} 
                fillOpacity={0.9}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
