import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { useMemo } from 'react'
import { extractEntityStats } from '@/lib/entityExtractor'
import type { QueryData } from '@/types/query'
import type { SerpSnapshotData } from '@/components/QueryTable'

// ── Symmetric log transform ────────────────────────────────────────────────
// Handles extreme outliers (e.g. +25 000%) while keeping 0 visible.
function symLog(x: number): number {
  return Math.sign(x) * Math.log10(Math.abs(x) + 1)
}

function invSymLog(y: number): number {
  return Math.sign(y) * (Math.pow(10, Math.abs(y)) - 1)
}

function xTickFormatter(v: number): string {
  const pct = Math.round(invSymLog(v))
  if (pct === 0) return '0%'
  return `${pct > 0 ? '+' : ''}${pct}%`
}

// ── Tier coloring ─────────────────────────────────────────────────────────
type Tier = 'high' | 'medium' | 'low'

const TIER_COLORS: Record<Tier, string> = {
  high:   'hsl(var(--risk))',
  medium: 'hsl(var(--tier-medium))',
  low:    'hsl(var(--tier-low))',
}

function computeTier(
  queries: QueryData[],
  serpSnapshots: Map<string, SerpSnapshotData>,
): Tier {
  const withSnap = queries.filter(q => serpSnapshots.has(q.query))
  if (withSnap.length === 0) return 'low'
  const aioCount = withSnap.filter(q => serpSnapshots.get(q.query)!.has_ai_overview).length
  const pct = aioCount / withSnap.length
  if (pct > 0.5) return 'high'
  if (pct > 0.2) return 'medium'
  return 'low'
}

// ── Custom dot + label ─────────────────────────────────────────────────────
interface BubblePayload {
  entity: string
  xVal: number
  yVal: number
  size: number
  tier: Tier
  clicksCurrent: number
  clicksChangePercent: number
  queryCount: number
  isLabeled: boolean
}

function CustomDot(props: {
  cx?: number
  cy?: number
  r?: number
  payload?: BubblePayload
}) {
  const { cx = 0, cy = 0, r = 6, payload } = props
  if (!payload) return null
  const color = TIER_COLORS[payload.tier]
  return (
    <g>
      <circle
        cx={cx} cy={cy} r={r}
        fill={color} fillOpacity={0.75}
        stroke={color} strokeWidth={1} strokeOpacity={0.4}
      />
      {payload.isLabeled && (
        <text
          x={cx} y={cy - r - 5}
          textAnchor="middle"
          fontSize={10}
          fill="hsl(var(--foreground))"
          fontWeight={500}
          style={{ pointerEvents: 'none' }}
        >
          {payload.entity}
        </text>
      )}
    </g>
  )
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: BubblePayload }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-md space-y-1 min-w-[160px]">
      <p className="font-semibold text-sm mb-1 capitalize">{d.entity}</p>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Clicks</span>
        <span className="font-medium tabular-nums">{d.clicksCurrent.toLocaleString()}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Change</span>
        <span className={['font-medium tabular-nums', d.clicksChangePercent > 0 ? 'text-trend-up' : d.clicksChangePercent < 0 ? 'text-trend-down' : ''].join(' ')}>
          {d.clicksChangePercent > 0 ? '+' : ''}{d.clicksChangePercent.toFixed(1)}%
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Queries</span>
        <span className="font-medium tabular-nums">{d.queryCount}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">AIO exposure</span>
        <span className={['font-medium', d.tier === 'high' ? 'text-risk' : ''].join(' ')}>
          {d.tier === 'high' ? 'High (>50%)' : d.tier === 'medium' ? 'Medium (20–50%)' : 'Low (<20%)'}
        </span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface EntityBubbleChartProps {
  queries: QueryData[]
  serpSnapshots: Map<string, SerpSnapshotData>
}

export function EntityBubbleChart({ queries, serpSnapshots }: EntityBubbleChartProps) {
  const entities = useMemo(() => extractEntityStats(queries), [queries])

  const points = useMemo((): BubblePayload[] => {
    const top8 = new Set(entities.slice(0, 8).map(e => e.entity))

    return entities
      .filter(e => e.totalClicksCurrent > 0)
      .map(e => ({
        entity:             e.entity,
        xVal:               symLog(e.clicksChangePercent),
        yVal:               e.totalClicksCurrent,
        size:               e.queryCount,
        tier:               computeTier(e.queries, serpSnapshots),
        clicksCurrent:      e.totalClicksCurrent,
        clicksChangePercent: e.clicksChangePercent,
        queryCount:         e.queryCount,
        isLabeled:          top8.has(e.entity),
      }))
  }, [entities, serpSnapshots])

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No news entity data — classify queries first.
      </p>
    )
  }

  const xTicks = [-3, -2, -1, 0, 1, 2, 3]

  return (
    <div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 24, bottom: 32, left: 16 }}>
            <XAxis
              type="number"
              dataKey="xVal"
              name="Click change"
              domain={[-3.5, 3.5]}
              ticks={xTicks}
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              label={{
                value: '% change in clicks',
                position: 'insideBottom',
                offset: -20,
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <YAxis
              type="number"
              dataKey="yVal"
              name="Clicks"
              scale="log"
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              label={{
                value: 'Clicks (log)',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <ZAxis type="number" dataKey="size" range={[60, 800]} />
            <ReferenceLine
              x={0}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <Scatter
              data={points}
              shape={<CustomDot />}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Tier legend */}
      <div className="flex gap-4 justify-center mt-1 text-xs text-muted-foreground">
        {(['high', 'medium', 'low'] as Tier[]).map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TIER_COLORS[t] }} />
            {t === 'high' ? 'High AIO (>50%)' : t === 'medium' ? 'Med AIO (20–50%)' : 'Low AIO (<20%)'}
          </div>
        ))}
      </div>
    </div>
  )
}
