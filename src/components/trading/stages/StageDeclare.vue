<script setup lang="ts">
// S4 申报执行（申报窗口，硬死线取地区规则）—— 决策 + 行动
//
// 本面板把申报出门前后的全部动作收在一处，按真实作业顺序排三段：
//   ① 申报曲线：一键套用 S3 写回的方向曲线（也可去申报台逐点微调）；
//   ② 放行自查（T4 十项）：判据自动从 S1–S3 的写回产出填充，交易员只补人给的两项
//      （合规红线自检、双签）。这是**推演台**——权威把关在服务端；
//   ③ 状态机：风控检查 → 送审 → 审批 → 提交。硬约束不过，服务端直接拦转态（409），
//      不是弹个提示继续走。
// 储能立场多一张充放电计划单（折叠块），写回后放行清单的 SOC 判据自动生效。
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { FileUp, Link2, PenLine, PhoneCall, ShieldCheck, Save, Layers } from 'lucide-vue-next'
import {
  buildChecklist,
  evaluateRelease,
  type ChecklistInput,
  type OverrideRecord
} from 'shared/trading-rules/release-checklist.mjs'
import { USAGE_GATE_LABEL } from 'shared/trading-rules/data-integrity.mjs'
import { getMarketTiming } from 'shared/trading-rules/market-timing.mjs'
import { getTradingCalendar } from 'shared/trading-rules/trading-calendar.mjs'
import { currentRegion } from '@/services/region/regionContext'
import { activeStanceType } from '@/services/stance/stanceContext'
import { getRegionSpotProfile } from '@/data/regionSpotProfiles'
import { buildSegmentDraft, segmentsToPriceCurve96, validateSegments, type SegmentRow } from '@/services/trading/segmentQuote'
import {
  approveDeclaration,
  declarationModeOf,
  runDeclarationRiskCheck,
  STATUS_LABEL,
  submitDeclaration,
  submitDeclarationForApproval,
  updateDeclarationCurve,
  type DeclarationOrder
} from '@/services/declarations'
import StorageDispatchBlock from './StorageDispatchBlock.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})
const timing = computed(() => getMarketTiming(currentRegion.value.id))
// D+N 口径（今天报的是 D+几）由 trading-calendar 权威给出——「D-1」这种标的日视角
// 的散落标注不再写死在本面板。
const dnCalendar = computed(() => getTradingCalendar(currentRegion.value.id))

// ── 截止倒计时与三级提醒（手册 S4 步骤③：截止前 60/15/5 分钟）──────────────
// 只对真实单（LIVE）倒计时；演练单不受截止约束。30s 一跳已够（提醒粒度是分钟级）。
const now = ref(Date.now())
let tickTimer: number | undefined
onMounted(() => {
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 30_000)
})
onUnmounted(() => { if (tickTimer !== undefined) window.clearInterval(tickTimer) })

const minutesToDeadline = computed<number | null>(() => {
  const d = decl.value
  if (!d || declarationModeOf(d) !== 'LIVE') return null
  return Math.floor((new Date(d.deadline).getTime() - now.value) / 60000)
})

/** 三级提醒档（手册）：≤60 蓝提示 / ≤15 黄警告 / ≤5 红应急；已过 = passed。 */
const reminderLevel = computed<'normal' | 'blue' | 'yellow' | 'red' | 'passed' | null>(() => {
  const m = minutesToDeadline.value
  if (m === null) return null
  if (m < 0) return 'passed'
  if (m <= 5) return 'red'
  if (m <= 15) return 'yellow'
  if (m <= 60) return 'blue'
  return 'normal'
})
const REMINDER_NOTE: Record<string, string> = {
  normal: '距截止充足',
  blue: '蓝色提醒：距截止不足 60 分钟——确认放行清单与审批链是否就绪',
  yellow: '黄色警告：距截止不足 15 分钟——优先完成审批，预留提交时间',
  red: '红色应急：距截止不足 5 分钟——走应急通道（联系审批人即时放行）',
  passed: '已过截止——本单提交会被服务端作废（EXPIRED）'
}

// ── ① 申报曲线：套用 S3 产出 ────────────────────────────────────────────────
const forecastTotal = computed(() =>
  pf.value.forecast ? pf.value.forecast.curveMwh96.reduce((a, b) => a + b, 0) : null
)
const declaredTotal = computed(() =>
  decl.value ? decl.value.energyCurveMwh96.reduce((a, b) => a + b, 0) : 0
)
const curveMatchesForecast = computed(() => {
  if (!decl.value || !pf.value.forecast) return false
  const a = decl.value.energyCurveMwh96
  const b = pf.value.forecast.curveMwh96
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.0001)
})
const canEditCurve = computed(() =>
  decl.value ? ['DRAFT', 'RISK_CHECKED', 'REJECTED'].includes(decl.value.status) : false
)

// ── ①' 分段价量报价草稿（F3.4 · 手册 S4 步骤①：检查「分几段、每段什么价」）────
// 发电/储能立场报量报价必需；售电 T3 报量不报价（面板提示不生成）。价格锚取 S2
// 价格中枢（S2 未产出时不硬编——没有锚的分段报价是编数字）。
const needsPriceQuote = computed(() => ['GENERATOR', 'STORAGE'].includes(activeStanceType.value ?? ''))
const priceCenterOfS2 = computed<[number, number] | null>(() => {
  const g = pf.value.dataGate
  if (g && Number.isFinite(g.priceCenterLow) && Number.isFinite(g.priceCenterHigh)) {
    return [Number(g.priceCenterLow), Number(g.priceCenterHigh)]
  }
  return null
})
const segmentCount = ref<3 | 4>(3)
const segments = ref<SegmentRow[] | null>(null)
watch(segmentCount, () => { segments.value = null })
function generateSegments() {
  if (!decl.value || !priceCenterOfS2.value) return
  segments.value = buildSegmentDraft(
    decl.value.energyCurveMwh96,
    priceCenterOfS2.value[0],
    priceCenterOfS2.value[1],
    segmentCount.value
  )
}
const regionPriceBand = computed(() => {
  const mech = getRegionSpotProfile(currentRegion.value.id).mechanism
  return Number.isFinite(mech.priceCap) && Number.isFinite(mech.priceFloor)
    ? { floor: mech.priceFloor, cap: mech.priceCap }
    : null
})
const segmentValidation = computed(() =>
  segments.value ? validateSegments(segments.value, regionPriceBand.value) : null
)
const canApplySegments = computed(() =>
  Boolean(segments.value?.length) && segmentValidation.value?.ok === true && canEditCurve.value
)
function applySegmentPrices() {
  if (!decl.value || !segments.value) return
  const priceCurve96 = segmentsToPriceCurve96(segments.value, decl.value.energyCurveMwh96)
  if (!priceCurve96) return
  void run(
    () => updateDeclarationCurve(decl.value!.id, {
      priceCurve96,
      note: `套用分段报价草稿：${segments.value!.map((x) => `${x.label} ${x.priceYuanPerMwh} 元`).join(' / ')}`
    }),
    '分段价格曲线已写入申报单（priceCurve96）'
  )
}

const busy = ref(false)
const actionMsg = ref('')
const actionError = ref('')

async function run(action: () => Promise<DeclarationOrder>, doneMsg: string) {
  if (busy.value) return
  busy.value = true
  actionMsg.value = ''
  actionError.value = ''
  try {
    const updated = await action()
    emit('updated', updated)
    actionMsg.value = doneMsg
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    busy.value = false
  }
}

function applyForecastCurve() {
  const f = pf.value.forecast
  if (!decl.value || !f) return
  void run(
    () => updateDeclarationCurve(decl.value!.id, {
      energyCurveMwh96: f.curveMwh96,
      note: `套用 S3 方向判断曲线（${f.source}）`
    }),
    'S3 申报曲线已套用'
  )
}

// ── ② 放行自查（T4 十项，推演台）────────────────────────────────────────────
const form = reactive<ChecklistInput>({
  dailyVarYuan: 82_000,
  varLimitYuan: 100_000,
  socTrajectoryOk: true,
  socEndOk: true,
  safetyMultiple: 3.1,
  safetyMultipleThreshold: 1.15,
  maxBiasAbs: 0.12,
  biasManagementBand: 0.2,
  biasLegalBand: 0.3,
  complianceRatio: 1.0,
  complianceManagementBand: [0.85, 1.15],
  complianceLegalBand: [0.8, 1.2],
  quoteMonotonic: null,
  quoteIntegerPrice: null,
  minSegmentRatioOk: null,
  redLinesTouched: [],
  dataDeclarable: true,
  dataGateSummary: '',
  preparedBy: 'trader',
  reviewedBy: 'lead'
})
const redLineInput = ref('')
const overrides = ref<OverrideRecord[]>([])
const draftOverride = reactive({ itemId: '', approvedBy: '', cosignedBy: '', reason: '', stopLossCondition: '' })

/**
 * 上游产出 → 判据自动填充：S2 门禁、S3 偏置、储能计划的 SOC 与安全倍数直接落进判据，
 * 交易员只补它们给不出的项。没有上游产出时保持手工值并标「未接入」——不默认成通过。
 */
watch(
  pf,
  (v) => {
    if (v.dataGate) {
      form.dataDeclarable = v.dataGate.gate === 'declarable'
      form.dataGateSummary = `来自 S2：${USAGE_GATE_LABEL[v.dataGate.gate as keyof typeof USAGE_GATE_LABEL]}，完整率 ${(v.dataGate.completenessRate * 100).toFixed(1)}%（${v.dataGate.writtenBy}）`
    }
    if (v.storagePlan) {
      form.socTrajectoryOk = v.storagePlan.socTrajectoryOk
      form.socEndOk = v.storagePlan.socEndOk
      if (v.storagePlan.safetyMultiple !== null) form.safetyMultiple = v.storagePlan.safetyMultiple
    }
    if (v.forecast?.biasRatio !== undefined) {
      form.maxBiasAbs = Math.abs(v.forecast.biasRatio)
    }
  },
  { immediate: true, deep: true }
)

const items = computed(() => {
  // 纯派生（原实现把解析结果写回 form 再读出——computed 内副作用，lint 已拦）：
  // redLinesTouched 只被 buildChecklist 消费，直接随展开透传，行为等价。
  const redLinesTouched = redLineInput.value
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return buildChecklist({ ...form, redLinesTouched })
})
const verdict = computed(() => evaluateRelease(items.value, overrides.value))

function severityLabel(s: string, passed: boolean) {
  if (passed) return '通过'
  return s === 'hard' ? '硬约束·不可放行' : s === 'overridable' ? '待双签放行' : '告警'
}
function addOverride() {
  if (!draftOverride.itemId) return
  overrides.value = [
    ...overrides.value.filter((o) => o.itemId !== draftOverride.itemId),
    { ...draftOverride, at: new Date().toISOString() }
  ]
  draftOverride.itemId = ''
  draftOverride.reason = ''
  draftOverride.stopLossCondition = ''
}
function removeOverride(itemId: string) {
  overrides.value = overrides.value.filter((o) => o.itemId !== itemId)
}

// ── ③ 状态机动作 ────────────────────────────────────────────────────────────
const status = computed(() => decl.value?.status ?? null)
const approveComment = ref('')

const deadlinePassed = computed(() => {
  if (!decl.value) return false
  return declarationModeOf(decl.value) === 'LIVE' && now.value > new Date(decl.value.deadline).getTime()
})

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function doRiskCheck() {
  if (!decl.value) return
  void run(() => runDeclarationRiskCheck(decl.value!.id, {}), '风控检查完成（判据取自各阶段写回产出）')
}
function doSubmitForApproval() {
  if (!decl.value) return
  void run(() => submitDeclarationForApproval(decl.value!.id), '已进入审批队列')
}
function doApprove(decision: 'approve' | 'reject') {
  if (!decl.value) return
  void run(
    () => approveDeclaration(decl.value!.id, decision, approveComment.value || undefined),
    decision === 'approve' ? '已批准' : '已驳回'
  )
}
// 提交失败自动重试 3 次 → 人工通道（手册 S4 异常处理）。非瞬态错误（过截止/状态机
// 拒绝）重试无意义，立即转人工通道；成功后留提交快照供回执逐项核对。
const submitFailures = ref<string[]>([])
const manualChannelOpen = ref(false)
const submitSnapshotMwh = ref<number | null>(null)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function doSubmit() {
  const d = decl.value
  if (!d || busy.value) return
  submitFailures.value = []
  manualChannelOpen.value = false
  submitSnapshotMwh.value = d.energyCurveMwh96.reduce((a, b) => a + b, 0)
  busy.value = true
  actionMsg.value = ''
  actionError.value = ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const updated = await submitDeclaration(d.id, `${d.id}-submit`)
      emit('updated', updated)
      actionMsg.value = attempt > 1 ? `第 ${attempt} 次尝试提交成功并取得回执` : '已提交并取得回执'
      busy.value = false
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : '提交失败'
      submitFailures.value = [...submitFailures.value, `第 ${attempt} 次：${msg}`]
      // 过截止/状态机拒绝是确定性失败，重试只是烧时间
      if (/截止|EXPIRED|状态/.test(msg)) break
      if (attempt < 3) await sleep(800)
    }
  }
  busy.value = false
  actionError.value = '自动提交未成功（见失败记录）——已转人工通道'
  manualChannelOpen.value = true
}

/** 回执逐项核对（手册 S4 步骤④）：幂等键/时序/状态/总量逐项过，人工项标 null。 */
type ReceiptCheckRow = { label: string; pass: boolean | null; detail: string }
const receiptChecks = computed<ReceiptCheckRow[] | null>(() => {
  const d = decl.value
  const r = d?.receipt
  if (!d || !r) return null
  const rehearsal = declarationModeOf(d) === 'REHEARSAL'
  const currentTotal = d.energyCurveMwh96.reduce((a, b) => a + b, 0)
  return [
    {
      label: '回执幂等键与提交键一致',
      pass: r.idempotencyKey === `${d.id}-submit`,
      detail: r.idempotencyKey
    },
    {
      label: '回执时间在申报截止前',
      pass: rehearsal ? null : new Date(r.acknowledgedAt).getTime() <= new Date(d.deadline).getTime(),
      detail: new Date(r.acknowledgedAt).toLocaleString('zh-CN', { hour12: false }) + (rehearsal ? '（演练单豁免）' : '')
    },
    {
      label: '单据状态已进入已提交及之后',
      pass: ['SUBMITTED', 'ACKNOWLEDGED', 'CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED'].includes(d.status),
      detail: STATUS_LABEL[d.status]
    },
    {
      label: '申报总量与提交快照一致',
      pass: submitSnapshotMwh.value !== null ? Math.abs(currentTotal - submitSnapshotMwh.value) < 0.05 : null,
      detail: submitSnapshotMwh.value !== null
        ? `快照 ${submitSnapshotMwh.value.toFixed(1)} / 当前 ${currentTotal.toFixed(1)} MWh`
        : '本会话无提交快照——请人工比对'
    }
  ]
})
</script>

<template>
  <div class="dc">
    <!-- 段内导航（#1970：面板偏长，锚点直达四段） -->
    <nav v-if="decl" class="dc-section-nav">
      <button type="button" @click="scrollToSection('dc-sec-curve')">① 申报曲线</button>
      <button type="button" @click="scrollToSection('dc-sec-segments')">② 分段报价</button>
      <button type="button" @click="scrollToSection('dc-sec-checklist')">③ 放行自查</button>
      <button type="button" @click="scrollToSection('dc-sec-machine')">④ 风控→提交</button>
    </nav>

    <!-- 截止提示 + 三级提醒（手册：截止前 60/15/5 分钟） -->
    <section
      v-if="decl"
      class="dc-deadline"
      :class="{ over: deadlinePassed, [`remind-${reminderLevel}`]: reminderLevel && reminderLevel !== 'normal' }"
    >
      申报截止 {{ new Date(decl.deadline).toLocaleString('zh-CN', { hour12: false }) }}
      <template v-if="timing">（{{ currentRegion.shortName || currentRegion.id }}规则包 截止 {{ timing.bidDeadline }}<template v-if="dnCalendar"> · 今天主要报 D+{{ dnCalendar.primarySpotTarget }}</template>）</template>
      <template v-if="declarationModeOf(decl) === 'REHEARSAL'">· 演练单不受截止约束</template>
      <strong v-else-if="deadlinePassed">已过截止——本单提交会被服务端作废（EXPIRED）</strong>
      <template v-else-if="minutesToDeadline !== null">
        · 距截止 <strong>{{ minutesToDeadline }}</strong> 分钟 · {{ REMINDER_NOTE[reminderLevel ?? 'normal'] }}
      </template>
    </section>

    <!-- ① 申报曲线 -->
    <section id="dc-sec-curve" class="dc-panel">
      <h3><FileUp :size="14" /> ① 申报曲线</h3>
      <div class="dc-curve">
        <span>单据当前 <strong>{{ declaredTotal.toFixed(1) }}</strong> MWh</span>
        <template v-if="forecastTotal !== null">
          <span>S3 产出 <strong>{{ forecastTotal.toFixed(1) }}</strong> MWh</span>
          <span v-if="curveMatchesForecast" class="dc-ok"><Link2 :size="12" /> 已套用 S3 曲线</span>
          <button
            v-else
            type="button"
            class="dc-btn"
            :disabled="!canEditCurve || busy"
            @click="applyForecastCurve"
          >
            套用 S3 申报曲线
          </button>
          <span v-if="!canEditCurve" class="dc-muted">当前状态不可改曲线</span>
        </template>
        <span v-else class="dc-warn-inline">
          S3 方向判断未产出——曲线只能手工维护。
          <button type="button" class="dc-jump" @click="emit('go', 'direction')">回 S3 补</button>
        </span>
        <router-link class="dc-jump" to="/xhjy/desk">去申报工作台逐点微调 96 点 →</router-link>
      </div>
    </section>

    <!-- ①' 分段价量报价草稿（F3.4）—— 发电/储能立场报量报价；售电 T3 报量不报价 -->
    <details v-if="needsPriceQuote" id="dc-sec-segments" class="dc-segments" :open="!decl?.priceCurve96?.length">
      <summary>
        <Layers :size="13" /> 分段价量报价草稿（{{ segmentCount }} 段）
        <em v-if="decl?.priceCurve96?.length">价格曲线已写入（{{ new Set(decl.priceCurve96).size }} 档价）</em>
        <em v-else>未生成——发电/储能立场报量报价必需</em>
      </summary>
      <div class="dc-seg-bar">
        <label>
          段数
          <select v-model.number="segmentCount">
            <option :value="3">3 段（基荷/腰荷/峰荷）</option>
            <option :value="4">4 段（+尖峰）</option>
          </select>
        </label>
        <button type="button" class="dc-btn" :disabled="!priceCenterOfS2" @click="generateSegments">
          {{ priceCenterOfS2 ? '按电量份额生成分段草稿' : '需先在 S2 产出价格中枢' }}
        </button>
        <span v-if="!priceCenterOfS2" class="dc-warn-inline">S2 未写回市场判断（价格中枢）——没有价格锚不生成分段，不编数字。
          <button type="button" class="dc-jump" @click="emit('go', 'market-analysis')">回 S2</button>
        </span>
      </div>
      <table v-if="segments?.length" class="dc-seg-table">
        <thead>
          <tr><th>段位</th><th>价格 元/MWh（可改，须整数）</th><th>电量 MWh</th><th>覆盖点数</th><th>电量占比</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in segments" :key="row.rank">
            <td>{{ row.label }}</td>
            <td><input v-model.number="segments![i]!.priceYuanPerMwh" type="number" step="1" /></td>
            <td>{{ row.energyMwh.toFixed(1) }}</td>
            <td>{{ row.slots }}</td>
            <td>{{ row.sharePct }}%</td>
          </tr>
        </tbody>
      </table>
      <p v-if="segmentValidation && !segmentValidation.ok" class="dc-err">{{ segmentValidation.problems.join('；') }}</p>
      <p v-if="segmentValidation?.ok" class="dc-muted">
        供给曲线约束：价格随段位严格递增、整数价<template v-if="regionPriceBand">、限价带 [{{ regionPriceBand.floor }}, {{ regionPriceBand.cap }}] 内（{{ currentRegion.shortName || currentRegion.id }} 档案）</template>——人工改动实时校验。
      </p>
      <button
        type="button"
        class="dc-btn primary"
        :disabled="!canApplySegments"
        :title="canEditCurve ? '' : '当前状态不可改曲线（提交后价格随单固化）'"
        @click="applySegmentPrices"
      >
        套用为申报单价格曲线（priceCurve96）
      </button>
    </details>
    <p v-else class="dc-muted" style="margin: 0">
      当前立场（{{ activeStanceType ?? '未选' }}）为报量不报价口径（售电 T3）——无分段报价环节；发电/储能立场在此生成分段草稿。
    </p>

    <!-- 储能立场：充放电计划（写回后 SOC 判据自动生效） -->
    <details class="dc-storage" :open="activeStanceType === 'STORAGE'">
      <summary>
        储能充放电计划（R1/R2/R3/R11 + 八项约束）
        <em v-if="pf.storagePlan">已写回：循环 {{ pf.storagePlan.cycles }} 次 · 预期毛利 {{ pf.storagePlan.grossMarginYuan }} 元</em>
        <em v-else>储能立场必做；其它立场可忽略</em>
      </summary>
      <StorageDispatchBlock :declaration="decl" @updated="emit('updated', $event)" />
    </details>

    <!-- ② 放行自查 -->
    <section id="dc-sec-checklist" class="dc-panel">
      <h3>
        <ShieldCheck :size="14" /> ② 放行自查（T4 十项）
        <span class="dc-verdict" :class="verdict.allowed ? 'ok' : 'bad'">
          {{ verdict.passedCount }}/{{ verdict.total }} {{ verdict.allowed ? '可进入提交' : '不可提交' }}
        </span>
      </h3>
      <p class="dc-summary" :class="verdict.allowed ? 'ok' : 'bad'">{{ verdict.summary }}</p>

      <div class="dc-grid">
        <div>
          <h4>判据输入<em v-if="pf.dataGate || pf.storagePlan || pf.forecast" class="dc-auto">部分已由 S1–S3 产出自动填充</em></h4>
          <div class="dc-fields">
            <label>日 VaR 元<input v-model.number="form.dailyVarYuan" type="number" /></label>
            <label>授权额度 元<input v-model.number="form.varLimitYuan" type="number" /></label>
            <label>储能安全倍数<input v-model.number="form.safetyMultiple" type="number" step="0.05" /></label>
            <label>最大申报偏置<input v-model.number="form.maxBiasAbs" type="number" step="0.01" /></label>
            <label>中长期履约率<input v-model.number="form.complianceRatio" type="number" step="0.01" /></label>
            <label>编制人<input v-model="form.preparedBy" type="text" /></label>
            <label>复核人<input v-model="form.reviewedBy" type="text" /></label>
          </div>
          <div class="dc-toggles">
            <label><input v-model="form.socTrajectoryOk" type="checkbox" /> SOC 轨迹在带内</label>
            <label><input v-model="form.socEndOk" type="checkbox" /> 终止 SOC 达标</label>
            <label><input v-model="form.dataDeclarable" type="checkbox" /> 数据门禁允许申报</label>
          </div>
          <label class="dc-redline">
            触碰的合规红线（逗号分隔，留空为无）
            <input v-model="redLineInput" type="text" placeholder="如 R-2 身份混用" />
          </label>
        </div>

        <div>
          <!-- 十项清单：检验不是主角——默认只列未通过项，全过时折叠为一行 -->
          <details class="dc-list-fold" :open="!verdict.allowed">
            <summary>
              十项清单
              <span v-if="verdict.allowed" class="dc-fold-badge ok">{{ verdict.passedCount }}/{{ verdict.total }} 全部通过</span>
              <template v-else>
                <span class="dc-fold-badge bad">{{ verdict.total - verdict.passedCount }} 项未过</span>
              </template>
            </summary>
            <ol class="dc-list">
              <li
                v-for="item in items"
                :key="item.id"
                :class="item.passed ? 'pass' : item.severity === 'hard' ? 'hard' : 'soft'"
              >
                <div class="dc-item-head">
                  <span class="dc-no">{{ item.no }}</span>
                  <strong>{{ item.label }}</strong>
                  <span class="dc-sev">{{ severityLabel(item.severity, item.passed) }}</span>
                </div>
                <div class="dc-detail">{{ item.detail }}</div>
              </li>
            </ol>
          </details>
        </div>
      </div>

      <div v-if="verdict.pendingOverrides.length || overrides.length" class="dc-override">
        <h4><PenLine :size="13" /> 超限放行（双签 + 理由 + 止损条件，缺一不采信）</h4>
        <div v-if="verdict.pendingOverrides.length" class="dc-override-form">
          <select v-model="draftOverride.itemId">
            <option value="">选择待放行项…</option>
            <option v-for="i in verdict.pendingOverrides" :key="i.id" :value="i.id">{{ i.no }}. {{ i.label }}</option>
          </select>
          <input v-model="draftOverride.approvedBy" type="text" placeholder="一级审批（交易负责人）" />
          <input v-model="draftOverride.cosignedBy" type="text" placeholder="二级审批（风控负责人）" />
          <input v-model="draftOverride.reason" type="text" placeholder="超限理由" />
          <input v-model="draftOverride.stopLossCondition" type="text" placeholder="止损触发条件" />
          <button type="button" @click="addOverride">登记放行</button>
        </div>
        <ul v-if="overrides.length" class="dc-overrides">
          <li v-for="o in overrides" :key="o.itemId">
            <strong>{{ o.itemId }}</strong>
            <span>{{ o.approvedBy }} + {{ o.cosignedBy || '（缺二级签，不予采信）' }}</span>
            <span>理由：{{ o.reason || '（空，不予采信）' }}</span>
            <span>止损：{{ o.stopLossCondition || '（空，不予采信）' }}</span>
            <button type="button" @click="removeOverride(o.itemId)">撤销</button>
          </li>
        </ul>
      </div>
      <p class="dc-note">
        本清单是交易员的推演台；**权威把关在服务端**——下方「风控检查」用同一套规则重算并
        阻断硬约束（409 拦转态），故此处结论不直接改单据状态。
      </p>
    </section>

    <!-- ③ 状态机 -->
    <section id="dc-sec-machine" class="dc-panel">
      <h3><Save :size="14" /> ③ 风控 → 审批 → 提交</h3>
      <div v-if="!decl" class="dc-muted">未绑定作业单据——先在顶部选择或新建标的日申报单。</div>
      <template v-else>
        <div class="dc-machine">
          <span class="dc-status">{{ STATUS_LABEL[decl.status] }}</span>

          <template v-if="status === 'DRAFT' || status === 'REJECTED' || status === 'RISK_CHECKED'">
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doRiskCheck">
              {{ status === 'RISK_CHECKED' ? '风控复检' : '风控检查' }}
            </button>
          </template>
          <template v-if="status === 'RISK_CHECKED'">
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doSubmitForApproval">送审</button>
          </template>
          <template v-if="status === 'PENDING_APPROVAL'">
            <input v-model="approveComment" type="text" class="dc-comment" placeholder="审批意见（可空）" />
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doApprove('approve')">批准</button>
            <button type="button" class="dc-btn danger" :disabled="busy" @click="doApprove('reject')">驳回</button>
            <span class="dc-muted">四眼原则：创建人不得审批本人真实申报单（服务端强制，演练单豁免）</span>
          </template>
          <template v-if="status === 'APPROVED'">
            <button type="button" class="dc-btn primary" :disabled="busy || deadlinePassed" @click="doSubmit">
              提交申报
            </button>
          </template>
        </div>

        <p v-if="actionMsg" class="dc-ok">{{ actionMsg }}</p>
        <p v-if="actionError" class="dc-err">{{ actionError }}</p>

        <!-- 风控检查结果 -->
        <table v-if="decl.riskCheck" class="dc-table">
          <thead><tr><th>检查项</th><th>结论</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="c in decl.riskCheck.checks" :key="c.checkId" :class="c.status.toLowerCase()">
              <td>{{ c.name }}</td>
              <td>{{ c.status === 'PASS' ? '通过' : c.status === 'FAIL' ? '不通过' : '待接入' }}</td>
              <td class="dc-detail-cell">{{ c.detail }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="decl.riskCheck" class="dc-muted">
          审批档位 {{ decl.riskCheck.gateLevel }} · 检查时点
          {{ new Date(decl.riskCheck.evaluatedAt).toLocaleString('zh-CN', { hour12: false }) }}
        </p>

        <!-- 提交失败记录与人工通道（手册：自动重试 3 次 → 人工通道） -->
        <div v-if="manualChannelOpen" class="dc-manual">
          <h4><PhoneCall :size="13" /> 自动提交未成功——人工通道</h4>
          <ul v-if="submitFailures.length" class="dc-manual-fails">
            <li v-for="(f, i) in submitFailures" :key="i">{{ f }}</li>
          </ul>
          <p>
            按<strong>人工通道</strong>完成申报：登录交易平台网页端按下列读数填报，或按省交易中心电话申报流程申报。
            人工申报的受理结果以交易平台侧回执为准——本系统不代发、也不伪造回执；完成后回 S5 人工登记出清。
          </p>
          <div class="dc-manual-read">
            <span>标的日 {{ decl.targetDate }}</span>
            <span>申报总量 <strong>{{ decl.energyCurveMwh96.reduce((a, b) => a + b, 0).toFixed(1) }}</strong> MWh</span>
            <span v-if="decl.priceCurve96?.length">价格 {{ new Set(decl.priceCurve96).size }} 档（{{ [...new Set(decl.priceCurve96)].sort((a, b) => a - b).join('/') }} 元/MWh）</span>
            <span>截止 {{ new Date(decl.deadline).toLocaleString('zh-CN', { hour12: false }) }}</span>
          </div>
        </div>

        <!-- 回执 + 逐项核对（手册 S4 步骤④：回执确认不是只看回执号） -->
        <div v-if="decl.receipt" class="dc-receipt">
          回执 {{ decl.receipt.receiptId }} · {{ decl.receipt.gateway }}
          · {{ new Date(decl.receipt.acknowledgedAt).toLocaleString('zh-CN', { hour12: false }) }}
          <em v-if="decl.receipt.mock">Mock 网关（非真实申报通道）——真实申报以交易平台回执为准</em>
          <button type="button" class="dc-jump" @click="emit('go', 'clearing')">→ 等出清结果，去 S5</button>
          <table v-if="receiptChecks" class="dc-receipt-checks">
            <thead><tr><th>核对项</th><th>结论</th><th>明细</th></tr></thead>
            <tbody>
              <tr v-for="c in receiptChecks" :key="c.label" :class="c.pass === false ? 'bad' : c.pass === null ? 'manual' : ''">
                <td>{{ c.label }}</td>
                <td>{{ c.pass === true ? '✓ 通过' : c.pass === false ? '✗ 不一致' : '人工比对' }}</td>
                <td>{{ c.detail }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.dc { display: flex; flex-direction: column; gap: 12px; }
.dc-deadline { padding: 7px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; font-size: 12px; }
.dc-deadline.over { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
.dc-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dc-panel h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; flex-wrap: wrap; }
.dc-panel h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; font-size: 12px; }
.dc-verdict { margin-left: auto; padding: 2px 10px; border-radius: 9px; font-size: 11px; }
.dc-verdict.ok { background: #f0fdf4; color: #15803d; }
.dc-verdict.bad { background: #fef2f2; color: #b91c1c; }
.dc-summary { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.6; }
.dc-summary.ok { background: #f0fdf4; color: #166534; }
.dc-summary.bad { background: #fef2f2; color: #991b1b; }

.dc-curve { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.dc-btn { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.dc-btn.primary { background: #2563eb; color: #fff; }
.dc-btn.danger { border-color: #dc2626; background: #fef2f2; color: #b91c1c; }
.dc-btn:disabled { opacity: .45; cursor: not-allowed; }
.dc-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.dc-ok { margin: 6px 0 0; font-size: 12px; color: #15803d; display: inline-flex; align-items: center; gap: 4px; }
.dc-err { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.dc-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-warn-inline { font-size: 12px; color: #b45309; }

.dc-storage { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.dc-storage summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dc-storage summary em { font-style: normal; font-weight: 400; font-size: 11px; color: var(--el-text-color-secondary, #889); }
.dc-storage[open] summary { margin-bottom: 8px; }

.dc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.dc-auto { margin-left: 8px; font-style: normal; font-size: 10px; font-weight: 400; padding: 1px 7px; border-radius: 8px; background: #ecfdf5; color: #047857; }
.dc-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.dc-fields label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-fields input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }
.dc-toggles { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; }
.dc-toggles label { display: inline-flex; align-items: center; gap: 5px; }
.dc-redline { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dc-redline input { padding: 4px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }

.dc-list-fold { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.dc-list-fold summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
.dc-list-fold[open] summary { margin-bottom: 6px; }
.dc-fold-badge { padding: 1px 9px; border-radius: 9px; font-size: 10px; font-weight: 600; }
.dc-fold-badge.ok { background: #dcfce7; color: #15803d; }
.dc-fold-badge.bad { background: #fee2e2; color: #991b1b; }

.dc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dc-list li { padding: 6px 9px; border-radius: 6px; border-left: 3px solid transparent; }
.dc-list li.pass { background: #f6fefa; border-left-color: #4ade80; }
.dc-list li.hard { background: #fef2f2; border-left-color: #ef4444; }
.dc-list li.soft { background: #fffbeb; border-left-color: #f59e0b; }
.dc-item-head { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-size: 12px; }
.dc-no { min-width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: #1e293b; color: #fff; font-size: 10px; }
.dc-sev { margin-left: auto; font-size: 10px; padding: 1px 7px; border-radius: 8px; background: rgba(0,0,0,.06); }
.dc-detail { margin-top: 2px; padding-left: 25px; font-size: 11px; color: var(--el-text-color-secondary, #667); }

.dc-override { margin-top: 10px; }
.dc-override-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dc-override-form select, .dc-override-form input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.dc-override-form input { min-width: 150px; }
.dc-override-form button { padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.dc-overrides { list-style: none; margin: 8px 0 0; padding: 0; font-size: 11px; }
.dc-overrides li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 5px 8px; border-radius: 6px; background: #f8fafc; margin-bottom: 4px; }
.dc-overrides button { margin-left: auto; padding: 1px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; }

.dc-note { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: #a16207; }

.dc-machine { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dc-status { padding: 3px 12px; border-radius: 9px; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 600; }
.dc-comment { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; min-width: 200px; }

.dc-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
.dc-table th, .dc-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.dc-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc-table tr.fail td { background: #fef2f2; }
.dc-table tr.unavailable td { background: #fffbeb; }
.dc-detail-cell { color: var(--el-text-color-secondary, #667); }

.dc-section-nav { display: flex; gap: 6px; flex-wrap: wrap; }
.dc-section-nav button { padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 12px; background: #fff; font-size: 11px; cursor: pointer; color: #475569; }
.dc-section-nav button:hover { border-color: #2563eb; color: #1d4ed8; }
@media (max-width: 760px) {
  .dc-grid { grid-template-columns: 1fr; }
  .dc-table, .dc-seg-table, .dc-receipt-checks { display: block; overflow-x: auto; }
  .dc-fields { grid-template-columns: 1fr 1fr; }
}
.dc-receipt { margin-top: 8px; padding: 7px 10px; border-radius: 8px; background: #f0fdf4; color: #166534; font-size: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dc-receipt em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: 10px; }
.dc-receipt-checks { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; background: #fff; }
.dc-receipt-checks th, .dc-receipt-checks td { padding: 4px 8px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.dc-receipt-checks th { color: var(--el-text-color-secondary, #667); }
.dc-receipt-checks tr.bad td { background: #fef2f2; color: #991b1b; }
.dc-receipt-checks tr.manual td { background: #fffbeb; color: #92400e; }

.dc-deadline.remind-blue { border-color: #93c5fd; background: #eff6ff; }
.dc-deadline.remind-yellow { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
.dc-deadline.remind-red { border-color: #f87171; background: #fef2f2; color: #991b1b; font-weight: 600; }

.dc-segments { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.dc-segments summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dc-segments summary em { font-style: normal; font-weight: 400; font-size: 11px; color: var(--el-text-color-secondary, #889); }
.dc-segments[open] summary { margin-bottom: 8px; }
.dc-seg-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; margin-bottom: 8px; }
.dc-seg-bar select { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.dc-seg-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
.dc-seg-table th, .dc-seg-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.dc-seg-table th:first-child, .dc-seg-table td:first-child { text-align: left; }
.dc-seg-table input { width: 84px; padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 11px; text-align: right; }

.dc-manual { margin-top: 8px; padding: 8px 12px; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; font-size: 12px; line-height: 1.7; }
.dc-manual h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 4px; font-size: 12px; color: #991b1b; }
.dc-manual-fails { margin: 0 0 6px; padding-left: 18px; font-size: 11px; color: #991b1b; }
.dc-manual-read { display: flex; gap: 14px; flex-wrap: wrap; padding: 5px 9px; border-radius: 6px; background: #fff; font-variant-numeric: tabular-nums; }
</style>
