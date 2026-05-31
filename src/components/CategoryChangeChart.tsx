import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { CategoryStats } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';
import { NEUTRAL_COLOR } from '@/components/ui/charts';

interface CategoryChangeChartProps {
  stats: CategoryStats[];
}

export function CategoryChangeChart({ stats }: CategoryChangeChartProps) {
  const chartData = stats
    .map(stat => ({
      category:       CATEGORY_LABELS[stat.category],
      change:         stat.clicksChangePercent,
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
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
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
              borderRadius: '8px',
              padding: '12px 16px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600, marginBottom: '4px' }}
            formatter={(value: number, _name: string, props: { payload: { absoluteChange: number } }) => [
              `${value > 0 ? '+' : ''}${value.toFixed(1)}% (${props.payload.absoluteChange > 0 ? '+' : ''}${props.payload.absoluteChange.toLocaleString()} clicks)`,
              'Change',
            ]}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1} />
          <Bar
            dataKey="change"
            fill={NEUTRAL_COLOR}
            radius={[0, 6, 6, 0]}
            barSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
