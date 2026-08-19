<script setup lang="ts">
// 价差套利卡（insight · Neon）：消费 bundle.blocks.spread，画日前-实时价差柱 + 套利信号/收益。
// 引擎为 run_spread；available=false 显空态。回放收益非真实成交（决策支持参考）。
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { arr, fmt, num, obj } from '../storage/helpers'
import { chartChrome, cssVar, useTheme } from '@/composables/useTheme'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const block = computed(() => obj(props.data.spread ?? props.data))
const available = computed(() => block.value.available === true)
const forecast = computed(() =>
  arr(block.value.spread_forecast).map((x) => {
    const o = obj(x)
    const s = num(o.spread, NaN)
    return Number.isFinite(s) ? s : num(o.value ?? x)
  })
)
const hitRaw = computed(() => num(block.value.sign_hit_rate))
const hitPct = computed(() => (hitRaw.value <= 1 ? hitRaw.value * 100 : hitRaw.value))
const arbitrage = computed(() => obj(block.value.arbitrage))
const revenue = computed(() => num(arbitrage.value.revenue_yuan))
const signalGo = computed(() => revenue.value > 0)

const el = ref<HTMLElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
const { theme } = useTheme()

function render() {
  if (!el.value || !available.value) return
  if (!chart) chart = echarts.init(el.value)
  const cc = chartChrome()
  const posColor = cssVar('--primary') || '#22d3ee'
  const negColor = cssVar('--danger') || '#fb7185'
  const data = forecast.value
  chart.setOption({
    grid: { left: 46, right: 12, top: 14, bottom: 24 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', show: false, data: data.map((_, i) => i) },
    yAxis: { type: 'value', name: '价差', nameTextStyle: { color: cc.axisLabel }, axisLabel: { color: cc.axisLabel }, axisLine: { lineStyle: { color: cc.neutralLine } }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: [{
      type: 'bar',
      data: data.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? posColor : negColor, opacity: 0.78 } }))
    }]
  })
}
function resize() { chart?.resize() }
onMounted(() => { nextTick(render); window.addEventListener('resize', resize) })
watch([available, forecast, theme], () => nextTick(render))
onBeforeUnmount(() => { window.removeEventListener('resize', resize); chart?.dispose() })
</script>

<template>
  <section class="mic-spread">
    <header>
      <h3>{{ title || '日前-实时价差' }}</h3>
      <span v-if="available" class="signal" :class="signalGo ? 'go' : 'hold'">{{ signalGo ? '套利信号' : '观望' }}</span>
    </header>
    <template v-if="available">
      <div ref="el" class="chart"></div>
      <div class="stats">
        <span>符号命中 <b>{{ fmt(hitPct, 0) }}%</b></span>
        <span>回放收益 <b :class="revenue >= 0 ? 'up' : 'down'">{{ fmt(revenue, 0) }}</b> 元</span>
      </div>
      <p class="note">决策支持参考 · 回放非真实成交</p>
    </template>
    <div v-else class="empty"><p>无价差数据</p><span>严格地区「真实或空」：缺真实 DA/RT 时空态</span></div>
  </section>
</template>

<style scoped>
.mic-spread { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
h3 { margin: 0; font-size: var(--font-15-5); color: var(--text, #111827); }
.signal { font-size: var(--font-xs); padding: 1px 9px; border-radius: 999px; }
.signal.go { color: var(--success, #16a34a); background: var(--primary-tint, rgba(74, 222, 128, .16)); }
.signal.hold { color: var(--muted, #6b7280); background: var(--surface-hover, rgba(156, 163, 175, .16)); }
.chart { width: 100%; height: 180px; }
.stats { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; font-size: var(--font-sm); color: var(--muted, #667085); }
.stats b { color: var(--text, #111827); font-variant-numeric: tabular-nums; }
.stats b.up { color: var(--success, #16a34a); }
.stats b.down { color: var(--danger, #e11d48); }
.note { margin: 6px 0 0; font-size: var(--font-xs); color: var(--muted, #98a2b3); }
.empty { padding: 24px 12px; text-align: center; color: var(--muted, #98a2b3); font-size: var(--font-md); }
.empty p { margin: 0 0 4px; font-size: var(--font-lg); }
.empty span { font-size: var(--font-11-5); }
</style>
