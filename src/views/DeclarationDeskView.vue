<script setup lang="ts">
// 申报工作台（P1 申报闭环补芯 × main 智能体动线收拢的合并版）：
// - 步骤条由申报单状态机驱动（/api/v1/trading/spot/declarations，不开智能体也能走完全流程）
// - 智能体为可选协助：服务探活（离线给启动指引而非裸抛 502）、页内情报助手
// （清单项移交执行不离开本页、完成打勾）、申报准备面板 done 后刷新申报单列表
// （declaration_prep finalize 落库的 DRAFT 即时可见）
// ①草稿与策略 → ②风控与审批 → ③提交与回执 → ④出清跟踪
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlarmClock, ArrowRight, Bot, CheckCircle2, FileSearch, FlaskConical, History, LineChart, Loader2, PlugZap, ShieldCheck, Sparkles, Stamp, XCircle } from 'lucide-vue-next'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import DeclarationForecastCompare from '../components/forecast/DeclarationForecastCompare.vue'
import { makeSessionReadyGuard } from '../components/agent/sessionReadyGuard'
import { resolveIntelCapability, type IntelCapability } from '../data/declarationIntelCapability'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import DataBasisBadge from '../components/DataBasisBadge.vue'
import TrustBadge from '../components/common/TrustBadge.vue'
import { probeAgentService } from '@/services/agent/agentClient'
import {
  fetchCockpit,
  fetchOptimizeBid,
  type CockpitResult,
  type OptimizeBidFrontierPoint,
  type OptimizeBidResult
} from '@/services/forecast/mlForecastClient'
import { fetchExposure, type ExposureResult } from '@/services/quant/quantClient'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomToolbox } from '@/services/chart/chartOptions'
import { DATA_BASIS_LABEL, type DataBasis } from '@/services/dataBasis'
import { assertOperational } from '@/services/data/trustGate'
import { getCurrentUser } from '@/services/auth'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import { getRegionSpotProfile } from '../data/regionSpotProfiles'
import {
  approveDeclaration,
  createDeclaration,
  declarationModeOf,
  DECLARATION_MODE_LABEL,
  fetchDeclarationMeta,
  getDeclaration,
  listDeclarations,
  listDeclarationsPage,
  markDeclarationCleared,
  runDeclarationRiskCheck,
  STATUS_LABEL,
  stepOfStatus,
  submitDeclaration,
  submitDeclarationForApproval,
  updateDeclarationCurve,
  type DeclarationMeta,
  type DeclarationMode,
  type DeclarationOrder,
} from '@/services/declarations'
import { DECLARATION_TRANSITIONS } from '@/services/contracts/spotDeclarationContract.gen'
import { buildRehearsalNote, formatRehearsalStamp, parseRehearsalStartedAt } from '@/services/declarationRehearsal'

const router = useRouter()
const route = useRoute()

// 向导步骤（申报单状态驱动）
const STEPS = ['草稿与策略', '风控与审批', '提交与回执', '出清跟踪'] as const

// 智能体服务探活：离线时给出启动指引，而不是让面板裸抛 502。
// 探活只在 mount 与手动重试时跑、keep-alive 切回不重挂，一次超时横幅就常驻
//（DEVELOPMENT.md §4 登记过的「探活超时假阳性，刷新即恢复」病根）——offline 后
// 按 5s→10s→15s 封顶退避静默重探，后端拉起/空闲后横幅自愈；端点是开放读轻量
// GET（useAgentHealth.ts 同款），常驻轮询代价可忽略。
const harness = ref<'checking' | 'online' | 'offline'>('checking')
// 失败原因分流文案：timeout=服务在但 2.5s 未应答（典型：价格预测同步重训占住后端）；
// unreachable=代理回 502/404 等否定答复（服务多半真没起）→ 才给 npm 启动指引。
const harnessFailReason = ref<'timeout' | 'unreachable' | null>(null)
const HARNESS_RETRY_DELAYS_MS = [5000, 10000, 15000] as const
let harnessRetryTimer = 0
let harnessRetryAttempt = 0
// 世代守卫：手动重试/后台重探/切页作废互相竞态时，迟到结果不得覆盖新状态
let harnessProbeGeneration = 0

async function checkHarness(opts: { silent?: boolean } = {}) {
  const generation = ++harnessProbeGeneration
  window.clearTimeout(harnessRetryTimer)
  // 后台重探不打断当前横幅（checking 文案每轮闪烁）；只有首探与手动重试才显示进行中
  if (!opts.silent) harness.value = 'checking'
  const result = await probeAgentService()
  if (generation !== harnessProbeGeneration) return
  if (result === 'online') {
    harnessFailReason.value = null
    harnessRetryAttempt = 0
    harness.value = 'online'
    return
  }
  harnessFailReason.value = result
  harness.value = 'offline'
  const delay = HARNESS_RETRY_DELAYS_MS[Math.min(harnessRetryAttempt, HARNESS_RETRY_DELAYS_MS.length - 1)]
  harnessRetryAttempt += 1
  harnessRetryTimer = window.setTimeout(() => {
    void checkHarness({ silent: true })
  }, delay)
}

function retryHarness() {
  void checkHarness()
}

// 目标日与截止倒计时
function fmtDate(d: Date): string {
  const local = new Date(d.getTime() + 8 * 3600 * 1000)
  return local.toISOString().slice(0, 10)
}
// 默认目标日：当前（+08:00）尚未过 10:30 → 明天可报；已过 → 后天（明天窗口已关）
function defaultTargetDate(): string {
  const now = new Date()
  const local = new Date(now.getTime() + 8 * 3600 * 1000)
  const pastDeadline = local.getUTCHours() > 10 || (local.getUTCHours() === 10 && local.getUTCMinutes() >= 30)
  return fmtDate(new Date(now.getTime() + (pastDeadline ? 2 : 1) * 86400000))
}
const targetDate = ref(defaultTargetDate())
// 目标日 ⇄ 路由 query：刷新/分享链接后还原同一申报日
useQuerySync({ targetDate })

// 申报模式（LIVE / REHEARSAL）
// 建单时可选；建单后由申报单自身的 mode 决定（服务端不接受改 mode）。
const draftMode = ref<DeclarationMode>('LIVE')
const currentMode = computed<DeclarationMode>(() =>
  current.value ? declarationModeOf(current.value) : draftMode.value
)
const isRehearsal = computed(() => currentMode.value === 'REHEARSAL')
// 今日（+08:00）之前的目标日，真实申报窗口必然已关闭，此时默认建演练单更符合意图。
// 重算时机在 refresh() 末尾（current 落定之后），不能放在 targetDate 的 watch 里：
// 那时 current 仍是旧目标日的单，切到无申报单的历史日期时不会切成 REHEARSAL，
// 用户点创建就会拿到立即过期的 LIVE 单（反向亦会残留 REHEARSAL）。
const todayLocal = computed(() => fmtDate(new Date(nowTick.value)))
const isPastTargetDate = computed(() => targetDate.value < todayLocal.value)
// 未来目标日但申报窗口已关闭：如今天 11:00 选明天，明天的截止是今天 10:30，已过。
// 此时建 LIVE 单同样会立即作废，故与历史日一样需要提示（meta.deadline 由服务端给出）。
const isLiveWindowClosed = computed(() => {
  if (isPastTargetDate.value) return false
  const iso = meta.value?.deadline
  if (!iso) return false
  const ts = new Date(iso).getTime()
  return Number.isFinite(ts) && ts <= nowTick.value
})
function syncDraftModeToTargetDate() {
  if (current.value) return
  draftMode.value = isPastTargetDate.value ? 'REHEARSAL' : 'LIVE'
}
const meta = ref<DeclarationMeta | null>(null)
const nowTick = ref(Date.now())
let ticker: number | undefined

const deadlineIso = computed(() => current.value?.deadline ?? meta.value?.deadline ?? null)
// deadline 非法串（如脏日期）→ new Date().getTime() 返回 NaN → countdownText 显「NaN时NaN分NaN秒」（#489）。
// 统一在 msRemaining 出口把非法/缺失归一为 null，下游 countdownText/isExpiredWindow 自然走「—」分支。
const msRemaining = computed(() => {
  if (!deadlineIso.value) return null
  const ts = new Date(deadlineIso.value).getTime()
  if (!Number.isFinite(ts)) return null
  return ts - nowTick.value
})
// 演练单不受申报截止约束（后端 submit 同样只对 LIVE 校验），故截止窗口对其恒为 false，
// 否则历史目标日的演练单会被前端禁用提交按钮、与后端放行不一致。
const isExpiredWindow = computed(() =>
  currentMode.value === 'LIVE' && msRemaining.value !== null && msRemaining.value <= 0
)
const countdownText = computed(() => {
  if (msRemaining.value === null) return '—'
  if (msRemaining.value <= 0) return '已过申报截止'
  const total = Math.floor(msRemaining.value / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`
})

// 价格预测情报
const forecastBasis = ref<DataBasis>('synthetic')
const forecastStats = ref({ mean: 0, spread: 0 })
// 价格预测已改为多模型叠加对比（DeclarationForecastCompare），图表由该组件自持；
// 只保留供「创建草稿」落库的口径与统计摘要。

type IntelStatus = 'idle' | 'running' | 'done' | 'failed'
type IntelItem = {
  label: string
  desc: string
  q: string
  status: IntelStatus
  /** 与 declarationIntelCapability 的能力键对应，用于按地区判可用性 */
  key: IntelCapability['key']
}

// 申报前情报清单：点击后由智能体在本页面板执行（不跳出工作台），完成/取消回写三态。
// 三项对应 D-1 申报前必须确认的三类事实，缺一项都可能导致报价方向性错误。
const intelChecklist = reactive<IntelItem[]>([
  {
    key: 'bidding_space',
    label: '目标日负荷预测、新能源出力预测',
    desc: '测算竞价空间（负荷 − 新能源 − 外来电），决定整体报价水位',
    // 点名工具：calc_bidding_space 内部自动串 get_load_data + get_renewable_output，
    // 任一缺失即 available:false 明确报错，不合成兜底
    q: '用 calc_bidding_space 测算目标日竞价空间（负荷预测与新能源出力预测），如数据不可用请直接说明缺哪项，不要估算',
    status: 'idle'
  },
  {
    key: 'maintenance_disclosure',
    label: '检修计划 / 联络线计划披露',
    desc: '识别供给侧异动（机组检修、通道受限），修正分时价格预期',
    q: '用 list_disclosures_by_category 检索 maintenance 与 tie_line 两个类目最近的披露条目，只转述入库原文，不要推测未披露的检修安排',
    status: 'idle'
  },
  {
    key: 'position_exposure',
    label: '中长期持仓与敞口核对',
    desc: '确定现货可申报电量与套保缺口，约束申报上下限',
    // 敞口需 contracted + expected 两个 data_ref 由同一子智能体取得（跨子智能体不可传）
    q: '派 risk_sentinel 或 hedge_strategist：先用 get_positions 取本月中长期持仓、get_load_data 取预计出力，再用 calc_open_position 算套保率与逐时段敞口；两个序列必须由同一个子智能体取得',
    status: 'idle'
  }
])

// 智能体工作区：历史侧栏 + 情报清单 + 对话三栏同框，全程不离开工作台
type PanelHandle = InstanceType<typeof AgentChatPanel>
type SidebarHandle = InstanceType<typeof AgentHistorySidebar>
type AgentMode = 'market' | 'draft'

const agentMode = ref<AgentMode>('market')
const intelPanel = ref<PanelHandle | null>(null)
const prepPanel = ref<PanelHandle | null>(null)
const sidebarRef = ref<SidebarHandle | null>(null)

// 侧栏按当前模式切 page_key（情报/起草两类会话分开列）
const activePageKey = computed(() => (agentMode.value === 'market' ? 'declaration_market' : 'declaration_draft'))
const activePanel = computed(() => (agentMode.value === 'market' ? intelPanel.value : prepPanel.value))

// 会话 id 按模式分键：两个挂载点 historyKey 不同，共用一个 activeSessionId 会让
// 切模式后侧栏高亮错乱（起草面板显示情报会话被选中）。
const sessionIdByMode = reactive<Record<AgentMode, string | null>>({ market: null, draft: null })
const activeSessionId = computed(() => sessionIdByMode[agentMode.value])

// runQuestion + runKey 范式（同智能体工作台）：常驻 initialQuestion 会在任何重挂时
// 自动发送，与历史回放冲突（回放刚载入就被新问题覆盖）。改为平时留空 → 挂载走历史恢复；
// 点清单项/协助起草时置值 + runKey++ 重挂 → 走「发送开新会话」。
const marketRunQuestion = ref('')
const marketRunKey = ref(0)
const draftRunQuestion = ref('')
const draftRunKey = ref(0)

const sidebarCollapsed = ref(localStorage.getItem('agent_history_collapsed_declaration_desk') === '1')
watch(sidebarCollapsed, (v) => localStorage.setItem('agent_history_collapsed_declaration_desk', v ? '1' : '0'))

function switchAgentMode(mode: AgentMode) {
  agentMode.value = mode
}

// 侧栏四回调（范式同智能体工作台 AgentWorkbenchView）
function onSelectHistory(sessionId: string) {
  // 先清 runQuestion：否则后续任何重挂都会把待发问题重新发出去、覆盖刚载入的回放
  if (agentMode.value === 'market') marketRunQuestion.value = ''
  else draftRunQuestion.value = ''
  activePanel.value?.loadHistory(sessionId, { fromClick: true })
}

// session-ready 必须由发出事件的面板实例同时指定「归属模式」与「实例世代」：
// ① 不能在回调里读 agentMode，情报面板的 loadHistory/挂载恢复仍在异步执行时若用户切到
// 起草，旧面板迟到的事件会把 chat 会话 id 写进 draft 槽，下次重挂起草标签就恢复成
// chat 会话，「协助起草」不再跑 declaration_prep；
// ② 只固定模式还不够，startDraftAssist 每次点击都递增 draftRunKey，首次会话仍在创建时
// 再点一次就有两个同属 draft 的实例，旧实例的 createAgentSession 不受卸载 abort 控制，
// 迟到的 session-ready 会用旧会话 id 覆盖新实例已登记的 id。
// ③ 世代号必须在渲染期烘进闭包，不能在事件到达时读：模板内联箭头
// `(id) => onSessionReadyFor('draft', id, draftRunKey)` 里的 draftRunKey 编译成事件
// 到达那一刻的 $setup 访问（即当前值），旧实例的迟到事件照样通过校验。改用工厂
// `sessionReadyHandler(mode, runKey)`：处理器表达式在渲染时求值，旧 vnode 保留携带
// 旧世代的旧闭包，迟到事件被正确丢弃。语义与用例见 sessionReadyGuard.ts。
const sessionReadyHandler = makeSessionReadyGuard<AgentMode>({
  currentRunKey: (mode) => (mode === 'market' ? marketRunKey.value : draftRunKey.value),
  commit: (mode, sessionId) => { sessionIdByMode[mode] = sessionId },
})
// 必须绑定标识符，不能写成带括号的调用式：Vue 把 `@evt="fn(a, b)"` 编译成内联语句
// `$event => fn(a, b)`，事件到达时只创建并丢弃 fn 返回的内层闭包、从不执行它，会话 id
// 永远登记不上，侧栏高亮与 resume-session-id 精确恢复全部失效。用 computed 让闭包在
// 渲染期产出并作为监听器值绑定；runKey 变化 → computed 失效 → 新渲染产出携带新世代的
// 新闭包，旧 vnode 保留旧闭包，迟到事件因而被正确丢弃。
// 两种错误写法均由 verify:agent-chat-invariants 静态拦截。
const onMarketSessionReady = computed(() => sessionReadyHandler('market', marketRunKey.value))
const onDraftSessionReady = computed(() => sessionReadyHandler('draft', draftRunKey.value))

function onNewChat() {
  if (agentMode.value === 'market') marketRunQuestion.value = ''
  else draftRunQuestion.value = ''
  activePanel.value?.newConversation()
  sessionIdByMode[agentMode.value] = null
}

function onHistoryChanged() {
  void sidebarRef.value?.reload()
}


const activeIntelLabel = ref<string | null>(null)
const activeIntelHadError = ref(false)
const intelBusy = computed(() => intelChecklist.some((item) => item.status === 'running'))

function finishIntel(status: string) {
  const item = intelChecklist.find((candidate) => candidate.label === activeIntelLabel.value)
  if (item && item.status === 'running') {
    // idle（后端 service 正常收尾 done.status="idle"）/ completed（AgentChatPanel 流兜底补发）均视为核查成功；
    // 仅明确失败/取消才标 failed，与 emit 的 'cancelled'/'error' 对齐，否则正常跑完被判 failed
    item.status = activeIntelHadError.value || /fail|error|cancel/i.test(status) ? 'failed' : 'done'
  }
  activeIntelLabel.value = null
  activeIntelHadError.value = false
}

function markIntelError() {
  if (activeIntelLabel.value) activeIntelHadError.value = true
}

function beginIntelRun(item: IntelItem) {
  item.status = 'running'
  activeIntelLabel.value = item.label
  activeIntelHadError.value = false
}

/** 该情报项在当前地区是否有数据源（无源则灰置，绝不让模型编造）。 */
function intelCapabilityOf(item: IntelItem): IntelCapability {
  return resolveIntelCapability(item.key, currentRegion.value.id)
}

function intelDisabled(item: IntelItem): boolean {
  return harness.value !== 'online'
    || (intelBusy.value && item.status !== 'running')
    || intelCapabilityOf(item).status === 'unsupported'
}

function runIntel(item: IntelItem) {
  if (intelDisabled(item)) return
  // 面板常驻（不再有开/关态），两条路径：当前模式的面板已就绪就直接追问；
  // 否则置 runQuestion + 重挂，由挂载时的 initialQuestion 发出。
  const panel = activePanel.value
  if (panel) {
    const accepted = panel.ask(item.q) ?? false
    if (!accepted) return
    beginIntelRun(item)
    return
  }
  beginIntelRun(item)
  // 同 startDraftAssist：置 runQuestion 重挂前必须清待恢复会话，否则只回放不发问
  if (agentMode.value === 'market') {
    sessionIdByMode.market = null
    marketRunQuestion.value = item.q
    marketRunKey.value += 1
  } else {
    sessionIdByMode.draft = null
    draftRunQuestion.value = item.q
    draftRunKey.value += 1
  }
}

// forecastBasis / forecastStats 由对比组件回吐：创建申报草稿要落 basis（申报单据必须
// 记录当时预测的口径），而口径现在取决于用户选了哪些模型，不再是单一回放族的属性。
function onForecastSummary(summary: { basis: DataBasis; stats: { mean: number; spread: number } } | null) {
  if (!summary) {
    // 无可用预测（越界/全失败/未选模型）：必须清掉上一目标日的残留，否则新目标日标题下
    // 仍显示旧均价，createDraft() 还会把旧口径写进新草稿。basis 回落 illustrative
    // 契约 createPayload.basis 的缺省值就是它，表示"无真实预测支撑"，不谎报 captured。
    forecastBasis.value = 'illustrative'
    forecastStats.value = { mean: 0, spread: 0 }
    return
  }
  forecastBasis.value = summary.basis
  forecastStats.value = summary.stats
}

// 申报单
const list = ref<DeclarationOrder[]>([])
const current = ref<DeclarationOrder | null>(null)
const busy = ref(false)
const errorMsg = ref('')

const step = computed(() => (current.value ? stepOfStatus(current.value.status) : 0))
const statusLabel = computed(() => (current.value ? STATUS_LABEL[current.value.status] : '未创建'))
const canEditCurrentCurve = computed(() => !!current.value && ['DRAFT', 'RISK_CHECKED', 'REJECTED'].includes(current.value.status))

function applyOptimizedCurve(point: OptimizeBidFrontierPoint) {
  decisionError.value = ''
  const result = optimizeResult.value
  if (!current.value) {
    decisionError.value = '请先创建申报草稿，再应用优化曲线'
    return
  }
  if (!result) {
    decisionError.value = '请先生成最优申报曲线'
    return
  }
  if (!canEditCurrentCurve.value) {
    decisionError.value = '当前申报单状态不可修改曲线'
    return
  }
  const energyCurveMwh96 = curveMwToEnergy96(point.bid_curve_mw)
  act(
    () => updateDeclarationCurve(current.value!.id, {
      energyCurveMwh96,
      basis: result.forecast.basis,
      strategySource: `optimize-bid:${point.risk_level};solver=${result.optimize_bid.solver};source=${result.source_type};mock=${result.mock ? 'true' : 'false'}`
    }),
    (declaration) => {
      current.value = declaration
      selectedLambda.value = point.lambda
      syncHourlyFromDeclaration()
      void nextTick(renderDeclChart)
    }
  )
}

// 创建表单
const capacityMw = ref(50)
/**
 * 报价依据摘要（契约 v3 起必填）。监管质询时它是自证报价形成过程的唯一材料，
 * 「无法解释的报价 = 高风险报价」，所以在建单这一步就要求写，而不是事后补。
 */
const quoteRationale = ref('')
const quoteRationaleValid = computed(() => quoteRationale.value.trim().length >= 8)
const riskPreference = ref<'conservative' | 'balanced' | 'aggressive'>('balanced')
const riskNote = computed(
  () => `风险偏好 ${{ conservative: '保守（严控偏差考核）', balanced: '均衡', aggressive: '积极（接受更高敞口）' }[riskPreference.value]}`
)

// 申报决策包：retailer 走采购成本建议；/optimize-bid 仅在 generator 出力预测场景开放
// 本页固定售电主体。曾试过加「主体类型」选择器让「一键生成最优申报曲线」可用，实测后撤回
// 那条路要动的是主体隔离，不是一个下拉框：
// ① 申报契约用大写 GENERATOR/RETAILER，而 cockpit 参数是小写；`server/spot-declarations-api.mjs`
// 的 `fetchExposureFromHarness`(:155) 与 `evaluateRiskChecks`(:629) 都按 `['GENERATOR','STORAGE']`
// 精确大写判卖出侧，小写值会让发电单按购入敞口取数与校验，风控结论与审批档位一起污染；
// ② 建单端点 `:562` 用请求体 `subjectType` 覆盖会话主体且不校验授权，前端一开放，
// 售电角色就能建出 GENERATOR 单（反向亦然），属主体隔离回归，必须服务端先兜住。
// 故本页维持售电口径；下方 optimizeUnavailableReason 会在生成决策包之前就说明该功能
// 仅对发电侧开放，而不是让按钮静默地点不动。开放发电侧另议（需服务端主体授权校验）。
const declarationSubjectType = 'retailer' as const
// 决策模型不再硬编码：由对比表的「设为决策模型」指定，占位模型被组件侧阻断。
// 初值仍给 xgboost（core tier 真实模型），对比组件挂载后会按实际可用模型纠正。
// 空串 = 本批没有可作决策依据的模型（对比组件回吐），此时决策包不可生成。
const decisionModel = ref('xgboost')
// 本批预测是否已跑完并验真。首次挂载与切目标日/地区后的运行期间，decisionModel 还是初始或
// 上一批的值，此时若允许生成，用户会拿到基于「最终会被判为合成/门禁失败」的模型算出的
// 申报建议。故未就绪一律禁用生成。
const forecastBatchReady = ref(false)
// 新一批预测开始（就绪→未就绪）时必须清掉已生成的决策包：竞价空间/申报建议/偏差风险都是
// 按上一批曲线算的，而「重跑」或增选模型并不会改变 decisionModel，不会触发 update 事件，
// 于是旧决策包会一直与新曲线、新均价并列展示，同一屏上混着两批口径，用户无从分辨。
function onForecastBatchReady(ready: boolean) {
  if (!ready && forecastBatchReady.value) resetDecisionPackage()
  forecastBatchReady.value = ready
}
const cockpit = ref<CockpitResult | null>(null)
const cockpitLoading = ref(false)
const optimizeResult = ref<OptimizeBidResult | null>(null)
const optimizeLoading = ref(false)
const selectedLambda = ref<number | null>(null)
const decisionError = ref('')
const supportsOptimizeBid = computed(
  () => cockpit.value?.bid_advice.subject_type === 'generator' && !!cockpit.value.bid_advice.generator
)
const optimizeUnavailableReason = computed(() => {
  // 未生成决策包时原先返回空串，于是「一键生成最优申报曲线」既点不动、也不说为什么，
  // 成了一个纯粹的死按钮（用户实机反馈的正是这一点）。本页固定售电口径，这条限制在
  // 决策包生成之前就已成立，应当先讲清楚。
  if (declarationSubjectType === 'retailer') {
    return '本页为售电主体口径：走采购成本建议；利润-CVaR 最优申报曲线仅对发电侧出力预测开放'
  }
  if (!cockpit.value) return '请先生成申报决策包'
  if (!supportsOptimizeBid.value) return '当前决策包非发电侧出力预测，无法生成利润-CVaR 申报曲线'
  if (!cockpit.value.price_forecast.points.length) return '请先生成申报决策包'
  return ''
})
const canOptimizeDraftCurve = computed(
  () => supportsOptimizeBid.value && !!cockpit.value?.price_forecast.points?.length && !cockpitLoading.value
)

function resetOptimizationResult() {
  optimizeResult.value = null
  selectedLambda.value = null
}

/** 决策包响应是否仍对应当前上下文（日期 + 地区 + 模型三者全等才收下）。 */
function isDecisionRequestCurrent(date: string, region: string, model: string): boolean {
  return date === targetDate.value && region === currentRegion.value.id && model === decisionModel.value
}

// 加载锁必须由请求世代而非上下文相等性解除。上下文相等性只能决定"结果收不收"，
// 不能决定"锁解不解"：决策包是按钮触发的，切了目标日/地区/模型之后未必会有新请求接手，
// 那样 cockpitLoading 就永久为 true，生成按钮一直禁用，用户只能刷新页面。
let cockpitRequest = 0

function resetDecisionPackage() {
  cockpit.value = null
  resetOptimizationResult()
  decisionError.value = ''
  // 作废在途请求并立即解锁：切模型/切日期时旧请求的结果不再需要，按钮也应马上可用
  cockpitRequest += 1
  cockpitLoading.value = false
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
function fmt0(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'
}
function fmt1(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'
}
function riskLevelLabel(level: OptimizeBidFrontierPoint['risk_level']): string {
  return { aggressive: '激进', neutral: '均衡', conservative: '保守' }[level]
}

// 决策模型变更（对比表手动切换，或组件侧自动回退）必须作废已有决策包：竞价空间/申报建议/
// 偏差风险都是按某个模型算出来的，只换标签不清结果，表里写着 KNN、下面的建议却来自 XGBoost。
function onDecisionModelChange(modelId: string) {
  if (modelId === decisionModel.value) return
  decisionModel.value = modelId
  resetDecisionPackage()
}

async function loadDecisionPackage() {
  // 无决策模型（对比区全失败/全为合成兜底）时不得发请求：模型 id 为空会被后端当非法参数，
  // 更重要的是这种情况下本就没有可信预测可作报价依据。
  if (!forecastBatchReady.value) {
    decisionError.value = '价格预测仍在运行：请等本批模型跑完并验真后再生成决策包'
    return
  }
  if (!decisionModel.value) {
    decisionError.value = '本批没有可作决策依据的模型：请先在价格预测对比区选出结果口径可信的模型'
    return
  }
  const requestDate = targetDate.value
  const requestRegion = currentRegion.value.id
  // 模型也必须进响应校验：只校验日期+地区时，切模型发生在请求途中，旧模型的响应仍会被收下。
  const requestModel = decisionModel.value
  const requestId = ++cockpitRequest
  cockpitLoading.value = true
  decisionError.value = ''
  resetOptimizationResult()
  try {
    const result = await fetchCockpit({
      region_id: requestRegion,
      target: 'price',
      target_date: requestDate,
      model_type: decisionModel.value,
      train_days: 180,
      subject_type: declarationSubjectType
    })
    if (requestId !== cockpitRequest || !isDecisionRequestCurrent(requestDate, requestRegion, requestModel)) return
    cockpit.value = result
  } catch (error) {
    // 失败分支同样要校验：陈旧请求的报错会清掉刚拿到的有效结果并覆盖错误条
    if (requestId !== cockpitRequest || !isDecisionRequestCurrent(requestDate, requestRegion, requestModel)) return
    cockpit.value = null
    decisionError.value = error instanceof Error ? error.message : '申报决策包生成失败'
  } finally {
    // 只按世代判断：本次仍是最新请求就解锁；被更新的请求或 resetDecisionPackage 取代了，
    // 由接手方负责解锁，两条路径都保证锁最终会被解开。
    if (requestId === cockpitRequest) cockpitLoading.value = false
  }
}

async function optimizeDraftCurve() {
  if (!cockpit.value) {
    decisionError.value = '请先生成申报决策包，再生成最优申报曲线'
    return
  }
  if (!supportsOptimizeBid.value) {
    decisionError.value = '当前售电主体采用采购成本建议，暂不调用发电侧利润-CVaR 优化器'
    return
  }
  const priceForecastP50 = cockpit.value?.price_forecast.points
  if (!priceForecastP50?.length) {
    decisionError.value = '请先生成申报决策包，再生成最优申报曲线'
    return
  }
  const requestDate = targetDate.value
  const requestRegion = currentRegion.value.id
  optimizeLoading.value = true
  decisionError.value = ''
  try {
    const result = await fetchOptimizeBid({
      region_id: requestRegion,
      target: 'load',
      target_date: requestDate,
      model_type: decisionModel.value,
      train_days: 180,
      probabilistic: true,
      capacity_mw: current.value?.capacityMw ?? capacityMw.value,
      lambdas: [0, 1, 3],
      n_scenarios: 40,
      price_forecast_p50: priceForecastP50,
    })
    if (requestDate === targetDate.value && requestRegion === currentRegion.value.id) {
      optimizeResult.value = result
      selectedLambda.value = null
    }
  } catch (error) {
    decisionError.value = error instanceof Error ? error.message : '最优申报曲线生成失败'
  } finally {
    optimizeLoading.value = false
  }
}

function curveMwToEnergy96(curveMw: number[]): number[] {
  const mw96 = curveMw.length === 24
    ? curveMw.flatMap((mw) => Array.from({ length: 4 }, () => mw))
    : curveMw.slice(0, 96)
  const padded = Array.from({ length: 96 }, (_, index) => mw96[index] ?? mw96[mw96.length - 1] ?? 0)
  return padded.map((mw) => Math.round((Math.max(0, mw) / 4) * 10000) / 10000)
}

// 风控检查输入：当月中长期合约总电量（调 harness 敞口端点用）
const exposureTotalMwh = ref(20000)
const exposure = ref<ExposureResult | null>(null)
const exposureLoading = ref(false)
const exposureStatus = ref<'idle' | 'loading' | 'auto' | 'manual' | 'failed'>('idle')
// 失败原因原文。后端对「该地区/该月无此品类采集数据」返回的是 503 + 明确 detail
// （如「回放服务无该品类数据（sdpt_console，2026-07-01~2026-07-31）」），前端原先一律
// 显示「敞口端点暂不可用」，把数据缺失说成了服务故障，用户无从判断该等还是该换日期。
const exposureError = ref('')
const exposureTouched = ref(false)
const exposureSourceIsMock = computed(() => {
  const source = exposure.value?.source.toLowerCase() ?? ''
  return source.includes('mock') || source.includes('synthetic')
})
const exposureSourceText = computed(() => {
  if (!exposure.value) return ''
  const prefix = exposureSourceIsMock.value ? '模拟数据' : '数据来源'
  return exposure.value.warning
    ? `${prefix}：${exposure.value.source}，${exposure.value.warning}`
    : `${prefix}：${exposure.value.source}`
})
const regionPriceCap = computed(() => {
  const mech = getRegionSpotProfile(currentRegion.value.id).mechanism
  return Number.isFinite(mech.priceCap)
    ? { floor: mech.priceFloor, cap: mech.priceCap, source: `region-profile:${currentRegion.value.id}` }
    : undefined
})

function markExposureManual() {
  exposureTouched.value = true
  exposureStatus.value = 'manual'
}

async function refreshExposure(force = false) {
  const month = targetDate.value.slice(0, 7)
  if (!month) return
  exposureLoading.value = true
  exposureStatus.value = 'loading'
  try {
    if (force) exposureTouched.value = false
    const result = await fetchExposure({
      month,
      total_mwh: Math.max(1, Number(exposureTotalMwh.value) || 1),
      mode: 'peak_valley',
      expected_source: 'renewable'
    })
    exposure.value = result
    if (!exposureTouched.value) {
      exposureTotalMwh.value = Math.round(result.total_mwh * 100) / 100
      exposureStatus.value = 'auto'
    } else {
      exposureStatus.value = 'manual'
    }
  } catch (error) {
    exposureStatus.value = 'failed'
    exposureError.value = error instanceof Error ? error.message : ''
  } finally {
    exposureLoading.value = false
  }
}

// 审批表单
const approvalComment = ref('')

// 24 小时功率编辑器（每小时映射 4 个 15min 点；存储口径 MWh/点 = MW/4）
const hourlyMw = ref<number[]>(Array.from({ length: 24 }, () => 0))
const batch = ref({ from: 0, to: 23, mw: 30 })
const curveDirty = ref(false)

function syncHourlyFromDeclaration() {
  if (!current.value) return
  const energy = current.value.energyCurveMwh96
  hourlyMw.value = Array.from({ length: 24 }, (_, h) => {
    const quarters = energy.slice(h * 4, h * 4 + 4)
    const avgMwh = quarters.reduce((sum, v) => sum + v, 0) / Math.max(quarters.length, 1)
    return Math.round(avgMwh * 4 * 100) / 100
  })
  curveDirty.value = false
}

function applyBatch() {
  const from = Math.max(0, Math.min(23, Math.floor(batch.value.from)))
  const to = Math.max(from, Math.min(23, Math.floor(batch.value.to)))
  for (let h = from; h <= to; h++) hourlyMw.value[h] = batch.value.mw
  curveDirty.value = true
}

const totalMwh = computed(() => Math.round(hourlyMw.value.reduce((sum, mw) => sum + mw, 0) * 100) / 100)
const maxMw = computed(() => Math.max(...hourlyMw.value, 0))

// 审批可见性（UI 门，非安全边界）
// 权威判定恒在服务端（spot-declarations-api.mjs 的 APPROVE_ROLES + 自审禁止，越权一律 403）。
// 只负责不把「批准/驳回」按钮渲染给无权用户，此前模板仅判 status，导致交易员也看得到
// 审批按钮、点了才吃 403，既是越权观感也是无效操作。两处角色集合须与服务端保持同步。
const APPROVE_ROLES_UI = ['TRADE_LEAD', 'RISK', 'ADMIN', 'BOSS']
const ELEVATED_ROLES_UI = ['ADMIN', 'BOSS']
const currentUserName = computed(() => getCurrentUser().username)
const currentUserRole = computed(() => String(getCurrentUser().roleCode ?? ''))
const currentUserSubjectType = computed(() => String(getCurrentUser().subjectType ?? ''))
const isSelfDeclaration = computed(() => !!current.value && current.value.createdBy === currentUserName.value)
const canApproveCurrent = computed(() => {
  if (!current.value || current.value.status !== 'PENDING_APPROVAL') return false
  if (!APPROVE_ROLES_UI.includes(currentUserRole.value)) return false
  // 自审禁止的两类豁免与服务端同口径：ELEVATED 角色、演练单
  if (isSelfDeclaration.value && !ELEVATED_ROLES_UI.includes(currentUserRole.value) && !isRehearsal.value) return false
  return true
})
// 待审批但本人不能批时，给出原因而非静默隐藏（否则用户不知道单卡在哪）
const approvalBlockedReason = computed(() => {
  if (!current.value || current.value.status !== 'PENDING_APPROVAL' || canApproveCurrent.value) return ''
  if (!APPROVE_ROLES_UI.includes(currentUserRole.value)) {
    return `当前角色 ${currentUserRole.value || '未知'} 无审批权限，请由交易负责人或风控在审批队列处理`
  }
  return '创建人不得审批本人申报单，请由另一位审批人处理'
})

const declChartEl = ref<HTMLElement | null>(null)
const declChart = useEChart(declChartEl, { render: renderDeclChart })
function renderDeclChart() {
  if (!declChartEl.value) return
  // 极值标注（清单 D1）：最高/最低功率直接标在柱上；工具栏沉底右下，容量 markLine 保持不变
  const mwMark = (color: string) => ({
    symbol: 'circle', symbolSize: 6,
    itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 },
    label: { show: true, position: 'top', fontSize: 10, color, formatter: (p: { value: unknown }) => `${p.value}` },
    data: [{ type: 'max' }, { type: 'min' }]
  })
  declChart.setOption({
    tooltip: axisTooltip({ unit: 'MW', pointer: 'shadow' }),
    legend: { show: false },
    toolbox: bottomToolbox('申报功率曲线', 8),
    grid: { left: 44, right: 14, top: 24, bottom: 36 },
    xAxis: { type: 'category', data: hourlyMw.value.map((_, h) => `${h}:00`) },
    yAxis: { type: 'value', name: 'MW' },
    series: [{
      name: '申报功率',
      type: 'bar',
      data: hourlyMw.value,
      itemStyle: { color: '#0ea5e9' },
      markPoint: mwMark('#0369a1'),
      markLine: current.value
        ? { silent: true, symbol: 'none', data: [{ yAxis: current.value.capacityMw, name: '可用容量' }], lineStyle: { color: '#ef4444' }, label: { formatter: '容量 {c} MW' } }
        : undefined
    }]
  })
}

// ── 96 点明细与导出（清单 D1）：明细数值与底稿同源 ──
// 编辑中（脏）以编辑器实时值为准并注明；否则读已保存的申报单曲线。
// 存储口径：96 点为 MWh/15min，功率 MW = MWh×4；24 点编辑器每小时 4 点恒等。
const detail96 = computed(() => {
  if (!current.value) return [] as { label: string; mw: string; mwh: string }[]
  const saved = current.value.energyCurveMwh96
  const editing = ['DRAFT', 'RISK_CHECKED', 'REJECTED'].includes(current.value.status)
  return Array.from({ length: 96 }, (_, i) => {
    const h = Math.floor(i / 4)
    const mw = editing
      ? Math.round((hourlyMw.value[h] ?? 0) * 100) / 100
      : Math.round((saved[i] ?? 0) * 4 * 100) / 100
    const mwh = editing ? Math.round((mw / 4) * 10000) / 10000 : Math.round((saved[i] ?? 0) * 10000) / 10000
    return {
      label: `${String(h).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      mw: mw.toFixed(2),
      mwh: mwh.toFixed(4)
    }
  })
})

function exportCurveCsv() {
  if (!current.value || !detail96.value.length) return
  const header = '时点,功率(MW),电量(MWh)'
  const body = detail96.value.map((r) => `${r.label},${r.mw},${r.mwh}`).join('\n')
  const csv = `\uFEFF${header}\n${body}\n合计(96点),,${totalMwh.value}\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `申报曲线-${current.value.targetDate}-${current.value.id}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 刷新世代守卫：切目标日会触发 watcher 的无 selectId 刷新，用户点历史行又会带 id 刷新，
// 两个异步完成顺序不定，前者后返回就会用 list[0] 覆盖用户刚选中的历史单。
// 世代号让过期刷新自行丢弃；pendingSelectId 让「切日期 + 选中某单」只走一次刷新。
let refreshGeneration = 0
// 初值取路由 query：审批队列「去申报台」会带 declarationId，
// 否则同一目标日多张单时申报台只会打开 list[0]（用户点的历史单被换成另一张）。
const pendingSelectId = ref<string | null>(
  typeof route.query.declarationId === 'string' && route.query.declarationId ? route.query.declarationId : null
)

async function refresh(selectId?: string) {
  const generation = ++refreshGeneration
  const wantedId = selectId ?? pendingSelectId.value ?? undefined
  pendingSelectId.value = null
  errorMsg.value = ''
  try {
    const nextMeta = await fetchDeclarationMeta(targetDate.value)
    const nextList = await listDeclarations({ date: targetDate.value })
    if (generation !== refreshGeneration) return // 已被更新的刷新取代，丢弃过期结果
    meta.value = nextMeta
    list.value = nextList
    let target = wantedId ? list.value.find((d) => d.id === wantedId) : list.value[0]
    // 该日申报单超过服务端默认分页上限时，待选单可能不在首页 rows 里
    // 此时直接取单资源接口，而不是 find 落空后把 current 置空（用户点了却打不开）。
    if (wantedId && !target) {
      const fetched = await getDeclaration(wantedId).catch(() => undefined)
      if (generation !== refreshGeneration) return
      // 必须校验目标日一致：query 里的 declarationId 会在用户改 targetDate 后残留，
      // 无条件采用会让页面标题/截止/历史窗显示新日期、而曲线与审批动作作用于旧单。
      target = fetched && fetched.targetDate === targetDate.value ? fetched : undefined
    }
    current.value = target ?? null
    // current 落定后再定草稿模式（见 syncDraftModeToTargetDate 注释）
    syncDraftModeToTargetDate()
    if (current.value) syncHourlyFromDeclaration()
    await nextTick()
    renderDeclChart()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error)
  }
  void loadHistoryList()
}

// 历史申报单
// 独立于 list（后者被 targetDate 精确过滤且驱动 current），避免污染 current 选取逻辑。
// 申报台此前只按精确目标日查询，默认目标日是明天 → 几乎必然 0 条，历史单全不可见。
const historyLoading = ref(false)
const historyRows = ref<DeclarationOrder[]>([])
const historyCounts = ref<Record<DeclarationMode, number>>({ LIVE: 0, REHEARSAL: 0 })
const historyModeFilter = ref<'' | DeclarationMode>('')
const HISTORY_WINDOW_DAYS = 60
// 窗口不对称是设计口径（docs/features/declaration-rehearsal-mode.md「±60/7 天」）：
const HISTORY_FORWARD_DAYS = 7
// 服务端 list 上限 500。本区是申报台内的辅助视图（看全量走审批队列的「全部申报单」），
// 故单次取到上限而非遍历分页，但必须显式提示截断，否则 counts 显示完整数量、
// 表格只有前 N 行，读起来像「这就是全部」。
const HISTORY_PAGE_LIMIT = 500
const historyTotal = ref(0)

// 世代守卫（与 refresh 同构）：切目标日或模式筛选会并发多次 loadHistoryList，
// 旧请求晚归会覆盖 rows/counts/total，造成表头是当前日期/模式、表体来自上一个时间窗。
let historyGeneration = 0

async function loadHistoryList() {
  const generation = ++historyGeneration
  historyLoading.value = true
  try {
    const anchor = new Date(`${targetDate.value}T00:00:00+08:00`).getTime()
    const page = await listDeclarationsPage({
      dateFrom: fmtDate(new Date(anchor - HISTORY_WINDOW_DAYS * 86400000)),
      dateTo: fmtDate(new Date(anchor + HISTORY_FORWARD_DAYS * 86400000)),
      mode: historyModeFilter.value || undefined,
      limit: HISTORY_PAGE_LIMIT
    })
    if (generation !== historyGeneration) return // 过期响应丢弃
    historyRows.value = page.rows
    historyCounts.value = page.counts
    historyTotal.value = page.total
  } catch {
    if (generation !== historyGeneration) return
    // 历史列表是辅助信息，失败不打断主动线（错误条留给申报单主流程）
    historyRows.value = []
    historyTotal.value = 0
  } finally {
    // 只有最新一次请求才可解除 loading，否则旧请求收尾会让转圈提前消失
    if (generation === historyGeneration) historyLoading.value = false
  }
}

const historyTruncated = computed(() => historyTotal.value > historyRows.value.length)

// 导出当日申报明细（清单 D2 + 验收反馈二轮：对齐参考系统出清结算单的单日期长表格式）
// 导出日期独立可选（默认跟随目标日），按所选日期精确取当天申报单，不受列表窗口限制；
// 行 = 96 时点 × 当天每张申报单，列 = 目标日/时点/申报单/模式/状态/申报电量(MWh)。
const curvePointLabel = (i: number) => {
  const h = Math.floor((i + 1) / 4)
  const m = ((i + 1) % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const exportDate = ref(targetDate.value)
watch(targetDate, (d) => { exportDate.value = d })
const exportBusy = ref(false)
function exportHistoryCsv() {
  if (exportBusy.value || !exportDate.value) return
  exportBusy.value = true
  void (async () => {
    try {
      const dayRows = await listDeclarations({ date: exportDate.value })
      if (!dayRows.length) {
        ElMessage.warning(`${exportDate.value} 当天没有申报单`)
        return
      }
      const escape = (v: unknown) => {
        const s = String(v ?? '').replaceAll('"', '""')
        return /[",\n]/.test(s) ? `"${s}"` : s
      }
      const header = '目标日,时点,申报单,模式,状态,申报电量(MWh)'
      const body: string[] = []
      for (const row of dayRows) {
        const base = [exportDate.value, row.id, DECLARATION_MODE_LABEL[declarationModeOf(row)], STATUS_LABEL[row.status]].map(escape)
        for (let i = 0; i < 96; i++) {
          const mwh = Math.round((row.energyCurveMwh96[i] ?? 0) * 10000) / 10000
          body.push([base[0], curvePointLabel(i), base[1], base[2], base[3], mwh].join(','))
        }
      }
      const csv = `\uFEFF${header}\n${body.join('\n')}\n`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `申报单明细-${exportDate.value}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '导出失败')
    } finally {
      exportBusy.value = false
    }
  })()
}

watch(historyModeFilter, () => { void loadHistoryList() })

// 复制历史曲线（declaration-workflow §2 快捷操作）：把时间窗内历史申报单的 96 点曲线
// 带入当前草稿编辑器为底稿。只落到 hourlyMw 并置 curveDirty，仍需「保存曲线」→ 重新
// 风控——与手工编辑同一条保存纪律，不做绕过风控的直达写回。
const copySourceId = ref('')
const copyableHistory = computed(() => historyRows.value.filter((r) => r.id !== current.value?.id))
function applyCopyHistory() {
  if (!canEditCurrentCurve.value) return
  const src = historyRows.value.find((r) => r.id === copySourceId.value)
  if (!src) return
  const energy = src.energyCurveMwh96
  hourlyMw.value = Array.from({ length: 24 }, (_, h) => {
    const quarters = energy.slice(h * 4, h * 4 + 4)
    const avgMwh = quarters.reduce((sum, v) => sum + v, 0) / Math.max(quarters.length, 1)
    return Math.round(avgMwh * 4 * 100) / 100
  })
  curveDirty.value = true
}

// 点击历史行：切目标日并选中该单。
// 跨目标日时只置 pendingSelectId 并改 targetDate，由 watcher 那一次刷新消费待选 id，
// 不再自己额外发一次 refresh，避免两次并发刷新互相覆盖（世代守卫是第二道防线）。
function openHistoryRow(row: DeclarationOrder) {
  // 历史列表与当前单动线现在是同一模块的两个互斥 tab：不切回去的话，点「查看」表面上
  // 毫无反应，曲线、状态与操作区都在另一个 tab 里，用户只会以为按钮坏了。
  declTab.value = 'current'
  if (row.targetDate !== targetDate.value) {
    pendingSelectId.value = row.id
    targetDate.value = row.targetDate
    return
  }
  void refresh(row.id)
}

async function act<T>(fn: () => Promise<T>, after?: (result: T) => void) {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const result = await fn()
    after?.(result)
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

// 终态单（已逾期 / 已出清 / 已驳回）无出边，页面上再没有任何可操作项。用户要「重新申报」时，
// 不回退原单状态，那等于让"过了 D-1 10:30 截止"这条真实市场约束变成可撤销的，账本上也
// 再看不出"这张单曾经逾期"。改为按同参数复制出一张 REHEARSAL 新单：原单保持终态，新单立刻
// 可编辑、可走完整流程做回测。
// note 里写清被模拟的日期与发起模拟的时间，两者缺一不可：只有目标日会让人分不清
// 这是当年报的还是今天补跑的回测。
// 申报单模块的两个 tab：当前单动线 / 历史单列表。历史单原本是页面底部另一个通栏面板，
// 与申报单模块相隔一屏，看完历史再回来操作要来回滚。同框切页更贴合"同一件事的两个视角"。
const declTab = ref<'current' | 'history'>('current')

// 「无出边」必须从契约状态机派生，不能自己列一份：我手列的 EXPIRED/CLEARED/REJECTED
// 里，CLEARED 还能走 DEVIATION_TRACKING、REJECTED 还能回 DRAFT（页面甚至仍给它渲染曲线
// 编辑器），而真正无出边的 REVIEWED 反倒漏了，文案说「不可再修改」与页面操作自相矛盾。
// 复制的主体口径必须与当前会话一致。不设这道门的话：同公司历史列表里能看到别的主体类型
// 的终态单，复制时又（为避免矛盾记录而）不传 subjectType，服务端便按复制者的主体归类
// 原本的卖出侧曲线会被静默重新解释为售电侧申报，敞口与风控口径整个反转，而页面上
// 毫无提示。曲线可以复用，主体不能重新定义。
const copySubjectMismatch = computed(() => {
  const src = current.value?.subjectType
  if (!src) return '' // 存量单无主体字段，按会话主体归类不产生反转
  return src === currentUserSubjectType.value
    ? ''
    : `该单主体为 ${src}，与当前会话主体 ${currentUserSubjectType.value || '未知'} 不一致：`
      + '复制会把它的曲线按你的主体口径重新解释（卖出/购入侧反转），故不开放。请用该主体的会话操作。'
})
const canCopyAsRehearsal = computed(() => {
  const st = current.value?.status
  if (!st || (DECLARATION_TRANSITIONS[st]?.length ?? 0) !== 0) return false
  return !copySubjectMismatch.value
})

// 从 note 里取回「于 X 发起」，复制模拟单时写进去的发起时间。解析不出就不显示，
// 不拿 createdAt 之类的近似值顶替（那可能是服务端时间，与用户看到的"我什么时候点的"不是一回事）。
const rehearsalStartedAt = computed(() => parseRehearsalStartedAt(current.value?.note))

function copyAsRehearsal() {
  const src = current.value
  if (!src) return
  const startedAt = formatRehearsalStamp(Date.now())
  act(
    // 一次 POST 带齐：create 本就接受两条曲线与主体口径。分两步写的话
    // ① priceCurve96 会被建单默认成 null，"按同参数复制"的回测其实换了报价；
    // ② 第二步失败会在服务端留下一张按 60% 平铺电量的半成品草稿，重试还会再生成一张。
    () => createDeclaration({
      targetDate: src.targetDate,
      capacityMw: src.capacityMw,
      // 复制历史单时沿用原单摘要；原单缺失（契约 v3 之前建的）则标明本次为模拟复制
      quoteRationale: src.quoteRationale?.trim() || `历史模拟复制自 ${src.id}，沿用原单报价口径`,
      energyCurveMwh96: src.energyCurveMwh96?.length ? src.energyCurveMwh96 : undefined,
      priceCurve96: src.priceCurve96,
      strategySource: src.strategySource,
      // 不带 src.subjectType：历史列表只按公司+地区过滤，同公司里售电用户看得到发电单，
      // 原样提交就会造出「subjectId 是自己（售电）、subjectType 却是 GENERATOR」的矛盾单，
      // 风控随后按售出敞口算。模拟单归复制者自己，主体由服务端按会话身份填。
      // 服务端亦已加 subjectTypeAuthorized 前置校验，前端不传只是不去撞那道门。
      basis: src.basis,
      note: buildRehearsalNote({
        targetDate: src.targetDate,
        startedAt,
        sourceId: src.id,
        sourceStatusLabel: STATUS_LABEL[src.status],
      }),
      mode: 'REHEARSAL',
    }),
    (declaration) => {
      void refresh(declaration.id)
      void loadHistoryList()
    }
  )
}

function createDraft() {
  act(
    () => createDeclaration({
      targetDate: targetDate.value,
      capacityMw: capacityMw.value,
      quoteRationale: quoteRationale.value.trim(),
      basis: forecastBasis.value,
      note: riskNote.value,
      mode: draftMode.value
    }),
    (declaration) => {
      void refresh(declaration.id)
    }
  )
}

function saveCurve() {
  if (!current.value) return
  const energy = hourlyMw.value.flatMap((mw) => Array.from({ length: 4 }, () => Math.round((mw / 4) * 10000) / 10000))
  act(
    () => updateDeclarationCurve(current.value!.id, { energyCurveMwh96: energy }),
    (declaration) => {
      current.value = declaration
      syncHourlyFromDeclaration()
      void nextTick(renderDeclChart)
    }
  )
}

function runRisk() {
  if (!current.value) return
  act(
    () => runDeclarationRiskCheck(current.value!.id, { exposureTotalMwh: exposureTotalMwh.value, priceCap: regionPriceCap.value }),
    (declaration) => {
      current.value = declaration
    }
  )
}

function sendForApproval() {
  if (!current.value) return
  act(() => submitDeclarationForApproval(current.value!.id), (declaration) => { current.value = declaration })
}

function decide(decision: 'approve' | 'reject') {
  if (!current.value) return
  act(
    () => approveDeclaration(current.value!.id, decision, approvalComment.value || undefined),
    (declaration) => {
      current.value = declaration
      approvalComment.value = ''
    }
  )
}

async function doSubmit() {
  if (!current.value) return
  // Trust gate 硬阻塞：正式申报提交前，依赖数据 basis 必须 operational（real/captured）。
  // advisory_only（合成/示意/未知）时禁止作为正式申报依据，本页为 MOCK 演示网关
  // （回执标注「非真实申报」），故阻断后仅允许「演示模式」显式继续，杜绝沉默误用。
  const basis = current.value.basis
  try {
    assertOperational(basis, '正式申报提交')
  } catch {
    let proceed = false
    try {
      await ElMessageBox.confirm(
        `当前申报依赖数据为「${DATA_BASIS_LABEL[basis]}」（basis=${basis}），属仅决策支持口径，禁止作为正式申报依据提交。本页为 MOCK 演示网关（回执标注非真实申报），如仅用于演示可继续。`,
        '⚠ 数据可信度不足 · 正式申报被阻断',
        { confirmButtonText: '仍要继续（演示模式）', cancelButtonText: '取消提交', type: 'warning' }
      )
      proceed = true
    } catch {
      proceed = false // 用户取消 → 不提交
    }
    if (!proceed) return
  }
  act(
    () => submitDeclaration(current.value!.id, `${current.value!.id}-submit`),
    (declaration) => { current.value = declaration }
  )
}

function clearMark() {
  if (!current.value) return
  act(() => markDeclarationCleared(current.value!.id), (declaration) => { current.value = declaration })
}

function goReview() {
  router.push({ path: '/xhjy/review', query: { date: targetDate.value, declarationId: current.value?.id ?? '' } })
}

// 智能体协助起草（可选）：面板 done 后刷新列表（finalize 落库的 DRAFT 即时可见）
const constraints = computed(
  () => `可用容量 ${capacityMw.value} MW；${riskNote.value}${current.value ? `；申报单 ${current.value.id}` : ''}`
)
function startDraftAssist() {
  if (harness.value !== 'online') return
  agentMode.value = 'draft'
  // 必须先清待恢复会话：AgentChatPanel 的挂载优先级是 resumeSessionId → ?q= → localStorage，
  // 不清的话重挂后会走回放分支、跳过 initialQuestion，按钮点了只是回放上次对话，
  // 不会为当前目标日启动新的 declaration_prep 流程。
  sessionIdByMode.draft = null
  draftRunQuestion.value = targetDate.value
  draftRunKey.value += 1
}

function onPrepDone(status = 'completed') {
  if (activeIntelLabel.value) finishIntel(status)
  // 智能体图收尾（finalize 已 best-effort 落库申报单）→ 刷新列表接管状态机动线
  void refresh()
}

// 图表容器自适应与主题切换重建均由 useEChart 内置的 ResizeObserver / 主题监听接管
onMounted(() => {
  void refresh()
  void refreshExposure()
  void checkHarness()
  ticker = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})
watch(targetDate, () => {
  resetDecisionPackage()
  void refresh()
  exposureTouched.value = false
  void refreshExposure()
})
watch(hourlyMw, () => {
  curveDirty.value = true
  void nextTick(renderDeclChart)
}, { deep: true })
// keep-alive：切走暂停 1s 倒计时 ticker 与后台探活重试，切回先校准再恢复
onActivated(() => {
  window.clearInterval(ticker)
  nowTick.value = Date.now()
  ticker = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
  // 离线期间后端可能已被拉起（或从重训高峰空闲下来），切回立即静默重探
  if (harness.value === 'offline') void checkHarness({ silent: true })
})
onDeactivated(() => {
  window.clearInterval(ticker)
  // 作废在途探活结果并停掉退避重试（与 ticker 同一纪律），切回由 onActivated 拉起
  harnessProbeGeneration += 1
  window.clearTimeout(harnessRetryTimer)
})
onBeforeUnmount(() => {
  window.clearInterval(ticker)
  harnessProbeGeneration += 1
  window.clearTimeout(harnessRetryTimer)
})
onRegionChange(() => {
  resetDecisionPackage()
  void refresh()
  exposureTouched.value = false
  void refreshExposure()
})
</script>

<template>
  <div class="decl-desk page-stack">
    <RegionDataBanner />
    <!-- 步骤条 + 截止倒计时 -->
    <section class="panel steps-bar">
      <div v-for="(s, i) in STEPS" :key="s" class="step" :class="{ active: i === step, done: i < step }">
        <span class="step-no">
          <CheckCircle2 v-if="i < step" :size="15" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="step-label">{{ s }}</span>
        <span v-if="i < STEPS.length - 1" class="step-line" />
      </div>
      <div class="bar-right">
        <span v-if="isRehearsal" class="rehearsal-chip lg" title="历史模拟演练单：不受申报截止约束，回执为本地 Mock 网关，非真实申报">
          <FlaskConical :size="13" /> 历史模拟 · 非真实申报
        </span>
        <span
          v-else
          class="deadline-chip"
          :class="{ danger: isExpiredWindow, warn: !isExpiredWindow && msRemaining !== null && msRemaining < 3600000 }"
        >
          <AlarmClock :size="13" /> D-1 10:30 截止 · {{ countdownText }}
        </span>
        <span class="target-date">
          目标日
          <input v-model="targetDate" type="date" />
        </span>
      </div>
    </section>

    <!-- 智能体服务状态：避免面板里裸抛 502；手动申报流程不受影响。
         timeout（服务在但探活超时，如同步重训占住后端）与 unreachable（多半真没起）分流
         文案；offline 后每 5/10/15s 静默重探，后端恢复后横幅自愈，无需刷新。 -->
    <section v-if="harness !== 'online'" class="panel harness-banner" :class="harness">
      <PlugZap :size="15" />
      <template v-if="harness === 'checking'">正在连接智能体服务…</template>
      <template v-else-if="harnessFailReason === 'timeout'">
        <span>
          <b>智能体服务响应超时</b> — 服务可达但探活 2.5 秒内未应答，可能正在训练价格预测模型，
          稍后将自动重试；手动申报流程不受影响。
        </span>
        <button class="retry-btn" @click="retryHarness">立即重试</button>
      </template>
      <template v-else>
        <span>
          <b>智能体服务未连接</b> — 情报问答与协助起草依赖 agent 后端（端口 8000），
          手动申报流程不受影响。需要时执行 <code>npm run install:agent-api</code>（首次）和
          <code>npm run dev:agent-api</code>，服务拉起后本提示会自动消失。
        </span>
        <button class="retry-btn" @click="retryHarness">重试连接</button>
      </template>
    </section>

    <p v-if="errorMsg" class="error-strip">{{ errorMsg }}</p>

    <div class="desk-grid">
      <!-- 左：情报区 -->
      <section class="panel intel">
        <div class="panel-head">
          <h2><LineChart :size="15" /> {{ targetDate }} 价格预测</h2>
          <div class="stat-chips">
            <span>均价 <b>{{ forecastStats.mean }}</b></span>
            <span>价差 <b>{{ forecastStats.spread }}</b></span>
          </div>
        </div>
        <CapabilitySupportBadge path="/xhjy/desk" class="forecast-support" />
        <DeclarationForecastCompare
          :decision-model="decisionModel"
          @update:decision-model="onDecisionModelChange"
          :target-date="targetDate"
          @summary="onForecastSummary"
          @batch-ready="onForecastBatchReady"
          @suggest-date="(d: string) => (targetDate = d)"
          @suggest-rehearsal="draftMode = 'REHEARSAL'"
        />

        <div class="decision-pack">
          <div class="decision-head">
            <div class="decision-title"><Sparkles :size="14" /> 申报决策包</div>
            <DataBasisBadge v-if="cockpit" :basis="cockpit.basis" />
            <button
              class="mini"
              :disabled="cockpitLoading || !decisionModel || !forecastBatchReady"
              :title="!forecastBatchReady ? '价格预测仍在运行，等本批跑完并验真后再生成'
                : decisionModel ? '' : '本批没有可作决策依据的模型（全部失败、或结果口径为合成兜底），请先在上方选出可用模型'"
              @click="loadDecisionPackage"
            >
              <Loader2 v-if="cockpitLoading" :size="13" class="spin" />
              <span>{{ cockpit ? '刷新' : '生成' }}</span>
            </button>
          </div>
          <p v-if="decisionError" class="decision-error">{{ decisionError }}</p>
          <div v-if="cockpit" class="decision-cards">
            <div class="decision-metric">
              <span class="metric-label">竞价空间</span>
              <b>{{ fmt0(avg(cockpit.price_forecast.points)) }}</b>
              <small>元/MWh · 带宽 {{ fmt0(avg(cockpit.price_forecast.upper) - avg(cockpit.price_forecast.lower)) }}</small>
            </div>
            <div class="decision-metric">
              <span class="metric-label">申报建议</span>
              <b v-if="cockpit.bid_advice.retailer">{{ fmt0(cockpit.bid_advice.retailer.expected_cost_yuan) }}</b>
              <b v-else-if="cockpit.bid_advice.storage">{{ fmt0(cockpit.bid_advice.storage.expected_profit_yuan) }}</b>
              <b v-else-if="cockpit.bid_advice.generator">{{ fmt1(cockpit.bid_advice.generator.total_declared_mwh) }}</b>
              <b v-else>—</b>
              <small v-if="cockpit.bid_advice.retailer">预期采购成本</small>
              <small v-else-if="cockpit.bid_advice.storage">预期套利收益</small>
              <small v-else-if="cockpit.bid_advice.generator">建议申报电量 MWh</small>
            </div>
            <div class="decision-metric risk">
              <span class="metric-label">偏差风险</span>
              <b>{{ fmt0(cockpit.deviation_risk.worst_penalty_yuan) }}</b>
              <small>最坏考核 · {{ cockpit.deviation_risk.high_risk_slots }} 个高风险点</small>
            </div>
          </div>
          <button class="check-item optimize-entry" :disabled="optimizeLoading || !canOptimizeDraftCurve" @click="optimizeDraftCurve">
            <span><Sparkles :size="13" /> 一键生成最优申报曲线</span>
            <span class="optimize-state">
              <Loader2 v-if="optimizeLoading" :size="13" class="spin" />
              <ArrowRight v-else :size="13" />
            </span>
          </button>
          <p v-if="optimizeUnavailableReason" class="decision-note">{{ optimizeUnavailableReason }}</p>
          <div v-if="optimizeResult" class="frontier-list">
            <div class="frontier-head">
              <span>利润-CVaR 前沿</span>
              <DataBasisBadge :basis="optimizeResult.forecast.basis" />
            </div>
            <button
              v-for="point in optimizeResult.optimize_bid.frontier"
              :key="point.lambda"
              class="frontier-row"
              :class="{ selected: selectedLambda === point.lambda }"
              :disabled="busy || !canEditCurrentCurve"
              @click="applyOptimizedCurve(point)"
            >
              <span class="frontier-risk">{{ riskLevelLabel(point.risk_level) }} λ={{ point.lambda }}</span>
              <span>申报 {{ fmt1(point.total_declared_mwh) }} MWh</span>
              <span>利润 {{ fmt0(point.expected_profit_yuan) }} 元</span>
              <span>CVaR {{ fmt0(point.cvar_loss_yuan) }} 元</span>
            </button>
          </div>
        </div>

        <p class="checklist-moved muted">
          <FileSearch :size="13" />
          申报前情报清单与智能体协助起草已移至页面底部的「智能体工作区」，可与历史对话并排查看。
        </p>
      </section>

      <!-- 右：申报单工作流（当前单 / 历史单 两个 tab 同框） -->
      <section class="panel workflow">
        <div class="panel-head">
          <div class="decl-tabs">
            <button :class="{ on: declTab === 'current' }" @click="declTab = 'current'">
              <Stamp :size="14" /> 申报单
            </button>
            <button :class="{ on: declTab === 'history' }" @click="declTab = 'history'">
              <History :size="14" /> 历史申报单
              <span v-if="historyTotal" class="tab-count">{{ historyTotal }}</span>
            </button>
          </div>
          <span v-if="isRehearsal" class="rehearsal-chip">历史模拟</span>
          <span class="status-chip" :data-status="current?.status ?? 'NONE'">{{ statusLabel }}</span>
          <span v-if="current" class="muted mono">{{ current.id }}</span>
          <select v-if="list.length > 1" class="decl-select" :value="current?.id" @change="refresh(($event.target as HTMLSelectElement).value)">
            <option v-for="d in list" :key="d.id" :value="d.id">{{ d.id }}（{{ STATUS_LABEL[d.status] }}）</option>
          </select>
        </div>

        <template v-if="declTab === 'current'">

        <!-- 历史模拟单：把「模拟的是哪天」和「什么时候发起的模拟」摆在最显眼处。
             只标目标日的话，分不清这是当年真报的还是今天补跑的回测。 -->
        <p v-if="current && isRehearsal" class="rehearsal-banner">
          <History :size="13" />
          <span>
            <b>历史模拟单</b> · 模拟目标日 <b>{{ current.targetDate }}</b>
            <template v-if="rehearsalStartedAt"> · 于 <b>{{ rehearsalStartedAt }}</b> 发起</template>
          </span>
          <span class="muted">本单不受申报截止约束，回执为本地 MOCK 网关，非真实申报</span>
        </p>

        <!-- 无申报单：创建草稿 -->
        <template v-if="!current">
          <label class="field">
            <span>可用容量（MW）</span>
            <input v-model.number="capacityMw" type="number" min="1" max="2000" />
          </label>
          <label class="field">
            <span>风险偏好</span>
            <select v-model="riskPreference">
              <option value="conservative">保守 — 严控偏差考核</option>
              <option value="balanced">均衡</option>
              <option value="aggressive">积极 — 接受更高敞口</option>
            </select>
          </label>
          <label class="field">
            <span>申报模式</span>
            <select v-model="draftMode">
              <option value="LIVE">真实申报 — 受 D-1 10:30 截止约束</option>
              <option value="REHEARSAL">历史模拟 — 不受截止约束，用于回测演练</option>
            </select>
          </label>
          <p v-if="draftMode === 'REHEARSAL'" class="rehearsal-hint">
            <FlaskConical :size="13" />
            <span>历史模拟单不受申报截止约束、可自批走完整流程，回执为本地 Mock 网关（<b>非真实申报</b>），在列表中与真实申报分开统计。模式创建后不可修改。</span>
          </p>
          <p v-else-if="isPastTargetDate || isLiveWindowClosed" class="rehearsal-hint warn">
            <AlarmClock :size="13" />
            <template v-if="isPastTargetDate">目标日 {{ targetDate }} 早于今日，真实申报窗口已关闭</template>
            <template v-else>目标日 {{ targetDate }} 的申报截止（D-1 10:30）已过，真实申报窗口已关闭</template>
            —— 建单后会立即被判定逾期作废。如需回测或演练请改用「历史模拟」模式。
          </p>
          <label class="rationale-field">
            <span>报价依据摘要 <b>必填</b></span>
            <textarea
              v-model="quoteRationale"
              rows="2"
              placeholder="写明本次报价的成本锚或机会成本锚，须可追溯到具体数值。例：中长期均价 232、现货 P50 预测 248，价差 16 元/MWh"
            />
            <small :class="{ warn: !quoteRationaleValid }">
              {{ quoteRationaleValid
                ? '监管质询时以此自证报价形成过程'
                : '至少 8 个字：无法解释的报价即高风险报价，事后补写等于自证材料失效' }}
            </small>
          </label>
          <p class="muted">创建后生成 96 点申报草稿（按容量 60% 平铺初始化），可手工编辑或交给智能体起草，再走风控检查 → 审批 → 截止前提交。</p>
          <button class="launch" :disabled="busy || !quoteRationaleValid" @click="createDraft">
            {{ draftMode === 'REHEARSAL' ? '创建历史模拟草稿' : '创建申报草稿' }}
          </button>
        </template>

        <!-- 有申报单：曲线 + 流程动作 -->
        <template v-else>
          <div ref="declChartEl" class="decl-chart chart-host" />
          <div class="curve-meta muted">
            申报总量 <b>{{ totalMwh }}</b> MWh · 最大功率 <b>{{ maxMw }}</b> MW / 容量 {{ current.capacityMw }} MW
            <DataBasisBadge :basis="current.basis" />
          </div>

          <!-- 96 点明细（清单 D1）：编辑中以编辑器实时值为准并注明；导出 CSV（UTF-8 BOM） -->
          <details class="detail96">
            <summary>
              96 点明细（{{ curveDirty ? '含未保存修改，以编辑器为准' : '当前保存曲线' }}）
            </summary>
            <div class="detail96-bar">
              <button class="mini" :disabled="!detail96.length" @click="exportCurveCsv">导出 CSV</button>
              <span class="muted">共 96 点（每 15 分钟）· 合计 {{ totalMwh }} MWh</span>
            </div>
            <div class="detail96-scroll">
              <table>
                <thead><tr><th>时点</th><th>功率 MW</th><th>电量 MWh</th></tr></thead>
                <tbody>
                  <tr v-for="r in detail96" :key="r.label">
                    <td>{{ r.label }}</td><td class="num">{{ r.mw }}</td><td class="num">{{ r.mwh }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>

          <!-- 曲线编辑（草稿/驳回可改）-->
          <template v-if="['DRAFT', 'RISK_CHECKED', 'REJECTED'].includes(current.status)">
            <div class="batch-row">
              <span class="muted">批量段设置</span>
              <input v-model.number="batch.from" type="number" min="0" max="23" title="起始时点" />
              <span>:00 ~</span>
              <input v-model.number="batch.to" type="number" min="0" max="23" title="结束时点" />
              <span>:00 =</span>
              <input v-model.number="batch.mw" type="number" min="0" :max="current.capacityMw * 2" title="功率 MW" />
              <span>MW</span>
              <button class="mini" @click="applyBatch">应用</button>
            </div>
            <!-- 复制历史曲线（declaration-workflow §2 快捷操作）：带入近 60 天窗口内历史单的
                 96 点曲线为底稿；只落编辑器并置脏，与手工编辑同一条「保存曲线→重新风控」纪律 -->
            <div v-if="copyableHistory.length" class="batch-row">
              <span class="muted">复制历史曲线</span>
              <select v-model="copySourceId" title="选择时间窗内的历史申报单，应用其 96 点曲线为底稿">
                <option value="">选择历史申报单…</option>
                <option v-for="r in copyableHistory" :key="r.id" :value="r.id">
                  {{ r.targetDate }} · {{ r.id }}（{{ STATUS_LABEL[r.status] }}）
                </option>
              </select>
              <button class="mini" :disabled="!copySourceId || busy" @click="applyCopyHistory">应用</button>
            </div>
            <p class="pending-note">「导入预测曲线」还没做：要先确认两件事——导入哪条预测曲线（价格还是负荷出力）、按什么规则换算成申报电量。已列入问题清单，确认后开发。</p>
            <div class="hour-grid">
              <label v-for="(_, h) in hourlyMw" :key="h">
                <span>{{ h }}</span>
                <input v-model.number="hourlyMw[h]" type="number" min="0" step="1" />
              </label>
            </div>
            <div class="action-row">
              <button class="mini primary" :disabled="busy || !curveDirty" @click="saveCurve">保存曲线</button>
              <span v-if="curveDirty" class="muted">曲线已修改，保存后需重新风控检查</span>
            </div>
          </template>

          <!-- 风控检查 -->
          <div class="risk-block">
            <div class="block-head"><ShieldCheck :size="14" /> 申报前风控检查
              <span v-if="current.riskCheck" class="gate-chip" :class="{ escalated: current.riskCheck.gateLevel === 'L3' }">审批档位 {{ current.riskCheck.gateLevel }}</span>
            </div>
            <template v-if="['DRAFT', 'RISK_CHECKED'].includes(current.status)">
              <div class="batch-row">
                <span class="muted">当月中长期合约总量</span>
                <input v-model.number="exposureTotalMwh" type="number" min="1" @input="markExposureManual" />
                <span>MWh</span>
                <button class="mini" :disabled="exposureLoading" @click="refreshExposure(true)">
                  <Loader2 v-if="exposureLoading" :size="13" class="spin" />
                  <span>刷新敞口</span>
                </button>
                <button class="mini primary" :disabled="busy" @click="runRisk">运行风控检查</button>
              </div>
              <p class="exposure-hint">
                <template v-if="exposureStatus === 'auto' && exposure">
                  已联动敞口端点：套保率 {{ Math.round(exposure.hedge_ratio * 100) }}%，现货卖出敞口 {{ fmt1(exposure.spot_sell_exposure_mwh) }} MWh。
                  <span class="exposure-source" :class="{ mock: exposureSourceIsMock }">{{ exposureSourceText }}</span>
                </template>
                <template v-else-if="exposureStatus === 'manual'">已手动覆盖，刷新敞口可重新拉取端点结果。</template>
                <template v-else-if="exposureStatus === 'failed'">
                  {{ exposureError || '敞口端点暂不可用' }}，保留当前手动值。
                </template>
              </p>
            </template>
            <ul v-if="current.riskCheck" class="check-list">
              <li v-for="c in current.riskCheck.checks" :key="c.checkId" :data-status="c.status">
                <b>{{ c.name }}</b> {{ c.status === 'PASS' ? '通过' : c.status === 'FAIL' ? '未通过' : '不可用' }} — {{ c.detail }}
              </li>
            </ul>
          </div>

          <!-- 送审 -->
          <div v-if="current.status === 'RISK_CHECKED'" class="action-row">
            <button class="launch slim" :disabled="busy" @click="sendForApproval">送审（进入审批队列）</button>
          </div>

          <!-- 审批表单：仅对有审批权且非创建人（演练单与 ADMIN/BOSS 豁免）渲染 -->
          <div v-if="canApproveCurrent" class="approval-block">
            <div class="block-head">
              <Stamp :size="14" /> 人工审批（创建人不可审批本人申报单）
              <span v-if="isRehearsal && isSelfDeclaration" class="rehearsal-chip">演练自批 · 将留痕</span>
            </div>
            <textarea v-model="approvalComment" rows="2" placeholder="审批意见（写入 approvalRecord 审计留痕）" />
            <div class="action-row">
              <button class="mini primary" :disabled="busy" @click="decide('approve')">
                {{ isRehearsal ? '批准（演练）' : '批准' }}
              </button>
              <button class="mini danger" :disabled="busy" @click="decide('reject')">驳回</button>
            </div>
          </div>
          <p v-else-if="approvalBlockedReason" class="muted approval-blocked">{{ approvalBlockedReason }}</p>

          <!-- 提交 -->
          <div v-if="current.status === 'APPROVED'" class="action-row">
            <button class="launch slim" :disabled="busy || isExpiredWindow" @click="doSubmit">
              {{ isExpiredWindow ? '已过申报截止，禁止提交' : '提交申报（幂等）' }}
            </button>
          </div>

          <!-- 回执 -->
          <div v-if="current.receipt" class="receipt-block">
            <div class="block-head"><CheckCircle2 :size="14" /> 提交回执 <TrustBadge :basis="current.basis" /></div>
            <p class="muted mono">
              {{ current.receipt.receiptId }} · {{ current.receipt.gateway }}
              <span class="mock-tag">
                MOCK 网关 · 非真实申报{{ current.receipt.mode === 'REHEARSAL' ? ' · 历史模拟演练' : '' }}
              </span>
            </p>
            <div v-if="current.status === 'ACKNOWLEDGED'" class="action-row">
              <button class="mini" :disabled="busy" @click="clearMark">出清结果已核对（标记已出清）</button>
            </div>
          </div>

          <!-- 审批记录 -->
          <div v-if="current.approvalRecord.length" class="audit-block">
            <div class="block-head">审批记录</div>
            <p v-for="r in current.approvalRecord" :key="r.at" class="muted">
              {{ r.at.slice(0, 19).replace('T', ' ') }} · {{ r.approver }}（{{ r.role }}）{{ r.decision === 'approve' ? '批准' : '驳回' }}
              {{ r.comment ? `：${r.comment}` : '' }}（{{ r.gateLevel }}）
            </p>
          </div>

          <!-- 出清跟踪 -->
          <div v-if="step >= 3 || current.status === 'CLEARED'" class="tracking-block">
            <div class="block-head"><CheckCircle2 :size="14" /> 出清跟踪</div>
            <p class="muted">出清结果发布后（约 17:00），以本申报单为基准对比出清价，估算偏差考核与实际收益。</p>
            <button class="card-action" @click="goReview">申报 vs 出清回测 <ArrowRight :size="13" /></button>
          </div>

          <!-- 终态单（逾期/已出清/已驳回）无出边：给一条「复制为历史模拟单」的出路，
               而不是让页面彻底没有可操作项。原单状态不动，账本上仍能看出它曾经逾期。 -->
          <div v-if="copySubjectMismatch" class="terminal-actions">
            <p class="muted"><AlarmClock :size="13" /> {{ copySubjectMismatch }}</p>
          </div>
          <div v-else-if="canCopyAsRehearsal" class="terminal-actions">
            <p class="muted">
              本单已是终态（{{ statusLabel }}），按市场规则不可再修改或提交。
              可按同参数复制一张<b>历史模拟单</b>做回测——原单保持不变。
            </p>
            <button class="launch slim" :disabled="busy" @click="copyAsRehearsal">
              <History :size="14" /> 复制为历史模拟单（模拟 {{ current!.targetDate }}）
            </button>
          </div>
        </template>
        </template>

        <!-- 历史申报单 tab：按目标日范围查询（此前只按精确目标日查，默认取明天 → 历史单全不可见） -->
        <template v-else>
          <p class="muted history-scope">
            <span>前{{ HISTORY_WINDOW_DAYS }}/后{{ HISTORY_FORWARD_DAYS }}天·真实{{ historyCounts.LIVE }}/模拟{{ historyCounts.REHEARSAL }}</span>
            <select v-model="historyModeFilter" class="decl-select" style="margin-left: auto">
          <option value="">全部模式</option>
          <option value="LIVE">仅真实申报</option>
              <option value="REHEARSAL">仅历史模拟</option>
            </select>
            <!-- 导出当日明细：日期独立可选（默认跟随目标日），单日期 96 点长表 -->
            <input v-model="exportDate" type="date" class="decl-select" title="导出哪一天的 96 点明细" />
            <button class="mini" :disabled="exportBusy || !exportDate" :title="`导出 ${exportDate} 当天的 96 点申报明细`" @click="exportHistoryCsv">
              导出 {{ exportDate.slice(5) }}
            </button>
          </p>
          <p v-if="historyLoading" class="muted">加载中…</p>
          <p v-else-if="!historyRows.length" class="muted">该时间窗内没有申报单。调整目标日或放宽筛选后重试。</p>
          <p v-else-if="historyTruncated" class="rehearsal-hint warn">
        <AlarmClock :size="13" />
        该时间窗内共 {{ historyTotal }} 张申报单，此处仅显示前 {{ historyRows.length }} 张。
        完整列表请到
        <button class="link-btn" @click="router.push({ path: '/xhjy/approvals' })">申报审批队列 · 全部申报单</button>
        查看。
          </p>
          <table v-if="!historyLoading && historyRows.length" class="history-table">
        <thead>
          <tr><th>申报单</th><th>目标日</th><th>模式</th><th>状态</th><th>总量</th><th>创建人</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="row in historyRows" :key="row.id" :class="{ active: row.id === current?.id }">
            <td class="mono">{{ row.id }}</td>
            <td>{{ row.targetDate }}</td>
            <td>
              <span class="mode-tag" :data-mode="declarationModeOf(row)">
                {{ DECLARATION_MODE_LABEL[declarationModeOf(row)] }}
              </span>
            </td>
            <td>{{ STATUS_LABEL[row.status] }}</td>
            <td class="num">{{ Math.round(row.energyCurveMwh96.reduce((s, v) => s + v, 0) * 10) / 10 }} MWh</td>
            <td>{{ row.createdBy }}</td>
            <td><button class="mini" @click="openHistoryRow(row)">查看</button></td>
          </tr>
        </tbody>
          </table>
        </template>
      </section>
    </div>


    <!-- 智能体工作区：历史侧栏 | 情报清单 | 对话（单框三栏，两个挂载点按模式互斥） -->
    <section class="panel agent-workspace">
      <aside class="aw-aside" :class="{ collapsed: sidebarCollapsed }">
        <AgentHistorySidebar
          ref="sidebarRef"
          :page-key="activePageKey"
          :active-session-id="activeSessionId"
          :collapsed="sidebarCollapsed"
          @select="onSelectHistory"
          @new-chat="onNewChat"
          @update:collapsed="sidebarCollapsed = $event"
        />
      </aside>

      <div class="aw-main">
        <header class="aw-head">
          <div class="aw-tabs">
            <button class="aw-tab" :class="{ active: agentMode === 'market' }" @click="switchAgentMode('market')">
              <Bot :size="13" /> 情报问询
            </button>
            <button class="aw-tab" :class="{ active: agentMode === 'draft' }" @click="switchAgentMode('draft')">
              <Sparkles :size="13" /> 协助起草
            </button>
          </div>
          <span v-if="isRehearsal" class="rehearsal-chip">历史模拟</span>
          <span class="muted aw-head-hint">目标日 {{ targetDate }}</span>
        </header>

        <div class="aw-body">
          <section class="aw-checklist">
            <div class="checklist-title">
              <FileSearch :size="14" />
              <span>申报前情报清单</span>
            </div>
            <p class="checklist-hint">智能体自动核查 · 约 30-60s</p>
            <button
              v-for="item in intelChecklist"
              :key="item.label"
              class="check-item"
              :class="{ done: item.status === 'done', running: item.status === 'running', failed: item.status === 'failed', disabled: intelDisabled(item) }"
              :disabled="intelDisabled(item)"
              :title="intelCapabilityOf(item).reason || item.desc"
              @click="runIntel(item)"
            >
              <span class="check-mark">
                <Loader2 v-if="item.status === 'running'" :size="14" class="spin" />
                <CheckCircle2 v-else-if="item.status === 'done'" :size="14" />
                <XCircle v-else-if="item.status === 'failed'" :size="14" />
                <span v-else class="check-circle" />
              </span>
              <span class="check-text">
                <span class="check-label">{{ item.label }}</span>
                <span class="check-desc">
                  <template v-if="intelCapabilityOf(item).status === 'unsupported'">{{ intelCapabilityOf(item).reason }}</template>
                  <template v-else-if="item.status === 'running'">智能体正在核查…</template>
                  <template v-else-if="item.status === 'failed'">核查未完成，可重试</template>
                  <template v-else>{{ item.desc }}</template>
                </span>
              </span>
            </button>

            <button class="check-item draft-entry" :class="{ disabled: harness !== 'online' }" :disabled="harness !== 'online'" @click="startDraftAssist">
              <span><Sparkles :size="13" /> 智能体协助起草（草稿自动落库）</span>
              <ArrowRight :size="13" />
            </button>
          </section>

          <div class="aw-chat">
            <AgentChatPanel
              v-if="agentMode === 'market'"
              :key="`market-${marketRunKey}`"
              ref="intelPanel"
              scenario="chat"
              :initial-question="marketRunQuestion"
              :resume-session-id="sessionIdByMode.market"
              :prompt-key="PAGE_PROMPT_KEYS.declarationMarket"
              history-key="declaration_market"
              @error="markIntelError"
              @done="finishIntel"
              @history-changed="onHistoryChanged"
              @session-ready="onMarketSessionReady"
            />
            <AgentChatPanel
              v-else
              :key="`draft-${draftRunKey}`"
              ref="prepPanel"
              scenario="declaration_prep"
              :initial-question="draftRunQuestion"
              :resume-session-id="sessionIdByMode.draft"
              :prompt-key="PAGE_PROMPT_KEYS.declarationDraft"
              history-key="declaration_draft"
              :payload="{ constraints, mode: currentMode }"
              @error="markIntelError"
              @done="onPrepDone"
              @history-changed="onHistoryChanged"
              @session-ready="onDraftSessionReady"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rationale-field { display: flex; flex-direction: column; gap: 3px; margin: 8px 0; font-size: var(--font-sm); }
.rationale-field b { color: #b91c1c; }
.rationale-field textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); font-family: inherit; }
.rationale-field small { font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.rationale-field small.warn { color: #b45309; }
.decl-desk { gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); line-height: 1.7; }
.mono { font-family: ui-monospace, monospace; font-size: var(--font-sm); }

/* 步骤条 */
.steps-bar { display: flex; align-items: center; gap: 4px; padding: 12px 16px; flex-wrap: wrap; }
.step { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; }
.step-no {
  width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
  display: grid; place-items: center; font-size: var(--font-sm); font-weight: 700;
  border: 1.5px solid var(--line); color: var(--muted);
}
.step.active .step-no { border-color: var(--primary); color: var(--primary); }
.step.done .step-no { border-color: var(--success); color: var(--success); }
.step-label { font-size: var(--font-md); white-space: nowrap; color: var(--muted); }
.step.active .step-label { color: var(--text); font-weight: 600; }
.step-line { flex: 1; height: 1px; background: var(--line); margin: 0 8px; }
.bar-right { display: flex; align-items: center; gap: 12px; }
.deadline-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; font-size: var(--font-sm); border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted);
}
.deadline-chip.warn { border-color: #f59e0b; color: #b45309; background: rgba(245, 158, 11, 0.1); }
.deadline-chip.danger { border-color: #ef4444; color: #b91c1c; background: rgba(239, 68, 68, 0.1); animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.6; } }

/* 历史模拟徽标：全链常驻，防止演练单被误当真实申报 */
.rehearsal-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; font-size: var(--font-11-5); border-radius: 999px;
  border: 1px solid #f59e0b; color: #b45309; background: rgba(245, 158, 11, 0.12);
  white-space: nowrap;
}
.rehearsal-chip.lg { padding: 4px 10px; font-size: var(--font-sm); }
.rehearsal-hint {
  display: flex; align-items: center; gap: 6px;
  margin: 8px 0 0; padding: 8px 10px; font-size: var(--font-12-5); line-height: 1.6;
  border-radius: 8px; border: 1px solid #f59e0b;
  color: #b45309; background: rgba(245, 158, 11, 0.08);
}
.rehearsal-hint.warn { border-color: #ef4444; color: #b91c1c; background: rgba(239, 68, 68, 0.08); }
.rehearsal-hint b { font-weight: 600; }
.approval-blocked { margin: 8px 0 0; font-size: var(--font-12-5); }
.link-btn {
  background: none; border: none; padding: 0; font: inherit; cursor: pointer;
  color: var(--primary); text-decoration: underline;
}

/* 历史申报单表（申报单模块的历史 tab） */
.history-table { width: 100%; border-collapse: collapse; font-size: var(--font-12-5); margin-top: 8px; }
.history-table th, .history-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--line-faint); }
.history-table th { color: var(--muted); font-weight: 500; }
.history-table tr.active td { background: rgba(14, 165, 233, 0.08); }
.history-table td.num { font-variant-numeric: tabular-nums; }
.mode-tag { padding: 1px 7px; border-radius: 999px; font-size: var(--font-11-5); border: 1px solid var(--line); color: var(--muted); }
.mode-tag[data-mode='REHEARSAL'] { border-color: #f59e0b; color: #b45309; background: rgba(245, 158, 11, 0.12); }

.target-date { display: flex; align-items: center; gap: 8px; font-size: var(--font-md); color: var(--muted); }
.target-date input {
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text);
}
/* 移动端：步骤条与截止信息纵排，避免横向挤压 */
@media (max-width: 768px) {
  .steps-bar { flex-direction: column; align-items: stretch; }
  .step-line { display: none; }
  .bar-right { flex-wrap: wrap; }
  /* 24时段价格表：6列→3列，避免每格仅约55px导致输入框溢出 */
  .hour-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* 智能体服务状态横幅 */
.harness-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; font-size: var(--font-12-5); line-height: 1.6;
}
.harness-banner.offline { border-color: #f59e0b; color: var(--text); }
.harness-banner.checking { color: var(--muted); }
.harness-banner code {
  background: rgba(125, 125, 125, 0.12); padding: 1px 6px;
  border-radius: 4px; font-size: var(--font-11-5);
}
.retry-btn {
  margin-left: auto; flex-shrink: 0; padding: 4px 14px; font-size: var(--font-12-5);
  border: 1px solid var(--primary); border-radius: 7px;
  background: transparent; color: var(--primary); cursor: pointer;
}
.retry-btn:hover { background: var(--primary); color: #fff; }

.error-strip {
  margin: 0; padding: 8px 12px; font-size: var(--font-12-5); border-radius: 8px;
  border: 1px solid #ef4444; color: #b91c1c; background: rgba(239, 68, 68, 0.08);
}

/* 主区 */
.desk-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 14px; }
@media (max-width: 1100px) { .desk-grid { grid-template-columns: 1fr; } }

.intel, .workflow { padding: 14px 16px; }
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.panel-head h2 { display: flex; align-items: center; gap: 6px; font-size: var(--font-lg); margin: 0; }
.stat-chips { margin-left: auto; display: flex; gap: 12px; font-size: var(--font-sm); color: var(--muted); }
.stat-chips b { color: var(--text); font-variant-numeric: tabular-nums; }
.forecast-chart { width: 100%; height: 240px; }
.decl-chart { width: 100%; height: 240px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.curve-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 8px; }
.curve-meta b { color: var(--text); }

/* 96 点明细折叠表（清单 D1）：滚动容器限高，数值等宽对齐 */
.detail96 { margin: 0 0 8px; border: 1px solid var(--line-faint); border-radius: 8px; padding: 6px 10px; }
.detail96 summary { cursor: pointer; font-size: var(--font-sm); color: var(--muted); user-select: none; }
.detail96-bar { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; }
.detail96-scroll { max-height: 220px; overflow-y: auto; }
.detail96-scroll table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); }
.detail96-scroll th, .detail96-scroll td { padding: 2px 8px; text-align: left; border-bottom: 1px solid var(--line-faint); }
.detail96-scroll th { color: var(--muted); font-weight: 500; position: sticky; top: 0; background: var(--panel, #fff); }
.detail96-scroll td.num { font-variant-numeric: tabular-nums; text-align: right; }

.status-chip {
  padding: 2px 10px; font-size: var(--font-sm); border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted);
}
.status-chip[data-status='PENDING_APPROVAL'] { border-color: #f59e0b; color: #b45309; }
.status-chip[data-status='APPROVED'], .status-chip[data-status='ACKNOWLEDGED'], .status-chip[data-status='CLEARED'] { border-color: var(--success); color: var(--success); }
.status-chip[data-status='REJECTED'], .status-chip[data-status='EXPIRED'] { border-color: #ef4444; color: #b91c1c; }
/* 申报单模块的两个 tab */
.decl-tabs { display: flex; gap: 4px; }
.decl-tabs button {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; font-size: var(--font-md);
  border: 1px solid transparent; border-radius: 6px 6px 0 0; background: transparent;
  color: var(--el-text-color-regular); cursor: pointer;
}
.decl-tabs button.on {
  border-color: var(--el-border-color); border-bottom-color: transparent;
  background: var(--el-fill-color-blank); color: var(--el-color-primary); font-weight: 600;
}
.tab-count {
  min-width: 16px; padding: 0 4px; font-size: var(--font-xs); line-height: 16px; text-align: center;
  border-radius: 8px; background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.history-scope { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 终态单出路 */
.rehearsal-banner {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px;
  padding: 6px 10px; font-size: var(--font-sm); border-radius: 6px;
  border: 1px solid var(--el-color-warning); background: rgba(245, 158, 11, 0.08);
  color: var(--el-text-color-regular);
}
.terminal-actions {
  margin-top: 10px; padding: 10px; border: 1px dashed var(--el-color-warning);
  border-radius: 6px; display: flex; flex-direction: column; gap: 6px;
}
.decl-select {
  margin-left: auto; padding: 4px 8px; font-size: var(--font-sm);
  border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--text);
}

/* 申报决策包 */
.decision-pack {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.decision-head, .frontier-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.decision-title, .frontier-head span:first-child {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--font-md); font-weight: 650;
}
.decision-head .mini { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; }
.decision-error {
  margin: 6px 0 0; padding: 6px 8px; font-size: var(--font-sm); line-height: 1.5;
  border: 1px solid #ef4444; border-radius: 8px;
  color: #b91c1c; background: rgba(239, 68, 68, 0.08);
}
.decision-cards {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px; margin-top: 8px;
}
.decision-metric {
  min-width: 0; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: 8px;
  background: rgba(125, 125, 125, 0.04);
}
.decision-metric.risk { border-color: rgba(239, 68, 68, 0.35); }
.metric-label, .decision-metric small {
  display: block; color: var(--muted); font-size: var(--font-xs); line-height: 1.5;
}
.decision-metric b {
  display: block; color: var(--text); font-size: var(--font-18); line-height: 1.45;
  font-variant-numeric: tabular-nums;
}
.optimize-entry { margin-top: 8px; }
.optimize-entry > span:first-child, .optimize-state {
  display: inline-flex; align-items: center; gap: 6px;
}
.decision-note {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: var(--font-11-5);
  line-height: 1.5;
}
.frontier-list {
  margin-top: 8px; display: flex; flex-direction: column; gap: 5px;
}
.frontier-row {
  display: grid; grid-template-columns: 0.9fr 1fr 1fr 1fr; gap: 6px;
  width: 100%; align-items: center;
  padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); cursor: pointer;
  font-size: var(--font-sm); text-align: left;
}
.frontier-row:hover:not(:disabled), .frontier-row.selected { border-color: var(--primary); }
.frontier-row:disabled { opacity: 0.55; cursor: not-allowed; }
.frontier-risk { font-weight: 650; }
@media (max-width: 640px) {
  .decision-cards { grid-template-columns: 1fr; }
  .frontier-row { grid-template-columns: 1fr; }
}

/* 情报清单（移交智能体执行，完成打勾） */
.checklist { margin-top: 10px; }
.checklist-title { display: flex; align-items: center; gap: 6px; font-size: var(--font-md); font-weight: 600; margin-bottom: 6px; flex-wrap: wrap; }
.agent-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted);
  font-size: var(--font-xs); font-weight: 500;
}
.checklist-hint { margin: 0 0 4px; color: var(--muted); font-size: var(--font-11-5); }
.check-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; margin-top: 5px; font-size: var(--font-12-5);
  border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); cursor: pointer; text-align: left;
}
.check-item:hover:not(:disabled) { border-color: var(--primary); }
.check-item:disabled { opacity: 0.55; cursor: not-allowed; }
.check-item.done { border-color: var(--success); }
.check-item.running {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 12%, transparent);
}
.check-item.failed { border-color: #ef4444; }
.check-mark { flex-shrink: 0; display: flex; color: var(--success); }
.check-item.running .check-mark { color: var(--primary); }
.check-item.failed .check-mark { color: #b91c1c; }
.check-circle {
  width: 13px; height: 13px; border-radius: 50%;
  border: 1.5px solid var(--line);
}
.check-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.check-label { font-weight: 500; }
.check-desc { color: var(--muted); font-size: var(--font-xs); line-height: 1.4; }
.check-item span { display: inline-flex; align-items: center; gap: 6px; }
.agent-toggle { margin-top: 10px; }

.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: var(--font-md); }
.field span { color: var(--muted); font-size: var(--font-sm); }
.field input, .field select {
  padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-md);
}
.launch {
  display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%;
  margin-top: 10px; padding: 10px; font-size: var(--font-lg); font-weight: 600;
  border: none; border-radius: 10px; cursor: pointer;
  background: var(--primary); color: #fff;
  transition: filter 0.15s ease;
}
.launch.slim { padding: 8px; font-size: var(--font-md); }
.launch:hover { filter: brightness(1.1); }
.launch:disabled { opacity: 0.5; cursor: not-allowed; }

.batch-row { display: flex; align-items: center; gap: 6px; margin: 8px 0; font-size: var(--font-12-5); flex-wrap: wrap; }
.pending-note { margin: 0; font-size: var(--font-11-5); color: var(--muted); line-height: 1.6; }
.batch-row input {
  width: 72px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px;
  background: transparent; color: var(--text); font-size: var(--font-12-5);
}
.hour-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.hour-grid label { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 3px; }
.hour-grid span { color: var(--muted); font-size: var(--font-xs); text-align: right; }
.hour-grid input {
  width: 100%; padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px;
  background: transparent; color: var(--text); font-size: var(--font-sm);
}
.action-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.mini {
  padding: 5px 12px; font-size: var(--font-12-5); border-radius: 8px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--text);
}
.mini { display: inline-flex; align-items: center; gap: 5px; }
.mini.primary { border-color: var(--primary); color: var(--primary); }
.mini.danger { border-color: #ef4444; color: #b91c1c; }
.mini:disabled { opacity: 0.5; cursor: not-allowed; }
.exposure-hint {
  margin: -2px 0 6px; color: var(--muted); font-size: var(--font-11-5); line-height: 1.6;
}
.exposure-source {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.exposure-source.mock {
  border-color: rgba(245, 158, 11, 0.55);
  color: #b45309;
  background: rgba(245, 158, 11, 0.09);
}

.block-head { display: flex; align-items: center; gap: 6px; font-size: var(--font-md); font-weight: 600; margin: 10px 0 6px; }
.gate-chip { padding: 1px 8px; font-size: var(--font-xs); border-radius: 999px; border: 1px solid var(--success); color: var(--success); }
.gate-chip.escalated { border-color: #f59e0b; color: #b45309; }
.check-list { margin: 4px 0; padding-left: 16px; font-size: var(--font-12-5); color: var(--muted); }
.check-list li { margin: 3px 0; }
.check-list li[data-status='PASS'] b { color: var(--success); }
.check-list li[data-status='FAIL'] b { color: #b91c1c; }
.check-list li[data-status='UNAVAILABLE'] b { color: #b45309; }

.approval-block textarea {
  width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-12-5); resize: vertical;
}
.mock-tag {
  margin-left: 6px; padding: 1px 8px; font-size: var(--font-xs); border-radius: 999px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.card-action {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px; padding: 6px 14px; font-size: var(--font-md);
  border: 1px solid var(--primary); border-radius: 8px;
  background: transparent; color: var(--primary); cursor: pointer;
}
.card-action:hover { background: var(--primary); color: #fff; }

/* 智能体工作区（历史侧栏 | 情报清单 | 对话）
   原 .prep-panel > :last-child { flex:1 } 已删除：它假定 panel 下唯一子元素就是
   chat panel，加侧栏后必然失效；改由 .aw-chat :deep(.agent-panel) 撑高。 */
.agent-workspace { height: 620px; padding: 0; overflow: hidden; display: flex; }
.aw-aside { width: 260px; flex-shrink: 0; transition: width 0.18s ease; }
.aw-aside.collapsed { width: 48px; }
.aw-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.aw-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.aw-tabs { display: flex; gap: 6px; }
.aw-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; font-size: var(--font-12-5); cursor: pointer;
  border: 1px solid var(--line); border-radius: 999px;
  background: transparent; color: var(--muted);
}
.aw-tab:hover { border-color: var(--primary); color: var(--primary); }
.aw-tab.active { border-color: var(--primary); color: var(--primary); background: rgba(14, 165, 233, 0.1); }
.aw-head-hint { margin-left: auto; font-size: var(--font-sm); }
.aw-body { flex: 1; min-height: 0; display: flex; }
.aw-checklist {
  width: 240px; flex-shrink: 0; overflow-y: auto; padding: 10px;
  border-right: 1px solid var(--line-faint);
}
.aw-chat { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.aw-chat :deep(.agent-panel) { flex: 1; min-height: 0; }
.draft-entry { margin-top: 10px; border-color: var(--primary); color: var(--primary); }
.checklist-moved {
  display: flex; align-items: flex-start; gap: 6px;
  margin: 10px 0 0; font-size: var(--font-sm); line-height: 1.6;
}

/* 窄屏：三栏竖排（沿用已接侧栏三页的 900px 断点约定） */
@media (max-width: 900px) {
  .agent-workspace { height: auto; flex-direction: column; }
  /* 只限制折叠态高度：展开态若也钉死 44px+hidden，rail-head 就占满、历史列表被整体裁掉，
     侧栏在手机/平板上等于不可用（既有三页 PolicyIntel/MorningBrief/PreSubmitCheck 同此问题，
     本 PR 只修申报台，共性修复另开）。 */
  /* 必须给确定 height 而非 max-height：子级 .history-rail 是 height:100%，父级
     height:auto 时它解析不出确定高度，.rail-body 的 overflow-y:auto 就不形成滚动区，
     会话多时内容越过 260px 与下方清单/对话重叠。 */
  .aw-aside { width: 100%; height: 260px; overflow: hidden; }
  .aw-aside.collapsed { width: 100%; height: 44px; }
  .aw-body { flex-direction: column; }
  .aw-checklist {
    width: 100%; max-height: 200px;
    border-right: none; border-bottom: 1px solid var(--line-faint);
  }
  .aw-chat { min-height: 420px; }
}

/* 移动端：96点时序网格从6列折叠为3列，避免小屏横向溢出 */
@media (max-width: 768px) {
  .hour-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .hour-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
