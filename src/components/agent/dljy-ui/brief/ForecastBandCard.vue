<script setup lang="ts">
// 次日价格预测带卡（brief）：渲染 p10/p50/p90 预测区间（MorningBriefBundle.forecast_band）。
// 预测值恒标 forecast、非结算依据。单值摘要卡，整条 96 点曲线用既有 ```forecast 围栏画图。
import { computed } from 'vue'
import { fmt, num, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const band = computed(() => obj(props.data.band ?? props.data))
const unit = computed(() => str(props.data.unit, '元/MWh'))
// 原始三项保留可空：缺失时不被 num 兜底成 0（fmt 对 undefined 渲染 '—'），
// 避免「无预测序列」被误显示成 0 元/MWh 的真实低价区间（与 DataQualityPanel 的 missing 标注矛盾）。
const p10 = computed(() => band.value.p10)
const p50 = computed(() => band.value.p50)
const p90 = computed(() => band.value.p90)
// 有有效预测带：三项中至少一项经 num 归一为有限值；全缺时渲染缺失态、不展示指标。
// 用 num(v, NaN) 与 fmt 同一套数值判定，数值字符串（如 "280"，dljy-ui 围栏接收 LLM JSON 时常见）
// 也算有效，避免被 typeof === 'number' 误判成缺失态。
const hasBand = computed(() =>
  [p10.value, p50.value, p90.value].some((v) => Number.isFinite(num(v, NaN)))
)
const spread = computed(() => Math.max(0, num(p90.value) - num(p10.value)))
// p50 在 [p10, p90] 区间内的相对位置（用于指示条）。
const pos = computed(() => {
  const w = num(p90.value) - num(p10.value)
  if (w <= 0) return 50
  return Math.min(100, Math.max(0, ((num(p50.value) - num(p10.value)) / w) * 100))
})
const note = computed(() => str(props.data.note, '预测值，非结算依据'))
</script>

<template>
  <section class="fb-card">
    <header>
      <h3>{{ title || '次日价格预测带' }}</h3>
      <span class="fb-tag">预测 · {{ note }}</span>
    </header>
    <div class="fb-metrics">
      <template v-if="hasBand">
        <div><span>下界 P10</span><strong>{{ fmt(p10, 0) }}</strong></div>
        <div class="fb-mid"><span>中位 P50</span><strong>{{ fmt(p50, 0) }}</strong></div>
        <div><span>上界 P90</span><strong>{{ fmt(p90, 0) }}</strong></div>
      </template>
      <p v-else class="fb-empty">暂无有效预测带，等待后端预检补齐预测序列。</p>
    </div>
    <div v-if="hasBand" class="fb-bar">
      <div class="fb-track"><span class="fb-marker" :style="{ left: pos + '%' }"></span></div>
      <div class="fb-bar-foot"><span>{{ fmt(p10, 0) }}</span><span>区间宽 {{ fmt(spread, 0) }} {{ unit }}</span><span>{{ fmt(p90, 0) }}</span></div>
    </div>
  </section>
</template>

<style scoped>
.fb-card { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
h3 { margin: 0; font-size: 16px; color: var(--text, #111827); }
.fb-tag { font-size: 12px; color: #1d4ed8; background: rgba(37, 99, 235, 0.12); padding: 2px 9px; border-radius: 999px; }
.fb-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.fb-metrics > div { background: var(--panel-sub, #f8fafc); border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; padding: 10px; text-align: center; }
.fb-metrics span { display: block; font-size: 12px; color: var(--muted, #667085); }
.fb-metrics strong { display: block; margin-top: 4px; font-size: 20px; color: var(--text, #111827); }
.fb-mid strong { color: var(--primary, #0f766e); }
.fb-empty { grid-column: 1 / -1; margin: 0; padding: 18px 0; text-align: center; color: var(--muted, #98a2b3); font-size: 13px; }
.fb-track { position: relative; height: 8px; border-radius: 999px; background: linear-gradient(90deg, rgba(37,99,235,0.18), rgba(37,99,235,0.4), rgba(37,99,235,0.18)); }
.fb-marker { position: absolute; top: -3px; width: 3px; height: 14px; border-radius: 2px; background: var(--primary, #0f766e); transform: translateX(-50%); }
.fb-bar-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: var(--muted, #98a2b3); }
@media (max-width: 700px) { .fb-metrics strong { font-size: 17px; } }
</style>
