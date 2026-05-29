/**
 * Design system primitives — Phase 6.2
 * MetricCard, HeroNumber, TierDot, KPITile, TrendIndicator, DataTable
 *
 * Governing rule: red = AI-driven risk only. Severity via size/weight/position.
 * All colours via tokens — no hardcoded hex.
 */
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── MetricCard ────────────────────────────────────────────────────────────────

interface MetricCardProps {
  title?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  /** Thin red top border — use only for AI-risk callouts */
  riskAccent?: boolean
}

export function MetricCard({ title, icon, children, className, riskAccent }: MetricCardProps) {
  return (
    <div className={cn(
      'bg-card border border-border rounded-lg p-6',
      riskAccent && 'border-t-2 border-t-risk',
      className,
    )}>
      {(title || icon) && (
        <div className="flex items-center gap-1.5 mb-4">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          {title && <span className="text-eyebrow">{title}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

// ── HeroNumber ────────────────────────────────────────────────────────────────

interface HeroNumberProps {
  value: string
  label?: string
  subline?: string
  /** Tailwind class to override value colour; defaults to text-foreground */
  valueClassName?: string
}

export function HeroNumber({ value, label, subline, valueClassName }: HeroNumberProps) {
  return (
    <div className="flex flex-col items-center text-center gap-1">
      {label && <span className="text-eyebrow">{label}</span>}
      <span className={cn('text-display', valueClassName ?? 'text-foreground')}>
        {value}
      </span>
      {subline && <span className="text-xs text-muted-foreground">{subline}</span>}
    </div>
  )
}

// ── TierDot ───────────────────────────────────────────────────────────────────

interface TierDotProps {
  tier: 'high' | 'medium' | 'low'
  showLabel?: boolean
  className?: string
}

export function TierDot({ tier, showLabel = true, className }: TierDotProps) {
  const dotCls =
    tier === 'high'   ? 'bg-tier-high'   :
    tier === 'medium' ? 'bg-tier-medium' :
                        'bg-tier-low'
  const label =
    tier === 'high'   ? 'High'   :
    tier === 'medium' ? 'Medium' :
                        'Low'
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('w-2 h-2 rounded-full shrink-0', dotCls)} />
      {showLabel && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  )
}

// ── TrendIndicator ────────────────────────────────────────────────────────────
// Monochrome — weight encodes magnitude, never coloured.

interface TrendIndicatorProps {
  value: number
  direction?: 'up' | 'down' | 'neutral'
}

export function TrendIndicator({ value, direction }: TrendIndicatorProps) {
  const dir = direction ?? (value > 0 ? 'up' : value < 0 ? 'down' : 'neutral')
  const weight =
    Math.abs(value) > 20 ? 'font-semibold' :
    Math.abs(value) > 5  ? 'font-medium'   :
                            'font-normal'
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'
  return (
    <span className={cn('text-xs text-muted-foreground tabular-nums', weight)}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

// ── KPITile ───────────────────────────────────────────────────────────────────

interface KPITileProps {
  label: string
  value: string
  caption?: string
  trend?: { value: number; direction?: 'up' | 'down' | 'neutral' }
  valueClassName?: string
  className?: string
}

export function KPITile({ label, value, caption, trend, valueClassName, className }: KPITileProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-eyebrow">{label}</span>
      <span className={cn('text-data-num', valueClassName ?? 'text-foreground')}>{value}</span>
      {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
      {trend && <TrendIndicator value={trend.value} direction={trend.direction} />}
    </div>
  )
}

// ── DataTable ─────────────────────────────────────────────────────────────────
// No vertical borders. 1px row separators. Right-aligned tabular numbers.
// Subtle grey row hover.

export interface DataColumn<T> {
  key: string
  header: string
  render: (row: T, index: number) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

interface DataTableProps<T> {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  className?: string
  footer?: ReactNode
}

export function DataTable<T>({ columns, rows, rowKey, className, footer }: DataTableProps<T>) {
  return (
    <div className={cn('w-full', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'py-2 pb-2.5 text-eyebrow font-semibold',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-b border-border/40 hover:bg-muted/40 transition-colors"
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={cn(
                    'py-2.5 tabular-nums',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.className,
                  )}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <div className="mt-3 pt-3 border-t border-border/40">
          {footer}
        </div>
      )}
    </div>
  )
}
