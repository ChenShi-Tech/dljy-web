<script setup lang="ts">
import { ref, nextTick, watch, computed, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Sparkles, Send, Settings, X, ArrowRight, History, Plus, Trash2, Mic, AudioLines, Bot, Compass, Volume2, Square, Radio, RefreshCw, PlayCircle, Loader2 } from 'lucide-vue-next'
import { buildCatalog, askAssistant, type NavSuggestion, type ChatTurn } from '@/services/aiNavigator'
import { isLlmConfigured, refreshLlmStatus } from '@/services/llm'
import { getCurrentUser } from '@/services/auth'
import { createRecognizer, speak, cancelSpeak, isVoiceSupported, isSpeechSynthesisSupported, type Recognizer } from '@/services/voice'
import { useSlashInput } from '../composables/useSlashInput'
import type { CommandContext } from '@/services/slashCommands'
import { listRuns, stopAgentRun, type AgentRunSummary, type AgentScenario } from '@/services/agent/agentClient'
import SlashCommandMenu from './agent/SlashCommandMenu.vue'
import AgentChatPanel from './agent/AgentChatPanel.vue'
import { useAiPanel } from '../composables/useAiPanel'
import { renderMarkdown } from '../utils/markdown'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import { ElMessage } from 'element-plus'

// 全局统一 AI 面板单例：open/mode/agentCtx 由 useAiPanel 管理（替代原 props.visible），
// 与业务页「✨AI 解读」共用一处加宽面板（导航助手 / agent 解读两模式）。
const { state: aiPanel, close: closePanel, setMode } = useAiPanel()
const ACTIVE_RUNS_POLL_MS = 5000
const agentScenario = computed<AgentScenario>(() => (aiPanel.agentCtx?.scenario as AgentScenario) || 'chat')
// 动态宿主键：业务页经 openAgent 注入 promptKey（类型 PagePromptKey），缺省兜底到驾驶舱 key。
// 经 PAGE_PROMPT_KEYS 兜底常量满足 verify:agent-chat-invariants 守卫（防自由文本绕过白名单）。
const insightPromptKey = computed(() => aiPanel.agentCtx?.promptKey ?? PAGE_PROMPT_KEYS.marketInsightCockpit)

// agent 解读面板「保活续聊」：首次 openAgent 后常驻挂载（v-show 切换而非 v-if remount），
// 之后业务页再点「✨AI 解读」/ 跳转回来重开，都把问题送进【现有】会话续聊，而不是开新对话
// （修复「跳转之后再点 Agent 还是新对话」）。agentKey 自增作「来了新问题」信号，不再做 :key remount。
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

const router = useRouter()
const route = useRoute()

type Msg = { role: 'user' | 'ai'; text: string; suggestions?: NavSuggestion[] }
type Session = { id: string; title: string; messages: Msg[]; history: ChatTurn[]; updatedAt: number }

const LEGACY_SESS_KEY = 'dljy_ai_sessions'
const SESS_KEY = `${LEGACY_SESS_KEY}_${currentUsername()}`
const sessions = ref<Session[]>([])
const currentId = ref('')
const messages = ref<Msg[]>([])
const history = ref<ChatTurn[]>([])
const input = ref('')
const loading = ref(false)
const showHistory = ref(false)
const bodyRef = ref<HTMLElement | null>(null)
const activeRuns = ref<AgentRunSummary[]>([])
const runsOpen = ref(false)
const runsLoading = ref(false)
const stoppingRunIds = ref<Set<string>>(new Set())
let runsTimer: ReturnType<typeof setInterval> | null = null

// 语音输入
const listening = ref(false)
const voiceSupported = isVoiceSupported()
// 朗读(TTS)能力与语音识别(ASR)正交：Firefox 等支持合成但不支持识别，朗读按钮据此独立检测。
const ttsSupported = isSpeechSynthesisSupported()
let recognizer: Recognizer | null = null
// 语音朗读:正在朗读的 AI 消息下标(切换「朗读 / 停止」按钮),null=未在朗读
const speakingIndex = ref<number | null>(null)

const examples = ['看现货价格和新能源的关系', '做储能收益测算', '日前竞价空间在哪看', '解释下什么是现货出清价']

watch(() => aiPanel.open, (open) => {
  if (open) void refreshLlmStatus()
}, { immediate: aiPanel.open })

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
  if (jumpTimer) clearTimeout(jumpTimer)
})

function genId() {
  return 's' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6)
}
function currentUsername() {
  try {
    return getCurrentUser()?.username?.trim() || 'anon'
  } catch {
    return 'anon'
  }
}
function migrateLegacySessions() {
  const raw = localStorage.getItem(SESS_KEY)
  const legacyRaw = localStorage.getItem(LEGACY_SESS_KEY)
  if (!raw && legacyRaw) {
    localStorage.setItem(SESS_KEY, legacyRaw)
    localStorage.removeItem(LEGACY_SESS_KEY)
  }
}
function persist() {
  localStorage.setItem(SESS_KEY, JSON.stringify(sessions.value))
}
function newSession() {
  const id = genId()
  sessions.value = [{ id, title: '新对话', messages: [], history: [], updatedAt: Date.now() }, ...sessions.value]
  currentId.value = id
  messages.value = []
  history.value = []
  showHistory.value = false
  persist()
}
function loadSession(id: string) {
  const s = sessions.value.find((x) => x.id === id)
  if (!s) return
  currentId.value = id
  messages.value = s.messages.map((m) => ({ ...m }))
  history.value = s.history.map((h) => ({ ...h }))
  showHistory.value = false
  scrollDown()
}
function deleteSession(id: string) {
  sessions.value = sessions.value.filter((x) => x.id !== id)
  if (!sessions.value.length) {
    newSession()
  } else if (currentId.value === id) {
    loadSession(sessions.value[0].id)
  }
  persist()
}
function syncCurrent() {
  const s = sessions.value.find((x) => x.id === currentId.value)
  if (!s) return
  s.messages = messages.value
  s.history = history.value
  s.updatedAt = Date.now()
  if ((s.title === '新对话' || !s.title) && messages.value[0]) {
    s.title = messages.value[0].text.slice(0, 18)
  }
  // 当前会话移到最前
  sessions.value = [s, ...sessions.value.filter((x) => x.id !== s.id)]
  persist()
}

// 初始化：恢复会话
try {
  migrateLegacySessions()
  const raw = localStorage.getItem(SESS_KEY)
  if (raw) sessions.value = JSON.parse(raw)
} catch {
  /* ignore broken cache */
}
if (sessions.value.length) loadSession(sessions.value[0].id)
else newSession()

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
  setMode('agent')
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

function scrollDown() {
  nextTick(() => {
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  })
}

async function send(text?: string) {
  const q = (text ?? input.value).trim()
  if (!q || loading.value) return
  // 斜杠指令本地执行（/help、/nav、技能等），永不发给 LLM、也不要求已配置模型
  if (q.startsWith('/') && trySlash(q)) {
    if (text === undefined) input.value = ''
    return
  }
  pushHistory(q)
  if (!isLlmConfigured() && !(await refreshLlmStatus())) {
    messages.value.push({ role: 'ai', text: '还没配置大模型，请点右上角「模型设置」。' })
    syncCurrent()
    scrollDown()
    return
  }
  input.value = ''
  messages.value.push({ role: 'user', text: q })
  history.value.push({ role: 'user', content: q })
  syncCurrent()
  scrollDown()
  loading.value = true
  try {
    const catalog = buildCatalog(getCurrentUser())
    // 让助手感知当前所在页面:把当前路由(路径/标题/分组/范围)随上下文一并下传。
    const meta = route.meta as Record<string, any>
    const currentPage = { path: route.path, title: meta.title || '', group: meta.block || '', scope: meta.scope || '', kind: meta.kind || '' }
    const res = await askAssistant(history.value.slice(-12), catalog, currentPage)
    messages.value.push({ role: 'ai', text: res.reply, suggestions: res.suggestions })
    history.value.push({ role: 'assistant', content: res.reply })
    // 识别到最相关目标即自动前往(不用点选);跳转提示音是否出声由「语音播报」开关(voice.tts)决定。
    // 回复不再自动朗读,改为每条回复下方「朗读」按钮手动播放(见 toggleSpeak)。
    if (res.suggestions.length >= 1) autoJump(res.suggestions[0])
  } catch (e) {
    messages.value.push({ role: 'ai', text: '出错了：' + (e instanceof Error ? e.message : '请求失败') })
  } finally {
    loading.value = false
    syncCurrent()
    scrollDown()
  }
}

function go(path: string) {
  router.push(path)
  closePanel()
}

// 融合：深度任务移交智能体工作台（多步工具调用/申报策略/复盘等走 harness）
function openWorkbench(question?: string, scenario?: AgentScenario) {
  const query: Record<string, string> = {}
  if (question) query.q = question
  if (scenario && scenario !== 'chat') query.scenario = scenario
  router.push(Object.keys(query).length ? { path: '/ai-agent', query } : '/ai-agent')
  closePanel()
}

// 斜杠指令（/help、/nav、/clear、技能… 输入 / 唤起菜单）
function makeContext(args: string): CommandContext {
  return {
    host: 'assistant',
    args,
    navigate: go,
    postSystemNote: (text) => {
      messages.value.push({ role: 'ai', text })
      syncCurrent()
      scrollDown()
    },
    setInput: (text) => { input.value = text },
    sendToChat: (text) => { void send(text) },
    openWorkbench,
    clearSession: newSession
  }
}
const { menuOpen, menuItems, activeIndex, onKeydown: onSlashKeydown, trySlash, pushHistory, selectItem } =
  useSlashInput({ input, host: 'assistant', makeContext })

function onInputKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return // 中文输入法组词中，回车/方向键一律放行
  if (onSlashKeydown(e)) return // 菜单打开时消费 ↑↓ / Enter / Tab / Esc；空输入时 ↑↓ 翻历史
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault() // Shift+Enter 保留换行
    void send()
  }
}
// 第 i 条 AI 消息对应的上一条用户提问（移交工作台时携带）
function lastUserBefore(i: number): string {
  for (let k = i - 1; k >= 0; k--) {
    if (messages.value[k].role === 'user') return messages.value[k].text
  }
  return ''
}
// 自动跳转:有明确目标即前往。极短过场看清去向 + 语音播报,再跳。
const autoJumping = ref<NavSuggestion | null>(null)
// 过场跳转定时器:存句柄供卸载清理,避免组件在 600ms 过场内卸载后仍触发 router.push
// (与 AgentChatPanel.vue 的 navTimer 同模式)。
let jumpTimer: ReturnType<typeof setTimeout> | undefined
function autoJump(s: NavSuggestion) {
  autoJumping.value = s
  speak('正在前往' + s.title)
  scrollDown()
  if (jumpTimer) clearTimeout(jumpTimer)
  jumpTimer = setTimeout(() => {
    jumpTimer = undefined
    autoJumping.value = null
    go(s.path)
  }, 600)
}

// 朗读某条 AI 回复:点击播放,再点(或播完)停止。手动触发用 force 绕过「语音播报」开关,确保总能播。
function toggleSpeak(i: number, text: string) {
  if (speakingIndex.value === i) {
    cancelSpeak()
    speakingIndex.value = null
    return
  }
  speakingIndex.value = i
  speak(text, { force: true, onEnd: () => { if (speakingIndex.value === i) speakingIndex.value = null } })
}

// 麦克风:点击说话 → 实时转文字 → 说完自动发送
function toggleMic() {
  if (listening.value) { recognizer?.stop(); return }
  if (!voiceSupported) {
    messages.value.push({ role: 'ai', text: '当前环境不支持语音识别,建议用 Chrome / Edge,并在 localhost 或 HTTPS 下访问。' })
    scrollDown(); return
  }
  input.value = ''
  recognizer = createRecognizer({
    onStart: () => { listening.value = true },
    onEnd: () => { listening.value = false },
    onInterim: (t) => { input.value = t },
    onFinal: (t) => { input.value = t; listening.value = false; if (t) send(t) },
    onError: (msg) => { listening.value = false; messages.value.push({ role: 'ai', text: msg }); scrollDown() }
  })
  recognizer.start()
}
function close() {
  closePanel()
}
function goConfig() {
  router.push({ path: '/system/ai-studio', query: { tab: 'models' } })
  close()
}

watch(
  () => aiPanel.open,
  (v) => {
    if (!v) return
    // 重开默认「续上次对话」：不再每次打开就 newSession（跳转后重开仍接着聊）。
    // AiAssistant 挂在 AppLayout 全局常驻，messages 跨路由跳转保留；要开新对话点顶部「+ 新对话」。
    scrollDown()
  }
)
</script>

<template>
  <aside class="ai-dock" :class="{ open: aiPanel.open }">
    <div class="ai-panel">
      <header class="ai-head">
        <div class="ai-title"><span class="ai-ico"><Sparkles :size="17" /></span> AI 助手</div>
        <div class="ai-head-right">
          <button v-if="aiPanel.mode === 'nav'" class="ai-tool workbench" title="智能体工作台（深度任务）" @click="openWorkbench()"><Bot :size="16" /></button>
          <button v-if="aiPanel.mode === 'nav'" class="ai-tool" title="历史对话" @click="showHistory = !showHistory"><History :size="16" /></button>
          <button v-if="aiPanel.mode === 'nav'" class="ai-tool" title="新对话" @click="newSession"><Plus :size="17" /></button>
          <button class="ai-tool" title="模型设置" @click="goConfig"><Settings :size="15" /></button>
          <button class="ai-tool" title="关闭" @click="close"><X :size="17" /></button>
        </div>
      </header>

      <!-- 模式切换：导航助手 / 智能解读（业务页「✨AI 解读」触发后切到 agent 模式） -->
      <div class="ai-mode-seg">
        <button :class="{ on: aiPanel.mode === 'nav' }" @click="setMode('nav')"><Compass :size="14" /> 导航助手</button>
        <button :class="{ on: aiPanel.mode === 'agent' }" @click="setMode('agent')"><Sparkles :size="14" /> 智能解读</button>
      </div>

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

      <!-- 历史会话面板 -->
      <div v-if="aiPanel.mode === 'nav' && showHistory" class="ai-history">
        <div class="ai-history-top">
          <span>历史对话（{{ sessions.length }}）</span>
          <button @click="newSession"><Plus :size="13" /> 新对话</button>
        </div>
        <div v-if="!sessions.some((s) => s.messages.length)" class="ai-history-empty">还没有对话记录</div>
        <ul>
          <li
            v-for="s in sessions.filter((x) => x.messages.length)"
            :key="s.id"
            :class="{ active: s.id === currentId }"
            @click="loadSession(s.id)"
          >
            <div class="hi-main">
              <div class="hi-title">{{ s.title || '新对话' }}</div>
              <div class="hi-time">{{ fmtTime(s.updatedAt) }} · {{ s.messages.filter((m) => m.role === 'user').length }} 轮</div>
            </div>
            <button class="hi-del" title="删除" @click.stop="deleteSession(s.id)"><Trash2 :size="14" /></button>
          </li>
        </ul>
      </div>

      <div v-show="aiPanel.mode === 'nav'" ref="bodyRef" class="ai-body">
        <div v-if="!messages.length" class="ai-welcome">
          <div class="ai-welcome-ico"><Sparkles :size="26" /></div>
          <p class="ai-welcome-t">我能聊电力交易，也能帮你跳页面</p>
          <p class="ai-welcome-s">说一句你想做的事或想问的问题，输入 / 可唤起指令与技能</p>
          <div class="ai-examples">
            <span v-for="ex in examples" :key="ex" @click="send(ex)">{{ ex }}</span>
          </div>
        </div>

        <template v-for="(m, i) in messages" :key="i">
          <div v-if="m.role === 'user'" class="row user">
            <div class="bubble user-bubble">{{ m.text }}</div>
          </div>
          <div v-else class="row ai">
            <div class="ai-avatar"><Sparkles :size="14" /></div>
            <div class="ai-msg">
              <div class="bubble ai-bubble md" v-html="renderMarkdown(m.text)"></div>
              <div v-if="m.suggestions && m.suggestions.length" class="sug-list">
                <button v-for="s in m.suggestions" :key="s.path" class="sug" @click="go(s.path)">
                  <div class="sug-main">
                    <div class="sug-title">{{ s.title }}</div>
                    <div class="sug-meta">{{ s.group }}<template v-if="s.reason"> · {{ s.reason }}</template></div>
                  </div>
                  <ArrowRight :size="16" class="sug-arrow" />
                </button>
              </div>
              <div class="ai-msg-actions">
                <button
                  v-if="ttsSupported"
                  class="msg-act"
                  :class="{ on: speakingIndex === i }"
                  :title="speakingIndex === i ? '停止朗读' : '朗读这条回复'"
                  @click="toggleSpeak(i, m.text)"
                >
                  <Square v-if="speakingIndex === i" :size="13" />
                  <Volume2 v-else :size="13" />
                  {{ speakingIndex === i ? '停止' : '朗读' }}
                </button>
                <button class="deep-task" title="移交智能体工作台：自动查数据、跑量化、出报告" @click="openWorkbench(lastUserBefore(i))">
                  <Bot :size="13" /> 交给智能体深度处理
                </button>
              </div>
            </div>
          </div>
        </template>

        <div v-if="loading" class="row ai">
          <div class="ai-avatar"><Sparkles :size="14" /></div>
          <div class="bubble ai-bubble typing">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>
      </div>

      <!-- 智能解读模式：嵌入 AgentChatPanel（业务页「✨AI 解读」注入 agentCtx 后流式研判） -->
      <div v-show="aiPanel.mode === 'agent'" class="ai-agent-wrap">
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
          <p class="ai-welcome-s">在「市场洞察驾驶舱」等页点卡片「✨AI 解读」，即可在此基于本页已装配数据流式研判。</p>
        </div>
      </div>

      <footer v-if="aiPanel.mode === 'nav'" class="ai-input">
        <SlashCommandMenu
          v-if="menuOpen"
          :items="menuItems"
          :active-index="activeIndex"
          @select="selectItem"
          @hover="activeIndex = $event"
        />
        <textarea
          v-model="input"
          rows="2"
          :placeholder="listening ? '正在聆听，请说…' : '问问题、输入 / 用指令，或点麦克风'"
          @keydown="onInputKeydown"
        />
        <button
          v-if="voiceSupported"
          class="ai-mic"
          :class="{ on: listening }"
          :title="listening ? '点击停止' : '点击说话'"
          @click="toggleMic"
        >
          <AudioLines v-if="listening" :size="17" />
          <Mic v-else :size="17" />
        </button>
        <button class="ai-send" :disabled="loading || !input.trim()" @click="send()">
          <Send :size="16" />
        </button>
      </footer>

      <!-- 单卡自动跳转过场 -->
      <transition name="ai-jump">
        <div v-if="autoJumping" class="ai-jump-mask">
          <div class="ai-jump-card">
            <div class="ai-jump-spin"></div>
            <div class="ai-jump-t">正在前往</div>
            <div class="ai-jump-page">{{ autoJumping.title }}</div>
            <div class="ai-jump-s">{{ autoJumping.group }}</div>
          </div>
        </div>
      </transition>
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

/* 模式切换段：导航助手 / 智能解读 */
.ai-mode-seg { display: flex; gap: 6px; padding: 10px 2px 4px; }
.ai-mode-seg button {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 10px; font-size: var(--font-md); cursor: pointer;
  border: 1px solid var(--line); border-radius: 9px;
  background: transparent; color: var(--muted); transition: all .15s;
}
.ai-mode-seg button.on { background: var(--primary-tint); color: var(--primary); border-color: var(--primary-tint-border); font-weight: 600; }
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

/* 历史面板 */
.ai-history {
  position: absolute; top: 46px; left: 0; right: 0; z-index: 5;
  max-height: 60%; overflow-y: auto;
  background: var(--panel); border: 1px solid var(--line-soft); border-radius: 12px;
  box-shadow: 0 18px 40px -18px rgba(15, 60, 60, 0.4); padding: 8px;
}
.ai-history-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 6px 8px; font-size: var(--font-sm); color: var(--muted);
}
.ai-history-top button {
  display: flex; align-items: center; gap: 4px;
  border: 1px solid var(--primary-tint-border); border-radius: 7px; background: var(--primary-tint);
  color: var(--primary); font-size: var(--font-sm); padding: 4px 9px; cursor: pointer;
}
.ai-history-empty { padding: 18px; text-align: center; color: var(--el-text-color-placeholder); font-size: var(--font-md); }
.ai-history ul { list-style: none; margin: 0; padding: 0; }
.ai-history li {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-radius: 9px; cursor: pointer; transition: background 0.15s;
}
.ai-history li:hover { background: var(--surface-hover); }
.ai-history li.active { background: var(--primary-tint); }
.hi-main { flex: 1; min-width: 0; }
.hi-title { font-size: var(--font-13-5); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hi-time { font-size: var(--font-xs); color: var(--el-text-color-secondary); margin-top: 2px; }
.hi-del { border: 0; background: transparent; color: var(--el-text-color-disabled); cursor: pointer; padding: 4px; border-radius: 6px; flex: none; }
.hi-del:hover { background: var(--danger-tint); color: var(--danger); }

.ai-body { flex: 1; overflow-y: auto; padding: 16px 2px; display: flex; flex-direction: column; gap: 14px; }
.ai-welcome { text-align: center; padding: 30px 12px; color: var(--muted); }
.ai-welcome-ico {
  width: 56px; height: 56px; margin: 0 auto 14px; display: grid; place-items: center;
  border-radius: 16px; color: var(--primary); background: var(--primary-tint);
}
.ai-welcome-t { margin: 0; font-size: var(--font-15); font-weight: 600; color: var(--text); }
.ai-welcome-s { margin: 6px 0 18px; font-size: var(--font-md); }
.ai-examples { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.ai-examples span {
  padding: 6px 12px; border-radius: 999px; background: var(--surface-hover); border: 1px solid var(--line-soft);
  font-size: var(--font-12-5); color: var(--text-soft); cursor: pointer; transition: all 0.18s;
}
.ai-examples span:hover { background: var(--primary-tint); border-color: var(--primary-tint-border); color: var(--primary); }

.row { display: flex; gap: 8px; }
.row.user { justify-content: flex-end; }
.row.ai { justify-content: flex-start; }
.ai-avatar {
  width: 26px; height: 26px; flex: none; margin-top: 2px; display: grid; place-items: center;
  border-radius: 8px; color: var(--primary); background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.ai-msg { min-width: 0; max-width: 86%; }
.bubble { padding: 10px 13px; font-size: var(--font-lg); line-height: 1.6; border-radius: 13px; white-space: pre-wrap; word-break: break-word; }
.user-bubble { max-width: 86%; color: var(--ai-btn-fg); background: var(--ai-btn-bg); border-bottom-right-radius: 4px; }
.ai-bubble { color: var(--text); background: var(--surface-hover); border: 1px solid var(--line-soft); border-bottom-left-radius: 4px; }
/* nav 模式 AI 回复走 markdown 渲染（renderMarkdown + DOMPurify），此前是纯文本 {{ }} 显原文 */
.ai-bubble.md :deep(> :first-child) { margin-top: 0; }
.ai-bubble.md :deep(> :last-child) { margin-bottom: 0; }
.ai-bubble.md :deep(h1), .ai-bubble.md :deep(h2), .ai-bubble.md :deep(h3), .ai-bubble.md :deep(h4) { font-size: var(--font-lg); font-weight: 700; margin: 10px 0 4px; line-height: 1.4; }
.ai-bubble.md :deep(p) { margin: 6px 0; line-height: 1.65; }
.ai-bubble.md :deep(ul), .ai-bubble.md :deep(ol) { margin: 6px 0; padding-left: 20px; }
.ai-bubble.md :deep(li) { margin: 3px 0; line-height: 1.6; }
.ai-bubble.md :deep(li > p) { margin: 2px 0; }
.ai-bubble.md :deep(strong) { font-weight: 700; }
.ai-bubble.md :deep(em) { font-style: italic; }
.ai-bubble.md :deep(blockquote) { margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--primary); background: color-mix(in srgb, var(--primary) 7%, transparent); border-radius: 0 6px 6px 0; color: var(--text-body); }
.ai-bubble.md :deep(code) { background: var(--panel); border: 1px solid var(--line-faint); padding: 1px 5px; border-radius: 4px; font-size: var(--font-12-5); }
.ai-bubble.md :deep(pre) { margin: 8px 0; padding: 8px 10px; background: var(--panel); border: 1px solid var(--line-faint); border-radius: 8px; overflow-x: auto; }
.ai-bubble.md :deep(pre code) { background: none; border: none; padding: 0; }
.ai-bubble.md :deep(a) { color: var(--primary); text-decoration: underline; }
.ai-bubble.md :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 10px 0; }
.ai-bubble.md :deep(table) { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: var(--font-12-5); }
.ai-bubble.md :deep(th), .ai-bubble.md :deep(td) { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
.ai-bubble.md :deep(th) { background: var(--panel-sub); font-weight: 600; }

.sug-list { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.sug {
  display: flex; align-items: center; gap: 10px; padding: 11px 12px; text-align: left;
  border: 1px solid var(--line-soft); border-radius: 12px; background: var(--panel); cursor: pointer;
  transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
}
.sug:hover { border-color: var(--primary); background: var(--primary-tint); box-shadow: 0 4px 14px -8px rgba(15, 118, 110, 0.55); }
.sug-main { flex: 1; min-width: 0; }
.sug-title { font-size: var(--font-lg); font-weight: 650; color: var(--text); }
.sug-meta { margin-top: 2px; font-size: var(--font-11-5); color: var(--el-text-color-secondary); }
.sug-arrow { color: var(--primary); flex: none; }

/* 移交智能体工作台 */
.ai-tool.workbench { color: #0f766e; }
.ai-tool.workbench:hover { background: #e6f4f2; }
.ai-msg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.msg-act {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; font-size: var(--font-sm);
  border: 1px solid var(--line-soft); border-radius: 999px;
  background: transparent; color: var(--el-text-color-secondary); cursor: pointer;
  transition: all 0.15s ease;
}
.msg-act:hover { background: var(--surface-hover); color: var(--primary); border-color: var(--primary-tint-border); }
.msg-act.on { color: var(--primary); border-color: var(--primary); background: var(--primary-tint); }
.deep-task {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; font-size: var(--font-sm);
  border: 1px dashed #19988b66; border-radius: 999px;
  background: transparent; color: #0f766e; cursor: pointer;
  transition: all 0.15s ease;
}
.deep-task:hover { background: #e6f4f2; border-style: solid; }

.typing { display: flex; gap: 5px; align-items: center; }
.typing .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--primary); animation: ai-bounce 1s infinite ease-in-out; }
.typing .dot:nth-child(2) { animation-delay: 0.15s; }
.typing .dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-bounce { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-4px); } }

.ai-input { position: relative; display: flex; gap: 8px; align-items: flex-end; padding-top: 12px; border-top: 1px solid var(--line-faint); }
.ai-input textarea {
  flex: 1; box-sizing: border-box; padding: 10px 12px; resize: none;
  border: 1px solid var(--line); border-radius: 12px; font: inherit; font-size: var(--font-lg); color: var(--text);
  outline: none; transition: box-shadow 0.2s, border-color 0.2s;
}
.ai-input textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(25, 152, 139, 0.12); }
.ai-send {
  width: 42px; height: 42px; flex: none; display: grid; place-items: center;
  border: 0; border-radius: 11px; color: var(--ai-btn-fg); cursor: pointer;
  background: var(--ai-btn-bg); transition: opacity 0.15s;
}
.ai-send:disabled { opacity: 0.5; cursor: default; }

.ai-mic {
  width: 42px; height: 42px; flex: none; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: 11px; color: var(--primary); background: var(--panel); cursor: pointer;
  transition: all 0.18s;
}
.ai-mic:hover { border-color: var(--primary); background: var(--primary-tint); }
.ai-mic.on {
  color: #fff; border-color: transparent;
  background: linear-gradient(135deg, #e11d48, #f43f5e);
  animation: ai-mic-pulse 1.2s infinite;
}
@keyframes ai-mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.45); }
  50% { box-shadow: 0 0 0 7px rgba(244, 63, 94, 0); }
}

/* 单卡自动跳转过场 */
.ai-jump-mask {
  position: absolute; inset: 0; z-index: 20;
  display: grid; place-items: center;
  background: var(--scrim); backdrop-filter: blur(3px);
}
.ai-jump-card { text-align: center; color: var(--text); }
.ai-jump-spin {
  width: 40px; height: 40px; margin: 0 auto 14px;
  border: 3px solid var(--primary-tint-border); border-top-color: var(--primary); border-radius: 50%;
  animation: ai-jump-rot 0.7s linear infinite;
}
@keyframes ai-jump-rot { to { transform: rotate(360deg); } }
.ai-jump-t { font-size: var(--font-md); color: var(--muted); }
.ai-jump-page { font-size: var(--font-18); font-weight: 700; margin-top: 2px; color: var(--primary); }
.ai-jump-s { font-size: var(--font-sm); color: var(--muted); margin-top: 2px; }
.ai-jump-enter-active, .ai-jump-leave-active { transition: opacity 0.2s ease; }
.ai-jump-enter-from, .ai-jump-leave-to { opacity: 0; }

@media (max-width: 768px) {
  /* 移动端：面板全宽覆盖层（不占位不挤压主内容）*/
  .ai-dock.open { width: 0; }
  .ai-panel { width: min(92vw, 311px); }
}
</style>
