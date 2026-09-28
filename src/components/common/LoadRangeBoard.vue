<script setup lang="ts">
// 逐日系统负荷·单源版面（dljy#3384）：只有系统负荷、没有错位负荷口径的地区（如云南）使用。
// 不再套用「系统 vs 错位」双列 + 均/小/大分页，改为：
//   ① 指标行：最近日均、区间最高/最低负荷、数据覆盖；
//   ② 主图：连续日期轴上的日均值折线 + 日内最小~最大区间带；
//   ③ 副图：日内峰谷差（最大 − 最小），与主图联动缩放与十字线。
// 缺数日保留为断线（不连线、不插值）；卡片右上的数据时间取最后一个有数日，过期即如实标红。
import { computed } from 'vue'
import type { ActualLoadSourceViewModel } from '@/services/data/contracts'
import ChartCard from './ChartCard.vue'
import MetricTile from './MetricTile.vue'
import { chartChrome, cssVar } from '../../composables/useTheme'
import { fmtNum, sliderZoom } from '@/services/chart/chartOptions'
import { LOAD_PANEL_UNIT, buildLoadRangeSeries, loadRangeStats } from '@/services/chart/loadPanelModel'

const props = defineProps<{
  /** 系统负荷源（均/小/大三类指标）。 */
  source: ActualLoadSourceViewModel
}>()

const GROUP = 'actual-load-range'
const series = computed(() => buildLoadRangeSeries(props.source.nameList, props.source.years, props.source.metrics))
const stats = computed(() => loadRangeStats(series.value))
// 数据时间 = 最后一个有数日的末时点（不是取数时刻）；无数据不传。
const dataTime = computed(() => (stats.value.latest ? `${stats.value.latest.date}T23:45:00+08:00` : null))

const mw = (v: number | null | undefined) => (v == null ? '—' : fmtNum(v, 0))
const coverageSub = computed(() => {
  const s = stats.value
  if (!s.firstDate || !s.lastDate) return ''
  return `${s.firstDate} ~ ${s.lastDate}${s.gapDays ? `，其间缺 ${s.gapDays} 天` : ''}`
})

type AxisParam = { dataIndex: number }

function tooltipOf(p: AxisParam | AxisParam[]) {
  const i = (Array.isArray(p) ? p[0] : p)?.dataIndex
  const s = series.value
  if (i == null || !s.dates[i]) return ''
  const row = (label: string, v: number | null) =>
    `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span>${label}</span><b>${v == null ? '无数据' : `${fmtNum(v, 0)} ${LOAD_PANEL_UNIT}`}</b></div>`
  return `<div style="font-weight:600;margin-bottom:2px">${s.dates[i]}</div>`
    + row('日均值', s.avg[i]) + row('日内最大', s.max[i]) + row('日内最小', s.min[i]) + row('峰谷差', s.spread[i])
}

function axisBase() {
  const cc = chartChrome()
  return {
    xAxis: {
      type: 'category', data: series.value.dates, boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (d: string) => d.slice(2) },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxisBase: {
      type: 'value', scale: true, name: LOAD_PANEL_UNIT, nameTextStyle: { color: cc.axisLabel, fontSize: 10 },
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (v: number) => v.toLocaleString('zh-CN') },
      splitLine: { lineStyle: { color: cc.splitLine } }
    }
  }
}

function rangeOption() {
  const s = series.value
  const accent = cssVar('--accent') || '#5470c6'
  const { xAxis, yAxisBase } = axisBase()
  return {
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'line' }, formatter: tooltipOf },
    legend: { top: 0, left: 'center', itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 }, data: ['日均值', '日内最小~最大'] },
    grid: { left: 60, right: 20, top: 34, bottom: 56 },
    xAxis,
    yAxis: yAxisBase,
    dataZoom: sliderZoom(),
    series: [
      // 区间带：先画不可见的「最小」作为底，再叠「峰谷差」并填充，即得最小~最大之间的带状区域。
      { name: '日内最小~最大', type: 'line', stack: 'range', data: s.min, symbol: 'none', silent: true, lineStyle: { opacity: 0 } },
      { name: '日内最小~最大', type: 'line', stack: 'range', data: s.spread, symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        areaStyle: { color: accent, opacity: 0.18 }, itemStyle: { color: accent } },
      { name: '日均值', type: 'line', data: s.avg, symbol: 'none', smooth: false, lineStyle: { width: 1.6, color: accent }, itemStyle: { color: accent } }
    ]
  }
}

function spreadOption() {
  const s = series.value
  const color = cssVar('--warning') || '#e6a23c'
  const { xAxis, yAxisBase } = axisBase()
  return {
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'line' }, formatter: tooltipOf },
    grid: { left: 60, right: 20, top: 16, bottom: 28 },
    xAxis,
    yAxis: { ...yAxisBase, scale: false, min: 0 },
    dataZoom: [{ type: 'inside' }],
    series: [{ name: '日内峰谷差', type: 'bar', data: s.spread, barMaxWidth: 6, itemStyle: { color } }]
  }
}
</script>

<template>
  <div class="load-range-board">
    <div class="tile-grid">
      <MetricTile
        label="最近日均负荷"
        :value="mw(stats.latest?.avg)"
        :unit="LOAD_PANEL_UNIT"
        :sub="stats.latest?.date ?? ''"
        info="日内 96 个时点负荷功率的平均值"
      />
      <MetricTile label="区间最高负荷" :value="mw(stats.peak?.value)" :unit="LOAD_PANEL_UNIT" :sub="stats.peak?.date ?? ''" />
      <MetricTile label="区间最低负荷" :value="mw(stats.trough?.value)" :unit="LOAD_PANEL_UNIT" :sub="stats.trough?.date ?? ''" />
      <MetricTile label="数据覆盖" :value="String(stats.days)" unit="天" :sub="coverageSub" />
    </div>
    <ChartCard
      title="系统负荷实际值 · 日均值与日内区间"
      :height="440"
      :build-option="rangeOption"
      :group="GROUP"
      :updated-at="dataTime"
      :empty="!stats.days"
      png-export
      fullscreen
    />
    <ChartCard
      title="日内峰谷差（日内最大 − 最小）"
      :height="220"
      :build-option="spreadOption"
      :group="GROUP"
      :empty="!stats.days"
    />
  </div>
</template>

<style scoped>
.load-range-board { display: flex; flex-direction: column; gap: 12px; }
.tile-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .tile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
