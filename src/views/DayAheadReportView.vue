<script setup lang="ts">
// 日前上报 (zrqsb/list) — 精修版,对照 C1:上表格 + 下多轴图。
//  表格:运行日期筛选 + 搜索/重置;主要两行 日前电量/预估电量(dl),合计 + 96 点。
//  图表:X=96点;左轴电量MWh;右轴 价格0-800 / 价差-800~800 / 策略0-2 / zcqjj(自适应)。图例从数据各组扫出。
// 数据:POST /sdpt/zrqsb/list(按天) -> {dl电量, jg价格, jgc价格差, zcqjj(语义待核实#1468), jq/jq2/cl/zxcl策略, ...}。
//  ⚠️ 按天切片,采集文件名是内容 hash 不含日期。可选日期与取数都走服务端内容日期索引
//     (#1531)：日期清单来自 /api/real-list 的 date 字段,取数直接 match=<日期>。
//     此前这里硬编码了一张 91 条的 date→hash 表(第二份事实源,采集扩月即过期),已删除。
//     源 capture-raw/<region>/sdpt_zrqsb/。
//  ⚠️ 采集快照拍摄于 2026-06-03(见 .meta.json capturedAt),其后为平台「未来日」空壳:
//     2026-06-05~06-30 共 26 天 dl(申报电量) 全空,6/08 起连 jg 也空、仅剩 zcqjj。
//     故下拉框对这些日期显式标注并禁选,避免「选了日期却什么都不出」的静默空白。
import { onMounted, ref, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentRegion } from '@/services/region/regionContext'
import { useCapturedCapability } from '@/composables/useCapturedCapability'
import { fetchSpotDayAheadReportContract, SPOT_DAY_AHEAD_REPORT_FAMILY } from '@/services/data/contracts'
import { DECLARATION_PRICE_TYPE_CODES, DECLARATION_QTY_TYPE_CODES } from '@/data/declarationCodes'
import { fetchCapturedDates } from '@/services/captured'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import CapabilityDegradedCard from '../components/CapabilityDegradedCard.vue'
import { chartChrome } from '../composables/useTheme'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import { POINTS_96 } from '@/utils/spotPoints96'
import { resolveDefaultRunDate } from '@/utils/spotDateDefaults'

// 申报电量(dl)最后一个有真实内容的运行日；其后到 06-30 均为采集时点的「未来日」空壳。
// 逐日核对 91 个采集文件得出（scripts 无常驻校验，改采集范围时同步本常量与上方注释）。
const ENERGY_LAST_DATE = '2026-06-04'
const hasEnergy = (date: string) => date <= ENERGY_LAST_DATE
// 宽表「type→口径」字典不再本页硬编码（#1529 病灶：取错 type 不报错只给错数字，#1498 实发）——
// 唯一事实源 shared/schema/declaration-codes.mjs（主仓），经 src/data 出口消费（分层守卫），
// 与 Python 侧 declaration_codes_gen.py 同源；改口径只改事实源。
const ZPTQX = DECLARATION_QTY_TYPE_CODES
const ZPTJG = DECLARATION_PRICE_TYPE_CODES
// 组 → 轴/字典/类型/tooltip 单位
// zcqjj：原标注「持仓比例 %」并挂 min:0/max:100 的固定轴，但逐日实测值域为 86~532
// （4/15: 120~478.1、6/04: 86~531.8、6/10: 99.5~532.5），整条线恒被裁到轴外不可见，这是真 bug。
// ⚠️ 但值域超 100 只能证伪「0~100 的比例轴」，不足以证明它是价格（拿元/MWh 量级去佐证是循环论证）；
// 平台未提供 zrqsb 分组字典，语义待核实（#1468）。故这里只修可见性、不臆断命名：
// 保留原始字段名 `zcqjj` 作图例、不标单位，挂独立自适应轴（scale:true），刻意不并入价格轴，
// 以免一个可能是持仓类的指标被读成电价而误导交易分析。
const GROUPS = [
  { key: 'dl', axis: 0, dict: ZPTQX, base: '电量', kind: 'line', unit: 'MWh' },
  { key: 'jg', axis: 1, dict: ZPTJG, base: '价格', kind: 'line', unit: '元/MWh' },
  { key: 'jgc', axis: 2, base: '价格差', kind: 'bar', unit: '元/MWh' },
  { key: 'zcqjj', axis: 4, base: 'zcqjj', kind: 'line', unit: '' },
  { key: 'jq', axis: 3, dict: ZPTQX, base: '策略', kind: 'line', unit: '' },
  { key: 'jq2', axis: 3, dict: ZPTQX, base: '策略', kind: 'line', unit: '' },
  { key: 'cl', axis: 3, dict: ZPTQX, base: '策略', kind: 'line', unit: '' },
  { key: 'zxcl', axis: 3, dict: ZPTQX, base: '策略', kind: 'line', unit: '' }
] as any[]
const COL = ['#5470c6', '#ee6666', '#91cc75', '#fac858', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc']
const curve = (r: any) => Array.from({ length: 96 }, (_, k) => r['p' + (k + 1)] ?? null)
const total = (r: any) => r.hj != null ? r.hj : +(curve(r).filter((x) => x != null) as number[]).reduce((a, b) => a + Number(b), 0).toFixed(2)

const loading = ref(true)
const error = ref('')
// 取数成功但内容为空时的诚实说明（区别于 error）。按实际返回判定，不依赖 ENERGY_LAST_DATE 硬编码，
// 这样即使日后补采使常量过期，提示仍与真实数据一致。
const notice = ref('')
const route = useRoute()
const qDate = typeof route.query.date === 'string' ? route.query.date : ''
// 初始仍以回退常量兜底；onMounted 在日期清单到位后按规格改写为「清单最新可用日」
const runDate = ref(qDate || ENERGY_LAST_DATE)
const data = ref<any>(null)
const dlRows = ref<any[]>([])
const chartRef = ref<HTMLDivElement | null>(null)
const reportChart = useEChart(chartRef, { render })

const dates = ref<string[]>([])
function nameOf(g: any, r: any) { return g.dict && r.type != null && g.dict[String(r.type)] ? g.dict[String(r.type)] : (r.type != null ? `${g.base}·${r.type}` : g.base) }
// 回放取数能力降级判定四件套：单源 composable（原与本页逐字重复于 DayAheadEnergyView）
const { capabilitySupports, isCapabilityDegraded, capabilityNote } = useCapturedCapability('/xhjy/zrqsb')
let loadGeneration = 0

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  if (isCapabilityDegraded.value) {
    await nextTick()
    if (generation !== loadGeneration) return
    renderEmptyChart('当前地区暂无日前上报真实源')
    loading.value = false
    return
  }
  if (dates.value.length && !dates.value.includes(runDate.value)) {
    ElMessage.warning('该运行日期未采集')
    renderEmptyChart('该运行日期未采集')
    loading.value = false
    return
  }
  reportChart.showLoading()
  try {
    const contract = await fetchSpotDayAheadReportContract({
      region: currentRegion.value.id,
      date: runDate.value,
      // 服务端按内容日期索引选文件（#1531）：直接传日期，不再由前端换算 hash。
      match: runDate.value
    })
    if (generation !== loadGeneration) return
    data.value = contract.blocks.day_ahead_report.groups
    dlRows.value = (data.value.dl || []).map((r: any, i: number) => ({ ...r, _idx: i + 1, _name: nameOf(GROUPS[0], r) }))
    notice.value = dlRows.value.length
      ? ''
      : hasEnergy(runDate.value)
        ? `${runDate.value} 平台返回中无申报电量（dl 组为空），仅有价格/策略等其余分组。`
        : `${runDate.value} 晚于采集快照的最后有效申报日 ${ENERGY_LAST_DATE}：采集时该日尚属「未来日」，平台未下发申报电量，仅保留部分价格/均价曲线。`
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
      reportChart.hideLoading()
    }
  }
}
function reset() { runDate.value = ENERGY_LAST_DATE; load() }

function clearViewState() {
  data.value = null
  dlRows.value = []
  notice.value = ''
}

function renderEmptyChart(text = '暂无数据') {
  reportChart.setOption({ ...emptyOverlay(true, text) }, { notMerge: true })
}

// 合计列排序（列无 prop，走自定义比较）与表格导出
const sortByTotal = (a: any, b: any) => Number(total(a)) - Number(total(b))
function exportTable() {
  exportCsv(
    `日前上报电量_${runDate.value}`,
    ['序号', '类型', '合计', ...POINTS_96],
    dlRows.value.map((r: any) => [r._idx, r._name, total(r), ...Array.from({ length: 96 }, (_, k) => r['p' + (k + 1)] ?? '')])
  )
}

function render() {
  if (!chartRef.value || !data.value) return
  const cc = chartChrome()
  const series: any[] = []; let ci = 0
  const seriesUnits: Record<string, string> = {}
  GROUPS.forEach((g) => {
    const arr = data.value[g.key]
    if (!Array.isArray(arr)) return
    arr.forEach((r: any) => {
      if (!curve(r).some((x) => x != null)) return
      const color = COL[ci++ % COL.length]
      seriesUnits[nameOf(g, r)] = g.unit ?? ''
      const nm = nameOf(g, r)
      if (g.kind === 'bar') series.push({ name: nm, type: 'bar', yAxisIndex: g.axis, data: curve(r), barMaxWidth: 4, itemStyle: { color: (p: any) => (p.value >= 0 ? '#ee4d4d' : '#3ba776') } })
      else {
        // 96 点值按 15min 时段恒定，真实形态是阶梯线(step)而非平滑样条；预测/AI/回归类曲线虚线弱化，出清与实际实线
        const isForecast = /预测|预估|AI|回归/.test(nm)
        series.push({
          name: nm, type: 'line', yAxisIndex: g.axis, step: 'start', showSymbol: false, connectNulls: true,
          lineStyle: { width: isForecast ? 1.2 : 1.8, color, ...(isForecast ? { type: 'dashed' as const, opacity: 0.8 } : {}) },
          itemStyle: { color }, emphasis: { focus: 'series' }, data: curve(r)
        })
      }
    })
  })
  reportChart.setOption({
    ...emptyOverlay(!series.length),
    // 底部布局:图例顶部居中 scroll,工具栏右下角(top:56 仍给 5 个右侧偏移轴 name 让位)
    legend: bottomLayoutLegend({ textStyle: { fontSize: 10 } }),
    tooltip: { ...axisTooltip({ units: seriesUnits }), confine: true },
    toolbox: bottomToolbox('日前上报曲线', 8),
    dataZoom: insideZoom(),
    grid: { left: 60, right: 232, top: 56, bottom: 56 },
    xAxis: { type: 'category', data: POINTS_96, boundaryGap: false, axisLabel: { color: cc.axisLabel, fontSize: 9, interval: 11 } },
    yAxis: [
      { type: 'value', name: '电量 MWh', min: 0, scale: true, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { lineStyle: { color: cc.splitLine } } },
      { type: 'value', name: '价格', min: 0, max: 800, position: 'right', offset: 0, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } },
      { type: 'value', name: '价差', min: -800, max: 800, position: 'right', offset: 58, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } },
      { type: 'value', name: '策略', min: 0, max: 2, position: 'right', offset: 116, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } },
      // zcqjj 专用轴：语义未定（#1468），故 scale 自适应而非写死量纲，原 min:0/max:100 正是曲线恒不可见的成因。
      { type: 'value', name: 'zcqjj', scale: true, position: 'right', offset: 174, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { color: cc.axisLabel, fontSize: 9 }, splitLine: { show: false } }
    ],
    series
  }, { notMerge: true })
}

// 日期清单是否可用：不可用时页面须明示「当前为回退日」，不得让回退日伪装成最新数据
const datesUnavailable = ref(false)

async function loadDates() {
  try {
    dates.value = await fetchCapturedDates(SPOT_DAY_AHEAD_REPORT_FAMILY, currentRegion.value.id)
    datesUnavailable.value = false
  } catch {
    // 清单取不到不阻断主取数：下拉退化为空、日期仍可由 URL/默认值直取（服务端按日期索引选文件）
    dates.value = []
    datesUnavailable.value = true
  }
}

onMounted(async () => {
  await loadDates()
  // 默认运行日（spot-trading-date-defaults）：URL 深链 > 清单最新**可用**日 > 回退常量。
  // 「可用」按本页口径 = hasEnergy（含申报电量的采集日）；06-05 起为无申报的空壳日，
  // 只被采集、不构成可作业的运行日，故从默认候选中剔除（下拉仍可见且标注禁选）。
  runDate.value = resolveDefaultRunDate(qDate, dates.value.filter(hasEnergy), ENERGY_LAST_DATE)
  load()
})

onRegionChange(async () => {
  // 各地区采集覆盖不同：切区先重取日期清单，再取数（否则下拉留着上一地区的日期）
  await loadDates()
  // 深链日期只约束首次进入；切区后同样按「清单最新可用日 > 回退」重定，避免落到新地区未采集的日期
  runDate.value = resolveDefaultRunDate('', dates.value.filter(hasEnergy), ENERGY_LAST_DATE)
  load()
})
</script>

<template>
  <div class="rep" v-loading="loading">
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <RegionDataBanner :families="[SPOT_DAY_AHEAD_REPORT_FAMILY]" />
    <CapabilitySupportBadge path="/xhjy/zrqsb" />
    <CapabilityDegradedCard
      v-if="isCapabilityDegraded"
      title="日前上报暂未接入当前地区真实源"
      :region-name="currentRegion.name"
      :note="capabilityNote"
      :supports="capabilitySupports"
    />
    <template v-else>
      <div class="toolbar">
        <span class="lbl">运行日期</span>
        <!-- @change 直接重载：此前只有「搜索」按钮触发 load，改下拉日期页面纹丝不动，看起来像「切换日期不显示」。 -->
        <el-select v-model="runDate" filterable size="small" style="width: 190px" @change="load">
          <el-option v-for="d in dates" :key="d" :label="d" :value="d">
            <span>{{ d }}</span>
            <span v-if="!hasEnergy(d)" class="opt-tag">无申报电量</span>
          </el-option>
        </el-select>
        <span class="lbl">售电公司</span>
        <el-select model-value="默认公司" size="small" style="width: 120px" disabled><el-option label="默认公司" value="默认公司" /></el-select>
        <el-button size="small" type="primary" @click="load">搜索</el-button>
        <el-button size="small" @click="reset">重置</el-button>
      </div>

      <!-- 日期清单不可用：明示当前是回退日，避免回退日被误读成「数据源确认的最新日」 -->
      <el-alert
        v-if="datesUnavailable && !qDate"
        type="info"
        :closable="false"
        :title="`采集日期清单不可用，默认展示回退日 ${ENERGY_LAST_DATE}（非数据源确认的最新日）`"
        show-icon
        class="mb"
      />

      <!-- 取数成功但无申报电量：显式说明为何表格与曲线为空，避免静默空白页 -->
      <el-alert v-if="notice" type="warning" :closable="false" :title="notice" show-icon class="mb" />

      <el-card shadow="never" class="mb">
        <template #header>
          <div class="card-head">
            <span style="font-weight:600;font-size: var(--font-md)">{{ runDate }} · 日前上报电量（合计 + 96 点）</span>
            <el-button size="small" :disabled="!dlRows.length" @click="exportTable">导出CSV</el-button>
          </div>
        </template>
        <el-table :data="dlRows" border size="small" height="160">
          <el-table-column prop="_idx" label="序号" width="60" fixed align="center" />
          <el-table-column prop="_name" label="类型" width="120" fixed />
          <el-table-column label="合计" width="110" align="right" fixed sortable :sort-method="sortByTotal"><template #default="{ row }">{{ total(row) }}</template></el-table-column>
          <el-table-column v-for="(p, i) in POINTS_96" :key="i" :label="p" width="76" align="right"><template #default="{ row }">{{ row['p' + (i + 1)] ?? '-' }}</template></el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header><span style="font-weight:600;font-size: var(--font-md)">日前上报曲线 · 电量(左) / 价格·价差·策略·zcqjj(右)</span></template>
        <div ref="chartRef" class="chart chart-host"></div>
      </el-card>
    </template>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：POST /sdpt/zrqsb/list · 按天 · 字典 sdpt_zptqx_type / sdpt_zptjg_type_ycjg -->
  </div>
</template>

<style scoped>
.rep { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
/* 下拉里对「采集时属未来日、无申报电量」的运行日做可见标注（仍可选中查看其余分组） */
.opt-tag { margin-left: 8px; font-size: var(--font-xs); color: var(--el-color-warning); }
.chart { height: 520px; width: 100%; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mb { margin-bottom: 12px; }
/* 移动端：筛选工具条纵排，控件占满整行便于点按 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
}
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
</style>
