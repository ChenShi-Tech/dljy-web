<script setup lang="ts">
// 逐日系统负荷单子图组件（actualLoad 分页化抽取）。
// 把 DailySystemLoadView 原 renderPanel() 的渲染逻辑收敛到一个可复用子图：
// 接收某类负荷源(system/misplace)的单指标(均值/最小/最大)数据。
// 两种渲染模式（数据驱动自动切换，非地区硬编码）：
//   ① 逐年同期对比：各年满覆盖、真重叠（如山西 2021-2026 六年）→ 每年一条年线共用月-日轴；
//   ② 连续时间线：年数≥2 但各年不重叠、拼起来才凑成一段连续时间（如云南仅
//      2025-07~2026-07 连续一年，折叠后 2025 落下半年/2026 落上半年）→ 按时序拼成一条连续线，
//      x 轴改为带年份的连续日期，消除"拼接不重叠"的视觉误解。
// 生命周期(init/容器resize/主题重建/dispose)统一交给 useEChart 托管，参照 UnifiedForecastChart 结构。
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import type {
  ActualLoadMetricKey,
  ActualLoadSourceViewModel
} from '@/services/data/contracts'
import { chartChrome } from '../../composables/useTheme'
import { useEChart } from '../../composables/useEChart'
import { axisTooltip, sliderZoom, emptyOverlay } from '@/services/chart/chartOptions'
import { bottomEnhancedToolbox } from '@/services/chart/chartStyle'
import { buildLoadPanelModel, continuousTickFormatter, overlayTickFormatter } from '@/services/chart/loadPanelModel'

const props = withDefaults(defineProps<{
  /** 负荷源数据（system 或 misplace）；null 表示该源缺失。 */
  source: ActualLoadSourceViewModel | null
  /** 指标字段：average/min/max。 */
  metricKey: ActualLoadMetricKey
  /** 列名（系统负荷实际值 / 错位负荷实际值），用于标题与导出命名。 */
  colName: string
  /** 指标中文名（均值/最小值/最大值），用于标题。 */
  metricName: string
  /** 子图高度：数值按 px 处理；字符串按原样作为 CSS 高度（支持 clamp/vh 等自适应写法）。 */
  height?: number | string
  /** 是否显示底部拖拽手柄让用户自调高度（拖拽经 update:height 上抛，由父级持久化/联动）。 */
  resizable?: boolean
}>(), {
  height: 420,
  resizable: false
})

// 拖拽调高：上抛新高度（px），父级负责联动同页各图 + localStorage 记忆。
const emit = defineEmits<{ 'update:height': [number] }>()

// 容器 CSS 高度：数值补 px；字符串（clamp/vh 等自适应）原样透传。
// 高度变化经 useEChart 的 ResizeObserver 自动触发 chart.resize()，实现随视口自适应。
const heightStyle = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height
)

// 底部手柄拖拽：起点高度 + 纵向位移 → clamp 到 [280,1200] 后上抛。
// 用 pointer events（非仅 mouse）统一鼠标/触屏/笔，满足移动端可用性（codex #1385 P2）。
const DRAG_MIN = 280
const DRAG_MAX = 1200
let dragStartY = 0
let dragStartH = 0
function onDragMove(e: PointerEvent) {
  const h = Math.min(DRAG_MAX, Math.max(DRAG_MIN, dragStartH + (e.clientY - dragStartY)))
  emit('update:height', h)
}
function stopDrag() {
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', stopDrag)
  document.removeEventListener('pointercancel', stopDrag)
  document.body.style.userSelect = ''
}
function onDragStart(e: PointerEvent) {
  e.preventDefault()
  dragStartY = e.clientY
  dragStartH = typeof props.height === 'number' ? props.height : (el.value?.clientHeight ?? DRAG_MIN)
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup', stopDrag)
  document.addEventListener('pointercancel', stopDrag)
  document.body.style.userSelect = 'none'
}
onBeforeUnmount(stopDrag)

// 6 条年线配色，与原实现一致。
const YEAR_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#fc8452', '#9a60b4']

const el = ref<HTMLDivElement | null>(null)

function render() {
  if (!el.value) return
  const cc = chartChrome()
  const block = props.source
  // 数据缺失 → 空态图
  if (!block) {
    chart.setOption({
      title: { text: `${props.colName} · ${props.metricName}`, left: 8, top: 2, textStyle: { fontSize: 12, color: '#303133' } },
      ...emptyOverlay(true, '无数据')
    }, { notMerge: true })
    return
  }
  // 按年矩阵 → 图表模型（overlay 逐年对比 / continuous 连续线，纯逻辑见 loadPanelModel）。
  const model = buildLoadPanelModel(block.nameList, block.years, block.metrics[props.metricKey] || [], props.metricName)
  const xData = model.xData
  const legend = model.lines.map((l) => l.name)
  const isContinuous = model.mode === 'continuous'
  const series = model.lines.map((l, i) => ({
    name: l.name, type: 'line', smooth: false, showSymbol: false,
    // 连续线无 null（只收录有值点）；逐年对比需 connectNulls 跨闰年 2/29 断点。
    connectNulls: !isContinuous, lineStyle: { width: 1.3, color: YEAR_COLORS[i % YEAR_COLORS.length] },
    itemStyle: { color: YEAR_COLORS[i % YEAR_COLORS.length] }, data: l.data
  }))
  const tickFormatter = isContinuous ? continuousTickFormatter : overlayTickFormatter
  chart.setOption({
    title: { text: `${props.colName} · ${props.metricName}`, left: 8, top: 2, textStyle: { fontSize: 12, color: '#303133' } },
    // 有 title:legend 手动 top:22(不能用 bottomLayoutLegend 的 top:0,会盖 title),改居中 scroll
    legend: { top: 22, left: 'center', type: 'scroll', itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 10 }, data: legend },
    // 底部布局:工具栏右下角(保留 magicType);grid bottom 加大给 toolbox + sliderZoom 滑块共存让位
    toolbox: bottomEnhancedToolbox(`${props.colName}-${props.metricName}`, 8),
    tooltip: { ...axisTooltip({ unit: '万KWH' }), confine: true },
    dataZoom: sliderZoom(), // 366 点长序列:滚轮 + 底部滑块
    grid: { left: 52, right: 16, top: 60, bottom: 64 },
    xAxis: {
      type: 'category', data: xData, boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 9, interval: 0, formatter: tickFormatter },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: { type: 'value', min: 0, max: 45000, interval: 9000, name: '万KWH', nameTextStyle: { color: cc.axisLabel, fontSize: 10 },
      axisLabel: { color: cc.axisLabel, fontSize: 9, formatter: (v: number) => v.toLocaleString('zh-CN') }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series,
    ...emptyOverlay(!series.length || !xData.length)
  }, { notMerge: true })
}

const chart = useEChart(el, { render })

onMounted(render)
// 数据变化（切地区/重新加载）后重绘
watch(() => props.source, () => nextTick(render), { deep: true })

defineExpose({ resize: chart.resize })
</script>

<template>
  <div class="load-panel-wrap" :style="{ height: heightStyle }">
    <div ref="el" class="load-panel-chart"></div>
    <div
      v-if="resizable"
      class="resize-handle"
      title="拖拽调整图表高度"
      @pointerdown="onDragStart"
    >
      <span class="grip"></span>
    </div>
  </div>
</template>

<style scoped>
.load-panel-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .04);
  overflow: hidden;
}
.load-panel-chart { width: 100%; flex: 1 1 auto; min-height: 0; }
/* 底部拖拽手柄：整条可拖，中间一道 grip 提示可拖 */
.resize-handle {
  flex: 0 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  background: var(--el-fill-color-light);
  transition: background .15s;
  touch-action: none; /* 触屏拖拽时禁止页面滚动干扰 */
}
.resize-handle:hover { background: var(--el-fill-color); }
.resize-handle:active { background: var(--el-fill-color-dark); }
.grip { width: 36px; height: 3px; border-radius: 2px; background: var(--el-border-color-darker); }
</style>
