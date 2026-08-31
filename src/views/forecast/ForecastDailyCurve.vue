<script setup lang="ts">
// 通用「单类型 · 复选表格 + 多选联动折线」预测视图(cfg 驱动)。复用于:
//  E3 公司负荷预测(zptjg tag12)/ E4 公司错位负荷(zptsj tag61)/ E8 日前竞价空间(zptjg tag27)/ E9 日前火电出力(zptjg tag28)。
// 经典款:运行日期区间筛选;表格复选→下方图按勾选行显示 96 点曲线,图例随勾选实时显示。
// cfg(route.meta.cfg): { family, match, dateField, totalField, meanField, valueLabel, unit, typeFilter? }
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
// 厂站绑定页(公司负荷预测)：数据源绑定到 {地区·公司·厂站} profile，走 /api/company/forecast。
const stationScoped = !!cfg.stationScoped
const stationKind = (cfg.stationKind ?? 'gsfhyc') as 'zxztqa' | 'zgnrx' | 'gsfhyc'
const dateField = cfg.dateField || 'date'
const totalField = cfg.totalField || 'hj'
const meanField = cfg.meanField || 'jz'
const unit = cfg.unit || ''
const L96 = Array.from({ length: 96 }, (_, i) => { const m = (i + 1) * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
const PTS = Array.from({ length: 96 }, (_, i) => `p${i + 1}`)
const curve = (r: any) => PTS.map((p) => r[p] ?? null)
const totalOf = (r: any) => { if (r[totalField] != null) return +(+r[totalField]).toFixed(2); const v = curve(r).filter((x) => x != null) as number[]; return v.length ? +v.reduce((a, b) => a + Number(b), 0).toFixed(2) : '-' }
const meanOf = (r: any) => { if (r[meanField] != null) return +(+r[meanField]).toFixed(2); const v = curve(r).filter((x) => x != null) as number[]; return v.length ? +(v.reduce((a, b) => a + Number(b), 0) / v.length).toFixed(2) : '-' }

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const range = ref<[string, string] | null>(null)
const urlRange: [string, string] | null = (typeof route.query.from === 'string' && typeof route.query.to === 'string') ? [route.query.from as string, route.query.to as string] : (typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null)
const selected = ref<any[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const tableRef = ref()
const curveChart = useEChart(chartRef, { render })
let loadGeneration = 0

const hasDrrq = computed(() => rows.value.length && 'drrq' in rows.value[0])
const filtered = computed(() => rows.value.filter((r) => (!range.value || (r[dateField] >= range.value[0] && r[dateField] <= range.value[1]))))
const onlineTarget = computed(() => String(
  cfg.mlTarget
  || (stationKind === 'gsfhyc' ? 'load' : '')
  || (stationScoped ? 'renewable' : '')
  || (String(cfg.match ?? '').includes('tag27') ? 'bidding_space' : '')
  || (String(cfg.match ?? '').includes('tag28') ? 'renewable' : '')
  || 'load'
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
      res = await fetchCaptured<any>(cfg.family, cfg.match)
    }
    if (generation !== loadGeneration) return
    let all = res?.rows || res?.data || []
    if (cfg.typeFilter != null) all = all.filter((r: any) => String(r.type) === String(cfg.typeFilter))
    all = all.slice().sort((a: any, b: any) => (a[dateField] < b[dateField] ? 1 : -1)).map((r: any, i: number) => ({ ...r, _idx: i + 1 }))
    rows.value = all
    const ds = [...new Set(all.map((r: any) => r[dateField]))].sort() as string[]
    if (ds.length) range.value = urlRange ?? [ds[Math.max(0, ds.length - 7)], ds[ds.length - 1]]
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
function reset() { const ds = [...new Set(rows.value.map((r) => r[dateField]))].sort() as string[]; range.value = ds.length ? [ds[Math.max(0, ds.length - 7)], ds[ds.length - 1]] : null; tableRef.value?.clearSelection() }
function onSel(rs: any[]) { selected.value = rs; render() }

function clearViewState() {
  rows.value = []
  selected.value = []
  range.value = null
  tableRef.value?.clearSelection?.()
}

function renderEmptyChart(text = '暂无数据') {
  curveChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function render() {
  const cc = chartChrome()
  const series = selected.value.map((r) => ({ name: r[dateField], type: 'line', smooth: false, showSymbol: false, connectNulls: true, data: curve(r) }))
  curveChart.setOption({
    ...emptyOverlay(!series.length, '勾选表格行查看其 96 点曲线（可多选,图例随勾选行数显示）'),
    // 底部布局:图例顶部居中 scroll,工具栏右下角(cfg 驱动,覆盖负荷/错位/竞价/火电 tab)
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ unit }), confine: true },
    toolbox: bottomToolbox(`${cfg.valueLabel || '预测'}曲线`, 8),
    dataZoom: insideZoom(),
    grid: { left: 60, right: 20, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: L96, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 11 } },
    yAxis: { type: 'value', name: unit, scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

function exportCsv() {
  const rs = selected.value.length ? selected.value : filtered.value
  if (!rs.length) { ElMessage.warning('无可导出的数据'); return }
  const head = ['序号', '日期', ...(hasDrrq.value ? ['导入日期'] : []), '合计', '均值', ...L96]
  downloadCsv(`${(route.meta as any).title || '预测'}_96点`, head,
    rs.map((r) => [r._idx, r[dateField], ...(hasDrrq.value ? [r.drrq] : []), totalOf(r), meanOf(r), ...curve(r)]))
  ElMessage.success(`已导出 ${rs.length} 行`)
}

onMounted(load)

// 厂站绑定页随 {厂站/公司/地区} 变化重载；普通采集页随地区变化重载。
if (stationScoped) onForecastChange(load)
else onRegionChange(load)
</script>

<template>
  <div class="dc" v-loading="loading">
    <ForecastIntro v-if="cfg.intro" :text="cfg.intro" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <ForecastProfileBar v-if="stationScoped" :kind="stationKind" />
    <RegionDataBanner v-else />
    <div class="toolbar">
      <span class="lbl">运行日期</span>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px" />
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
        <el-table-column label="合计" width="120" align="right" sortable :sort-by="(r:any)=>+totalOf(r)"><template #default="{ row }">{{ totalOf(row) }}</template></el-table-column>
        <el-table-column label="均值" width="100" align="right" sortable :sort-by="(r:any)=>+meanOf(r)"><template #default="{ row }">{{ meanOf(row) }}</template></el-table-column>
        <el-table-column v-for="(p, i) in PTS" :key="p" :prop="p" :label="L96[i]" width="78" align="right" sortable><template #default="{ row }">{{ row[p] ?? '-' }}</template></el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size: var(--font-md)">{{ cfg.valueLabel || '预测' }}曲线 · 已选 {{ selected.length }} 天（96 点）</span></template>
      <div ref="chartRef" class="chart chart-host"></div>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据： · 行 -->
  </div>
</template>

<style scoped>
.dc { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
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
