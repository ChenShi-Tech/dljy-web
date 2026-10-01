<script setup lang="ts">
// 套保工作台「补仓试算」页签（openspec build-midlong-spot-hedging HM-07/HB-05；#3420 自外壳拆出，#3422 补齐三种形状与方案对比）。
//
// 无状态试算：POST 但服务端不落库，结果只留在本页（刷新即消失）。不在激活时加载；切公司/地区清空结果与状态，
// 切认知时点/粒度（作用域）同样作废旧视角的结果；切换前发出的试算晚到一律丢弃（HW-06）。
// 形状三选（HM-07）：均匀 / 近 N 日实际出力形状（可选场站与天数，1—60 缺省 14）/ 合同分时曲线（窗口内合同）；
// 权重一律由服务端计算；422 按 details.field 定位到输入框；减仓超过锁价（SIMULATION_EXCEEDS_LOCKED）醒目提示。
// 方案对比预览（HB-05）在下方 SchemeComparePanel：纯前端判级、零请求、不影响生效方案。
import { computed, ref, watch } from 'vue'
import { HedgeApiError, fetchContracts, postSimulate } from '@/services/hedge/hedgeApi'
import { fetchMaintenanceStations } from '@/services/hedge/hedgeMaintenanceApi'
import type { MaintenanceStation } from '@/services/hedge/hedgeMaintenanceApi'
import {
  SIMULATION_ASSUMPTION_LABEL, SIMULATION_PROFILE_DAYS_DEFAULT, SIMULATION_SHAPE_KINDS, SIMULATION_SHAPE_KIND_LABELS,
  buildSimulateBody, evaluationToday, normalizeSimulationResult, parseProfileDays, parseQuantityMwh,
  simulateFailureOf, standardMetricOfWindow, windowRange,
} from '@/services/hedge/hedgeSimulateModel'
import type {
  HedgeSimulationInterval, HedgeSimulationResult, SimulateFailure, SimulationShapeKind, SimulateWindowPreset,
} from '@/services/hedge/hedgeSimulateModel'
import HedgeHint from './HedgeHint.vue'
import HedgeChart from './HedgeChart.vue'
import type { EChartsOption } from 'echarts'
import SchemeComparePanel from './simulate/SchemeComparePanel.vue'
import { injectHedgeWorkbench, useHedgeTabLifecycle } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

// ── 表单 ──────────────────────────────────────────────────────────────────────

const windowPreset = ref<SimulateWindowPreset>('TODAY2')
const customFrom = ref('')
const customTo = ref('')
const quantityText = ref('')
const shapeKind = ref<SimulationShapeKind>('FLAT')
const daysText = ref(String(SIMULATION_PROFILE_DAYS_DEFAULT))
const stationIdText = ref('') // '' = 范围内全部场站（不传 stationId，走服务端缺省）
const contractIdText = ref('') // '' = 未选合同（试算前校验拦下）

const evaluationDay = computed(() => evaluationToday(workbench.asOf.value))
const activeWindow = computed(() => windowRange(windowPreset.value, { from: customFrom.value, to: customTo.value }, evaluationDay.value))
const windowMetric = computed(() => {
  const win = activeWindow.value
  return win ? standardMetricOfWindow(win.fromDate, win.toDate, evaluationDay.value) : null
})

// ── 形状辅助清单（按需加载：只在选中对应形状时读取，页面挂载零请求）──────────

const stations = ref<MaintenanceStation[] | null>(null)
const stationsError = ref<string | null>(null)
const stationsLoading = ref(false)

async function ensureStations() {
  if (stations.value || stationsLoading.value) return
  const current = workbench.scopedRequest()
  stationsLoading.value = true
  stationsError.value = null
  try {
    const rows = await fetchMaintenanceStations()
    if (!current()) return
    stations.value = rows
  } catch (err) {
    if (current()) stationsError.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '场站清单加载失败，可重新选择形状重试'
  } finally {
    if (current()) stationsLoading.value = false
  }
}

interface ContractOption { contractId: number; label: string }
const contracts = ref<{ key: string; rows: ContractOption[]; forbidden: boolean } | null>(null)
const contractsError = ref<string | null>(null)
const contractsLoading = ref(false)

function contractsKey(win: { fromDate: string; toDate: string }): string {
  return `${win.fromDate}~${win.toDate}|${workbench.asOf.value ?? ''}`
}

async function ensureContracts() {
  const win = activeWindow.value
  if (!win) return
  const key = contractsKey(win)
  if (contracts.value?.key === key || contractsLoading.value) return
  const current = workbench.scopedRequest()
  contractsLoading.value = true
  contractsError.value = null
  try {
    const raw = await fetchContracts({ fromDate: win.fromDate, toDate: win.toDate, asOf: workbench.asOf.value ?? undefined })
    if (!current()) return
    const list = Array.isArray((raw as { contracts?: unknown }).contracts) ? (raw as { contracts: unknown[] }).contracts : []
    const rows: ContractOption[] = []
    for (const item of list) {
      const rec = item as { contractId?: unknown; contractName?: unknown; externalContractNo?: unknown }
      const id = Number(rec?.contractId)
      if (!Number.isInteger(id) || id <= 0) continue
      const name = String(rec?.contractName ?? '').trim()
      const no = String(rec?.externalContractNo ?? '').trim()
      rows.push({ contractId: id, label: name || no || `合同 #${id}` })
    }
    rows.sort((a, b) => (a.label === b.label ? a.contractId - b.contractId : a.label < b.label ? -1 : 1))
    contracts.value = { key, rows, forbidden: (raw as { status?: unknown }).status === 'FORBIDDEN' }
    // 窗口变了，旧选择可能不在新列表里：不在就清空，绝不让旧合同的 id 悄悄发出去。
    const picked = Number(contractIdText.value)
    if (contractIdText.value && !rows.some((row) => row.contractId === picked)) contractIdText.value = ''
  } catch (err) {
    if (current()) contractsError.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '合同清单加载失败，可重新选择形状重试'
  } finally {
    if (current()) contractsLoading.value = false
  }
}

// 选中对应形状时才读取辅助清单；窗口/认知时点变化后再次选中会按新窗口重取。
watch(shapeKind, (kind) => {
  if (kind === 'RECENT_ACTUAL_PROFILE') void ensureStations()
  if (kind === 'CONTRACT_CURVE') void ensureContracts()
})
watch([activeWindow, () => workbench.asOf.value], () => {
  if (shapeKind.value === 'CONTRACT_CURVE') void ensureContracts()
})

// ── 试算（只调 /simulate；本地校验不过不发请求）───────────────────────────────

const simulating = ref(false)
const simulateError = ref<SimulateFailure | null>(null)
const result = ref<HedgeSimulationResult | null>(null)

function localError(field: string, label: string, message: string) {
  simulateError.value = { status: 0, errorCode: 'LOCAL', field, label, text: message }
}

async function runSimulate() {
  const current = workbench.scopedRequest()
  simulateError.value = null
  const win = activeWindow.value
  if (!win) {
    localError('window', '交割窗口', '请选择有效的交割窗口（自定义时起始不晚于结束，YYYY-MM-DD）')
    return
  }
  const quantity = parseQuantityMwh(quantityText.value)
  if (!quantity.ok) {
    localError('quantityMwh', '试算电量', quantity.message)
    return
  }
  let days: number | null = null
  if (shapeKind.value === 'RECENT_ACTUAL_PROFILE') {
    const parsed = parseProfileDays(daysText.value)
    if (!parsed.ok) {
      localError('shape.days', '回看天数', parsed.message)
      return
    }
    days = parsed.value
  } else if (shapeKind.value === 'CONTRACT_CURVE' && !contractIdText.value) {
    localError('shape.contractId', '合同曲线', '请选择合同曲线用的合同（取当前交割窗口涉及的合同）')
    return
  }
  const body = buildSimulateBody({
    window: win,
    quantityMwh: quantity.value,
    shape: {
      kind: shapeKind.value,
      days,
      stationId: stationIdText.value ? Number(stationIdText.value) : null,
      contractId: contractIdText.value ? Number(contractIdText.value) : null,
    },
  })
  simulating.value = true
  try {
    const raw = await postSimulate(
      body,
      { granularity: workbench.granularity.value, asOf: workbench.asOf.value ?? undefined },
    )
    if (!current()) return
    result.value = normalizeSimulationResult(raw)
    if (!result.value) localError('window', '交割窗口', '试算响应结构异常，未渲染（不造字段冒充）')
  } catch (err) {
    if (current()) simulateError.value = simulateFailureOf(err)
  } finally {
    if (current()) simulating.value = false
  }
}

const exceedsLocked = computed(() => simulateError.value?.errorCode === 'SIMULATION_EXCEEDS_LOCKED')

// ── 生命周期与作用域（HW-06：切公司/地区/时点/粒度即清空，刷新天然消失）────────

function reset() {
  result.value = null
  simulateError.value = null
  simulating.value = false
  stations.value = null
  stationsError.value = null
  stationsLoading.value = false
  contracts.value = null
  contractsError.value = null
  contractsLoading.value = false
  contractIdText.value = ''
}

useHedgeTabLifecycle(workbench, { reset })
// 认知时点/粒度变化（scopeKey）：旧结果是旧视角的，一并作废；辅助清单同清（下一节按需重取）。
watch(workbench.scopeKey, reset)

// ── 结果展示 ──────────────────────────────────────────────────────────────────

function intervalValue(value: string | null): string {
  return value === null ? '未知' : value
}

function changed(before: string | null, after: string | null): boolean {
  return before !== after
}

function startsLabel(starts: string[]): string {
  const shown = starts.slice(0, 8).map((start) => start.replace('T', ' ').slice(5, 16))
  const rest = starts.length - shown.length
  return rest > 0 ? `${shown.join('、')} 等 ${starts.length} 个` : shown.join('、')
}

/** 正式与试算逐时段按 start 对齐并排（HM-07：结果与正式口径逐时段对照）。 */
const pairedIntervals = computed<Array<{ before: HedgeSimulationInterval; after: HedgeSimulationInterval }>>(() => {
  if (!result.value) return []
  const byStart = new Map(result.value.intervals.map((row) => [row.start, row]))
  return result.value.before.intervals.map((before) => ({ before, after: byStart.get(before.start) ?? before }))
})
const resultPanel = ref('exposure')
const simulationChart = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis', renderMode: 'richText' }, legend: { top: 0 }, grid: { left: 55, right: 20, top: 45, bottom: 45 },
  xAxis: { type: 'category', data: result.value?.intervals.map(row => row.start.replace('T', ' ').slice(5,16)) ?? [] }, yAxis: { type: 'value', name: 'MWh' },
  series: [{ name: '含机制敞口', type: 'line', step: 'end', connectNulls: false, data: result.value?.intervals.map(row => row.exposure?.withMechanism == null ? null : Number(row.exposure.withMechanism)) ?? [] }, { name: '中长期敞口', type: 'line', step: 'end', connectNulls: false, data: result.value?.intervals.map(row => row.exposure?.midlongOnly == null ? null : Number(row.exposure.midlongOnly)) ?? [] }],
}))
</script>

<template>
  <section data-test="simulate-view" class="body">
    <h3>补仓试算 <span class="badge">试算</span><HedgeHint text="结果不保存，不影响正式持仓，刷新后消失。" /></h3>

    <div class="form">
      <label>交割窗口
        <select v-model="windowPreset" data-test="simulate-window">
          <option value="TODAY2">今明两日</option>
          <option value="MONTH">当月</option>
          <option value="CUSTOM">自定义</option>
        </select>
      </label>
      <template v-if="windowPreset === 'CUSTOM'">
        <label>起
          <input v-model="customFrom" type="date" data-test="simulate-from">
        </label>
        <label>止
          <input v-model="customTo" type="date" data-test="simulate-to">
        </label>
      </template>
      <label>试算电量<HedgeHint text="单位兆瓦时。正值补仓，负值减仓。" />
        <input v-model="quantityText" data-test="simulate-qty" placeholder="如 2000 或 -500">
      </label>

      <fieldset class="shape">
        <legend>形状<HedgeHint text="权重按选择的曲线计算，形状仅为试算假设。" /></legend>
        <label v-for="kind in SIMULATION_SHAPE_KINDS" :key="kind" :class="{ picked: shapeKind === kind }">
          <input v-model="shapeKind" type="radio" :value="kind" :data-test="`shape-${kind}`">
          {{ SIMULATION_SHAPE_KIND_LABELS[kind] }}
        </label>

        <div v-if="shapeKind === 'RECENT_ACTUAL_PROFILE'" class="shape-extra" data-test="shape-profile-extra">
          <label>回看天数
            <input v-model="daysText" data-test="shape-days" inputmode="numeric" placeholder="14">
          </label>
          <label>场站
            <select v-model="stationIdText" data-test="shape-station" :disabled="!stations">
              <option value="">全部场站</option>
              <option v-for="station in stations ?? []" :key="station.id" :value="String(station.id)">{{ station.name }}</option>
            </select>
          </label>
          <p v-if="stationsLoading" class="hint" data-test="stations-loading">场站清单加载中…</p>
          <p v-else-if="stationsError" class="hint error" data-test="stations-error">{{ stationsError }}</p>
          <p v-else-if="!stations" class="hint">未加载（重新选择形状可重试）</p>
        </div>

        <div v-else-if="shapeKind === 'CONTRACT_CURVE'" class="shape-extra" data-test="shape-contract-extra">
          <label>合同
            <select v-model="contractIdText" data-test="shape-contract" :disabled="!contracts">
              <option value="">请选择合同</option>
              <option v-for="row in contracts?.rows ?? []" :key="row.contractId" :value="String(row.contractId)">{{ row.label }}</option>
            </select>
          </label>
          <p v-if="contractsLoading" class="hint" data-test="contracts-loading">合同清单加载中…</p>
          <p v-else-if="contractsError" class="hint error" data-test="contracts-error">{{ contractsError }}</p>
          <p v-else-if="contracts?.forbidden" class="hint error" data-test="contracts-forbidden">无权限查看中长期持仓，选不了合同曲线；可改用其它形状。</p>
          <p v-else-if="contracts && !contracts.rows.length" class="hint" data-test="contracts-empty">当前窗口没有合同，无法用合同曲线；可改用其它形状。</p>
        </div>
      </fieldset>

      <button :disabled="simulating" data-test="simulate-run" @click="runSimulate">{{ simulating ? '试算中…' : '试算' }}</button>
    </div>

    <p v-if="exceedsLocked" class="error exceeds" data-test="simulate-exceeds" role="alert">
      减仓被拒绝：{{ simulateError?.text }}。请核对该时段的中长期锁价电量后再试。
    </p>
    <p v-else-if="simulateError" class="error" data-test="simulate-status" :class="{ 'field-error': simulateError.field }">
      {{ simulateError.text }}
    </p>

    <section v-if="result" v-show="resultPanel === 'exposure'" class="result" data-test="simulate-result">
      <p class="result-badges">
        <span class="badge strong">试算</span><span class="badge strong">{{ SIMULATION_ASSUMPTION_LABEL }}</span>
        窗口 {{ result.fromDate ?? '未知' }} ~ {{ result.toDate ?? '未知' }}<HedgeHint text="试算不影响正式持仓；曲线为试算后敞口。" />
      </p>

      <div class="ratios" data-test="simulate-ratios">
        <div class="ratio-card">
          <h4>试算前</h4>
          <p>含机制：{{ result.before.ratio?.withMechanism.value ?? '不可计算' }}</p>
          <p>仅中长期：{{ result.before.ratio?.midlongOnly.value ?? '不可计算' }}</p>
          <p v-if="result.before.ratio">覆盖时段：{{ result.before.ratio.coverage.coveredCount ?? '—' }} / {{ result.before.ratio.coverage.totalCount ?? '—' }}</p>
        </div>
        <div class="ratio-card">
          <h4>试算后 <span class="badge strong">{{ SIMULATION_ASSUMPTION_LABEL }}</span></h4>
          <p>含机制：{{ result.ratio?.withMechanism.value ?? '不可计算' }}</p>
          <p>仅中长期：{{ result.ratio?.midlongOnly.value ?? '不可计算' }}</p>
          <p v-if="result.ratio">覆盖时段：{{ result.ratio.coverage.coveredCount ?? '—' }} / {{ result.ratio.coverage.totalCount ?? '—' }}</p>
        </div>
      </div>

      <details class="intervals result-detail" data-test="simulate-intervals"><summary>逐时段对照</summary>
        <HedgeHint text="锁价电量对照正式与试算结果，缺失时段保持未知。" />
        <table>
          <thead>
            <tr>
              <th>时段</th><th>发电</th><th>机制</th>
              <th>正式锁价</th><th>试算锁价</th>
              <th>含机制敞口</th><th>中长期敞口</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pair in pairedIntervals" :key="pair.before.start" :class="{ uncovered: !pair.before.covered }">
              <td>{{ pair.before.start.replace('T', ' ').slice(5, 16) }}</td>
              <td>{{ intervalValue(pair.before.generationMwh) }}</td>
              <td>{{ intervalValue(pair.before.mechanismMwh) }}</td>
              <td>{{ intervalValue(pair.before.midlongMwh) }}</td>
              <td :class="{ changed: changed(pair.before.midlongMwh, pair.after.midlongMwh) }">{{ intervalValue(pair.after.midlongMwh) }}</td>
              <td>{{ intervalValue(pair.after.exposure?.withMechanism ?? null) }}</td>
              <td>{{ intervalValue(pair.after.exposure?.midlongOnly ?? null) }}</td>
            </tr>
          </tbody>
        </table>
      </details>

      <section class="shapes" data-test="simulate-shapes">
        <h4>形状明细<HedgeHint :text="SIMULATION_ASSUMPTION_LABEL" /></h4>
        <div v-for="shape in result.shapes" :key="shape.index" class="shape-row" :data-test="`shape-info-${shape.index}`">
          <p>
            形状 {{ shape.index + 1 }}：{{ shape.label || SIMULATION_SHAPE_KIND_LABELS[shape.kind] || shape.kind }}
            <span class="badge">{{ shape.assumption || SIMULATION_ASSUMPTION_LABEL }}</span>
            · 分摊 {{ shape.weightedIntervalCount }} 个时段
            <template v-if="shape.skippedIntervalCount">
              · <span class="warn">未分摊 {{ shape.skippedIntervalCount }} 个时段</span><HedgeHint :text="`缺权重的时段不分摊：${startsLabel(shape.skippedStarts)}`" />
            </template>
          </p>
          <p v-if="shape.note" class="hint">{{ shape.note }}</p>
        </div>
        <p v-if="result.note" class="hint">{{ result.note }}</p>
      </section>
    </section>

    <nav class="subtabs" aria-label="试算结果"><button :aria-pressed="resultPanel === 'exposure'" @click="resultPanel = 'exposure'">敞口变化</button><button :aria-pressed="resultPanel === 'compare'" @click="resultPanel = 'compare'">方案对比</button></nav>
    <HedgeChart v-if="result && resultPanel === 'exposure'" :option="simulationChart" label="试算后逐时段敞口" />
    <p v-if="!result && resultPanel === 'exposure'" class="empty">填写电量后进行试算<HedgeHint text="无数据时保留缺失，不生成模拟曲线。可使用有数据的自定义日期。" /></p>
    <SchemeComparePanel v-show="resultPanel === 'compare'" :result="result" :metric="windowMetric" />
  </section>
</template>

<style scoped>
.body { display: block; }
.badge { display: inline-block; background: #f3f4f6; color: #6b7280; border-radius: 4px; padding: 1px 8px; font-size: var(--font-xs, 12px); }
.badge.strong { background: #fff7e6; color: #b45309; border: 1px solid #f0c36d; font-weight: 600; }
.form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 8px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-sm, 13px); }
.shape { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; }
.shape legend { font-size: var(--font-xs, 12px); color: #6b7280; padding: 0 4px; }
.shape label { display: inline-flex; align-items: center; gap: 4px; margin-right: 12px; font-size: var(--font-sm, 13px); }
.shape label.picked { color: #111827; font-weight: 600; }
.shape-extra { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.shape-extra label { display: flex; flex-direction: column; gap: 4px; }
.hint { color: #6b7280; font-size: var(--font-xs, 12px); margin: 2px 0; }
.hint.error { color: #b91c1c; }
.error { color: #b91c1c; }
.error.exceeds { border: 1px solid #f0c36d; background: #fff7e6; padding: 8px 12px; border-radius: 6px; font-weight: 600; }
.result { margin-top: 12px; border: 1px solid #f0c36d; border-radius: 6px; padding: 12px; }
.result-badges { margin: 0 0 8px; font-size: var(--font-sm, 13px); }
.ratios { display: flex; gap: 12px; flex-wrap: wrap; }
.ratio-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; font-size: var(--font-sm, 13px); }
.intervals { margin-top: 12px; }
.intervals table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.intervals th, .intervals td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; }
tr.uncovered td { color: #9ca3af; }
td.changed { font-weight: 600; color: #b45309; }
.shapes { margin-top: 12px; }
.shape-row p { margin: 4px 0; font-size: var(--font-sm, 13px); }
.warn { color: #b45309; font-weight: 600; }
</style>

<style scoped>
.form { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; padding: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.form label { display: grid; gap: 6px; }
.form fieldset { min-width: 260px; flex: 1; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.subtabs { display: flex; gap: 8px; }
.subtabs button[aria-pressed="true"] { background: var(--primary-tint); color: var(--primary); }
.result-detail { max-height: 420px; overflow: auto; }
</style>
