<script setup lang="ts">
// 首页 (console) — 精修版，对照线上四面板布局（左右宽度 2:1，左右等高）：
//   左上（2/3宽）：新能源出力预测，日期范围筛选(限数据范围) + 6类分组柱状(总/风/光 各2) + 4条折线(最高/最低气温·实时/日前均价)，三纵轴(负荷|气温|价格)
//   左下（2/3宽）：交易平台负荷，D-3/D-2/D-1 预测「分组柱状」(异色) + 实际值折线，最近 1 个月
//   右上（1/3宽）：日均价 96 点，价差柱状(±异色) + 日前/实时出清折线，双轴(价格|价差)，上一天/下一天导航(35天变体)
//   右下（1/3宽）：天气网格，城市×日期，天气「图标」(SVG，非文字) + 风力级别 + 最高/最低气温，横竖可滚动
// 数据：GET /sdpt/console/*（capture-raw/sdpt_console/）。均为真实业务/气象数据。
import { onMounted, onBeforeUnmount, ref, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { currentRegion } from '@/services/region/regionContext'
import { apiGet } from '@/services/api'
import { fetchCurrentWeather, fetchDaily15, searchCityByQweather, lookupCityByCoords } from '@/services/weather'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { firstAccessiblePath, roleLabels, subjectTypeLabels } from '@/services/governance'
import { useRoute, useRouter } from 'vue-router'
import { CHINA_PROVINCES } from '../data/chinaCities'
import { defaultRegionId, getRegionById } from '../data/regions'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { debounce } from '../utils/timing'

// embedded=true：嵌入「市场洞察驾驶舱」概览分区时用，隐藏角色欢迎区、去整页 padding/底色，
// 只保留 console-layout 四板块。默认 false 保持 /dashboard/classic 独立页（现已改 redirect）行为不变。
defineProps<{ embedded?: boolean }>()

const loading = ref(true)
const error = ref('')
const neRef = ref<HTMLDivElement | null>(null)
const loadRef = ref<HTMLDivElement | null>(null)
const avgRef = ref<HTMLDivElement | null>(null)
// 三块面板图各一个 handle:生命周期(init/容器resize/主题切换重建/dispose)由 useEChart 托管
const neChart = useEChart(neRef, { render: renderNewEnergyChart })
const loadChart = useEChart(loadRef, { render: renderLoadChart })
const avgChart = useEChart(avgRef, { render: renderAvgPriceChart })
const governanceUser = ref<AuthUser>(getCurrentUser())
const router = useRouter()
const route = useRoute()

// ---- 新能源出力预测 + 日期范围 ----
const neData = ref<any>(null)
const neDateRange = ref<[number, number] | null>(null) // value-format="x" → 时间戳
const neMin = ref('') // 数据可选起始(YYYY-MM-DD)
const neMax = ref('') // 数据可选结束

// ---- 日均价(35 天变体) ----
const avgPriceFiles = ref<any[]>([])
const avgSelectedIndex = ref(0)

// ---- 交易平台负荷:6 类切换 ----
// 线上端点 GET /sdpt/console/getTradingPlatformLoadChart?days=0&type=<key>&areaId=1
// type 与返回 data.type 对应:2=LOAD 负荷 / 2Gy=INDUSTRIAL_LOAD 工业 / 3=NEW_ENERGY 新能源
//   / 5=OUTGOING 外送 / bt=MUST_STOP 必停 / sw=CC_SW 抽蓄水位。
// hash=固定 query 的 sha1 前10位(query 稳定→hash 稳定),用于 fetchCaptured 精确取文件。
const loadType = ref('2')
const loadTypes = [
  { key: '2', label: '负荷', hash: 'd859fbde03' },
  { key: '2Gy', label: '工业负荷', hash: '275c1ef9fa' },
  { key: '3', label: '新能源', hash: '317f0f0bbd' },
  { key: '5', label: '外送', hash: '0b36fa2030' },
  { key: 'bt', label: '必停', hash: '0144aacb91' },
  { key: 'sw', label: '抽蓄水位', hash: '7db3560c48' }
]
const loadCache = ref<Record<string, any>>({}) // type.key -> data


// ---- 天气网格 ----
const weatherCols = ref<{ label: string; prop: string }[]>([])
const weatherData = ref<any[]>([])
const dateProp = ref('')

import { POINTS_96 } from '@/utils/spotPoints96'

const ymd = (t: number | Date) => {
  const d = t instanceof Date ? t : new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const avgCurrentData = computed(() => avgPriceFiles.value[avgSelectedIndex.value]?.data || null)
const avgCurrentDate = computed(() => avgCurrentData.value?.dayTime || '')
const avgCurrentTotal = computed(() => {
  const t = avgCurrentData.value?.diffPriceTotal
  return t == null ? '' : Number(t).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
})

const roleWorkbench = computed(() => buildRoleWorkbench(governanceUser.value))

// 新能源：按选中日期范围裁剪各序列
const neFilteredData = computed(() => {
  if (!neData.value) return null
  const dateList: string[] = neData.value.dateList || []
  if (!neDateRange.value) return neData.value
  const s = ymd(neDateRange.value[0])
  const e = ymd(neDateRange.value[1])
  const startIdx = dateList.findIndex((d) => d >= s)
  let endIdx = dateList.findIndex((d) => d > e)
  if (startIdx === -1) return neData.value
  endIdx = endIdx === -1 ? dateList.length : endIdx
  const slice = (arr: any[]) => (arr || []).slice(startIdx, endIdx)
  return {
    dateList: dateList.slice(startIdx, endIdx),
    corpTotalList: slice(neData.value.corpTotalList),
    yyTotalList: slice(neData.value.yyTotalList),
    corpWindList: slice(neData.value.corpWindList),
    yyWindList: slice(neData.value.yyWindList),
    corpLightList: slice(neData.value.corpLightList),
    yyLightList: slice(neData.value.yyLightList),
    highList: slice(neData.value.highList),
    lowList: slice(neData.value.lowList),
    realTimeAvgPriceList: slice(neData.value.realTimeAvgPriceList),
    dayBeforeAvgPriceList: slice(neData.value.dayBeforeAvgPriceList)
  }
})

function disabledNeDate(date: Date) {
  if (!neMin.value || !neMax.value) return false
  const s = ymd(date)
  return s < neMin.value || s > neMax.value
}

// 切地区/重复刷新期间，旧 Promise 返回不得回写（否则旧地区新能源/负荷串味新地区），参照同文件 wxSeq 范式（#1741）
let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    // 首屏只等新能源 + 6 类负荷(本地 ~10ms);右下角天气网格由 loadProvinceWeather(和风)单独负责,日均价后台异步。
    const [ne, loadAll] = await Promise.all([
      fetchCaptured<any>('sdpt_console', 'getCorpNewEnergyChart'),
      Promise.all(loadTypes.map((t) => fetchCaptured<any>('sdpt_console', t.hash).catch(() => null)))
    ])
    if (seq !== loadSeq) return // 期间切了地区 → 丢弃旧结果

    neData.value = ne.data || {}
    const dl: string[] = neData.value.dateList || []
    if (dl.length) {
      neMin.value = dl[0]
      neMax.value = dl[dl.length - 1]
      // 默认展示首月(约 31 天)，避免范围过长时柱状过密；可在范围内自由调节
      const endIdx = Math.min(30, dl.length - 1)
      neDateRange.value = [new Date(dl[0]).getTime(), new Date(dl[endIdx]).getTime()]
      // 路由 query 里带 neFrom/neTo(YYYY-MM-DD) 时还原选择(限定在数据范围内)
      const qf = route.query.neFrom
      const qt = route.query.neTo
      if (typeof qf === 'string' && typeof qt === 'string' && qf >= neMin.value && qt <= neMax.value && qf <= qt) {
        neDateRange.value = [new Date(qf).getTime(), new Date(qt).getTime()]
      }
    }

    const cache: Record<string, any> = {}
    loadTypes.forEach((t, i) => { if (loadAll[i]?.data) cache[t.key] = loadAll[i].data })
    loadCache.value = cache

    await nextTick()
    renderNewEnergyChart()
    renderLoadChart()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }

  // 日均价:后台先拉 1 天快速出图(秒显),再补全部历史(供"上/下一天"切换),都不卡首屏。
  // 与主 load 同一代次（seq）守卫：期间切地区/重复刷新时，晚归闭包不得把旧地区日均价写回新地区图。
  ;(async () => {
    avgChart.showLoading()
    try {
      const one = await fetchCaptured<any>('sdpt_console', 'getAveragePriceChart')
      if (seq !== loadSeq) return
      if (one?.data) {
        avgPriceFiles.value = [one]
        avgSelectedIndex.value = 0
        await nextTick(); renderAvgPriceChart()
      }
    } catch { /* 快速首图失败不提示,等全量列表兜底 */ }
    if (seq !== loadSeq) return
    try {
      const list = await fetchAvgPriceList()
      if (seq !== loadSeq) return
      if (list.length) {
        avgPriceFiles.value = list
        avgSelectedIndex.value = list.length - 1
        await nextTick(); renderAvgPriceChart()
      }
    } catch { /* fetchAvgPriceList 内部已有单文件回退,至此仍失败则走下方空数据提示 */ }
    if (seq !== loadSeq) return
    avgChart.hideLoading()
    if (!avgPriceFiles.value.length) {
      ElMessage.warning('日均价数据加载失败,可点击右上角刷新重试')
      avgChart.setOption({ ...emptyOverlay(true, '日均价数据加载失败') })
    }
  })()
}

function goWeatherPage(city?: { name?: string; label?: string; lon?: number; lat?: number }) {
  const q: Record<string, string> = {}
  if (city && city.lon != null && city.lat != null) {
    q.name = String(city.name || city.label || ''); q.lon = String(city.lon); q.lat = String(city.lat)
  }
  router.push({ path: '/sjfx/tqyb', query: q })
}
function goWeatherCity(c: any) { goWeatherPage({ name: c.label, lon: c.lon, lat: c.lat }) }
function goProvinceDetail() { goWeatherPage(PROVINCES.find((x) => x.name === province.value)?.cities[0]) }

// 加载全部日均价变体(35 天)，按日期去重 + 升序
async function fetchAvgPriceList() {
  try {
      // region 与同页 fetchCaptured 同口径：清单按地区过滤，避免下一地区图取到上一地区的文件清单
      const listRes = await apiGet<any>('/real-list', { family: 'sdpt_console', region: currentRegion.value.id })
    const files = (listRes.data || []).filter((f: any) => String(f.file).includes('getAveragePriceChart'))
    const results = await Promise.all(
      files.map(async (f: any) => {
        const m = String(f.file).match(/getAveragePriceChart(?:__([0-9a-f]+))?\.json$/)
        const token = m && m[1] ? m[1] : 'getAveragePriceChart.json'
        try {
          return await fetchCaptured<any>('sdpt_console', token)
        } catch {
          return null
        }
      })
    )
    const byDate = new Map<string, any>()
    for (const r of results) {
      const dt = r?.data?.dayTime
      if (dt && !byDate.has(dt)) byDate.set(dt, r)
    }
    return [...byDate.values()].sort((a, b) => (a.data.dayTime < b.data.dayTime ? -1 : 1))
  } catch {
    const single = await fetchCaptured<any>('sdpt_console', 'getAveragePriceChart')
    return single?.data ? [single] : []
  }
}

// ---------- 左上：新能源出力预测 ----------
function renderNewEnergyChart() {
  const n = neFilteredData.value
  if (!n || !neRef.value) return
  const cc = chartChrome()
  const dateList: string[] = n.dateList || []
  const series: any[] = []
  // 6 类出力(总/风/光 各 2)，分组柱状(非堆叠：总≈风+光，堆叠会重复计)，按数据动态显示
  const barDefs: [string, any[], string][] = [
    ['公司-总1', n.corpTotalList, '#fc8452'],
    ['公司-总2', n.yyTotalList, '#fac858'],
    ['公司-风1', n.corpWindList, '#5470c6'],
    ['公司-风2', n.yyWindList, '#73c0de'],
    ['公司-光1', n.corpLightList, '#3ba272'],
    ['公司-光2', n.yyLightList, '#91cc75']
  ]
  for (const [name, data, color] of barDefs) {
    if (data?.some((v: any) => v != null)) {
      series.push({ name, type: 'bar', data, yAxisIndex: 0, barMaxWidth: 16, itemStyle: { color } })
    }
  }
  // 折线：气温(右轴1) + 均价(右轴2)
  const lineDefs: [string, any[], number, string][] = [
    ['最高气温', n.highList, 1, '#9c27b0'],
    ['最低气温', n.lowList, 1, '#ba68c8'],
    ['实时均价', n.realTimeAvgPriceList, 2, '#67c23a'],
    ['日前均价', n.dayBeforeAvgPriceList, 2, '#409eff']
  ]
  for (const [name, data, axis, color] of lineDefs) {
    if (data?.some((v: any) => v != null)) {
      series.push({
        name, type: 'line', yAxisIndex: axis, data, smooth: false,
        showSymbol: dateList.length <= 45, symbolSize: 4,
        lineStyle: { color, width: 2 }, itemStyle: { color }
      })
    }
  }
  neChart.setOption({
    // 三轴三类单位:出力 MW / 气温 ℃ / 均价 元/MWh,按系列名区分
    tooltip: axisTooltip({
      pointer: 'shadow',
      digits: 1,
      unit: 'MW',
      units: { 最高气温: '℃', 最低气温: '℃', 实时均价: '元/MWh', 日前均价: '元/MWh' }
    }),
    toolbox: bottomToolbox('新能源出力预测', 12),
    dataZoom: insideZoom(),
    ...emptyOverlay(!dateList.length),
    legend: bottomLayoutLegend({ itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 12 } }),
    // 不用 containLabel:手动留够左右边距,确保最右"价格"轴(offset 52)不被裁掉
    grid: { left: 70, right: 104, top: 56, bottom: dateList.length > 30 ? 64 : 56 },
    xAxis: {
      type: 'category', data: dateList, boundaryGap: true,
      axisLabel: {
        rotate: dateList.length > 30 ? 45 : 0,
        interval: Math.max(0, Math.floor(dateList.length / 18)),
        fontSize: 10, color: cc.axisLabel
      }
    },
    yAxis: [
      { type: 'value', name: '负荷', min: 0, nameGap: 12, nameTextStyle: { color: cc.axisLabel, align: 'right' },
        axisLabel: { formatter: (v: number) => v.toLocaleString('zh-CN'), color: cc.axisLabel, fontSize: 10 },
        splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '气温', position: 'right', nameGap: 12, nameTextStyle: { color: cc.axisLabel },
        axisLabel: { formatter: '{value}°', color: cc.axisLabel, fontSize: 10 }, splitLine: { show: false } },
      { type: 'value', name: '价格', position: 'right', offset: 56, nameGap: 12, nameTextStyle: { color: cc.axisLabel, align: 'left' },
        axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { show: false } }
    ],
    series
  }, true)
}

function selectLoadType(key: string) {
  loadType.value = key
  renderLoadChart()
}

// ---------- 左下：交易平台负荷(6 类切换,逻辑对照线上 TradingPlatformLoadChart 组件) ----------
// 负荷/工业/新能源/外送(默认型):d-3/d-2/d-1 柱 + 实际值线
// 必停(MUST_STOP):d-3/d-2/d-1 柱 + 在线容量副轴(实际/预测在线容量线) + 日前新能源出力总均值线，无实际值
// 抽蓄水位(CC_SW):仅 上库上限/下限/水位 三条线，无柱
function renderLoadChart() {
  const d = loadCache.value[loadType.value]
  if (!d || !loadRef.value) return
  const cc = chartChrome()
  const t = d.type
  const dateList: string[] = d.dateList || []
  const bar = (name: string) => ({ name, type: 'bar', barMaxWidth: 9 })
  // 旬分界竖线(每月 01/11/21) + 今日竖线标记(对照线上 markLine/markPoint)
  const markLineData: any[] = []
  dateList.forEach((w, g) => {
    const dd = String(w).split('-')[1]
    if (dd === '01' || dd === '11' || dd === '21') markLineData.push({ xAxis: g })
  })
  const now = new Date()
  const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayIdx = dateList.indexOf(todayMD)
  if (todayIdx >= 0) markLineData.push({ xAxis: todayIdx, lineStyle: { color: cc.danger, type: 'solid', width: 1.5 }, label: { formatter: '今日', color: cc.danger, fontSize: 10 } })
  const markLine = { silent: true, symbol: 'none', lineStyle: { color: cc.neutralLine, type: 'dashed', width: 1 }, label: { show: false }, data: markLineData }

  const numFmt = (v: number) => (v == null ? '' : Number(v).toLocaleString('zh-CN'))
  let yAxis: any[]
  let series: any[]
  let legend: string[]

  if (t === 'MUST_STOP') {
    yAxis = [
      { type: 'value', min: 0, max: d.yaxisMax, interval: d.yaxisMin || undefined,
        axisLabel: { formatter: numFmt, color: cc.axisLabel, fontSize: 10 }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '在线容量', min: 26000, max: 54000, interval: 2800, position: 'right',
        nameTextStyle: { color: cc.axisLabel }, axisLabel: { formatter: numFmt, color: cc.axisLabel, fontSize: 10 }, splitLine: { show: false } }
    ]
    series = [
      { ...bar('d-3预测值'), data: d.d3List },
      { ...bar('d-2预测值'), data: d.d2List, markLine },
      { ...bar('d-1预测值'), data: d.d1List },
      { name: '实际在线容量', type: 'line', yAxisIndex: 1, showSymbol: false, data: d.actualOnlineCapList },
      { name: '预测在线容量', type: 'line', yAxisIndex: 1, showSymbol: false, lineStyle: { type: 'dashed', width: 2 }, data: d.forecastOnlineCapList },
      { name: '日前新能源出力总均值', type: 'line', yAxisIndex: 0, showSymbol: false, lineStyle: { type: 'dashed', width: 2 }, data: d.xnyZclList }
    ]
    legend = ['d-3预测值', 'd-2预测值', 'd-1预测值', '实际在线容量', '预测在线容量', '日前新能源出力总均值']
  } else if (t === 'CC_SW') {
    const allv = [...(d.sxzList || []), ...(d.xxzList || []), ...(d.szzList || [])].filter((x) => x != null) as number[]
    const ymin = allv.length ? Math.floor((Math.min(...allv) - 10) / 10) * 10 : 0
    yAxis = [
      { type: 'value', name: '水位', min: ymin <= 0 ? 0 : ymin, scale: true,
        nameTextStyle: { color: cc.axisLabel }, axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { lineStyle: { color: cc.splitLine } } }
    ]
    series = [
      { name: '上库上限值', type: 'line', showSymbol: false, markLine, data: d.sxzList },
      { name: '上库下限值', type: 'line', showSymbol: false, data: d.xxzList },
      { name: '上库水位值', type: 'line', showSymbol: false, lineStyle: { width: 2.5 }, data: d.szzList }
    ]
    legend = ['上库上限值', '上库下限值', '上库水位值']
  } else {
    // LOAD / INDUSTRIAL_LOAD / NEW_ENERGY / OUTGOING
    yAxis = [
      { type: 'value', min: 0, max: d.yaxisMax, interval: d.yaxisMin || undefined,
        axisLabel: { formatter: numFmt, color: cc.axisLabel, fontSize: 10 }, splitLine: { lineStyle: { color: cc.splitLine } } }
    ]
    series = [
      { ...bar('d-3预测值'), data: d.d3List },
      { ...bar('d-2预测值'), data: d.d2List, markLine },
      { ...bar('d-1预测值'), data: d.d1List },
      { name: '实际值', type: 'line', showSymbol: false, lineStyle: { width: 2.2 }, data: d.actualValueList, z: 10 }
    ]
    legend = ['d-3预测值', 'd-2预测值', 'd-1预测值', '实际值']
  }

  loadChart.setOption({
    color: ['#ed7d31', '#70ad1f', '#3399ff', '#a349a4', '#a349a4'],
    // 抽蓄水位单位为米,其余类别均为 MW
    tooltip: axisTooltip({ unit: t === 'CC_SW' ? '米' : 'MW', digits: 1 }),
    toolbox: bottomToolbox('交易平台负荷', 8),
    dataZoom: insideZoom(),
    ...emptyOverlay(!dateList.length),
    legend: bottomLayoutLegend({ itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 }, data: legend }),
    // 必停模式多轴 name 需更大 top
    grid: { left: 8, right: t === 'MUST_STOP' ? 12 : 8, top: t === 'MUST_STOP' ? 56 : 48, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: dateList, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 'auto' } },
    yAxis,
    series
  }, true)
}

// ---------- 右上：日均价 96 点 ----------
function renderAvgPriceChart() {
  const a = avgCurrentData.value
  if (!a || !avgRef.value) return
  const cc = chartChrome()
  avgChart.setOption({
    tooltip: axisTooltip({ unit: '元/MWh' }),
    toolbox: bottomToolbox('日均价96点', 26),
    dataZoom: insideZoom(),
    legend: bottomLayoutLegend({ itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 12 }, data: ['日前出清', '实时出清', '价差'] }),
    grid: { left: 8, right: 8, top: 56, bottom: 56, containLabel: true },
    xAxis: {
      type: 'category', data: POINTS_96, boundaryGap: true,
      axisLabel: {
        fontSize: 10, color: cc.axisLabel, interval: 0,
        // 每 4 小时一个刻度：0:15 / 4:15 / 8:15 / 12:15 / 16:15 / 20:15 / 次日 0:15
        formatter: (val: string, i: number) => (i % 16 === 0 ? val : i === 95 ? '00:15' : '')
      }
    },
    yAxis: [
      { type: 'value', name: '价格', position: 'left',
        min: a.minPrice ?? null, max: a.maxPrice ?? null,
        nameTextStyle: { color: cc.axisLabel },
        axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '价差', position: 'right',
        min: a.minDiffPrice ?? null, max: a.maxDiffPrice ?? null,
        nameTextStyle: { color: cc.axisLabel },
        axisLabel: { color: cc.axisLabel, fontSize: 10 }, splitLine: { show: false } }
    ],
    series: [
      { name: '日前出清', type: 'line', step: 'start', yAxisIndex: 0, showSymbol: false,
        data: a.dayAheadPriceList, lineStyle: { color: '#409eff', width: 2 }, itemStyle: { color: '#409eff' } },
      { name: '实时出清', type: 'line', step: 'start', yAxisIndex: 0, showSymbol: false,
        data: a.realTimePriceList, lineStyle: { color: '#67c23a', width: 2 }, itemStyle: { color: '#67c23a' } },
      { name: '价差', type: 'bar', yAxisIndex: 1, data: a.diffPriceList, barMaxWidth: 4,
        itemStyle: { color: (p: any) => (p.value >= 0 ? cc.danger : '#3ba776') } }
    ]
  }, true)
}

function onDateRangeChange() {
  renderNewEnergyChart()
  // 日期范围写回路由 query,刷新/分享后还原
  if (neDateRange.value) {
    router.replace({ query: { ...route.query, neFrom: ymd(neDateRange.value[0]), neTo: ymd(neDateRange.value[1]) } }).catch(() => {})
  }
}

function prevDay() {
  if (avgSelectedIndex.value > 0) { avgSelectedIndex.value--; renderAvgPriceChart() }
}
function nextDay() {
  if (avgSelectedIndex.value < avgPriceFiles.value.length - 1) { avgSelectedIndex.value++; renderAvgPriceChart() }
}

// ---------- 天气图标(SVG，按天气文本归类) ----------
function weatherCat(text: string): string {
  const t = text || ''
  if (t.includes('雷')) return 'thunder'
  if (t.includes('雪')) return 'snow'
  if (t.includes('雾') || t.includes('霾')) return 'fog'
  if (t.includes('阵雨')) return 'shower'
  if (t.includes('大雨') || t.includes('暴雨') || t.includes('中雨')) return 'rain'
  if (t.includes('雨')) return 'lightrain'
  if (t.includes('阴')) return 'overcast'
  if (t.includes('晴间多云')) return 'mostlysunny'
  if (t.includes('多云') || t.includes('少云')) return 'cloudy'
  if (t.includes('晴')) return 'sunny'
  return 'overcast'
}
// 云朵基形：可平移以适配不同图标布局
const cloud = (fill: string, dy = 0) =>
  `<g fill="${fill}" transform="translate(0 ${dy})"><circle cx="8" cy="13" r="4.1"/><circle cx="13.5" cy="11.5" r="5.2"/><circle cx="17.5" cy="13.5" r="3.8"/><rect x="5.5" y="12.5" width="14" height="6" rx="3"/></g>`
const WEATHER_SVG: Record<string, string> = {
  sunny: `<circle cx="12" cy="12" r="5" fill="#FFB300"/><g stroke="#FFB300" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1"/></g>`,
  mostlysunny: `<circle cx="8" cy="8" r="3.6" fill="#FFB300"/><g stroke="#FFB300" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.6v1.8M1.6 8H0M3 3l1.1 1.1M13 3l-1.1 1.1"/></g>${cloud('#B0BEC5', 3)}`,
  cloudy: `<circle cx="8" cy="8" r="3.6" fill="#FFB300"/>${cloud('#90A4AE', 2)}`,
  overcast: cloud('#78909C', 0),
  shower: `<circle cx="7" cy="7" r="3" fill="#FFB300"/>${cloud('#90A4AE', -2)}<g stroke="#42A5F5" stroke-width="1.8" stroke-linecap="round"><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/></g>`,
  lightrain: `${cloud('#90A4AE', -3)}<g stroke="#42A5F5" stroke-width="1.8" stroke-linecap="round"><path d="M10 17l-1 2.6M15 17l-1 2.6"/></g>`,
  rain: `${cloud('#78909C', -3.5)}<g stroke="#1E88E5" stroke-width="2" stroke-linecap="round"><path d="M8.5 16l-1.4 3.4M13 16l-1.4 3.4M17.5 16l-1.4 3.4"/></g>`,
  snow: `${cloud('#90A4AE', -3.5)}<g fill="#4FC3F7"><circle cx="9" cy="18" r="1.1"/><circle cx="13" cy="20" r="1.1"/><circle cx="16" cy="18" r="1.1"/></g>`,
  thunder: `${cloud('#78909C', -3.5)}<path d="M12 15l-3 4h2.2l-1.2 4 4-5h-2.4l1.4-3z" fill="#FFC107"/>`,
  fog: `${cloud('#B0BEC5', -4.5)}<g stroke="#90A4AE" stroke-width="1.6" stroke-linecap="round"><path d="M5 17h14M7 20h12"/></g>`
}
function weatherSvg(text: string): string {
  return `<svg viewBox="0 0 24 24" class="wx-svg">${WEATHER_SVG[weatherCat(text)] || WEATHER_SVG.overcast}</svg>`
}

// ---------- 首页「当前天气」挂件:实时 Open-Meteo,与「天气预报」页同源(默认当前地区省会) ----------
// 之前是写死的「21°+太阳」装饰;现接实时,使首页当天天气与天气预报页一致。WMO码→中文→复用上方 weatherSvg。
// 首页「当前天气」:可换全国城市 + 浏览器定位;实时 Open-Meteo(3.5s 超时降级,失败则隐藏温度)
type WxLoc = { name: string; lat: number; lon: number; admin1?: string }
type PCity = { name: string; lon: number; lat: number }
const PROVINCES: { name: string; cities: PCity[] }[] = CHINA_PROVINCES
function provinceNameForRegion(regionId = currentRegion.value.id) {
  const shortName = getRegionById(regionId).shortName
  if (PROVINCES.some((p) => p.name === shortName)) return shortName
  const defaultShortName = getRegionById(defaultRegionId).shortName
  return PROVINCES.some((p) => p.name === defaultShortName) ? defaultShortName : PROVINCES[0]?.name ?? shortName
}
function cityToWxLoc(city: PCity, provinceName: string): WxLoc {
  return { name: city.name, lat: city.lat, lon: city.lon, admin1: provinceName }
}
function defaultRegionWxLoc() {
  const provinceName = provinceNameForRegion()
  const city = PROVINCES.find((p) => p.name === provinceName)?.cities[0]
  const fallbackProvince = PROVINCES[0]
  const fallbackCity = fallbackProvince?.cities[0]
  return city
    ? cityToWxLoc(city, provinceName)
    : fallbackProvince && fallbackCity
      ? cityToWxLoc(fallbackCity, fallbackProvince.name)
      : { name: provinceName, lat: 0, lon: 0, admin1: provinceName }
}
const WX_HOT: WxLoc[] = [
  defaultRegionWxLoc(), { name: '北京', lat: 39.90, lon: 116.41, admin1: '北京' },
  { name: '上海', lat: 31.23, lon: 121.47, admin1: '上海' }, { name: '广州', lat: 23.13, lon: 113.26, admin1: '广东' },
  { name: '深圳', lat: 22.54, lon: 114.06, admin1: '广东' }, { name: '杭州', lat: 30.27, lon: 120.16, admin1: '浙江' },
  { name: '成都', lat: 30.57, lon: 104.07, admin1: '四川' }, { name: '武汉', lat: 30.59, lon: 114.30, admin1: '湖北' },
  { name: '西安', lat: 34.26, lon: 108.95, admin1: '陕西' }, { name: '南京', lat: 32.06, lon: 118.80, admin1: '江苏' },
  { name: '重庆', lat: 29.56, lon: 106.55, admin1: '重庆' }, { name: '天津', lat: 39.13, lon: 117.20, admin1: '天津' }
]
const WX_LS = 'dljy_home_wx_loc'
const wxLoc = ref<WxLoc>((() => { try { const r = localStorage.getItem(WX_LS); if (r) return JSON.parse(r) as WxLoc } catch { /* ignore */ } return defaultRegionWxLoc() })())
const wxLocating = ref(false)
const wxQuery = ref('')
const wxOptions = ref<WxLoc[]>([])
const wxSearching = ref(false)
const live = ref<{ temp: number; text: string } | null>(null)
const liveName = computed(() => live.value?.text || '')
// 实时天气:和风优先,失败回退 Open-Meteo(回退链路与码表在 services/weather)
async function loadLiveWeather() {
  live.value = await fetchCurrentWeather(wxLoc.value.lat, wxLoc.value.lon)
}
// 右下角天气栏:保留原「多城市×日期网格」,支持换省份;数据走和风 15d(失败回退 Open-Meteo)
const province = ref(provinceNameForRegion())
// 主筛选 ⇄ 路由 query:刷新/分享后还原负荷类别与天气省份(新能源日期范围在 load() 内还原)
useQuerySync({ loadType, province })
if (!loadTypes.some((t) => t.key === loadType.value)) loadType.value = '2'
if (!CHINA_PROVINCES.some((p) => p.name === province.value)) province.value = provinceNameForRegion()
async function oneCity15d(city: PCity): Promise<any[]> {
  return fetchDaily15(city.lat, city.lon)
}
// 天气网格缓存:内存 + localStorage(1 小时 TTL)。打开页面优先读本地,过期才重新拉。
const _provCache: Record<string, { cols: any[]; rows: any[] }> = {}
const WX_CACHE_KEY = 'dljy_wx_grid_cache_v1'
const WX_TTL = 3600_000 // 1 小时
function wxCacheGet(name: string): { cols: any[]; rows: any[] } | null {
  try {
    const all = JSON.parse(localStorage.getItem(WX_CACHE_KEY) || '{}')
    const c = all[name]
    if (c && Date.now() - c.ts < WX_TTL && c.rows?.length) return { cols: c.cols, rows: c.rows }
  } catch { /* ignore */ }
  return null
}
function wxCacheSet(name: string, cols: any[], rows: any[]) {
  try {
    const all = JSON.parse(localStorage.getItem(WX_CACHE_KEY) || '{}')
    all[name] = { ts: Date.now(), cols, rows }
    localStorage.setItem(WX_CACHE_KEY, JSON.stringify(all))
  } catch { try { localStorage.removeItem(WX_CACHE_KEY) } catch { /* 超额则清空 */ } }
}
function buildGrid(cities: PCity[], grids: any[][]) {
  const base = grids.find((g) => g.length) || []
  return base.map((d0: any, di: number) => {
    const row: any = { date: d0.fxDate }
    cities.forEach((c, ci) => { const d = grids[ci][di]; if (d) row[c.name] = d })
    return row
  })
}
// 拉一个省(silent=true 只写缓存,不动 UI)
async function fetchProvinceGrid(name: string, silent: boolean) {
  const p = PROVINCES.find((x) => x.name === name)
  if (!p) return
  const cols = p.cities.map((c) => ({ label: c.name, prop: c.name, lon: c.lon, lat: c.lat }))
  if (!silent) { weatherCols.value = cols; dateProp.value = 'date'; weatherData.value = [] }
  const grids: any[][] = p.cities.map(() => [])
  await Promise.all(p.cities.map(async (c, ci) => {
    grids[ci] = await oneCity15d(c)
    if (!silent && province.value === name) weatherData.value = buildGrid(p.cities, grids) // 渐进
  }))
  const rows = buildGrid(p.cities, grids)
  _provCache[name] = { cols, rows }
  wxCacheSet(name, cols, rows)
  if (!silent && province.value === name) { weatherCols.value = cols; weatherData.value = rows }
}
async function loadProvinceWeather() {
  const name = province.value
  const cached = _provCache[name] || wxCacheGet(name)
  if (cached) { weatherCols.value = cached.cols; weatherData.value = cached.rows; dateProp.value = 'date'; _provCache[name] = cached; return }
  await fetchProvinceGrid(name, false)
}
function syncWeatherToRegion() {
  const nextProvince = provinceNameForRegion()
  let provinceChanged = false
  let locChanged = false
  if (province.value !== nextProvince) {
    province.value = nextProvince
    provinceChanged = true
  }
  const nextLoc = defaultRegionWxLoc()
  if (wxLoc.value.admin1 !== nextProvince) {
    wxLoc.value = nextLoc
    try { localStorage.setItem(WX_LS, JSON.stringify(wxLoc.value)) } catch { /* ignore */ }
    locChanged = true
  }
  return { provinceChanged, locChanged }
}
function pickWxLoc(l: WxLoc) {
  wxLoc.value = { ...l }
  try { localStorage.setItem(WX_LS, JSON.stringify(wxLoc.value)) } catch { /* ignore */ }
  wxOptions.value = []; wxQuery.value = ''
  loadLiveWeather()
}
let wxSeq = 0
async function doSearchWxCity() {
  const kw = wxQuery.value.trim()
  if (!kw) { wxOptions.value = []; return }
  const seq = ++wxSeq; wxSearching.value = true
  try {
    const found = await searchCityByQweather(kw)
    if (seq !== wxSeq) return
    wxOptions.value = found
  } catch { if (seq === wxSeq) wxOptions.value = [] } finally { if (seq === wxSeq) wxSearching.value = false }
}
// 输入即搜防抖 300ms:避免每个按键都打城市检索接口(wxSeq 竞态保护仍保留)
const searchWxCity = debounce(doSearchWxCity, 300)
function locateWx() {
  if (!navigator.geolocation) return
  wxLocating.value = true
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude
      let name = '我的位置', admin1 = ''
      const hit = await lookupCityByCoords(lon, lat)
      if (hit) { name = hit.name || name; admin1 = hit.admin1 || '' }
      pickWxLoc({ name, lat, lon, admin1 }); wxLocating.value = false
    },
    () => { wxLocating.value = false },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  )
}
function fmtTemp(cell: any): string {
  if (!cell) return '-'
  const hi = cell.high ?? '-'
  const lo = cell.low ?? '-'
  return `${Math.round(Number(hi))}/${Math.round(Number(lo))}`
}
function fmtDay(v: any): string {
  if (v == null) return ''
  const s = String(v)
  return s.length > 2 ? s.slice(5, 10) : s
}

function onGovernanceUserChanged(event: Event) {
  const detail = (event as CustomEvent<AuthUser>).detail
  governanceUser.value = detail ?? getCurrentUser()
}

// 图表 resize/dispose 与主题切换重渲染均由 useEChart 托管
onMounted(() => {
  syncWeatherToRegion()
  load()
  loadLiveWeather()
  loadProvinceWeather() // 仅按需加载当前省份(带 1 小时 localStorage 缓存);不再全国预热,避免打满和风配额(P2)
  window.addEventListener('governance-user-changed', onGovernanceUserChanged)
})
onBeforeUnmount(() => {
  searchWxCity.cancel()
  window.removeEventListener('governance-user-changed', onGovernanceUserChanged)
})

function buildRoleWorkbench(user: AuthUser) {
  const common = {
    defaultRoute: firstAccessiblePath(user),
    subject: `${subjectTypeLabels[user.subjectType]} · ${user.subjectName}`,
    dataScope: user.area === '当前地区' ? '随当前地区切换' : user.area
  }

  const map = {
    BOSS: {
      title: '经营与重大审批',
      summary: '关注全区域收益、风险敞口、重大交易审批和结算复盘。',
      cards: [
        { label: '待审批交易', value: '6', unit: '项', tone: 'orange' },
        { label: '高风险敞口', value: '2', unit: '项', tone: 'red' },
        { label: '预计月度收益', value: '128.6', unit: '万元', tone: 'green' }
      ],
      tasks: ['复核超风险交易计划', '查看区域收益排行', '确认月度结算差异']
    },
    TRADE_LEAD: {
      title: '交易计划与执行统筹',
      summary: '关注策略池、交易员提交、执行进度和限额内审批。',
      cards: [
        { label: '申报草稿', value: '12', unit: '单', tone: 'blue' },
        { label: '待执行切片', value: '18', unit: '段', tone: 'green' },
        { label: '超限待审', value: '3', unit: '项', tone: 'orange' }
      ],
      tasks: ['审批今日策略计划', '检查 TWAP 执行偏差', '同步风控限额']
    },
    TRADER: {
      title: '今日交易任务',
      summary: '关注日前电量预估、交易策略建议、申报草稿和执行回填。',
      cards: [
        { label: '可交易窗口', value: '4', unit: '个', tone: 'green' },
        { label: '建议仓位', value: '18.4', unit: '%', tone: 'blue' },
        { label: '待回填成交', value: '5', unit: '笔', tone: 'orange' }
      ],
      tasks: ['更新日前申报曲线', '运行交易策略实验室', '回填实时成交结果']
    },
    RISK: {
      title: '风险限额与拦截',
      summary: '关注 CVaR、回撤、仓位分布、超限交易和压力测试。',
      cards: [
        { label: 'CVaR95', value: '7.2', unit: '万元', tone: 'orange' },
        { label: '仓位利用', value: '62', unit: '%', tone: 'blue' },
        { label: '未处理预警', value: '4', unit: '条', tone: 'red' }
      ],
      tasks: ['复核高风险策略', '调整单主体风险限额', '检查执行偏差预警']
    },
    QUANT: {
      title: '模型与策略研究',
      summary: '关注预测误差、因子表现、策略草稿和回测结果。',
      cards: [
        { label: '模型任务', value: '7', unit: '个', tone: 'blue' },
        { label: '策略草稿', value: '9', unit: '条', tone: 'green' },
        { label: '误差告警', value: '2', unit: '项', tone: 'orange' }
      ],
      tasks: ['评估电价预测偏差', '更新 Kelly 胜率参数', '提交策略草稿给交易员']
    },
    SETTLEMENT: {
      title: '结算与对账',
      summary: '关注结算导入、偏差考核、对账差异和月度复盘。',
      cards: [
        { label: '待导入文件', value: '5', unit: '份', tone: 'blue' },
        { label: '对账差异', value: '3', unit: '项', tone: 'orange' },
        { label: '已复核结算', value: '86', unit: '%', tone: 'green' }
      ],
      tasks: ['上传售电结算文件', '复核偏差考核明细', '生成月度结算报告']
    },
    PLANT_OPERATOR: {
      title: '发电侧运营',
      summary: '关注机组出力、报价曲线、发电收益和合同敞口。',
      cards: [
        { label: '可用容量', value: '420', unit: 'MW', tone: 'green' },
        { label: '报价窗口', value: '6', unit: '段', tone: 'blue' },
        { label: '检修影响', value: '1', unit: '项', tone: 'orange' }
      ],
      tasks: ['检查新能源出力预测', '更新发电侧报价策略', '复核机组收益归因']
    },
    RETAIL_MANAGER: {
      title: '售电经营',
      summary: '关注客户负荷、购售电价差、套餐利润和零售结算。',
      cards: [
        { label: '客户负荷预测', value: '96.2', unit: '%', tone: 'green' },
        { label: '套餐毛利', value: '23.4', unit: '万元', tone: 'blue' },
        { label: '偏差风险客户', value: '8', unit: '户', tone: 'orange' }
      ],
      tasks: ['测算售电套餐价格', '检查客户负荷偏差', '导入零售结算文件']
    },
    STORAGE_OPERATOR: {
      title: '储能套利与执行',
      summary: '关注价差窗口、SOC、循环收益、TWAP 切片和风险限额。',
      cards: [
        { label: '峰谷价差', value: '238', unit: '元/MWh', tone: 'green' },
        { label: 'SOC安全余量', value: '31', unit: '%', tone: 'blue' },
        { label: '待执行切片', value: '10', unit: '段', tone: 'orange' }
      ],
      tasks: ['运行储能策略实验室', '确认充放电执行计划', '复核循环损耗收益']
    },
    ADMIN: {
      title: '系统治理',
      summary: '关注账号、角色、数据域、菜单权限和系统健康。',
      cards: [
        { label: '角色模板', value: '10', unit: '类', tone: 'blue' },
        { label: '数据域', value: '6', unit: '组', tone: 'green' },
        { label: '待配置权限', value: '4', unit: '项', tone: 'orange' }
      ],
      tasks: ['检查角色菜单规则', '维护区域数据域', '准备后端 IAM 接口']
    }
  } as const

  return {
    ...common,
    role: roleLabels[user.roleCode],
    ...(map[user.roleCode] ?? map.TRADER)
  }
}

onRegionChange(() => {
  const changed = syncWeatherToRegion()
  if (changed.locChanged) void loadLiveWeather()
  if (changed.provinceChanged) void loadProvinceWeather()
  void load()
})
</script>

<template>
  <div class="home" :class="{ embedded }" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />

    <section v-if="!embedded" class="role-workbench">
      <div class="role-copy">
        <div class="role-meta">
          <el-tag size="small" type="primary">{{ roleWorkbench.role }}</el-tag>
          <span>{{ roleWorkbench.subject }}</span>
          <span>数据范围：{{ roleWorkbench.dataScope }}</span>
        </div>
        <h2>{{ roleWorkbench.title }}</h2>
        <p>{{ roleWorkbench.summary }}</p>
      </div>
      <div class="role-card-row">
        <article v-for="card in roleWorkbench.cards" :key="card.label" :class="['role-card', card.tone]">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}<small>{{ card.unit }}</small></strong>
        </article>
      </div>
      <div class="role-task-list">
        <span v-for="task in roleWorkbench.tasks" :key="task">{{ task }}</span>
      </div>
    </section>

    <div class="console-layout">
      <!-- 左侧（2/3）：上下两栏 -->
      <div class="col left">
        <!-- 左上：新能源出力预测 -->
        <section class="panel panel-ne">
          <header class="phead phead--chart">
            <span class="ptitle">新能源出力预测</span>
            <div class="ne-tools">
              <el-date-picker
                v-model="neDateRange"
                type="daterange"
                value-format="x"
                unlink-panels
                range-separator="~"
                start-placeholder="开始"
                end-placeholder="结束"
                size="small"
                :clearable="false"
                :disabled-date="disabledNeDate"
                @change="onDateRangeChange"
                class="ne-date"
              />
              <!-- 当前天气:点击可换全国城市 / 📍定位(实时 Open-Meteo,3.5s 超时降级) -->
              <el-popover placement="bottom-end" :width="248" trigger="click">
                <template #reference>
                  <span class="wx-chip clickable" :title="`${wxLoc.name} ${liveName}`">
                    <span class="wx-chip-svg" v-html="weatherSvg(liveName)"></span>
                    <em v-if="live">{{ live.temp }}°</em>
                    <small class="wx-city">{{ wxLoc.name }} ▾</small>
                  </span>
                </template>
                <div class="wx-pop">
                  <div class="wx-pop-top">
                    <el-input v-model="wxQuery" size="small" placeholder="搜全国城市" clearable @input="searchWxCity" />
                    <el-button size="small" :loading="wxLocating" @click="locateWx">📍</el-button>
                  </div>
                  <div class="wx-pop-list">
                    <span
                      v-for="(c, i) in (wxOptions.length ? wxOptions : WX_HOT)" :key="i"
                      class="wx-pop-c" :class="{ on: c.name === wxLoc.name }"
                      @click="pickWxLoc(c)"
                    >{{ c.name }}</span>
                  </div>
                  <div class="wx-pop-foot">
                    <a class="wx-detail" @click="goWeatherPage(wxLoc)">查看 15 天详细预报 →</a>
                  </div>
                </div>
              </el-popover>
            </div>
          </header>
          <div ref="neRef" class="chart chart-ne chart-host"></div>
        </section>

        <!-- 左下：交易平台负荷 -->
        <section class="panel panel-load">
          <header class="phead phead--chart">
            <span class="ptitle">交易平台负荷</span>
            <span class="load-tabs">
              <!-- 6 类切换:负荷/工业负荷/新能源/外送/必停/抽蓄水位,均有真实数据 -->
              <a
                v-for="t in loadTypes"
                :key="t.key"
                class="load-tab"
                :class="{ active: t.key === loadType }"
                @click="selectLoadType(t.key)"
              >{{ t.label }}</a>
            </span>
          </header>
          <div ref="loadRef" class="chart chart-load chart-host"></div>
        </section>
      </div>

      <!-- 右侧（1/3）：上下两栏 -->
      <div class="col right">
        <!-- 右上：日均价 -->
        <section class="panel panel-avg">
          <header class="phead phead--chart">
            <span class="ptitle">
              {{ avgCurrentDate }}日均价
              <em v-if="avgCurrentTotal" class="total">（{{ avgCurrentTotal }}）</em>
            </span>
            <span class="daynav">
              <el-button text type="primary" size="small" :disabled="avgSelectedIndex <= 0" @click="prevDay">上一天</el-button>
              <el-button text type="primary" size="small" :disabled="avgSelectedIndex >= avgPriceFiles.length - 1" @click="nextDay">下一天</el-button>
            </span>
          </header>
          <div ref="avgRef" class="chart chart-avg chart-host"></div>
        </section>

        <!-- 右下：天气预报(原多城市×日期网格,支持换省份 + 跳详情;和风优先 + Open-Meteo 回退)-->
        <section class="panel panel-weather">
          <header class="phead">
            <span class="ptitle">天气预报</span>
            <span class="wx-head-right">
              <el-select v-model="province" size="small" style="width: 84px" @change="loadProvinceWeather">
                <el-option v-for="p in PROVINCES" :key="p.name" :label="p.name" :value="p.name" />
              </el-select>
              <a class="wx-detail2" @click="goProvinceDetail">详情 →</a>
            </span>
          </header>
          <div class="wx-wrap">
            <table class="wx-table">
              <thead>
                <tr>
                  <th class="wx-date-h">日期</th>
                  <th v-for="c in weatherCols" :key="c.prop" class="wx-city-th" title="点击看该市详细预报" @click="goWeatherCity(c)">{{ c.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in weatherData" :key="ri">
                  <td class="wx-date">{{ fmtDay(row[dateProp]) }}</td>
                  <td v-for="c in weatherCols" :key="c.prop" class="wx-cell">
                    <template v-if="row[c.prop]">
                      <span class="wx-icon" v-html="weatherSvg(row[c.prop].textDay)"></span>
                      <span class="wx-temp">{{ fmtTemp(row[c.prop]) }}</span>
                      <span v-if="row[c.prop].humidity != null" class="wx-hum">湿 {{ row[c.prop].humidity }}%</span>
                    </template>
                    <span v-else class="wx-empty">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/console/* · capture-raw/sdpt_console/ -->
  </div>
</template>

<style scoped>
.home { padding: 16px 20px; background: var(--el-fill-color-light); }
.home.embedded { padding: 0; background: transparent; }
.role-workbench {
  display: grid;
  grid-template-columns: minmax(260px, 1.1fr) minmax(360px, 1.2fr) minmax(260px, 0.9fr);
  gap: 12px;
  align-items: stretch;
  margin-bottom: 16px;
}
.role-copy,
.role-card-row,
.role-task-list {
  min-width: 0;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--panel);
}
.role-copy {
  padding: 14px 16px;
}
.role-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.role-meta span {
  color: var(--muted);
  font-size: var(--font-sm);
}
.role-copy h2 {
  margin: 6px 0;
  color: var(--chip-text);
  font-size: var(--font-18);
}
.role-copy p {
  margin: 0;
  color: var(--text-soft);
  line-height: 1.6;
}
.role-card-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  overflow: hidden;
}
.role-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border-right: 1px solid var(--line-soft);
}
.role-card:last-child {
  border-right: 0;
}
.role-card span {
  color: var(--muted);
  font-size: var(--font-sm);
}
.role-card strong {
  color: var(--chip-text);
  font-size: var(--font-22);
}
.role-card small {
  margin-left: 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--font-sm);
}
.role-card.green strong { color: var(--primary); }
.role-card.blue strong { color: var(--accent); }
.role-card.orange strong { color: var(--warning); }
.role-card.red strong { color: var(--danger); }
.role-task-list {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 12px;
}
.role-task-list span {
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--chip-bg);
  color: var(--text-soft);
  font-size: var(--font-md);
}
/* minmax(0,…) 防止右列天气表(max-content)撑大轨道、破坏 2:1 比例；
   两列各面板高度之和相等(776px) → 左右等高 */
.console-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.panel {
  background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  display: flex; flex-direction: column; overflow: hidden;
}
.panel-ne { height: 460px; }
.panel-load { height: 300px; }
.panel-avg { height: 360px; }
.panel-weather { height: 400px; }

.phead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--line-faint); flex: none;
}
/* echarts 卡片标题栏去掉底边框，避免与贴顶图例视觉拥挤 */
.phead--chart { border-bottom: none; }
.ptitle { font-weight: 700; font-size: var(--font-15); color: var(--text); }
.ptitle .total { font-style: normal; font-weight: 700; color: var(--chart-danger); font-size: var(--font-lg); }
.psub { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.daynav { display: flex; gap: 2px; }

/* 新能源面板工具区:收窄日期框 + 装饰天气挂件 */
.ne-tools { display: flex; align-items: center; gap: 10px; }
/* Element Plus daterange 默认宽度较大,用 :deep 覆盖内部类,贴合日期内容 */
.ne-tools :deep(.el-date-editor--daterange) { width: 230px; }
.ne-tools :deep(.el-range-input) { font-size: var(--font-sm); }
.wx-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px;
  background: var(--wx-chip-bg); border-radius: 14px;
}
.wx-chip-svg { width: 18px; height: 18px; line-height: 0; display: inline-flex; }
.wx-chip-svg :deep(.wx-svg) { width: 18px; height: 18px; display: block; }
.wx-chip em { font-style: normal; font-weight: 700; font-size: var(--font-lg); color: var(--wx-chip-fg); }
.wx-chip.clickable { cursor: pointer; }
.wx-chip.clickable:hover { background: var(--el-fill-color-light); }
.wx-city { color: var(--muted); font-size: var(--font-xs); margin-left: 2px; }
.wx-pop-top { display: flex; gap: 6px; margin-bottom: 8px; }
.wx-pop-top .el-input { flex: 1; }
.wx-pop-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 184px; overflow-y: auto; }
.wx-pop-c { font-size: var(--font-12-5); color: var(--text-soft); padding: 4px 10px; border-radius: 12px; background: var(--panel-sub); cursor: pointer; transition: all 0.15s; }
.wx-pop-c:hover { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.wx-pop-c.on { background: var(--el-color-primary); color: var(--ai-btn-fg); }
.wx-pop-foot { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-faint); text-align: right; }
.wx-detail { font-size: var(--font-sm); color: var(--el-color-primary);cursor: pointer; }
.wx-detail:hover { text-decoration: underline; }
.wx-city-sel { font-size: var(--font-sm); color: var(--muted); cursor: pointer; }
.wx-city-sel:hover { color: var(--el-color-primary); }
.wx-city-sel small { color: var(--el-text-color-secondary); }
.wx-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--line-faint); font-size: var(--font-12-5); }
.wx-row:last-child { border-bottom: none; }
.wx-rdate { width: 42px; color: var(--el-text-color-regular); flex: none; }
.wx-ricon { width: 22px; flex: none; line-height: 0; }
.wx-ricon :deep(.wx-svg) { width: 22px; height: 22px; display: block; }
.wx-rtext { width: 50px; color: var(--el-text-color-primary); flex: none; }
.wx-rwind { flex: 1; color: var(--el-text-color-secondary); font-size: var(--font-xs); }
.wx-rtemp { color: var(--el-text-color-secondary); flex: none; }
.wx-rtemp b { color: var(--chart-danger); }
.wx-empty { padding: 16px; text-align: center; color: var(--el-text-color-placeholder); font-size: var(--font-sm); }
.wx-head-right { display: inline-flex; align-items: center; gap: 8px; }
.wx-detail2 { font-size: var(--font-sm); color: var(--el-color-primary);cursor: pointer; white-space: nowrap; }
.wx-detail2:hover { text-decoration: underline; }
.wx-city-th { cursor: pointer; }
.wx-city-th:hover { color: var(--el-color-primary);text-decoration: underline; }
.wx-hum { font-size: var(--font-10); color: #5b9bd5; }

/* 交易平台负荷:类型切换 Tab */
.load-tabs { display: flex; gap: 14px; }
.load-tab { font-size: var(--font-md); color: var(--el-color-primary);cursor: pointer; user-select: none; }
.load-tab:hover { color: var(--el-color-primary-light-3); }
.load-tab.active { color: var(--el-color-primary);font-weight: 700; }
.load-tab.disabled { color: var(--el-text-color-disabled); cursor: not-allowed; }
.load-tab.disabled:hover { color: var(--el-text-color-disabled); }

.chart { width: 100%; }
.chart-ne { height: 416px; }
.chart-load { height: 256px; }
.chart-avg { height: 316px; }

/* 天气网格 */
.wx-wrap { overflow: auto; flex: 1; min-height: 0; }
.wx-table { border-collapse: separate; border-spacing: 0; font-size: var(--font-sm); width: max-content; min-width: 100%; }
.wx-table th, .wx-table td {
  border-right: 1px solid var(--line-faint); border-bottom: 1px solid var(--line-faint); text-align: center;
}
.wx-table thead th {
  position: sticky; top: 0; z-index: 2; background: var(--el-fill-color-lighter); color: var(--el-text-color-regular);
  font-weight: 600; padding: 8px 6px; min-width: 64px; white-space: nowrap;
}
.wx-date-h, .wx-date {
  position: sticky; left: 0; z-index: 1; background: var(--el-fill-color-lighter); color: var(--el-text-color-regular);
  font-weight: 600; min-width: 46px; width: 46px;
}
.wx-table thead .wx-date-h { z-index: 3; }
.wx-cell { padding: 6px 4px; }
.wx-icon { display: block; line-height: 0; }
.wx-icon :deep(.wx-svg) { width: 30px; height: 30px; }
.wx-wind { display: block; font-size: var(--font-xs); color: var(--el-text-color-secondary); margin-top: 2px; }
.wx-temp { display: block; font-size: var(--font-sm); color: var(--el-text-color-primary); font-weight: 600; margin-top: 1px; }
.wx-empty { color: var(--el-text-color-disabled); }

.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 12px 0 0; text-align: center; }
.src code { color: var(--el-color-primary);}

@media (max-width: 1400px) {
  .console-layout { grid-template-columns: 1fr; }
  .role-workbench { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .role-card-row { grid-template-columns: 1fr; }
  .role-card { border-right: 0; border-bottom: 1px solid var(--line-soft); }
  .role-card:last-child { border-bottom: 0; }
  .panel-ne { height: 300px; }
  .panel-load { height: 260px; }
  .panel-avg { height: 280px; }
  .panel-weather { height: 280px; }
}
</style>
