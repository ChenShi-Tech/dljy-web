<script setup lang="ts">
// 云南「官方预测 vs 实际」对照大图（预测中心 hub 云南 tab，epic #336 PR-B2）。
// 数据：yn_system_forecast 真实回放（南网官方 D-1 披露，captured）——这是**官方披露
// 数据**（真实采集），非本系统模型输出；预测值仍非结算依据（hub 决策口径 advisory）。
// 取数：固定 region=yunnan（数据只在云南地区隔离原始快照中，与顶栏地区解耦）；一次拉窗口
// （锚定库内最新披露日前 7 天~次日，经 /api/real 载荷级日期过滤），窗口内切日零请求；
// 主图=所选日 96 点双线（预测虚线/实际实线，图表纪律：功率连续量 lineSeries 直线、
// 用户电价分时值 stepSeries step:'end'——timePoint 为时段起点标签）。
// 云南主线 + 全区域对照开关（行内 region 业务列，与地区隔离键无关）。
import { computed, onMounted, ref, watch } from 'vue'
import ChartCard from '../common/ChartCard.vue'
import DataState from '../common/DataState.vue'
import DataBasisBadge from '../DataBasisBadge.vue'
import { fetchCaptured } from '@/services/captured'
import { axisTooltip, chartToolbox, fmtNum, insideZoom } from '@/services/chart/chartOptions'
import { lineSeries, stepSeries } from '@/services/chart/chartStyle'

interface Row { operateDate?: string; targetDate?: string | null; timePoint?: string; region?: string; metric?: string; value?: number | null }

// 数据集目录：forecast/actual 成对；hydro 仅实际、断面仅预测（如实呈现不臆造）。
const DATASETS: Array<{
  key: string; label: string; unit: string; step: boolean
  forecast?: string; actual?: string
  regionMode: 'province' | 'section' | 'all_only'
}> = [
  { key: 'load', label: '统调负荷', unit: 'MW', step: false, forecast: 'load_forecast', actual: 'load_actual', regionMode: 'province' },
  { key: 'new_energy', label: '新能源出力', unit: 'MW', step: false, forecast: 'new_energy_forecast_d1', actual: 'new_energy_actual', regionMode: 'province' },
  { key: 'hydro', label: '水电出力（仅实际，官方无预测表）', unit: 'MW', step: false, actual: 'hydro_actual', regionMode: 'province' },
  { key: 'total_generation', label: '全网总发电', unit: 'MW', step: false, forecast: 'total_generation_forecast', actual: 'total_generation_actual', regionMode: 'province' },
  { key: 'non_market', label: '非市场化机组出力', unit: 'MW', step: false, forecast: 'non_market_forecast', actual: 'non_market_actual', regionMode: 'province' },
  { key: 'inter_provincial', label: '云南总送出（断面预测）', unit: 'MW', step: false, forecast: 'inter_provincial_forecast', regionMode: 'section' },
  { key: 'user_price', label: '用户侧统一电价（DA vs RT）', unit: '元/MWh', step: true, forecast: 'da_user_price', actual: 'rt_user_price', regionMode: 'all_only' }
]

const datasetKey = ref('load')
const date = ref('')
const compareAll = ref(false)
const loading = ref(false)
const errorMsg = ref('')
// 窗口缓存：{datasetKey: {forecast: rows, actual: rows}}（近 7 天+明日，一次拉取）
const cache = ref<Record<string, { forecast: Row[]; actual: Row[] }>>({})

const current = computed(() => DATASETS.find((d) => d.key === datasetKey.value) ?? DATASETS[0])

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

function shiftDay(base: string, offset: number): string {
  return new Date(new Date(`${base}T00:00:00Z`).getTime() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

async function loadWindow() {
  loading.value = true
  errorMsg.value = ''
  try {
    const d = current.value
    // 锚定库内最新披露日：capture 按导出包回放，最新披露可能远早于浏览器今天，
    // 「按今天回推」在历史包场景整窗落空——先用尾部小切片探测最新目标日，探测失败回退今天。
    // region 固定 yunnan：本 tab 标称云南披露、数据只存在于云南地区隔离原始快照，
    // 顶栏切到其他地区时不得打到该地区目录拿空/回退数据（仅本组件取数，不改全局地区）。
    let anchor = isoDay(0)
    try {
      const probeKey = d.actual ?? d.forecast
      if (probeKey) {
        const probe = await fetchCaptured<any>('yn_system_forecast', probeKey, { limit: 8, region: 'yunnan' })
        const probeRows: Row[] = Array.isArray(probe?.data) ? probe.data : []
        const latest = probeRows.map((r) => dayOf(r)).filter(Boolean).sort().at(-1)
        if (latest) anchor = latest
      }
    } catch { /* 探测失败按今天回推（真实或空） */ }
    const filter = { dateFrom: shiftDay(anchor, -7), dateTo: shiftDay(anchor, 1), region: 'yunnan' } // +1 覆盖「披露的明日预测」
    // D-1 滚动集窗口平移：/api/real 按 operateDate（发布日）过滤，而 new_energy_forecast_d1
    // 的对照日 targetDate=operateDate+1——预测侧窗口整体 -1 天，否则窗口首日只有实际无预测
    const fFilter = d.forecast === 'new_energy_forecast_d1'
      ? { ...filter, dateFrom: shiftDay(anchor, -8), dateTo: shiftDay(anchor, 0) }
      : filter
    const [f, a] = await Promise.all([
      d.forecast ? fetchCaptured<any>('yn_system_forecast', d.forecast, fFilter) : Promise.resolve(null),
      d.actual ? fetchCaptured<any>('yn_system_forecast', d.actual, filter) : Promise.resolve(null)
    ])
    cache.value[d.key] = {
      forecast: Array.isArray(f?.data) ? f.data : [],
      actual: Array.isArray(a?.data) ? a.data : []
    }
    // 默认日=窗口内最新「实际」日（预测多一天，对照日以实际覆盖为准；无实际则最新预测日）
    if (!date.value) {
      const dates = (cache.value[d.key].actual.length ? cache.value[d.key].actual : cache.value[d.key].forecast)
        .map((r) => dayOf(r)).filter(Boolean).sort()
      date.value = (dates.at(-1) as string) ?? isoDay(0)
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

// 行的「目标日」：new_energy_forecast_d1 为滚动 D-1 集（operateDate=发布日、targetDate=目标日），
// 用 targetDate 才是被预测的那一天；其余单日期表 targetDate=null 回退 operateDate（=运行日）。
function dayOf(r: Row): string | undefined {
  return (r.targetDate ?? r.operateDate) as string | undefined
}

function pickSeries(rows: Row[], day: string, region: string, metricFilter?: (m: string) => boolean): Array<[string, number]> {
  const matched = rows.filter((r) => dayOf(r) === day && typeof r.value === 'number'
    && (metricFilter ? metricFilter(String(r.metric ?? '')) : true)
    && matchRegion(r, region))
  if (current.value.regionMode === 'section') {
    // 断面族：ETL 同时写 send/receive 两类行且同一时点可有多个含「云南」断面——只取
    // 送出行并按 timePoint 合计（与弹性引擎/首页侧卡同口径），否则受电行混入且
    // Map 覆盖成单断面值，「总送出」偏小/抖动
    const byTime = new Map<string, number>()
    for (const r of matched) {
      if (r.metric !== 'inter_provincial_send') continue
      const t = String(r.timePoint)
      byTime.set(t, (byTime.get(t) ?? 0) + (r.value as number))
    }
    return [...byTime.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))
  }
  return matched
    .map((r) => [String(r.timePoint), r.value as number] as [string, number])
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
}

function matchRegion(r: Row, region: string): boolean {
  const mode = current.value.regionMode
  if (mode === 'all_only') return true // 用户价 region 恒 all
  if (mode === 'section') return typeof r.region === 'string' && r.region.includes('云南') // 断面名
  return r.region === region
}

const empty = computed(() => {
  const c = cache.value[current.value.key]
  return !loading.value && (!c || (!c.forecast.length && !c.actual.length))
})

// 所选日 KPI（云南口径）：预测/实际日均 + MAPE
const kpi = computed(() => {
  const c = cache.value[current.value.key]
  if (!c || !date.value) return null
  const region = current.value.regionMode === 'province' ? 'yn' : ''
  const f = new Map(pickSeries(c.forecast, date.value, region))
  const a = new Map(pickSeries(c.actual, date.value, region))
  const avg = (m: Map<string, number>) => (m.size ? [...m.values()].reduce((s, v) => s + v, 0) / m.size : null)
  let sum = 0; let n = 0
  for (const [t, av] of a) {
    const fv = f.get(t)
    if (fv === undefined || Math.abs(av) < 1) continue
    sum += Math.abs(fv - av) / Math.abs(av)
    n += 1
  }
  return { avgF: avg(f), avgA: avg(a), mape: n ? +(100 * (sum / n)).toFixed(2) : null, points: n }
})

function buildOption(): Record<string, unknown> {
  const d = current.value
  const c = cache.value[d.key]
  if (!c || !date.value) return { title: { text: '暂无数据', left: 'center', top: 'middle' } }
  const region = d.regionMode === 'province' ? 'yn' : ''
  const mk = d.step ? stepSeries : lineSeries
  const stepExtra = d.step ? { step: 'end' as const } : {} // timePoint=时段起点标签
  const series: Record<string, unknown>[] = []
  const fLabel = d.key === 'user_price' ? '日前(DA)' : '官方预测(D-1)'
  const aLabel = d.key === 'user_price' ? '实时(RT)' : '实际'
  const fSeries = pickSeries(c.forecast, date.value, region)
  const aSeries = pickSeries(c.actual, date.value, region)
  if (fSeries.length) {
    series.push(mk(`${fLabel}·云南`, fSeries, '#e6a23c', {
      ...stepExtra,
      // 官方预测/日前=虚线（图表纪律：预测虚线、实测/出清实线；用户价 DA vs RT 均为出清价则都实线）
      ...(d.key === 'user_price' ? {} : { lineStyle: { width: 2.5, color: '#e6a23c', type: 'dashed' } })
    }))
  }
  if (aSeries.length) series.push(mk(`${aLabel}·云南`, aSeries, '#409eff', stepExtra))
  if (compareAll.value && d.regionMode === 'province') {
    const fAll = pickSeries(c.forecast, date.value, 'all')
    const aAll = pickSeries(c.actual, date.value, 'all')
    if (fAll.length) series.push(mk(`${fLabel}·全区域`, fAll, '#c0c4cc', { ...stepExtra, lineStyle: { width: 1.5, color: '#c0c4cc', type: 'dashed' }, yAxisIndex: 1 }))
    if (aAll.length) series.push(mk(`${aLabel}·全区域`, aAll, '#909399', { ...stepExtra, lineStyle: { width: 1.5, color: '#909399' }, yAxisIndex: 1 }))
  }
  const times = [...new Set([...fSeries, ...aSeries].map((p) => p[0]))].sort()
  return {
    tooltip: axisTooltip({ unit: d.unit, digits: d.step ? 2 : 0 }),
    toolbox: chartToolbox(`云南披露-${d.key}`),
    legend: { top: 0 },
    grid: { left: 64, right: compareAll.value ? 64 : 20, top: 36, bottom: 44 },
    dataZoom: [insideZoom()],
    xAxis: { type: 'category', data: times, boundaryGap: d.step },
    yAxis: [
      { type: 'value', name: `云南 ${d.unit}`, scale: true },
      ...(compareAll.value && d.regionMode === 'province'
        ? [{ type: 'value', name: `全区域 ${d.unit}`, scale: true, splitLine: { show: false } }]
        : [])
    ],
    series
  }
}

watch(datasetKey, () => {
  if (!cache.value[current.value.key]) void loadWindow()
})
onMounted(loadWindow)
</script>

<template>
  <div class="yn-disc-curve">
    <div class="ydc-toolbar">
      <el-select v-model="datasetKey" style="width: 260px">
        <el-option v-for="d in DATASETS" :key="d.key" :label="d.label" :value="d.key" />
      </el-select>
      <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" placeholder="对照日" style="width: 150px" />
      <el-switch v-if="current.regionMode === 'province'" v-model="compareAll" active-text="全区域对照" />
      <DataBasisBadge basis="captured" prefix="南网官方披露" />
      <span v-if="kpi" class="ydc-kpi">
        预测日均 <b>{{ kpi.avgF == null ? '—' : fmtNum(kpi.avgF, 0) }}</b> ·
        实际日均 <b>{{ kpi.avgA == null ? '—' : fmtNum(kpi.avgA, 0) }}</b> ·
        MAPE <b>{{ kpi.mape == null ? '—' : kpi.mape + '%' }}</b>（{{ kpi.points }} 点）
      </span>
    </div>
    <p class="ydc-note">
      官方 D-1 预测 vs 实际（南网披露，真实采集）——度量的是<b>官方预测准确度</b>，非本系统模型输出；
      预测值仅决策参考、非结算依据。取数固定云南（与顶栏地区无关）；窗口为最新披露日前 7 天~次日（切数据集自动加载），更早日期见云南工作台「披露明细」。
    </p>
    <DataState :loading="loading" :error="errorMsg" :empty="empty" empty-text="窗口内无该数据集披露数据（云南严格·真实或空：请确认 import:southern-export --write）">
      <ChartCard :build-option="buildOption" :height="380" fullscreen brush-stats />
    </DataState>
  </div>
</template>

<style scoped>
.yn-disc-curve {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ydc-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.ydc-kpi {
  margin-left: auto;
  font-size: var(--font-12-5);
  color: var(--el-text-color-secondary);
}

.ydc-kpi b {
  color: var(--el-text-color-primary);
  font-variant-numeric: tabular-nums;
}

.ydc-note {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
</style>
