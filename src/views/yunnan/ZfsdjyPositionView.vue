<script setup lang="ts">
// 持仓量监控 (zfsdjy ccljk) — 精修版,对照 B1.png:上(月维度)下(日维度)两图联动。
//  上图:某月每天的各类持仓电量(堆叠柱)+ 合计电量/持仓均价(折线);左轴电量MWh 右轴价格元/MWh。
//  下图:点击上图某天 → 该天 0-24h 的明细(同样柱+线,图例更多,含日滚动预估/最大/最小)。
// 数据:GET /sdpt/zfsdjy/ccljkDay(月,nameList=日) / ccljkTime(日,nameList=时);每序列 valueXX:{name,valueList}。
//  分类:含"均价/均值"→折线右轴(价格);含"合计/最大/最小/预估"→折线左轴(电量);其余→堆叠柱左轴(电量)。
//  回放:已全量采集 ccljkDay__<月>(2022-12~2026-07)+ ccljkTime__<日>(各自然日),按月/按日取数。源 capture-raw/sdpt_zfsdjy/。
import { computed, onMounted, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { MIDLONG_TIME_BLOCK_FAMILY } from '@/services/data/contracts'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { onRegionChange } from '@/composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '@/components/CapabilitySupportBadge.vue'
import { chartChrome } from '@/composables/useTheme'
import { useEChart } from '@/composables/useEChart'
import { useQuerySync } from '@/composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay } from '@/services/chart/chartOptions'

const PALETTE = ['#5470c6', '#fc8452', '#fac858', '#73c0de', '#3ba272', '#9a60b4', '#ee6666', '#91cc75', '#ea7ccc', '#48b3bb']
const loading = ref(true)
const error = ref('')
// 支持 ?month=YYYY-MM 或 ?date=YYYY-MM-DD 带参定位月份
const route = useRoute()
const qMonth = typeof route.query.month === 'string' ? route.query.month : (typeof route.query.date === 'string' ? route.query.date.slice(0, 7) : '')
const month = ref(qMonth || '2026-06')
const selectedDay = ref('')
const monthData = ref<any>(null)
const dayData = ref<any>(null)
const dayRef = ref<HTMLDivElement | null>(null)
const monthRef = ref<HTMLDivElement | null>(null)
// 月份筛选 ⇄ 路由 query：刷新或分享链接后定位同一月份
useQuerySync({ month })
const monthChart = useEChart(monthRef, { render: renderMonth })
const dayChart = useEChart(dayRef, { render: renderDay })
const routeCapability = computed(() => getRegionCapabilityForPath('/zcqjy/zccljk', currentRegion.value.id))
const requestEnabled = computed(() => !routeCapability.value || routeCapability.value.status === 'available')
let loadGeneration = 0

function classify(name: string) {
  if (/均价|均值/.test(name)) return { kind: 'line', axis: 1 }       // 价格(右)
  if (/合计|最大|最小|预估/.test(name)) return { kind: 'line', axis: 0 } // 电量合计/区间(左)
  return { kind: 'bar', axis: 0 }                                       // 持仓电量类目(堆叠,左)
}
// 从 ccljk* 数据抽出有效序列
function seriesOf(d: any) {
  const out: { name: string; data: any[]; cls: any }[] = []
  Object.keys(d || {}).forEach((k) => {
    const v = d[k]
    if (v && typeof v === 'object' && v.name && Array.isArray(v.valueList) && v.valueList.some((x: any) => x != null)) {
      // 去掉名字里的日期前缀(日维度序列名带 2026-xx-xx-)
      const name = String(v.name).replace(/^\d{4}-\d{2}-\d{2}-/, '')
      out.push({ name, data: v.valueList, cls: classify(name) })
    }
  })
  return out
}

function buildOption(d: any, isDay: boolean) {
  const cc = chartChrome()
  const x: string[] = d.nameList || []
  const ss = seriesOf(d)
  let ci = 0
  const series = ss.map((s) => {
    const color = PALETTE[ci++ % PALETTE.length]
    if (s.cls.kind === 'bar') return { name: s.name, type: 'bar', stack: 'q', yAxisIndex: 0, itemStyle: { color }, data: s.data, barMaxWidth: isDay ? 14 : 18 }
    return { name: s.name, type: 'line', step: 'start', yAxisIndex: s.cls.axis, showSymbol: false, connectNulls: true, lineStyle: { width: 1.6, color, type: /均价|均值/.test(s.name) ? 'solid' : 'solid' }, itemStyle: { color }, data: s.data }
  })
  // 双轴单位:堆叠柱/电量折线为 MWh,均价折线为 元/MWh,按系列名映射
  const units: Record<string, string> = {}
  ss.forEach((s) => { units[s.name] = s.cls.axis === 1 ? '元/MWh' : 'MWh' })
  return {
    ...emptyOverlay(!ss.length),
    // 底部布局:图例顶部居中 scroll,工具栏右下角(月/日维度共用 buildOption)
    legend: bottomLayoutLegend({ textStyle: { fontSize: 10 }, data: ss.map((s) => s.name) }),
    tooltip: { ...axisTooltip({ units, pointer: 'shadow' }), confine: true },
    toolbox: bottomToolbox(isDay ? '持仓量监控_日维度' : '持仓量监控_月维度', 8),
    grid: { left: 60, right: 64, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: x, axisLabel: { color: cc.axisLabel, fontSize: 10, interval: isDay ? 0 : Math.max(0, Math.floor(x.length / 12)) }, axisLine: { lineStyle: { color: cc.splitLine } } },
    yAxis: [
      { type: 'value', name: '电量 MWh', scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9, formatter: (v: number) => v.toLocaleString('zh-CN') }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '价格 元/MWh', scale: true, position: 'right', nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } }
    ],
    series
  }
}

// 渲染回调:主题切换重建实例后由 useEChart 自动调用,按当前数据恢复图表
function renderMonth() {
  if (!monthData.value) return
  monthChart.setOption(buildOption(monthData.value, false), { notMerge: true })
  const inst = monthChart.instance()
  if (inst) {
    inst.off('click')
    inst.on('click', (p: any) => { if (p.name) { selectedDay.value = p.name; loadDay() } })
  }
}
function renderDay() {
  if (!dayData.value) return
  dayChart.setOption(buildOption(dayData.value, true), { notMerge: true })
}

async function loadMonth() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyCharts()
  if (!requestEnabled.value) {
    loading.value = false
    return
  }
  monthChart.showLoading()
  try {
    const res = await fetchCaptured<any>(MIDLONG_TIME_BLOCK_FAMILY, `ccljkDay__${month.value}`)
    if (generation !== loadGeneration) return
    monthData.value = res?.data || {}
    await nextTick()
    if (generation !== loadGeneration) return
    renderMonth()
    selectedDay.value = (monthData.value.nameList || [])[0] || ''
    await loadDay(generation)
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyCharts(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      monthChart.hideLoading()
    }
  }
}
async function loadDay(generation = loadGeneration) {
  if (generation !== loadGeneration || !requestEnabled.value) return
  if (!selectedDay.value) return
  dayChart.showLoading()
  try {
    const res = await fetchCaptured<any>(MIDLONG_TIME_BLOCK_FAMILY, `ccljkTime__${selectedDay.value}`)
    if (generation !== loadGeneration) return
    dayData.value = res?.data || {}
    await nextTick()
    if (generation !== loadGeneration) return
    renderDay()
  } catch {
    if (generation !== loadGeneration) return
    // 加载失败不再静默:提示用户日明细暂不可用
    dayData.value = null
    dayChart.setOption({ ...emptyOverlay(true, `日维度持仓明细加载失败（${selectedDay.value}）`) }, { notMerge: true })
    ElMessage.warning(`日维度持仓明细加载失败（${selectedDay.value}）`)
  } finally {
    if (generation === loadGeneration) dayChart.hideLoading()
  }
}

function clearViewState() {
  selectedDay.value = ''
  monthData.value = null
  dayData.value = null
}

function renderEmptyCharts(text = '暂无持仓监控数据') {
  monthChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
  dayChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

watch(month, loadMonth) // 切月份即重新取数
onMounted(loadMonth)

onRegionChange(loadMonth)
</script>

<template>
  <div class="pos" v-loading="loading">
    <RegionDataBanner :families="[MIDLONG_TIME_BLOCK_FAMILY]" />
    <CapabilitySupportBadge path="/zcqjy/zccljk" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div v-if="!requestEnabled" class="degraded-card">
      <div class="degraded-title">当前地区暂无持仓监控台账</div>
      <div class="degraded-text">
        云南尚未接入直属水电持仓明细，外部数据到货后由 B 类清单接入；本页不会请求山西持仓数据或模拟回放。
      </div>
    </div>
    <template v-else>
    <div class="toolbar">
      <span class="lbl">运行月份</span>
      <el-date-picker v-model="month" type="month" value-format="YYYY-MM" size="small" :clearable="false" style="width: 130px" />
      <span class="lbl">售电公司</span>
      <el-select model-value="默认公司" size="small" style="width: 130px" disabled><el-option label="默认公司" value="默认公司" /></el-select>
      <el-button size="small" type="primary" @click="loadMonth">查询</el-button>
    </div>
    <div class="card">
      <div class="ctitle">月维度 · {{ month }} 各类持仓电量(堆叠柱)+ 合计电量/持仓均价(折线)<span class="hint"> （点击某天联动下方日明细）</span></div>
      <div ref="monthRef" class="chart chart-host"></div>
    </div>
    <div class="card">
      <div class="ctitle">日维度 · {{ selectedDay }} 逐时(0–24h)持仓明细</div>
      <div ref="dayRef" class="chart chart-host"></div>
    </div>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zfsdjy/ccljkDay|ccljkTime ｜ 左轴电量 右轴价格 （日明细当前采集 as-of 2026-06-03,点其它天暂显示该天） -->
    </template>
  </div>
</template>

<style scoped>
.pos { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.toolbar .lbl { font-size: 13px; color: var(--el-text-color-regular); font-weight: 600; }
.card { background: var(--panel); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); padding: 8px 12px; margin-top: 12px; }
.ctitle { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); padding: 2px 0 6px; }
.ctitle .hint { font-weight: 400; color: var(--el-text-color-secondary); font-size: 12px; }
.chart { height: 320px; width: 100%; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
.src .note { color: var(--warning); }
.mb { margin-bottom: 12px; }
.degraded-card { border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, var(--line)); background: color-mix(in srgb, var(--warning, #d97706) 8%, var(--panel)); border-radius: 8px; padding: 14px 16px; color: var(--text); }
.degraded-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.degraded-text { font-size: 13px; color: var(--muted); line-height: 1.6; }

/* 移动端:筛选条纵向堆叠,控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar :deep(.el-date-editor),
  .toolbar :deep(.el-select),
  .toolbar .el-button { width: 100% !important; }
}
</style>
