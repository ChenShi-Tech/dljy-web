<script setup lang="ts">
// 中长期售电月度持仓（/zcqjy/positions，dljy#2939，MP-01/02/03/06）。
// - 每份已确认义务只取一个有效版本；草稿、待核对、框架协议、已作废、内部估算都不计入，并在页面列出排除项。
// - 缺月度分解的电量进入「跨期未分解池」，不画成 0、不按月均摊；含未分解合同的月份单独标出。
// - 价格只在同币种、同含税口径、同价格构成内求均价；不可比时分组展示。金额是合同量价名义金额，不是结算收入。
// - 支持历史认知时点（asOf）：只看当时已录入且已确认的版本，迟到的更正不改写过去的视图。
// - 导出用「加载当前结果时的查询快照」：改了筛选没点「查询」时，导出的文件仍与页面所见一致（dljy#2983）。
// - 本页只读合同底账，不调用现货、预测或厂侧接口；服务失败显示错误，不回退示意数值。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import ChartCard from '@/components/common/ChartCard.vue'
import MetricTile from '@/components/common/MetricTile.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'
import { currentRegion } from '@/services/region/regionContext'
import { cssVar } from '@/composables/useTheme'
import { lastDayOfMonth } from '@/utils/calendarDate'
import { withAlpha } from '@/services/chart/chartStyle'
import {
  CompanyNotSelectedError, exportPositions, fetchCapabilities, fetchPositions, fetchSubjects, midlongFailureOf,
} from '@/services/midlong/midlongApi'
import { p2ModuleOn } from '@/services/midlong/midlongP2Api'
import {
  ENERGY_ATTRIBUTES, ENERGY_ATTRIBUTE_LABELS, PRICE_COMPONENT_LABELS, PRODUCT_KINDS, PRODUCT_KIND_LABELS, TAX_BASIS_LABELS,
  TRADE_METHODS, TRADE_METHOD_LABELS,
  type MidlongCapabilities, type MidlongPositionMonth, type MidlongPositionQuery, type MidlongPositionReport, type MidlongSubject,
} from '@/services/midlong/midlongTypes'
import {
  averagePriceLabel, createLoadGuard, downloadCsv, fmtAmount, fmtPrice, fmtQuantity, fmtRatio, monthQuantityLabel, notionalAmountLabel,
} from '@/services/midlong/midlongFormat'
import { useGuideForm, useGuideState } from '@/features/guide/bridge'
import { FORM, STATE } from '@/features/guide/midlong/anchors'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const report = ref<MidlongPositionReport | null>(null)
// 当前结果对应的查询快照：与 report 同生共死（同一时刻写入、清空时机一致），供导出使用（dljy#2983）。
const appliedQuery = ref<MidlongPositionQuery | null>(null)
const subjects = ref<MidlongSubject[]>([])
const stations = ref<CompanyStation[]>([])
const exporting = ref(false)
const drillMonth = ref<string | null>(null)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = reactive({
  monthRange: (q('fromMonth') && q('toMonth') ? [q('fromMonth'), q('toMonth')] : []) as string[],
  asOf: q('asOf'),
  subjectId: q('subjectId'),
  stationId: q('stationId'),
  productKind: q('productKind'),
  tradeMethod: q('tradeMethod'),
  energyAttribute: q('energyAttribute'),
})

const query = computed<MidlongPositionQuery>(() => {
  const out: MidlongPositionQuery = {}
  if (filters.monthRange.length === 2) { out.fromMonth = filters.monthRange[0]; out.toMonth = filters.monthRange[1] }
  if (filters.asOf) out.asOf = filters.asOf
  if (filters.subjectId) out.subjectId = filters.subjectId
  if (filters.stationId) out.stationId = filters.stationId
  if (filters.productKind) out.productKind = filters.productKind as MidlongPositionQuery['productKind']
  if (filters.tradeMethod) out.tradeMethod = filters.tradeMethod as MidlongPositionQuery['tradeMethod']
  if (filters.energyAttribute) out.energyAttribute = filters.energyAttribute as MidlongPositionQuery['energyAttribute']
  return out
})

const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${JSON.stringify(query.value)}`
// 换了公司/地区先清掉旧范围的持仓，加载期间不显示旧公司的数值（同合同列表页）。
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function load() {
  const token = guard.begin(contextKey())
  if (scopeKey() !== loadedScope) { report.value = null; appliedQuery.value = null }
  loadedScope = scopeKey()
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    // 发请求时先快照本次实际用的查询；确认仍是当前请求、与结果同一时刻生效，迟到或失败的请求不更新快照。
    const snapshot = query.value
    const [positions, subjectRows, stationRows] = await Promise.all([fetchPositions(query.value), fetchSubjects(), fetchStations()])
    if (!guard.isCurrent(token, contextKey())) return
    report.value = positions
    // 快照以服务端实际采用的月份边界为准：初次访问未选月份时由服务端推算默认窗口，
    // 不回填的话导出会让服务端再推算一次，跨月后默认窗口变化会导致 CSV 与页面所见不一致（dljy#2983）。
    appliedQuery.value = { ...snapshot, fromMonth: positions.fromMonth, toMonth: positions.toMonth }
    subjects.value = subjectRows
    stations.value = stationRows
    if (filters.monthRange.length !== 2) filters.monthRange = [positions.fromMonth, positions.toMonth]
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    report.value = null
    appliedQuery.value = null
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
  }
}

function apply() {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(query.value)) if (v) next[k] = String(v)
  void router.replace({ query: next })
  drillMonth.value = null
  void load()
}

function clearAsOf() {
  filters.asOf = ''
  apply()
}

async function doExport() {
  // 导出用加载当前结果时的快照，不用筛选控件实时值（dljy#2983）；正常路径导出按钮只在有结果时可见，这里兜底提示。
  const applied = appliedQuery.value
  if (!applied) { ElMessage.warning('请先查询出结果，再导出'); return }
  exporting.value = true
  const scope = scopeKey()
  try {
    const file = await exportPositions(applied)
    if (scope !== scopeKey()) { ElMessage.warning('公司或地区已切换，已丢弃切换前发起的导出'); return }
    downloadCsv(file.fileName, file.content)
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  } finally {
    exporting.value = false
  }
}

onMounted(load)
// 切换公司/地区：交易主体、场站编号属于原公司，清掉后同步地址栏再取数（同合同列表页）。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  filters.monthRange = []
  filters.subjectId = ''
  filters.stationId = ''
  apply()
})

const totals = computed(() => report.value?.totals ?? null)
const drillRows = computed(() => (report.value?.contributions ?? []).filter((c) => c.month === drillMonth.value))
const drillMonthRow = computed<MidlongPositionMonth | null>(() => report.value?.months.find((m) => m.month === drillMonth.value) ?? null)
const poolForDrill = computed(() => (report.value?.unallocatedPool ?? []).filter((p) => drillMonth.value && p.overlappingMonths.includes(drillMonth.value)))

function buildOption(): Record<string, unknown> {
  const months = report.value?.months ?? []
  const accent = cssVar('--accent') || '#2563eb'
  const warning = cssVar('--warning') || '#f59e0b'
  return {
    grid: { left: 64, right: 64, top: 36, bottom: 40 },
    legend: { top: 0, data: ['正式分解电量', '含未分解合同的月份', '已知部分加权均价'] },
    tooltip: {
      trigger: 'axis',
      // 自定义提示：含未分解合同的月份明确说明「非完整持仓」，不让 0 或部分量被读成真实持仓。
      formatter: (params: Array<{ dataIndex: number }>) => {
        const m = months[params[0]?.dataIndex ?? -1]
        if (!m) return ''
        return [
          `<b>${m.month}</b>`,
          `已明确到本月的正式分解电量：${fmtQuantity(m.formalQuantity)} MWh`,
          m.incomplete ? `另有 ${m.affectedContractIds.length} 份合同电量未分解到月份（见跨期未分解池）` : '',
          `价格覆盖：${fmtRatio(m.price.coverageRatio)}`,
          `已知部分加权均价：${averagePriceLabel(m.price)}`,
        ].filter(Boolean).join('<br/>')
      },
    },
    xAxis: { type: 'category', data: months.map((m) => m.month) },
    yAxis: [
      { type: 'value', name: 'MWh' },
      { type: 'value', name: '元/MWh', splitLine: { show: false } },
    ],
    series: [
      {
        name: '正式分解电量', type: 'bar', stack: 'qty', itemStyle: { color: accent },
        data: months.map((m) => (m.incomplete ? null : Number(m.formalQuantity))),
      },
      {
        // 含未分解合同的月份：柱体高度仍是已明确到该月的正式分解电量（半透明实心，避免空框被读成「无数据」），
        // 虚线警示边框表示另有电量在跨期未分解池中、该月不是完整持仓。
        name: '含未分解合同的月份', type: 'bar', stack: 'qty',
        itemStyle: { color: withAlpha(accent, 0.35), borderColor: warning, borderWidth: 2, borderType: 'dashed' },
        data: months.map((m) => (m.incomplete ? Number(m.formalQuantity) : null)),
      },
      {
        name: '已知部分加权均价', type: 'line', yAxisIndex: 1, connectNulls: false, symbol: 'circle',
        data: months.map((m) => (m.price.comparable && m.price.averagePrice !== null ? Number(m.price.averagePrice) : null)),
      },
    ],
  }
}

// P2 入口（dljy#2971）：分时持仓、场站维度持仓只在对应能力开通时出现，带上当前月份与主体筛选。
// 分时跳转落到入口承诺的完整自然月：fromDate 是所选月 1 号，toDate 是该月真实月末（dljy#2984），
// 不再把两天都钉在 1 号导致目标页首屏只有 24 小时；单月 ≤31 天在小时接口上限内。
const intervalLink = computed(() => {
  const month = filters.monthRange[0] ?? report.value?.fromMonth ?? ''
  return {
    path: '/zcqjy/positions/intervals',
    query: { fromDate: `${month}-01`, toDate: lastDayOfMonth(month) ?? '', granularity: 'HOUR', ...(filters.subjectId ? { subjectId: filters.subjectId } : {}) },
  }
})
const stationLink = computed(() => ({
  path: '/zcqjy/positions/stations',
  query: { ...(filters.monthRange.length === 2 ? { fromMonth: filters.monthRange[0], toMonth: filters.monthRange[1] } : {}), ...(filters.subjectId ? { subjectId: filters.subjectId } : {}) },
}))

const stationName = (id: number | null) => (id ? stations.value.find((s) => s.id === id)?.name ?? `#${id}` : '未分配')

// 操作导引（dljy#3404）：导引跳转过来时用 fill+submit 纠正 KeepAlive 保留的旧月份筛选；
// 快照驱动第 4 章末尾「区间已查询 / 已钻取月份」的推进与恢复。
useGuideForm(
  FORM.positionsFilters,
  {
    read: () => ({ ...filters }),
    fill: (values) => {
      for (const [key, value] of Object.entries(values)) (filters as unknown as Record<string, unknown>)[key] = value
    },
    submit: () => { apply() },
  },
)
useGuideState(STATE.positions, () => ({ months: (report.value?.months ?? []).map((m) => m.month), drillMonth: drillMonth.value }))
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期售电月度持仓</h2>
      <span class="ml-sub">按已确认合同版本的正式月度分解汇总 · 合同量价名义口径（非结算）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !report" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="持仓加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="report && totals && (state === 'ready' || state === 'loading')">
      <div class="ml-filters">
        <el-date-picker v-model="filters.monthRange" type="monthrange" value-format="YYYY-MM" range-separator="至" start-placeholder="起始月" end-placeholder="结束月" style="width: 240px" />
        <el-date-picker v-model="filters.asOf" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" placeholder="历史认知时点（可空=当前）" style="width: 230px" />
        <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 150px">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
        </el-select>
        <el-select v-model="filters.stationId" placeholder="场站" clearable filterable style="width: 140px">
          <el-option label="未分配场站" value="UNALLOCATED" />
          <el-option v-for="s in stations" :key="s.id" :label="s.name" :value="String(s.id)" />
        </el-select>
        <el-select v-model="filters.productKind" placeholder="品种周期" clearable style="width: 110px">
          <el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="filters.tradeMethod" placeholder="交易方式" clearable style="width: 120px">
          <el-option v-for="k in TRADE_METHODS" :key="k" :label="TRADE_METHOD_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="filters.energyAttribute" placeholder="电能属性" clearable style="width: 110px">
          <el-option v-for="k in ENERGY_ATTRIBUTES" :key="k" :label="ENERGY_ATTRIBUTE_LABELS[k]" :value="k" />
        </el-select>
        <el-button type="primary" @click="apply">查询</el-button>
        <el-button :loading="exporting" @click="doExport">导出</el-button>
        <router-link to="/zcqjy/contracts" class="ml-link">售电合同 →</router-link>
        <router-link v-if="p2ModuleOn(capabilities, 'curves')" :to="intervalLink" class="ml-link">分时持仓 →</router-link>
        <router-link v-if="p2ModuleOn(capabilities, 'stationAllocations')" :to="stationLink" class="ml-link">场站维度 →</router-link>
      </div>

      <MidlongNotice v-if="report.view === 'AS_OF'" tone="info" title="历史认知时点视图">
        只使用 {{ new Date(report.asOf).toLocaleString('zh-CN') }} 之前已录入并已确认的合同版本；之后的更正、确认或作废不影响本视图。
        <el-button link type="primary" @click="clearAsOf">回到当前视图</el-button>
      </MidlongNotice>
      <MidlongNotice v-if="report.status === 'partial'" tone="warn" title="持仓与金额不完整">
        <template v-if="totals.unallocatedContractCount">{{ totals.unallocatedContractCount }} 份合同共 {{ fmtQuantity(totals.unallocatedPoolQuantity) }} MWh 尚未分解到月份，已计入「跨期未分解」，未按月均摊。</template>
        <template v-if="totals.price.unknownPriceQuantity !== '0'">{{ fmtQuantity(totals.price.unknownPriceQuantity) }} MWh 售电价格待核对，未计入均价与名义金额。</template>
      </MidlongNotice>
      <MidlongNotice v-if="report.status === 'empty'" tone="info" title="所选范围内没有已确认的中长期售电义务">
        草稿 {{ report.excluded.draftCount }}、待核对 {{ report.excluded.pendingVerificationCount }} 份合同需核验确认后才会计入。
      </MidlongNotice>

      <div class="tile-grid">
        <MetricTile label="区间正式分解电量" :value="fmtQuantity(totals.formalQuantityInRange)" unit="MWh" :sub="`${totals.contractCount} 份已确认合同`" />
        <MetricTile tone="warn" label="跨期未分解电量" :value="fmtQuantity(totals.unallocatedPoolQuantity)" unit="MWh" :sub="`${totals.unallocatedContractCount} 份合同 · 不按月均摊`" />
        <MetricTile label="涉及合同总量" :value="fmtQuantity(totals.contractTotalQuantity)" unit="MWh" sub="含区间外月份" />
        <MetricTile label="价格覆盖" :value="fmtRatio(totals.price.coverageRatio)" :sub="`已知价格 ${fmtQuantity(totals.price.knownPriceQuantity)} MWh`" />
        <MetricTile compact label="已知部分加权均价" :value="averagePriceLabel(totals.price)" :sub="`名义金额 ${notionalAmountLabel(totals.price)}`" />
      </div>

      <MidlongNotice v-if="!totals.price.comparable" tone="warn" title="价格口径不可合并">
        <div v-for="g in totals.price.groups" :key="`${g.taxBasis}${g.priceComponent}`">
          {{ TAX_BASIS_LABELS[g.taxBasis] }} · {{ PRICE_COMPONENT_LABELS[g.priceComponent] }}：{{ fmtQuantity(g.knownQuantity) }} MWh，均价 {{ fmtPrice(g.averagePrice) }} 元/MWh，名义金额 {{ fmtAmount(g.notionalAmount) }} 元
        </div>
      </MidlongNotice>
      <MidlongNotice v-if="totals.price.environmentValue" tone="info">
        绿电环境价值单列：{{ fmtQuantity(totals.price.environmentValue.knownQuantity) }} MWh，名义金额 {{ fmtAmount(totals.price.environmentValue.notionalAmount) }} 元，未计入电能量均价与金额。
      </MidlongNotice>

      <ChartCard title="月度持仓（虚线框月份另有未分解电量）" :height="320" :build-option="buildOption" :empty="report.status === 'empty'" empty-text="暂无已确认持仓" />

      <div class="ml-panel" data-guide="ml-positions-months">
        <h3>月度明细 <small>点击月份查看合同贡献</small></h3>
        <el-table :data="report.months" border size="small" highlight-current-row @row-click="(row: MidlongPositionMonth) => (drillMonth = row.month)">
          <el-table-column prop="month" label="月份" width="100" />
          <el-table-column label="正式分解电量(MWh)" min-width="170" align="right"><template #default="{ row }"><span :class="{ 'ml-warn': row.incomplete }">{{ monthQuantityLabel(row) }}</span></template></el-table-column>
          <el-table-column prop="contractCount" label="涉及合同" width="90" align="right" />
          <el-table-column label="已知价格电量" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.price.knownPriceQuantity) }}</template></el-table-column>
          <el-table-column label="价格覆盖" width="100" align="right"><template #default="{ row }">{{ fmtRatio(row.price.coverageRatio) }}</template></el-table-column>
          <el-table-column label="加权均价" min-width="150"><template #default="{ row }">{{ averagePriceLabel(row.price) }}</template></el-table-column>
          <el-table-column label="名义金额" min-width="200"><template #default="{ row }">{{ notionalAmountLabel(row.price) }}</template></el-table-column>
        </el-table>
      </div>

      <div v-if="drillMonth" class="ml-panel" data-guide="ml-positions-drill">
        <h3>{{ drillMonth }} 合同贡献 <el-button link @click="drillMonth = null">收起</el-button></h3>
        <el-table :data="drillRows" border size="small">
          <el-table-column label="合同" min-width="200">
            <template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link">{{ row.externalContractNo }}</router-link> {{ row.contractName }}</template>
          </el-table-column>
          <el-table-column label="版本" width="70"><template #default="{ row }">v{{ row.revisionNo }}</template></el-table-column>
          <el-table-column label="场站" width="120"><template #default="{ row }">{{ stationName(row.stationId) }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="售电价(元/MWh)" width="170"><template #default="{ row }">{{ row.price === null ? '待核对' : `${fmtPrice(row.price)}（${row.priceSource === 'ALLOCATION' ? '月分解' : '合同固定价'}）` }}</template></el-table-column>
          <el-table-column label="分解来源" width="160"><template #default="{ row }">{{ row.derivation === 'SINGLE_MONTH_TERMS' ? '单月交割期' : '分解明细' }}</template></el-table-column>
          <template #empty>该月没有已明确到月份的正式分解电量。</template>
        </el-table>
        <MidlongNotice v-if="drillMonthRow?.incomplete" tone="warn">
          另有 {{ poolForDrill.length }} 份覆盖该月的合同尚未完整分解：
          <router-link v-for="p in poolForDrill" :key="p.contractId" :to="`/zcqjy/contracts/${p.contractId}`" class="ml-link">{{ p.externalContractNo }}（未分解 {{ fmtQuantity(p.unallocatedQuantity) }} MWh）</router-link>
        </MidlongNotice>
      </div>

      <div class="ml-panel">
        <h3>跨期未分解池（{{ report.unallocatedPool.length }}）<small>每份合同只计一次，不分摊到各月</small></h3>
        <el-table :data="report.unallocatedPool" border size="small">
          <el-table-column label="合同" min-width="220"><template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link">{{ row.externalContractNo }}</router-link> {{ row.contractName }}</template></el-table-column>
          <el-table-column label="交割期" width="200"><template #default="{ row }">{{ row.deliveryStart }} ~ {{ row.deliveryEnd }}</template></el-table-column>
          <el-table-column label="合同电量" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
          <el-table-column label="已分解" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.formalAllocatedQuantity) }}</template></el-table-column>
          <el-table-column label="未分解" width="120" align="right"><template #default="{ row }"><b class="ml-warn">{{ fmtQuantity(row.unallocatedQuantity) }}</b></template></el-table-column>
          <template #empty>所有已确认合同都已完整分解到月份。</template>
        </el-table>
      </div>

      <MidlongNotice tone="info" title="未计入持仓的合同">
        草稿 {{ report.excluded.draftCount }} · 待核对 {{ report.excluded.pendingVerificationCount }} · 框架协议 {{ report.excluded.frameworkCount }} · 已作废 {{ report.excluded.voidedCount }}；
        内部估算分解 {{ fmtQuantity(report.excluded.estimatedQuantity) }} MWh 不计入。数据生成于 {{ new Date(report.generatedAt).toLocaleString('zh-CN') }}。
      </MidlongNotice>
    </template>
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tile-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); }
.ml-panel h3 { margin: 0 0 10px; font-size: var(--font-16); display: flex; align-items: baseline; gap: 8px; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-link { color: var(--accent); text-decoration: none; margin-right: 6px; }
.ml-warn { color: var(--warning); }
@media (max-width: 1100px) { .tile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
