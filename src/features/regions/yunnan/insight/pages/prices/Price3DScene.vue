<script setup lang="ts">
// 多日三维价格场景（dljy#3007 任务 6.9）：x=日内时段、y=业务日、z=价格，每业务日×
// 市场阶段一条折线（缺测拆段不连线，负价原样画 0 以下），日前蓝/实时橙固定配色。
// ----------------------------------------------------------------------------
// 资源纪律（design D6.2/D10）：
//   - echarts-gl 按需动态加载：`await import('echarts-gl')` 只在场景首次出现时发生
//     一次（模块级 promise 缓存），单日走势/热力用户不付这份包体与 WebGL 上下文；
//   - echarts-gl 的 3D 实例不经 useEChart 托管（主题重建/懒 init 语义与 WebGL 上下文
//     生命周期不合），沿用 PriceAnalysisView 的手动 init/dispose + ResizeObserver；
//   - 卸载、KeepAlive 失活（onDeactivated）、页签切走（父级 v-if 卸载）都 dispose，
//     彻底释放 WebGL 上下文；激活回来重建；
//   - 加载或初始化抛错 → emit('initError')，由父级降级到热力（本组件不自行降级）。
import * as echarts from 'echarts'
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { formatMetricValue } from 'shared/insight/metrics.mjs'
import { PHASE_LINE_COLOR, type PriceLine3D, type PricePhase } from './priceProfileModel'

const props = defineProps<{
  /** 三维折线（每业务日×阶段一条，缺测已拆段） */
  lines: PriceLine3D[]
  /** x 轴类目：结果里真实出现的日内时点（小时价 24 / 15 分钟价 96） */
  timePoints: string[]
  /** y 轴类目：业务日（升序） */
  dates: string[]
}>()

const emit = defineEmits<{
  /** echarts-gl 加载失败或三维初始化抛错（父级据此降级热力） */
  initError: [message: string]
  /** 点击线上数据点（父级同步双切面的剖面日期/时点） */
  pointClick: [payload: { date: string; timeOfDay: string }]
}>()

// 默认视角（不自动旋转；重置视角回到这里）
const VIEW_CONTROL = { alpha: 18, beta: 30, distance: 180, autoRotate: false }

const rootRef = ref<HTMLDivElement | null>(null)
const hostRef = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
let chart: echarts.ECharts | null = null
let glFailed = false
let resizeObserver: ResizeObserver | null = null

// 模块级缓存：echarts-gl 只加载一次（切模式来回也不重复加载）。
let glModule: Promise<unknown> | null = null
function loadEChartsGl(): Promise<unknown> {
  glModule ??= import('echarts-gl')
  return glModule
}

const PHASE_LABEL: Record<PricePhase, string> = { 'day-ahead': '日前', 'real-time': '实时' }

function tooltipFormatter(params: unknown): string {
  const p = params as { seriesName?: string; value?: unknown }
  const value = p.value
  if (!Array.isArray(value)) return ''
  const date = props.dates[Number(value[1])]
  const time = props.timePoints[Number(value[0])]
  if (!date || !time) return ''
  const price = formatMetricValue('price.time-weighted-average', String(value[2]))
  return `${date} ${time}<br/>${p.seriesName ?? ''} ${price ?? '—'} 元/MWh`
}

function buildOption(): Record<string, unknown> {
  // 每个连续段一条 line3D（一条 series 的点会整体连线，跨缺测段必须拆开）。
  // 同阶段的段共用系列名：图例按名字聚合，「日前/实时」开关一次控制全部同阶段折线。
  const series = props.lines.flatMap((line) =>
    line.segments.map((segment) => ({
      name: PHASE_LABEL[line.phase],
      type: 'line3D',
      lineStyle: { width: 2, color: PHASE_LINE_COLOR[line.phase] },
      emphasis: { lineStyle: { width: 3 } },
      data: segment,
    }))
  )
  return {
    tooltip: { formatter: tooltipFormatter },
    legend: { top: 0, left: 8, itemWidth: 16, itemHeight: 8, data: ['日前', '实时'], textStyle: { fontSize: 11 } },
    // z 轴不设 min：负价原样画在 0 以下（旧价格分析页 zAxis3D.min=0 会把负价削平，不沿用）。
    xAxis3D: { type: 'category', name: '时点', data: props.timePoints, axisLabel: { fontSize: 9 } },
    yAxis3D: { type: 'category', name: '业务日', data: props.dates, axisLabel: { fontSize: 9 } },
    zAxis3D: { type: 'value', name: '元/MWh', axisLabel: { fontSize: 9 } },
    grid3D: {
      boxWidth: 100,
      boxDepth: 90,
      boxHeight: 82,
      top: 56,
      viewControl: { ...VIEW_CONTROL },
      light: { main: { intensity: 1.1 }, ambient: { intensity: 0.4 } },
    },
    series,
  }
}

function onPointClick(params: unknown): void {
  const value = (params as { value?: unknown }).value
  if (!Array.isArray(value)) return
  const date = props.dates[Number(value[1])]
  const timeOfDay = props.timePoints[Number(value[0])]
  if (date && timeOfDay) emit('pointClick', { date, timeOfDay })
}

function onWindowResize(): void {
  chart?.resize()
}

function observeResize(): void {
  if (!hostRef.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(hostRef.value)
}

function disposeChart(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (chart && !chart.isDisposed()) chart.dispose()
  chart = null
}

async function ensureChart(): Promise<void> {
  if (chart || glFailed) return
  if (!hostRef.value) return
  try {
    await loadEChartsGl()
  } catch {
    // 动态加载失败（网络/构建产物缺失）：只报一次，父级降级热力后本组件即卸载。
    glFailed = true
    emit('initError', '三维组件加载失败')
    return
  }
  // await 期间可能已被卸载/失活
  if (!hostRef.value || chart) return
  try {
    chart = echarts.init(hostRef.value)
    chart.on('click', onPointClick)
    chart.setOption(buildOption(), true)
    observeResize()
  } catch {
    // 创建 WebGL 上下文失败等初始化异常：释放残留并上报，父级降级。
    disposeChart()
    glFailed = true
    emit('initError', '三维初始化失败')
  }
}

function resetView(): void {
  chart?.setOption({ grid3D: { viewControl: { ...VIEW_CONTROL } } })
}

async function toggleFullscreen(): Promise<void> {
  const el = rootRef.value
  if (!el) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch {
    // 全屏被浏览器拒绝（如非用户手势触发）：静默放弃，图仍可用。
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === rootRef.value
  chart?.resize()
}

defineExpose({ resetView, toggleFullscreen })

onMounted(() => {
  void ensureChart()
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

// KeepAlive 失活：释放 WebGL 上下文（design D6.2：切走就 dispose，回来重建）。
onDeactivated(() => {
  disposeChart()
})

onActivated(() => {
  void ensureChart()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  disposeChart()
})

watch(
  () => [props.lines, props.timePoints, props.dates],
  () => {
    if (chart) chart.setOption(buildOption(), true)
  },
  { deep: true }
)
</script>

<template>
  <div ref="rootRef" class="price-3d-scene">
    <div ref="hostRef" class="scene-host"></div>
    <div class="scene-tools">
      <el-button size="small" @click="resetView">重置视角</el-button>
      <el-button size="small" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.price-3d-scene {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: var(--panel, #fff);
}
.price-3d-scene:fullscreen {
  padding: 8px;
}
.scene-host {
  width: 100%;
  height: 100%;
  min-height: 320px;
}
.scene-tools {
  position: absolute;
  top: 4px;
  right: 8px;
  display: flex;
  gap: 4px;
}
</style>
