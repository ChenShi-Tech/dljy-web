<script setup lang="ts">
// 全局 AI 解读面板：业务页「✨AI 解读」/「选中即问」的宿主，嵌 AgentChatPanel 流式研判。
//
// **原「导航助手」模式已于 2026-08-26 下架**（前端直连大模型 Key 做页面推荐，与统一工作台
// /ai-agent 能力重叠，且不经 /agent-api、不入审计、不受工具审批约束）。完整旧实现存
// `src/attic/ai-navigator-panel/AiAssistant.legacy.vue`，含恢复步骤，见该目录 README。
import { ref, nextTick, watch, computed, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Sparkles, Settings, X, Square, Radio, RefreshCw, PlayCircle, Loader2 } from 'lucide-vue-next'
import { listRuns, stopAgentRun, type AgentRunSummary, type AgentScenario } from '@/services/agent/agentClient'
import AgentChatPanel from './agent/AgentChatPanel.vue'
import { useAiPanel } from '../composables/useAiPanel'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import { ElMessage } from 'element-plus'

const { state: aiPanel, close: closePanel } = useAiPanel()
const ACTIVE_RUNS_POLL_MS = 5000
const router = useRouter()

const agentScenario = computed<AgentScenario>(() => (aiPanel.agentCtx?.scenario as AgentScenario) || 'chat')
// 动态宿主键：业务页经 openAgent 注入 promptKey（类型 PagePromptKey），缺省兜底到驾驶舱 key。
// 经 PAGE_PROMPT_KEYS 兜底常量满足主仓 verify:agent-chat-invariants 守卫（防自由文本绕过白名单）。
const insightPromptKey = computed(() => aiPanel.agentCtx?.promptKey ?? PAGE_PROMPT_KEYS.marketInsightCockpit)

// 「保活续聊」：首次 openAgent 后常驻挂载（v-show 切换而非 v-if remount），之后业务页再点
// 「✨AI 解读」/ 跳转回来重开，都把问题送进【现有】会话续聊，而不是开新对话。
// agentKey 自增作「来了新问题」信号，不做 :key remount。
type AgentPanelRef = {
  ask: (q: string) => void
  newConversation: () => void
  attachRun: (sessionId: string, runId?: string) => Promise<boolean>
}
const agentPanelRef = ref<AgentPanelRef | null>(null)
const agentEverOpened = ref(false)
watch(() => aiPanel.agentKey, async () => {
  if (aiPanel.agentKey === 0) return
  agentEverOpened.value = true
  await nextTick() // 首次：等 AgentChatPanel 挂载出 ref
  await nextTick() // 等 contextPayload / payload 随 agentCtx 更新到 props 后再发
  const q = aiPanel.agentCtx?.initialQuestion?.trim()
  if (q) agentPanelRef.value?.ask(q)
})

// 运行中会话（后台 running run）
const activeRuns = ref<AgentRunSummary[]>([])
const runsOpen = ref(false)
const runsLoading = ref(false)
const stoppingRunIds = ref<Set<string>>(new Set())
let runsTimer: ReturnType<typeof setInterval> | null = null

watch(() => aiPanel.open, (open) => {
  if (open) {
    void refreshActiveRuns()
    runsTimer = setInterval(() => { void refreshActiveRuns() }, ACTIVE_RUNS_POLL_MS)
  } else {
    if (runsTimer) clearInterval(runsTimer)
    runsTimer = null
    runsOpen.value = false
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

const PAGE_KEY_LABELS: Record<string, string> = {
  ai_center: 'AI 中心',
  workbench: '智能体工作台',
  declaration_market: '申报行情',
  declaration_draft: '申报草稿',
  review_center: '复盘中心',
  morning_brief: '交易晨报',
  policy_intel: '政策情报',
  pre_submit_check: '申报体检',
  storage_copilot: '储能测算',
  sidekick_exposure: '敞口分析',
  sidekick_spot: '监盘解读',
  captured_browser: '数据浏览器'
}
function runSource(run: AgentRunSummary) {
  const key = run.page_key || ''
  return PAGE_KEY_LABELS[key] || key || '未标注来源'
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
  if (!aiPanel.open) return
  runsLoading.value = true
  try {
    activeRuns.value = await listRuns('running')
    if (!activeRuns.value.length) runsOpen.value = false
  } catch (err) {
    console.warn('[ai-assistant] 查询运行中会话失败', err)
  } finally {
    runsLoading.value = false
  }
}
function toggleRunsPanel() {
  runsOpen.value = !runsOpen.value
  if (runsOpen.value) void refreshActiveRuns()
}
async function attachActiveRun(run: AgentRunSummary) {
  agentEverOpened.value = true
  runsOpen.value = false
  await nextTick()
  await nextTick()
  const ok = await agentPanelRef.value?.attachRun(run.session_id, run.run_id)
  if (!ok) ElMessage.error('运行中会话切换失败')
  void refreshActiveRuns()
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
  closePanel()
}
function goConfig() {
  router.push({ path: '/system/ai-studio', query: { tab: 'models' } })
  close()
}
</script>

<template>
  <aside class="ai-dock" :class="{ open: aiPanel.open }">
    <div class="ai-panel">
      <header class="ai-head">
        <div class="ai-title"><span class="ai-ico"><Sparkles :size="17" /></span> AI 解读</div>
        <div class="ai-head-right">
          <button class="ai-tool" title="模型设置" @click="goConfig"><Settings :size="15" /></button>
          <button class="ai-tool" title="关闭" @click="close"><X :size="17" /></button>
        </div>
      </header>

      <!-- 运行中会话：仅当前用户存在后台 running run 时显示 -->
      <div v-if="activeRuns.length" class="active-runs">
        <button class="active-runs-toggle" :class="{ on: runsOpen }" @click="toggleRunsPanel">
          <Radio :size="14" />
          <span>运行中会话</span>
          <b>{{ activeRuns.length }}</b>
        </button>
        <button class="active-runs-refresh" title="刷新运行中会话" :disabled="runsLoading" @click="refreshActiveRuns">
          <RefreshCw :size="14" :class="{ spin: runsLoading }" />
        </button>
      </div>

      <div v-if="activeRuns.length && runsOpen" class="active-runs-panel">
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
          :scenario="agentScenario"
          :prompt-key="insightPromptKey"
          history-key="ai_center"
          :context-payload="aiPanel.agentCtx?.contextPayload ?? null"
          :payload="aiPanel.agentCtx?.payload ?? null"
          @done="() => refreshActiveRuns()"
          @history-changed="refreshActiveRuns"
        />
        <div v-else class="ai-agent-empty">
          <div class="ai-welcome-ico"><Sparkles :size="26" /></div>
          <p class="ai-welcome-t">智能解读</p>
          <p class="ai-welcome-s">在「市场洞察驾驶舱」等页点卡片「✨AI 解读」，即可在此基于本页已装配数据流式研判。<br />想直接对话请去「智能体工作台」。</p>
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
</style>
