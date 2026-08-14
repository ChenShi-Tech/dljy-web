<script setup lang="ts">
// 价格弹性卡（insight · Neon）：消费 bundle.blocks.elasticity，画竞价空间×电价散点 + 拟合预测线。
// 引擎为 run_elasticity；available=false（缺真实供需）显空态，严格地区不臆造。
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { arr, fmt, num, obj } from '../storage/helpers'
import { chartChrome, cssVar, useTheme } from '@/composables/useTheme'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const block = computed(() => obj(props.data.elasticity ?? props.data))
const available = computed(() => block.value.available === true)
// 引擎三序列元素为 {time_point, value|price} 对象（非裸数）：竞价空间取 value、电价取 price；兼容裸数兜底。
const bidSpace = computed(() => arr(block.value.bid_space).map((v) => { const o = obj(v); return num(o.value ?? v) }))
const actual = computed(() => arr(block.value.actual_price).map((v) => { const o = obj(v); return num(o.price ?? o.value ?? v) }))
const predicted = computed(() => arr(block.value.predicted_price).map((v) => { const o = obj(v); return num(o.price ?? o.value ?? v) }))
const steep = computed(() => num(block.value.steep_share_pct))
const isSteep = computed(() => steep.value >= 50)
const maeModel = computed(() => block.value.mae_model)
const maeNaive = computed(() => block.value.mae_naive)

const el = ref<HTMLElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
const { theme } = useTheme()

function render() {
  if (!el.value || !available.value) return
  if (!chart) chart = echarts.init(el.value)
  const cc = chartChrome()
  const scatterColor = cssVar('--primary') || '#22d3ee'
  const lineColor = cssVar('--accent') || '#e879f9'
  const axis = {
    nameTextStyle: { color: cc.axisLabel },
    axisLabel: { color: cc.axisLabel },
    axisLine: { lineStyle: { color: cc.neutralLine } },
    splitLine: { lineStyle: { color: cc.splitLine } }
  }
  const scatter = bidSpace.value.map((x, i) => [x, actual.value[i]]).filter((p) => Number.isFinite(p[1]))
  const line = bidSpace.value.map((x, i) => [x, predicted.value[i]]).filter((p) => Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0])
  chart.setOption({
    grid: { left: 50, right: 14, top: 14, bottom: 30 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    xAxis: { type: 'value', name: '竞价空间', scale: true, ...axis },
    yAxis: { type: 'value', name: '电价', scale: true, ...axis },
    series: [
      { type: 'scatter', data: scatter, symbolSize: 6, itemStyle: { color: scatterColor, opacity: 0.55 } },
      { type: 'line', data: line, smooth: false, showSymbol: false, lineStyle: { color: lineColor, width: 2.2, shadowColor: lineColor, shadowBlur: 8 } }
    ]
  })
}
function resize() { chart?.resize() }
onMounted(() => { nextTick(render); window.addEventListener('resize', resize) })
watch([available, bidSpace, predicted, theme], () => nextTick(render))
onBeforeUnmount(() => { window.removeEventListener('resize', resize); chart?.dispose() })
</script>

<template>
  <section class="mic-el">
    <header>
      <h3>{{ title || '价格弹性预判' }}</h3>
      <span v-if="available" class="badge" :class="isSteep ? 'steep' : 'flat'">{{ isSteep ? '陡弹性' : '平弹性' }}</span>
    </header>
    <template v-if="available">
      <div ref="el" class="chart"></div>
      <div class="stats">
        <span>陡段占比 <b>{{ fmt(steep, 0) }}%</b></span>
        <span v-if="maeModel != null">模型 MAE <b>{{ fmt(maeModel, 1) }}</b></span>
        <span v-if="maeNaive != null">naive <b>{{ fmt(maeNaive, 1) }}</b></span>
      </div>
      <p class="note">分析参考 · 非结算依据</p>
    </template>
    <div v-else class="empty"><p>无弹性数据</p><span>严格地区「真实或空」：缺真实供需数据时不臆造</span></div>
  </section>
</template>

<style scoped>
.mic-el { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
h3 { margin: 0; font-size: 15.5px; color: var(--text, #111827); }
.badge { font-size: 11px; padding: 1px 9px; border-radius: 999px; }
.badge.steep { color: var(--danger, #e11d48); background: var(--danger-tint, rgba(251, 113, 133, .16)); }
.badge.flat { color: var(--primary, #0891b2); background: var(--primary-tint, rgba(34, 211, 238, .16)); }
.chart { width: 100%; height: 196px; }
.stats { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12px; color: var(--muted, #667085); }
.stats b { color: var(--text, #111827); font-variant-numeric: tabular-nums; }
.note { margin: 6px 0 0; font-size: 11px; color: var(--muted, #98a2b3); }
.empty { padding: 24px 12px; text-align: center; color: var(--muted, #98a2b3); font-size: 13px; }
.empty p { margin: 0 0 4px; font-size: 14px; }
.empty span { font-size: 11.5px; }
</style>
