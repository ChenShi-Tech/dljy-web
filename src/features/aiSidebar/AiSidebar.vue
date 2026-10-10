<script setup lang="ts">
// 全局 AI 侧边栏：智能体工作台的简化界面（只保留对话），也是业务页「解读本页」「选中即问」的宿主。
// 业务页不直接引用本组件，统一经 `@/features/aiSidebar` 的 useAiSidebar / defineAiPage 接入。
//
// 会话模型（统一 AI 侧边栏 SS-01~07）：
// - 侧边栏自持「当前会话记录」（useAiSidebar.state.session），刷新后据此恢复；
// - 页面发来的提问按 sessionPolicy 决定续聊还是新开；输入框直接提问续聊当前会话；
// - 切换会话（新建/历史/运行中/新开）一律 switchSession → mountKey 自增 → 重挂内核，防串流；
// - 关闭侧边栏只隐藏（v-show），不中断进行中的回复。
//
// **原「导航助手」模式已于 2026-08-26 下架**（前端直连大模型 Key 做页面推荐，与统一工作台
// /ai-agent 能力重叠，且不经 /agent-api、不入审计、不受工具审批约束）。完整旧实现存
// `src/attic/ai-navigator-panel/AiAssistant.legacy.vue`，含恢复步骤，见该目录 README。
import { ref, nextTick, watch, computed, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Sparkles, Settings, X, Square, Radio, RefreshCw, PlayCircle, Loader2, ChevronDown, MessageSquarePlus, Maximize2, MapPin
} from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '@/components/agent/AgentHistorySidebar.vue'
import MorningBriefRail from '@/components/agent/workbench/MorningBriefRail.vue'
import StrategicQaGaps from '@/components/agent/workbench/StrategicQaGaps.vue'
import { trustWatermark } from '@/services/data/trustGate'
import { historySourceLabel } from '@/components/agent/historySources'
import { listRuns, stopAgentRun, type AgentRunSummary, type AgentScenario } from '@/services/agent/agentClient'
import { entryForSession, findEntry } from '@/services/agent/workbenchEntries'
import { fetchPiSessionMeta } from '@/services/agent/piPocClient'
import { currentRegion } from '@/services/region/regionContext'
import { currentCompany } from '@/services/company/companyContext'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'
import { useAiSidebar, takeSliceFor, restoreSliceFor, switchSession, adoptSessionId, bindUser, refineSessionEntry, BLANK_SESSION } from './useAiSidebar'
import { activeAiPage, resolveQuestion, type AiPagePreset } from './pageRegistry'
import { buildPageContext, composeMessageContext } from './pageContext'
import { decideSession } from './sessionPolicy'
import { createExpertCommands } from './expertCommands'

const sidebar = useAiSidebar()
const { state } = sidebar
// 会话记录按登录用户隔离：挂载即绑定当前用户（登出再登录时 AppLayout 重挂，这里随之重新绑定）
bindUser(getCurrentUser()?.username ?? '')
const ACTIVE_RUNS_POLL_MS = 5000
const router = useRouter()
const route = useRoute()
const activePage = activeAiPage()

// ── 当前会话 ──
const record = computed(() => state.session ?? BLANK_SESSION)
const kernelScenario = computed(() => record.value.scenario as AgentScenario)
const headerTitle = computed(() => record.value.title || (record.value.sessionId ? '历史对话' : '新对话'))
// 业务上下文（地区）：与原「解读本页」链路一致随每轮下发
const regionPayload = computed(() => ({ region_id: currentRegion.value.id, region_name: currentRegion.value.name }))
// 专家命令与「在工作台打开」只对有工作台访问权限的角色开放（SH-02：权限口径保持现状）
const canUseWorkbench = computed(() => canAccessPath('/ai-agent', getCurrentUser()))

// 页面背景：每轮都附带「用户正在看什么」；数据切片只随发起它的那一轮（见 pageContext.ts）
const pageContext = computed(() =>
  buildPageContext({
    routePath: route.path,
    routeTitle: typeof route.meta?.title === 'string' ? route.meta.title : null,
    pageLabel: activePage.value?.label ?? null,
    region: currentRegion.value,
    company: currentCompany.value
  })
)
function contextFor(question: string) {
  return composeMessageContext(pageContext.value, takeSliceFor(question))
}
const presets = computed<AiPagePreset[]>(() => activePage.value?.presets ?? [])

// 专家命令：由工作台入口声明生成；无工作台权限时隐藏（手动输入提示无权）
const expertCommands = computed(() =>
  createExpertCommands({
    canUse: canUseWorkbench.value,
    regionName: () => currentRegion.value.name,
    launch: (launch) => sidebar.startExpert(launch)
  })
)
// 会话前置卡片（不入库）：晨报预检卡按命令给的目标日；申报前体检结论加不可移除的合成数据水印
const currentEntry = computed(() => findEntry(record.value.entryKey))
const briefDate = computed(() => record.value.meta?.date ?? '')
const conclusionWatermark = computed(() =>
  currentEntry.value?.watermarkBasis ? trustWatermark(currentEntry.value.watermarkBasis) : ''
)
type BriefRailRef = { ensureLoaded: () => Promise<void> }
const briefRailRef = ref<BriefRailRef | null>(null)
function askPreset(p: AiPagePreset) {
  sidebar.ask(resolveQuestion(p.question), { context: p.context ?? null, label: p.label })
}

type AgentPanelRef = {
  ask: (q: string) => boolean
  newConversation: () => void
}
const agentPanelRef = ref<AgentPanelRef | null>(null)
const agentEverOpened = ref(false)
const busy = ref(false)
watch(() => state.open, (open) => { if (open) agentEverOpened.value = true }, { immediate: true })

// 内核挂载初始化（探活、续接会话）已完成的那一代（按 mountKey 记）。新挂的内核在 ready 之前收到提问，
// 发出的请求会被随后的续接中止、会话再被续接结果覆盖——刷新后在同页马上点解读，问题被吞掉还多建一个空会话。
const readyMountKey = ref(-1)
const sidebarAlive = ref(true)
onBeforeUnmount(() => { sidebarAlive.value = false })
function kernelReadyFor(key: number): Promise<boolean> {
  if (readyMountKey.value === key) return Promise.resolve(true)
  return new Promise((resolve) => {
    const stop = watch([readyMountKey, () => state.mountKey, sidebarAlive], ([ready, current, alive]) => {
      if (ready === key) { stop(); resolve(true) }
      else if (current !== key || !alive) { stop(); resolve(false) }
    })
  })
}

async function askInKernel(question: string) {
  agentEverOpened.value = true
  const key = state.mountKey
  // 轮次基线在任何等待之前记下：内核就绪前输入框已可输入，用户在此期间发出的一轮也要算进去（dljy#2962）
  const turnsBefore = turnsStarted
  await nextTick() // 首次/重挂：等 AgentChatPanel 挂载出 ref
  await nextTick() // 等会话属性随 record 更新到 props 后再发
  if (!question.trim()) return // 专家会话不带问题：只开会话、等用户输入
  // 等这一代内核初始化完成再发；等待期间又切换了会话（新的切换自己会发问），这条作废
  if (!(await kernelReadyFor(key))) return
  // 晨报：先装配数据预检（确定性，不依赖模型），再发目标日启动研判——与工作台「生成晨报」一致
  if (record.value.entryKey === 'morning_brief' && briefRailRef.value) {
    const regionId = currentRegion.value.id
    await briefRailRef.value.ensureLoaded()
    // 预检取数可能很慢：期间用户又发起了别的会话，这条晨报启动作废，不能把日期发进新会话（dljy-web#121 审查 P1）
    if (state.mountKey !== key) return
    // 期间切换了地区：预检卡是旧地区的数据，发出去的却是新地区——不混用，取消本次启动（同上审查 P1）
    if (currentRegion.value.id !== regionId) {
      ElMessage.info('地区已切换，本次晨报未启动，请重新执行 /晨报')
      return
    }
    // 期间用户已在这个会话里自己发过一轮：晨报场景要求目标日是首条消息，再补发会变成第二轮（dljy-web#121 审查 P2）
    if (turnsStarted !== turnsBefore) {
      ElMessage.info('预检期间已开始对话，本次晨报未启动；需要时请新建对话后重新执行 /晨报')
      return
    }
  }
  agentPanelRef.value?.ask(question)
}

// 页面发来的提问：先按规则决定续聊还是新开，再送进内核
let retriedQuestion: string | null = null
watch(() => state.request?.seq, async (seq) => {
  const req = state.request
  if (!seq || !req) return
  const decision = decideSession(state.session, busy.value, {
    kind: req.kind, route: route.path, promptKey: req.promptKey, scenario: req.scenario
  })
  if (decision === 'new') {
    busy.value = false
    switchSession({
      sessionId: null,
      scenario: req.scenario,
      promptKey: req.promptKey,
      sourceRoute: req.kind === 'page' ? route.path : '',
      entryKey: req.entryKey ?? entryForSession(req.scenario, req.promptKey).key,
      title: req.title,
      ...(req.meta ? { meta: req.meta } : {})
    })
  }
  retriedQuestion = null
  await askInKernel(req.question)
})

function onSessionReady(sessionId: string, title?: string) {
  adoptSessionId(sessionId, title ?? '')
}
// 内核开始生成的次数：晨报预检等待期间用户若自己发过一轮，启动时据此放弃（见 askInKernel）
let turnsStarted = 0
function onStreamingChange(value: boolean) {
  if (value) turnsStarted += 1
  busy.value = value
}
// 内核里的会话被清空（/clear）：视同新建对话——切到空白记录，下一次提问按通用对话角色建会话，
// 不沿用上一页的解读角色与来源页（dljy-web#118 codex 审查 P1）
function onConversationReset() {
  if (!state.session) return
  busy.value = false
  switchSession(null)
}
// 服务端 409：该会话已有进行中的 run（如在工作台里同时在跑）——改在新会话里重发一次
async function onSessionBusy(question: string) {
  if (retriedQuestion === question) return
  retriedQuestion = question
  busy.value = false
  // 被拒的那一轮从未被处理：把它的数据切片装回，新会话首轮照样附带（dljy-web#119 审查 P2）
  restoreSliceFor(question)
  switchSession({ ...record.value, sessionId: null })
  await askInKernel(question)
}

// 内核事件按「发出它的内核实例」过滤（dljy-web#119 审查 P1）：切换会话会重挂内核，旧实例在途的
// 建会话/恢复可能在卸载后才发出 sessionReady 等事件，若照单全收会把旧会话 id 写进新会话记录、
// 或把正在生成的新会话误标为空闲。世代号必须在渲染期烘进闭包（computed 产出、模板按标识符绑定），
// 不能写成 `@evt="fn(state.mountKey)"` 调用式——那会在事件到达时读当前值，旧事件照样通过（同 DeclarationDeskView）。
function forCurrentKernel<A extends unknown[]>(fn: (...args: A) => unknown) {
  return computed(() => {
    const key = state.mountKey
    return (...args: A) => {
      if (key === state.mountKey) void fn(...args)
    }
  })
}
const onKernelReady = forCurrentKernel(() => { readyMountKey.value = state.mountKey })
const onKernelSessionReady = forCurrentKernel(onSessionReady)
const onKernelStreamingChange = forCurrentKernel(onStreamingChange)
const onKernelSessionBusy = forCurrentKernel(onSessionBusy)
const onKernelConversationReset = forCurrentKernel(onConversationReset)
const onKernelOpenScenario = forCurrentKernel((question: string, scenario: AgentScenario) => sidebar.openScenario(question, scenario))

// ── 头部：新建 / 历史 / 在工作台打开 ──
const historyOpen = ref(false)
type HistoryRef = { reload: () => Promise<void> }
const historyRef = ref<HistoryRef | null>(null)
function newConversation() {
  busy.value = false
  historyOpen.value = false
  switchSession(null)
}
// 重新打开会话时找回它的入口：申报前体检与通用对话同为 chat 场景，只看场景会落到通用对话，
// 丢掉入口和必须显示的合成数据水印（dljy-web#121 审查 P1）。依次用：已知的解读角色（运行中行自带）
// → 工作台建的会话其来源 key 就是入口 key → 场景；不知道解读角色时再向 pi 查，查回来只补全记录、不重挂内核。
// 切换必须立即发生：查询挡在切换前面的话，用户在旧会话里刚发出的消息会被随后的切换隐藏（同 PR 审查 P1）。
function entryFor(scenario: string, pageKey: string | undefined, promptKey: string) {
  const byPage = pageKey ? findEntry(pageKey) : undefined
  return promptKey || !byPage || byPage.scenario !== scenario ? entryForSession(scenario, promptKey) : byPage
}
function openSessionAs(base: { sessionId: string; scenario: string; title: string; pageKey?: string; promptKey?: string }) {
  const known = base.promptKey || ''
  const entry = entryFor(base.scenario, base.pageKey, known)
  switchSession({
    sessionId: base.sessionId,
    scenario: base.scenario,
    promptKey: known || entry.promptKey || '',
    sourceRoute: '',
    entryKey: entry.key,
    title: base.title
  })
  if (known) return
  const mountKey = state.mountKey
  void fetchPiSessionMeta(base.sessionId).catch(() => null).then((meta) => {
    if (!meta?.promptKey || mountKey !== state.mountKey) return
    const refined = entryForSession(base.scenario, meta.promptKey)
    refineSessionEntry(base.sessionId, refined.key === 'workbench' ? entry.key : refined.key, meta.promptKey)
  })
}
function openHistorySession(sessionId: string, scenario: string, pageKey?: string) {
  historyOpen.value = false
  busy.value = false
  openSessionAs({ sessionId, scenario, title: '', pageKey })
}
function onHistoryChanged() {
  void refreshActiveRuns()
  if (historyOpen.value) void historyRef.value?.reload()
}
function openInWorkbench() {
  const query: Record<string, string> = { entry: record.value.entryKey || 'workbench' }
  if (record.value.sessionId) query.session = record.value.sessionId
  void router.push({ path: '/ai-agent', query })
  close()
}

// ── 运行中会话（后台 running run，数据源 pi GET /runs）──
const activeRuns = ref<AgentRunSummary[]>([])
// 从「运行中」切过去时要附着的 run：只交给切换产生的那一代内核（按 mountKey 绑定），之后任何会话切换都自动作废，
// 免得旧 run id 被带进别的会话；只给会话 id 时，transcript 还不可得的会话会开出空白面板（dljy-web#119 审查 P2）
const runToAttach = ref<{ mountKey: number; runId: string } | null>(null)
const resumeRunId = computed(() =>
  runToAttach.value && runToAttach.value.mountKey === state.mountKey ? runToAttach.value.runId : null
)
const runsOpen = ref(false)
const runsLoading = ref(false)
const stoppingRunIds = ref<Set<string>>(new Set())
let runsTimer: ReturnType<typeof setInterval> | null = null

watch(() => state.open, (open) => {
  if (open) {
    void refreshActiveRuns()
    runsTimer = setInterval(() => { void refreshActiveRuns() }, ACTIVE_RUNS_POLL_MS)
  } else {
    if (runsTimer) clearInterval(runsTimer)
    runsTimer = null
    runsOpen.value = false
    historyOpen.value = false
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (runsTimer) clearInterval(runsTimer)
})

function fmtTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const p = (n: number) => String(n).padStart(2, '0')
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`
}
function fmtRunTime(ts: number) {
  return fmtTime(ts > 1_000_000_000_000 ? ts : ts * 1000)
}
// 轮次沿用 pi 的 turn_seq（从 1 起算）；旧底座从 0 起算时模板里曾 +1，切到 pi 后会多显示一轮
function runSource(run: AgentRunSummary) {
  return historySourceLabel(run.page_key) ?? run.page_key ?? '未标注来源'
}
function runTitle(run: AgentRunSummary) {
  return run.session_title?.trim() || `${run.scenario || 'chat'} · ${run.session_id.slice(-6)}`
}
function isStopping(runId: string) {
  return stoppingRunIds.value.has(runId)
}
function setStopping(runId: string, value: boolean) {
  const next = new Set(stoppingRunIds.value)
  if (value) next.add(runId)
  else next.delete(runId)
  stoppingRunIds.value = next
}

async function refreshActiveRuns() {
  if (!state.open) return
  runsLoading.value = true
  try {
    activeRuns.value = await listRuns('running')
    if (!activeRuns.value.length) runsOpen.value = false
  } catch (err) {
    // 接口不可用：隐藏运行中数量，不以「0 个」冒充，也不打断对话（SS-07）
    activeRuns.value = []
    runsOpen.value = false
    console.warn('[ai-sidebar] 查询运行中会话失败', err)
  } finally {
    runsLoading.value = false
  }
}
function toggleRunsPanel() {
  runsOpen.value = !runsOpen.value
  if (runsOpen.value) void refreshActiveRuns()
}
function attachActiveRun(run: AgentRunSummary) {
  runsOpen.value = false
  busy.value = false
  openSessionAs({
    sessionId: run.session_id,
    scenario: run.scenario || 'chat',
    title: run.session_title?.trim() || '',
    pageKey: run.page_key,
    promptKey: run.prompt_key
  })
  runToAttach.value = { mountKey: state.mountKey, runId: run.run_id }
}
async function stopActiveRun(run: AgentRunSummary) {
  setStopping(run.run_id, true)
  try {
    const stopped = await stopAgentRun(run.session_id, run.run_id)
    if (!stopped) ElMessage.warning('该 run 可能已结束或无法停止')
    await refreshActiveRuns()
  } catch (err) {
    ElMessage.error('停止失败：' + (err instanceof Error ? err.message : '请稍后重试'))
  } finally {
    setStopping(run.run_id, false)
  }
}

function close() {
  sidebar.close()
}
function goConfig() {
  router.push({ path: '/system/ai-studio', query: { tab: 'models' } })
  close()
}
</script>

<template>
  <aside class="ai-dock" :class="{ open: state.open }">
    <div class="ai-panel">
      <header class="ai-head">
        <button class="ai-title" type="button" title="历史对话" @click="historyOpen = !historyOpen">
          <span class="ai-ico"><Sparkles :size="17" /></span>
          <span class="ai-title-text">{{ headerTitle }}</span>
          <ChevronDown :size="15" class="ai-title-chev" :class="{ open: historyOpen }" />
        </button>
        <div class="ai-head-right">
          <button v-if="activeRuns.length" class="ai-runs-badge" type="button" title="运行中会话" :class="{ on: runsOpen }" @click="toggleRunsPanel">
            <Radio :size="13" /> <b>{{ activeRuns.length }}</b>
          </button>
          <button class="ai-tool" type="button" title="新建对话" @click="newConversation"><MessageSquarePlus :size="16" /></button>
          <button v-if="canUseWorkbench" class="ai-tool" type="button" title="在工作台打开" @click="openInWorkbench"><Maximize2 :size="15" /></button>
          <button class="ai-tool" type="button" title="模型设置" @click="goConfig"><Settings :size="15" /></button>
          <button class="ai-tool" type="button" title="关闭" @click="close"><X :size="17" /></button>
        </div>
      </header>

      <div v-if="historyOpen" class="ai-history-pop">
        <AgentHistorySidebar
          ref="historyRef"
          :active-session-id="record.sessionId"
          @select="openHistorySession"
          @new-chat="newConversation"
          @update:collapsed="historyOpen = false"
        />
      </div>

      <div v-if="activeRuns.length && runsOpen" class="active-runs-panel">
        <div class="active-runs-head">
          <span>运行中会话</span>
          <button class="active-runs-refresh" title="刷新运行中会话" :disabled="runsLoading" @click="refreshActiveRuns">
            <RefreshCw :size="13" :class="{ spin: runsLoading }" />
          </button>
        </div>
        <ul>
          <li v-for="run in activeRuns" :key="run.run_id">
            <button class="run-main" @click="attachActiveRun(run)">
              <PlayCircle :size="15" />
              <span class="run-copy">
                <span class="run-title">{{ runTitle(run) }}</span>
                <span class="run-meta">
                  {{ runSource(run) }} · 第 {{ run.turn_seq }} 轮 · seq {{ run.last_seq }} · {{ fmtRunTime(run.created_at) }}
                </span>
              </span>
            </button>
            <button class="run-stop" title="停止此 run" :disabled="isStopping(run.run_id)" @click.stop="stopActiveRun(run)">
              <Loader2 v-if="isStopping(run.run_id)" :size="14" class="spin" />
              <Square v-else :size="14" />
            </button>
          </li>
        </ul>
      </div>

      <div class="ai-agent-wrap">
        <AgentChatPanel
          v-if="agentEverOpened"
          ref="agentPanelRef"
          :key="state.mountKey"
          :scenario="kernelScenario"
          :prompt-key="record.promptKey"
          history-key="ai_center"
          :resume-session-id="record.sessionId"
          :resume-run-id="resumeRunId"
          :restore-last-session="false"
          :context-payload-for="contextFor"
          :payload="regionPayload"
          message-actions
          command-host="sidebar"
          :extra-commands="expertCommands"
          approval-auto-approve
          @open-scenario="onKernelOpenScenario"
          @ready="onKernelReady"
          @session-ready="onKernelSessionReady"
          @streaming-change="onKernelStreamingChange"
          @session-busy="onKernelSessionBusy"
          @conversation-reset="onKernelConversationReset"
          @done="() => refreshActiveRuns()"
          @history-changed="onHistoryChanged"
        >
          <template #conversation-top>
            <div v-if="briefDate && record.entryKey === 'morning_brief'" class="ai-brief-card" data-testid="ai-brief-card">
              <MorningBriefRail ref="briefRailRef" :date="briefDate" />
            </div>
            <StrategicQaGaps v-if="record.entryKey === 'strategic_qa'" class="ai-gaps-card" data-testid="ai-gaps-card" />
            <div v-if="conclusionWatermark" class="ai-watermark" data-testid="ai-watermark">{{ conclusionWatermark }}</div>
          </template>
          <template #composer-top>
            <div class="ai-context">
              <div class="ai-context-line" data-testid="ai-page-context">
                <MapPin :size="12" />
                <span>{{ pageContext.page_label }}</span>
                <span class="sep">·</span><span>{{ pageContext.region.name }}</span>
                <span v-if="pageContext.company.name" class="sep">·</span><span v-if="pageContext.company.name">{{ pageContext.company.name }}</span>
              </div>
              <div v-if="presets.length" class="ai-presets" data-testid="ai-presets">
                <button v-for="p in presets" :key="p.label" type="button" class="ai-preset" @click="askPreset(p)">{{ p.label }}</button>
              </div>
            </div>
          </template>
        </AgentChatPanel>
        <div v-else class="ai-agent-empty">
          <div class="ai-welcome-ico"><Sparkles :size="26" /></div>
          <p class="ai-welcome-t">AI 助手</p>
          <p class="ai-welcome-s">在页面点「解读本页」可基于本页数据直接解读，也可以在这里直接提问。</p>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 右侧停靠面板:占位项(在 .app-layout flex 里挤压主内容)+ 固定面板(滑入) */
/* 取向 B：面板把工作区「推开」，dock 开启占 640px flex 宽，内容左移露在面板旁（都看得见）；
   .ai-panel 为 position:fixed 浮层贴右，正好落在 dock 的 640px 槽位、与左侧内容并排不重叠。
   工作区变窄导致的顶栏挤压，由 global.css 的 `.app-layout:has(.ai-dock.open) .topbar` 紧凑规则解决。 */
.ai-dock { flex: 0 0 auto; width: 0; transition: width 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }
.ai-dock.open { width: 640px; }
.ai-panel {
  position: fixed; top: 0; right: 0; z-index: 1500;
  width: 640px; max-width: 92vw; height: 100vh; box-sizing: border-box; padding: 14px 16px;
  display: flex; flex-direction: column;
  background: var(--panel); border-left: 1px solid var(--line-faint);
  box-shadow: -10px 0 30px -18px rgba(15, 60, 60, 0.35);
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.ai-dock.open .ai-panel { transform: translateX(0); }
.ai-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 2px 12px; border-bottom: 1px solid var(--line-faint);
}
.ai-title { display: flex; align-items: center; gap: 9px; font-size: var(--font-16); font-weight: 700; color: var(--text); }
.ai-ico {
  width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 9px; color: var(--ai-btn-fg); background: var(--ai-btn-bg);
}
.ai-head-right { display: flex; align-items: center; gap: 2px; }
.ai-tool {
  width: 30px; height: 30px; border: 0; border-radius: 8px;
  background: transparent; color: var(--el-text-color-secondary); cursor: pointer; display: grid; place-items: center;
}
.ai-tool:hover { background: var(--surface-hover); color: var(--primary); }
.active-runs {
  display: flex; align-items: center; gap: 6px;
  margin: 8px 2px 0;
}
.active-runs-toggle {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 32px; padding: 0 10px;
  border: 1px solid var(--primary-tint-border); border-radius: 8px;
  background: var(--primary-tint); color: var(--primary); cursor: pointer;
  font-size: var(--font-12-5); font-weight: 650;
}
.active-runs-toggle b {
  min-width: 18px; height: 18px; display: inline-grid; place-items: center;
  border-radius: 999px; background: var(--primary); color: #fff;
  font-size: var(--font-xs); line-height: 1;
}
.active-runs-toggle.on { border-color: var(--primary); }
.active-runs-refresh {
  width: 32px; height: 32px; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel); color: var(--muted); cursor: pointer;
}
.active-runs-refresh:hover:not(:disabled) { color: var(--primary); border-color: var(--primary-tint-border); background: var(--surface-hover); }
.active-runs-refresh:disabled { opacity: .55; cursor: default; }
.active-runs-panel {
  margin: 6px 2px 2px;
  border: 1px solid var(--line-soft); border-radius: 8px;
  background: var(--panel-sub); overflow: hidden;
}
.active-runs-panel ul { list-style: none; margin: 0; padding: 4px; }
.active-runs-panel li {
  display: flex; align-items: stretch; gap: 4px;
  min-height: 44px; border-radius: 7px;
}
.active-runs-panel li + li { margin-top: 2px; }
.active-runs-panel li:hover { background: var(--surface-hover); }
.run-main {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  border: 0; background: transparent; color: var(--text); cursor: pointer;
  padding: 7px 8px; text-align: left; border-radius: 7px;
}
.run-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.run-title { font-size: var(--font-md); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-meta { font-size: var(--font-xs); color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-stop {
  width: 34px; flex: none;
  border: 0; background: transparent; color: var(--danger); cursor: pointer;
  display: grid; place-items: center; border-radius: 7px;
}
.run-stop:hover:not(:disabled) { background: var(--danger-tint); }
.run-stop:disabled { opacity: .55; cursor: default; }
.spin { animation: ai-spin .8s linear infinite; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
/* agent 解读模式容器：嵌入的 AgentChatPanel 占满剩余高度 */
.ai-agent-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: 6px; }
.ai-agent-wrap > :deep(*) { flex: 1; min-height: 0; }
.ai-agent-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px 24px; color: var(--muted); }
.ai-welcome-ico {
  width: 56px; height: 56px; margin: 0 auto 14px; display: grid; place-items: center;
  border-radius: 16px; color: var(--primary); background: var(--primary-tint);
}
.ai-welcome-t { margin: 0; font-size: var(--font-15); font-weight: 600; color: var(--text); }
.ai-welcome-s { margin: 6px 0 18px; font-size: var(--font-md); }

/* 统一 AI 侧边栏头部：会话标题（点开历史）+ 运行中徽标 + 工具按钮 */
.ai-title { border: 0; background: transparent; cursor: pointer; padding: 2px 4px; border-radius: 8px; min-width: 0; }
.ai-title:hover { background: var(--surface-hover); }
.ai-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.ai-title-chev { flex: none; color: var(--muted); transition: transform 0.15s ease; }
.ai-title-chev.open { transform: rotate(180deg); }
.ai-runs-badge {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; margin-right: 4px;
  border: 1px solid var(--primary-tint-border); border-radius: 999px;
  background: var(--primary-tint); color: var(--primary); cursor: pointer; font-size: var(--font-xs);
}
.ai-runs-badge.on { border-color: var(--primary); }
.ai-history-pop {
  margin: 8px 2px 0; max-height: 46vh; overflow: auto;
  border: 1px solid var(--line-soft); border-radius: 8px; background: var(--panel);
}
.active-runs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px 2px; font-size: var(--font-xs); color: var(--muted);
}
/* 会话前置卡片：晨报预检卡（覆盖工作台里的固定列宽）/ 数据缺口清单 / 结论水印 */
.ai-brief-card { margin: 4px 0 10px; }
.ai-brief-card :deep(.mb-rail) { width: auto; max-height: 40vh; }
.ai-gaps-card { margin: 4px 0 10px; }
.ai-watermark {
  margin: 4px 0 10px; padding: 6px 10px; border-radius: 6px;
  background: var(--warning-tint, rgba(245, 158, 11, 0.12)); color: var(--warning, #b45309); font-size: var(--font-xs);
}
/* 输入框上方：页面背景条 + 本页快捷问题 */
.ai-context { padding: 6px 12px 4px; border-top: 1px solid var(--line-faint); }
.ai-context-line { display: flex; align-items: center; gap: 4px; font-size: var(--font-xs); color: var(--muted); min-width: 0; white-space: nowrap; overflow: hidden; }
.ai-context-line .sep { opacity: 0.6; }
.ai-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ai-preset {
  padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
  color: var(--text); font-size: var(--font-xs); cursor: pointer;
}
.ai-preset:hover { border-color: var(--primary); color: var(--primary); }
</style>
