<script setup lang="ts">
// 节点电价热力卡（insight · Neon）：消费 bundle.blocks.node_price，画节点×时段价格热力。
// 数据来自 SpotPriceEngine（DuckDB 真实列式聚合）；available=false 显空态（严格地区不臆造）。
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { arr, num, obj, str } from '../storage/helpers'
import { chartChrome, cssVar, useTheme } from '@/composables/useTheme'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const block = computed(() => obj(props.data.node_price ?? props.data))
const available = computed(() => block.value.available === true)
const heatmap = computed(() => obj(block.value.heatmap))
const nodes = computed(() => arr(heatmap.value.nodes).map((n) => str(n)))
const matrix = computed(() => arr(heatmap.value.matrix ?? heatmap.value.grid ?? heatmap.value.rows))

const el = ref<HTMLElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
const { theme } = useTheme()

function render() {
  if (!el.value || !available.value || !matrix.value.length) return
  if (!chart) chart = echarts.init(el.value)
  const cc = chartChrome()
  // 价格色阶低→高：主题主色(冷·低价) → 警示(中) → 危险(高价)，四主题各取自己的色。
  const ramp = [cssVar('--primary') || '#22d3ee', cssVar('--warning') || '#fbbf24', cssVar('--danger') || '#fb7185']
  const data: [number, number, number][] = []
  let vmin = Infinity, vmax = -Infinity
  matrix.value.forEach((row, r) =>
    arr(row).forEach((v, c) => {
      const val = num(v)
      data.push([c, r, val]); vmin = Math.min(vmin, val); vmax = Math.max(vmax, val)
    })
  )
  const cols = arr(matrix.value[0]).length
  chart.setOption({
    grid: { left: 96, right: 14, top: 8, bottom: 26 },
    tooltip: { position: 'top' },
    xAxis: { type: 'category', data: Array.from({ length: cols }, (_, i) => i), axisLabel: { color: cc.axisLabel, interval: 11 }, splitArea: { show: false } },
    yAxis: { type: 'category', data: nodes.value, axisLabel: { color: cc.axisLabel, fontSize: 10 } },
    visualMap: { min: Math.min(0, vmin), max: vmax, show: false, inRange: { color: ramp } },
    series: [{ type: 'heatmap', data, progressive: 0, itemStyle: { borderWidth: 0 } }]
  })
}
function resize() { chart?.resize() }
onMounted(() => { nextTick(render); window.addEventListener('resize', resize) })
watch([available, matrix, theme], () => nextTick(render))
onBeforeUnmount(() => { window.removeEventListener('resize', resize); chart?.dispose() })
</script>

<template>
  <section class="mic-node">
    <header>
      <h3>{{ title || '节点电价热力' }}</h3>
      <span v-if="available" class="badge">{{ nodes.length }} 节点</span>
    </header>
    <template v-if="available && matrix.length">
      <div ref="el" class="chart"></div>
      <p class="note">真实列式聚合（DuckDB）· 蓝→青→黄→红 价高</p>
    </template>
    <div v-else class="empty"><p>无节点电价数据</p><span>严格地区「真实或空」：节点电价 Parquet 未摄取时空态</span></div>
  </section>
</template>

<style scoped>
.mic-node { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
h3 { margin: 0; font-size: 15.5px; color: var(--text, #111827); }
.badge { font-size: 11px; padding: 1px 9px; border-radius: 999px; color: var(--primary, #0891b2); background: var(--primary-tint, rgba(34, 211, 238, .16)); }
.chart { width: 100%; height: 260px; }
.note { margin: 6px 0 0; font-size: 11px; color: var(--muted, #98a2b3); }
.empty { padding: 24px 12px; text-align: center; color: var(--muted, #98a2b3); font-size: 13px; }
.empty p { margin: 0 0 4px; font-size: 14px; }
.empty span { font-size: 11.5px; }
</style>
