import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { CategoryStats, QueryCategory } from '@/types/query'
import { CATEGORY_LABELS } from '@/types/query'

// CSS variable colors per category token
const CAT_COLORS: Record<QueryCategory, string> = {
  news:          'hsl(var(--cat-news))',
  informational: 'hsl(var(--cat-info))',
  product:       'hsl(var(--cat-product))',
  branded:       'hsl(var(--cat-branded))',
  commercial:    'hsl(var(--cat-comm))',
  transactional: 'hsl(var(--cat-trans))',
  other:         'hsl(var(--cat-other))',
}

interface ScatterPoint {
  position: number
  ctr: number
  size: number
  category: QueryCategory
  queryCount: number
  positionDelta: number
  ctrDelta: number
  label: string
}

function CustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: ScatterPoint }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const posDelta = d.positionDelta
  const ctrDelta = d.ctrDelta
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-md space-y-1 min-w-[160px]">
      <p className="font-semibold text-sm mb-1">{d.label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Avg position</span>
        <span className="font-medium tabular-nums">
          {d.position.toFixed(1)}
          {posDelta !== 0 && (
            <span className={posDelta < 0 ? 'text-trend-up ml-1' : 'text-trend-down ml-1'}>
              {posDelta < 0 ? '↑' : '↓'} {Math.abs(posDelta).toFixed(1)}%
            </span>
          )}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">CTR</span>
        <span className="font-medium tabular-nums">
          {d.ctr.toFixed(2)}%
          {ctrDelta !== 0 && (
            <span className={ctrDelta > 0 ? 'text-trend-up ml-1' : 'text-trend-down ml-1'}>
              {ctrDelta > 0 ? '↑' : '↓'} {Math.abs(ctrDelta).toFixed(1)}%
            </span>
          )}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Queries</span>
        <span className="font-medium tabular-nums">{d.queryCount.toLocaleString()}</span>
      </div>
    </div>
  )
}

interface CategoryScatterChartProps {
  stats: CategoryStats[]
}

export function CategoryScatterChart({ stats }: CategoryScatterChartProps) {
  const active = stats.filter(s => s.queryCount > 0 && s.avgPositionCurrent > 0)

  if (active.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No position data available
      </p>
    )
  }

  const points: ScatterPoint[] = active.map(s => ({
    position:      s.avgPositionCurrent,
    ctr:           s.avgCtrCurrent,
    size:          s.queryCount,
    category:      s.category,
    queryCount:    s.queryCount,
    positionDelta: s.positionChange,
    ctrDelta:      s.ctrChange,
    label:         CATEGORY_LABELS[s.category],
  }))

  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
            <XAxis
              type="number"
              dataKey="position"
              name="Avg Position"
              reversed
              domain={([min, max]: [number, number]) => [
                Math.max(1, min - 1),
                max + 1,
              ]}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              label={{
                value: '← worse position   avg position   better →',
                position: 'insideBottom',
                offset: -20,
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <YAxis
              type="number"
              dataKey="ctr"
              name="CTR"
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              label={{
                value: 'CTR %',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                fontSize: 11,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <ZAxis type="number" dataKey="size" range={[120, 1200]} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--border))' }} />
            {points.map(pt => (
              <Scatter
                key={pt.category}
                name={pt.label}
                data={[pt]}
                fill={CAT_COLORS[pt.category]}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1">
        {points.map(pt => (
          <div key={pt.category} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: CAT_COLORS[pt.category] }}
            />
            {pt.label}
          </div>
        ))}
      </div>
    </div>
  )
}
