<script setup lang="ts">
// 分时行情 (fshq) — 精修版。两种模式:运行日期(某天按小时) / 交易日期(某交易日@01:00,横轴=各运行日)。
// 主图:日K(opData OHLC)+日前/实时出清及公司/电厂预测折线;副图:成交量(opData[5],红涨绿跌)。
// 底部「滚动值明细」:点击主图某个时间点 → 列出该点及附近时段(±1.5h)的真实数值(出清/价差/开收低高/量/滚动类型)。
//   说明:线上"买卖盘(买1-3量价/卖1-3量价)"走 /sdpt/fshq/dataDet(按点 id),本次仅采集了 /fshq/data,未含 dataDet;
//   故底部改用已采集的逐点滚动值(extendMap 标注日/旬/月滚动 + opData/出清价),买卖盘待补抓(见 今日进度.md)。
import { computed, onMounted, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCaptured } from '@/services/captured'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath, type RegionCapabilityDataSupport } from '@/services/region/regionModules'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilityDegradedCard from '../components/CapabilityDegradedCard.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { usePageInsight } from '../composables/usePageInsight'
import { PAGE_PROMPT_KEYS } from '@/prompts'

const LINES: Record<string, { name: string; color: string }> = {
  rqjycgsList: { name: '日前价公司预测', color: '#ED7D31' },
  rqjycdctjList: { name: '日前价电厂抬价预测', color: '#9b59b6' },
  ssjcqList: { name: '实时价出清', color: '#70AD1F' },
  rqjcqList: { name: '日前价出清', color: '#4472C4' }
}
// 交易日期(rqlx1):按日期直接匹配文件 rqlx1__<date>。其它整点(02:00~24:00)线上有、本次未采集。
const jyBounds = ref<[string, string] | null>(null)
function dateText(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function disabledJyDate(date: Date) {
  if (!jyBounds.value) return false
  const s = dateText(date)
  return s < jyBounds.value[0] || s > jyBounds.value[1]
}

const loading = ref(true)
const error = ref('')
// 支持从 URL 带参跳转(AI 助手/外链):?date=YYYY-MM-DD & mode=rq|jy
const route = useRoute()
const qDate = typeof route.query.date === 'string' ? route.query.date : ''
const qMode = route.query.mode === 'jy' ? 'jy' : 'rq'
const mode = ref<'rq' | 'jy'>(qMode)
const runDate = ref(qDate && qMode === 'rq' ? qDate : '2026-06-01')
const jyDate = ref(qDate && qMode === 'jy' ? qDate : '2026-06-30')
const data = ref<any>(null)
const selectedIdx = ref(-1)
const mainRef = ref<HTMLDivElement | null>(null)
const mainHandle = useEChart(mainRef, { render: renderMain })
const routeCapability = computed(() => getRegionCapabilityForPath('/sjfx/fshq', currentRegion.value.id))
const isRouteDegraded = computed(() => routeCapability.value?.status === 'degraded')
const routeNote = computed(() => routeCapability.value?.route?.note ?? routeCapability.value?.module.dataSupportByRegion[currentRegion.value.id]?.[0]?.note ?? '')
const routeSupports = computed<RegionCapabilityDataSupport[]>(() => {
  const cap = routeCapability.value
  if (!cap) return []
  return cap.route?.dataSupportByRegion?.[currentRegion.value.id]
    ?? cap.module.dataSupportByRegion[currentRegion.value.id]
    ?? []
})
const degradedSupports = computed(() => routeSupports.value.filter((item) => item.expectation !== 'real'))

function updateJyBoundsFromData(d: any) {
  if (mode.value !== 'jy') return
  const out = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string') return
    for (const match of value.matchAll(/\d{4}-\d{2}-\d{2}/g)) out.add(match[0])
  }
  ;(d?.nameList || []).forEach(add)
  ;(d?.markLineList || []).forEach((item: any) => {
    add(item?.name); add(item?.title); add(item?.label)
  })
  Object.values(d?.extendMap || {}).forEach((item: any) => {
    add(item?.title); add(item?.name)
  })
  const dates = [...out].sort()
  if (dates.length) jyBounds.value = [dates[0], dates[dates.length - 1]]
}

async function load() {
  loading.value = true; error.value = ''
  mainHandle.showLoading()
  try {
    if (isRouteDegraded.value) {
      data.value = null
      selectedIdx.value = -1
      bsData = null
      bsStatus.value = 'hint'
      return
    }
    const match = mode.value === 'rq' ? `rqlx0__${runDate.value}` : `rqlx1__${jyDate.value}`
    const res = await fetchCaptured<any>('sdpt_fshq', match)
    data.value = res?.data || {}
    updateJyBoundsFromData(data.value)
    // 默认选「有买卖盘(extendMap 含 id)的点」里实时价最高的,保证下方买卖盘默认有数据
    const ss = data.value.ssjcqList || []
    const em = data.value.extendMap || {}
    let mi = -1, mv = -Infinity
    ss.forEach((v: any, i: number) => { if (v != null && v > mv && em['data_' + i]?.id != null) { mv = v; mi = i } })
    if (mi < 0) { const k = Object.keys(em)[0]; mi = k ? Number(k.slice(5)) : 0 } // 退路:首个有 id 的点
    selectedIdx.value = mi
    await nextTick()
    renderMain()
    loadBuySell(selectedIdx.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
    mainHandle.hideLoading()
  }
}

// ---- 买卖盘(dataDet):点击主图某点 → 下方画该点逐笔 买1-3量价/卖1-3量价/最新价 ----
// dataMap 约定:量 买正(mrl)/卖负(mcl);价 买正(mrj)/卖负(mcj);最新价 zxjg。对齐 nameList(逐笔时间)。
// 按点 id 取文件 dataDet__id<ID>(全量见 scripts/crawl-fshq-datadet.mjs)。配色对照线上。
const bsRef = ref<HTMLDivElement | null>(null)
let bsData: any = null // 最近一次买卖盘数据(主题切换重建时重绘用)
const bsHandle = useEChart(bsRef, { render: () => { if (bsData) renderBuySell(bsData) } })
const bsTitle = ref('')
const bsStatus = ref<'hint' | 'loading' | 'ok' | 'none'>('hint')
const BS_SERIES: { key: string; name: string; color: string; kind: 'bar' | 'line' }[] = [
  { key: 'mrl1', name: '买1量', color: '#4472c4', kind: 'bar' }, { key: 'mrl2', name: '买2量', color: '#ed7d31', kind: 'bar' }, { key: 'mrl3', name: '买3量', color: '#70ad1f', kind: 'bar' },
  { key: 'mcl1', name: '卖1量', color: '#00a2e8', kind: 'bar' }, { key: 'mcl2', name: '卖2量', color: '#8e6fb6', kind: 'bar' }, { key: 'mcl3', name: '卖3量', color: '#b5e61d', kind: 'bar' },
  { key: 'mrj1', name: '买1价', color: '#1f77b4', kind: 'line' }, { key: 'mrj2', name: '买2价', color: '#f4b68c', kind: 'line' }, { key: 'mrj3', name: '买3价', color: '#9bd64a', kind: 'line' },
  { key: 'mcj1', name: '卖1价', color: '#c0504d', kind: 'line' }, { key: 'mcj2', name: '卖2价', color: '#e08e3a', kind: 'line' }, { key: 'mcj3', name: '卖3价', color: '#5aa469', kind: 'line' },
  { key: 'zxjg', name: '最新价', color: '#c23531', kind: 'line' }
]
// 买卖盘 tooltip 单位:量(bar)=MW,价(line)=元/MWh
const BS_UNITS: Record<string, string> = Object.fromEntries(
  BS_SERIES.map((s) => [s.name, s.kind === 'bar' ? 'MW' : '元/MWh'])
)
async function loadBuySell(idx: number) {
  if (isRouteDegraded.value) return
  const em = data.value?.extendMap?.['data_' + idx]
  if (!em?.id) { bsStatus.value = 'none'; bsTitle.value = ''; return }
  bsStatus.value = 'loading'; bsTitle.value = em.title || ''
  try {
    const res = await fetchCaptured<any>('sdpt_fshq', `dataDet__id${em.id}`)
    const d = res?.data
    if (d?.dataMap && Array.isArray(d.nameList) && d.nameList.length) {
      bsStatus.value = 'ok'; bsTitle.value = d.title || em.title || ''
      await nextTick(); renderBuySell(d)
    } else { bsStatus.value = 'none' }
  } catch { bsStatus.value = 'none' }
}
function renderBuySell(d: any) {
  bsData = d
  const cc = chartChrome()
  const x: string[] = d.nameList || []
  const dm = d.dataMap || {}
  const series = BS_SERIES.filter((s) => Array.isArray(dm[s.key])).map((s) => s.kind === 'bar'
    ? { name: s.name, type: 'bar', stack: s.key[2] === 'r' ? '买量' : '卖量', yAxisIndex: 0, barMaxWidth: 7, itemStyle: { color: s.color }, data: dm[s.key] }
    : { name: s.name, type: 'line', step: 'start', yAxisIndex: 1, showSymbol: false, connectNulls: true, lineStyle: { width: s.key === 'zxjg' ? 2.4 : 1, color: s.color }, itemStyle: { color: s.color }, data: dm[s.key] })
  bsHandle.setOption({
    legend: { top: 4, type: 'scroll', textStyle: { fontSize: 11 } },
    tooltip: { ...axisTooltip({ units: BS_UNITS }), confine: true },
    grid: { left: 56, right: 62, top: 40, bottom: 44 },
    xAxis: { type: 'category', data: x, axisLabel: { fontSize: 9, color: cc.axisLabel, interval: Math.max(0, Math.floor(x.length / 12)) } },
    yAxis: [
      { type: 'value', name: '量 MW(买+/卖-)', nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '价 元/MWh(买+/卖-)', nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 8 }],
    series,
    ...emptyOverlay(!x.length)
  }, { notMerge: true })
}

function renderMain() {
  if (!data.value) return
  const cc = chartChrome()
  const d = data.value
  const op: any[] = d.opData || []
  const n = op.length
  const idx = Array.from({ length: n }, (_, i) => String(i))
  const markIdx: Record<number, string> = {}
  ;(d.markLineList || []).forEach((m: any) => { markIdx[m.xAxis] = m.name })
  const kdata = op.map((r) => [r[1], r[2], r[3], r[4]])
  const vol = op.map((r) => ({ value: r[5], itemStyle: { color: (r[2] >= r[1]) ? '#ef5350' : '#26a69a' } }))
  const lineSeries = Object.keys(LINES)
    .filter((k) => Array.isArray(d[k]) && d[k].some((x: any) => x != null))
    .map((k) => ({ name: LINES[k].name, type: 'line', xAxisIndex: 0, yAxisIndex: 0, smooth: false, showSymbol: false, connectNulls: true, sampling: 'lttb', lineStyle: { width: 1.5, color: LINES[k].color }, itemStyle: { color: LINES[k].color }, data: d[k] }))

  mainHandle.setOption({
    // 顶部布局:① 图例靠最顶(top:0)独占第一行;② 工具栏紧跟图例下方(top:26)第二行,在 grid(top:48)上方=绘图区外
    legend: { top: 0, type: 'scroll', left: 8, right: 24, data: ['日K', ...lineSeries.map((s) => s.name)], textStyle: { fontSize: 12 } },
    toolbox: { ...chartToolbox('分时行情'), top: 26 },
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: '#777' } },
    // 日K 系列值为 OHLC 数组,统一单位 formatter 不适用,保留原生 axis tooltip
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, confine: true },
    // grid top:48 让出 图例(0~24) + 工具栏(26~40) 两行;left:60 给纵向 Y 轴 name 留宽度
    grid: [{ left: 60, right: 56, top: 48, height: '52%' }, { left: 60, right: 56, top: '72%', height: '18%' }],
    xAxis: [
      { type: 'category', data: idx, gridIndex: 0, boundaryGap: true, axisLabel: { formatter: (_v: string, i: number) => markIdx[i] || '', interval: 0, fontSize: 10, color: cc.axisLabel }, axisLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'category', data: idx, gridIndex: 1, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: cc.splitLine } } }
    ],
    // Y 轴 name 纵向(nameLocation:middle + nameRotate:90)放在轴左侧中部,不占顶部空间
    yAxis: [
      { scale: true, gridIndex: 0, name: '电价 元/MWh', nameLocation: 'middle', nameGap: 38, nameRotate: 90, nameTextStyle: { color: cc.axisLabel, fontSize: 11 }, axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { scale: true, gridIndex: 1, name: '电量', nameLocation: 'middle', nameGap: 30, nameRotate: 90, nameTextStyle: { color: cc.axisLabel, fontSize: 11 }, axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], height: 16, bottom: 6, labelFormatter: (i: number) => markIdx[Math.round(i)] || '' }],
    series: [
      { name: '日K', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: kdata, itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
        markLine: selectedIdx.value >= 0 ? { silent: true, symbol: 'none', lineStyle: { color: '#ff9800', width: 1.5 }, label: { show: false }, data: [{ xAxis: selectedIdx.value }] } : undefined },
      ...lineSeries,
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vol }
    ],
    ...emptyOverlay(!n)
  }, { notMerge: true })
  const inst = mainHandle.instance()
  inst?.off('click')
  inst?.on('click', (p: any) => { if (p.dataIndex != null) { selectedIdx.value = p.dataIndex; renderMain(); loadBuySell(p.dataIndex) } })
}

const { askPage } = usePageInsight(PAGE_PROMPT_KEYS.marketDataAnalysis)
// 「✨ 解读本页」：当前模式/日期 + 出清价均值极值 + 已有预测线列表作摘要交全局 AI 中心（勿传 96 点全量）。
function askInsight() {
  const d = data.value || {}
  const nums = (a: any[]) => (a || []).filter((v: any) => typeof v === 'number')
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null)
  const range = (a: number[]) => (a.length ? { min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)) } : null)
  const ss = nums(d.ssjcqList)
  const rq = nums(d.rqjcqList)
  askPage('分时行情', {
    page: '分时行情 (fshq)',
    mode: mode.value === 'rq' ? '运行日期·按小时' : '交易日期·各运行日@01:00',
    date: mode.value === 'rq' ? runDate.value : jyDate.value,
    points: (d.opData || []).length,
    realtime_clearing: { avg: avg(ss), range: range(ss), unit: '元/MWh' },
    dayahead_clearing: { avg: avg(rq), range: range(rq), unit: '元/MWh' },
    forecast_lines: Object.keys(LINES).filter((k) => Array.isArray(d[k]) && d[k].some((x: any) => x != null)).map((k) => LINES[k].name),
    basis: 'captured'
  })
}

onMounted(load)
watch([mode, runDate, jyDate], load)

onRegionChange(load)
</script>

<template>
  <div class="fshq" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <CapabilityDegradedCard
      v-if="isRouteDegraded"
      title="分时行情暂未接入当前地区"
      :region-name="currentRegion.name"
      :note="routeNote"
      :supports="degradedSupports"
    />
    <template v-else>
      <div class="toolbar">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="rq">运行日期</el-radio-button>
          <el-radio-button value="jy">交易日期</el-radio-button>
        </el-radio-group>
        <template v-if="mode === 'rq'">
          <el-date-picker v-model="runDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" style="width: 150px" />
        </template>
        <template v-else>
          <el-date-picker v-model="jyDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" :disabled-date="disabledJyDate" style="width: 150px" />
        </template>
        <el-button size="small" type="primary" @click="load">搜索</el-button>
        <el-button size="small" @click="mode = 'rq'; runDate = '2026-06-01'">重置</el-button>
        <span style="flex: 1 1 auto" />
        <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
      </div>

      <div class="card">
        <div class="ctitle">主图 · 日K + 日前/实时出清及预测价{{ mode === 'rq' ? `（${runDate} 按小时,点击查看滚动明细）` : `（交易日期 ${jyDate} · 各运行日@01:00）` }}</div>
        <div ref="mainRef" class="main-chart chart-host"></div>
      </div>
      <div class="card">
        <div class="ctitle">买卖盘逐笔 · {{ bsTitle || '点击上方主图任一时间点查看该点买卖盘' }}
          <span v-if="bsStatus==='ok'" class="hint">（买1-3/卖1-3 量价 + 最新价 ｜ 量:买正卖负 · 价:买正卖负）</span>
          <span v-else-if="bsStatus==='none'" class="hint">（该点暂无买卖盘数据）</span>
        </div>
        <div v-show="bsStatus==='ok'" ref="bsRef" class="bs-chart chart-host"></div>
        <el-empty v-show="bsStatus!=='ok'" :description="bsStatus==='loading' ? '加载中…' : (bsStatus==='none' ? '该点暂无买卖盘数据' : '点击主图上的时间点查看买卖盘逐笔量价')" :image-size="64" />
      </div>
      <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/fshq/data ｜ 模式 ｜ 点击主图点联动下方滚动明细 （线上买卖盘走 /fshq/dataDet 按点 id,本次未采集,待补抓） -->
    </template>
  </div>
</template>

<style scoped>
.fshq { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px 12px; margin-top: 12px; }
.ctitle { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); padding: 2px 0 6px; }
.ctitle .hint { font-weight: 400; color: var(--el-text-color-secondary); font-size: 12px; }
.main-chart { height: 460px; width: 100%; }
.bs-chart { height: 320px; width: 100%; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
.src .note { color: var(--warning); }
.mb { margin-bottom: 12px; }
:deep(.sel-row) { background: var(--warning-tint) !important; font-weight: 600; }
/* 移动端:筛选条纵排 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
}
</style>
