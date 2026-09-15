<script setup lang="ts">
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crosshair } from 'lucide-vue-next'
import type { GridDisclosureCategory, GridDisclosureOverview } from './types'
import type { DeskFact, DeskSeries } from './disclosureDeskData'
import { parseDisclosureTime } from './disclosureTime'

const props = defineProps<{
  series: DeskSeries[]
  overview: GridDisclosureOverview | null
  dateFrom: string
  dateTo: string
  selection: { from: string; to: string } | null
  eventWindow?: { from: string; to: string | null } | null
  emptyTitle?: string
  emptyReason?: string
  textFacts?: DeskFact[]
}>()
const emit = defineEmits<{
  hover: [time: string | null]
  select: [range: { from: string; to: string }]
  clear: []
  'event-focus': [payload: { from: string; to: string; category: GridDisclosureCategory; count: number }]
}>()
const element = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let gesture: { pointerId: number; startX: number; y: number; startTime: number; dragged: boolean } | null = null
let suppressClick = false
const dragPreview = ref<{ left: number; width: number; height: number } | null>(null)
const keyboardTime = ref<number | null>(null)
const categories = [
  { id: 'maintenance', label: '检修计划', color: '--accent' },
  { id: 'outage', label: '非计划停运', color: '--danger' },
  { id: 'intervention', label: '人工干预', color: '--warning' },
  { id: 'congestion', label: '断面阻塞', color: '--primary' },
  { id: 'constraint', label: '输电约束', color: '--accent-2' },
] as const
const temporalSeries = computed(() => props.series.filter((series) => series.nativeMinutes !== null))
const scalarRecords = computed(() => props.series.filter((series) => series.nativeMinutes === null).flatMap((series) => series.points.filter((point) => point.value !== null).map((point) => ({ ...point, id: series.id, label: series.label, unit: series.unit }))))
const hasCurve = computed(() => temporalSeries.value.some((series) => series.points.some((point) => point.value !== null)))
function stamp(value: string) {
  return parseDisclosureTime(value, true) ?? NaN
}
function iso(value: number) { return `${new Date(value + 8 * 3600_000).toISOString().slice(0, 19)}+08:00` }
function displayTime(value: number, dayOnly = false) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', ...(dayOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(value)
}
function css(name: string, fallback: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback }
function lockTime(time: number, minutes = 60) {
  const first = stamp(props.dateFrom)
  const end = stamp(props.dateTo) + 86_400_000 - 1
  const interval = minutes * 60_000
  const from = Math.max(first, Math.floor((time - first) / interval) * interval + first)
  keyboardTime.value = from
  emit('select', { from: iso(from), to: iso(Math.min(end, from + interval - 1)) })
}
function pointerPosition(event: MouseEvent) {
  const bounds = element.value?.getBoundingClientRect()
  return bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null
}
function timeAtPixel(x: number, y: number) {
  const value = chart?.convertFromPixel({ gridIndex: 0 }, [x, y]) as number[] | undefined
  return Number.isFinite(value?.[0]) ? Math.max(stamp(props.dateFrom), Math.min(stamp(props.dateTo) + 86_400_000 - 1, value![0])) : null
}
function cancelGesture() { if (gesture) suppressClick = true; gesture = null; dragPreview.value = null }
function plotX(x: number) { return Math.max(68, Math.min((element.value?.clientWidth ?? 92) - 24, x)) }
function onPointerDown(event: PointerEvent) {
  suppressClick = false
  if (event.button !== 0 || event.pointerType === 'touch') return
  const position = pointerPosition(event)
  if (!position || !chart?.containPixel({ gridIndex: 0 }, [position.x, position.y])) return
  const time = timeAtPixel(position.x, position.y)
  if (time === null) return
  gesture = { pointerId: event.pointerId, startX: position.x, y: position.y, startTime: time, dragged: false }
  element.value?.focus({ preventScroll: true })
}
function onPointerMove(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return
  if (!(event.buttons & 1)) { cancelGesture(); return }
  const position = pointerPosition(event)
  if (!position) return
  gesture.dragged ||= Math.abs(position.x - gesture.startX) >= 4
  if (!gesture.dragged) return
  event.preventDefault()
  const endX = plotX(position.x)
  dragPreview.value = { left: Math.min(gesture.startX, endX), width: Math.abs(endX - gesture.startX), height: (element.value?.clientHeight ?? 390) * .51 }
}
function onPointerUp(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId || event.button !== 0) return
  const current = gesture
  const position = pointerPosition(event)
  gesture = null; dragPreview.value = null
  if (!position || (!current.dragged && Math.abs(position.x - current.startX) < 4)) return
  suppressClick = true
  const end = timeAtPixel(plotX(position.x), current.y)
  if (end === null) return
  const base = stamp(props.dateFrom), bound = stamp(props.dateTo) + 86_400_000 - 1
  const interval = (temporalSeries.value[0]?.nativeMinutes ?? 60) * 60_000
  const from = base + Math.floor((Math.min(current.startTime, end) - base) / interval) * interval
  const to = Math.min(bound, base + (Math.floor((Math.max(current.startTime, end) - base) / interval) + 1) * interval - 1)
  keyboardTime.value = from
  emit('select', { from: iso(from), to: iso(to) })
}
function onChartClick(event: MouseEvent) {
  if (event.button !== 0) return
  if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return }
  const position = pointerPosition(event)
  if (!position || !chart?.containPixel({ gridIndex: 0 }, [position.x, position.y])) return
  const time = timeAtPixel(position.x, position.y)
  if (time !== null) lockTime(time, temporalSeries.value[0]?.nativeMinutes ?? 60)
}
function clearSelection() { keyboardTime.value = null; emit('clear') }
function onCanvasBlankClick(event: { target?: unknown; offsetX: number; offsetY: number; event?: { button?: number; defaultPrevented?: boolean } }) {
  // A ZRender target belongs to a legend item, event dot, label, or curve.
  // Only background outside the main plotting grid cancels a selection.
  if (event.target || suppressClick || event.event?.defaultPrevented || (event.event?.button ?? 0) !== 0) return
  if (!Number.isFinite(event.offsetX) || !Number.isFinite(event.offsetY) || chart?.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) return
  clearSelection()
}
function onSurroundingClick(event: MouseEvent) {
  const target = event.target
  if (event.button !== 0 || !(target instanceof Element) || element.value?.contains(target)) return
  if (target.closest('button, a, input, select, textarea, summary, details, [role="button"]')) return
  if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); return }
  clearSelection()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { cancelGesture(); clearSelection(); return }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const step = (props.series[0]?.nativeMinutes ?? 60) * 60_000
  const first = stamp(props.dateFrom), last = stamp(props.dateTo) + 86_400_000 - step
  const current = keyboardTime.value ?? (props.selection ? stamp(props.selection.from) : first)
  keyboardTime.value = event.key === 'Home' ? first : event.key === 'End' ? last : Math.max(first, Math.min(last, current + (event.key === 'ArrowRight' ? step : -step)))
  lockTime(keyboardTime.value, step / 60_000)
}
function chartPoints(series: DeskSeries) {
  return series.points.flatMap((point) => {
    const time = stamp(point.time)
    const points = [[time, point.value]]
    if (series.step === 'end' && point.value !== null && series.nativeMinutes) points.push([time + series.nativeMinutes * 60_000 - 1, point.value])
    return points
  })
}
function render() {
  if (!element.value) return
  if (!chart) {
    chart = echarts.init(element.value)
    chart.on('updateAxisPointer', (event: unknown) => {
      const axes = (event as { axesInfo?: Array<{ axisDim?: string; value: number }> }).axesInfo
      const timeAxis = axes?.find((axis) => axis.axisDim === 'x' && Number.isFinite(Number(axis.value)))
      if (timeAxis) emit('hover', iso(Number(timeAxis.value)))
    })
    chart.getZr().on('globalout', () => emit('hover', null))
    chart.getZr().on('click', onCanvasBlankClick)
    chart.on('click', (event: unknown) => {
      const item = event as { seriesType?: string; data?: { value?: number[]; from?: string; to?: string; category?: GridDisclosureCategory; count?: number } | number[]; value?: number[]; seriesIndex?: number }
      if (item.seriesType === 'scatter' && item.data && !Array.isArray(item.data) && item.data.from && item.data.to) {
        if (item.data.category) emit('event-focus', { from: item.data.from, to: item.data.to, category: item.data.category, count: item.data.count ?? 0 })
      }
    })
  }
  const text = css('--text-soft', '#7893b3')
  const grid = css('--line-soft', '#233247')
  const colors = [css('--primary', '#2dd4bf'), css('--warning', '#f4bf61'), css('--accent', '#8294ff')]
  const selectedArea = props.selection ? { silent: true, itemStyle: { color: css('--primary-tint', 'rgba(45,212,191,.1)') }, data: [[{ xAxis: stamp(props.selection.from) }, { xAxis: stamp(props.selection.to) }]] } : undefined
  const eventFrom = parseDisclosureTime(props.eventWindow?.from), eventTo = parseDisclosureTime(props.eventWindow?.to)
  const eventArea = eventFrom !== null && eventTo !== null && eventTo >= eventFrom ? { silent: true, itemStyle: { color: css('--warning-tint', 'rgba(245,158,11,.1)') }, data: [[{ xAxis: eventFrom }, { xAxis: eventTo }]] } : undefined
  const eventLine = eventFrom !== null ? { silent: true, symbol: 'none', label: { formatter: '选中事件', color: css('--warning', '#f5b04e') }, lineStyle: { color: css('--warning', '#f5b04e'), type: 'dashed' }, data: [{ xAxis: eventFrom }] } : undefined
  const min = stamp(props.dateFrom)
  const max = stamp(props.dateTo) + 86_400_000 - 1
  chart.setOption({
    animation: false,
    color: colors,
    grid: [{ left: 68, right: 24, top: 47, height: '51%' }, { left: 68, right: 24, top: '69%', height: '21%' }],
    legend: { top: 5, left: 64, data: temporalSeries.value.map((series) => series.label), textStyle: { color: text }, icon: 'roundRect', itemWidth: 15, itemHeight: 3 },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, backgroundColor: css('--panel', '#111d30'), borderColor: grid, textStyle: { color: css('--text', '#d8e8fb') }, axisPointer: { type: 'line' } },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }], label: { formatter: (item: { value: number | string; axisDimension?: string }) => item.axisDimension === 'x' ? displayTime(Number(item.value)) : String(item.value) } },
    xAxis: [0, 1].map((gridIndex) => ({ type: 'time', gridIndex, min, max, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text, hideOverlap: true, formatter: (value: number) => props.dateFrom === props.dateTo ? displayTime(value).slice(-5) : displayTime(value, true) }, splitLine: { show: gridIndex === 0, lineStyle: { color: grid } }, axisTick: { show: false } })),
    yAxis: [
      { type: 'value', show: temporalSeries.value.length > 0, name: temporalSeries.value[0]?.unit ?? '', scale: true, nameTextStyle: { color: text }, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid, type: 'dashed' } } },
      { type: 'category', gridIndex: 1, inverse: true, data: categories.map((item) => item.label), axisLabel: { color: text }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: true, lineStyle: { color: grid, type: 'dotted' } } },
    ],
    toolbox: { show: false },
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: false }],
    series: [
      ...temporalSeries.value.map((series, index) => ({
        id: series.id, name: series.label, type: 'line', data: chartPoints(series),
        step: series.step, showSymbol: series.nativeMinutes !== 60, symbolSize: 4, smooth: false, connectNulls: false,
        lineStyle: { width: index === 2 ? 1.3 : 2, type: series.forecast || /forecast|da/.test(series.id) ? 'dashed' : 'solid', opacity: index === 2 ? .7 : 1 },
        emphasis: { focus: 'series' }, markArea: index === 0 ? eventArea ?? selectedArea : undefined, markLine: index === 0 ? eventLine : undefined,
      })),
      ...categories.map((category, row) => ({
        id: `event-${category.id}`, name: category.label, type: 'scatter', xAxisIndex: 1, yAxisIndex: 1,
        data: (props.overview?.buckets ?? []).filter((bucket) => bucket.countsByCategory[category.id] > 0).map((bucket) => ({
          value: [(stamp(bucket.from) + stamp(bucket.to)) / 2, row, bucket.countsByCategory[category.id]], from: bucket.from, to: bucket.to, category: category.id, count: bucket.countsByCategory[category.id],
        })),
        symbolSize: (value: number[]) => Math.min(19, 6 + Math.log2(value[2] + 1) * 2),
        itemStyle: { color: css(category.color, colors[row % colors.length]), opacity: .84 },
        tooltip: { trigger: 'item', formatter: (item: { data: { from: string; to: string }; value: number[] }) => `${category.label} · ${displayTime(stamp(item.data.from))} — ${displayTime(stamp(item.data.to))}\n${item.value[2].toLocaleString('zh-CN')} 条相关披露记录\n点击查看该时段列表；不代表新增事件数` },
        markArea: row === 0 ? eventArea ?? selectedArea : undefined, markLine: row === 0 ? eventLine : undefined,
      })),
    ],
  }, { notMerge: true })
}
onMounted(() => {
  void nextTick(render)
  resizeObserver = new ResizeObserver(() => chart?.resize())
  if (element.value) resizeObserver.observe(element.value)
  themeObserver = new MutationObserver(render)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', cancelGesture)
  window.addEventListener('blur', cancelGesture)
})
watch(() => [props.series, props.overview, props.dateFrom, props.dateTo, props.selection, props.eventWindow], () => { cancelGesture(); void nextTick(render) }, { deep: true })
watch([() => props.selection?.from, () => props.selection?.to], () => { keyboardTime.value = props.selection ? stamp(props.selection.from) : null })
watch([() => props.dateFrom, () => props.dateTo, () => temporalSeries.value[0]?.nativeMinutes], () => { keyboardTime.value = null })
onBeforeUnmount(() => { cancelGesture(); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', cancelGesture); window.removeEventListener('blur', cancelGesture); resizeObserver?.disconnect(); themeObserver?.disconnect(); chart?.dispose(); chart = null })
</script>

<template>
  <div class="desk-chart-wrap" @click="onSurroundingClick">
    <div ref="element" class="desk-chart" data-testid="desk-chart" role="application" tabindex="0" aria-label="交易指标与披露时窗；单击选中一个时段，按住鼠标左键拖动选择多个时段；左右方向键切换时点，Home 到起点，End 到末点，Escape 解除锁定" @keydown="onKeydown" @pointerdown="onPointerDown" @click.capture="onChartClick" />
    <div v-if="dragPreview" class="drag-preview" data-testid="desk-drag-preview" :style="{ left: `${dragPreview.left}px`, width: `${dragPreview.width}px`, height: `${dragPreview.height}px` }" />
    <div v-if="scalarRecords.length" class="scalar-observation" data-testid="desk-scalar-values"><p>日级披露数值 · 不作为全天恒定曲线</p><div><article v-for="item in scalarRecords" :key="`${item.id}:${item.time}`"><small>{{ item.time.slice(0, 10) }} · {{ item.label }}</small><strong>{{ item.value?.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }} <em>{{ item.unit }}</em></strong></article></div></div>
    <div v-else-if="textFacts?.length" class="scalar-observation" data-testid="desk-text-values"><p>日级披露事项</p><div><article v-for="item in textFacts" :key="`${item.label}:${item.time}`"><small>{{ item.time }} · {{ item.label }}</small><strong>{{ item.value }}</strong></article></div></div>
    <div v-else-if="!hasCurve" class="curve-empty" data-testid="desk-curve-empty"><Crosshair :size="27" /><strong>{{ emptyTitle || '此时段暂无可绘制的指标曲线' }}</strong><span>{{ emptyReason || '选择其他指标或有数据日期；下方披露轨道独立可用。' }}</span></div>
  </div>
</template>

<style scoped>
.desk-chart-wrap{position:relative;min-width:0;background:var(--panel)}.desk-chart{width:100%;height:390px;user-select:none}.curve-empty{position:absolute;inset:85px 75px auto;min-height:165px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;text-align:center;color:var(--muted);pointer-events:none}.curve-empty svg{color:var(--primary);opacity:.55}.curve-empty strong{color:var(--text-soft);font-size:var(--font-lg);font-weight:500}.curve-empty span{font-size:var(--font-sm);line-height:1.6;max-width:470px}@media(max-width:700px){.desk-chart{height:390px}.curve-empty{inset:70px 50px auto;min-height:135px}}
.scalar-observation{position:absolute;inset:60px 75px auto;max-height:175px;overflow:auto}.scalar-observation>p{margin:0 0 10px;color:var(--muted);font-size:var(--font-xs)}.scalar-observation>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.scalar-observation article{padding:12px;border:1px solid var(--line);border-radius:7px;background:var(--panel-sub)}.scalar-observation small{display:block;color:var(--muted);font-size:var(--font-xs)}.scalar-observation strong{display:block;color:var(--primary);font-size:var(--font-xl);font-weight:600;margin-top:6px}.scalar-observation em{font-style:normal;font-size:var(--font-xs);font-weight:400;color:var(--muted)}@media(max-width:700px){.scalar-observation{inset:55px 45px auto;max-height:170px}.scalar-observation>div{grid-template-columns:1fr}}.drag-preview{position:absolute;top:47px;background:var(--primary-tint);border:1px solid var(--primary);pointer-events:none;box-sizing:border-box}</style>
