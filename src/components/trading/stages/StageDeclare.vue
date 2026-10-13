<script setup lang="ts">
// S4 申报执行（申报窗口，硬死线取地区规则）， 决策 + 行动
//
// 申报工作台（/xhjy/desk）非智能体功能以同源共享组件复制融合进本面板（merge-declare-desk-into-s4），
// 申报台页面/菜单保留不变、与本面板双入口共存（D6 二次验收裁定）。
// 段内导航六段按两区分组（D7 第二版）——申报作业区（申报台同源，连续成片）：
//   ① 草稿与倒计时：无单时就地创建草稿（容量/风险偏好/演练模式/报价依据），倒计时唯一一份；
//   ② 申报曲线：一键套用 S3 写回的方向曲线；96 点编辑器（受控共享组件
//      DeclarationCurveEditor）就地微调，与申报台同一实现；
//   ⑤ 风控与提交：风控检查（套保敞口预览）→ 送审 → 审批（四眼/L3 双签）→ 提交
//      （trust gate + 3 次重试 → 人工通道 → 回执逐项核对）→ 出清标记。只留一套；
//   ⑥ 历史申报单：±60/7 天列表、LIVE/演练筛选、导出 xlsx、复制为模拟单、
//      复制曲线到当日单、只读抽屉查看（不切换容器单据）。
// 链路增强区（S4 原有，整体后置不穿插）：
//   ③ 分段报价：按 S2 价格中枢生成草稿（临场改价留痕随段）；
//   ④ 放行自查（T4 十项）：判据自动从 S1–S3 的写回产出填充；无上游产出项标
//      「无上游数据」转人工勾填，不判不通过。这是推演台，权威把关在服务端。
// 储能立场多一张充放电计划单（折叠块），写回后放行清单的 SOC 判据自动生效。
// 数据只进不出（D2）：本面板只读 preflight.morningReview/dataGate/forecast 做预填，
// 永不反向写这三段；独立提交后 S1–S3 如实显示未完成。
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlarmClock, FileUp, FlaskConical, History, Link2, PenLine, PhoneCall, ShieldCheck, Save, Layers, Stamp } from 'lucide-vue-next'
import InfoHint from '@/components/common/InfoHint.vue'
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
  addPriceChange,
  judgePriceChange,
  pendingPriceChanges,
  type PriceChangeRecord
} from '@/services/trading/priceChangeStore'
import type { PriceChangeVerdict } from '@/services/review/strategyReview'
import { shiftDate } from '@/services/review/reviewDashboard'
import {
  approveDeclaration,
  createDeclaration,
  declarationModeOf,
  DECLARATION_MODE_LABEL,
  EDITABLE_DRAFT_STATUSES,
  getDeclaration,
  listDeclarations,
  listDeclarationsPage,
  markDeclarationCleared,
  riskExposureSourceOf,
  runDeclarationRiskCheck,
  STATUS_LABEL,
  secondSignatureNotice,
  submitDeclaration,
  submitDeclarationForApproval,
  updateDeclarationCurve,
  type DeclarationMode,
  type DeclarationOrder
} from '@/services/declarations'
import { DECLARATION_TRANSITIONS } from '@/services/contracts/spotDeclarationContract.gen'
import { buildRehearsalNote, formatRehearsalStamp, parseRehearsalStartedAt } from '@/services/declarationRehearsal'
import { fetchOverview, type HedgeOverview } from '@/services/hedge/hedgeApi'
import { assertOperational } from '@/services/data/trustGate'
import { DATA_BASIS_LABEL } from '@/services/dataBasis'
import { getCurrentUser } from '@/services/auth'
import { isRealCalendarDate } from '@/utils/calendarDate'
import DeclarationCurveEditor from '@/components/trading/declare/DeclarationCurveEditor.vue'
import StorageDispatchBlock from './StorageDispatchBlock.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId]; 'select-order': [d: DeclarationOrder] }>()

const route = useRoute()

const decl = computed(() => props.declaration)
const pf = computed(() => decl.value?.preflight ?? {})
const timing = computed(() => getMarketTiming(currentRegion.value.id))
// D+N 口径（今天报的是 D+几）由 trading-calendar 权威给出，「D-1」这种标的日视角
// 的散落标注不再写死在本面板。
const dnCalendar = computed(() => getTradingCalendar(currentRegion.value.id))

// 截止倒计时与三级提醒（手册 S4 步骤③：截止前 60/15/5 分钟）
// 只对真实单（LIVE）倒计时；演练单不受截止约束。30s 一跳已够（提醒粒度是分钟级）。
// 倒计时全面板只此一份（申报台的秒级倒计时不搬，提醒口径同为分钟级）。
const now = ref(Date.now())
let tickTimer: number | undefined
onMounted(() => {
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 30_000)
  pcPending.value = pendingPriceChanges()
  if (decl.value) void refreshExposure()
  void loadSameDayList()
  void consumeDeskQuery()
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

// ① 草稿与倒计时（申报台创建草稿表单搬入）：上游缺失（无当日单）时表单空白可独立建单；
// 有单时只留单据摘要，建单表单不再渲染。
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 今日之前的目标日，真实申报窗口必然已关闭，此时默认建演练单更符合意图
const isPastTargetDate = computed(() => isRealCalendarDate(props.targetDate) && props.targetDate < todayLocal())
const draftCapacityMw = ref(50)
const draftMode = ref<DeclarationMode>('LIVE')
const draftRiskPreference = ref<'conservative' | 'balanced' | 'aggressive'>('balanced')
const draftRationale = ref('')
const draftRationaleValid = computed(() => draftRationale.value.trim().length >= 8)
const draftRiskNote = computed(
  () => `风险偏好 ${{ conservative: '保守（严控偏差考核）', balanced: '均衡', aggressive: '积极（接受更高敞口）' }[draftRiskPreference.value]}`
)
watch(
  () => [props.targetDate, decl.value?.id],
  () => { if (!decl.value) draftMode.value = isPastTargetDate.value ? 'REHEARSAL' : 'LIVE' },
  { immediate: true }
)

const busy = ref(false)
const actionMsg = ref('')
const actionError = ref('')

async function run(action: () => Promise<DeclarationOrder>, doneMsg: string | ((updated: DeclarationOrder) => string)) {
  if (busy.value) return
  busy.value = true
  actionMsg.value = ''
  actionError.value = ''
  try {
    const updated = await action()
    emit('updated', updated)
    actionMsg.value = typeof doneMsg === 'function' ? doneMsg(updated) : doneMsg
    if (historyLoaded.value) void loadHistory()
    // 同日列表也随动作刷新：建单/复制模拟单会让同日单数变化，头部下拉须跟上
    void loadSameDayList()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败'
  } finally {
    busy.value = false
  }
}

function createDraft() {
  if (!draftRationaleValid.value) return
  void run(
    () => createDeclaration({
      targetDate: props.targetDate,
      capacityMw: draftCapacityMw.value,
      quoteRationale: draftRationale.value.trim(),
      note: draftRiskNote.value,
      mode: draftMode.value
    }),
    draftMode.value === 'REHEARSAL' ? '历史模拟草稿已创建' : '申报草稿已创建'
  )
}

// ② 申报曲线：套用 S3 产出
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
  decl.value ? EDITABLE_DRAFT_STATUSES.includes(decl.value.status) : false
)

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

// 编辑器保存/复制曲线成功后透传容器（受控契约：组件不自持单据，只 emit updated）
function onEditorUpdated(d: DeclarationOrder) {
  emit('updated', d)
  if (historyLoaded.value) void loadHistory()
}

// ③ 分段价量报价草稿（F3.4 · 手册 S4 步骤①：检查「分几段、每段什么价」）
// 发电/储能立场报量报价必需；售电 T3 报量不报价（面板提示不生成）。价格锚取 S2
// 价格中枢（S2 未产出时不硬编，没有锚的分段报价是编数字）。
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

// 临场改价留痕（#2016 缺口二 · slim-s1-morning-review 自 S1 迁入 S4）：改价发生在
// 申报刻，登记与次日回判都放在报价现场完成。当日登记（计划价/改后价/依据），次日
// 回判「改对=可复制 / 改错=需修正」；纯 localStorage 原型 store，键不变——S1 时期的
// 历史记录直接可读可判。默认收起，不给 S4 主动线加层级。
const pcForm = reactive({
  date: props.targetDate,
  decisionPoint: '',
  planPrice: null as number | null,
  changedPrice: null as number | null,
  rationale: ''
})
const pcPending = ref<PriceChangeRecord[]>([])
const pcError = ref('')
function submitPriceChange() {
  pcError.value = ''
  try {
    addPriceChange({
      date: pcForm.date,
      decisionPoint: pcForm.decisionPoint,
      planPrice: Number(pcForm.planPrice),
      changedPrice: Number(pcForm.changedPrice),
      rationale: pcForm.rationale
    })
    pcForm.decisionPoint = ''
    pcForm.planPrice = null
    pcForm.changedPrice = null
    pcForm.rationale = ''
    pcPending.value = pendingPriceChanges()
  } catch (e) {
    pcError.value = e instanceof Error ? e.message : '登记失败'
  }
}
function judgePc(id: string, verdict: PriceChangeVerdict) {
  if (judgePriceChange(id, verdict)) pcPending.value = pendingPriceChanges()
}

// ④ 放行自查（T4 十项，推演台）
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
 * 交易员只补它们给不出的项。没有上游产出时保持手工值并标「无上游数据」，不默认成通过，
 * 也不判不通过——转人工勾填核对（D1 预填统一规则：有则用、无则空，不警告不阻断）。
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

/** 放行自查中缺上游产出的判据来源（标「无上游数据」，转人工勾填而非判不通过）。 */
const missingUpstream = computed<string[]>(() => {
  const missing: string[] = []
  if (!pf.value.dataGate) missing.push('数据门禁（S2 未写回）')
  if (activeStanceType.value === 'STORAGE' && !pf.value.storagePlan) missing.push('SOC 判据（储能计划未写回）')
  if (!pf.value.forecast) missing.push('申报偏置（S3 未写回）')
  return missing
})

const items = computed(() => {
  // 纯派生（原实现把解析结果写回 form 再读出，computed 内副作用，lint 已拦）：
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

// ⑤ 风控与提交（申报台与 S4 两套实现合并去重，只留一套）
const status = computed(() => decl.value?.status ?? null)
const approveComment = ref('')

const deadlinePassed = computed(() => {
  if (!decl.value) return false
  return declarationModeOf(decl.value) === 'LIVE' && now.value > new Date(decl.value.deadline).getTime()
})

const isRehearsal = computed(() => (decl.value ? declarationModeOf(decl.value) === 'REHEARSAL' : false))
// 历史模拟单：把「模拟的是哪天」和「什么时候发起的模拟」摆出来。解析不出就不显示，
// 不拿 createdAt 之类的近似值顶替。
const rehearsalStartedAt = computed(() => parseRehearsalStartedAt(decl.value?.note))

// 审批可见性（UI 门，非安全边界，申报台同款）
// 权威判定恒在服务端（spot-declarations-api.mjs 的 APPROVE_ROLES + 自审禁止，越权一律 403）。
// 只负责不把「批准/驳回」按钮渲染给无权用户。两处角色集合须与服务端保持同步。
const APPROVE_ROLES_UI = ['TRADE_LEAD', 'RISK', 'ADMIN', 'BOSS']
const ELEVATED_ROLES_UI = ['ADMIN', 'BOSS']
const currentUserName = computed(() => getCurrentUser().username)
const currentUserRole = computed(() => String(getCurrentUser().roleCode ?? ''))
const currentUserSubjectType = computed(() => String(getCurrentUser().subjectType ?? ''))
const isSelfDeclaration = computed(() => !!decl.value && decl.value.createdBy === currentUserName.value)
const canApproveCurrent = computed(() => {
  if (!decl.value || decl.value.status !== 'PENDING_APPROVAL') return false
  if (!APPROVE_ROLES_UI.includes(currentUserRole.value)) return false
  // 自审禁止的两类豁免与服务端同口径：ELEVATED 角色、演练单
  if (isSelfDeclaration.value && !ELEVATED_ROLES_UI.includes(currentUserRole.value) && !isRehearsal.value) return false
  return true
})
// 待审批但本人不能批时，给出原因而非静默隐藏（否则用户不知道单卡在哪）
const approvalBlockedReason = computed(() => {
  if (!decl.value || decl.value.status !== 'PENDING_APPROVAL' || canApproveCurrent.value) return ''
  if (!APPROVE_ROLES_UI.includes(currentUserRole.value)) {
    return `当前角色 ${currentUserRole.value || '未知'} 无审批权限，请由交易负责人或风控在审批队列处理`
  }
  return '创建人不得审批本人申报单，请由另一位审批人处理'
})

// 申报前的敞口预览（HA-02，套保任务 9.2）：目标日「仅中长期」逐时段敞口，只作参考展示。
// 风控检查时服务端按同一套保口径自行取数施加约束（ChenShi-Tech/dljy#3475），
// 面板不手填「当月中长期合约总量」，也不向风控传任何敞口值。
const exposure = ref<HedgeOverview | null>(null)
const exposureLoading = ref(false)
const exposureStatus = ref<'idle' | 'loading' | 'auto' | 'failed'>('idle')
// 失败原因原文：后端对「该地区/该月无此品类采集数据」返回 503 + 明确 detail，
// 不能把数据缺失说成服务故障。
const exposureError = ref('')
const exposureSourceIsMock = computed(() => {
  const legs = (exposure.value?.legs ?? {}) as Record<string, { mock?: boolean; source?: string }>
  return Object.values(legs).some((leg) => Boolean(leg?.mock))
})
const exposureSourceText = computed(() => {
  if (!exposure.value) return ''
  const legs = (exposure.value.legs ?? {}) as Record<string, { label?: string; status?: string }>
  const stale = Object.entries(legs).filter(([, leg]) => leg?.status === 'STALE')
  const prefix = exposureSourceIsMock.value ? '模拟数据' : '数据来源'
  const legText = Object.entries(legs).map(([key, leg]) => `${key}(${leg?.status ?? '?'})`).join('、')
  return stale.length ? `${prefix}：${legText}，含过期腿，请以结算复核为准` : `${prefix}：${legText || '套保服务'}`
})
// 风控结果里中长期敞口约束的来源说明（服务端字段原样透出，不在前端重算，#3475）
const riskExposureSource = computed(() => riskExposureSourceOf(decl.value?.riskCheck))
// 地区限价区间（来自 RegionSpotProfile.mechanism.priceCap，来源被记录审计）——风控请求带上
const regionPriceCap = computed(() => {
  const mech = getRegionSpotProfile(currentRegion.value.id).mechanism
  return Number.isFinite(mech.priceCap)
    ? { floor: mech.priceFloor, cap: mech.priceCap, source: `region-profile:${currentRegion.value.id}` }
    : undefined
})

// 竞态守卫：快速切标的日/连点刷新时，旧敞口响应晚归会覆盖新月份数据（月份口径错位）
let exposureGeneration = 0
async function refreshExposure() {
  const month = props.targetDate.slice(0, 7)
  if (!month) return
  exposureLoading.value = true
  exposureStatus.value = 'loading'
  exposureError.value = ''
  const generation = ++exposureGeneration
  try {
    // HA-02（9.2）：目标日「仅中长期」逐时段敞口；机制电量不计入申报约束。
    const result = await fetchOverview({
      fromDate: props.targetDate,
      toDate: props.targetDate,
      granularity: 'HOUR',
      scope: 'company',
    })
    if (generation !== exposureGeneration) return
    exposure.value = result
    exposureStatus.value = 'auto'
  } catch (error) {
    if (generation !== exposureGeneration) return
    exposureStatus.value = 'failed'
    exposureError.value = error instanceof Error ? error.message : ''
  } finally {
    if (generation === exposureGeneration) exposureLoading.value = false
  }
}
watch(() => props.targetDate, () => { if (decl.value) void refreshExposure() })

function doRiskCheck() {
  if (!decl.value) return
  // 中长期敞口由服务端读套保服务（目标日「仅中长期」逐时段敞口）施加约束，
  // 请求体不带任何敞口值（#3475）；限价区间取自地区档案
  void run(() => runDeclarationRiskCheck(decl.value!.id, { priceCap: regionPriceCap.value }), '风控检查完成（判据取自各阶段写回产出）')
}
function doSubmitForApproval() {
  if (!decl.value) return
  void run(() => submitDeclarationForApproval(decl.value!.id), '已进入审批队列')
}
function doApprove(decision: 'approve' | 'reject') {
  if (!decl.value) return
  void run(
    () => approveDeclaration(decl.value!.id, decision, approveComment.value || undefined),
    // L3 双签第一签：服务端只落签不转态——明示待第二签，不谎报「已批准」
    // （文案单源 secondSignatureNotice，与审批队列共用，防漂移）。
    decision === 'approve'
      ? (updated) => secondSignatureNotice(updated) ?? '已批准'
      : '已驳回'
  )
}

// 提交：Trust gate 硬阻塞（申报台同款）——依赖数据 basis 必须 operational（real/captured），
// advisory_only（合成/示意/未知）时禁止作为正式申报依据；Mock 演示网关下阻断后仅允许
// 「演示模式」显式继续，杜绝沉默误用。通过后走 S4 的自动重试 3 次 → 人工通道。
async function confirmTrustGate(d: DeclarationOrder): Promise<boolean> {
  try {
    assertOperational(d.basis, '正式申报提交')
    return true
  } catch {
    try {
      await ElMessageBox.confirm(
        `当前申报依赖数据为「${DATA_BASIS_LABEL[d.basis]}」（basis=${d.basis}），属仅决策支持口径，禁止作为正式申报依据提交。本通道为 MOCK 演示网关（回执标注非真实申报），如仅用于演示可继续。`,
        '⚠ 数据可信度不足 · 正式申报被阻断',
        { confirmButtonText: '仍要继续（演示模式）', cancelButtonText: '取消提交', type: 'warning' }
      )
      return true
    } catch {
      return false // 用户取消 → 不提交
    }
  }
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
  if (!(await confirmTrustGate(d))) return
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
      if (historyLoaded.value) void loadHistory()
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

// 出清标记（申报台同款）：回执确认后人工核对出清结果，标记已出清
function doMarkCleared() {
  if (!decl.value) return
  void run(() => markDeclarationCleared(decl.value!.id), '已标记出清——去 S5 做出清分析')
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

// 草稿与历史同框双 tab（D7 第三版，申报台同构）：「申报单」=倒计时/摘要/创建表单，
// 「历史申报单」=±60/7 天窗口、LIVE/演练筛选、导出 xlsx、复制为模拟单、复制曲线到当日单、
// 只读抽屉查看（不切换容器单据）。列表由本面板自取（历史窗是辅助视图，与容器「当日单」选取逻辑互不污染）。
const declTab = ref<'current' | 'history'>('current')
const historyLoaded = ref(false)
const historyLoading = ref(false)
const historyRows = ref<DeclarationOrder[]>([])
const historyCounts = ref<Record<DeclarationMode, number>>({ LIVE: 0, REHEARSAL: 0 })
const historyModeFilter = ref<'' | DeclarationMode>('')
const HISTORY_WINDOW_DAYS = 60
// 窗口不对称是设计口径（docs/features/declaration-rehearsal-mode.md「±60/7 天」）
const HISTORY_FORWARD_DAYS = 7
// 服务端 list 上限 500。本区是辅助视图（看全量走审批队列的「全部申报单」），
// 单次取到上限而非遍历分页，但必须显式提示截断。
const HISTORY_PAGE_LIMIT = 500
const historyTotal = ref(0)

// 世代守卫：切标的日或模式筛选会并发多次 loadHistory，旧请求晚归会覆盖新结果
let historyGeneration = 0
async function loadHistory() {
  const generation = ++historyGeneration
  historyLoading.value = true
  try {
    const page = await listDeclarationsPage({
      dateFrom: shiftDate(props.targetDate, -HISTORY_WINDOW_DAYS),
      dateTo: shiftDate(props.targetDate, HISTORY_FORWARD_DAYS),
      mode: historyModeFilter.value || undefined,
      limit: HISTORY_PAGE_LIMIT
    })
    if (generation !== historyGeneration) return
    historyRows.value = page.rows
    historyCounts.value = page.counts
    historyTotal.value = page.total
  } catch {
    if (generation !== historyGeneration) return
    // 历史列表是辅助信息，失败不打断主动线（错误条留给申报单主流程）
    historyRows.value = []
    historyTotal.value = 0
  } finally {
    if (generation === historyGeneration) historyLoading.value = false
  }
}
// 切到历史 tab 时首次懒加载（申报单 tab 不发请求）
function switchDeclTab(tab: 'current' | 'history') {
  declTab.value = tab
  if (tab === 'history' && !historyLoaded.value) {
    historyLoaded.value = true
    void loadHistory()
  }
  // 切到历史 tab 后列表容器进 DOM，面板固定件从兜底值换成实测，重算上限
  if (tab === 'history') nextTick(measureHistCap)
}
// 编辑器「复制历史曲线」常显入口（D7）：与历史 tab 同一加载链，打开下拉时懒加载候选
function onEditorRequestHistory() {
  if (!historyLoaded.value) {
    historyLoaded.value = true
    void loadHistory()
  }
}
watch(historyModeFilter, () => { if (historyLoaded.value) void loadHistory() })
watch(() => props.targetDate, () => { if (historyLoaded.value) void loadHistory() })

const historyTruncated = computed(() => historyTotal.value > historyRows.value.length)

// ── 历史列表虚拟滚动 + 高度耦合左栏（六次验收）──
// 行高/表头高为定值（tr/th 显式 height），窗口按 scrollTop 计算可见区间 ±overscan，
// 上下垫等高 spacer 行保证滚动条长度与真实列表一致；≤500 行也保持 DOM 恒定 ~30 行。
const HIST_ROW_H = 40
const HIST_HEAD_H = 32
const HIST_OVERSCAN = 4
const histScrollEl = ref<HTMLElement | null>(null)
const histWin = ref({ start: 0, end: 0 })
const histVisibleRows = computed(() => historyRows.value.slice(histWin.value.start, histWin.value.end))
function updateHistWindow() {
  const el = histScrollEl.value
  const n = historyRows.value.length
  if (!el || !n) { histWin.value = { start: 0, end: 0 }; return }
  const top = Math.max(0, el.scrollTop - HIST_HEAD_H)
  const start = Math.max(0, Math.floor(top / HIST_ROW_H) - HIST_OVERSCAN)
  const visible = Math.ceil(el.clientHeight / HIST_ROW_H) + HIST_OVERSCAN * 2
  const end = Math.min(n, Math.max(start + 1, start + visible))
  if (start !== histWin.value.start || end !== histWin.value.end) histWin.value = { start, end }
}
function onHistScroll() { updateHistWindow() }
watch([historyRows, historyLoading], () => nextTick(updateHistWindow))

// 上限实时跟随左栏申报曲线面板高度（六/七次验收「最高不超过左侧申报曲线」）：
// ResizeObserver 观测曲线面板 + 窗口 resize 重测；cap 扣除列表上方的面板固定件
// （tab 头 + 窗口/筛选行），保证列表底边恒不超过曲线面板底边，而非仅容器等高。
const histCap = ref(0)
let curveObserver: ResizeObserver | undefined
function measureHistCap() {
  const curveEl = document.getElementById('dc-sec-curve')
  const scrollEl = histScrollEl.value
  if (!curveEl) return
  const curveH = curveEl.getBoundingClientRect().height
  // 面板固定件高度 = 面板总高 − 列表容器高（列表任意状态下此差恒为头/scope/内边距）
  const chrome = scrollEl
    ? Math.max(0, (scrollEl.closest('.dc-panel')?.getBoundingClientRect().height ?? 0) - scrollEl.getBoundingClientRect().height)
    : 96
  // 75vh 兜底：矮窗口下不超过视口的四分之三；240px 下限保证至少可见数行
  histCap.value = Math.max(240, Math.min(Math.round(curveH - chrome), Math.round(window.innerHeight * 0.75)))
}
onMounted(() => {
  const curveEl = document.getElementById('dc-sec-curve')
  if (curveEl && typeof ResizeObserver !== 'undefined') {
    curveObserver = new ResizeObserver(measureHistCap)
    curveObserver.observe(curveEl)
  }
  window.addEventListener('resize', measureHistCap)
  // 首测推迟到挂载布局稳定后：切到历史 tab 前列表容器不在 DOM，chrome 用兜底值，
  // 切过去后由 watch(historyRows) 触发的 updateHistWindow 之后再补测一次
  measureHistCap()
  nextTick(measureHistCap)
})
onUnmounted(() => {
  curveObserver?.disconnect()
  window.removeEventListener('resize', measureHistCap)
})

// 导出某日申报明细（清单 D2：对齐参考系统出清结算单的单日期长表格式）。
// 行 = 96 时点 × 当天每张申报单；用 xlsx：日期按文本保留、列宽显式定宽，打开即所见。
const exportDate = ref(props.targetDate)
watch(() => props.targetDate, (d) => { if (isRealCalendarDate(d)) exportDate.value = d })
const exportBusy = ref(false)
async function exportHistoryExcel() {
  if (exportBusy.value || !exportDate.value) return
  exportBusy.value = true
  try {
    const dayRows = await listDeclarations({ date: exportDate.value })
    if (!dayRows.length) {
      ElMessage.warning(`${exportDate.value} 当天没有申报单`)
      return
    }
    const rows: (string | number)[][] = [['目标日', '时点', '申报单', '模式', '状态', '申报电量(MWh)']]
    for (const row of dayRows) {
      for (let i = 0; i < 96; i++) {
        rows.push([
          exportDate.value,
          // 时段段末口径（00:15~24:00），与曲线编辑器明细表同源
          `${String(Math.floor((i + 1) / 4)).padStart(2, '0')}:${String(((i + 1) % 4) * 15).padStart(2, '0')}`,
          row.id,
          DECLARATION_MODE_LABEL[declarationModeOf(row)],
          STATUS_LABEL[row.status],
          Math.round((row.energyCurveMwh96[i] ?? 0) * 10000) / 10000
        ])
      }
    }
    const { exportWorkbook } = await import('@/utils/exportExcel')
    exportWorkbook(`申报单明细-${exportDate.value}.xlsx`, [
      { name: `申报明细 ${exportDate.value}`, rows, colWidths: [12, 8, 36, 10, 10, 16] }
    ])
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  } finally {
    exportBusy.value = false
  }
}

// 只读抽屉查看历史单：不切换容器单据（D3），看一眼就关掉
// 抽屉已随四次验收退役：历史单经 selectHistoryOrder 选入作业，不再只读抽屉。

// 复制历史曲线到当日单：直接落库为当日单曲线（等价于编辑器「复制历史曲线 + 保存」），
// 保存纪律不变——曲线变了需重新风控。当日单不可编辑时禁用。
function copyCurveToToday(row: DeclarationOrder) {
  if (!decl.value || !canEditCurve.value) return
  void run(
    () => updateDeclarationCurve(decl.value!.id, {
      energyCurveMwh96: row.energyCurveMwh96,
      note: `复制历史曲线 ${row.id}（${row.targetDate}）`
    }),
    `已复制 ${row.targetDate} 的曲线到当日单——需重新风控检查`
  )
}

// 复制为历史模拟单（申报台同款）：终态单无出边，不回退原单状态——按同参数复制一张
// REHEARSAL 新单做回测，原单保持终态。note 写清被模拟的日期与发起模拟的时间。
// 主体口径必须与当前会话一致：曲线可以复用，主体不能重新定义（卖出/购入侧反转风险）。
function copySubjectMismatchOf(src: DeclarationOrder): string {
  if (!src.subjectType) return '' // 存量单无主体字段，按会话主体归类不产生反转
  return src.subjectType === currentUserSubjectType.value
    ? ''
    : `该单主体为 ${src.subjectType}，与当前会话主体 ${currentUserSubjectType.value || '未知'} 不一致，不开放复制`
}
function isTerminal(row: DeclarationOrder): boolean {
  return (DECLARATION_TRANSITIONS[row.status]?.length ?? 0) === 0
}
function copyAsRehearsal(row: DeclarationOrder) {
  const startedAt = formatRehearsalStamp(Date.now())
  void run(
    // 一次 POST 带齐两条曲线与口径；不带 src.subjectType，主体由服务端按会话身份填
    () => createDeclaration({
      targetDate: row.targetDate,
      capacityMw: row.capacityMw,
      quoteRationale: row.quoteRationale?.trim() || `历史模拟复制自 ${row.id}，沿用原单报价口径`,
      energyCurveMwh96: row.energyCurveMwh96?.length ? row.energyCurveMwh96 : undefined,
      priceCurve96: row.priceCurve96,
      strategySource: row.strategySource,
      basis: row.basis,
      note: buildRehearsalNote({
        targetDate: row.targetDate,
        startedAt,
        sourceId: row.id,
        sourceStatusLabel: STATUS_LABEL[row.status],
      }),
      mode: 'REHEARSAL',
    }),
    // 演练单落在其目标日，不是当日单——不 emit updated 切容器单据（D3），只刷新历史列表
    () => {
      if (historyLoaded.value) void loadHistory()
      return `已创建历史模拟单（模拟 ${row.targetDate}）——在历史申报单列表可见`
    }
  )
}

// 同日多单下拉（申报台 decl-select 同构）：标的日有多张单时可指定作业哪张。
// 列表由本面板自取（与历史窗互不污染）；选中经 select-order 交容器换单（同日直接生效）。
const sameDayList = ref<DeclarationOrder[]>([])
async function loadSameDayList() {
  const date = props.targetDate
  try {
    const rows = await listDeclarations({ date, limit: 20 })
    if (date === props.targetDate) sameDayList.value = rows
  } catch { /* 同日列表是辅助信息，失败不打断主动线 */ }
}
watch(() => props.targetDate, () => { sameDayList.value = []; void loadSameDayList() })
function onSameDaySelect(id: string) {
  const target = sameDayList.value.find((r) => r.id === id)
  if (target) emit('select-order', target)
}

// 历史单选入作业（四次验收，申报台 openHistoryRow 同构）：不再开只读抽屉，
// 直接经 select-order 交容器——同日换单、跨日切标的日（S1–S7 整体随容器切到那一天）。
function selectHistoryOrder(row: DeclarationOrder) {
  emit('select-order', row)
  switchDeclTab('current')
}

// ?declarationId 深链兼容（D6）：与申报台同口径——把该单选为当前作业单（跨日由容器切日）
async function consumeDeskQuery() {
  const qId = typeof route.query.declarationId === 'string' ? route.query.declarationId : ''
  if (!qId || qId === decl.value?.id) return
  const fetched = await getDeclaration(qId).catch(() => null)
  if (fetched) emit('select-order', fetched)
}
</script>

<template>
  <div class="dc">
    <!-- D7 第三版布局（三次验收降噪）：无段内跳转导航、无段编号；申报台迁入内容连续成
         「申报作业区」（草稿与历史双 tab → 申报曲线 → 风控与提交），S4 原有内容
         （分段报价、放行自查、临场改价留痕）整体后置为「链路增强区」，两区不穿插。
         申报作业区宽屏左右两栏（左=曲线编辑器主操作面，右=草稿历史/风控提交）；
         窄屏退化单栏按区序堆叠。 -->
    <div class="dc-zone dc-zone-desk">
      <div class="dc-zone-head">申报作业</div>
      <div class="dc-layout">
      <div class="dc-area dc-area-draft">
    <!-- 草稿与历史（申报台同构双 tab）：申报单=倒计时/摘要/创建表单；历史申报单=时间窗列表 -->
    <section id="dc-sec-draft" class="dc-panel">
      <!-- 面板头样式与申报工作台「申报单/历史申报单」同构：双 tab + 状态 chip + 单号 -->
      <div class="dc-panel-head">
        <div class="dc-tabs">
          <button type="button" :class="{ on: declTab === 'current' }" @click="switchDeclTab('current')">
            <Stamp :size="14" /> 申报单
          </button>
          <button type="button" :class="{ on: declTab === 'history' }" @click="switchDeclTab('history')">
            <History :size="14" /> 历史申报单
            <span v-if="historyTotal" class="dc-tab-count">{{ historyTotal }}</span>
          </button>
        </div>
        <span class="dc-status">{{ decl ? STATUS_LABEL[decl.status] : '未创建' }}</span>
        <span v-if="decl" class="dc-mono">{{ decl.id }}</span>
        <!-- 同日多单下拉（申报台同构）：标的日有多张申报单（真实/演练）时指定作业哪张 -->
        <select
          v-if="sameDayList.length > 1"
          class="dc-select dc-decl-select"
          :value="decl?.id"
          title="该标的日有多张申报单，选择要作业的单据"
          @change="onSameDaySelect(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="d in sameDayList" :key="d.id" :value="d.id">{{ d.id }}（{{ STATUS_LABEL[d.status] }}）</option>
        </select>
      </div>

      <template v-if="declTab === 'current'">
      <!-- 截止提示 + 三级提醒（手册：截止前 60/15/5 分钟）——全面板唯一一份倒计时 -->
      <div
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
      </div>

      <!-- 有单：单据摘要（演练单把「模拟的是哪天、什么时候发起的」摆显眼处） -->
      <div v-if="decl" class="dc-draft-summary">
        <span class="dc-mono">{{ decl.id }}</span>
        <span class="dc-status">{{ STATUS_LABEL[decl.status] }}</span>
        <span>容量 {{ decl.capacityMw }} MW</span>
        <span v-if="isRehearsal" class="dc-rehearsal-chip">
          <FlaskConical :size="12" /> 历史模拟 · 模拟目标日 {{ decl.targetDate }}<template v-if="rehearsalStartedAt"> · 于 {{ rehearsalStartedAt }} 发起</template> · 非真实申报
        </span>
        <span v-else>{{ DECLARATION_MODE_LABEL[declarationModeOf(decl)] }}</span>
      </div>

      <!-- 无单：创建草稿表单（申报台搬入；上游缺失时表单空白可独立建单，不警告不阻断） -->
      <template v-else>
        <p class="dc-muted">
          该标的日还没有申报单——可在此独立创建草稿（不要求 S1–S3 已产出）；也可回
          <button type="button" class="dc-jump" @click="emit('go', 'morning-review')">S1 晨会复盘</button>
          从链路起点走起。
        </p>
        <div class="dc-draft-form">
          <label>可用容量（MW）<input v-model.number="draftCapacityMw" type="number" min="1" max="2000" /></label>
          <label>
            风险偏好
            <select v-model="draftRiskPreference">
              <option value="conservative">保守 — 严控偏差考核</option>
              <option value="balanced">均衡</option>
              <option value="aggressive">积极 — 接受更高敞口</option>
            </select>
          </label>
          <label>
            申报模式
            <select v-model="draftMode">
              <option value="LIVE">真实申报 — 受申报截止约束</option>
              <option value="REHEARSAL">历史模拟 — 不受截止约束，用于回测演练</option>
            </select>
          </label>
        </div>
        <p v-if="draftMode === 'REHEARSAL'" class="dc-rehearsal-hint">
          <FlaskConical :size="13" />
          <span>历史模拟：不受截止约束 · 回执为本地 Mock 网关（<b>非真实申报</b>） · 与真实申报分开统计</span>
          <InfoHint text="历史模拟单不受申报截止约束、可自批走完整流程，回执为本地 Mock 网关（非真实申报），在列表中与真实申报分开统计。模式创建后不可修改。" />
        </p>
        <p v-else-if="isPastTargetDate" class="dc-rehearsal-hint warn">
          <AlarmClock :size="13" />
          目标日 {{ props.targetDate }} 早于今日，真实申报窗口已关闭 —— 建单即逾期作废；回测演练请用「历史模拟」
        </p>
        <label class="dc-rationale">
          <span>报价依据摘要 <b>必填</b></span>
          <textarea
            v-model="draftRationale"
            rows="2"
            placeholder="写明本次报价的成本锚或机会成本锚，须可追溯到具体数值。例：中长期均价 232、现货 P50 预测 248，价差 16 元/MWh"
          />
          <small :class="{ warn: !draftRationaleValid }">
            {{ draftRationaleValid
              ? '监管质询时以此自证报价形成过程'
              : '至少 8 个字：无法解释的报价即高风险报价，事后补写等于自证材料失效' }}
          </small>
        </label>
        <div class="dc-draft-launch">
          <button type="button" class="dc-btn primary" :disabled="busy || !draftRationaleValid" @click="createDraft">
            {{ draftMode === 'REHEARSAL' ? '创建历史模拟草稿' : '创建申报草稿' }}
          </button>
          <InfoHint text="创建后生成 96 点申报草稿（按容量 60% 平铺初始化），在申报曲线编辑器调整，再走风控检查 → 审批 → 截止前提交。" />
        </div>
      </template>
      </template>

      <!-- 历史申报单 tab：时间窗列表、筛选、导出、复制、只读抽屉（与申报台历史 tab 同构） -->
      <template v-else>
        <p class="dc-muted dc-history-scope">
          <span>目标日 {{ props.targetDate }} 前 {{ HISTORY_WINDOW_DAYS }} 天 / 后 {{ HISTORY_FORWARD_DAYS }} 天内 · 真实申报 {{ historyCounts.LIVE }} / 历史模拟 {{ historyCounts.REHEARSAL }}</span>
          <span class="dc-history-ops">
            <select v-model="historyModeFilter" class="dc-select">
              <option value="">全部模式</option>
              <option value="LIVE">仅真实申报</option>
              <option value="REHEARSAL">仅历史模拟</option>
            </select>
            <!-- 导出按钮与日期筛选拼为一体化控件：左半选日期、右半执行导出 -->
            <span class="dc-export-group" title="左侧选日期，点右侧导出该日 96 点申报明细">
              <input v-model="exportDate" type="date" class="dc-select" />
              <button type="button" class="dc-btn" :disabled="exportBusy || !exportDate" @click="exportHistoryExcel">导出</button>
            </span>
          </span>
        </p>
        <p v-if="historyLoading" class="dc-muted">加载中…</p>
        <p v-else-if="!historyRows.length" class="dc-muted">该时间窗内没有申报单。调整标的日或放宽筛选后重试。</p>
        <p v-else-if="historyTruncated" class="dc-rehearsal-hint warn">
          <AlarmClock :size="13" />
          该时间窗内共 {{ historyTotal }} 张申报单，此处仅显示前 {{ historyRows.length }} 张。
          完整列表请到 <router-link class="dc-jump" to="/xhjy/approvals">申报审批队列 · 全部申报单</router-link> 查看。
        </p>
        <!-- 限高内滚 + 虚拟滚动（六次验收）：上限实时跟随左栏曲线面板高度（histCap），
             tbody 窗口化渲染只出可见行 ±overscan，spacer 行维持滚动条真实长度；
             纵向滚动条样式隐藏（:vertical），横向保持原生 -->
        <div
          v-if="!historyLoading && historyRows.length"
          ref="histScrollEl"
          class="dc-history-scroll"
          :style="histCap ? { maxHeight: histCap + 'px' } : undefined"
          @scroll="onHistScroll"
        >
          <table class="dc-history-table">
            <thead>
              <tr><th>申报单</th><th>目标日</th><th>模式</th><th>状态</th><th>总量</th><th>创建人</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-if="histWin.start > 0" class="dc-hist-spacer" :style="{ height: histWin.start * HIST_ROW_H + 'px' }"><td colspan="7" /></tr>
              <tr v-for="row in histVisibleRows" :key="row.id" :class="{ active: row.id === decl?.id }">
                <td class="dc-mono">{{ row.id }}</td>
                <td>{{ row.targetDate }}</td>
                <td>
                  <span class="dc-mode-tag" :data-mode="declarationModeOf(row)">
                    {{ DECLARATION_MODE_LABEL[declarationModeOf(row)] }}
                  </span>
                </td>
                <td>{{ STATUS_LABEL[row.status] }}</td>
                <td class="dc-num">{{ Math.round(row.energyCurveMwh96.reduce((s, v) => s + v, 0) * 10) / 10 }} MWh</td>
                <td>{{ row.createdBy }}</td>
                <td class="dc-row-ops">
                  <button type="button" class="dc-jump" @click="selectHistoryOrder(row)">查看</button>
                  <button
                    type="button"
                    class="dc-jump"
                    :disabled="!canEditCurve || busy || row.id === decl?.id"
                    :title="canEditCurve ? '复制该单 96 点曲线到当日单（随后需重新风控）' : '当日单当前状态不可改曲线'"
                    @click="copyCurveToToday(row)"
                  >复制曲线</button>
                  <button
                    v-if="isTerminal(row)"
                    type="button"
                    class="dc-jump"
                    :disabled="busy || !!copySubjectMismatchOf(row)"
                    :title="copySubjectMismatchOf(row) || '按同参数复制一张历史模拟单做回测，原单保持终态'"
                    @click="copyAsRehearsal(row)"
                  >复制模拟单</button>
                </td>
              </tr>
              <tr
                v-if="histWin.end < historyRows.length"
                class="dc-hist-spacer"
                :style="{ height: (historyRows.length - histWin.end) * HIST_ROW_H + 'px' }"
              ><td colspan="7" /></tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
      </div>
      <div class="dc-area dc-area-curve">

    <!-- 申报曲线 -->
    <section id="dc-sec-curve" class="dc-panel">
      <h3><FileUp :size="14" /> 申报曲线</h3>
      <div class="dc-curve">
        <span>单据当前 <strong>{{ declaredTotal.toFixed(1) }}</strong> MWh</span>
        <template v-if="forecastTotal !== null">
          <span>S3 产出 <strong>{{ forecastTotal.toFixed(1) }}</strong> MWh（来自 S3 方向判断，可覆盖）</span>
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
          S3 方向判断未产出——曲线在下方编辑器手工维护（或复制历史曲线），不阻断。
          <button type="button" class="dc-jump" @click="emit('go', 'direction')">回 S3 补</button>
        </span>
      </div>
      <!-- 96 点编辑器（受控共享组件，原申报台同款）：滚轮微调/明细表/CSV 导出/批量段/复制历史曲线 -->
      <DeclarationCurveEditor
        v-if="decl"
        :declaration="decl"
        :history-rows="historyRows"
        :busy="busy"
        @updated="onEditorUpdated"
        @request-history="onEditorRequestHistory"
      />
      <p v-else class="dc-muted">创建草稿后在此编辑 96 点曲线。ML 价格预测对比与申报决策包见
        <button type="button" class="dc-jump" @click="emit('go', 'direction')">S3 方向判断</button>
        的「预测与窗口参考」。
      </p>
      <p v-if="decl" class="dc-muted">ML 价格预测对比与申报决策包见
        <button type="button" class="dc-jump" @click="emit('go', 'direction')">S3 方向判断</button>
        的「预测与窗口参考」折叠——同一份数据不在这里看第二遍。
      </p>
    </section>

    <!-- 储能充放电计划块跟随曲线栏（D7：附属块随所属段，不穿插打断申报台迁入功能） -->
    <details v-if="activeStanceType === 'STORAGE'" class="dc-storage" open>
      <summary>
        储能充放电计划（R1/R2/R3/R11 + 八项约束）
        <em v-if="pf.storagePlan">已写回：循环 {{ pf.storagePlan.cycles }} 次 · 预期毛利 {{ pf.storagePlan.grossMarginYuan }} 元</em>
        <em v-else>储能立场必做；其它立场可忽略</em>
      </summary>
      <StorageDispatchBlock :declaration="decl" @updated="emit('updated', $event)" />
    </details>
      </div>
      <div class="dc-area dc-area-machine">

    <!-- 风控与提交（申报台 trust gate/审批记录/L3 双签/出清标记/套保敞口预览
         + S4 重试/人工通道/回执核对，合并后只留一套） -->
    <section id="dc-sec-machine" class="dc-panel">
      <h3><Save :size="14" /> 风控与提交</h3>
      <div v-if="!decl" class="dc-muted">未绑定作业单据——先在「申报单」创建草稿。</div>
      <template v-else>
        <div class="dc-machine">
          <span class="dc-status">{{ STATUS_LABEL[decl.status] }}</span>

          <template v-if="status === 'DRAFT' || status === 'REJECTED' || status === 'RISK_CHECKED'">
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doRiskCheck">
              {{ status === 'RISK_CHECKED' ? '风控复检' : '风控检查' }}
            </button>
          </template>
          <template v-if="status === 'RISK_CHECKED'">
            <button
              type="button"
              class="dc-btn primary"
              :disabled="busy || decl.riskCheck?.blocked === true"
              :title="decl.riskCheck?.blocked ? '最新风控检查被硬约束拦下，须调整后重新风控通过' : ''"
              @click="doSubmitForApproval"
            >送审</button>
            <span v-if="decl.riskCheck?.blocked" class="dc-muted dc-invalid">最新风控检查未通过（硬约束），须重新风控通过后才能送审</span>
          </template>
          <template v-if="status === 'PENDING_APPROVAL' && canApproveCurrent">
            <input v-model="approveComment" type="text" class="dc-comment" placeholder="审批意见（写入审计留痕，可空）" />
            <button type="button" class="dc-btn primary" :disabled="busy" @click="doApprove('approve')">
              {{ isRehearsal ? '批准（演练）' : '批准' }}
            </button>
            <button type="button" class="dc-btn danger" :disabled="busy" @click="doApprove('reject')">驳回</button>
            <span class="dc-muted">四眼原则：创建人不得审批本人真实申报单（服务端强制，演练单豁免）</span>
          </template>
          <template v-if="status === 'APPROVED'">
            <button type="button" class="dc-btn primary" :disabled="busy || deadlinePassed" @click="doSubmit">
              {{ deadlinePassed ? '已过申报截止，禁止提交' : '提交申报' }}
            </button>
          </template>
          <template v-if="status === 'ACKNOWLEDGED'">
            <button type="button" class="dc-btn" :disabled="busy" @click="doMarkCleared">出清结果已核对（标记已出清）</button>
          </template>
        </div>

        <!-- L3 双签与演练自批留痕提示（申报台同款） -->
        <p v-if="status === 'PENDING_APPROVAL' && decl.l3Signatures?.length" class="dc-muted">
          <Stamp :size="12" /> L3 已有一签（{{ decl.l3Signatures.map((s) => s.approver).join('、') }}）· 待第二签
        </p>
        <p v-else-if="status === 'PENDING_APPROVAL' && isRehearsal && isSelfDeclaration" class="dc-muted">演练自批 · 将留痕</p>
        <p v-if="approvalBlockedReason" class="dc-muted">{{ approvalBlockedReason }}</p>

        <!-- 套保敞口预览（HA-02：仅中长期口径，只作参考；约束由服务端风控按同口径施加） -->
        <div v-if="status === 'DRAFT' || status === 'RISK_CHECKED'" class="dc-exposure">
          <button type="button" class="dc-btn" :disabled="exposureLoading" @click="refreshExposure()">刷新敞口预览</button>
          <span v-if="exposureStatus === 'auto' && exposure" class="dc-muted">
            已联动套保工作台（仅中长期口径，预览）：已知
            {{ exposure.ratio.coverage.coveredCount }}/{{ exposure.ratio.coverage.totalCount }} 时段
            <InfoHint text="风控检查由服务端按同一口径施加约束，未知时段不施加约束。" />
            <span :class="{ 'dc-mock-src': exposureSourceIsMock }">{{ exposureSourceText }}</span>
          </span>
          <span v-else-if="exposureStatus === 'failed'" class="dc-muted">
            {{ exposureError || '套保服务暂不可用' }}；风控检查时服务端会如实标注是否施加了敞口约束。
          </span>
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
        <!-- 中长期敞口约束的来源与覆盖说明：服务端生成，原样展示不重算（#3475） -->
        <p v-if="riskExposureSource" class="dc-exposure-src" :class="{ manual: riskExposureSource.manual }" data-testid="risk-exposure-source">
          中长期敞口约束 · {{ riskExposureSource.note }}
        </p>

        <!-- 审批记录（申报台同款） -->
        <div v-if="decl.approvalRecord.length" class="dc-approval-log">
          <h4>审批记录</h4>
          <p v-for="r in decl.approvalRecord" :key="r.at" class="dc-muted">
            {{ r.at.slice(0, 19).replace('T', ' ') }} · {{ r.approver }}（{{ r.role }}）{{ r.decision === 'approve' ? (r.dualSignPending ? '批准（L3 双签·第一签，待第二签）' : '批准') : '驳回' }}
            {{ r.comment ? `：${r.comment}` : '' }}（{{ r.gateLevel }}）
          </p>
        </div>

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
          <em v-if="decl.receipt.mock">Mock 网关（非真实申报）{{ decl.receipt.mode === 'REHEARSAL' ? ' · 历史模拟演练' : '' }}——真实申报以交易平台回执为准</em>
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
      </div>
    </div>

    <!-- 链路增强区（S4 原有内容，整体后置不穿插申报作业区） -->
    <div class="dc-zone dc-zone-enhance">
      <div class="dc-zone-head">链路增强</div>
      <div class="dc-layout-enhance">
      <div class="dc-area dc-area-segments">

    <!-- 分段价量报价草稿（F3.4）：发电/储能立场报量报价；售电 T3 报量不报价（不渲染） -->
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
        <span v-if="!priceCenterOfS2" class="dc-warn-inline">S2 未写回市场判断（价格中枢）——没有价格锚不生成分段，不编数字；也可在申报曲线编辑器直接手工维护。
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

    <!-- 临场改价留痕（#2016 · 自 S1 迁入）：改价发生在申报刻，
         计划价→改后价及依据当场登记，次日回判「改对=可复制 / 改错=需修正」。默认收起。 -->
    <details class="dc-segments dc-pricechange">
      <summary>
        <Layers :size="13" /> 临场改价留痕
        <em>{{ pcPending.length ? `${pcPending.length} 条待判定` : '计划价与临场改价的事后追溯记录（本地原型）' }}</em>
      </summary>
      <div class="dc-pc-form">
        <label>日期<input v-model="pcForm.date" type="date" /></label>
        <label>决策点<input v-model="pcForm.decisionPoint" type="text" placeholder="如：晚高峰申报价" /></label>
        <label>计划价<input v-model.number="pcForm.planPrice" type="number" step="0.01" placeholder="如：0.35" /></label>
        <label>改后价<input v-model.number="pcForm.changedPrice" type="number" step="0.01" placeholder="如：0.38" /></label>
        <label class="dc-pc-why">依据<input v-model="pcForm.rationale" type="text" placeholder="当时看到了什么" /></label>
        <button type="button" class="dc-btn" @click="submitPriceChange">登记</button>
      </div>
      <p v-if="pcError" class="dc-err">{{ pcError }}</p>
      <ul v-if="pcPending.length" class="dc-pc-list">
        <li v-for="r in pcPending" :key="r.id">
          {{ r.date }} · {{ r.decisionPoint }}：计划 {{ r.planPrice }} → 改 {{ r.changedPrice }}（{{ r.rationale }}）
          <span class="dc-pc-actions">
            <button type="button" class="dc-jump" @click="judgePc(r.id, 'replicable')">改对（可复制）</button>
            <button type="button" class="dc-jump" @click="judgePc(r.id, 'needs-fix')">改错（需修正）</button>
          </span>
        </li>
      </ul>
      <p v-else class="dc-muted">无待判定的临场改价。</p>
    </details>
      </div>
      <div class="dc-area dc-area-checklist">

    <!-- 放行自查（T4 十项） -->
    <section id="dc-sec-checklist" class="dc-panel">
      <h3>
        <ShieldCheck :size="14" /> 放行自查（T4 十项）
        <span class="dc-verdict" :class="verdict.allowed ? 'ok' : 'bad'">
          {{ verdict.passedCount }}/{{ verdict.total }} {{ verdict.allowed ? '可进入提交' : '不可提交' }}
        </span>
        <InfoHint text="本清单是交易员的推演台；权威把关在服务端——下方「风控检查」用同一套规则重算并阻断硬约束（409 拦转态），故此处结论不直接改单据状态。" />
      </h3>
      <p class="dc-summary" :class="verdict.allowed ? 'ok' : 'bad'">{{ verdict.summary }}</p>

      <div class="dc-grid">
        <div>
          <!-- 判据输入收纳（slim-s3-s7-stages）：与十项清单同款自动展开——有未过项即展开，
               全过时收起只留结论徽章；部分判据已由 S1–S3 写回自动填充（徽章提示）。
               无上游产出项标「无上游数据」转人工勾填，不判不通过（D1）。 -->
          <details class="dc-criteria" :open="!verdict.allowed">
            <summary>
              判据输入
              <em v-if="pf.dataGate || pf.storagePlan || pf.forecast" class="dc-auto">部分已由 S1–S3 产出自动填充</em>
              <em v-else>展开人工录入</em>
              <em v-if="missingUpstream.length" class="dc-no-upstream">无上游数据：{{ missingUpstream.join('、') }}——请人工勾填，不判不通过</em>
            </summary>
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
          </details>
        </div>

        <div>
          <!-- 十项清单：检验不是主角，默认只列未通过项，全过时折叠为一行 -->
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
    </section>
      </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.dc { display: flex; flex-direction: column; gap: 12px; }

/* D7 第三版（三次验收降噪）：申报作业区 = 申报台同源功能连续成片（左栏曲线编辑器主操作面，
   右栏草稿历史双 tab/风控提交）；链路增强区 = S4 原有内容整体后置（分段报价+放行自查），
   两区不穿插。grid-areas 定位，附属块随所属段入栏。 */
.dc-zone { display: flex; flex-direction: column; gap: 8px; }
.dc-zone + .dc-zone { margin-top: 8px; }
.dc-zone-head { display: flex; align-items: baseline; gap: 10px; font-size: var(--font-md); font-weight: 600; color: var(--text, #1e293b); }
.dc-layout {
  display: grid; gap: 12px; align-items: start;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  grid-template-areas:
    "curve draft"
    "curve machine";
}
.dc-layout-enhance {
  display: grid; gap: 12px; align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas: "segments checklist";
}
.dc-area { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dc-area-draft { grid-area: draft; }
.dc-area-curve { grid-area: curve; }
.dc-area-segments { grid-area: segments; }
.dc-area-checklist { grid-area: checklist; }
.dc-area-machine { grid-area: machine; }
/* 窄屏降级：两区各自退化单栏堆叠，顺序 申报单(含历史tab)→曲线→风控提交→分段报价→放行自查 */
@media (max-width: 1100px) {
  .dc-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "draft" "curve" "machine";
  }
  .dc-layout-enhance {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "segments" "checklist";
  }
}
.dc-deadline { padding: 7px 12px; border: 1px solid var(--primary-tint-border, #bfdbfe); border-radius: 8px; background: var(--panel-sub, #f8fbff); font-size: var(--font-sm); }
.dc-deadline.over { border-color: var(--danger, #fca5a5); background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); }
.dc-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: var(--panel, #fff); }
.dc-panel h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: var(--font-md); flex-wrap: wrap; }
.dc-panel h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; font-size: var(--font-sm); }
.dc-verdict { margin-left: auto; padding: 2px 10px; border-radius: 9px; font-size: var(--font-xs); }
.dc-verdict.ok { background: var(--primary-tint, #f0fdf4); color: var(--success, #15803d); }
.dc-verdict.bad { background: var(--danger-tint, #fef2f2); color: var(--danger, #b91c1c); }
.dc-summary { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; font-size: var(--font-sm); line-height: 1.6; }
.dc-summary.ok { background: var(--primary-tint, #f0fdf4); color: var(--success, #166534); }
.dc-summary.bad { background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); }

/* 草稿与历史（双 tab 面板头） */
.dc-draft-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: var(--font-sm); }
.dc-mono { font-family: ui-monospace, monospace; font-size: var(--font-xs); }
.dc-draft-form { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.dc-draft-form label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-draft-form input, .dc-draft-form select { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.dc-rationale { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: var(--font-sm); }
.dc-rationale b { color: var(--danger, #b91c1c); }
.dc-rationale textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); font-family: inherit; }
.dc-rationale small { font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-rationale small.warn { color: var(--warning, #b45309); }
.dc-draft-launch { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.dc-rehearsal-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; font-size: var(--font-xs); border-radius: 999px; border: 1px solid var(--warning, #f59e0b); color: var(--warning, #b45309); background: var(--warning-tint, rgba(245, 158, 11, 0.12)); }
.dc-rehearsal-hint { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 8px 10px; font-size: var(--font-xs); line-height: 1.6; border-radius: 8px; border: 1px solid var(--warning, #f59e0b); color: var(--warning, #b45309); background: var(--warning-tint, rgba(245, 158, 11, 0.08)); }
.dc-rehearsal-hint.warn { border-color: var(--danger, #ef4444); color: var(--danger, #b91c1c); background: var(--danger-tint, rgba(239, 68, 68, 0.08)); }

.dc-curve { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: var(--font-sm); font-variant-numeric: tabular-nums; margin-bottom: 8px; }
.dc-btn { padding: 4px 14px; border: 1px solid var(--accent, #2563eb); border-radius: 5px; background: var(--primary-tint, #eff6ff); color: var(--accent, #1d4ed8); font-size: var(--font-sm); cursor: pointer; }
.dc-btn.primary { background: var(--accent, #2563eb); color: #fff; }
.dc-btn.danger { border-color: var(--danger, #dc2626); background: var(--danger-tint, #fef2f2); color: var(--danger, #b91c1c); }
.dc-btn:disabled { opacity: .45; cursor: not-allowed; }
.dc-jump { padding: 0; border: none; background: none; color: var(--accent, #1d4ed8); font: inherit; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.dc-jump:disabled { opacity: .45; cursor: not-allowed; }
.dc-ok { margin: 6px 0 0; font-size: var(--font-sm); color: var(--success, #15803d); display: inline-flex; align-items: center; gap: 4px; }
.dc-err { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); font-size: var(--font-sm); }
.dc-muted { font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-invalid { color: var(--danger, #b91c1c); }
.dc-warn-inline { font-size: var(--font-sm); color: var(--warning, #b45309); }

.dc-storage { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: var(--panel, #fff); padding: 8px 12px; }
.dc-storage summary { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dc-storage summary em { font-style: normal; font-weight: 400; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); }
.dc-storage[open] summary { margin-bottom: 8px; }

.dc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.dc-auto { margin-left: 8px; font-style: normal; font-size: var(--font-10); font-weight: 400; padding: 1px 7px; border-radius: 8px; background: var(--primary-tint, #ecfdf5); color: var(--success, #047857); }
.dc-no-upstream { margin-left: 8px; font-style: normal; font-size: var(--font-10); font-weight: 400; padding: 1px 7px; border-radius: 8px; background: var(--warning-tint, #fffbeb); color: var(--warning, #92400e); }
.dc-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.dc-fields label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-fields input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-sm); }
.dc-toggles { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: var(--font-sm); }
.dc-toggles label { display: inline-flex; align-items: center; gap: 5px; }
.dc-redline { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-redline input { padding: 4px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-sm); }

.dc-list-fold { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.dc-list-fold summary { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); font-weight: 600; cursor: pointer; }
.dc-list-fold[open] summary { margin-bottom: 6px; }
.dc-criteria { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.dc-criteria summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--font-sm); font-weight: 600; cursor: pointer; }
.dc-criteria summary em { font-style: normal; font-weight: 400; }
.dc-criteria[open] summary { margin-bottom: 8px; }
.dc-fold-badge { padding: 1px 9px; border-radius: 9px; font-size: var(--font-10); font-weight: 600; }
.dc-fold-badge.ok { background: var(--primary-tint, #dcfce7); color: var(--success, #15803d); }
.dc-fold-badge.bad { background: var(--danger-tint, #fee2e2); color: var(--danger, #991b1b); }

.dc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dc-list li { padding: 6px 9px; border-radius: 6px; border-left: 3px solid transparent; }
.dc-list li.pass { background: var(--primary-tint, #f6fefa); border-left-color: var(--success, #4ade80); }
.dc-list li.hard { background: var(--danger-tint, #fef2f2); border-left-color: var(--danger, #ef4444); }
.dc-list li.soft { background: var(--warning-tint, #fffbeb); border-left-color: var(--warning, #f59e0b); }
.dc-item-head { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; font-size: var(--font-sm); }
.dc-no { min-width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: var(--text, #1e293b); color: #fff; font-size: var(--font-10); }
.dc-sev { margin-left: auto; font-size: var(--font-10); padding: 1px 7px; border-radius: 8px; background: var(--surface-hover, rgba(0,0,0,.06)); }
.dc-detail { margin-top: 2px; padding-left: 25px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }

.dc-override { margin-top: 10px; }
.dc-override-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dc-override-form select, .dc-override-form input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.dc-override-form input { min-width: 150px; }
.dc-override-form button { padding: 4px 14px; border: 1px solid var(--accent, #2563eb); border-radius: 5px; background: var(--primary-tint, #eff6ff); color: var(--accent, #1d4ed8); font-size: var(--font-sm); cursor: pointer; }
.dc-overrides { list-style: none; margin: 8px 0 0; padding: 0; font-size: var(--font-xs); }
.dc-overrides li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 5px 8px; border-radius: 6px; background: var(--panel-sub, #f8fafc); margin-bottom: 4px; }
.dc-overrides button { margin-left: auto; padding: 1px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; background: var(--panel, #fff); cursor: pointer; font-size: var(--font-xs); }

.dc-machine { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dc-status { padding: 3px 12px; border-radius: 9px; background: var(--primary-tint, #eff6ff); color: var(--accent, #1d4ed8); font-size: var(--font-sm); font-weight: 600; }
.dc-comment { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); min-width: 200px; }
.dc-exposure { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.dc-mock-src { padding: 1px 7px; border-radius: 8px; background: var(--warning-tint, #fef3c7); color: var(--warning, #92400e); }
.dc-exposure-src { margin: 6px 0 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-exposure-src.manual { color: var(--warning, #b45309); }
.dc-approval-log { margin-top: 8px; }
.dc-approval-log p { margin: 2px 0; }

.dc-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); margin-top: 8px; }
.dc-table th, .dc-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.dc-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc-table tr.fail td { background: var(--danger-tint, #fef2f2); }
.dc-table tr.unavailable td { background: var(--warning-tint, #fffbeb); }
.dc-detail-cell { color: var(--el-text-color-secondary, #667); }

/* 草稿与历史双 tab 面板头（申报台 decl-tabs 同构）：双 tab + 状态 + 单号一行 */
.dc-panel-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.dc-tabs { display: flex; gap: 4px; }
.dc-tabs button {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; font-size: var(--font-md);
  border: 1px solid transparent; border-radius: 6px 6px 0 0; background: transparent;
  color: var(--el-text-color-regular, #303133); cursor: pointer;
}
.dc-tabs button.on {
  border-color: var(--el-border-color, #dcdfe6); border-bottom-color: transparent;
  background: var(--el-fill-color-blank, #fff); color: var(--el-color-primary, #2563eb); font-weight: 600;
}
.dc-tab-count {
  min-width: 16px; padding: 0 4px; font-size: var(--font-xs); line-height: 16px; text-align: center;
  border-radius: 8px; background: var(--el-fill-color, #f5f7fa); color: var(--el-text-color-secondary, #909399);
}
/* 历史申报单列表（六/七次验收）：上限由 histCap 内联 style 实时跟随左栏曲线面板高度
   （此处 min(620px,75vh) 仅为观测未就绪时的兜底）；虚拟滚动窗口化渲染，
   行高/表头高为定值（40/32）与脚本 HIST_ROW_H/HIST_HEAD_H 保持一致。
   滚动条（七次验收实测 Chromium 146）：`:vertical` 限定符无效——竖条须用不带限定符的
   `::-webkit-scrollbar { width: 0 }` 隐藏（滚动功能保留）；`:horizontal` 限定符有效，
   据此保留原生样式的横条（溢出仅少量时可拖）。 */
.dc-history-scroll { max-height: min(620px, 75vh); overflow: auto; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; }
.dc-history-scroll::-webkit-scrollbar { width: 0; }
.dc-history-scroll::-webkit-scrollbar:horizontal { height: 10px; }
.dc-history-scroll::-webkit-scrollbar-thumb:horizontal { background: rgba(0, 0, 0, 0.24); border-radius: 5px; }
.dc-history-scroll::-webkit-scrollbar-track:horizontal { background: transparent; }
.dc-history-scroll .dc-history-table { min-width: 620px; margin: 0; }
.dc-history-scroll thead th { position: sticky; top: 0; z-index: 1; background: var(--panel-sub, #f8fbff); height: 32px; }
.dc-history-scroll tbody tr { height: 40px; }
.dc-hist-spacer td { padding: 0; border: none; }
.dc-decl-select { max-width: 240px; }

@media (max-width: 760px) {
  .dc-grid { grid-template-columns: 1fr; }
  .dc-table, .dc-seg-table, .dc-receipt-checks { display: block; overflow-x: auto; }
  .dc-fields { grid-template-columns: 1fr 1fr; }
}
.dc-receipt { margin-top: 8px; padding: 7px 10px; border-radius: 8px; background: var(--primary-tint, #f0fdf4); color: var(--success, #166534); font-size: var(--font-sm); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dc-receipt em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: var(--warning-tint, #fef3c7); color: var(--warning, #92400e); font-size: var(--font-10); }
.dc-receipt-checks { width: 100%; border-collapse: collapse; font-size: var(--font-xs); margin-top: 6px; background: var(--panel, #fff); }
.dc-receipt-checks th, .dc-receipt-checks td { padding: 4px 8px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; }
.dc-receipt-checks th { color: var(--el-text-color-secondary, #667); }
.dc-receipt-checks tr.bad td { background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); }
.dc-receipt-checks tr.manual td { background: var(--warning-tint, #fffbeb); color: var(--warning, #92400e); }

.dc-deadline.remind-blue { border-color: var(--primary-tint-border, #93c5fd); background: var(--primary-tint, #eff6ff); }
.dc-deadline.remind-yellow { border-color: var(--warning, #fcd34d); background: var(--warning-tint, #fffbeb); color: var(--warning, #92400e); }
.dc-deadline.remind-red { border-color: var(--danger, #f87171); background: var(--danger-tint, #fef2f2); color: var(--danger, #991b1b); font-weight: 600; }

.dc-segments { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: var(--panel, #fff); padding: 8px 12px; }
/* 临场改价留痕（#2016 · 自 S1 迁入）：登记表单 + 待判定回判列表 */
.dc-pc-form { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: var(--font-sm); }
.dc-pc-form label { display: inline-flex; align-items: center; gap: 4px; color: var(--el-text-color-secondary, #667); }
.dc-pc-form input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); width: 96px; }
.dc-pc-why { flex: 1 1 180px; } .dc-pc-why input { width: 100%; }
.dc-pc-list { margin: 6px 0 0; padding-left: 18px; font-size: var(--font-sm); }
.dc-pc-list li { margin: 3px 0; line-height: 1.6; }
.dc-pc-actions { margin-left: 8px; white-space: nowrap; }
.dc-segments summary { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dc-segments summary em { font-style: normal; font-weight: 400; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); }
.dc-segments[open] summary { margin-bottom: 8px; }
.dc-seg-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--font-sm); margin-bottom: 8px; }
.dc-seg-bar select { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.dc-seg-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.dc-seg-table th, .dc-seg-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.dc-seg-table th:first-child, .dc-seg-table td:first-child { text-align: left; }
.dc-seg-table input { width: 84px; padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-xs); text-align: right; }

.dc-manual { margin-top: 8px; padding: 8px 12px; border: 1px solid var(--danger, #fca5a5); border-radius: 8px; background: var(--danger-tint, #fef2f2); font-size: var(--font-sm); line-height: 1.7; }
.dc-manual h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 4px; font-size: var(--font-sm); color: var(--danger, #991b1b); }
.dc-manual-fails { margin: 0 0 6px; padding-left: 18px; font-size: var(--font-xs); color: var(--danger, #991b1b); }
.dc-manual-read { display: flex; gap: 14px; flex-wrap: wrap; padding: 5px 9px; border-radius: 6px; background: var(--panel, #fff); font-variant-numeric: tabular-nums; }

/* 历史申报单 tab 内容 */
.dc-history-scope { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dc-history-ops { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dc-select { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); }
.dc-export-group { display: inline-flex; align-items: stretch; }
.dc-export-group input { border-radius: 5px 0 0 5px; }
.dc-export-group .dc-btn { border-radius: 0 5px 5px 0; border-left: none; padding: 3px 10px; font-size: var(--font-xs); }
.dc-history-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); margin-top: 8px; }
.dc-history-table th, .dc-history-table td { padding: 4px 6px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }.dc-history-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dc-history-table tr.active td { background: var(--sky-tint, rgba(14, 165, 233, 0.08)); }
.dc-history-table td.dc-num { font-variant-numeric: tabular-nums; }
/* 模式列（五次验收）：去药丸框，改色点+灰字——纵向对齐、不再抢行内视觉 */
.dc-history-table .dc-mode-tag { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: none; background: transparent; border-radius: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.dc-history-table .dc-mode-tag::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #2563eb); flex: none; }
.dc-history-table .dc-mode-tag[data-mode='REHEARSAL'] { color: var(--warning, #b45309); background: transparent; }
.dc-history-table .dc-mode-tag[data-mode='REHEARSAL']::before { background: var(--warning, #f59e0b); }
.dc-row-ops { white-space: nowrap; }
.dc-row-ops .dc-jump { margin-right: 8px; font-size: var(--font-xs); }
.dc-row-ops .dc-jump:last-child { margin-right: 0; }

</style>
