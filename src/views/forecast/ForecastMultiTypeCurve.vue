<script setup lang="ts">
// 通用「多类型 · 复选表格 + 多选联动折线」预测视图(cfg 驱动)。复用于:
// E2 价格预测(zptjg tag61,12类型)/ E5 公司新能源出力预测1(zxztqa,总风光)/ E6 公司新能源出力预测2(zgnrx,总风光)。
// 经典款:运行日期区间 + 类型筛选 + 数据点(96/24);表格复选→下方图按勾选行显示曲线,图例随勾选实时显示。
// cfg(route.meta.cfg): { family, match, dateField, typeField, dict?(系统字典名)|typeLabels?, totalField, valueLabel, unit }
// NOTE(内部): 预测数值为模型输出,准确度后续优化;界面正常自信展示,勿在 UI 标注"不可信"。源: capture-raw/<family>/
import { onMounted, ref, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { fetchStationForecast } from '@/services/company/companyApi'
import { currentForecastStationId, onForecastChange } from '@/services/forecast/forecastContext'
import { onRegionChange } from '@/composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import ForecastProfileBar from '@/components/forecast/ForecastProfileBar.vue'
import ForecastIntro from '@/components/forecast/ForecastIntro.vue'
import TslibOnlineForecastPanel from '@/components/forecast/TslibOnlineForecastPanel.vue'
import { chartChrome } from '@/composables/useTheme'
import { useEChart } from '@/composables/useEChart'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv as downloadCsv } from '@/utils/exportCsv'

// cfg 优先取 prop（预测中心整合页以 tab 形式复用本组件），回退 route.meta（独立路由页）
const props = defineProps<{ cfg?: Record<string, any> }>()
const route = useRoute()
const cfg = props.cfg ?? ((route.meta as any).cfg || {})
// 厂站绑定页(新能源出力预测1/2)：数据源绑定到 {地区·公司·厂站} profile，走 /api/company/forecast。
const stationScoped = !!cfg.stationScoped
const stationKind = (cfg.stationKind ?? 'zxztqa') as 'zxztqa' | 'zgnrx' | 'gsfhyc'
const dateField = cfg.dateField || 'date'
const typeField = cfg.typeField || 'type'
const unit = cfg.unit || ''

const L96 = Array.from({ length: 96 }, (_, i) => { const m = (i + 1) * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
const L24 = Array.from({ length: 24 }, (_, i) => `${String(i + 1).padStart(2, '0')}:00`)
const get96 = (r: any) => Array.from({ length: 96 }, (_, k) => r['p' + (k + 1)] ?? null)
const get24 = (r: any) => Array.from({ length: 24 }, (_, h) => { const v = [0, 1, 2, 3].map((j) => r['p' + (h * 4 + j + 1)]).filter((x) => x != null) as number[]; return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null })
const meanOf = (r: any) => { const f = cfg.meanField || 'jz'; if (r[f] != null) return +(+r[f]).toFixed(2); const v = get96(r).filter((x) => x != null) as number[]; return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null }

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const typeMap = ref<Record<string, string>>(cfg.typeLabels || {})
const range = ref<[string, string] | null>(null)
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
const fType = ref(typeof route.query.type === 'string' ? route.query.type : '')
const npts = ref<24 | 96>(96)
const selected = ref<any[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const tableRef = ref()
const curveChart = useEChart(chartRef, { render })
let loadGeneration = 0

const typeName = (v: any) => typeMap.value[String(v)] || String(v)
const hasDrrq = computed(() => rows.value.length && 'drrq' in rows.value[0])
const labels = computed(() => (npts.value === 24 ? L24 : L96))
const valsOf = (r: any) => (npts.value === 24 ? get24(r) : get96(r))
const types = computed(() => [...new Set(rows.value.map((r) => String(r[typeField])))])
const filtered = computed(() => rows.value.filter((r) =>
  (!range.value || (r[dateField] >= range.value[0] && r[dateField] <= range.value[1])) &&
  (!fType.value || String(r[typeField]) === fType.value)))
const onlineTarget = computed(() => String(
  cfg.mlTarget
  || (stationKind === 'gsfhyc' ? 'load' : '')
  || (stationScoped ? 'renewable' : '')
  || (String(cfg.match ?? '').includes('tag61') ? 'price' : '')
  || 'renewable'
))

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyChart()
  curveChart.showLoading()
  try {
    let res: any
    if (stationScoped) {
      const sid = currentForecastStationId.value
      if (sid == null) {
        await nextTick()
        if (generation === loadGeneration) renderEmptyChart('当前地区/公司暂无可用厂站')
        return
      }
      res = await fetchStationForecast(stationKind, sid)
    } else {
      const tasks: Promise<any>[] = [fetchCaptured<any>(cfg.family, cfg.match)]
      if (cfg.dict) tasks.push(fetchCaptured<any>('system_dict', cfg.dict).catch(() => null))
      const [r, dictRes] = await Promise.all(tasks)
      if (generation !== loadGeneration) return
      res = r
      if (dictRes) { const arr = dictRes?.data || dictRes?.rows || []; typeMap.value = { ...typeMap.value, ...Object.fromEntries(arr.map((x: any) => [String(x.dictValue), x.dictLabel])) } }
    }
    if (generation !== loadGeneration) return
    const all = (res?.rows || res?.data || []).slice().sort((a: any, b: any) => (a[dateField] < b[dateField] ? 1 : -1)).map((r: any, i: number) => ({ ...r, _idx: i + 1 }))
    rows.value = all
    const ds = [...new Set(all.map((r: any) => r[dateField]))].sort() as string[]
    if (ds.length) range.value = urlRange ?? [ds[Math.max(0, ds.length - 4)], ds[ds.length - 1]] // 默认最近约4天
    await nextTick()
    if (generation !== loadGeneration) return
    render()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyChart(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      curveChart.hideLoading()
    }
  }
}
function reset() { fType.value = ''; npts.value = 96; const ds = [...new Set(rows.value.map((r) => r[dateField]))].sort() as string[]; range.value = ds.length ? [ds[Math.max(0, ds.length - 4)], ds[ds.length - 1]] : null; tableRef.value?.clearSelection() }
function onSel(rs: any[]) { selected.value = rs; render() }

function clearViewState() {
  rows.value = []
  selected.value = []
  range.value = null
  // fType 是用户/深链筛选态（route.query.type 初始化），不随数据清空
  // 否则 /ycsj/jgyc?type=... 深链在首屏 load 即被重置（#463）；
  // 清空筛选只走用户点「重置」的 reset()。
  typeMap.value = { ...(cfg.typeLabels || {}) }
  tableRef.value?.clearSelection?.()
}

function renderEmptyChart(text = '暂无数据') {
  curveChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function render() {
  const cc = chartChrome()
  // 电价类(单位含"元")按时段恒定→阶梯线；出力/负荷类连续物理量→直线
  const isPrice = /元/.test(String(unit))
  const series = selected.value.map((r) => ({ name: `${r[dateField]} ${typeName(r[typeField])}`, type: 'line', ...(isPrice ? { step: 'start' as const } : {}), showSymbol: false, connectNulls: true, data: valsOf(r) }))
  curveChart.setOption({
    ...emptyOverlay(!series.length, '勾选表格行查看其曲线（可多选,图例随勾选行数显示）'),
    // 底部布局:图例顶部居中 scroll,工具栏右下角(cfg 驱动,覆盖价格预测/新能源 tab)
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ unit }), confine: true },
    toolbox: bottomToolbox(`${cfg.valueLabel || '预测'}曲线`, 8),
    dataZoom: npts.value === 96 ? insideZoom() : [],
    grid: { left: 60, right: 20, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: labels.value, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: npts.value === 24 ? 1 : 11 } },
    yAxis: { type: 'value', name: unit, scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

function exportCsv() {
  const rs = selected.value.length ? selected.value : filtered.value
  if (!rs.length) { ElMessage.warning('无可导出的数据'); return }
  const head = ['序号', '日期', ...(hasDrrq.value ? ['导入日期'] : []), '类型', '均值', ...labels.value]
  downloadCsv(`${(route.meta as any).title || '预测'}_${npts.value}点`, head,
    rs.map((r) => [r._idx, r[dateField], ...(hasDrrq.value ? [r.drrq] : []), typeName(r[typeField]), meanOf(r), ...valsOf(r)]))
  ElMessage.success(`已导出 ${rs.length} 行`)
}

onMounted(load)

// 厂站绑定页随 {厂站/公司/地区} 变化重载；普通采集页随地区变化重载。
if (stationScoped) onForecastChange(load)
else onRegionChange(load)
</script>

<template>
  <div class="mt" v-loading="loading">
    <ForecastIntro v-if="cfg.intro" :text="cfg.intro" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <ForecastProfileBar v-if="stationScoped" :kind="stationKind" />
    <RegionDataBanner v-else />
    <div class="toolbar">
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px" />
      <span class="lbl">类型</span>
      <el-select v-model="fType" placeholder="全部" clearable size="small" style="width: 150px"><el-option v-for="t in types" :key="t" :label="typeName(t)" :value="t" /></el-select>
      <span class="lbl">数据点</span>
      <el-radio-group v-model="npts" size="small" @change="render"><el-radio-button :value="24">24 点</el-radio-button><el-radio-button :value="96">96 点</el-radio-button></el-radio-group>
      <el-button size="small" type="primary" @click="load">搜索</el-button>
      <el-button size="small" @click="reset">重置</el-button>
      <span class="spacer" />
      <el-button size="small" color="#fc8452" @click="exportCsv">导出</el-button>
    </div>

    <TslibOnlineForecastPanel
      :target="onlineTarget"
      :target-date="range?.[1] || (typeof route.query.date === 'string' ? route.query.date : '')"
      :title="`${cfg.valueLabel || '预测'} · 深度模型在线预测`"
    />

    <el-card shadow="never" class="mb">
      <el-table ref="tableRef" :data="filtered" border size="default" height="320" class="big" @selection-change="onSel">
        <el-table-column type="selection" width="44" fixed />
        <el-table-column prop="_idx" label="序号" width="62" fixed align="center" />
        <el-table-column :prop="dateField" label="日期" width="118" fixed sortable />
        <el-table-column v-if="hasDrrq" prop="drrq" label="导入日期" width="118" sortable />
        <el-table-column label="类型" width="140"><template #default="{ row }">{{ typeName(row[typeField]) }}</template></el-table-column>
        <el-table-column label="均值" width="100" align="right" sortable :sort-by="(r:any)=>meanOf(r)"><template #default="{ row }">{{ meanOf(row) ?? '-' }}</template></el-table-column>
        <el-table-column v-for="(p, i) in labels" :key="i" :label="p" width="78" align="right" sortable :sort-by="(r:any)=>valsOf(r)[i]"><template #default="{ row }">{{ valsOf(row)[i] ?? '-' }}</template></el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size: var(--font-md)">{{ cfg.valueLabel || '预测' }}曲线 · 已选 {{ selected.length }} 行（{{ npts }} 点）</span></template>
      <div ref="chartRef" class="chart chart-host"></div>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据： · 行 -->
  </div>
</template>

<style scoped>
.mt { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.big :deep(.el-table__cell) { font-size: var(--font-md); }
.big :deep(th .cell) { font-weight: 600; color: var(--el-text-color-primary); }
.chart { height: 300px; width: 100%; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
/* 移动端:筛选条纵排,控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar .spacer { display: none; }
}
</style>
