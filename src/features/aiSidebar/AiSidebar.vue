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
import { historySourceLabel } from '@/components/agent/historySources'
import { listRuns, stopAgentRun, type AgentRunSummary, type AgentScenario } from '@/services/agent/agentClient'
import { entryForSession } from '@/services/agent/workbenchEntries'
import { currentRegion } from '@/services/region/regionContext'
import { currentCompany } from '@/services/company/companyContext'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'
import { useAiSidebar, takeSliceFor, switchSession, adoptSessionId, BLANK_SESSION } from './useAiSidebar'
import { activeAiPage, resolveQuestion, type AiPagePreset } from './pageRegistry'
import { buildPageContext, composeMessageContext } from './pageContext'
import { decideSession } from './sessionPolicy'

const sidebar = useAiSidebar()
const { state } = sidebar
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

async function askInKernel(question: string) {
  agentEverOpened.value = true
  await nextTick() // 首次/重挂：等 AgentChatPanel 挂载出 ref
  await nextTick() // 等会话属性随 record 更新到 props 后再发
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
      title: req.title
    })
  }
  retriedQuestion = null
  await askInKernel(req.question)
})

function onSessionReady(sessionId: string) {
  adoptSessionId(sessionId)
}
function onStreamingChange(value: boolean) {
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
  switchSession({ ...record.value, sessionId: null })
  await askInKernel(question)
}

// ── 头部：新建 / 历史 / 在工作台打开 ──
const historyOpen = ref(false)
type HistoryRef = { reload: () => Promise<void> }
const historyRef = ref<HistoryRef | null>(null)
function newConversation() {
  busy.value = false
  historyOpen.value = false
  switchSession(null)
}
function openHistorySession(sessionId: string, scenario: string) {
  historyOpen.value = false
  busy.value = false
  switchSession({
    sessionId, scenario, promptKey: '', sourceRoute: '', entryKey: entryForSession(scenario, '').key, title: ''
  })
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
  const scenario = run.scenario || 'chat'
  switchSession({
    sessionId: run.session_id,
    scenario,
    promptKey: '',
    sourceRoute: '',
    entryKey: entryForSession(scenario, '').key,
    title: run.session_title?.trim() || ''
  })
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
                  {{ runSource(run) }} · 第 {{ run.turn_seq + 1 }} 轮 · seq {{ run.last_seq }} · {{ fmtRunTime(run.created_at) }}
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
          :restore-last-session="false"
          :context-payload-for="contextFor"
          :payload="regionPayload"
          message-actions
          @session-ready="onSessionReady"
          @streaming-change="onStreamingChange"
          @session-busy="onSessionBusy"
          @conversation-reset="onConversationReset"
          @done="() => refreshActiveRuns()"
          @history-changed="onHistoryChanged"
        >
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
          <p class="ai-welcome-s">在页面点「✨ 解读本页」可基于本页数据直接解读，也可以在这里直接提问。</p>
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
