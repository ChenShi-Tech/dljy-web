<script setup lang="ts">
// 天气预报 (tqyb) — 精修版,实时调用 Open-Meteo(免费/开放/无需key)。四板块:
//  ① 基础信息(实况:图标/天气名/气温/体感/风速/湿度/日出日落)
//  ② 15 天预报(每天缩略卡:日期星期/图标/最高最低温)
//  ③ 15 天趋势图(温度/体感/湿度/降水/风速 等,横轴日期)
//  ④ 24 小时详报(选定日逐小时:时间/图标/温度/风速 卡 + 温度/体感/湿度 曲线)
// 数据源:经查证,线上 weather/* 即 Open-Meteo(typeList=apparent_temperature/shortwave_radiation… WMO天气码,
//  districtTree 各市 center[lon,lat])。本页直接走实时 API,城市经纬度复用 districtTree。详见 docs/project/archive/restoration-2026-06/refine-queue.jsonl A11。
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentRegion } from '@/services/region/regionContext'
import { CHINA_PROVINCES } from '../data/chinaCities'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { debounce } from '../utils/timing'
import { searchCityByOpenMeteo, reverseGeocode, fetchForecastBundle } from '@/services/weather'
import ForecastIntro from '@/components/forecast/ForecastIntro.vue'

type Loc = { name: string; lon: number; lat: number; admin1?: string }
// 常用城市(直辖市 + 省会 + 主要城市),用于快捷选择 & 兜底默认
const HOT_CITIES: Loc[] = [
  { name: '北京', lon: 116.41, lat: 39.90, admin1: '北京' }, { name: '上海', lon: 121.47, lat: 31.23, admin1: '上海' },
  { name: '天津', lon: 117.20, lat: 39.13, admin1: '天津' }, { name: '重庆', lon: 106.55, lat: 29.56, admin1: '重庆' },
  { name: '广州', lon: 113.26, lat: 23.13, admin1: '广东' }, { name: '深圳', lon: 114.06, lat: 22.54, admin1: '广东' },
  { name: '杭州', lon: 120.16, lat: 30.27, admin1: '浙江' }, { name: '南京', lon: 118.80, lat: 32.06, admin1: '江苏' },
  { name: '成都', lon: 104.07, lat: 30.57, admin1: '四川' }, { name: '武汉', lon: 114.30, lat: 30.59, admin1: '湖北' },
  { name: '西安', lon: 108.95, lat: 34.26, admin1: '陕西' }, { name: '太原', lon: 112.55, lat: 37.87, admin1: '山西' },
  { name: '郑州', lon: 113.63, lat: 34.75, admin1: '河南' }, { name: '济南', lon: 117.00, lat: 36.65, admin1: '山东' },
  { name: '青岛', lon: 120.38, lat: 36.07, admin1: '山东' }, { name: '长沙', lon: 112.94, lat: 28.23, admin1: '湖南' },
  { name: '合肥', lon: 117.28, lat: 31.86, admin1: '安徽' }, { name: '福州', lon: 119.30, lat: 26.08, admin1: '福建' },
  { name: '厦门', lon: 118.09, lat: 24.48, admin1: '福建' }, { name: '南昌', lon: 115.86, lat: 28.68, admin1: '江西' },
  { name: '昆明', lon: 102.83, lat: 24.88, admin1: '云南' }, { name: '贵阳', lon: 106.71, lat: 26.65, admin1: '贵州' },
  { name: '南宁', lon: 108.37, lat: 22.82, admin1: '广西' }, { name: '石家庄', lon: 114.51, lat: 38.04, admin1: '河北' },
  { name: '沈阳', lon: 123.43, lat: 41.80, admin1: '辽宁' }, { name: '大连', lon: 121.62, lat: 38.91, admin1: '辽宁' },
  { name: '长春', lon: 125.32, lat: 43.82, admin1: '吉林' }, { name: '哈尔滨', lon: 126.53, lat: 45.80, admin1: '黑龙江' },
  { name: '兰州', lon: 103.83, lat: 36.06, admin1: '甘肃' }, { name: '西宁', lon: 101.78, lat: 36.62, admin1: '青海' },
  { name: '银川', lon: 106.23, lat: 38.49, admin1: '宁夏' }, { name: '呼和浩特', lon: 111.75, lat: 40.84, admin1: '内蒙古' },
  { name: '乌鲁木齐', lon: 87.62, lat: 43.82, admin1: '新疆' }, { name: '拉萨', lon: 91.11, lat: 29.65, admin1: '西藏' },
  { name: '海口', lon: 110.20, lat: 20.04, admin1: '海南' }
]

// 按顶栏选定省份匹配 CHINA_PROVINCES;匹配不到(如国网/南网通用版)回退全国常用城市
const matchedProvince = computed(() => {
  const r = currentRegion.value
  return (
    CHINA_PROVINCES.find((p) => p.name === r.shortName) ||
    CHINA_PROVINCES.find((p) => (r.shortName && r.shortName.includes(p.name)) || (r.name && r.name.includes(p.name))) ||
    null
  )
})
// 常用城市:优先展示当前省份的主要城市
const hotCities = computed<Loc[]>(() => {
  const prov = matchedProvince.value
  if (prov) return prov.cities.map((c) => ({ name: c.name, lon: c.lon, lat: c.lat, admin1: prov.name }))
  return HOT_CITIES
})
const hotLabel = computed(() => (matchedProvince.value ? `${matchedProvince.value.name}主要城市` : '常用'))
const WMO: Record<number, { n: string; c: string }> = {
  0: { n: '晴', c: 'sunny' }, 1: { n: '主要晴朗', c: 'mostlysunny' }, 2: { n: '少云', c: 'cloudy' }, 3: { n: '阴', c: 'overcast' },
  45: { n: '雾', c: 'fog' }, 48: { n: '雾凇', c: 'fog' },
  51: { n: '小毛毛雨', c: 'lightrain' }, 53: { n: '毛毛雨', c: 'lightrain' }, 55: { n: '大毛毛雨', c: 'rain' },
  56: { n: '冻毛毛雨', c: 'lightrain' }, 57: { n: '冻毛毛雨', c: 'rain' },
  61: { n: '小雨', c: 'lightrain' }, 63: { n: '中雨', c: 'rain' }, 65: { n: '大雨', c: 'rain' },
  66: { n: '冻雨', c: 'rain' }, 67: { n: '强冻雨', c: 'rain' },
  71: { n: '小雪', c: 'snow' }, 73: { n: '中雪', c: 'snow' }, 75: { n: '大雪', c: 'snow' }, 77: { n: '雪粒', c: 'snow' },
  80: { n: '小阵雨', c: 'shower' }, 81: { n: '阵雨', c: 'shower' }, 82: { n: '强阵雨', c: 'shower' },
  85: { n: '小阵雪', c: 'snow' }, 86: { n: '阵雪', c: 'snow' },
  95: { n: '雷阵雨', c: 'thunder' }, 96: { n: '雷雨冰雹', c: 'thunder' }, 99: { n: '强雷雨冰雹', c: 'thunder' }
}
const wmo = (code: number) => WMO[code] || { n: '—', c: 'overcast' }
const cloud = (fill: string, dy = 0) =>
  `<g fill="${fill}" transform="translate(0 ${dy})"><circle cx="8" cy="13" r="4.1"/><circle cx="13.5" cy="11.5" r="5.2"/><circle cx="17.5" cy="13.5" r="3.8"/><rect x="5.5" y="12.5" width="14" height="6" rx="3"/></g>`
const WSVG: Record<string, string> = {
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
const icon = (code: number) => `<svg viewBox="0 0 24 24" class="wsvg">${WSVG[wmo(code).c] || WSVG.overcast}</svg>`
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const fmtWeek = (d: string) => WD[new Date(d + 'T00:00:00').getDay()]
const fmtMD = (d: string) => { const [, m, dd] = d.split('-'); return `${+m}/${+dd}` }
const hhmm = (iso: string) => (iso ? iso.slice(11, 16) : '-')

const loading = ref(true)
const error = ref('')
const LS_KEY = 'dljy_weather_loc'
const route = useRoute()
const loc = ref<Loc>((() => {
  // 优先用跳转带来的城市参数(首页天气点城市名/详情过来),其次上次选择,再次默认太原
  const q = route.query
  if (q.lon && q.lat) return { name: String(q.name || '所选城市'), lon: Number(q.lon), lat: Number(q.lat) }
  try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r) as Loc } catch { /* ignore */ }
  return HOT_CITIES.find((c) => c.name === '太原') || HOT_CITIES[0]
})())
const locating = ref(false)
const pick = ref<number | ''>('')
const searchOptions = ref<Loc[]>([])
const searchLoading = ref(false)
const cur = ref<any>(null)
const daily = ref<any>(null)
const hourly = ref<any>(null)
const dayIdx = ref(0)
const trendRef = ref<HTMLDivElement | null>(null)
const hourRef = ref<HTMLDivElement | null>(null)
const trendChart = useEChart(trendRef, { render: renderTrend })
const hourChart = useEChart(hourRef, { render: renderHour })

// 城市选择 ⇄ 路由 query 同步(name/lon/lat 与入站跳转参数同键,刷新/分享可还原)
const locName = ref(loc.value.name)
const locLon = ref(loc.value.lon)
const locLat = ref(loc.value.lat)
useQuerySync({ name: locName, lon: locLon, lat: locLat })
watch(loc, (l) => { locName.value = l.name; locLon.value = l.lon; locLat.value = l.lat })

function pickLoc(l: Loc) {
  loc.value = { ...l }
  try { localStorage.setItem(LS_KEY, JSON.stringify(loc.value)) } catch { /* ignore */ }
}
function onPickSearch(i: number) {
  const l = searchOptions.value[i]
  if (l) pickLoc(l)
  pick.value = ''
}
let searchSeq = 0
// 全国城市搜索:Open-Meteo geocoding(免费/无 key)
async function searchCity(q: string) {
  const kw = q.trim()
  if (!kw) { searchOptions.value = []; return }
  const seq = ++searchSeq
  searchLoading.value = true
  try {
    const found = await searchCityByOpenMeteo(kw)
    if (seq !== searchSeq) return
    searchOptions.value = found
  } catch {
    if (seq === searchSeq) { searchOptions.value = []; ElMessage.warning('城市搜索失败,请稍后重试') }
  } finally { if (seq === searchSeq) searchLoading.value = false }
}
// 输入即搜防抖:el-select remote 每个按键都会触发,300ms 防抖避免高频请求
const searchCityDebounced = debounce(searchCity, 300)
// 浏览器定位 → 经纬度 → 逆地理拿城市名(失败也能按经纬度出天气)
function locate() {
  if (!navigator.geolocation) { error.value = '当前浏览器不支持定位'; return }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude
      let name = '我的位置', admin1 = ''
      const hit = await reverseGeocode(lat, lon)
      if (hit) { name = hit.name || name; admin1 = hit.admin1 }
      pickLoc({ name, lon, lat, admin1 })
      locating.value = false
    },
    (err) => { locating.value = false; error.value = '定位失败:' + (err.code === 1 ? '请允许浏览器定位权限' : '请稍后重试') },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  )
}
const curName = computed(() => cur.value ? wmo(cur.value.weather_code).n : '')

async function load() {
  loading.value = true; error.value = ''
  trendChart.showLoading(); hourChart.showLoading()
  try {
    const c = loc.value
    const bundle = await fetchForecastBundle(c.lat, c.lon)
    cur.value = bundle.current; daily.value = bundle.daily; hourly.value = bundle.hourly; dayIdx.value = 0
    await nextTick()
    renderTrend(); renderHour()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
    trendChart.hideLoading(); hourChart.hideLoading()
  }
}

const forecastCards = computed(() => {
  const d = daily.value
  if (!d) return []
  return d.time.map((t: string, i: number) => ({
    date: t, md: fmtMD(t), wk: fmtWeek(t), code: d.weather_code[i], name: wmo(d.weather_code[i]).n,
    hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]), sel: i === dayIdx.value
  }))
})
const hourCards = computed(() => {
  const h = hourly.value, d = daily.value
  if (!h || !d) return []
  const day = d.time[dayIdx.value]
  const out: any[] = []
  h.time.forEach((t: string, i: number) => {
    if (t.slice(0, 10) === day) out.push({ hh: hhmm(t), code: h.weather_code[i], temp: Math.round(h.temperature_2m[i]), wind: Math.round(h.wind_speed_10m[i]) })
  })
  return out
})

function renderTrend() {
  if (!daily.value) return
  const d = daily.value
  const cc = chartChrome()
  trendChart.setOption({
    ...emptyOverlay(!(d.time || []).length),
    // 底部布局:图例顶部居中 scroll,工具栏右下角
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ units: { 最高温: '℃', 平均温: '℃', 最低温: '℃', 体感最高: '℃', 体感最低: '℃', 降水: 'mm', 相对湿度: '%', 最大风速: 'km/h' }, digits: 1 }), confine: true },
    toolbox: bottomToolbox('15天天气趋势', 8),
    grid: { left: 48, right: 96, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: d.time.map(fmtMD), axisLabel: { fontSize: 10, color: cc.axisLabel } },
    yAxis: [
      { type: 'value', name: '°C', position: 'left', nameTextStyle: { fontSize: 10, color: cc.axisLabel }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '降水mm', position: 'right', nameTextStyle: { fontSize: 10, color: cc.axisLabel }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { show: false } },
      { type: 'value', name: '湿度%', position: 'right', offset: 50, max: 100, nameTextStyle: { fontSize: 10, color: cc.axisLabel }, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { show: false } }
    ],
    series: [
      { name: '最高温', type: 'line', smooth: false, symbolSize: 4, data: d.temperature_2m_max, lineStyle: { color: '#ee6666' }, itemStyle: { color: '#ee6666' } },
      { name: '平均温', type: 'line', smooth: false, symbolSize: 4, data: d.temperature_2m_mean, lineStyle: { color: '#fc8452' }, itemStyle: { color: '#fc8452' } },
      { name: '最低温', type: 'line', smooth: false, symbolSize: 4, data: d.temperature_2m_min, lineStyle: { color: '#5470c6' }, itemStyle: { color: '#5470c6' } },
      { name: '体感最高', type: 'line', smooth: false, showSymbol: false, lineStyle: { color: '#ee6666', type: 'dashed', width: 1 }, data: d.apparent_temperature_max },
      { name: '体感最低', type: 'line', smooth: false, showSymbol: false, lineStyle: { color: '#5470c6', type: 'dashed', width: 1 }, data: d.apparent_temperature_min },
      { name: '降水', type: 'bar', yAxisIndex: 1, data: d.precipitation_sum, itemStyle: { color: '#73c0de' }, barMaxWidth: 14 },
      { name: '相对湿度', type: 'line', yAxisIndex: 2, smooth: false, showSymbol: false, lineStyle: { color: '#3ba272' }, itemStyle: { color: '#3ba272' }, data: d.relative_humidity_2m_mean },
      { name: '最大风速', type: 'line', smooth: false, showSymbol: false, lineStyle: { color: '#9a60b4', width: 1 }, itemStyle: { color: '#9a60b4' }, data: d.wind_speed_10m_max }
    ]
  }, { notMerge: true })
}

function renderHour() {
  if (!hourly.value || !daily.value) return
  const h = hourly.value, day = daily.value.time[dayIdx.value]
  const idxs: number[] = []
  h.time.forEach((t: string, i: number) => { if (t.slice(0, 10) === day) idxs.push(i) })
  const pick = (arr: any[]) => idxs.map((i) => arr[i])
  const cc = chartChrome()
  hourChart.setOption({
    ...emptyOverlay(!idxs.length),
    // 本图无 toolbox,仅图例改顶部居中 scroll
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ units: { 空气温度: '℃', 体感温度: '℃', 相对湿度: '%' }, digits: 1 }), confine: true },
    grid: { left: 44, right: 60, top: 48, bottom: 28 },
    xAxis: { type: 'category', data: idxs.map((i) => hhmm(h.time[i])), axisLabel: { fontSize: 9, color: cc.axisLabel, interval: 1 } },
    yAxis: [
      { type: 'value', name: '°C', axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '湿度%', position: 'right', max: 100, axisLabel: { fontSize: 9, color: cc.axisLabel }, splitLine: { show: false } }
    ],
    series: [
      { name: '空气温度', type: 'line', smooth: false, showSymbol: false, data: pick(h.temperature_2m), lineStyle: { color: '#ee6666' }, itemStyle: { color: '#ee6666' } },
      { name: '体感温度', type: 'line', smooth: false, showSymbol: false, data: pick(h.apparent_temperature), lineStyle: { color: '#fc8452', type: 'dashed' }, itemStyle: { color: '#fc8452' } },
      { name: '相对湿度', type: 'line', yAxisIndex: 1, smooth: false, showSymbol: false, data: pick(h.relative_humidity_2m), lineStyle: { color: '#3ba272' }, itemStyle: { color: '#3ba272' } }
    ]
  }, { notMerge: true })
}

function selDay(i: number) { dayIdx.value = i; nextTick(renderHour) }
onMounted(load)
watch(loc, load, { deep: true })
</script>

<template>
  <div class="wf" v-loading="loading">
    <ForecastIntro text="实时查询所选城市的气象数据（Open-Meteo 开放接口），展示当前实况、未来 15 天日预报与多要素趋势、以及选定日 24 小时逐时详报，作为负荷与新能源出力预测的气象输入。" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <span class="lbl">城市</span>
      <el-select
        v-model="pick" size="small" filterable remote :remote-method="searchCityDebounced"
        :loading="searchLoading" placeholder="搜全国城市,如:杭州" reserve-keyword
        style="width: 200px" @change="onPickSearch"
      >
        <el-option v-for="(c, i) in searchOptions" :key="i" :label="`${c.name}${c.admin1 ? ' · ' + c.admin1 : ''}`" :value="i" />
      </el-select>
      <el-button size="small" :loading="locating" @click="locate">📍 定位</el-button>
      <span class="now">{{ loc.name }}<small v-if="loc.admin1 && loc.admin1 !== loc.name"> · {{ loc.admin1 }}</small></span>
      <span class="src-tag">实时 · Open-Meteo</span>
    </div>
    <div class="hotbar">
      <span class="hot-lbl">{{ hotLabel }}</span>
      <span
        v-for="c in hotCities" :key="c.name"
        class="hot-c" :class="{ on: loc.name === c.name }"
        @click="pickLoc(c)"
      >{{ c.name }}</span>
    </div>

    <div class="card cur" v-if="cur">
      <div class="cur-main">
        <span class="cur-icon" v-html="icon(cur.weather_code)"></span>
        <div class="cur-text">
          <div class="cur-temp">{{ Math.round(cur.temperature_2m) }}°</div>
          <div class="cur-name">{{ loc.name }} · {{ curName }}</div>
          <div class="cur-app">体感 {{ Math.round(cur.apparent_temperature) }}°</div>
        </div>
      </div>
      <div class="cur-meta">
        <div><b>{{ Math.round(cur.wind_speed_10m) }}</b><span>风速 km/h</span></div>
        <div><b>{{ Math.round(cur.relative_humidity_2m) }}%</b><span>相对湿度</span></div>
        <div><b>{{ hhmm(daily?.sunrise?.[0]) }}</b><span>日出</span></div>
        <div><b>{{ hhmm(daily?.sunset?.[0]) }}</b><span>日落</span></div>
      </div>
    </div>

    <div class="card">
      <div class="ctitle">15 天预报<span class="hint"> （点选某天看下方 24 小时详报）</span></div>
      <div class="fc-row">
        <div v-for="(c, i) in forecastCards" :key="c.date" class="fc-cell" :class="{ on: c.sel }" @click="selDay(Number(i))">
          <div class="fc-d">{{ c.md }}</div><div class="fc-w">{{ c.wk }}</div>
          <span class="fc-i" v-html="icon(Number(c.code))"></span>
          <div class="fc-n">{{ c.name }}</div>
          <div class="fc-t"><b>{{ c.hi }}°</b> / {{ c.lo }}°</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="ctitle">15 天趋势（温度/体感/湿度/降水/风速）</div>
      <div ref="trendRef" class="chart chart-host"></div>
    </div>

    <div class="card">
      <div class="ctitle">24 小时详报 · {{ daily?.time?.[dayIdx] }}</div>
      <div class="hr-row">
        <div v-for="(h, i) in hourCards" :key="i" class="hr-cell">
          <div class="hr-h">{{ h.hh }}</div>
          <span class="hr-i" v-html="icon(h.code)"></span>
          <div class="hr-t">{{ h.temp }}°</div>
          <div class="hr-w">{{ h.wind }}</div>
        </div>
      </div>
      <div ref="hourRef" class="chart chart-host"></div>
    </div>
  </div>
</template>

<style scoped>
.wf { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 10px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.src-tag { font-size: var(--font-sm); color: var(--el-color-success); margin-left: auto; }
.now { font-size: var(--font-md); color: var(--el-text-color-primary); font-weight: 600; }
.now small { color: var(--el-text-color-secondary); font-weight: 400; }
.hotbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; background: var(--panel); padding: 8px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); margin-top: 8px; }
.hot-lbl { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-right: 4px; }
.hot-c { font-size: var(--font-12-5); color: var(--el-text-color-regular); padding: 3px 10px; border-radius: 12px; background: var(--el-fill-color-light); cursor: pointer; transition: all .15s; }
.hot-c:hover { background: var(--primary-tint); color: var(--el-color-primary); }
.hot-c.on { background: var(--el-color-primary); color: #fff; }
.card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 10px 14px; margin-top: 12px; }
.ctitle { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-primary); padding: 2px 0 8px; }
.ctitle .hint { font-weight: 400; color: var(--el-text-color-disabled); font-size: var(--font-sm); }
.chart { height: 280px; width: 100%; }
.cur { display: flex; align-items: center; justify-content: space-between; background: linear-gradient(120deg, var(--el-color-primary-light-9), var(--warning-tint)); }
.cur-main { display: flex; align-items: center; gap: 16px; }
.cur-icon :deep(.wsvg) { width: 64px; height: 64px; }
.cur-temp { font-size: var(--font-38); font-weight: 700; color: var(--text); line-height: 1; }
.cur-name { font-size: var(--font-15); color: var(--el-text-color-primary); margin-top: 4px; }
.cur-app { font-size: var(--font-md); color: var(--el-text-color-secondary); margin-top: 2px; }
.cur-meta { display: flex; gap: 28px; padding-right: 16px; }
.cur-meta div { text-align: center; }
.cur-meta b { display: block; font-size: var(--font-18); color: var(--el-text-color-primary); }
.cur-meta span { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.fc-row { display: flex; gap: 8px; overflow-x: auto; }
.fc-cell { flex: 1 0 auto; min-width: 78px; text-align: center; padding: 8px 4px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; }
.fc-cell:hover { background: var(--el-fill-color-light); }
.fc-cell.on { background: var(--primary-tint); border-color: var(--el-color-primary); }
.fc-d { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-primary); }
.fc-w { font-size: var(--font-xs); color: var(--el-text-color-secondary); }
.fc-i :deep(.wsvg) { width: 34px; height: 34px; margin: 4px 0; }
.fc-n { font-size: var(--font-xs); color: var(--el-text-color-regular); }
.fc-t { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-top: 2px; }
.fc-t b { color: var(--danger); }
.hr-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; }
.hr-cell { flex: 0 0 auto; width: 50px; text-align: center; }
.hr-h { font-size: var(--font-xs); color: var(--el-text-color-secondary); }
.hr-i :deep(.wsvg) { width: 26px; height: 26px; }
.hr-t { font-size: var(--font-md); font-weight: 600; color: var(--danger); }
.hr-w { font-size: var(--font-xs); color: var(--el-color-primary); }
.mb { margin-bottom: 12px; }
/* 移动端:工具条纵排,数据源标签不再右贴 */
@media (max-width: 768px) {
  .toolbar { flex-wrap: wrap; }
  .src-tag { margin-left: 0; width: 100%; }
}
</style>
