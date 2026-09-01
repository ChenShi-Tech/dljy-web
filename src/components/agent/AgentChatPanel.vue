<script setup lang="ts">
// 交互式智能体面板：流式渐变生成+ 工具卡 + 审批卡 + 图表 + 任务计划。
// 事件协议见 src/services/agentClient.ts 与后端 packages/agent-runtime/src/agent_runtime/api/service.py。
import { computed, nextTick, onMounted, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bot, ChevronDown, ChevronRight, Loader2, Send, Square, User, Wrench } from 'lucide-vue-next'
import { useAgentHealth } from '@/composables/useAgentHealth'
import { useCurrentModel } from '@/composables/useCurrentModel'
import {
  AgentStreamDisconnectedError,
  AgentStreamHttpError,
  attachRunStream,
  createAgentSession,
  getActiveRun,
  getAgentSession,
  sendAgentApproval,
  sendAgentMessage,
  stopAgentRun,
  fetchAgentRef,
  fetchHistoryTranscript,
  type AgentEvent,
  type AgentScenario,
  type AgentSessionInfo,
  type HistorySeg,
  type HistoryTurn
} from '@/services/agent/agentClient'
import { createAsyncGenerations } from './asyncGenerations'
import { parseArtifactBlocks, splitStreamingArtifacts, type ArtifactBlock } from '../../utils/artifactBlocks'
import { useSlashInput } from '../../composables/useSlashInput'
import type { CommandContext } from '@/services/slashCommands'
import { packageRegionSummary } from '@/services/region/regionContext'
import ArtifactRenderer from './artifacts/ArtifactRenderer.vue'
import ChartArtifact from './artifacts/ChartArtifact.vue'
import AnalysisChartArtifact from './artifacts/AnalysisChartArtifact.vue'
import AnalysisDashboardArtifact from './artifacts/AnalysisDashboardArtifact.vue'
import type { AnalysisChartSpec, AnalysisDashboard } from '@dljy/contracts'
import { ARTIFACT_CONTEXT } from './artifacts/context'
import SlashCommandMenu from './SlashCommandMenu.vue'
import {
  isToolGroupStart,
  summarizeToolGroup,
  toolGroupBasis,
  topToolGroupAt,
  type GroupableToolSeg,
} from './toolGrouping'
import DataBasisBadge from '../DataBasisBadge.vue'
import type { DataBasis } from '@/services/dataBasis'
import { ElMessage } from 'element-plus'

// 从工具结果文本识别数据口径：贴合本项目「合成降级必须页面可见」的标注纪律，
// 让 agent 调用工具时是否用到真实采集/合成数据一目了然。
function basisFromText(s?: string): DataBasis | undefined {
  if (!s) return undefined
  if (/synthetic_mock|"basis"\s*:\s*"synthetic"|合成演示/.test(s)) return 'synthetic'
  if (/"basis"\s*:\s*"captured"|"source"\s*:\s*"capture|真实采集/.test(s)) return 'captured'
  if (/"basis"\s*:\s*"illustrative"|示意/.test(s)) return 'illustrative'
  if (/"basis"\s*:\s*"real"/.test(s)) return 'real'
  return undefined
}

const props = withDefaults(
  defineProps<{
    scenario?: AgentScenario
    initialQuestion?: string
    // declaration_prep 场景的图初始参数（如 { constraints: '...' }）
    payload?: Record<string, unknown> | null
    // 历史侧栏选中会话时由工作台传入：挂载即回放该会话 transcript（不自动发 initialQuestion）
    resumeSessionId?: string | null
    // 是否启用聊天历史持久化（注册/每轮存档/刷新恢复）。默认开启（#498 反转）：所有接入点
    // 的对话都绑定登录用户、落 Node SQLite、切页/刷新可恢复。旧设计担心的「共用 localStorage
    // 同场景 key 串台」由 historyKey 按接入点隔离解决。
    persistHistory?: boolean
    // 接入点唯一标识（#498）：① localStorage 会话指针 key 按接入点隔离（agent_session_<historyKey>，
    // 防不同页面同场景互相串台）② 随会话 bind 落库为来源标注（page_key），供历史侧栏显示来源标签。
    // persistHistory 开启的接入点必须显式传且全仓唯一（verify:agent-chat-invariants 静态守卫）。
    historyKey?: string
    // Copilot 页面注入提示的白名单 key（见后端 graphs/page_prompts.py）：session 创建/续聊时
    // 传给 harness，由服务端按 key 解析为固定 supervisor 提示。传 key 而非自由文本，防注入绕过安全基线。
    promptKey?: string
    // B3 上下文感知 AI：调用方注入的选中数据/行/路由上下文。走 untrusted_external_content 语义
    // （前端只组装不执行），随消息 payload 下发，agent 据此回答带选中上下文。
    contextPayload?: Record<string, unknown> | null
  }>(),
  { scenario: 'chat', initialQuestion: '', payload: null, resumeSessionId: null, persistHistory: true, historyKey: '', promptKey: '', contextPayload: null }
)

const router = useRouter()
const emit = defineEmits<{
  done: [status: string]
  error: [message: string]
  approval: [payload: Record<string, unknown>]
  // 会话发生持久化变更（注册/新增轮次/恢复），工作台据此刷新历史侧栏
  historyChanged: []
  // 当前会话就绪（创建或恢复），携带 session_id 供侧栏高亮
  sessionReady: [sessionId: string]
  // 挂载初始化（探活、历史恢复/首问处理）完成后通知宿主
  ready: []
}>()

// 消息模型：assistant 消息由有序「段」组成，事件流逐段构建
type TextSeg = {
  kind: 'text'
  chunks: string[]
  done: boolean
  blocks?: ArtifactBlock[] // 完成后整体解析
  // 流式增量渲染：已闭合围栏即时渲染为 artifact，尾部继续逐 token 渐显
  liveBlocks?: ArtifactBlock[] // 稳定段（已闭合围栏）增量解析结果
  tail?: string // 在写尾部原文
  pending?: string | null // 尾部未闭合围栏的「生成中」标签
  stableSrc?: string // 上次解析的稳定段文本，未变则复用 liveBlocks（避免图表重挂）
}
type ToolSeg = {
  kind: 'tool'
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  summary?: string
  expanded: boolean
  // 子智能体内部工具（深度流式冒泡）时为其角色名，用于缩进与归属标注
  subRole?: string
  // 工具结果数据口径（real/captured/illustrative/synthetic），从结果文本识别后显示角标
  basis?: DataBasis
  // 顶层工具组的折叠态，只在组内首个工具上有意义（渲染期归并，见 topToolGroupAt）。
  // 后端 SegAccumulator 不认此字段、落库时丢弃，回放后按默认收起，可接受。
  groupCollapsed?: boolean
}
type ChartSeg = { kind: 'chart'; title: string; option: Record<string, unknown> | null }
// 契约图表段（#18 收尾 #48）：直接携带 AnalysisChartSpec / AnalysisDashboard，由契约渲染器出图。
type AnalysisChartSeg = { kind: 'analysis-chart'; spec: AnalysisChartSpec }
type AnalysisDashboardSeg = { kind: 'analysis-dashboard'; dashboard: AnalysisDashboard }
type ApprovalSeg = {
  kind: 'approval'
  payload: Record<string, unknown>
  resolved?: 'approve' | 'reject'
  note: string
  // 历史回放还原的审批卡为只读：不再渲染批准/驳回按钮（不可二次触发）
  readonly?: boolean
}
// 子智能体动作分组：同一子角色全部动作归并进唯一可折叠容器（默认收起，避免长串工具卡占屏）。
// 三路并发时事件按到达顺序交织（A→B→A→C→A→B…），故按 role 全局归并（ensureSubagentGroup），
// 同一智能体的所有动作（含 delegate 派发与子工具）始终在同一容器，不切碎成多个碎片。
// 视觉分层：派发任务/最终结果是「结论性信息」→ 容器头显示预览，展开后置顶；中间工具调用是
// 「过程噪声」→ 仅显示数量，展开后折叠在二级区。
type SubagentGroupSeg = {
  kind: 'subagent-group'
  role: string
  tools: ToolSeg[]
  collapsed: boolean
  // delegate_<role> 派发参数（即下发给该子智能体的任务提示词，从顶层 tool_call 事件归并而来）
  delegateArgs?: Record<string, unknown>
  // 子智能体最终返回结果文本（从对应 tool_result 事件回填，多行可见）
  delegateSummary?: string
  // 委派结果的数据口径（synthetic_mock/合成演示/captured 等标记 → DataBasis），与普通 tool 段
  // 的 seg.basis 对称：子智能体降级到合成演示时，分组头需渲染 DataBasisBadge 让用户一眼区分
  // 模拟/真实数据（与 AGENTS.md「所有 Mock 必须明确标注」P1 红线一致）。
  delegateBasis?: DataBasis
  delegateStatus?: 'running' | 'done' | 'error'
  // 派发任务/最终结果/中间工具列表三个子区各自的展开态（默认收起，减少视觉噪声）
  delegateExpanded?: boolean
  resultExpanded?: boolean
  toolsExpanded?: boolean
}
type Seg = TextSeg | ToolSeg | ChartSeg | AnalysisChartSeg | AnalysisDashboardSeg | ApprovalSeg | SubagentGroupSeg
type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }
type ChatMsg = { role: 'user' | 'assistant'; text?: string; segs: Seg[] }

const messages = ref<ChatMsg[]>([])
const todos = ref<Todo[]>([])
const input = ref('')
const streaming = ref(false)
const session = ref<AgentSessionInfo | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
// 智能滚动：离底时显示「回到底部」浮钮，流式中用户上滚阅读不被强行拽回底部
const showJump = ref(false)
let abort: AbortController | null = null
let currentRunId: string | null = null
let streamCursor = -1
let lastDoneStatus = ''
const reconnecting = ref(false)
const reconnectAttempt = ref(0)
// 本轮是否已收到 done 事件：流提前关闭/尾分隔符丢失致 done 未到时，send/decide 收尾补发一次，
// 避免依赖 @done 的调用方（编排进度等）状态机永久悬挂（STREAM-5 下游兜底）。
let sawDone = false
// 用户主动点「停止」标志：据此把 abort 中止识别为合法 cancelled 终态（不渲染成 ⚠️ 错误段）。
let cancelled = false
// 流世代号：每次开启新流（send/decide/attach）自增。切换会话时旧流 promise 可能晚于新流
// settle，其 finally 里的 finalizeStreamAfterRun 若不校验世代会清掉新流的共享状态（清
// currentRunId / 补发 done / 刷新历史覆盖正在续看的内容），stale 世代直接跳过收尾。
// 流式运行 与 历史加载 两条通道的世代簿记（含交叉作废规则），见 asyncGenerations.ts。
const gens = createAsyncGenerations()

// 工具中文标签（缺省回退原名）
const TOOL_LABELS: Record<string, string> = {
  navigate: '页面跳转',
  list_pages: '页面清单',
  web_fetch: '抓取网页',
  web_search: '联网搜索',
  python_sandbox: '沙箱计算',
  get_clearing_price: '查出清电价',
  get_load_data: '查统调负荷',
  get_renewable_output: '查新能源出力',
  get_weather: '查气象',
  get_positions: '查持仓',
  get_settlement: '查结算',
  get_price_forecast: '查价格预测',
  calc_peak_valley_stats: '峰谷价差统计',
  calc_bidding_space: '竞价空间测算',
  calc_deviation_assessment: '偏差考核测算',
  backtest_declaration: '申报回测',
  calc_kelly_position: '凯利仓位',
  calc_cvar_risk: 'CVaR 风险',
  run_storage_assessment: '储能综合评估',
  run_investment_assessment: '投资测算聚合',
  draft_investment_inputs: '投资参数识别',
  solve_milp_schedule: 'MILP 优化',
  find_arbitrage: '套利识别',
  decompose_contract_curve: '合同曲线分解',
  calc_open_position: '敞口测算',
  summarize_monthly_position: '月度持仓概览',
  draft_declaration: '生成申报草稿',
  submit_declaration: '提交申报',
  generate_report: '生成报告',
  create_chart: '生成图表',
  fetch_disclosures: '拉取披露',
  search_market_rules: '检索市场规则',
  list_disclosures_by_category: '按类目查披露',
  save_memory: '记入长期记忆',
  search_memory: '检索长期记忆',
  write_todos: '更新任务计划',
  calc_twap_schedule: 'TWAP 执行计划（兼容·股票拆单）',
  submit_bid_curve: '电力申报曲线提交（PR-P1c 电力语义）',
  get_region_rules: '查地区规则',
  compare_region_rules: '地区规则对比',
  check_declaration_compliance: '申报合规校验',
  analyze_marginal_unit: '边际机组分析',
  estimate_rival_bidding: '对手报价推演',
  simulate_clearing_game: '出清博弈模拟',
  delegate_market_analyst: '→ 市场分析师',
  delegate_data_collector: '→ 数据采集员',
  delegate_declaration_strategist: '→ 申报策略师',
  delegate_review_reporter: '→ 复盘报告员',
  delegate_risk_sentinel: '→ 风控哨兵',
  delegate_price_forecaster: '→ 价格预测专员',
  delegate_hedge_strategist: '→ 中长期套保专员',
  delegate_arbitrage_optimizer: '→ 套利储能专员',
  delegate_settlement_auditor: '→ 结算校核专员',
  delegate_bidding_game_analyst: '→ 报价博弈分析师',
  delegate_compliance_officer: '→ 合规规则专员'
}
const toolLabel = (n: string) => TOOL_LABELS[n] || n

// 顶层工具组归并下沉 toolGrouping.ts（纯函数，单测覆盖边界）；本组件只做薄封装：
// 绑定 toolLabel，并把入参放宽为 Seg[]，topToolGroupAt 已按 isTopLevelTool 过滤，
// 运行时必为 ToolSeg，但泛型从 Seg[] 推导出的静态类型仍是 Seg[]。
function toolGroupOf(segs: Seg[], index: number): ToolSeg[] {
  return topToolGroupAt(segs as Array<{ kind: string; subRole?: string }>, index) as unknown as ToolSeg[]
}

function toolGroupSummary(tools: ToolSeg[]) {
  return summarizeToolGroup(tools as unknown as GroupableToolSeg[], toolLabel)
}

function groupBasisOf(tools: ToolSeg[]) {
  return toolGroupBasis(tools as unknown as GroupableToolSeg[]) as DataBasis | undefined
}
// 子智能体角色 key → 中文名（深度流式工具归属标注）
const ROLE_LABELS: Record<string, string> = {
  market_analyst: '市场分析师', data_collector: '数据采集员',
  declaration_strategist: '申报策略师', review_reporter: '复盘报告员',
  risk_sentinel: '风控哨兵', price_forecaster: '价格预测专员',
  hedge_strategist: '中长期套保专员', arbitrage_optimizer: '套利储能专员',
  settlement_auditor: '结算校核专员', bidding_game_analyst: '报价博弈分析师',
  compliance_officer: '合规规则专员'
}
const roleLabel = (r: string) => ROLE_LABELS[r] || r

// delegate_<role> 工具名 → role key（market_analyst / review_reporter / risk_sentinel / …）。
// supervisor 派子智能体即工具，工具名形如 delegate_market_analyst；以此识别"这条派发属于哪个智能体"，
// 把顶层 tool_call(delegate_*) 归并进对应智能体的折叠容器，与 subagent_tool_* 事件共用同一容器。
const DELEGATE_ROLE_RE = /^delegate_(.+)$/
function roleOfDelegate(toolName: string): string | null {
  const m = DELEGATE_ROLE_RE.exec(toolName)
  return m ? m[1] : null
}

// 全局查找（或新建）该 role 的唯一折叠容器。
// 替代旧的"只看 msg.segs 最后一段是否同 role"逻辑，三路并发时事件交织到达，旧逻辑会让同一智能体
// 被切成 N 个碎片容器穿插显示。这里保证每个智能体在整个 assistant 轮次里只有一个容器。
function ensureSubagentGroup(msg: ChatMsg, role: string): SubagentGroupSeg {
  for (const s of msg.segs) {
    if (s.kind === 'subagent-group' && s.role === role) return s
  }
  const grp: SubagentGroupSeg = { kind: 'subagent-group', role, tools: [], collapsed: true }
  msg.segs.push(grp)
  return grp
}

// 派发任务/最终结果的容器头预览（取首行或前 N 字，便于一眼扫过三路智能体在做什么/得出什么）。
const PREVIEW_LEN = 60
function delegateArgsPreview(args?: Record<string, unknown>): string {
  if (!args) return ''
  // delegate 工具参数通常是 { task: "..." } 或 { instruction: "..." }，取第一个字符串型字段
  const val = (args.task ?? args.instruction ?? args.input ?? args.query ?? '') as unknown
  const text = typeof val === 'string' ? val : JSON.stringify(args)
  return text.length > PREVIEW_LEN ? text.slice(0, PREVIEW_LEN) + '…' : text
}
function delegateResultPreview(summary?: string): string {
  if (!summary) return ''
  const firstLine = summary.split('\n')[0].trim()
  return firstLine.length > PREVIEW_LEN ? firstLine.slice(0, PREVIEW_LEN) + '…' : firstLine
}

// 启发式识别子智能体返回的错误文本：后端 tool_result 对成功/失败统一发同一类事件，
// 错误信息散落在 summary 文本里。识别到错误时容器头显红框、状态置 error（关键角色失败可见）。
const ERROR_MARKERS = /^(error|exception|traceback|失败|异常|出错|错误[:：])/i
function looksLikeError(text: string | undefined): boolean {
  if (!text) return false
  return ERROR_MARKERS.test(text.trim())
}

// 空态示例问题（仅在线、无消息时展示，点击即发起一轮对话）。
// 前两条显式要「图/表」：引导 agent 用 ```chart / ```table 围栏内联渲染，直观演示本框可看图看表。
const SUGGESTIONS = [
  '用折线图展示今日云南24点现货电价走势',
  '用表格列出本周每日峰谷价差与现货均价',
  '帮我评估明日申报策略',
  '复盘本周交易表现'
]

const canSend = computed(() => input.value.trim().length > 0 && !streaming.value)

// 动态「在工作」指示：流式计时 + token 计数 + 阶段，让回答看起来在思考/干活
const elapsedMs = ref(0)
const tokenCount = ref(0)
let streamTimer: ReturnType<typeof setInterval> | null = null
// 智能体导航事件 600ms 过场跳转 timer（存 id 供卸载清理，避免组件销毁后仍 router.push 劫持路由，#1743）
let navTimer: ReturnType<typeof setTimeout> | undefined
let streamStartMs = 0
function stopStreamMeter() {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null }
}
function startStreamMeter() {
  streamStartMs = Date.now()
  elapsedMs.value = 0
  tokenCount.value = 0
  stopStreamMeter()
  streamTimer = setInterval(() => { elapsedMs.value = Date.now() - streamStartMs }, 100)
}
// 流式开关 → 计时器开关（覆盖 send 与 decide 两条流式入口）
watch(streaming, (s) => { if (s) startStreamMeter(); else stopStreamMeter() })
// 流式阶段：思考 → 调工具 → 生成（从最后一条助手消息的段确定性派生）
const streamPhase = computed<'thinking' | 'tool' | 'generating'>(() => {
  const segs = messages.value[messages.value.length - 1]?.segs ?? []
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    if (s.kind === 'tool' && s.status === 'running') return 'tool'
    if (s.kind === 'subagent-group' && s.tools.some((t) => t.status === 'running')) return 'tool'
    if (s.kind === 'text' && !s.done) return 'generating'
  }
  return 'thinking'
})
const PHASE_LABEL: Record<'thinking' | 'tool' | 'generating', string> = {
  thinking: '正在思考', tool: '正在调用工具', generating: '正在生成'
}

// 智能滚动：仅当用户已贴近底部时才跟随流式输出；否则不打断阅读，亮出「回到底部」浮钮。
// force=true 用于用户自己的动作（发送/回放历史），无条件滚到底。
function atBottom() {
  const el = bodyRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}
function scrollBottom(force = false) {
  nextTick(() => {
    const el = bodyRef.value
    if (!el) return
    if (force || atBottom()) {
      el.scrollTo({ top: el.scrollHeight, behavior: force ? 'smooth' : 'auto' })
      showJump.value = false
    } else {
      showJump.value = true
    }
  })
}
function onBodyScroll() {
  if (atBottom()) showJump.value = false
}
function jumpToBottom() {
  showJump.value = false
  bodyRef.value?.scrollTo({ top: bodyRef.value.scrollHeight, behavior: 'smooth' })
}
// 多行输入自适应高度（上限 160px 后内部滚动）
function autoGrow() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
// 输入变化（含发送后清空 / 外部 ask() 注入）→ 重算 textarea 高度
watch(input, () => nextTick(autoGrow))

function lastAssistant(): ChatMsg {
  const last = messages.value[messages.value.length - 1]
  if (last?.role === 'assistant') return last
  const msg: ChatMsg = { role: 'assistant', segs: [] }
  messages.value.push(msg)
  return msg
}

function appendToken(text: string) {
  tokenCount.value++ // 动态指示：累计本轮 token 活动量
  const msg = lastAssistant()
  let seg = msg.segs[msg.segs.length - 1] as TextSeg | undefined
  if (!seg || seg.kind !== 'text' || seg.done) {
    seg = { kind: 'text', chunks: [], done: false }
    msg.segs.push(seg)
  }
  seg.chunks.push(text)
  scheduleLiveParse(seg)
}

// 流式增量解析：用 rAF 合并高频 token，每帧最多重算一次当前段；稳定段文本未变时复用旧
// liveBlocks（保持块引用稳定 → 已渲染图表不重挂）。
let liveRaf = 0
let liveSeg: TextSeg | null = null
function scheduleLiveParse(seg: TextSeg) {
  liveSeg = seg
  if (liveRaf) return
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0
    const s = liveSeg
    if (!s || s.done) return
    // 流式增量解析对未闭合/畸形围栏极敏感：任何解析异常都不能冒泡出 rAF 回调
    // （否则该帧静默崩溃、后续 token 不再触发重渲，对话框「卡死」在半截）。
    // 兜底：异常时保留上次的 liveBlocks，尾部直接显示原文，等下一帧/收尾再试。
    try {
      const { stable, tail, pendingLabel } = splitStreamingArtifacts(s.chunks.join(''))
      s.tail = tail
      s.pending = pendingLabel
      if (stable !== s.stableSrc) {
        s.stableSrc = stable
        s.liveBlocks = stable ? parseArtifactBlocks(stable) : []
      }
    } catch (err) {
      // 不改动上一帧的稳定渲染态（避免与已渲染块重复），仅吞掉异常：
      // 多为半截围栏的瞬态错误，下一帧 token 到达会重试；持续异常则由 finishTextSegs 收尾兜底。
      console.warn('[agent-chat] 流式增量解析失败（保留上帧渲染，待重试/收尾兜底）', err)
    }
  })
}

// 兜底转义：收尾解析异常时把原文安全地塞进一个 markdown 块，绝不丢内容。
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function finishTextSegs(msg: ChatMsg) {
  for (const seg of msg.segs) {
    if (seg.kind === 'text' && !seg.done) {
      const raw = seg.chunks.join('')
      seg.done = true
      // 收尾整体解析若抛异常（如某 builder/markdown 在极端输入上崩），必须降级为纯文本块：
      // 否则 seg.blocks 未赋值 + seg.done=true → displayBlocks 返回 []、流式分支也已关闭，
      // 整段文本会彻底消失（用户视角的「渲染失败/空白」）。
      try {
        seg.blocks = parseArtifactBlocks(raw)
      } catch (err) {
        console.warn('[agent-chat] 收尾解析失败，降级为纯文本（不丢内容）', err)
        seg.blocks = [{ kind: 'markdown', html: `<pre class="chat-fallback">${escapeHtmlText(raw)}</pre>` }]
      }
    }
  }
}

// 聊天历史持久化（落 Node /api，按登录用户隔离；失败仅告警不阻断聊天）
// 存储口径见 docs/agent-harness/agent-chat-history.md：只存稳定字段，blocks 等回放时重算。

function localKey() {
  // 按接入点隔离（#498）：historyKey 缺省时回退 scenario（兼容外部直挂未传 key 的面板）
  return `agent_session_${props.historyKey || props.scenario}`
}
function saveLocalSession(id: string) {
  try { localStorage.setItem(localKey(), id) } catch { /* 隐私模式等忽略 */ }
}
function clearLocalSession() {
  try { localStorage.removeItem(localKey()) } catch { /* ignore */ }
}
function readLocalSession(): string | null {
  try { return localStorage.getItem(localKey()) } catch { return null }
}

// 段还原：text 段重跑 artifact 解析（与 finishTextSegs 同路径，围栏照常渲染）；审批卡一律只读
function restoreSeg(raw: HistorySeg): Seg {
  const kind = raw.kind
  if (kind === 'text') {
    const text = Array.isArray(raw.chunks) ? (raw.chunks as string[]).join('') : String(raw.text ?? '')
    // 回放解析降级（与 finishTextSegs 收尾路径对称）：某条已落库富 artifact 在 parseArtifactBlocks
    // 内（renderMarkdown / businessChart builder）抛错时降级为纯文本 <pre>，否则单个坏 artifact 会让
    // restoreMsg 抛出、整段 transcript 在 loadHistory 赋值前失败 → 历史会话「打不开 / 空白」（本 fix 根因）。
    let blocks: ArtifactBlock[]
    try {
      blocks = parseArtifactBlocks(text)
    } catch (err) {
      console.warn('[chat-history] 回放解析失败，降级为纯文本（不丢内容）', err)
      blocks = [{ kind: 'markdown', html: `<pre class="chat-fallback">${escapeHtmlText(text)}</pre>` }]
    }
    return { kind: 'text', chunks: [text], done: true, blocks }
  }
  if (kind === 'tool') {
    return {
      kind: 'tool',
      name: String(raw.name ?? ''),
      args: (raw.args as Record<string, unknown>) ?? {},
      status: (raw.status as ToolSeg['status']) ?? 'done',
      summary: raw.summary as string | undefined,
      expanded: false,
      subRole: raw.subRole as string | undefined,
      basis: raw.basis as DataBasis | undefined
    }
  }
  if (kind === 'chart') {
    return { kind: 'chart', title: String(raw.title ?? '图表'), option: (raw.option as Record<string, unknown>) ?? null }
  }
  if (kind === 'analysis-chart') {
    return { kind: 'analysis-chart', spec: raw.spec as unknown as AnalysisChartSpec }
  }
  if (kind === 'analysis-dashboard') {
    return { kind: 'analysis-dashboard', dashboard: raw.dashboard as unknown as AnalysisDashboard }
  }
  if (kind === 'subagent-group') {
    // 回放还原 group 容器（#641）：服务端 history_segs 自 #641 起原样保留 group（不再展平），
    // 这里递归还原子 tools 并回填 delegate* 字段，使 loadHistory 后的分组卡与流式态渲染一致
    // （折叠态/角色/派发参数/结果/口径徽标）。旧平铺落库（无 group 结构、纯 tool 段）不走此分支。
    const tools: ToolSeg[] = []
    if (Array.isArray(raw.tools)) {
      for (const rt of raw.tools) {
        const restored = restoreSeg(rt as HistorySeg)
        if (restored.kind === 'tool') tools.push(restored)
      }
    }
    return {
      kind: 'subagent-group',
      role: String(raw.role ?? ''),
      tools,
      collapsed: true, // 回放态默认收起（与流式 ensureSubagentGroup 初始 collapsed:true 一致）
      delegateArgs: raw.delegateArgs as Record<string, unknown> | undefined,
      delegateSummary: raw.delegateSummary as string | undefined,
      delegateStatus: raw.delegateStatus as SubagentGroupSeg['delegateStatus'],
      delegateBasis: raw.delegateBasis as DataBasis | undefined
    }
  }
  return {
    kind: 'approval',
    payload: (raw.payload as Record<string, unknown>) ?? {},
    resolved: raw.resolved as ApprovalSeg['resolved'],
    note: String(raw.note ?? ''),
    readonly: true
  }
}
function restoreMsg(turn: HistoryTurn): ChatMsg {
  if (turn.role === 'user') return { role: 'user', text: turn.text, segs: [] }
  return { role: 'assistant', segs: (turn.segs ?? []).map(restoreSeg) }
}

async function refreshHistoryFromServer() {
  if (!props.persistHistory) return
  const s = session.value
  if (!s) return
  try {
    const t = await fetchHistoryTranscript(s.id)
    if (!t?.messages?.length) return
    messages.value = t.messages.map(restoreMsg)
    todos.value = []
    session.value = { id: t.session_id, scenario: t.scenario, title: t.title, status: 'idle' }
    saveLocalSession(t.session_id)
    emit('sessionReady', t.session_id)
    emit('historyChanged')
    scrollBottom(true)
  } catch (err) {
    console.warn('[chat-history] 服务端历史刷新失败（保留当前流式内容）', err)
  }
}

// 回放历史会话（侧栏选中 / 刷新恢复）。设回 session 续同线程，标记全部已落库。
// fromClick=用户主动点击侧栏（失败要可见、且不得清 localStorage 指针）；缺省=onMounted 自动恢复
// （失败静默清陈旧指针即可）。区分两条入口，避免用户点击打不开时既无反馈又误清指针。
async function loadHistory(sessionId: string, opts?: { fromClick?: boolean; allowEmpty?: boolean }): Promise<boolean> {
  const fromClick = opts?.fromClick === true
  const allowEmpty = opts?.allowEmpty === true
  // 世代守卫：侧栏快速连点会话 A、B 会并发两次 loadHistory，A 若晚归会再次覆盖
  // messages/session/高亮，用户随后在错误的旧会话里续聊。加在共享组件内，5 个接入点同受益。
  // 亦被 beginStream() 作废：加载在途时发新消息，历史响应不得再写回。
  const generation = gens.beginHistoryLoad()
  const stale = () => gens.isHistoryStale(generation)
  // 切会话前必须作废在途流世代：仅 abort reader 不够，断开 SSE 不停后端 run，旧 send()
  // 的 finally 仍会以有效世代执行 finalizeStreamAfterRun('completed')，提前触发宿主的
  // done 回调（申报台的 finishIntel/onPrepDone），把仍在后台运行的核查显示为已完成，
  // 还可能对刚加载的新会话做历史刷新。下沉到此，所有调用方（5 个接入点）都受益。
  detachReaderForSwitch()
  try {
    const t = await fetchHistoryTranscript(sessionId)
    if (stale()) return false
    if (!t || !t.messages?.length) {
      if (allowEmpty && t) {
        if (stale()) return false
        abort?.abort()
        messages.value = []
        todos.value = []
        session.value = { id: t.session_id, scenario: t.scenario, title: t.title, status: 'idle' }
        if (props.persistHistory) {
          saveLocalSession(t.session_id)
          emit('sessionReady', t.session_id)
        }
        return true
      }
      // 空 transcript 多为会话仍在生成、首轮尚未落库：主动点击给可见提示，不再静默；不清指针
      if (fromClick) ElMessage.info('该会话暂无可回放内容（可能仍在生成，请稍后再试）')
      else clearLocalSession()
      return false
    }
    if (stale()) return false
    abort?.abort()
    messages.value = t.messages.map(restoreMsg)
    todos.value = []
    session.value = { id: t.session_id, scenario: t.scenario, title: t.title, status: 'idle' }
    if (props.persistHistory) {
      saveLocalSession(t.session_id)
      emit('sessionReady', t.session_id)
    }
    scrollBottom(true)
    return true
  } catch (err) {
    if (stale()) return false
    console.warn('[chat-history] 恢复历史失败', err)
    if (fromClick) ElMessage.error('历史加载失败：' + (err instanceof Error ? err.message : '请稍后重试'))
    else clearLocalSession()
    return false
  }
}

// 新建对话：清空当前会话与本地记忆，下次发送重建新会话
function newConversation() {
  gens.invalidateStream() // 作废在途流世代，防其迟到回调/收尾写入刚清空的会话
  // 同时作废在途 loadHistory：点历史会话后、transcript 返回前再点「新建对话」时，
  // 旧历史请求仍会通过世代检查写回消息与会话 id，把新建的空会话覆盖成旧会话。
  gens.invalidateHistoryLoad()
  abort?.abort()
  streaming.value = false // 旧流 finalize 已被世代守卫跳过，须显式复位，否则面板卡流式态
  messages.value = []
  todos.value = []
  session.value = null
  currentRunId = null
  streamCursor = -1
  reconnecting.value = false
  reconnectAttempt.value = 0
  clearLocalSession()
}

// 渲染用块：完成后用整体解析结果，流式中用稳定段增量结果（同一 ArtifactRenderer 节点，
// 块按 index keying → done 切换不重挂已渲染图表）。
function displayBlocks(seg: TextSeg): ArtifactBlock[] {
  return (seg.done ? seg.blocks : seg.liveBlocks) ?? []
}

async function onEvent(e: AgentEvent) {
  const msg = lastAssistant()
  if (e.type === 'token') {
    appendToken(e.content)
  } else if (e.type === 'text_retract') {
    // #2213：底座判定刚放出的文本是过程叙述（同一条消息随后发起了工具调用）——撤掉当前未定格的文本段。
    // 只撤未 done 的尾段：已被 finishTextSegs 定格的历史文本是正式回答，不可回收。
    const last = msg.segs[msg.segs.length - 1]
    if (last && last.kind === 'text' && !last.done) msg.segs.pop()
  } else if (e.type === 'tool_call') {
    finishTextSegs(msg) // 文本段在工具调用前定格为 markdown
    // delegate_<role> 是 supervisor 给子智能体派活，不是普通工具，归并进该 role 的唯一折叠容器，
    // 作为「派发任务」首行展示（用户最关心"派了什么活"），不再平铺成顶层工具卡占屏。
    const delegateRole = roleOfDelegate(e.name)
    if (delegateRole) {
      const grp = ensureSubagentGroup(msg, delegateRole)
      grp.delegateArgs = e.args
      grp.delegateStatus = 'running'
    } else {
      msg.segs.push({ kind: 'tool', name: e.name, args: e.args, status: 'running', expanded: false })
    }
  } else if (e.type === 'tool_result') {
    // 对应的 delegate 结果：把子智能体最终返回文本回填到容器（用户最关心"得出了什么结论"）。
    const delegateRole = roleOfDelegate(e.name)
    if (delegateRole) {
      const grp = msg.segs.find(
        (s): s is SubagentGroupSeg => s.kind === 'subagent-group' && s.role === delegateRole
      )
      if (grp) {
        // 后端 tool_result 对成功/失败统一发 tool_result（错误文本在 summary 里），用启发式识别错误态，
        // 关键角色（风控哨兵等）失败时容器头显红框而非绿✓，避免误导。
        grp.delegateStatus = looksLikeError(e.summary) ? 'error' : 'done'
        grp.delegateSummary = e.summary
        // 与普通 tool 段对称：从结果文本识别数据口径（synthetic_mock/合成演示/captured 等），
        // 在分组头渲染 DataBasisBadge，否则子智能体降级到合成演示时用户无法区分模拟/真实数据。
        // 始终用最新结果重算口径（#634）：同 role 多次 delegate 复用
        // 同一 subagent-group，若仅 basis 真值时覆盖，后一次结果无可识别口径标记时会残留上一次的徽标，
        // 把当前结果误标为模拟/真实。无条件赋值（含 null）以清旧标。
        grp.delegateBasis = basisFromText(e.summary)
      } else {
        // 与 subagent_tool_result 对称：流乱序/中断、或 tool_call 事件被过滤致未建容器时留痕排查。
        console.warn('[agent-chat] delegate tool_result 未匹配分组容器：', delegateRole, e.name)
      }
    } else {
      const seg = [...msg.segs].reverse().find(
        (s): s is ToolSeg => s.kind === 'tool' && s.name === e.name && s.status === 'running'
      )
      if (seg) {
        seg.status = 'done'
        seg.summary = e.summary
        seg.basis = basisFromText(e.summary)
      }
      if (e.ui?.event === 'navigation') {
        const target = e.ui.path + (e.ui.query ? `?${e.ui.query}` : '')
        // feature flag 关闭的部署（如 VITE_DISABLE_GRID_GEO=1）不挂载对应路由，
        // 此时会命中 catch-all 静默落 /dashboard；先校验目标真实存在再跳。
        const reachable = router.resolve(e.ui.path).matched.some((r) => !r.path.startsWith('/:pathMatch'))
        if (reachable) {
          // 过场跳转：存 id 供卸载清理；覆盖上一个未触发的导航（连续 navigation 事件不累加泄漏）
          if (navTimer) clearTimeout(navTimer)
          navTimer = setTimeout(() => { navTimer = undefined; router.push(target) }, 600)
        } else {
          ElMessage.warning(`页面「${e.ui.page_name || e.ui.path}」在当前部署未启用`)
        }
      } else if (e.ui?.event === 'chart' && session.value) {
        const chartSeg: ChartSeg = { kind: 'chart', title: e.ui.title, option: null }
        msg.segs.push(chartSeg)
        try {
          chartSeg.option = await fetchAgentRef(session.value.id, e.ui.chart_ref)
        } catch {
          msg.segs.splice(msg.segs.indexOf(chartSeg), 1)
        }
      } else if (e.ui?.event === 'analysis-chart') {
        // 契约图表：query_data 的 AnalysisChartSpec 直接推送渲染（不依赖 LLM 复述 JSON）。
        msg.segs.push({ kind: 'analysis-chart', spec: e.ui.chart as unknown as AnalysisChartSpec })
      } else if (e.ui?.event === 'analysis-dashboard') {
        msg.segs.push({ kind: 'analysis-dashboard', dashboard: e.ui.dashboard as unknown as AnalysisDashboard })
      }
    }
  } else if (e.type === 'subagent_tool_call') {
    // 子智能体内部工具调用冒泡：归并进该 role 的唯一折叠容器（不论事件是否交织），不再碎片化。
    finishTextSegs(msg)
    const tool: ToolSeg = { kind: 'tool', name: e.name, args: e.args, status: 'running', expanded: false, subRole: e.role }
    ensureSubagentGroup(msg, e.role).tools.push(tool)
  } else if (e.type === 'subagent_tool_result') {
    // 在该角色的分组容器里回填运行中的同名工具结果。
    let target: ToolSeg | undefined
    for (let i = msg.segs.length - 1; i >= 0 && !target; i--) {
      const s = msg.segs[i]
      if (s.kind === 'subagent-group' && s.role === e.role) {
        target = [...s.tools].reverse().find((t) => t.name === e.name && t.status === 'running')
      }
    }
    if (target) {
      target.status = 'done'
      target.summary = e.summary
      target.basis = basisFromText(e.summary)
    } else {
      // 兜底：流乱序/中断、或主流 token 打断分组连续性时未匹配到运行中工具，不静默丢，留痕便于排查。
      console.warn('[agent-chat] subagent_tool_result 未匹配容器内运行中工具：', e.role, e.name)
    }
  } else if (e.type === 'todos') {
    todos.value = e.items
  } else if (e.type === 'approval_request') {
    finishTextSegs(msg)
    msg.segs.push({ kind: 'approval', payload: e.payload, note: '' })
    emit('approval', e.payload)
  } else if (e.type === 'error') {
    finishTextSegs(msg)
    const errText = `⚠️ ${e.message}`
    msg.segs.push({ kind: 'text', chunks: [errText], done: true, blocks: parseArtifactBlocks(errText) })
    emit('error', e.message)
  } else if (e.type === 'done') {
    finishTextSegs(msg)
    sawDone = true
    lastDoneStatus = e.status
    if (session.value) session.value.status = e.status === 'awaiting_approval' ? 'awaiting_approval' : 'idle'
    emit('done', e.status)
  }
  scrollBottom()
}

function isAbortLike(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

function setStreamCursor(cursor: number) {
  streamCursor = Math.max(streamCursor, cursor)
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function ensureAttachPlaceholder() {
  const last = messages.value[messages.value.length - 1]
  if (last?.role === 'assistant' && last.segs.length === 0) return
  messages.value.push({ role: 'assistant', segs: [] })
}

// 所有共享状态写入（messages/streamCursor/reconnecting/currentRunId）都要过世代校验：
// 切换会话后旧流迟到的 token/cursor/错误不得污染新流。
function guardedStreamCallbacks(gen: number) {
  return {
    onEvent: (e: AgentEvent) => { if (!gens.isStreamStale(gen)) return onEvent(e) },
    onCursor: (value: number) => { if (!gens.isStreamStale(gen)) setStreamCursor(value) }
  }
}

async function attachRunWithReconnect(sessionId: string, runId: string, cursor: number,
                                      gen: number, signal?: AbortSignal) {
  if (gens.isStreamStale(gen)) return
  currentRunId = runId
  streamCursor = cursor
  let nextCursor = cursor
  const guarded = guardedStreamCallbacks(gen)
  for (;;) {
    if (gens.isStreamStale(gen)) return // 切换会话后 stale 重连循环直接退出
    try {
      const result = await attachRunStream(sessionId, runId, nextCursor, guarded.onEvent, {
        signal,
        onCursor: (value) => {
          nextCursor = value
          guarded.onCursor(value)
        }
      })
      if (gens.isStreamStale(gen)) return
      reconnecting.value = false
      reconnectAttempt.value = 0
      setStreamCursor(result.cursor)
      return result
    } catch (err) {
      if (cancelled || signal?.aborted || isAbortLike(err) || gens.isStreamStale(gen)) return
      if (err instanceof AgentStreamHttpError && err.status >= 400 && err.status < 500) throw err
      if (!(err instanceof AgentStreamDisconnectedError)) throw err
      nextCursor = err.cursor
      setStreamCursor(err.cursor)
      reconnecting.value = true
      reconnectAttempt.value += 1
      await delayWithAbort(Math.min(15000, 800 * reconnectAttempt.value), signal)
    }
  }
}

async function recoverDisconnectedRun(err: unknown, sessionId: string,
                                      gen: number, signal?: AbortSignal): Promise<boolean> {
  if (!(err instanceof AgentStreamDisconnectedError) || !currentRunId) return false
  if (gens.isStreamStale(gen)) return true // stale 流不再重连，也不渲染错误
  await attachRunWithReconnect(sessionId, currentRunId, err.cursor, gen, signal)
  return true
}

async function finalizeStreamAfterRun(fallbackStatus: string, gen?: number) {
  if (gen !== undefined && gens.isStreamStale(gen)) return // stale 流的迟到收尾：不碰共享状态
  streaming.value = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  finishTextSegs(lastAssistant())
  // done 未到达（流提前关闭/尾分隔符丢失/用户中止）时补发一次，避免调用方 @done 钩子不触发
  if (!sawDone) {
    sawDone = true
    lastDoneStatus = fallbackStatus
    emit('done', fallbackStatus)
  }
  currentRunId = null
  streamCursor = -1
  if (!cancelled && lastDoneStatus !== 'awaiting_approval') await refreshHistoryFromServer()
  else if (props.persistHistory) emit('historyChanged')
}

function restorePendingApprovalIfNeeded(info: AgentSessionInfo | null) {
  if (!info || !info.pending_approval || typeof info.pending_approval !== 'object') return
  session.value = { ...info, status: 'awaiting_approval' }
  const last = messages.value[messages.value.length - 1]
  const hasOpenApproval = last?.role === 'assistant'
    && last.segs.some((seg) => seg.kind === 'approval' && !(seg as ApprovalSeg).resolved)
  if (hasOpenApproval) return
  messages.value.push({
    role: 'assistant',
    segs: [{ kind: 'approval', payload: info.pending_approval as Record<string, unknown>, note: '' }]
  })
  scrollBottom(true)
}

async function attachActiveRunIfAny(initialCursor = -1): Promise<boolean> {
  const s = session.value
  if (!s || agentOffline.value) return false
  // 流世代必须在探活之前预留。getActiveRun/getAgentSession 都是网络往返，期间用户完全
  // 可能从侧栏选了另一个会话，那条路径的 loadHistory 会 invalidateStream()，于是这里预留的
  // 世代随即失效，探活回来一查就知道该放手。反过来若等探活返回才 beginStream()，会拿到一个
  // "新"世代：既把用户刚开始的历史加载作废（beginStream 交叉作废历史），又附着到用户已经
  // 离开的那个会话上，选择被静默丢弃。
  const gen = gens.beginStream()
  let active
  try {
    active = await getActiveRun(s.id)
  } catch (err) {
    console.warn('[agent-chat] 查询 active run 失败', err)
    return false
  }
  if (gens.isStreamStale(gen)) return false // 探活期间用户已切走：不附着、不碰共享状态
  if (!active?.run_id || active.status !== 'running') {
    const info = await getAgentSession(s.id).catch(() => null)
    if (gens.isStreamStale(gen)) return false // 同上：待审批态也不得回填到别的会话
    restorePendingApprovalIfNeeded(info)
    return false
  }
  ensureAttachPlaceholder()
  streaming.value = true
  sawDone = false
  lastDoneStatus = ''
  cancelled = false
  const ac = new AbortController()
  abort = ac
  scrollBottom(true)
  try {
    await attachRunWithReconnect(s.id, active.run_id, initialCursor, gen, ac.signal)
  } catch (err) {
    const aborted = cancelled || isAbortLike(err) || ac.signal.aborted || gens.isStreamStale(gen)
    if (!aborted) await onEvent({ type: 'error', message: err instanceof Error ? err.message : '请求失败' })
  } finally {
    await finalizeStreamAfterRun(cancelled ? 'cancelled' : 'completed', gen)
  }
  return true
}

function deriveTitle(): string {
  const firstUser = messages.value.find((m) => m.role === 'user')
  const t = (firstUser?.text ?? '').trim()
  return t.length > 40 ? t.slice(0, 40) : t
}

async function ensureSession() {
  if (!session.value) {
    // persist=true（全部接入点默认）时，harness 创建会话后会用服务端凭证回调 Node 登记归属
    // （owner 由转发的登录 token 解析，前端无法自助认领他人 session_id）。消息落库由
    // agent-backend 在 run 收口时回调 Node 完成，前端只负责流式展示和完成后刷新 transcript。
    session.value = await createAgentSession(
      props.scenario,
      props.persistHistory ? deriveTitle() : '',
      {
        persist: props.persistHistory,
        promptKey: props.promptKey || undefined,
        pageKey: props.historyKey || undefined
      }
    )
    if (props.persistHistory) {
      saveLocalSession(session.value.id)
      emit('sessionReady', session.value.id)
      emit('historyChanged')
    }
  }
  return session.value
}

async function send() {
  if (!canSend.value) return
  const content = input.value.trim()
  // 斜杠指令本地执行（/help、/clear、/nav、技能等），不发给智能体
  if (content.startsWith('/') && trySlash(content)) {
    input.value = ''
    return
  }
  pushHistory(content)
  input.value = ''
  messages.value.push({ role: 'user', text: content, segs: [] })
  // 立即压入空助手气泡占位：动态指示（思考/计时/token）即刻出现，不必等首个事件才「弹框」
  messages.value.push({ role: 'assistant', segs: [] })
  const gen = gens.beginStream()
  streaming.value = true
  sawDone = false
  lastDoneStatus = ''
  cancelled = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  currentRunId = null
  streamCursor = -1
  const ac = new AbortController()
  abort = ac
  const guarded = guardedStreamCallbacks(gen)
  scrollBottom(true)
  let s: AgentSessionInfo | null = null
  try {
    s = await ensureSession()
    // 地区联动：默认带上当前地区规则画像；调用方 payload 优先级更高（可覆盖）。
    // scenario 用会话自身场景（回放的历史会话可能与面板默认场景不同），供 harness 续聊懒重建。
    await sendAgentMessage(s.id, content, guarded.onEvent, {
      signal: ac.signal,
      onRunId: (runId) => {
        if (gens.isStreamStale(gen)) return
        currentRunId = runId
        // 用户在 x-run-id 返回前已点停止：拿到 runId 立即补停后台 run
        if (cancelled && s) void stopAgentRun(s.id, runId).catch(() => undefined)
      },
      onCursor: guarded.onCursor,
      payload: {
        ...packageRegionSummary(),
        ...(props.payload ?? {}),
        // B3 选中即问：上下文走 untrusted_external_content（agent 视为不可信外部内容，只引用不执行）
        ...(props.contextPayload ? { untrusted_external_content: props.contextPayload } : {}),
      },
      scenario: s.scenario,
      // 续聊重传页面提示白名单 key：harness 重启后懒重建会话需据此恢复角色与安全基线（服务端不持久化）。
      promptKey: props.promptKey || undefined
    })
  } catch (err) {
    // 用户主动停止（cancelled / AbortError）不是错误：不渲染 ⚠️ 错误段，按 cancelled 终态收尾。
    const aborted = cancelled || (err as Error)?.name === 'AbortError' || ac.signal.aborted
      || gens.isStreamStale(gen)
    if (!aborted && s && await recoverDisconnectedRun(err, s.id, gen, ac.signal)) {
      // 已通过 attach 重连续读到终态。
    } else if (!aborted) {
      await onEvent({ type: 'error', message: err instanceof Error ? err.message : '请求失败' })
    }
  } finally {
    await finalizeStreamAfterRun(cancelled ? 'cancelled' : 'completed', gen)
  }
}

async function decide(seg: ApprovalSeg, action: 'approve' | 'reject') {
  if (!session.value || seg.resolved) return
  seg.resolved = action
  const gen = gens.beginStream()
  streaming.value = true
  sawDone = false
  lastDoneStatus = ''
  cancelled = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  currentRunId = null
  streamCursor = -1
  const ac = new AbortController()
  abort = ac
  const guarded = guardedStreamCallbacks(gen)
  try {
    const sid = session.value.id
    await sendAgentApproval(sid, action, guarded.onEvent, {
      note: seg.note,
      signal: ac.signal,
      onRunId: (runId) => {
        if (gens.isStreamStale(gen)) return
        currentRunId = runId
        if (cancelled) void stopAgentRun(sid, runId).catch(() => undefined)
      },
      onCursor: guarded.onCursor
    })
  } catch (err) {
    const aborted = cancelled || (err as Error)?.name === 'AbortError' || ac.signal.aborted
      || gens.isStreamStale(gen)
    if (!aborted && session.value && await recoverDisconnectedRun(err, session.value.id, gen, ac.signal)) {
      // 已通过 attach 重连续读到终态。
    } else if (!aborted) {
      await onEvent({ type: 'error', message: err instanceof Error ? err.message : '请求失败' })
    }
  } finally {
    await finalizeStreamAfterRun(cancelled ? 'cancelled' : 'completed', gen)
  }
}

function stop() {
  cancelled = true // 标记用户主动中止 → send() catch 不渲染成 ⚠️ 错误段
  const sid = session.value?.id
  const rid = currentRunId
  if (sid && rid) {
    void stopAgentRun(sid, rid).catch((err) => {
      console.warn('[agent-chat] 停止后台 run 失败', err)
    })
  } else if (sid) {
    // 竞态窗口：POST 已发出但 x-run-id 未返回时点停止，abort 只断本地读取，
    // 后台 run 不随连接断开取消。onRunId 回调见 cancelled 会立即补停（主路径）；
    // 这里延迟查 active-run 兜底（POST 被 abort 砍在 headers 前时 onRunId 不触发）。
    window.setTimeout(() => {
      if (!cancelled) return // 用户已开启新一轮，别误杀新 run
      void getActiveRun(sid)
        .then((run) => (run && run.status === 'running' ? stopAgentRun(sid, run.run_id) : undefined))
        .catch(() => undefined)
    }, 600)
  }
  abort?.abort()
  streaming.value = false
}

function detachReaderForSwitch() {
  // 立即作废当前流世代：旧流的 onEvent/onCursor/onRunId/finalize 从此全部 stale 跳过，
  // 不必等旧读者退出（abort 后自然结束），共享 UI 状态在此直接复位、新流入口再全量重置。
  gens.invalidateStream()
  abort?.abort()
  streaming.value = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  currentRunId = null
}

async function attachRunById(sessionId: string, runId: string, initialCursor = -1): Promise<boolean> {
  ensureAttachPlaceholder()
  const gen = gens.beginStream()
  streaming.value = true
  sawDone = false
  lastDoneStatus = ''
  cancelled = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  currentRunId = runId
  streamCursor = initialCursor
  const ac = new AbortController()
  abort = ac
  scrollBottom(true)
  let ok = true
  try {
    await attachRunWithReconnect(sessionId, runId, initialCursor, gen, ac.signal)
  } catch (err) {
    ok = false
    const aborted = cancelled || isAbortLike(err) || ac.signal.aborted || gens.isStreamStale(gen)
    if (!aborted) await onEvent({ type: 'error', message: err instanceof Error ? err.message : '请求失败' })
  } finally {
    await finalizeStreamAfterRun(cancelled ? 'cancelled' : 'completed', gen)
  }
  return ok
}

// 供全局 AI 中心「运行中会话」面板切换查看后台 run。
async function attachRun(sessionId: string, runId?: string): Promise<boolean> {
  if (!sessionId) return false
  if (agentOffline.value) await checkHealth()
  if (agentOffline.value) {
    ElMessage.warning('智能体服务未就绪，无法切换运行中会话')
    return false
  }
  // 流世代作废已下沉到 loadHistory 内部，不再重复
  const loaded = await loadHistory(sessionId, { fromClick: true, allowEmpty: true })
  if (!loaded) {
    // live-token-only 会话（历史绑定失败/首轮未落库）不在 Node 历史库：
    // transcript 不可得不应阻断 attach，降级用 live session 信息建最小本地状态续看。
    const info = await getAgentSession(sessionId).catch(() => null)
    if (!info) return false
    abort?.abort()
    messages.value = []
    todos.value = []
    session.value = { id: info.id, scenario: info.scenario, title: info.title ?? '', status: 'idle' }
  }
  return runId ? attachRunById(sessionId, runId, -1) : attachActiveRunIfAny(-1)
}

// 供外部（AgentSidekick chips 等）直接发问
function ask(question: string) {
  if (streaming.value || !question.trim()) return false
  input.value = question.trim()
  void send()
  return true
}
defineExpose({ ask, newConversation, loadHistory, attachRun })

// 供 artifact 内的表单(FormArtifact)把填写结果作为新消息回传给智能体
provide(ARTIFACT_CONTEXT, { submit: (text: string) => ask(text), sessionId: () => session.value?.id })

// 斜杠指令（/help、/clear、技能… 输入 / 唤起菜单）
function makeContext(args: string): CommandContext {
  return {
    host: 'agent',
    args,
    navigate: (path) => { void router.push(path) },
    postSystemNote: (text) => {
      messages.value.push({
        role: 'assistant',
        segs: [{ kind: 'text', chunks: [text], done: true, blocks: parseArtifactBlocks(text) }]
      })
      scrollBottom()
    },
    setInput: (text) => { input.value = text },
    // 轻量 chat 技能（target='chat'，如 /概念解释）：chat 会话内直接发送；落在专属
    // 会话（申报/复盘）则移交回 chat 会话，避免被后端当作申报追问 / 复盘角色处理
    // （审批挂起时还会被拒），与下方 openWorkbench 的场景逃逸一致（修复 PR #46 review）
    sendToChat: (text) => {
      if (props.scenario === 'chat') { ask(text); return }
      void router.push({ path: '/ai-agent', query: { q: text } })
    },
    // 仅当技能场景与当前会话场景一致时才同会话发送（保持上下文）；否则一律按目标
    // 场景移交工作台并 remount 出对应会话。这覆盖全部错配：专属技能落在别的会话、
    // 跨专属场景，以及 chat 技能落在专属会话，后端会把后者当申报追问 / 复盘角色处理
    // 而丢失通用 supervisor 的工具路由，故需移交回 chat 会话（修复 PR #46 review）。
    openWorkbench: (q, scenario) => {
      const target: AgentScenario = scenario ?? 'chat'
      if (target === props.scenario) {
        if (q) ask(q)
        return
      }
      const query: Record<string, string> = {}
      if (target !== 'chat') query.scenario = target // chat 不写 query，落默认 chat 工作台
      if (q) query.q = q
      void router.push({ path: '/ai-agent', query })
    },
    clearSession: () => {
      newConversation()
    }
  }
}
const { menuOpen, menuItems, activeIndex, onKeydown: onSlashKeydown, trySlash, pushHistory, selectItem } =
  useSlashInput({ input, host: 'agent', makeContext })

function onInputKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return // 中文输入法组词中放行
  if (onSlashKeydown(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault() // Enter 发送；Shift+Enter 默认换行（不拦截）
    void send()
  }
}

// 组件卸载时中止进行中的流式请求，避免 SSE 在后台继续跑（资源泄漏/对已卸载组件回调）
onBeforeUnmount(() => {
  abort?.abort()
  stopStreamMeter()
  if (navTimer) { clearTimeout(navTimer); navTimer = undefined }
})

// 探活：挂载即确认智能体后端在线；离线则显示「未就绪」提示且不发首条（阶段 A G2）。
// 集中在共享面板处理，覆盖工作台/4 Copilot/复盘中心/Sidekick/申报台等全部 8 个接入点。
const { offline: agentOffline, check: checkHealth } = useAgentHealth()

// 当前主对话模型（主仓 #2658）：取不到就不显示，不猜——这个标签的价值全在可信。
const { model: currentModel } = useCurrentModel()

// 挂载恢复优先级：①侧栏指定回放会话 → attach 在途 run / 待审批态 → ②首条自动发送（仅在线）
// → ③刷新恢复本接入点上次会话 → attach 在途 run / 待审批态。
onMounted(async () => {
  // resume/刷新恢复读 Node 历史（/api/agent-history），不依赖 agent-backend 在线；探活仅用于门控首条。
  await checkHealth()
  if (props.resumeSessionId) {
    if (await loadHistory(props.resumeSessionId, { allowEmpty: true })) {
      await attachActiveRunIfAny(-1)
    }
  } else {
    // 首条自动发送依赖 agent-backend SSE：离线时跳过（由模板「未就绪」提示引导），避免首条即报错。
    if (props.initialQuestion.trim() && !agentOffline.value) {
      input.value = props.initialQuestion.trim()
      await send()
    } else if (props.persistHistory) {
      // 刷新/切页恢复：启用历史的面板（默认全部）按本接入点 localStorage 指针恢复上次会话；
      // key 已按 historyKey 隔离，不同接入点互不串台（#498）。
      const saved = readLocalSession()
      if (saved && await loadHistory(saved, { allowEmpty: true })) {
        const attached = await attachActiveRunIfAny(-1)
        if (!attached && !messages.value.length && !session.value?.pending_approval) {
          clearLocalSession()
          session.value = null
        }
      }
    }
  }
  // 宿主在此之前触发的快捷任务必须等历史恢复完成，避免 loadHistory 中止/覆盖新请求。
  emit('ready')
})

const TODO_ICON: Record<Todo['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●'
}

// 审批卡摘要：后端有三种审批载荷，分别按结构提取要点（见 service.py _update_events）。
// ① declaration_prep 图级审批：{type:'declaration_approval', target_date, draft:{points, strategy_note}}
// ② 工作室自定义图审批：{type:'studio_approval', label, question, summary}
// ③ HITL 中间件（对外动作工具）：{action_requests:[{name, arguments}], review_configs:[...]}
// ， langchain 1.x HumanInTheLoopMiddleware 的 interrupt 值。此前仅认 ①，
//    HITL 与工作室审批都落到无信息的「工具执行审批」，用户对外动作时审批盲签。
function clip(v: unknown, n = 200): string {
  const s = String(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}
function approvalBrief(payload: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const type = typeof payload.type === 'string' ? payload.type : ''

  if (type === 'declaration_approval' || payload.target_date || payload.draft) {
    const draft = (payload.draft ?? {}) as Record<string, unknown>
    if (payload.target_date) rows.push({ label: '目标日', value: String(payload.target_date) })
    if (draft.points) rows.push({ label: '曲线点数', value: String(draft.points) })
    if (draft.strategy_note) rows.push({ label: '策略说明', value: clip(draft.strategy_note) })
  }

  // 效果桥的业务写（#1909：归档报告 / 沉淀长期记忆）。不走下面的通用 action_requests
  // 分支，是因为那条会把整篇报告正文当参数 JSON 铺在卡上，审批人看一坨几千字的 JSON
  // 等于没有审批。这里只给「往哪写、写什么、多大」三件事。
  if (type === 'effect_approval') {
    if (payload.label) rows.push({ label: '事项', value: String(payload.label) })
    if (payload.target) rows.push({ label: '写入', value: String(payload.target) })
    if (payload.summary) rows.push({ label: '内容', value: clip(payload.summary) })
    if (payload.detail) rows.push({ label: '说明', value: clip(payload.detail) })
  }

  if (type === 'studio_approval' || payload.question) {
    if (payload.label) rows.push({ label: '节点', value: String(payload.label) })
    if (payload.question) rows.push({ label: '审批问题', value: clip(payload.question) })
    if (payload.summary) rows.push({ label: '上下文', value: clip(payload.summary) })
  }

  const actions = payload.action_requests
  if (Array.isArray(actions)) {
    for (const a of actions as Record<string, unknown>[]) {
      const name = String(a.name ?? a.action ?? '工具')
      rows.push({ label: '待执行', value: toolLabel(name) })
      const args = (a.arguments ?? a.args) as Record<string, unknown> | undefined
      if (args && typeof args === 'object' && Object.keys(args).length) {
        rows.push({ label: '参数', value: clip(JSON.stringify(args)) })
      }
    }
  }

  if (!rows.length) rows.push({ label: '事项', value: '工具执行审批' })
  return rows
}
</script>

<template>
  <div class="agent-panel">
    <!-- 当前模型（主仓 #2658）：auto 档下模型随自建端点可用性自动切换，不显示的话
         「端点断了、答案照常出来」无从察觉。取不到就不显示，不猜。 -->
    <div v-if="currentModel" class="model-bar" :class="{ 'self-hosted': currentModel.selfHosted }">
      <span class="model-dot" aria-hidden="true"></span>
      <span class="model-label">{{ currentModel.label }}</span>
      <span class="model-name">{{ currentModel.model }}</span>
      <span v-if="currentModel.mode === 'auto'" class="model-mode" title="模型按端点可用性自动切换">自动</span>
    </div>

    <!-- 任务计划（TodoListMiddleware 状态） -->
    <div v-if="todos.length" class="plan-bar">
      <span class="plan-title">任务计划</span>
      <span
        v-for="(t, i) in todos"
        :key="i"
        class="plan-item"
        :class="t.status"
      >{{ TODO_ICON[t.status] }} {{ t.content }}</span>
    </div>

    <div v-if="reconnecting" class="reconnect-bar">
      <Loader2 :size="13" class="spin" />
      <span>连接中断，重连中…</span>
      <span v-if="reconnectAttempt > 1" class="reconnect-count">第 {{ reconnectAttempt }} 次</span>
    </div>

    <div ref="bodyRef" class="panel-body" @scroll="onBodyScroll">
      <div v-if="agentOffline" class="empty-hint">
        <div class="empty-logo offline"><Bot :size="28" /></div>
        <p class="empty-title">智能体服务未就绪</p>
        <p class="sub">请启动智能体后端（npm run dev:agent-api）后重试</p>
        <button class="empty-retry" @click="checkHealth()">重试连接</button>
      </div>
      <div v-else-if="!messages.length" class="empty-hint">
        <div class="empty-logo"><Bot :size="28" /></div>
        <p class="empty-title">电力现货交易智能体</p>
        <p class="sub">行情分析 · 申报策略 · 披露检索 · 复盘报告</p>
        <div class="empty-suggestions">
          <button v-for="s in SUGGESTIONS" :key="s" class="suggest-chip" @click="ask(s)">{{ s }}</button>
        </div>
      </div>

      <div v-for="(msg, mi) in messages" :key="mi" class="msg" :class="msg.role">
        <div class="avatar">
          <User v-if="msg.role === 'user'" :size="16" />
          <Bot v-else :size="16" />
        </div>
        <div class="bubble">
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">{{ msg.text }}</template>

          <!-- 助手消息：有序段渲染 -->
          <template v-else>
            <template v-for="(seg, si) in msg.segs" :key="si">
              <!-- 文本：已闭合围栏边流边渲染为 artifact，尾部仍在输入的文本逐 token 渐显 -->
              <div v-if="seg.kind === 'text'" class="seg-text">
                <ArtifactRenderer v-if="displayBlocks(seg).length" :blocks="displayBlocks(seg)" />
                <div v-if="!seg.done" class="streaming-text">
                  <!-- 尚无已闭合 artifact 且尾部不是带 label 的数据围栏：整段逐 token 渐显（保留打字机动画）。
                       seg.pending 非空（chart/card/table 等结构化围栏未闭合）时不逐字暴露半截裸 JSON，只走下方骨架。 -->
                  <template v-if="(!seg.liveBlocks || !seg.liveBlocks.length) && !seg.pending">
                    <span v-for="(c, ci) in seg.chunks" :key="ci" class="tok">{{ c }}</span>
                  </template>
                  <!-- 已渲染部分 artifact 且尾部是纯文本（非数据围栏）：尾部原文整体显示（避免与稳定段重复）。 -->
                  <span v-else-if="!seg.pending" class="tok">{{ seg.tail }}</span>
                  <span class="cursor" />
                  <!-- 尾部是未闭合的带 label 数据围栏：只显「正在生成…」骨架，闭合后由稳定段渲染为正式 artifact。 -->
                  <div v-if="seg.pending" class="gen-skeleton">
                    <Loader2 :size="13" class="spin" /> 正在生成{{ seg.pending }}…
                  </div>
                </div>
              </div>

              <!-- 顶层工具组：连续顶层工具归为一组，折叠只显统计，展开逐条看指令 -->
              <div
                v-else-if="seg.kind === 'tool' && !seg.subRole && isToolGroupStart(msg.segs, si)"
                class="tool-group"
                :class="{ error: toolGroupSummary(toolGroupOf(msg.segs, si)).error }"
              >
                <button class="tool-head group-head" @click="seg.groupCollapsed = seg.groupCollapsed === false">
                  <component :is="seg.groupCollapsed === false ? ChevronDown : ChevronRight" :size="13" />
                  <Wrench :size="13" />
                  <span class="tool-name">工具调用</span>
                  <span class="tool-count">
                    {{ toolGroupSummary(toolGroupOf(msg.segs, si)).done }}/{{ toolGroupSummary(toolGroupOf(msg.segs, si)).total }}
                  </span>
                  <span class="tool-current">{{ toolGroupSummary(toolGroupOf(msg.segs, si)).label }}</span>
                  <DataBasisBadge
                    v-if="groupBasisOf(toolGroupOf(msg.segs, si))"
                    :basis="groupBasisOf(toolGroupOf(msg.segs, si))!"
                    class="tool-basis"
                  />
                  <Loader2 v-if="toolGroupSummary(toolGroupOf(msg.segs, si)).running" :size="13" class="spin" />
                  <span v-else-if="toolGroupSummary(toolGroupOf(msg.segs, si)).error" class="tool-err">✗</span>
                  <span v-else class="tool-ok">✓</span>
                </button>
                <div v-if="seg.groupCollapsed === false" class="tool-group-body">
                  <div
                    v-for="(tool, ti) in toolGroupOf(msg.segs, si)"
                    :key="`${si}-${ti}`"
                    class="tool-card"
                    :class="tool.status"
                  >
                    <button class="tool-head" @click="tool.expanded = !tool.expanded">
                      <component :is="tool.expanded ? ChevronDown : ChevronRight" :size="13" />
                      <span class="tool-name">{{ toolLabel(tool.name) }}</span>
                      <DataBasisBadge v-if="tool.basis" :basis="tool.basis" class="tool-basis" />
                      <Loader2 v-if="tool.status === 'running'" :size="13" class="spin" />
                      <span v-else class="tool-ok">✓</span>
                    </button>
                    <div v-if="tool.expanded" class="tool-detail">
                      <div class="tool-row"><b>参数</b><pre class="tool-code">{{ JSON.stringify(tool.args, null, 2) }}</pre></div>
                      <div v-if="tool.summary" class="tool-row"><b>结果</b><pre class="tool-code">{{ tool.summary }}</pre></div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- 组内非首个顶层工具：已并入上方组，跳过 -->
              <template v-else-if="seg.kind === 'tool' && !seg.subRole" />

              <!-- 子智能体内部工具（深度冒泡）：保持单卡缩进形态 -->
              <div v-else-if="seg.kind === 'tool'" class="tool-card subtool" :class="seg.status">
                <button class="tool-head" @click="seg.expanded = !seg.expanded">
                  <component :is="seg.expanded ? ChevronDown : ChevronRight" :size="13" />
                  <Wrench :size="13" />
                  <span class="sub-role">{{ roleLabel(seg.subRole!) }}</span>
                  <span class="tool-name">{{ toolLabel(seg.name) }}</span>
                  <DataBasisBadge v-if="seg.basis" :basis="seg.basis" class="tool-basis" />
                  <Loader2 v-if="seg.status === 'running'" :size="13" class="spin" />
                  <span v-else class="tool-ok">✓</span>
                </button>
                <div v-if="seg.expanded" class="tool-detail">
                  <div class="tool-row"><b>参数</b><pre class="tool-code">{{ JSON.stringify(seg.args, null, 2) }}</pre></div>
                  <div v-if="seg.summary" class="tool-row"><b>结果</b><pre class="tool-code">{{ seg.summary }}</pre></div>
                </div>
              </div>

              <!-- 子智能体分组容器：每智能体唯一容器（默认收起），头显示派发/结果预览，展开后分层 -->
              <div
                v-else-if="seg.kind === 'subagent-group'" class="subagent-group"
                :class="{ error: seg.delegateStatus === 'error' }"
              >
                <button class="sa-head" @click="seg.collapsed = !seg.collapsed">
                  <component :is="seg.collapsed ? ChevronRight : ChevronDown" :size="14" />
                  <span class="sa-role">🔍 {{ roleLabel(seg.role) }}</span>
                  <!-- 任务/结果预览（一眼扫过三路智能体在做什么/得出什么）；过程工具只显示数量 -->
                  <span v-if="delegateArgsPreview(seg.delegateArgs)" class="sa-brief">
                    📤 {{ delegateArgsPreview(seg.delegateArgs) }}
                  </span>
                  <span v-if="delegateResultPreview(seg.delegateSummary)" class="sa-brief sa-brief-result">
                    📥 {{ delegateResultPreview(seg.delegateSummary) }}
                  </span>
                  <!-- 委派结果的数据口径徽标：与普通 tool 段头对称（line ~1182 seg.basis）。
                       子智能体降级到合成演示/真实采集时，分组头需可见标注，否则用户无法区分模拟/真实数据。 -->
                  <DataBasisBadge v-if="seg.delegateBasis" :basis="seg.delegateBasis" class="tool-basis" />
                  <span v-if="seg.tools.length" class="sa-count">{{ seg.tools.length }} 个工具</span>
                  <Loader2
                    v-if="seg.delegateStatus === 'running' || seg.tools.some((t) => t.status === 'running')"
                    :size="13" class="spin"
                  />
                  <span v-else-if="seg.delegateStatus === 'error'" class="sa-err">✗</span>
                  <span v-else-if="seg.delegateStatus === 'done' || seg.tools.length" class="sa-done">✓</span>
                </button>
                <div v-if="!seg.collapsed" class="sa-body">
                  <!-- 1) 派发任务（结论性：用户最关心"派了什么活"）-->
                  <div v-if="seg.delegateArgs" class="delegate-row">
                    <button class="tool-head" @click="seg.delegateExpanded = !seg.delegateExpanded">
                      <component :is="seg.delegateExpanded ? ChevronDown : ChevronRight" :size="13" />
                      <Wrench :size="13" />
                      <span class="tool-name">📤 派发任务</span>
                      <span
                        class="tool-ok"
                        :class="{ running: seg.delegateStatus === 'running', err: seg.delegateStatus === 'error' }"
                      >
                        {{ seg.delegateStatus === 'running' ? '进行中' : seg.delegateStatus === 'error' ? '✗ 失败' : '✓' }}
                      </span>
                    </button>
                    <div v-if="seg.delegateExpanded" class="tool-detail">
                      <pre class="tool-code">{{ JSON.stringify(seg.delegateArgs, null, 2) }}</pre>
                    </div>
                  </div>
                  <!-- 2) 最终结果（结论性：用户最关心"得出了什么"），多行可见 -->
                  <div v-if="seg.delegateSummary" class="delegate-row result-row">
                    <button class="tool-head" @click="seg.resultExpanded = !seg.resultExpanded">
                      <component :is="seg.resultExpanded ? ChevronDown : ChevronRight" :size="13" />
                      <Wrench :size="13" />
                      <span class="tool-name">📥 最终结果</span>
                    </button>
                    <pre v-if="seg.resultExpanded" class="tool-code result-code">{{ seg.delegateSummary }}</pre>
                    <pre v-else class="tool-code result-code result-collapsed">{{ seg.delegateSummary }}</pre>
                  </div>
                  <!-- 3) 中间工具列表（过程性：默认收起，弱化样式）-->
                  <div v-if="seg.tools.length" class="tools-row">
                    <button class="tool-head tools-toggle" @click="seg.toolsExpanded = !seg.toolsExpanded">
                      <component :is="seg.toolsExpanded ? ChevronDown : ChevronRight" :size="13" />
                      <Wrench :size="13" />
                      <span class="tool-name">🔧 中间工具 · {{ seg.tools.length }} 步</span>
                    </button>
                    <div v-if="seg.toolsExpanded">
                      <div v-for="(tool, ti) in seg.tools" :key="ti" class="tool-card subtool" :class="tool.status">
                        <button class="tool-head" @click="tool.expanded = !tool.expanded">
                          <component :is="tool.expanded ? ChevronDown : ChevronRight" :size="13" />
                          <Wrench :size="13" />
                          <span class="tool-name">{{ toolLabel(tool.name) }}</span>
                          <DataBasisBadge v-if="tool.basis" :basis="tool.basis" class="tool-basis" />
                          <Loader2 v-if="tool.status === 'running'" :size="13" class="spin" />
                          <span v-else class="tool-ok">✓</span>
                        </button>
                        <div v-if="tool.expanded" class="tool-detail">
                          <div class="tool-row"><b>参数</b><pre class="tool-code">{{ JSON.stringify(tool.args, null, 2) }}</pre></div>
                          <div v-if="tool.summary" class="tool-row"><b>结果</b><pre class="tool-code">{{ tool.summary }}</pre></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 图表 -->
              <div v-else-if="seg.kind === 'chart'" class="chart-seg">
                <ChartArtifact v-if="seg.option" :option="seg.option" :title="seg.title" />
                <div v-else class="chart-loading"><Loader2 :size="14" class="spin" /> 加载图表…</div>
              </div>

              <!-- 契约图表（AnalysisChartSpec #59/#60） -->
              <div v-else-if="seg.kind === 'analysis-chart'" class="chart-seg">
                <AnalysisChartArtifact :block="{ kind: 'analysis-chart', spec: seg.spec }" />
              </div>

              <!-- 契约仪表盘（AnalysisDashboard #38/#60） -->
              <div v-else-if="seg.kind === 'analysis-dashboard'" class="chart-seg">
                <AnalysisDashboardArtifact :block="{ kind: 'analysis-dashboard', dashboard: seg.dashboard }" />
              </div>

              <!-- 审批卡 -->
              <div v-else-if="seg.kind === 'approval'" class="approval-card">
                <div class="approval-title">⚠ 待人工审批</div>
                <div v-for="row in approvalBrief(seg.payload)" :key="row.label" class="approval-row">
                  <span class="k">{{ row.label }}</span><span class="v">{{ row.value }}</span>
                </div>
                <template v-if="!seg.resolved && !seg.readonly">
                  <input v-model="seg.note" class="approval-note" placeholder="审批备注（可选）" />
                  <div class="approval-actions">
                    <button class="btn approve" @click="decide(seg, 'approve')">批准</button>
                    <button class="btn reject" @click="decide(seg, 'reject')">驳回</button>
                  </div>
                </template>
                <div v-else class="approval-resolved">
                  {{ seg.resolved === 'approve' ? '✓ 已批准' : seg.resolved === 'reject' ? '✗ 已驳回' : '— 历史审批（不可操作）' }}
                </div>
              </div>
            </template>

            <!-- 动态「在工作」指示：流式期间常驻，阶段(思考/调工具/生成) + 计时 + token 活动 -->
            <div v-if="streaming && mi === messages.length - 1" class="stream-meter">
              <span class="sm-dot" :class="streamPhase" />
              <span class="shimmer sm-phase">{{ PHASE_LABEL[streamPhase] }}</span>
              <span class="sm-stat">{{ (elapsedMs / 1000).toFixed(1) }}s</span>
              <span v-if="tokenCount" class="sm-stat">· {{ tokenCount }} tok</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <Transition name="jump-fade">
      <button v-if="showJump" class="jump-bottom" title="回到底部" @click="jumpToBottom">
        <ChevronDown :size="15" /> 回到底部
      </button>
    </Transition>

    <div class="panel-input">
      <SlashCommandMenu
        v-if="menuOpen"
        :items="menuItems"
        :active-index="activeIndex"
        @select="selectItem"
        @hover="activeIndex = $event"
      />
      <textarea
        ref="inputRef"
        v-model="input"
        :disabled="streaming"
        maxlength="20000"
        rows="1"
        placeholder="问行情、要策略、查披露…（输入 / 用指令，Enter 发送，Shift+Enter 换行）"
        @input="autoGrow"
        @keydown="onInputKeydown"
      />
      <button v-if="streaming" class="send-btn stop" title="停止" @click="stop"><Square :size="15" /></button>
      <button v-else class="send-btn" :disabled="!canSend" title="发送" @click="send"><Send :size="15" /></button>
    </div>
  </div>
</template>

<style scoped>
.agent-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel-bg, #fff);
  border-radius: 12px;
  overflow: hidden;
}

/* 任务计划条 */
.model-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; font-size: var(--font-xs);
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}
.model-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--el-text-color-placeholder);
}
/* 自建端点是演示时最想让人一眼看见的状态，故给它唯一的高亮 */
.model-bar.self-hosted { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.model-bar.self-hosted .model-dot { background: var(--el-color-success); }
.model-name { font-family: var(--el-font-family-mono, monospace); opacity: 0.75; }
.model-mode {
  margin-left: auto; padding: 0 6px; border-radius: 8px;
  background: var(--el-fill-color); color: var(--el-text-color-secondary);
}

.plan-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line-soft);
  font-size: var(--font-sm);
}
.plan-title { font-weight: 600; opacity: 0.7; }
.plan-item { opacity: 0.55; }
.plan-item.in_progress { opacity: 1; color: var(--primary); }
.plan-item.completed { opacity: 0.8; text-decoration: line-through; }
.reconnect-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--warning-tint);
  color: var(--warning);
  font-size: var(--font-12-5);
  font-weight: 600;
}
.reconnect-count { opacity: 0.72; font-weight: 500; }

.panel-body { flex: 1; overflow-y: auto; padding: 16px; }

/* 空态：品牌徽标 + 标题 + 引导（在线给示例问题、离线给重试） */
.empty-hint {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; padding: 64px 20px 0; gap: 4px;
}
.empty-logo {
  display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 10px;
  border-radius: 16px; color: var(--primary);
  background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.empty-logo.offline { color: var(--muted); background: var(--surface-hover); border-color: var(--line); }
.empty-title { margin: 0; font-size: var(--font-15); font-weight: 650; color: var(--text); }
.empty-hint .sub { margin: 0; font-size: var(--font-12-5); color: var(--muted); }
.empty-retry {
  margin-top: 14px; padding: 7px 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--primary); background: transparent; color: var(--primary);
  font-size: var(--font-md); font-weight: 600; cursor: pointer; transition: background 0.15s ease;
}
.empty-retry:hover { background: var(--primary-tint); }
.empty-suggestions {
  display: flex; flex-direction: column; gap: 8px; margin-top: 22px; width: 100%; max-width: 280px;
}
.suggest-chip {
  padding: 9px 14px; border-radius: var(--radius-sm); text-align: left;
  border: 1px solid var(--line); background: var(--panel-sub); color: var(--text-body);
  font-size: var(--font-md); cursor: pointer; transition: all 0.15s ease;
}
.suggest-chip:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-tint); }
.suggest-chip:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.msg { display: flex; gap: 8px; margin-bottom: 14px; }
.msg.user { flex-direction: row-reverse; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-hover); flex-shrink: 0;
}
.msg.user .avatar { background: var(--primary); color: #fff; }
.bubble {
  max-width: 78%; padding: 10px 14px; border-radius: 12px;
  font-size: var(--font-lg); line-height: 1.7;
  background: var(--panel-sub);
}
.msg.user .bubble { background: var(--primary); color: #fff; }

/* 渐变生成：每个 token 块淡入上浮 */
/* 顶层工具组：折叠只显统计，展开逐条（形态复刻 .sa-head） */
.tool-group { margin: 6px 0; border: 1px solid var(--line-faint); border-radius: 8px; overflow: hidden; }
.tool-group.error { border-color: #ef4444; }
.group-head { width: 100%; }
.tool-count {
  padding: 1px 7px; font-size: var(--font-11-5); border-radius: 999px;
  background: var(--panel-sub); color: var(--muted); font-variant-numeric: tabular-nums;
}
.tool-current { font-size: var(--font-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-err { color: #b91c1c; }
.tool-group-body { padding: 0 8px 6px; }

.streaming-text { white-space: pre-wrap; word-break: break-word; }
.tok {
  display: inline;
  animation: tok-in 0.4s ease-out both;
}
@keyframes tok-in {
  from { opacity: 0; transform: translateY(2px); filter: blur(2px); }
  to { opacity: 1; transform: none; filter: none; }
}
.cursor {
  display: inline-block; width: 7px; height: 16px; margin-left: 2px;
  vertical-align: -2px; border-radius: 2px;
  background: currentColor; opacity: 0.7;
  animation: blink 0.9s steps(2) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.thinking { font-size: var(--font-md); }
/* 动态「在工作」指示条：脉冲点 + 阶段(流光) + 计时秒数 + token 活动量 */
.stream-meter { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: var(--font-sm); color: var(--muted); }
.sm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--primary); animation: sm-pulse 1.1s ease-in-out infinite; }
.sm-dot.tool { background: var(--warning); }
.sm-dot.generating { background: var(--success); }
@keyframes sm-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.65); } }
.sm-phase { font-weight: 600; }
.sm-stat { font-variant-numeric: tabular-nums; opacity: 0.8; }
.shimmer {
  background: linear-gradient(90deg, var(--muted) 25%, var(--text) 50%, var(--muted) 75%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer 1.6s linear infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }

/* markdown / 代码 / 图表 / HTML / 卡片样式已迁至 artifacts/ 各组件 */

/* 工具卡 */
.tool-card {
  margin: 6px 0; border: 1px solid var(--line);
  border-radius: 8px; font-size: var(--font-12-5); background: var(--surface-hover);
  animation: tok-in 0.3s ease-out both;
}
.tool-card.running { border-color: var(--primary); }
/* 子智能体内部工具：缩进+虚线，作为所属子智能体的展开细节 */
.tool-card.subtool { margin-left: 16px; border-style: dashed; background: transparent; }
.sub-role {
  font-size: var(--font-xs); padding: 1px 6px; border-radius: 4px; font-weight: 600;
  color: var(--primary); background: var(--primary-tint);
}
.tool-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 10px; background: none; border: none; cursor: pointer;
  font-size: var(--font-12-5); color: inherit;
}
.tool-name { font-weight: 600; }
.tool-basis { margin-left: 6px; transform: scale(0.92); }
.tool-ok { color: var(--success); margin-left: auto; }
.tool-head .spin { margin-left: auto; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.tool-detail { padding: 0 10px 8px 28px; }
.tool-row { display: flex; gap: 6px; margin-top: 4px; align-items: flex-start; }
.tool-row b { flex-shrink: 0; opacity: 0.6; font-weight: 500; padding-top: 3px; }
.tool-code {
  flex: 1; min-width: 0; margin: 0; max-height: 200px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  background: var(--panel-sub); border: 1px solid var(--line-faint);
  border-radius: 6px; padding: 6px 8px; font-size: var(--font-11-5); line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* 子智能体分组容器：每智能体唯一容器，默认收起；头显示派发/结果预览，展开后分三层（派发/结果/工具） */
.subagent-group {
  margin: 6px 0; border: 1px solid var(--line, rgba(125, 125, 125, 0.22));
  border-radius: 8px; background: var(--panel-sub, rgba(125, 125, 125, 0.04));
  overflow: hidden; animation: tok-in 0.3s ease-out both;
}
.sa-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; background: none; border: none; cursor: pointer;
  font-size: var(--font-12-5); color: var(--text, inherit);
}
.sa-role { font-weight: 600; color: var(--primary); flex-shrink: 0; }
/* 容器头预览：派发任务 / 最终结果摘要（一眼扫过三路智能体在做什么/得出什么） */
.sa-brief {
  font-size: var(--font-11-5); color: var(--muted); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1 1 auto; min-width: 0;
}
/* 结果预览用主色微强调（结论比过程更重要） */
.sa-brief-result { color: var(--primary); opacity: 0.85; }
.sa-count { font-size: var(--font-11-5); color: var(--muted); flex-shrink: 0; }
.sa-head .spin { margin-left: auto; flex-shrink: 0; }
.sa-done { margin-left: auto; color: var(--success); flex-shrink: 0; }
.sa-err { margin-left: auto; color: var(--danger, #f56c6c); font-weight: 700; flex-shrink: 0; }
/* 子智能体执行失败：容器整体显红边框，关键角色（风控哨兵等）错误一眼可见 */
.subagent-group.error {
  border-color: var(--danger, #f56c6c);
  background: rgba(245, 108, 108, 0.05);
}
.subagent-group.error .sa-role { color: var(--danger, #f56c6c); }
.sa-body { padding: 2px 8px 6px; }

/* 派发任务行：结论性信息，置顶 */
.delegate-row {
  margin: 4px 0 2px; padding: 2px 6px;
  border-left: 2px solid var(--primary); background: var(--primary-tint, rgba(64, 158, 255, 0.08));
  border-radius: 0 4px 4px 0;
}
/* 最终结果行：结论性信息，多行可见（折叠态限高 2 行） */
.result-row {
  border-left-color: var(--success, #67c23a);
  background: rgba(103, 194, 58, 0.05);
}
.delegate-row .tool-name { color: var(--primary); font-weight: 600; }
.result-row .tool-name { color: var(--success, #67c23a); font-weight: 600; }
.result-code {
  margin: 4px 0 0; font-size: var(--font-sm); line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.result-collapsed {
  max-height: 3.2em; overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
.tool-ok.running { color: var(--muted); font-size: var(--font-xs); }
.tool-ok.err { color: var(--danger, #f56c6c); font-size: var(--font-xs); font-weight: 600; }

/* 中间工具列表区：过程性信息，弱化样式（默认收起，仅在展开后点开） */
.tools-row { margin-top: 4px; }
.tools-toggle .tool-name { color: var(--muted); font-weight: 500; }
.tools-toggle { opacity: 0.75; }
.tools-toggle:hover { opacity: 1; }
.sa-body .tool-card.subtool { margin-left: 8px; }

/* 图表段（内联 artifact，外框由 ChartArtifact 提供） */
.chart-seg { margin: 2px 0; }
.chart-loading { display: flex; gap: 6px; align-items: center; font-size: var(--font-sm); opacity: 0.6; padding: 8px 0; }

/* 流式生成中骨架（未闭合 artifact 围栏提示） */
.gen-skeleton {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding: 8px 12px;
  border: 1px dashed var(--line); border-radius: 8px;
  font-size: var(--font-12-5); opacity: 0.7;
}

/* 审批卡 */
.approval-card {
  margin: 8px 0; border: 1.5px solid var(--warning); border-radius: 10px;
  padding: 10px 12px; background: var(--warning-tint);
  animation: tok-in 0.4s ease-out both; font-size: var(--font-md);
}
.approval-title { font-weight: 700; color: var(--warning); margin-bottom: 6px; }
.approval-row { display: flex; gap: 8px; margin: 2px 0; }
.approval-row .k { opacity: 0.6; flex-shrink: 0; }
.approval-note {
  width: 100%; margin-top: 8px; padding: 5px 8px; font-size: var(--font-12-5);
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--panel); color: var(--text);
}
.approval-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn {
  padding: 5px 16px; border-radius: var(--radius-sm); border: none; cursor: pointer;
  font-size: var(--font-md); font-weight: 600;
}
.btn.approve { background: var(--success); color: #fff; }
.btn.reject { background: var(--surface-hover); color: var(--text); }
.approval-resolved { margin-top: 8px; font-weight: 600; opacity: 0.75; }

/* 输入区 */
.panel-input {
  position: relative;
  display: flex; gap: 8px; padding: 12px 14px; align-items: flex-end;
  border-top: 1px solid var(--line-soft);
}
.panel-input textarea {
  flex: 1; padding: 9px 12px; font-size: var(--font-lg); line-height: 1.5;
  border: 1px solid var(--line); border-radius: 10px; outline: none;
  background: var(--panel); color: var(--text);
  resize: none; max-height: 160px; overflow-y: auto;
  font-family: inherit;
}
.panel-input textarea::placeholder { color: var(--el-text-color-placeholder, var(--muted)); }
.panel-input textarea:focus { border-color: var(--primary); }
.panel-input textarea:disabled { opacity: 0.55; cursor: not-allowed; }
.send-btn {
  flex-shrink: 0;
  width: 38px; height: 38px; border: none; border-radius: 10px; cursor: pointer;
  background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: filter 0.15s ease;
}
.send-btn:hover:not(:disabled) { filter: brightness(1.08); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop { background: var(--danger); }

/* 回到底部浮钮（智能滚动：用户上滚离底时出现） */
.jump-bottom {
  position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%);
  z-index: 2; display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--text-body);
  font-size: var(--font-12-5); box-shadow: var(--shadow);
}
.jump-bottom:hover { border-color: var(--primary); color: var(--primary); }
.jump-fade-enter-active, .jump-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.jump-fade-enter-from, .jump-fade-leave-to { opacity: 0; transform: translate(-50%, 6px); }
</style>
