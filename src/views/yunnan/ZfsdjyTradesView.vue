<script setup lang="ts">
// 分时段交易 (zfsdjy/list) — 精修版,对照 B2:可勾选表格 + 多选联动折线。
//  表格:复选 + 序号 + 售电公司(可隐藏) + 交易日期/标的日期一二/交易类型/数据类型/操作人员/操作时间 + 合计 + 24点。
//  排序:交易日期/标的日期/操作时间/合计/各时点;筛选:交易日期/运行日期(标的)/交易类型/数据类型;导出:24点/96点。
//  图表:勾选行→对应折线(24点,仅连有数据的点,空点折过去),多选多条。
// 数据:GET /sdpt/zfsdjy/list -> 39行 {jyrq,bdrq1,bdrq2,jylx,sjlx,czry,czsj,heji,p1..p24}。字典 sdpt_fsdjylx/fsdsjlx。
import { onMounted, ref, computed, nextTick, watch } from 'vue'
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
import { exportCsv } from '@/utils/exportCsv'

const JYLX: Record<string, string> = { '01': '年度集中分时', '182': '年度集中均分', '03': '年度合计', '180': '年度双边分时', '183': '年度双边均分', '184': '年度双边自定义', '220': '年度绿电分时', '221': '年度绿电均分', '222': '年度绿电自定义', '51': '年度新能源', '181': '年度平台挂牌', '210': '多月绿电分时', '209': '多月绿电均分', '208': '多月绿电自定义', '61': '多月火电', '11': '月集中', '12': '月滚动', '13': '月合计', '211': '月度绿电', '140': '月度政府授权', '170': '月度双边分时', '171': '月度平台挂牌', '52': '月度新能源', '191': '月内平台挂牌', '190': '月内集中', '53': '月内新能源', '21': '旬集中', '22': '旬滚动', '23': '旬合计', '32': '日滚动', '33': '日合计', '81': '省间中长期交易', '200': '周度', '43': '总合计' }
const SJLX: Record<string, string> = { '10': '预估电量', '11': '最小购买比例', '12': '最小购买电量', '13': '最大购买比例', '14': '最大购买电量', '21': '买方总申报电量', '22': '卖方总申报电量', '23': '成交电量', '24': '出清电价', '31': '申报电量', '32': '申报电价', '41': '总交易量', '42': '最高价', '43': '最低价', '44': '加权价格', '45': '中位数价格', '50': '买卖方向', '51': '持仓电量', '52': '持仓均价', '53': '持仓比例' }
const jylxN = (v: any) => JYLX[String(v)] || v
const sjlxN = (v: any) => SJLX[String(v)] || v
const PTS = Array.from({ length: 24 }, (_, i) => `p${i + 1}`)
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i + 1).padStart(2, '0')}:00`)

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const showSdgs = ref(true)
const selected = ref<any[]>([])
const fJyrq = ref(''), fBdrq = ref(''), fJylx = ref(''), fSjlx = ref('')
const chartRef = ref<HTMLDivElement | null>(null)
const chart = useEChart(chartRef, { render })
const tableRef = ref()
const routeCapability = computed(() => getRegionCapabilityForPath('/zcqjy/zfsdjy', currentRegion.value.id))
const requestEnabled = computed(() => !routeCapability.value || routeCapability.value.status === 'available')
let loadGeneration = 0
// 主筛选(交易/运行日期与类型) ⇄ 路由 query:刷新或分享链接后筛选状态可还原
useQuerySync({ jyrq: fJyrq, bdrq: fBdrq, jylx: fJylx, sjlx: fSjlx })

const uniq = (k: string) => [...new Set(rows.value.map((r) => r[k]).filter(Boolean))]
const filtered = computed(() => rows.value.filter((r) =>
  (!fJyrq.value || r.jyrq === fJyrq.value) && (!fBdrq.value || r.bdrq1 === fBdrq.value) &&
  (!fJylx.value || String(r.jylx) === fJylx.value) && (!fSjlx.value || String(r.sjlx) === fSjlx.value)))

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  renderEmptyChart()
  if (!requestEnabled.value) {
    loading.value = false
    return
  }
  try {
    const res = await fetchCaptured<any>(MIDLONG_TIME_BLOCK_FAMILY, 'list')
    if (generation !== loadGeneration) return
    rows.value = (res?.rows || res?.data || []).map((r: any, i: number) => ({ ...r, _idx: i + 1 }))
    await nextTick()
    if (generation !== loadGeneration) return
    render()
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    renderEmptyChart(e instanceof Error ? e.message : '加载失败')
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
function reset() { fJyrq.value = fBdrq.value = fJylx.value = fSjlx.value = ''; tableRef.value?.clearSelection() }

function clearViewState() {
  rows.value = []
  selected.value = []
  tableRef.value?.clearSelection?.()
}

function renderEmptyChart(text = '暂无分时段交易数据') {
  chart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

function onSel(rows2: any[]) { selected.value = rows2; render() }
function render() {
  const cc = chartChrome()
  // 单位按数据类型区分:名称含"价"的为价格(元/MWh),其余为电量(MWh)
  const units: Record<string, string> = {}
  const series = selected.value.map((r) => {
    const name = `${r.jyrq} ${jylxN(r.jylx)}·${sjlxN(r.sjlx)}`
    units[name] = /价/.test(String(sjlxN(r.sjlx))) ? '元/MWh' : 'MWh'
    return { name, type: 'line', step: 'start', showSymbol: true, symbolSize: 4, connectNulls: true, data: PTS.map((p) => r[p] ?? null) }
  })
  chart.setOption({
    ...emptyOverlay(!series.length, '勾选表格行查看其 24 点曲线（可多选）'),
    // 底部布局:图例顶部居中 scroll,工具栏右下角
    legend: bottomLayoutLegend({ textStyle: { fontSize: 11 } }),
    tooltip: { ...axisTooltip({ units }), confine: true },
    toolbox: bottomToolbox('分时段交易曲线', 8),
    grid: { left: 56, right: 20, top: 48, bottom: 48 },
    xAxis: { type: 'category', data: HOURS, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel, interval: 1 } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series
  }, { notMerge: true })
}

// 导出走公共 exportCsv 工具(自动转义 + UTF-8 BOM)
function exportPoints(npts: number) {
  const rs = selected.value.length ? selected.value : filtered.value
  if (!rs.length) { ElMessage.warning('请先勾选要导出的行'); return }
  const head = ['序号', '售电公司', '交易日期', '标的日期一', '标的日期二', '交易类型', '数据类型', '操作人员', '操作时间', '合计', ...Array.from({ length: npts }, (_, i) => `p${i + 1}`)]
  const body = rs.map((r) => [
    r._idx, r.sdgs, r.jyrq, r.bdrq1, r.bdrq2, jylxN(r.jylx), sjlxN(r.sjlx), r.czry, r.czsj, r.heji,
    ...Array.from({ length: npts }, (_, i) => r['p' + (i + 1)] ?? '')
  ])
  exportCsv(`分时段交易_${npts}点`, head, body)
  ElMessage.success(`已导出 ${rs.length} 行 · ${npts} 点`)
}

onMounted(load)
watch(filtered, () => nextTick(() => tableRef.value?.doLayout?.()))

onRegionChange(load)
</script>

<template>
  <div class="tr" v-loading="loading">
    <RegionDataBanner :families="[MIDLONG_TIME_BLOCK_FAMILY]" />
    <CapabilitySupportBadge path="/zcqjy/zfsdjy" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div v-if="!requestEnabled" class="degraded-card">
      <div class="degraded-title">当前地区暂无分时段交易台账</div>
      <div class="degraded-text">
        云南未接入 `sdpt_zfsdjy/list` 真实交易台账，外部数据到货后由 B 类清单接入；本页不会请求山西台账或模拟回放。
      </div>
    </div>
    <template v-else>
    <div class="toolbar">
      <el-select v-model="fJyrq" placeholder="交易日期" clearable size="small" style="width: 132px"><el-option v-for="v in uniq('jyrq')" :key="v" :label="v" :value="v" /></el-select>
      <el-select v-model="fBdrq" placeholder="运行日期" clearable size="small" style="width: 132px"><el-option v-for="v in uniq('bdrq1')" :key="v" :label="v" :value="v" /></el-select>
      <el-select v-model="fJylx" placeholder="交易类型" clearable size="small" style="width: 140px"><el-option v-for="v in uniq('jylx')" :key="v" :label="jylxN(v)" :value="String(v)" /></el-select>
      <el-select v-model="fSjlx" placeholder="数据类型" clearable size="small" style="width: 132px"><el-option v-for="v in uniq('sjlx')" :key="v" :label="sjlxN(v)" :value="String(v)" /></el-select>
      <el-button size="small" @click="reset">重置</el-button>
      <el-checkbox v-model="showSdgs" size="small" style="margin-left: 4px">显示售电公司列</el-checkbox>
      <span class="spacer" />
      <el-button size="small" color="#fc8452" @click="exportPoints(24)">导出 24 点</el-button>
      <el-button size="small" color="#fc8452" @click="exportPoints(96)">导出 96 点</el-button>
    </div>

    <el-card shadow="never" class="mb">
      <el-table ref="tableRef" :data="filtered" height="360" border size="default" class="big" @selection-change="onSel" highlight-current-row>
        <el-table-column type="selection" width="44" fixed />
        <el-table-column prop="_idx" label="序号" width="64" fixed align="center" />
        <el-table-column v-if="showSdgs" prop="sdgs" label="售电公司" width="110" />
        <el-table-column prop="jyrq" label="交易日期" width="118" sortable />
        <el-table-column prop="bdrq1" label="标的日期一" width="118" sortable />
        <el-table-column prop="bdrq2" label="标的日期二" width="118" sortable />
        <el-table-column label="交易类型" width="124"><template #default="{ row }">{{ jylxN(row.jylx) }}</template></el-table-column>
        <el-table-column label="数据类型" width="100"><template #default="{ row }">{{ sjlxN(row.sjlx) }}</template></el-table-column>
        <el-table-column prop="czry" label="操作人员" width="92" />
        <el-table-column prop="czsj" label="操作时间" width="160" sortable />
        <el-table-column prop="heji" label="合计" width="100" align="right" sortable />
        <el-table-column v-for="(p, i) in PTS" :key="p" :prop="p" :label="HOURS[i]" width="78" align="right" sortable />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size:13px">分时曲线 · 已选 {{ selected.length }} 行（24 点,仅连有数据的点）</span></template>
      <div ref="chartRef" class="chart chart-host"></div>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zfsdjy/list · 条 · 字典 sdpt_fsdjylx/fsdsjlx -->
    </template>
  </div>
</template>

<style scoped>
.tr { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .spacer { flex: 1; }
.big :deep(.el-table__cell) { font-size: 13px; }
.big :deep(th .cell) { font-weight: 600; color: var(--el-text-color-primary); }
.chart { height: 300px; width: 100%; }
.mb { margin-bottom: 12px; }
.degraded-card { border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, var(--line)); background: color-mix(in srgb, var(--warning, #d97706) 8%, var(--panel)); border-radius: 8px; padding: 14px 16px; color: var(--text); }
.degraded-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.degraded-text { font-size: 13px; color: var(--muted); line-height: 1.6; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }

/* 移动端:筛选条纵向堆叠,控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar :deep(.el-select),
  .toolbar .el-button { width: 100% !important; margin-left: 0; }
  .toolbar .spacer { display: none; }
}
</style>
