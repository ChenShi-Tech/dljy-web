<script setup lang="ts">
// 市场快照卡（insight · Neon）：消费 bundle.blocks.snapshot 各序列 KPI 摘要 + 迷你 sparkline。
// 确定性渲染（不靠 LLM）：出清价取均价、负荷/新能源/竞价空间取峰值；source 标真伪。
import { computed } from 'vue'
import { arr, fmt, num, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const SPEC: Record<string, { label: string; primary: 'mean' | 'max'; primaryLabel: string; accent: string }> = {
  clearing_da: { label: '日前出清价', primary: 'mean', primaryLabel: '均价', accent: 'var(--primary)' },
  clearing_rt: { label: '实时出清价', primary: 'mean', primaryLabel: '均价', accent: 'var(--accent)' },
  load: { label: '统调负荷', primary: 'max', primaryLabel: '峰值', accent: 'var(--accent-2)' },
  renewable: { label: '新能源出力', primary: 'max', primaryLabel: '峰值', accent: 'var(--success)' },
  bidding_space: { label: '竞价空间', primary: 'max', primaryLabel: '峰值', accent: 'var(--warning)' }
}

const snapshot = computed(() => obj(props.data.snapshot ?? props.data))

type Tile = {
  key: string; label: string; unit: string; source: string; accent: string
  primary: { label: string; value: number }; spark: number[]
}

const tiles = computed<Tile[]>(() =>
  Object.entries(SPEC).flatMap(([key, spec]) => {
    const entry = obj(snapshot.value[key])
    const summary = obj(entry.summary)
    if (!Object.keys(summary).length) return []
    const spark = arr(entry.preview).map((p) => num(obj(p).value)).filter((v) => Number.isFinite(v))
    return [{
      key, label: spec.label, accent: spec.accent,
      unit: str(entry.unit, key.startsWith('clearing') ? '元/MWh' : 'MW'),
      source: str(entry.source ?? (key === 'bidding_space' ? 'derived' : '')),
      primary: { label: spec.primaryLabel, value: num(summary[spec.primary]) },
      spark
    }]
  })
)

function srcLabel(s: string): string {
  return s === 'replay' ? '真实' : s === 'derived' ? '派生' : s ? '模拟' : '缺失'
}
function srcCls(s: string): string {
  return s === 'replay' ? 'real' : s === 'derived' ? 'derived' : s ? 'mock' : 'missing'
}
function sparkPoints(vals: number[]): string {
  if (vals.length < 2) return ''
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
  return vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${27 - ((v - min) / span) * 24}`).join(' ')
}
</script>

<template>
  <section class="mic-snap">
    <header>
      <h3>{{ title || '市场快照' }}</h3>
      <span class="sub">关键统计 · 后端确定性摘要</span>
    </header>
    <div v-if="tiles.length" class="grid">
      <div v-for="t in tiles" :key="t.key" class="tile" :style="{ '--accent': t.accent }">
        <div class="tile-head">
          <span class="label">{{ t.label }}</span>
          <span class="src" :class="srcCls(t.source)">{{ srcLabel(t.source) }}</span>
        </div>
        <div class="primary">
          <strong>{{ fmt(t.primary.value, 0) }}</strong>
          <span class="unit">{{ t.unit }}</span>
        </div>
        <div class="primary-label">{{ t.primary.label }}</div>
        <svg v-if="t.spark.length > 1" class="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
          <polyline :points="sparkPoints(t.spark)" />
        </svg>
      </div>
    </div>
    <p v-else class="empty">暂无市场数据</p>
  </section>
</template>

<style scoped>
.mic-snap { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
h3 { margin: 0; font-size: 15.5px; color: var(--text, #111827); }
.sub { font-size: 11.5px; color: var(--muted, #667085); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr)); gap: 10px; }
.tile {
  position: relative; overflow: hidden; background: var(--panel-sub, #f8fafc);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 10px; padding: 11px 12px 12px 14px;
}
.tile::after { content: ''; position: absolute; left: 0; top: 0; width: 3px; height: 100%; background: var(--accent); opacity: .85; box-shadow: 0 0 12px var(--accent); }
.tile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.label { font-size: 12px; color: var(--muted, #667085); }
.src { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; flex: none; }
.src.real { color: var(--success, #16a34a); background: var(--primary-tint, rgba(74, 222, 128, .14)); }
.src.derived { color: var(--primary, #0891b2); background: var(--primary-tint, rgba(34, 211, 238, .16)); }
.src.mock { color: var(--warning, #b45309); background: var(--warning-tint, rgba(251, 191, 36, .18)); }
.src.missing { color: var(--muted, #6b7280); background: var(--surface-hover, rgba(156, 163, 175, .16)); }
.primary { display: flex; align-items: baseline; gap: 5px; }
.primary strong { font-size: 23px; color: var(--text, #111827); font-variant-numeric: tabular-nums; }
.unit { font-size: 11px; color: var(--muted, #98a2b3); }
.primary-label { font-size: 11px; color: var(--muted, #667085); margin-top: 1px; }
.spark { width: 100%; height: 20px; margin-top: 8px; display: block; }
.spark polyline { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 2px var(--accent)); }
.empty { margin: 0; color: var(--muted, #98a2b3); font-size: 13px; }
</style>
