<script setup lang="ts">
// 24节气 (actualLoad query2) — 精修版,对照线上 A9.png:6 年(2021-2026)各一子图。
// 顶部:① 节气/日期 模式(互斥);② 指标 日前负荷/风电/光伏/价格;③ 统计 最大/最小/平均。后两组组合=图例(最多12)。
// 子图:X 下=日期、上=节气名标注;左Y=值(0~5万自适应) 右Y=价格(0~1500)。日期模式逐日打点;节气模式只取节气当天点。
// 数据:GET /sdpt/actualLoad/query2 -> {system:[6年]{year,jqList(24节气),nameList(逐日),legendList(指标),pjz/zxz/zdz=[指标][日]}}。
//   ⚠️ 每年 legendList 可能不同(近年可能只含 负荷+价格),按各年自身 legendList 取数。源 capture-raw/sdpt_actualLoad/。
import { onMounted, ref, nextTick, watch } from 'vue'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, sliderZoom, bottomToolbox, emptyOverlay } from '@/services/chart/chartOptions'

const INDICATORS = [
  { key: '日前负荷', axis: 0, shades: { 最大: '#2e4d8e', 平均: '#4472C4', 最小: '#9bc2e6' } },
  { key: '日前风电', axis: 0, shades: { 最大: '#0e6655', 平均: '#16a085', 最小: '#7dcea0' } },
  { key: '日前光伏', axis: 0, shades: { 最大: '#b9770e', 平均: '#e67e22', 最小: '#f5cba7' } },
  { key: '日前价格', axis: 1, shades: { 最大: '#922b21', 平均: '#c0392b', 最小: '#e6a6a0' } }
]
const STATS = [{ key: '最大', field: 'zdz', dash: 'dashed' }, { key: '最小', field: 'zxz', dash: 'dotted' }, { key: '平均', field: 'pjz', dash: 'solid' }]
const riqiMD = (riqi: string) => { const [, m, d] = riqi.split('-'); return `${+m}月${+d}日` }
// tooltip 单位:负荷/风电/光伏(轴0)=MW,价格(轴1)=元/MWh
const TOOLTIP_UNITS: Record<string, string> = {}
INDICATORS.forEach((ind) => STATS.forEach((st) => { TOOLTIP_UNITS[`${ind.key}${st.key}值`] = ind.axis === 1 ? '元/MWh' : 'MW' }))

const loading = ref(true)
const error = ref('')
const mode = ref<'date' | 'jq'>('date')
// 模式同步至 URL(刷新/分享后还原);非法值回退日期模式
useQuerySync({ mode })
if (mode.value !== 'jq' && mode.value !== 'date') mode.value = 'date'
const selInd = ref<string[]>(INDICATORS.map((i) => i.key))
const selStat = ref<string[]>(STATS.map((s) => s.key))
const years = ref<any[]>([])
// 年份子图句柄池(当前数据 2021-2026 共 6 年,预留扩展)
const MAX_PANELS = 8
const panelRefs = Array.from({ length: MAX_PANELS }, () => ref<HTMLElement | null>(null))
const panelCharts = panelRefs.map((r, i) => useEChart(r, { render: () => renderYear(i) }))
const setPanelRef = (i: number) => (el: any) => { if (i < MAX_PANELS) panelRefs[i].value = (el as HTMLElement | null) }

async function load() {
  loading.value = true; error.value = ''
  panelCharts.forEach((h) => h.showLoading())
  try {
    const res = await fetchCaptured<any>('sdpt_actualLoad', 'query2__')
    years.value = (res?.data?.system || []).slice().sort((a: any, b: any) => (a.year < b.year ? 1 : -1)) // 2026→2021
    await nextTick()
    renderAll()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
    panelCharts.forEach((h) => h.hideLoading())
  }
}

function renderYear(idx: number) {
  const y: any = years.value[idx]
  if (!y || idx >= MAX_PANELS) return
  const nameList: string[] = y.nameList || []
  const legend: string[] = y.legendList || []
  const jq: any[] = y.jqList || []
  const jqPos = jq.map((q) => ({ name: q.jjrmc, i: nameList.indexOf(riqiMD(q.riqi)) })).filter((q) => q.i >= 0)
  const xs = mode.value === 'date' ? nameList : jqPos.map((q) => nameList[q.i])
  const pick = (arr: any[]) => mode.value === 'date' ? arr : jqPos.map((q) => arr[q.i])

  const series: any[] = []
  INDICATORS.forEach((ind) => {
    if (!selInd.value.includes(ind.key)) return
    const li = legend.indexOf(ind.key)
    if (li < 0) return
    STATS.forEach((st) => {
      if (!selStat.value.includes(st.key)) return
      const arr = (y[st.field] || [])[li] || []
      const color = ind.shades[st.key as keyof typeof ind.shades]
      series.push({
        name: `${ind.key}${st.key}值`, type: 'line', yAxisIndex: ind.axis, showSymbol: mode.value === 'jq',
        smooth: mode.value === 'date', symbolSize: 4,
        lineStyle: { width: 1.2, color, type: st.dash }, itemStyle: { color },
        data: pick(arr)
      })
    })
  })
  const markLine = {
    silent: true, symbol: 'none', lineStyle: { color: '#e0c3a0', type: 'dashed', width: 1 },
    label: { show: true, position: 'end', distance: 2, rotate: 45, fontSize: 9, color: '#b8860b', formatter: (p: any) => p.name },
    data: (mode.value === 'date' ? jqPos.map((q) => ({ name: q.name, xAxis: q.i })) : jqPos.map((q, k) => ({ name: q.name, xAxis: k })))
  }
  if (series.length) series[0].markLine = markLine
  const cc = chartChrome()
  panelCharts[idx].setOption({
    title: { text: y.year, left: 8, top: 2, textStyle: { fontSize: 13, color: '#1f2329' } },
    // 有 title:legend 手动 top:22(不能用 bottomLayoutLegend 的 top:0,会盖 title),改居中 scroll
    legend: { top: 22, left: 'center', type: 'scroll', itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 9 }, data: series.map((s) => s.name) },
    // 底部布局:工具栏右下角
    toolbox: bottomToolbox(`24节气-${y.year}`, 8),
    tooltip: { ...axisTooltip({ units: TOOLTIP_UNITS }), confine: true },
    // 日期模式 366 点长序列:滚轮 + 底部滑块;节气模式仅 24 点不加缩放
    ...(mode.value === 'date' ? { dataZoom: sliderZoom() } : {}),
    // date 模式有 sliderZoom 滑块,bottom 加大给 toolbox + 滑块共存;节气模式仅给 toolbox 让位
    grid: { left: 50, right: 46, top: 80, bottom: mode.value === 'date' ? 56 : 48 },
    xAxis: { type: 'category', data: xs, boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 9, interval: mode.value === 'date' ? Math.floor(xs.length / 12) : 0, rotate: mode.value === 'jq' ? 30 : 0 },
      axisLine: { lineStyle: { color: cc.splitLine } } },
    yAxis: [
      { type: 'value', scale: true, min: 0, axisLabel: { color: cc.axisLabel, fontSize: 9, formatter: (v: number) => v.toLocaleString('zh-CN') }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', scale: true, min: 0, position: 'right', axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } }
    ],
    series,
    ...emptyOverlay(!series.length)
  }, { notMerge: true })
}

function renderAll() { years.value.forEach((_: any, i: number) => renderYear(i)) }

onMounted(load)
watch([mode, selInd, selStat], renderAll, { deep: true })

onRegionChange(load)
</script>

<template>
  <div class="jq" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="jq">节气</el-radio-button>
        <el-radio-button value="date">日期</el-radio-button>
      </el-radio-group>
      <el-divider direction="vertical" />
      <el-checkbox-group v-model="selInd" size="small">
        <el-checkbox-button v-for="i in INDICATORS" :key="i.key" :value="i.key">{{ i.key }}</el-checkbox-button>
      </el-checkbox-group>
      <el-divider direction="vertical" />
      <el-checkbox-group v-model="selStat" size="small">
        <el-checkbox-button v-for="s in STATS" :key="s.key" :value="s.key">{{ s.key }}值</el-checkbox-button>
      </el-checkbox-group>
    </div>
    <div class="grid">
      <div v-for="(y, i) in years" :key="y.year" :ref="setPanelRef(i)" class="subplot chart-host"></div>
    </div>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/actualLoad/query2 ｜ 6 年逐日 · 日前负荷/风电/光伏/价格 × 最大/最小/平均 · 节气标注 -->
  </div>
</template>

<style scoped>
.jq { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 12px; }
.subplot { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); height: 260px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
.mb { margin-bottom: 12px; }
@media (min-width: 1500px) { .grid { grid-template-columns: 1fr 1fr; } }
/* 移动端:筛选条纵排 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
}

@media (max-width: 768px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
