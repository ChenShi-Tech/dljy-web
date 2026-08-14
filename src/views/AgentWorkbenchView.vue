<script setup lang="ts">
// 智能体工作台：左侧历史对话侧边栏 + 右侧交互式 Agent 对话面板（/ai-agent）。
// 依赖 agent-backend 的 /api/agent/*（经 vite 代理 /agent-api）做对话，
// 聊天历史经 Node /api/agent-history/* 持久化（按登录用户隔离）。
//
// 深链：?q=<问题> 由浮层 AI 助手「交给智能体深度处理」移交并自动开跑；
// ?scenario=declaration_prep|daily_review 指定会话场景。scenario/q 须保持响应式：
// 工作台已挂载时浮层再次移交（query 变化）要 remount 面板开新会话。
//
// 历史侧栏与面板通过组件 ref + 事件协调（不靠 query 重挂）：
// - 选中历史会话 → 调 panel.loadHistory(id) 回放并续聊（不自动发 initialQuestion）；
// - 新建对话 → 调 panel.newConversation() 清空重来；
// - 面板每次会话变更（注册/新增轮次/恢复）→ emit historyChanged → 侧栏 reload；
// - 面板会话就绪 → emit sessionReady → 侧栏高亮当前会话。
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import type { AgentScenario } from '@/services/agent/agentClient'

const route = useRoute()
const initialQuestion = computed(() =>
  typeof route.query.q === 'string' ? route.query.q : ''
)
const SCENARIOS: AgentScenario[] = ['chat', 'declaration_prep', 'daily_review']
const scenario = computed<AgentScenario>(() =>
  SCENARIOS.includes(route.query.scenario as AgentScenario)
    ? (route.query.scenario as AgentScenario)
    : 'chat'
)

type PanelExpose = {
  ask: (q: string) => void
  newConversation: () => void
  loadHistory: (id: string, opts?: { fromClick?: boolean }) => Promise<void>
}
type SidebarExpose = { reload: () => Promise<void> }

const panelRef = ref<PanelExpose | null>(null)
const sidebarRef = ref<SidebarExpose | null>(null)
const activeSessionId = ref<string | null>(null)

const COLLAPSE_KEY = 'agent_history_collapsed'
const collapsed = ref<boolean>(readCollapsed())
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}
function setCollapsed(v: boolean) {
  collapsed.value = v
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

function onSelectHistory(sessionId: string) {
  void panelRef.value?.loadHistory(sessionId, { fromClick: true })
}
function onNewChat() {
  panelRef.value?.newConversation()
  activeSessionId.value = null
}
function onHistoryChanged() {
  void sidebarRef.value?.reload()
}
function onSessionReady(sessionId: string) {
  activeSessionId.value = sessionId
}
</script>

<template>
  <div class="agent-workbench">
    <aside class="wb-aside" :class="{ collapsed }">
      <AgentHistorySidebar
        ref="sidebarRef"
        :active-session-id="activeSessionId"
        :collapsed="collapsed"
        @select="onSelectHistory"
        @new-chat="onNewChat"
        @update:collapsed="setCollapsed"
      />
    </aside>
    <main class="wb-main">
      <AgentChatPanel
        ref="panelRef"
        :key="scenario + '|' + initialQuestion"
        :scenario="scenario"
        :initial-question="initialQuestion"
        :prompt-key="PAGE_PROMPT_KEYS.workbench"
        history-key="workbench"
        @history-changed="onHistoryChanged"
        @session-ready="onSessionReady"
      />
    </main>
  </div>
</template>

<style scoped>
.agent-workbench {
  display: flex;
  height: calc(100vh - 120px);
  padding: 12px;
  gap: 0;
}
.wb-aside {
  width: 270px;
  flex-shrink: 0;
  transition: width 0.18s ease;
}
.wb-aside.collapsed {
  width: 48px;
}
.wb-main {
  flex: 1;
  min-width: 0;
}
@media (max-width: 768px) {
  /* 移动端：折叠态省空间，展开态侧栏盖在上方由内部滚动 */
  .wb-aside { width: 220px; }
  .wb-aside.collapsed { width: 44px; }
}
@media (max-width: 480px) {
  /* 小屏手机：侧栏始终折叠态，主内容占全宽 */
  .agent-workbench { flex-direction: column; height: auto; min-height: calc(100vh - 120px); }
  .wb-aside { width: 100% !important; height: 44px; overflow: hidden; flex-shrink: 0; }
  .wb-aside.collapsed { width: 100% !important; }
  .wb-main { min-height: 0; flex: 1; }
}
</style>
