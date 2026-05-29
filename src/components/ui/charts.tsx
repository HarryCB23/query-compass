/**
 * Chart primitives — Phase 6.2
 * VerticalBarChart, DonutChart
 *
 * Built on recharts + shadcn ChartContainer.
 * Colours exclusively from --chart-* tokens.
 * No gridlines. No hardcoded hex.
 */
import {
  BarChart, Bar, XAxis, YAxis, LabelList,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'

// ── VerticalBarChart ──────────────────────────────────────────────────────────
// Vertical columns (standard orientation). Labels above bars.
// Supports single series. Grouped series variant via `series` prop.

export interface BarDatum {
  label: string
  value: number
  [k: string]: string | number
}

interface VerticalBarChartProps {
  data: BarDatum[]
  valueFormatter?: (v: number) => string
  /** Token-resolved colour string, e.g. "hsl(var(--chart-risk))" */
  barColor?: string
  height?: number
  className?: string
}

const RISK_COLOR    = 'hsl(var(--chart-risk))'
const NEUTRAL_COLOR = 'hsl(var(--chart-neutral))'
const MUTED_COLOR   = 'hsl(var(--chart-muted))'

export { RISK_COLOR, NEUTRAL_COLOR, MUTED_COLOR }

export function VerticalBarChart({
  data,
  valueFormatter = (v) => v.toLocaleString(),
  barColor = RISK_COLOR,
  height = 220,
  className,
}: VerticalBarChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 24, right: 4, left: 4, bottom: 0 }}
          barCategoryGap="30%"
        >
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontFamily: 'Inter, sans-serif' }}
          />
          <YAxis hide />
          <Bar dataKey="value" fill={barColor} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="top"
              formatter={valueFormatter}
              style={{
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'Inter, sans-serif',
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── DonutChart ────────────────────────────────────────────────────────────────
// 2+ segment donut. Big center label. Risk slice red, others grey.

export interface DonutSegment {
  value: number
  color: string
  label?: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  centerLabel: string
  centerSubline?: string
  size?: number
  className?: string
}

export function DonutChart({
  segments,
  centerLabel,
  centerSubline,
  size = 160,
  className,
}: DonutChartProps) {
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={segments}
            dataKey="value"
            innerRadius="60%"
            outerRadius="80%"
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {segments.map((seg, i) => (
              <Cell key={i} fill={seg.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-lg font-bold tabular-nums text-foreground leading-none">
          {centerLabel}
        </span>
        {centerSubline && (
          <span className="text-[10px] text-muted-foreground mt-0.5">{centerSubline}</span>
        )}
      </div>
    </div>
  )
}
