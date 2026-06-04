/**
 * /design — Living design-system reference route.
 * Not in navigation. Dev-only eyeball check.
 *
 * Shows: colour tokens, type scale, every primitive with sample data.
 */
import { MetricCard, HeroNumber, TierDot, KPITile, TrendIndicator, CategoryTag, DataTable, type DataColumn } from '@/components/ui/metric-card'
import { VerticalBarChart, DonutChart, RISK_COLOR, NEUTRAL_COLOR, MUTED_COLOR } from '@/components/ui/charts'
import type { QueryCategory } from '@/types/query'

// ── Sample data ───────────────────────────────────────────────────────────────

const barSample = [
  { label: 'News',   value: 1240 },
  { label: 'Info',   value: 890  },
  { label: 'Brand',  value: 430  },
  { label: 'Prod',   value: 280  },
  { label: 'Comm',   value: 95   },
  { label: 'Trans',  value: 40   },
]

const donutSample = [
  { value: 32, color: RISK_COLOR,    label: 'AI Overview' },
  { value: 18, color: NEUTRAL_COLOR, label: 'SERP features' },
  { value: 50, color: MUTED_COLOR,   label: 'Clean' },
]

interface SampleRow { rank: number; query: string; tier: 'high' | 'medium' | 'low'; lost: number }
const tableSample: SampleRow[] = [
  { rank: 1, query: 'what is inflation',     tier: 'high',   lost: 940 },
  { rank: 2, query: 'ukraine war latest',    tier: 'high',   lost: 735 },
  { rank: 3, query: 'trump tariffs news',    tier: 'medium', lost: 94  },
  { rank: 4, query: 'best mortgage rates',   tier: 'low',    lost: 0   },
]

const tableColumns: DataColumn<SampleRow>[] = [
  { key: 'rank',  header: '#',               render: r => <span className="text-muted-foreground">{r.rank}</span> },
  { key: 'query', header: 'Query',           render: r => <span className="font-medium truncate max-w-[200px] block">{r.query}</span> },
  { key: 'tier',  header: 'Tier',            render: r => <TierDot tier={r.tier} /> },
  { key: 'lost',  header: 'Est. Lost',       render: r => <span className={r.lost > 0 ? 'text-risk font-semibold' : 'text-muted-foreground'}>~{r.lost.toLocaleString()}</span>, align: 'right' },
]

// ── Colour swatch ─────────────────────────────────────────────────────────────

function Swatch({ token, hex, className }: { token: string; hex: string; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded border border-border shrink-0 ${className}`} />
      <div>
        <p className="text-xs font-mono text-foreground">{token}</p>
        <p className="text-[10px] text-muted-foreground">{hex}</p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesignSystem() {
  return (
    <div className="min-h-screen bg-background p-8 space-y-12">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Design System</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Phase 6.2 · Living reference · <span className="font-mono">/design</span>
        </p>
      </div>

      {/* ── Colour tokens ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Colour tokens</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Swatch token="--background / --card"    hex="#FFFFFF"  className="bg-card" />
          <Swatch token="--foreground / --primary" hex="#0A0A0A"  className="bg-foreground" />
          <Swatch token="--muted"                  hex="#F5F5F5"  className="bg-muted" />
          <Swatch token="--muted-foreground"        hex="#737373"  className="bg-muted-foreground" />
          <Swatch token="--border"                  hex="#E5E5E5"  className="bg-border" />
          <Swatch token="--risk / --tier-high"      hex="#DC2626"  className="bg-risk" />
          <Swatch token="--risk-deep"               hex="#7F1D1D"  className="bg-risk-deep" />
          <Swatch token="--risk-subtle"             hex="#FEE2E2"  className="bg-risk-subtle" />
          <Swatch token="--tier-medium"             hex="#737373"  className="bg-tier-medium" />
          <Swatch token="--tier-low"                hex="#D1D5DB"  className="bg-tier-low" />
          <Swatch token="--chart-risk"              hex="#DC2626"  className="bg-chart-risk" />
          <Swatch token="--chart-neutral"           hex="#333333"  className="bg-chart-neutral" />
          <Swatch token="--chart-muted"             hex="#D1D5DB"  className="bg-chart-muted" />
          <Swatch token="--trend-up"                hex="#16A34A"  className="bg-trend-up" />
          <Swatch token="--trend-down"              hex="#DC2626"  className="bg-trend-down" />
          <Swatch token="--cat-news"                hex="#3730A3"  className="bg-cat-news" />
          <Swatch token="--cat-info"                hex="#0E7490"  className="bg-cat-info" />
          <Swatch token="--cat-product"             hex="#7C3AED"  className="bg-cat-product" />
          <Swatch token="--cat-branded"             hex="#D97706"  className="bg-cat-branded" />
          <Swatch token="--cat-comm"                hex="#0891B2"  className="bg-cat-comm" />
          <Swatch token="--cat-trans"               hex="#475569"  className="bg-cat-trans" />
          <Swatch token="--cat-other"               hex="#6B7280"  className="bg-cat-other" />
        </div>
      </section>

      {/* ── Type scale ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Type scale</h2>
        <div className="space-y-3">
          <div><span className="text-display text-foreground">8.4%</span><span className="text-xs text-muted-foreground ml-3">.text-display — 56px / 700 / tabular-nums</span></div>
          <div><span className="text-2xl font-bold">Section heading</span><span className="text-xs text-muted-foreground ml-3">text-2xl font-bold — h1 24px / 700</span></div>
          <div><span className="text-lg font-semibold">Card heading</span><span className="text-xs text-muted-foreground ml-3">text-lg font-semibold — h2 18px / 600</span></div>
          <div><span className="text-eyebrow">Eyebrow label</span><span className="text-xs text-muted-foreground ml-3">.text-eyebrow — 11px / 600 / uppercase / 0.06em</span></div>
          <div><span className="text-sm">Body text at 14px weight 400</span><span className="text-xs text-muted-foreground ml-3">text-sm</span></div>
          <div><span className="text-sm font-medium">Body strong 14px weight 500</span><span className="text-xs text-muted-foreground ml-3">text-sm font-medium</span></div>
          <div><span className="text-data-num">1,867</span><span className="text-xs text-muted-foreground ml-3">.text-data-num — 18px / 600 / tabular-nums</span></div>
          <div><span className="text-xs text-muted-foreground">Caption at 12px</span><span className="text-xs text-muted-foreground ml-3">text-xs text-muted-foreground</span></div>
        </div>
      </section>

      {/* ── Primitives ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Primitives</h2>

        {/* TierDot */}
        <MetricCard title="TierDot">
          <div className="flex gap-6">
            <TierDot tier="high" />
            <TierDot tier="medium" />
            <TierDot tier="low" />
            <TierDot tier="high" showLabel={false} />
            <TierDot tier="medium" showLabel={false} />
            <TierDot tier="low" showLabel={false} />
          </div>
        </MetricCard>

        {/* TrendIndicator */}
        <MetricCard title="TrendIndicator — colour encodes direction">
          <div className="flex gap-6 flex-wrap">
            <TrendIndicator value={28.5} direction="up" />
            <TrendIndicator value={8.2}  direction="up" />
            <TrendIndicator value={1.1}  direction="up" />
            <TrendIndicator value={15.4} direction="down" />
            <TrendIndicator value={3.2}  direction="down" />
            <TrendIndicator value={0}    direction="neutral" />
          </div>
        </MetricCard>

        {/* CategoryTag */}
        <MetricCard title="CategoryTag — all 7 variants">
          <div className="flex flex-wrap gap-2">
            {(['news', 'informational', 'product', 'branded', 'commercial', 'transactional', 'other'] as QueryCategory[]).map(cat => (
              <CategoryTag key={cat} category={cat} />
            ))}
          </div>
        </MetricCard>

        {/* HeroNumber */}
        <MetricCard title="HeroNumber">
          <div className="flex gap-12 items-end flex-wrap">
            <HeroNumber value="≈8.4%" label="Estimated Click Loss" subline="of current clicks lost to SERP features" />
            <HeroNumber value="≈8.4%" label="Risk (red)" subline="AI-driven loss" valueClassName="text-risk" />
          </div>
        </MetricCard>

        {/* KPITile */}
        <MetricCard title="KPITile row">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <KPITile label="Enriched Queries" value="1,867" caption="of 1,868 total · 99% of clicks" />
            <KPITile label="AI Overview" value="6.3%" caption="75% CTR drop" valueClassName="text-risk" />
            <KPITile label="Rich SERP" value="2.1%" caption="video / local / FS at 15%" />
            <KPITile label="Est. Lost Clicks" value="~1,240" caption="across enriched queries" />
          </div>
        </MetricCard>

        {/* MetricCard variants */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard title="Standard card">
            <p className="text-sm text-muted-foreground">White card · 1px border · 24px padding · 8px radius · eyebrow title</p>
          </MetricCard>
          <MetricCard title="Risk accent card" riskAccent>
            <p className="text-sm text-muted-foreground">Thin red top border — for AI-risk callouts only.</p>
          </MetricCard>
        </div>
      </section>

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Charts</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MetricCard title="VerticalBarChart — est. lost clicks by category">
            <VerticalBarChart data={barSample} valueFormatter={v => v.toLocaleString()} />
          </MetricCard>

          <MetricCard title="DonutChart — SERP composition">
            <div className="flex items-center gap-8">
              <DonutChart
                segments={donutSample}
                centerLabel="≈8.4%"
                centerSubline="est. loss"
              />
              <div className="space-y-2">
                {donutSample.map(s => (
                  <div key={s.label} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-semibold tabular-nums ml-auto">{s.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </MetricCard>
        </div>
      </section>

      {/* ── DataTable ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">DataTable</h2>
        <MetricCard title="Top queries by estimated click loss">
          <DataTable
            columns={tableColumns}
            rows={tableSample}
            rowKey={(r) => String(r.rank)}
            footer={
              <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all in Queries tab →
              </button>
            }
          />
        </MetricCard>
      </section>

      {/* ── Two-segment bar sample ───────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Two-segment bar (news SERP state)</h2>
        <MetricCard title="Your news coverage right now">
          <div className="space-y-3">
            <div className="h-3 w-full rounded-full overflow-hidden flex">
              <div className="h-full bg-chart-neutral rounded-l-full" style={{ width: '73%' }} title="Protected — Top Stories present" />
              <div className="h-full bg-risk flex-1 rounded-r-full" title="Exposed — no Top Stories" />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex gap-2 items-start">
                <span className="w-2.5 h-2.5 rounded-full bg-chart-neutral mt-1 shrink-0" />
                <div>
                  <p className="font-medium">73% of news traffic</p>
                  <p className="text-xs text-muted-foreground">on SERPs with Top Stories — largely protected</p>
                </div>
              </div>
              <div className="flex gap-2 items-start">
                <span className="w-2.5 h-2.5 rounded-full bg-risk mt-1 shrink-0" />
                <div>
                  <p className="font-medium">27% of news traffic</p>
                  <p className="text-xs text-muted-foreground">on SERPs without Top Stories — more exposed</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60">
              SERP state captured at enrichment time — may shift as news cycles change.
            </p>
          </div>
        </MetricCard>
      </section>
    </div>
  )
}
