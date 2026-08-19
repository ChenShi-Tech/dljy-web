<script setup lang="ts">
// 通用图表卡片：标题 + 操作区插槽 + 自适应挂载点 + 可选(全屏 / 框选区域统计 / 数据时间·新鲜度指示)。
// 生命周期(init/容器 resize/主题重建/dispose)全交给 useEChart 托管。
//
// 设计要点：父组件传 buildOption() 「函数」而非静态 option ——
//   1) 主题切换时 useEChart 重建实例并回调 paint()，buildOption() 重新读取
//      chartChrome() 取最新主题色，暗色/亮色都精致；
//   2) onMounted 内 watchEffect 自动追踪 buildOption() 内访问的响应式数据
//      (rows.value 等)，数据变化即重绘，无需父组件手动 refresh。
//   3) group 相同的多张卡片自动 echarts.connect 联动(tooltip/dataZoom 同步十字线)。
//
// 新鲜度：updatedAt 语义为「数据时间」（真实数据的采集/写入时刻，来自 /api/real 信封
// provenance.capturedAt，见 data/freshness.ts），**不是取数时刻**。未传 freshness 时由
// updatedAt 按 cadence 推导：fresh 绿点脉冲 / aging 黄点 / stale 红点 + tooltip「数据已过期 N 天」。
// 拿不到真实数据时间的（agent 计算类）应不传 updatedAt（宁缺勿假），不显示时间。
import { onMounted, onBeforeUnmount, ref, watch, watchEffect, computed } from 'vue'
import type { EChartsOption } from 'echarts'
import { useEChart } from '../../composables/useEChart'
import { cssVar } from '../../composables/useTheme'
import { emptyOverlay, fmtNum } from '@/services/chart/chartOptions'
import { freshnessOf, ageDaysOf, type Freshness, type FreshnessCadence } from '@/services/data/freshness'

const props = withDefaults(defineProps<{
  title?: string
  height?: string | number
  buildOption: () => Record<string, unknown>
  loading?: boolean
  group?: string
  /** 显示全屏按钮 */
  fullscreen?: boolean
  /** 显示 PNG 导出按钮（增量 action，默认关，不破坏既有用法） */
  pngExport?: boolean
  /** 导出文件名（不传则用 title，再降级 'chart'） */
  pngName?: string
  /** group 联动图场景下导出整组连通图（getConnectedDataURL）；默认只导本卡（getDataURL） */
  pngConnected?: boolean
  /** 启用框选区域统计(拖选 X 区间，弹出 求和/均值/峰谷) */
  brushStats?: boolean
  /** 数据时间(真实数据的采集/写入时刻，显示「数据 …」+ 新鲜度点；非取数时刻) */
  updatedAt?: string | number | null
  /** 数据新鲜度分级(未传则由 updatedAt 按 cadence 推导) */
  freshness?: Freshness
  /** 新鲜度推导节律(默认 daily) */
  cadence?: FreshnessCadence
  /** @deprecated 用 freshness；true 等价强制 stale(红点告警) */
  stale?: boolean
  /** 数据为空：true 时不渲染图表，叠加居中空态占位（避免空坐标轴） */
  empty?: boolean
  /** 空态文案（配合 empty，默认「暂无数据」） */
  emptyText?: string
}>(), {
  height: 320,
  emptyText: '暂无数据'
})

const cardRef = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
const chart = useEChart(host, { render: paint, group: props.group })
const isFull = ref(false)
let brushBound = false

type BrushStat = { count: number; sum: number; avg: number; max: number; min: number } | null
const brushResult = ref<BrushStat>(null)

// 检测 ECharts option 是否所有 series 数据为空（无 data 或 data.length===0）。
// 用于「未显式声明 empty 但数据实际为空」的自动兜底——叠加「暂无数据」文字，避免露出空坐标轴。
// 无 series（如 graphic-only 自定义图）不算空，交回调用方判断。
function isAllSeriesEmpty(opt: Record<string, unknown>): boolean {
  const series = opt.series
  if (!Array.isArray(series) || series.length === 0) return false
  // 只有当所有 series 都显式提供 data 字段且为空数组时才判空；
  // 无 data 字段的 series（测试/非标准用法）不触发自动兜底，避免误伤。
  return series.every((s) => {
    const data = (s as { data?: unknown })?.data
    return Array.isArray(data) && data.length === 0
  })
}

function paint() {
  // 显式空态：清空图表实例内容，空态层由模板 v-if 叠加显示（不渲染坐标轴/系列）。
  if (props.empty) {
    chart.setOption({ series: [], xAxis: [], yAxis: [] } as EChartsOption, { notMerge: true })
    return
  }
  const opt = props.buildOption()
  if (props.brushStats) {
    // 注入 brush 组件 + toolbox 框选工具(notMerge 会清空，故每次重绘补回)
    if (!opt.brush) {
      opt.brush = { toolbox: ['rect', 'clear'], xAxisIndex: 0, throttleType: 'debounce', throttleDelay: 200, brushStyle: { borderWidth: 1, color: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.5)' } }
    }
    const tb = (opt.toolbox ?? {}) as { feature?: Record<string, unknown> }
    tb.feature = { ...(tb.feature ?? {}), brush: { type: ['rect', 'clear'], title: { rect: '框选统计', clear: '清除' } } }
    opt.toolbox = tb
  }
  // 自动空态兜底：未显式传 empty、也未自行加 graphic 空态、且 series 全空 → 叠加 emptyOverlay
  // （「暂无数据」文字盖在空坐标轴上），让未改造页面在空数据下不再露丑空轴。
  if (!opt.graphic && isAllSeriesEmpty(opt)) {
    Object.assign(opt, emptyOverlay(true))
  }
  chart.setOption(opt as EChartsOption, { notMerge: true })
  bindBrush()
}

// 框选统计：从当前 option 的首个直角系列取选中点，算 求和/均值/峰谷
function bindBrush() {
  if (!props.brushStats || brushBound) return
  const inst = chart.instance()
  if (!inst) return
  brushBound = true
  inst.on('brushSelected', (...args: unknown[]) => {
    const params = args[0] as { batch?: { selected?: { dataIndex?: number[] }[] }[] }
    const sel = params.batch?.[0]?.selected ?? []
    const idx = sel.flatMap((s) => s.dataIndex ?? [])
    if (!idx.length) { brushResult.value = null; return }
    const opt = inst.getOption() as { series?: { type?: string; data?: unknown[] }[] }
    const series = (opt.series ?? []).find((s) => s.type === 'line' || s.type === 'bar')
    const data = series?.data ?? []
    const vals = idx
      .map((i) => { const d = data[i]; const v = Array.isArray(d) ? d[d.length - 1] : (d as { value?: unknown })?.value ?? d; return Number(v) })
      .filter((n) => Number.isFinite(n))
    if (!vals.length) { brushResult.value = null; return }
    const sum = vals.reduce((a, b) => a + b, 0)
    brushResult.value = { count: vals.length, sum, avg: sum / vals.length, max: Math.max(...vals), min: Math.min(...vals) }
  })
}

onMounted(() => {
  watchEffect(paint)
  document.addEventListener('fullscreenchange', onFsChange)
})

// fullscreenchange 挂在 document（不在 useEChart 托管的 window resize/observer/echarts 实例范围内），
// useEChart 的 onBeforeUnmount 清理不覆盖它——须在此对称卸载。否则每次挂载-卸载（SPA 路由切换）都
// 在 document 上累加一个监听，闭包钉住已卸载组件的 chart handle/cardRef 致内存泄漏（pre-existing）。
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
})

watch(() => props.loading, (v) => (v ? chart.showLoading() : chart.hideLoading()))

async function toggleFullscreen() {
  const el = cardRef.value
  if (!el) return
  if (!document.fullscreenElement) await el.requestFullscreen?.()
  else await document.exitFullscreen?.()
}
function onFsChange() {
  isFull.value = document.fullscreenElement === cardRef.value
  // 全屏切换后容器尺寸变化，补一次 resize
  setTimeout(() => chart.resize(), 60)
}

// 文件名清洗：去文件系统非法字符 + 首尾空白；保留中日韩文（合法文件名字符）。
function sanitizeFileName(raw: string): string {
  const s = (raw || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').trim()
  return s || 'chart'
}

// 一键导出 PNG：用 ECharts getDataURL（默认本卡）/ getConnectedDataURL（pngConnected+group 联动整组）。
// 背景取当前主题 --panel，与屏幕所见一致（暗色主题下图表文字是亮色，深底导出不糊）。
// 2x 像素比保证清晰度。文件名优先 pngName → title → 'chart'。
function exportPng() {
  const inst = chart.instance()
  if (!inst) return
  const name = sanitizeFileName(props.pngName || props.title || 'chart')
  const opts = { type: 'png' as const, pixelRatio: 2, backgroundColor: cssVar('--panel') || '#fff' }
  const url = props.pngConnected && props.group
    ? inst.getConnectedDataURL(opts)
    : inst.getDataURL(opts)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.png`
  a.click()
}

defineExpose({ instance: () => chart.instance(), exportPng })

const pad = (n: number) => String(n).padStart(2, '0')

// 「数据时间」文案：当天只显时:分:秒；跨天补月-日（跨年再补年份），避免多天前的数据只显时刻误导。
const updatedText = computed(() => {
  if (props.updatedAt == null) return ''
  const d = new Date(props.updatedAt)
  if (Number.isNaN(d.getTime())) return String(props.updatedAt)
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `数据 ${hm}:${pad(d.getSeconds())}`
  const y = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}-` : ''
  return `数据 ${y}${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`
})

// 新鲜度分级：显式 stale 覆盖 → 传入 freshness → 由 updatedAt 按 cadence 推导。
const level = computed<Freshness>(() => {
  if (props.stale) return 'stale'
  if (props.freshness) return props.freshness
  return freshnessOf(props.updatedAt, { cadence: props.cadence })
})

// 陈旧/老化 tooltip（stale 红点强调「已过期 N 天」）。
const freshTitle = computed(() => {
  const days = ageDaysOf(props.updatedAt)
  if (level.value === 'stale') return days == null ? '数据已过期' : `数据已过期 ${days} 天`
  if (level.value === 'aging') return days == null ? '数据老化' : `数据 ${days} 天前`
  if (level.value === 'unknown') return '数据时间未知'
  return '数据较新'
})

const cssHeight = () => (typeof props.height === 'number' ? `${props.height}px` : props.height)
</script>

<template>
  <section ref="cardRef" class="chart-card" :class="{ 'chart-card--full': isFull }">
    <header v-if="title || $slots.actions || updatedAt != null || fullscreen || pngExport" class="chart-card__head">
      <h3 v-if="title" class="chart-card__title">{{ title }}</h3>
      <div class="chart-card__actions">
        <span v-if="updatedAt != null" class="chart-card__updated" :title="freshTitle">
          <i
            class="chart-card__dot"
            :class="{
              'chart-card__dot--aging': level === 'aging',
              'chart-card__dot--stale': level === 'stale',
              'chart-card__dot--unknown': level === 'unknown'
            }"
          />{{ updatedText }}
        </span>
        <slot name="actions" />
        <button v-if="pngExport" class="chart-card__pngbtn" title="导出 PNG" @click="exportPng">
          PNG
        </button>
        <button v-if="fullscreen" class="chart-card__fsbtn" :title="isFull ? '退出全屏' : '全屏'" @click="toggleFullscreen">
          {{ isFull ? '⤡' : '⤢' }}
        </button>
      </div>
    </header>
    <div class="chart-host-wrap" :style="{ height: isFull ? '100%' : cssHeight() }">
      <div ref="host" class="chart chart-host" style="height: 100%" />
      <div v-if="empty" class="chart-card__empty">
        <span>{{ emptyText }}</span>
      </div>
    </div>
    <div v-if="brushStats && brushResult" class="chart-card__brush">
      框选 {{ brushResult.count }} 点 · 求和 {{ fmtNum(brushResult.sum, 1) }} · 均值 {{ fmtNum(brushResult.avg, 2) }} · 峰 {{ fmtNum(brushResult.max, 1) }} · 谷 {{ fmtNum(brushResult.min, 1) }}
    </div>
  </section>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  padding: 14px 16px 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.chart-card--full {
  padding: 20px 24px;
  background: var(--panel, #fff);
}
.chart-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.chart-card__title {
  margin: 0;
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--text, #1f2a37);
  letter-spacing: 0.2px;
}
.chart-card__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-card__updated {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-xs);
  color: var(--muted, #909399);
}
.chart-card__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success, #16a34a);
  box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5);
  animation: chart-card-pulse 1.8s infinite;
}
.chart-card__dot--aging {
  background: var(--warning, #d97706);
  box-shadow: none;
  animation: none;
}
.chart-card__dot--stale {
  background: var(--danger, #dc2626);
  box-shadow: none;
  animation: none;
}
.chart-card__dot--unknown {
  background: var(--muted, #9ca3af);
  box-shadow: none;
  animation: none;
}
@keyframes chart-card-pulse {
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}
.chart-card__fsbtn {
  border: 1px solid var(--line, #e5e7eb);
  background: var(--panel-sub, #f8fafc);
  color: var(--muted, #667085);
  border-radius: 6px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: var(--font-md);
  line-height: 1;
}
.chart-card__fsbtn:hover {
  border-color: var(--primary, #0f766e);
  color: var(--primary, #0f766e);
}
.chart-card__pngbtn {
  border: 1px solid var(--line, #e5e7eb);
  background: var(--panel-sub, #f8fafc);
  color: var(--muted, #667085);
  border-radius: 6px;
  height: 24px;
  padding: 0 8px;
  cursor: pointer;
  font-size: var(--font-xs);
  font-weight: 600;
  letter-spacing: 0.5px;
  line-height: 1;
}
.chart-card__pngbtn:hover {
  border-color: var(--primary, #0f766e);
  color: var(--primary, #0f766e);
}
.chart-host-wrap {
  position: relative;
  width: 100%;
}
.chart-card .chart {
  width: 100%;
}
.chart-card__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted, #909399);
  font-size: var(--font-md);
  pointer-events: none;
}
.chart-card__brush {
  margin-top: 6px;
  padding: 4px 10px;
  font-size: var(--font-sm);
  color: var(--text-body, #344054);
  background: var(--primary-tint, #ecfdf5);
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}
</style>
