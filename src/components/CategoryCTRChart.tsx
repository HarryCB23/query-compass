import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import type { CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/types/query';

interface CategoryCTRChartProps {
  stats: CategoryStats[];
}

export function CategoryCTRChart({ stats }: CategoryCTRChartProps) {
  const chartData = stats
    .filter(stat => stat.queryCount > 0)
    .map(stat => ({
      category: CATEGORY_LABELS[stat.category],
      categoryKey: stat.category,
      current: stat.avgCtrCurrent,
      previous: stat.avgCtrPrevious,
      change: stat.avgCtrCurrent - stat.avgCtrPrevious,
      changePercent: stat.ctrChange,
    }))
    .sort((a, b) => b.current - a.current);

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
            domain={[0, 'auto']}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value.toFixed(0)}%`}
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
            formatter={(value: number, name: string, props: any) => {
              if (name === 'Current') {
                const change = props.payload.change;
                const changeStr = change > 0 
                  ? `↑ ${change.toFixed(2)}pp` 
                  : change < 0 
                    ? `↓ ${Math.abs(change).toFixed(2)}pp`
                    : 'no change';
                return [`${value.toFixed(2)}% (${changeStr})`, name];
              }
              return [`${value.toFixed(2)}%`, name];
            }}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <Bar 
            dataKey="previous" 
            name="Previous" 
            fill="hsl(var(--muted-foreground))"
            opacity={0.25}
            radius={[0, 4, 4, 0]}
            barSize={20}
          />
          <Bar 
            dataKey="current" 
            name="Current" 
            radius={[0, 6, 6, 0]}
            barSize={24}
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
