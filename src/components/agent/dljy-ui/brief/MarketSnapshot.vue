<script setup lang="ts">
// 市场快照（brief）：渲染 MorningBriefBundle.market 各序列的关键统计（确定性，不靠 LLM）。
// 出清价/负荷/新能源摘要直接来自后端 summarize_series，按口径取均价/峰值/谷值。
// 既可由 MorningBriefView 用 bundle.market 直接渲染，也可由 LLM 经 ```dljy-ui 围栏产出。
import { computed } from 'vue'
import { fmt, num, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Tile = {
  key: string
  label: string
  unit: string
  source: string
  primary: { label: string; value: number }
  subs: { label: string; value: number }[]
  spark: string // 内联 series 的迷你曲线 SVG path（''=无足够点）
}

// 内联序列 → 迷你曲线 path（viewBox 100×24）。bundle v2 起 market 各条目自带全量 series，
// 前端自包含、无需再凭 data_ref 跨会话取明细。少于 2 个有效点则返回空（不画线）。
function sparkPath(values: number[]): string {
  const ys = values.filter((v) => Number.isFinite(v))
  if (ys.length < 2) return ''
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const span = hi - lo || 1
  const step = 100 / (ys.length - 1)
  return ys
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)} ${(22 - ((v - lo) / span) * 20).toFixed(2)}`)
    .join(' ')
}

// 已知序列 → 中文标签 + 主指标取法（价取均值、负荷/新能源取峰值）。
const SPEC: Record<string, { label: string; primary: string; primaryLabel: string }> = {
  clearing_da: { label: '日前出清价', primary: 'mean', primaryLabel: '均价' },
  clearing_rt: { label: '实时出清价', primary: 'mean', primaryLabel: '均价' },
  load: { label: '统调负荷', primary: 'max', primaryLabel: '峰值' },
  renewable: { label: '新能源出力', primary: 'max', primaryLabel: '峰值' }
}

const market = computed(() => obj(props.data.market ?? props.data))

const tiles = computed<Tile[]>(() =>
  Object.entries(market.value).flatMap(([key, raw]) => {
    const entry = obj(raw)
    const summary = obj(entry.summary)
    if (!Object.keys(summary).length) return []
    const spec = SPEC[key] ?? { label: key, primary: 'mean', primaryLabel: '均值' }
    const unit = str(entry.unit, key.startsWith('clearing') ? '元/MWh' : 'MW')
    const series = Array.isArray(entry.series) ? (entry.series as Record<string, unknown>[]) : []
    return [
      {
        key,
        label: spec.label,
        unit,
        source: str(entry.source),
        primary: { label: spec.primaryLabel, value: num(summary[spec.primary]) },
        subs: [
          { label: '峰', value: num(summary.max) },
          { label: '谷', value: num(summary.min) }
        ],
        spark: sparkPath(series.map((p) => num(p.value, NaN)))
      }
    ]
  })
)

function srcLabel(s: string): string {
  return s === 'replay' ? '真实' : s ? '模拟' : '缺失'
}
function srcCls(s: string): string {
  return s === 'replay' ? 'ms-real' : s ? 'ms-mock' : 'ms-missing'
}
</script>

<template>
  <section class="ms-card">
    <header>
      <h3>{{ title || '市场快照' }}</h3>
      <span class="ms-sub">关键统计 · 后端确定性摘要</span>
    </header>
    <div v-if="tiles.length" class="ms-grid">
      <div v-for="t in tiles" :key="t.key" class="ms-tile">
        <div class="ms-tile-head">
          <span class="ms-label">{{ t.label }}</span>
          <span class="ms-src" :class="srcCls(t.source)">{{ srcLabel(t.source) }}</span>
        </div>
        <div class="ms-primary">
          <strong>{{ fmt(t.primary.value, 0) }}</strong>
          <span class="ms-unit">{{ t.unit }}</span>
        </div>
        <div class="ms-primary-label">{{ t.primary.label }}</div>
        <div class="ms-subs">
          <span v-for="s in t.subs" :key="s.label">{{ s.label }} {{ fmt(s.value, 0) }}</span>
        </div>
        <svg v-if="t.spark" class="ms-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          <path :d="t.spark" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
    <p v-else class="ms-empty">暂无市场数据</p>
  </section>
</template>

<style scoped>
.ms-card { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
.ms-sub { font-size: var(--font-sm); color: var(--muted, #667085); }
.ms-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.ms-tile { background: var(--panel-sub, #f8fafc); border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; padding: 11px 12px; }
.ms-tile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.ms-label { font-size: var(--font-12-5); color: var(--muted, #667085); }
.ms-src { font-size: var(--font-xs); padding: 1px 7px; border-radius: 999px; flex: none; }
.ms-src.ms-real { color: #15803d; background: rgba(22, 163, 74, 0.12); }
.ms-src.ms-mock { color: #b45309; background: rgba(245, 158, 11, 0.14); }
.ms-src.ms-missing { color: #6b7280; background: rgba(107, 114, 128, 0.12); }
.ms-primary { display: flex; align-items: baseline; gap: 5px; }
.ms-primary strong { font-size: var(--font-22); color: var(--text, #111827); }
.ms-unit { font-size: var(--font-11-5); color: var(--muted, #98a2b3); }
.ms-primary-label { font-size: var(--font-11-5); color: var(--muted, #667085); margin-top: 1px; }
.ms-subs { display: flex; gap: 12px; margin-top: 8px; font-size: var(--font-sm); color: var(--text-body, #344054); }
.ms-spark { display: block; width: 100%; height: 24px; margin-top: 8px; color: var(--primary, #0f766e); opacity: 0.85; }
.ms-empty { margin: 0; color: var(--muted, #98a2b3); font-size: var(--font-md); }
@media (max-width: 700px) { .ms-primary strong { font-size: var(--font-19); } }
</style>
