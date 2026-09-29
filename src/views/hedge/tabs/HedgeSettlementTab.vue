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
import MetricTile from '@/components/common/MetricTile.vue'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import { fetchSettlementCoverage, fetchSettlementReview } from '@/services/hedge/hedgeSettlementApi'
import type { SettlementCoverage, SettlementReview, SettlementReviewRow, SettlementView } from '@/services/hedge/hedgeSettlementApi'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'
import {
  CELL_LABEL,
  buildCoverageMatrix,
  coverageWindow,
  datesBetween,
  datesByPlant,
  dayLabel,
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

function plantCoveredDays(plant: string): string {
  const m = matrix.value
  const row = m?.rows.find((item) => item.plant === plant)
  if (!m || !row) return '—'
  return `${isProvisional.value ? row.provisionalRecords : row.formal}/${m.dates.length}`
}

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

const missingByPlant = computed(() => (matrix.value ? datesByPlant(matrix.value, 'MISSING') : []))
const provisionalOnlyByPlant = computed(() => (matrix.value ? datesByPlant(matrix.value, 'PROVISIONAL') : []))
const unbalancedRows = computed(() => rows.value.filter((row) => row.balanced === false))
const incompleteRows = computed(() => rows.value.filter((row) => row.balanced !== true && row.balanced !== false))
const unsplitFeeRows = computed(() => rows.value.filter((row) => row.feeSplit?.status === 'UNSPLIT'))
const unknownFeeRows = computed(() => rows.value.filter((row) => row.feeSplit?.status === 'UNKNOWN'))
const excludedUnverified = computed(() => reviewData.value?.dataQuality?.excludedUnverified ?? 0)

function balanceText(row: SettlementReviewRow): string {
  if (row.balanced === true) return '平'
  if (row.balanced === false) return `不平（差 ${formatAmount(row.residual)}）`
  return '未核对'
}

function rowRatioText(row: SettlementReviewRow): string {
  if (row.balanced !== true) return '—'
  return formatRatio(row.realizedRatio)
}

function rowGrossText(row: SettlementReviewRow): string {
  if (!row.spotExposure) return '—'
  return formatAmount(row.spotExposure.dayAheadAbsMwh + row.spotExposure.realTimeAbsMwh)
}

function midlongFeeText(row: SettlementReviewRow): string {
  if (row.feeSplit?.status === 'SPLIT') return formatAmount(row.feeSplit.midlongFee)
  if (row.feeSplit?.status === 'UNSPLIT') return '不可拆分'
  return '—'
}

const shortDate = (date: string) => date.slice(5)
</script>

<template>
  <section data-test="settlement-view" class="settlement">
    <header class="bar">
      <h3>结算复核 <small>已实现指标 · 只展示数值</small></h3>
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
      <section class="block" data-test="coverage-calendar">
        <h4>覆盖日历 · {{ selectedMonth }}</h4>
        <p class="legend">
          <span class="cell-chip FORMAL">正式</span>有正式日结
          <span class="cell-chip PROVISIONAL">暂结</span>正式缺失、只有暂结（正式视角不计入）
          <span class="cell-chip MISSING">未覆盖</span>无结算记录，不按 0 计
        </p>
        <p v-if="noPlantsInWindow" class="muted" data-test="no-plants">近 {{ coverage.months.length }} 个月暂无已入库结算记录（新月份入库后自动出现）</p>
        <div class="grid-wrap">
          <table class="calendar">
            <thead>
              <tr>
                <th class="plant">场站</th>
                <th v-for="date in matrix.dates" :key="date">{{ date.slice(8) }}</th>
                <th class="sum">{{ isProvisional ? '暂结覆盖' : '正式覆盖' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="day-row" data-test="calendar-day-row">
                <th class="plant">全场站</th>
                <td v-for="day in matrix.days" :key="day.date" :class="['cell', day.state]" :data-date="day.date" :data-state="day.state">{{ dayLabel(day) }}</td>
                <td class="sum">正式全覆盖 {{ matrix.totals.fullFormalDays }}/{{ matrix.dates.length }} 天</td>
              </tr>
              <tr v-for="row in matrix.rows" :key="row.plant" data-test="calendar-plant-row" :data-plant="row.plant">
                <th class="plant">{{ row.plant }}</th>
                <td
                  v-for="(state, i) in row.cells"
                  :key="matrix.dates[i]"
                  :class="['cell', state]"
                  data-test="calendar-cell"
                  :data-date="matrix.dates[i]"
                  :data-state="state"
                >{{ CELL_LABEL[state] }}</td>
                <td class="sum">{{ plantCoveredDays(row.plant) }} 天</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-if="reviewError" class="load-error" data-test="review-error">
        {{ reviewError }} <button type="button" @click="loadReview">重试</button>
      </p>
      <p v-else-if="reviewLoading && !reviewData" data-test="review-loading">加载中…</p>

      <template v-if="reviewData">
        <p v-if="reviewStatusNote" class="status-note" data-test="review-status">{{ reviewStatusNote }}</p>

        <section v-if="rows.length" class="block" data-test="realized-metrics">
          <h4>已实现指标<span v-if="isProvisional" class="view-badge">暂结</span></h4>
          <div class="tiles">
            <MetricTile
              label="场站日覆盖"
              :value="viewCoverage?.value ?? '—'"
              :sub="viewCoverage?.sub ?? ''"
              :pill="viewPill"
              info="按已入库结算的场站 × 日计数；未覆盖的场站日不按 0 计入任何合计"
            />
            <MetricTile
              label="已实现套保率"
              :value="ratioValue"
              :sub="`计入 ${realized.usedRows} 个场站日 · 不平 ${realized.unbalancedRows} · 分段缺失 ${realized.incompleteRows}`"
              :pill="viewPill"
              info="Σ中长期结算电量 ÷ Σ实际上网电量，只用恒等核对通过的场站日；不平、分段缺失的行与未覆盖的场站日不计入；分母为 0 时不可计算。事后指标，不按套保区间判级"
            />
            <MetricTile label="中长期结算电量" :value="formatAmount(realized.ltmMwh)" unit="MWh" :pill="viewPill" info="计入场站日的中长期结算电量之和" />
            <MetricTile label="实际上网电量" :value="formatAmount(realized.actualMwh)" unit="MWh" :pill="viewPill" info="计入场站日的实际上网电量之和" />
            <MetricTile label="现货总敞口" :value="formatAmount(realized.spotGrossMwh)" unit="MWh" :pill="viewPill" info="Σ(|日前增量| + |实时增量|)，计入场站日" />
            <MetricTile label="净敞口" :value="formatAmount(realized.spotNetMwh)" unit="MWh" :pill="viewPill" info="Σ(日前增量 + 实时增量)，计入场站日" />
            <MetricTile label="机制差价结算" :value="mechanismFeeText" compact :info="reviewData.mechanismFee?.note ?? '机制差价科目预留'" />
          </div>

          <table class="data-table" data-test="plant-summary">
            <thead>
              <tr>
                <th>场站</th><th>{{ isProvisional ? '暂结覆盖' : '正式覆盖' }}（天）</th><th>计入场站日</th><th>中长期（MWh）</th><th>实际上网（MWh）</th>
                <th>已实现套保率</th><th>现货总敞口（MWh）</th><th>净敞口（MWh）</th><th>不平</th><th>分段缺失</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in byPlant" :key="item.plant" :data-plant="item.plant">
                <td>{{ item.plant }}</td>
                <td>{{ plantCoveredDays(item.plant) }}</td>
                <td>{{ item.usedRows }}</td>
                <td>{{ formatAmount(item.ltmMwh) }}</td>
                <td>{{ formatAmount(item.actualMwh) }}</td>
                <td>{{ item.usedRows ? formatRatio(item.realizedRatio) : '—' }}</td>
                <td>{{ formatAmount(item.spotGrossMwh) }}</td>
                <td>{{ formatAmount(item.spotNetMwh) }}</td>
                <td>{{ item.unbalancedRows }}</td>
                <td>{{ item.incompleteRows }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="block" data-test="ledger">
          <h4>台账对照 <small>台账锁价电量 vs 结算中长期电量</small></h4>
          <template v-if="ledger">
            <table class="data-table">
              <thead>
                <tr><th>场站</th><th>台账锁价电量（MWh）</th><th>结算中长期电量（MWh）</th><th>未解释差异（MWh）</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr v-for="station in ledger.stations" :key="`s-${station.stationId}`" data-test="ledger-station" :data-plant="station.plantName">
                  <td>{{ station.plantName }}</td>
                  <td>{{ formatAmount(station.ledgerMwh) }}</td>
                  <td>{{ formatAmount(station.settlementMwh) }}</td>
                  <td>{{ formatAmount(station.unexplainedDiff) }}</td>
                  <td>{{ station.ledgerMwh === 0 && station.settlementMwh !== 0 ? '台账可能缺少合同录入' : '' }}</td>
                </tr>
                <tr v-for="item in ledger.unmapped" :key="`u-${item.plantName}`" data-test="ledger-unmapped" :data-plant="item.plantName">
                  <td>{{ item.plantName }}</td>
                  <td>未映射</td>
                  <td>{{ formatAmount(item.settlementMwh) }}</td>
                  <td>—</td>
                  <td>场站映射缺失，无法与台账对照</td>
                </tr>
                <tr v-if="!ledger.stations.length && !ledger.unmapped.length">
                  <td colspan="5" class="muted">本月无可对照的场站</td>
                </tr>
              </tbody>
            </table>
            <ul v-if="ledger.unallocatedSubjectLevel?.length" class="plain" data-test="ledger-unallocated">
              <li v-for="item in ledger.unallocatedSubjectLevel" :key="String(item.key)">
                交易单元 {{ item.key }}：含未分配到场站的 {{ formatAmount(item.quantity) }} MWh，在交易单元一级对照
              </li>
            </ul>
            <p class="muted" data-test="ledger-note">
              {{ ledger.note }}<template v-if="ledger.readmodelAsOf">台账认知时点 {{ ledger.readmodelAsOf }}。</template>
            </p>
          </template>
          <p v-else class="muted" data-test="ledger-empty">{{ ledgerEmptyText }}</p>
        </section>

        <section class="block" data-test="data-quality">
          <h4>数据质量</h4>
          <ul class="plain">
            <li data-test="dq-missing">
              未覆盖 {{ matrix.totals.missing }} 个场站日（不按 0 计）
              <ul v-if="missingByPlant.length" class="sub">
                <li v-for="item in missingByPlant" :key="item.plant">{{ item.plant }}：{{ item.dates }}</li>
              </ul>
            </li>
            <li data-test="dq-provisional">
              只有暂结 {{ matrix.totals.provisionalOnly }} 个场站日（正式缺失，正式视角不计入）
              <ul v-if="provisionalOnlyByPlant.length" class="sub">
                <li v-for="item in provisionalOnlyByPlant" :key="item.plant">{{ item.plant }}：{{ item.dates }}</li>
              </ul>
            </li>
            <li data-test="dq-unbalanced">
              恒等核对不平 {{ unbalancedRows.length }} 行（中长期 + 日前增量 + 实时增量 ≠ 实际上网，超 0.01 MWh；不计入套保率）
              <ul v-if="unbalancedRows.length" class="sub">
                <li v-for="(row, i) in unbalancedRows" :key="i">{{ shortDate(row.date) }} {{ row.plant }}：差额 {{ formatAmount(row.residual) }} MWh</li>
              </ul>
            </li>
            <li data-test="dq-incomplete">
              分段电量缺失 {{ incompleteRows.length }} 行（未做恒等核对，不计入套保率）
              <ul v-if="incompleteRows.length" class="sub">
                <li v-for="(row, i) in incompleteRows" :key="i">{{ shortDate(row.date) }} {{ row.plant }}：{{ row.note ?? '分段电量缺失' }}</li>
              </ul>
            </li>
            <li data-test="dq-fee">
              中长期电费不可拆分 {{ unsplitFeeRows.length }} 行（总电费与分段不符）；费用分段缺失未拆 {{ unknownFeeRows.length }} 行
              <ul v-if="unsplitFeeRows.length" class="sub">
                <li v-for="(row, i) in unsplitFeeRows" :key="i">{{ shortDate(row.date) }} {{ row.plant }}</li>
              </ul>
            </li>
            <li v-if="excludedUnverified" data-test="dq-unverified">剔除未核实/模拟来源 {{ excludedUnverified }} 行（不进业务口径）</li>
            <li data-test="dq-mechanism">机制差价结算：{{ mechanismFeeText }}</li>
          </ul>
        </section>

        <details v-if="rows.length" class="block" data-test="detail-rows">
          <summary>逐日明细（{{ rows.length }} 行 · 电量 MWh · 电费 元）</summary>
          <div class="grid-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日期</th><th>场站</th><th>中长期</th><th>日前增量</th><th>实时增量</th><th>实际上网</th><th>恒等核对</th>
                  <th>已实现套保率</th><th>现货总敞口</th><th>净敞口</th><th>总电费</th>
                  <th>现货增量电费·日前</th><th>现货增量电费·实时</th><th>中长期电费</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in rows" :key="i" :class="{ excluded: row.balanced !== true }" data-test="detail-row">
                  <td>{{ shortDate(row.date) }}</td>
                  <td>{{ row.plant }}</td>
                  <td>{{ formatAmount(row.ltmEnergy) }}</td>
                  <td>{{ formatAmount(row.dayAheadIncrementMwh) }}</td>
                  <td>{{ formatAmount(row.realTimeIncrementMwh) }}</td>
                  <td>{{ formatAmount(row.actualOnGridEnergy) }}</td>
                  <td>{{ balanceText(row) }}</td>
                  <td>{{ rowRatioText(row) }}</td>
                  <td>{{ rowGrossText(row) }}</td>
                  <td>{{ formatAmount(row.spotExposure?.netMwh) }}</td>
                  <td>{{ formatAmount(row.totalFee) }}</td>
                  <td>{{ formatAmount(row.dayAheadFee) }}</td>
                  <td>{{ formatAmount(row.realTimeFee) }}</td>
                  <td>{{ midlongFeeText(row) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>
    </template>
  </section>
</template>

<style scoped>
.settlement { display: flex; flex-direction: column; gap: 12px; }
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.bar h3 { margin: 0; }
.bar h3 small, .block h4 small { font-size: var(--font-xs); color: var(--muted); font-weight: 400; margin-left: 6px; }
.view-switch { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.view-switch button { border: 0; background: transparent; color: var(--text); padding: 4px 12px; cursor: pointer; font-size: var(--font-sm); }
.view-switch button.active { background: color-mix(in srgb, var(--accent) 16%, transparent); font-weight: 600; }
.view-badge {
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; font-size: var(--font-xs);
  border: 1px dashed var(--accent); color: var(--accent);
}
.grain { font-size: var(--font-xs); color: var(--muted); }
.block h4 { margin: 0 0 8px; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--font-xs); color: var(--muted); margin: 0 0 8px; }
.cell-chip { display: inline-block; padding: 0 6px; border-radius: 3px; margin-left: 6px; }
.grid-wrap { overflow-x: auto; }
.calendar { border-collapse: collapse; font-size: var(--font-xs); white-space: nowrap; }
.calendar th, .calendar td { border: 1px solid var(--line); padding: 2px 4px; text-align: center; }
.calendar th.plant { text-align: left; position: sticky; left: 0; background: var(--panel); }
.calendar td.sum, .calendar th.sum { color: var(--muted); }
.cell.FORMAL, .cell-chip.FORMAL { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.cell.PARTIAL { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.cell.PROVISIONAL, .cell-chip.PROVISIONAL { outline: 1px dashed var(--muted); outline-offset: -3px; }
.cell.MISSING, .cell-chip.MISSING { color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 8px; }
.data-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
.data-table th, .data-table td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; white-space: nowrap; }
.data-table tr.excluded td { color: var(--muted); }
.plain { margin: 0; padding-left: 18px; font-size: var(--font-sm); }
.plain .sub { padding-left: 16px; color: var(--muted); }
.muted { color: var(--muted); font-size: var(--font-sm); }
.status-note { margin: 0; color: var(--muted); }
.load-error { color: var(--danger); }
</style>
