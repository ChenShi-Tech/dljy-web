<script setup lang="ts">
// 政策情报官：智能体拉取交易中心/国网/能源局披露与政策，按对本地区现货交易策略的
// 相关性打分、标注影响限价/结算/偏差考核/新能源申报的规则变更。复用 AgentChatPanel +
// data_collector / compliance_officer 子智能体（已含 fetch_disclosures /
// list_disclosures_by_category / search_market_rules 工具），后端零改动。
//
// 历史侧栏（#562/#564）：左侧 AgentHistorySidebar 按 page_key="policy_intel" 只列本接入点会话，
// 经 panelRef + 事件协调回放/新建（照 AgentWorkbenchView 范式）。面板恒挂载：进入即由面板
// onMounted 恢复上次会话，点「汇集情报」= newConversation()+ask() 开新情报会话（每次一份）。
import { computed, ref } from 'vue'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import { currentRegion, packageRegionSummary } from '@/services/region/regionContext'
import { PAGE_PROMPT_KEYS } from '../prompts'

const keyword = ref('')
const hasRun = ref(false)
// 重挂开新会话：runKey 递增触发面板 :key 重挂、销毁旧实例（根治与在跑流式请求的交叉污染）；
// runQuestion 平时空 → 首次挂载 onMounted 走历史恢复；run 时置为完整问题 → 重挂后 onMounted 自动发送。
const runKey = ref(0)
const runQuestion = ref('')

// 页面提示走后端白名单 key（定义见 integrations/agent-backend/.../prompts/pages.py）：服务端
// 按 key 解析固定 supervisor 提示，前端不下发自由文本，防止直连 API 注入指令绕过 SAFETY_BASELINE。
// key 常量统一在 src/prompts/pageKeys.ts，与后端白名单对齐。
const promptKey = PAGE_PROMPT_KEYS.policyIntel

const question = computed(
  () =>
    `请汇集近期与「${currentRegion.value.name}」电力现货交易相关的` +
    `交易中心 / 国网 / 能源局披露公告与政策文件` +
    (keyword.value.trim() ? `（聚焦关键词：${keyword.value.trim()}）` : '') +
    `，并：\n` +
    `1) 用 fetch_disclosures / list_disclosures_by_category / search_market_rules 工具检索；\n` +
    `2) 对每条按「对本地区现货交易策略的相关性」打分（高/中/低）并一句话说明；\n` +
    `3) 重点标注影响限价 / 结算 / 偏差考核 / 新能源申报的规则变更；\n` +
    `4) 汇总：哪些工作台或策略需据此调整。\n` +
    `用 Markdown 表格呈现情报清单（来源/标题/相关性/影响）；不要编造，合成/示意数据需注明。`
)
const regionPayload = computed(() => packageRegionSummary() as unknown as Record<string, unknown>)

// ── 历史侧栏协调（照 AgentWorkbenchView 范式）──
type PanelExpose = {
  ask: (q: string) => void
  newConversation: () => void
  loadHistory: (id: string, opts?: { fromClick?: boolean }) => Promise<void>
}
type SidebarExpose = { reload: () => Promise<void> }
const panelRef = ref<PanelExpose | null>(null)
const sidebarRef = ref<SidebarExpose | null>(null)
const activeSessionId = ref<string | null>(null)

const COLLAPSE_KEY = 'agent_history_collapsed_policy_intel'
const collapsed = ref<boolean>(readCollapsed())
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}
function setCollapsed(v: boolean) {
  collapsed.value = v
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// 「汇集情报/刷新情报」：置 runQuestion + runKey++ 重挂面板 → 新实例 onMounted 自动发送开新会话
//（一次生成一份情报，历史侧栏据此累积）。重挂销毁旧实例，避免与在跑流式请求交叉污染。
function run() {
  runQuestion.value = question.value
  runKey.value++
  hasRun.value = true
  activeSessionId.value = null
}
function onSelectHistory(sessionId: string) {
  runQuestion.value = '' // 防御：清待发送模板问题，杜绝未来重挂 onMounted 误发覆盖已回放历史
  void panelRef.value?.loadHistory(sessionId, { fromClick: true })
  hasRun.value = true
}
function onNewChat() {
  runQuestion.value = ''
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
  <div class="pi-root">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="智能体情报内容为分析示意，含合成/模拟数据，仅供参考，请以官方渠道披露为准。"
    />
    <header class="pi-head">
      <div class="pi-title">
        <h2>🛰️ 政策情报官</h2>
        <span class="pi-sub">{{ currentRegion.name }} · 智能体汇集披露/政策并按相关性打分</span>
      </div>
    </header>
    <div class="pi-form">
      <label class="pi-field pi-grow">关注关键词（可选）
        <input v-model="keyword" type="text" placeholder="如：限价调整、新能源入市、偏差考核细则" />
      </label>
      <el-button type="primary" @click="run">{{ hasRun ? '刷新情报' : '汇集情报' }}</el-button>
    </div>
    <div class="pi-workspace">
      <aside class="pi-aside" :class="{ collapsed }">
        <AgentHistorySidebar
          ref="sidebarRef"
          page-key="policy_intel"
          :active-session-id="activeSessionId"
          :collapsed="collapsed"
          @select="onSelectHistory"
          @new-chat="onNewChat"
          @update:collapsed="setCollapsed"
        />
      </aside>
      <div class="pi-body">
        <AgentChatPanel
          ref="panelRef"
          :key="runKey"
          scenario="chat"
          :initial-question="runQuestion"
          :payload="regionPayload"
          :prompt-key="promptKey"
          history-key="policy_intel"
          @history-changed="onHistoryChanged"
          @session-ready="onSessionReady"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pi-root { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.pi-head {
  padding: 14px 18px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.pi-title h2 { margin: 0; font-size: var(--font-19); color: var(--text, #111); }
.pi-sub { font-size: var(--font-12-5); color: var(--muted, #667085); }
.pi-form {
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px;
  padding: 12px 18px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.pi-field { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-12-5); font-weight: 600; color: var(--text-body, #222); }
.pi-grow { flex: 1; min-width: 240px; }
.pi-field input {
  padding: 7px 10px; font-size: var(--font-md); font-weight: 400;
  border: 1px solid var(--line, #d0d5dd); border-radius: 8px; background: var(--panel, #fff); color: var(--text-body, #222);
}
/* 两列工作区：左历史侧栏 + 右对话面板 */
.pi-workspace { flex: 1; min-height: 0; display: flex; gap: 12px; }
.pi-aside { width: 260px; flex-shrink: 0; transition: width 0.18s ease; }
.pi-aside.collapsed { width: 48px; }
.pi-body {
  flex: 1; min-width: 0;
  background: var(--panel, #fff); border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 14px; overflow: hidden;
}
@media (max-width: 900px) {
  /* 窄屏：侧栏收成顶部窄条，面板占全宽堆叠 */
  .pi-workspace { flex-direction: column; }
  .pi-aside { width: 100%; height: 44px; overflow: hidden; }
  .pi-aside.collapsed { width: 100%; }
  .pi-body { min-height: 420px; }
}
</style>
