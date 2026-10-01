<script setup lang="ts">
// 套保工作台「结算复核」页签（openspec build-midlong-spot-hedging 任务 10.5，HR-01..06，design D12；ChenShi-Tech/dljy#3054）。
//
// 事后复核：用电网结算复核已实现的套保与现货敞口，只展示数值、不判级。
// - 月份：激活时先取回看窗口（含当月最近 12 个月）的正式/暂结两份覆盖日历，默认选最近一个有正式覆盖的月份，不写死当月（HR-02）；
// - 覆盖日历：场站 × 日三态（正式 / 暂结 / 未覆盖），未覆盖的格子不按 0 计入任何合计；
// - 已实现指标：只用恒等核对通过的场站日，不平与分段缺失的行在数据质量区单列（HR-01）；
// - 正式/暂结视角：默认正式；切换视角立即清空并按新视角重取，两套数值不混用、晚到的另一视角响应丢弃（HR-03）；
// - 台账对照：后端以结算期末为认知时点读台账，差额叫「未解释差异」、不归因（HR-04）；费用只称「现货增量电费」（HR-05）。
// 切公司/地区由 useHedgeTabLifecycle 统一清空并（激活中则）重取；每个 await 之后先过 scopedRequest 判定再写状态（HW-06）。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import HedgeChart from './HedgeChart.vue'
import HedgeHint from './HedgeHint.vue'
import type { EChartsOption } from 'echarts'
import MetricTile from '@/components/common/MetricTile.vue'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import { fetchSettlementCoverage, fetchSettlementReview } from '@/services/hedge/hedgeSettlementApi'
import type { SettlementCoverage, SettlementReview, SettlementReviewRow, SettlementView } from '@/services/hedge/hedgeSettlementApi'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'
import {
  buildCoverageMatrix,
  coverageWindow,
  datesBetween,
  datesByPlant,
  defaultMonth,
  formatAmount,
  formatRatio,
  monthOptionLabel,
  monthRange,
  normalizeCoverage,
  normalizeReview,
  summarizeByPlant,
  summarizeMonths,
  summarizeRealized,
} from './settlementReviewModel'

const workbench = injectHedgeWorkbench()

interface CoverageState {
  today: string
  months: string[]
  formal: SettlementCoverage
  provisional: SettlementCoverage
}

const coverage = ref<CoverageState | null>(null)
const coverageLoading = ref(false)
const coverageError = ref<string | null>(null)
const selectedMonth = ref<string | null>(null)
const view = ref<SettlementView>('FORMAL')
/** 取回的复核结果连同它所属的月份与视角一起保存：显示时只认这里的视角，不会把另一视角的数值挂到当前标记下。 */
const review = ref<{ month: string; view: SettlementView; data: SettlementReview } | null>(null)
const reviewLoading = ref(false)
const reviewError = ref<string | null>(null)
// 页签内的请求代次：月份/视角不在工作台作用域键里，由这两个计数器丢弃被新请求取代的旧响应。
let coverageSeq = 0
let reviewSeq = 0

function errorText(err: unknown, fallback: string): string {
  return err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : fallback
}

async function load() {
  const current = workbench.scopedRequest()
  const seq = ++coverageSeq
  const isCurrent = () => current() && seq === coverageSeq
  const today = today2Range().fromDate
  const lookback = coverageWindow(today)
  coverageLoading.value = true
  coverageError.value = null
  // 新一轮加载（首次、重新激活、认知时点作废后重取）开始即隐藏上一轮的日历与复核结果并作废在途复核：
  // 否则新日历先返回时会和旧复核指标拼在同一页（#220 审查 R1-01）。已选月份与视角保留。
  coverage.value = null
  review.value = null
  reviewSeq += 1
  reviewLoading.value = false
  reviewError.value = null
  let formalRaw: unknown
  let provisionalRaw: unknown
  try {
    [formalRaw, provisionalRaw] = await Promise.all([
      fetchSettlementCoverage({ fromDate: lookback.fromDate, toDate: lookback.toDate, view: 'FORMAL' }),
      fetchSettlementCoverage({ fromDate: lookback.fromDate, toDate: lookback.toDate, view: 'PROVISIONAL' }),
    ])
  } catch (err) {
    if (!isCurrent()) return
    // 失败就显示原因：清掉旧日历与旧复核结果，不留下看似「无数据」的空表。
    coverage.value = null
    review.value = null
    reviewSeq += 1
    reviewLoading.value = false
    coverageError.value = errorText(err, '覆盖日历加载失败，可重试')
    coverageLoading.value = false
    return
  }
  if (!isCurrent()) return
  const next: CoverageState = {
    today,
    months: lookback.months,
    formal: normalizeCoverage(formalRaw, 'FORMAL'),
    provisional: normalizeCoverage(provisionalRaw, 'PROVISIONAL'),
  }
  coverage.value = next
  coverageLoading.value = false
  // 重新激活时保留用户选过的月份；首次加载、切公司后或所选月份滑出窗口时取默认月份。
  if (!selectedMonth.value || !next.months.includes(selectedMonth.value)) {
    selectedMonth.value = defaultMonth(summarizeMonths(next.months, next.formal, next.provisional)) ?? next.months[0]
  }
  await loadReview()
}

async function loadReview() {
  const month = selectedMonth.value
  const cov = coverage.value
  if (!month || !cov) return
  const current = workbench.scopedRequest()
  const seq = ++reviewSeq
  const isCurrent = () => current() && seq === reviewSeq
  const requestedView = view.value
  reviewLoading.value = true
  reviewError.value = null
  try {
    const raw = await fetchSettlementReview({ ...monthRange(month, cov.today), granularity: 'DAY', view: requestedView })
    if (!isCurrent()) return
    review.value = { month, view: requestedView, data: normalizeReview(raw, requestedView) }
  } catch (err) {
    if (!isCurrent()) return
    review.value = null
    reviewError.value = errorText(err, '结算复核加载失败，可重试')
  }
  reviewLoading.value = false
}

function onMonthChange(event: Event) {
  const month = (event.target as HTMLSelectElement).value
  if (!month || month === selectedMonth.value) return
  selectedMonth.value = month
  review.value = null
  void loadReview()
}

function setView(next: SettlementView) {
  if (view.value === next) return
  view.value = next
  review.value = null
  void loadReview()
}

function reset() {
  coverageSeq += 1
  reviewSeq += 1
  coverage.value = null
  coverageLoading.value = false
  coverageError.value = null
  review.value = null
  reviewLoading.value = false
  reviewError.value = null
  selectedMonth.value = null
  view.value = 'FORMAL'
}

const lifecycle = useHedgeTabLifecycle(workbench, { load, reset })

// 卸载（离开套保页）后在途请求的后续步骤一律作废：不再据覆盖日历补发复核请求。
onBeforeUnmount(() => {
  coverageSeq += 1
  reviewSeq += 1
})

// 认知时点/粒度变化也会让在途请求作废（scopedRequest 的作用域键含二者），但结算复核两者都不依赖：
// 激活中且有请求被作废时按原月份与视角重取，避免加载态卡住。公司/地区变化由 useHedgeTabLifecycle 处理，这里跳过。
let lastContextKey = workbench.contextKey.value
watch(workbench.scopeKey, () => {
  const contextKey = workbench.contextKey.value
  if (contextKey !== lastContextKey) {
    lastContextKey = contextKey
    return
  }
  if (lifecycle.active.value && (coverageLoading.value || reviewLoading.value)) void load()
})

// ── 派生显示 ─────────────────────────────────────────────────────────────────

const monthSummaries = computed(() => (coverage.value
  ? summarizeMonths(coverage.value.months, coverage.value.formal, coverage.value.provisional)
  : []))

const matrix = computed(() => {
  const cov = coverage.value
  const month = selectedMonth.value
  if (!cov || !month) return null
  const range = monthRange(month, cov.today)
  return buildCoverageMatrix(datesBetween(range.fromDate, range.toDate), cov.formal, cov.provisional)
})

const noPlantsInWindow = computed(() => Boolean(coverage.value && !matrix.value?.plants.length))

const reviewData = computed(() => (review.value && review.value.month === selectedMonth.value && review.value.view === view.value
  ? review.value.data
  : null))
const rows = computed<SettlementReviewRow[]>(() => reviewData.value?.rows ?? [])
const isProvisional = computed(() => view.value === 'PROVISIONAL')
const realized = computed(() => summarizeRealized(rows.value))
const byPlant = computed(() => summarizeByPlant(rows.value, matrix.value?.plants ?? []))

/** 当前视角的覆盖：正式视角数正式记录，暂结视角数暂结记录。 */
const viewCoverage = computed(() => {
  const m = matrix.value
  if (!m) return null
  const covered = isProvisional.value ? m.totals.provisionalRecords : m.totals.formal
  return {
    value: `${covered}/${m.totals.cells}`,
    sub: m.totals.cells ? `覆盖率 ${((covered / m.totals.cells) * 100).toFixed(1)}%` : '',
  }
})

const viewPill = computed(() => (isProvisional.value ? { text: '暂结', tone: 'info' as const } : null))

const ratioValue = computed(() => (realized.value.usedRows ? formatRatio(realized.value.realizedRatio) : '—'))

const reviewStatusNote = computed(() => {
  const data = reviewData.value
  if (!data || data.status === 'OK') return null
  return data.note ?? data.statusNote ?? (isProvisional.value ? '暂结结算数据未入库' : '所选区间暂无已入库结算数据（新月份入库后自动出现）')
})

const mechanismFeeText = computed(() => {
  const fee = reviewData.value?.mechanismFee
  if (!fee) return '—'
  if (fee.status === 'NOT_REPORTED') return '未入库'
  return formatAmount(fee.amount)
})

const ledger = computed(() => reviewData.value?.ledger ?? null)
const ledgerEmptyText = computed(() => {
  if (!reviewData.value) return ''
  // 后端暂结视角不返回台账对照；正式视角有结算行却没有对照，只可能是台账读模型读取失败。
  if (isProvisional.value) return rows.value.length ? '暂结视角暂无台账对照' : '暂结视角无已入库结算行，不做对照'
  if (rows.value.length) return '台账读模型读取失败，暂无法对照（结算行已取回）'
  return '所选月份无已入库结算行，不做对照'
})

const unbalancedRows = computed(() => rows.value.filter(row => row.balanced === false))
const incompleteRows = computed(() => rows.value.filter(row => row.balanced !== true && row.balanced !== false))
const unsplitFeeRows = computed(() => rows.value.filter(row => row.feeSplit?.status === 'UNSPLIT'))
const unknownFeeRows = computed(() => rows.value.filter(row => row.feeSplit?.status === 'UNKNOWN'))
const excludedUnverified = computed(() => reviewData.value?.dataQuality?.excludedUnverified ?? 0)
const panel = ref('realized')
const metric = ref('energy')
const chartBase = { tooltip: { trigger: 'axis' as const, renderMode: 'richText' as const }, legend: { top: 0 }, grid: { left: 130, right: 28, top: 40, bottom: 55 }, dataZoom: [{ type: 'slider' as const, yAxisIndex: 0, right: 0, start: 0, end: 40 }], xAxis: { type: 'value' as const }, yAxis: { type: 'category' as const } }
const coverageOption = computed<EChartsOption>(() => {
  const m = matrix.value
  return {
    tooltip: { renderMode: 'richText', formatter: (p: unknown) => { const v = (p as { value: number[] }).value; return `${m?.rows[v[1]]?.plant}\n${m?.dates[v[0]]}\n${['未覆盖','暂结','正式'][v[2]]}` } },
    grid: { left: 140, right: 35, top: 15, bottom: 70 },
    xAxis: { type: 'category', data: m?.dates.map(date => date.slice(8)), splitArea: { show: true } },
    yAxis: { type: 'category', data: m?.plants, axisLabel: { width: 125, overflow: 'truncate' } },
    dataZoom: [{ type: 'slider', yAxisIndex: 0, right: 0, start: 0, end: 40 }],
    visualMap: { type: 'piecewise', orient: 'horizontal', bottom: 0, left: 'center', pieces: [{ value: 0, label: '未覆盖', color: '#e2e8f0' }, { value: 1, label: '暂结', color: '#e9a23b' }, { value: 2, label: '正式', color: '#0f9d8a' }] },
    series: [{ type: 'heatmap', data: m?.rows.flatMap((row, y) => row.cells.map((state, x) => [x,y,state === 'FORMAL' ? 2 : state === 'PROVISIONAL' ? 1 : 0])) ?? [] }],
  }
})
const realizedOption = computed<EChartsOption>(() => metric.value === 'fees' ? ({
  ...chartBase, yAxis: { type: 'category', data: rows.value.map(row => `${row.date.slice(5)} ${row.plant}`), axisLabel: { width: 115, overflow: 'truncate' } }, xAxis: { type: 'value', name: '元' },
  series: [{name:'总电费', type:'bar', data:rows.value.map(row => row.totalFee)}, {name:'日前增量电费', type:'bar', data:rows.value.map(row => row.dayAheadFee)}, {name:'实时增量电费', type:'bar', data:rows.value.map(row => row.realTimeFee)}, {name:'中长期电费', type:'bar', data:rows.value.map(row => row.feeSplit?.status === 'SPLIT' ? row.feeSplit.midlongFee : null)}],
}) : ({
  ...chartBase, yAxis: { type: 'category', data: byPlant.value.map(row => row.plant), axisLabel: { width: 115, overflow: 'truncate' } },
  xAxis: { type: 'value', name: metric.value === 'ratio' ? '%' : 'MWh' },
  series: metric.value === 'ratio' ? [{ name: '已实现套保率', type: 'bar', data: byPlant.value.map(row => row.usedRows && row.realizedRatio !== null ? row.realizedRatio * 100 : null) }] :
    (metric.value === 'energy' ? [{ name: '中长期', key: 'ltmMwh' as const }, { name: '实际上网', key: 'actualMwh' as const }] : [{ name: '现货总敞口', key: 'spotGrossMwh' as const }, { name: '净敞口', key: 'spotNetMwh' as const }]).map(item => ({ name: item.name, type: 'bar' as const, data: byPlant.value.map(row => row.usedRows ? row[item.key] : null) })),
}))
const ledgerOption = computed<EChartsOption>(() => {
  const entries = [...(ledger.value?.stations ?? []).map(row => ({ name: row.plantName, locked: row.ledgerMwh, settled: row.settlementMwh, diff: row.unexplainedDiff })), ...(ledger.value?.unmapped ?? []).map(row => ({ name: row.plantName, locked: null, settled: row.settlementMwh, diff: null }))]
  return { ...chartBase, yAxis: { type: 'category', data: entries.map(row => row.name), axisLabel: { width: 115, overflow: 'truncate' } }, xAxis: { type: 'value', name: 'MWh' }, series: [{ name: '台账锁价', type: 'bar', data: entries.map(row => row.locked) }, { name: '结算中长期', type: 'bar', data: entries.map(row => row.settled) }, { name: '未解释差异', type: 'bar', data: entries.map(row => row.diff) }] }
})
const qualityItems = computed(() => [
  { label: '未覆盖', value: matrix.value?.totals.missing ?? 0, test: 'dq-missing', hint: '没有结算记录的场站日，不作为零电量计入合计。\n' + (matrix.value ? datesByPlant(matrix.value, 'MISSING').map(item => `${item.plant}：${item.dates}`).join('\n') : '') },
  { label: '仅暂结', value: matrix.value?.totals.provisionalOnly ?? 0, test: 'dq-provisional', hint: '只有暂结记录，正式视角不计入；可切换暂结查看。\n' + (matrix.value ? datesByPlant(matrix.value, 'PROVISIONAL').map(item => `${item.plant}：${item.dates}`).join('\n') : '') },
  { label: '电量不平', value: unbalancedRows.value.length, test: 'dq-unbalanced', hint: '电量合计核对不符，不计入套保率。\n' + unbalancedRows.value.map(row => `${row.date} ${row.plant}：差额 ${formatAmount(row.residual)} 兆瓦时`).join('\n') },
  { label: '分段缺失', value: incompleteRows.value.length, test: 'dq-incomplete', hint: '分段电量缺失，无法核对，不计入套保率。\n' + incompleteRows.value.map(row => `${row.date} ${row.plant}`).join('\n') },
  { label: '费用未拆分', value: unsplitFeeRows.value.length + unknownFeeRows.value.length, test: 'dq-fee', hint: '费用分段缺失或合计不符，保留总费用，无法拆分中长期电费。\n' + [...unsplitFeeRows.value, ...unknownFeeRows.value].map(row => `${row.date} ${row.plant}`).join('\n') },
  { label: '来源未核实', value: excludedUnverified.value, test: 'dq-unverified', hint: '模拟或未经核实的来源已剔除，不用于业务指标。' },
])
const qualityOption = computed<EChartsOption>(() => ({ ...chartBase, dataZoom: [], yAxis: { type: 'category', data: qualityItems.value.map(item => item.label) }, xAxis: { type: 'value', minInterval: 1, name: '场站日 / 行' }, series: [{ type: 'bar', data: qualityItems.value.map(item => item.value), itemStyle: { color: '#e9a23b' } }] }))
</script>

<template>
  <section data-test="settlement-view" class="settlement">
    <header class="bar">
      <h3>结算复核<HedgeHint text="事后复核，不用于今明套保判级。" /></h3>
      <label v-if="coverage" class="month">月份
        <select data-test="settlement-month" :value="selectedMonth ?? ''" @change="onMonthChange">
          <option v-for="summary in monthSummaries" :key="summary.month" :value="summary.month">{{ monthOptionLabel(summary) }}</option>
        </select>
      </label>
      <div class="view-switch" role="group" aria-label="结算视角">
        <button type="button" data-test="view-formal" :class="{ active: view === 'FORMAL' }" @click="setView('FORMAL')">正式</button>
        <button type="button" data-test="view-provisional" :class="{ active: view === 'PROVISIONAL' }" @click="setView('PROVISIONAL')">暂结</button>
      </div>
      <span v-if="isProvisional" class="view-badge" data-test="provisional-badge">暂结</span>
      <span class="grain" title="分时结算入库后自动增加小时粒度">结算为日粒度</span>
    </header>

    <p v-if="coverageError" class="load-error" data-test="settlement-error">
      {{ coverageError }} <button type="button" @click="load">重试</button>
    </p>
    <p v-else-if="coverageLoading && !coverage" data-test="settlement-loading">加载中…</p>

    <template v-if="coverage && matrix">
      <nav class="subtabs" aria-label="复核内容">
        <button v-for="item in [{key:'realized',label:'已实现指标'},{key:'coverage',label:'覆盖日历'},{key:'ledger',label:'台账对照'},{key:'quality',label:'数据质量'}]" :key="item.key" :data-test="`settlement-panel-${item.key}`" :aria-pressed="panel === item.key" @click="panel = item.key">{{ item.label }}</button>
      </nav>
      <p v-if="reviewError" class="load-error" data-test="review-error">{{ reviewError }} <button @click="loadReview">重试</button></p>
      <p v-else-if="reviewLoading" data-test="review-loading">加载中…</p>
      <section v-if="panel === 'coverage'" class="block" data-test="coverage-calendar">
        <h4>覆盖日历 · {{ selectedMonth }}<HedgeHint text="横轴为日期，纵轴为场站。绿色正式、橙色暂结、灰色未覆盖。可拖动右侧缩放条查看更多场站。" /></h4>
        <p v-if="noPlantsInWindow" data-test="no-plants">暂无结算记录</p>
        <HedgeChart v-else :option="coverageOption" label="场站日期覆盖热力图" />
      </section>
      <template v-if="reviewData">
        <p v-if="reviewStatusNote" class="status-note" data-test="review-status">暂无结算数据<HedgeHint :text="reviewStatusNote" /></p>
        <section v-if="panel === 'realized' && rows.length" class="block" data-test="realized-metrics">
          <div class="tiles">
            <MetricTile label="场站日覆盖" :value="viewCoverage?.value ?? '—'" :pill="viewPill" info="未覆盖的场站日不按零计入合计" />
            <MetricTile label="已实现套保率" :value="ratioValue" :pill="viewPill" info="中长期结算电量除以上网电量，只用核对通过的场站日" />
            <MetricTile label="中长期" :value="formatAmount(realized.ltmMwh)" unit="MWh" :pill="viewPill" />
            <MetricTile label="实际上网" :value="formatAmount(realized.actualMwh)" unit="MWh" :pill="viewPill" />
            <MetricTile label="现货总敞口" :value="formatAmount(realized.spotGrossMwh)" unit="MWh" :pill="viewPill" />
            <MetricTile label="净敞口" :value="formatAmount(realized.spotNetMwh)" unit="MWh" :pill="viewPill" />
            <MetricTile label="机制差价结算" :value="mechanismFeeText" compact :info="reviewData.mechanismFee?.note" />
          </div>
          <nav class="subtabs" aria-label="指标图表"><button v-for="item in [{key:'energy',label:'电量'},{key:'ratio',label:'套保率'},{key:'exposure',label:'敞口'},{key:'fees',label:'电费'}]" :key="item.key" :aria-pressed="metric === item.key" @click="metric = item.key">{{ item.label }}</button></nav>
          <HedgeChart :option="realizedOption" label="各场站已实现指标" data-test="plant-summary" />
        </section>
        <section v-if="panel === 'ledger'" class="block" data-test="ledger">
          <h4>台账对照<HedgeHint :text="ledger ? `${ledger.note} 读取时点：${ledger.readmodelAsOf ?? '未记录'}` : ledgerEmptyText" /></h4>
          <HedgeChart v-if="ledger" :option="ledgerOption" label="台账与结算电量对照" />
          <p v-else data-test="ledger-empty">暂无可对照数据</p>
          <p v-if="ledger?.unmapped.length" class="muted">{{ ledger.unmapped.length }} 个场站未映射<HedgeHint :text="ledger.unmapped.map(item => item.plantName).join('、')" /></p>
          <p v-if="ledger?.unallocatedSubjectLevel?.length" data-test="ledger-unallocated">有交易单元电量未分配到场站<HedgeHint :text="ledger.unallocatedSubjectLevel.map(item => `${item.key}：${formatAmount(item.quantity)} 兆瓦时`).join('；')" /></p>
        </section>
        <section v-if="panel === 'quality'" class="block" data-test="data-quality">
          <h4>数据质量<HedgeHint text="检查结算记录的覆盖、分段完整性和电量核对结果。异常记录不进入套保率，费用异常只影响费用拆分。" /></h4>
          <div class="tiles"><div v-for="item in qualityItems" :key="item.test" :data-test="item.test" class="quality-tile">{{ item.label }}<HedgeHint :text="item.hint" /><b>{{ item.value }}</b></div></div>
          <HedgeChart :option="qualityOption" label="结算数据质量异常分布" />
          <p data-test="dq-mechanism">机制差价：{{ mechanismFeeText }}<HedgeHint :text="reviewData.mechanismFee?.note" /></p>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.settlement { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.bar h3, .block h4 { margin: 0 0 8px; }
.view-switch { display: inline-flex; gap: 4px; }
.view-switch button.active { background: var(--primary-tint); color: var(--primary); }
.view-badge { margin-left: 6px; padding: 0 6px; border: 1px dashed var(--primary); border-radius: var(--radius-sm); color: var(--primary); font-size: var(--font-xs); }
.grain, .muted { font-size: var(--font-xs); color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 12px; }
.load-error { color: var(--danger); }
.status-note { color: var(--warning); }
.block { padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); min-width: 0; }
.subtabs { display: flex; gap: 8px; flex-wrap: wrap; }
.subtabs button[aria-pressed="true"] { background: var(--primary-tint); color: var(--primary); }
.quality-tile { padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--font-sm); }
.quality-tile b { display: block; margin-top: 8px; font-size: var(--font-xl); }
</style>
