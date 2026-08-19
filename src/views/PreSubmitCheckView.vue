<script setup lang="ts">
// 申报前体检评分卡：提交申报前，由智能体做合规预检 + 偏差考核风险 + 出清博弈推演，
// 给出 go/no-go 三维评分。复用 AgentChatPanel + supervisor（派 compliance_officer /
// risk_sentinel / bidding_game_analyst 等子智能体），后端零改动。
//
// 历史侧栏（#562/#564）：左侧 AgentHistorySidebar 按 page_key="pre_submit_check" 只列本接入点
// 会话，经 panelRef + 事件协调回放/新建（照 AgentWorkbenchView 范式）。面板恒挂载：进入即由
// 面板 onMounted 恢复上次体检，点「开始体检/重新体检」= newConversation()+ask() 开新会话。
import { computed, ref } from 'vue'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import { currentRegion, packageRegionSummary } from '@/services/region/regionContext'
import { PAGE_PROMPT_KEYS } from '../prompts'
import { trustWatermark } from '@/services/data/trustGate'

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const date = ref(todayISO())
const intent = ref('')
const hasRun = ref(false)
// 重挂开新会话：runKey 递增触发面板 :key 重挂、销毁旧实例（根治与在跑流式请求的交叉污染）；
// runQuestion 平时空 → 首次挂载 onMounted 走历史恢复；run 时置为完整问题 → 重挂后 onMounted 自动发送。
const runKey = ref(0)
const runQuestion = ref('')

// 页面提示走后端白名单 key（定义见 integrations/agent-backend/.../prompts/pages.py）：服务端
// 按 key 解析固定 supervisor 提示，前端不下发自由文本，防止直连 API 注入指令绕过 SAFETY_BASELINE。
// key 常量统一在 src/prompts/pageKeys.ts，与后端白名单对齐。
const promptKey = PAGE_PROMPT_KEYS.preSubmitCheck

// 体检输入含合成/示意数据（见顶部提示）：结论口径恒为 advisory_only，结论区固定加
// 不可移除水印（trustWatermark 文案），与顶栏警示互补，杜绝被当正式申报/结算依据。
const conclusionWatermark = trustWatermark('synthetic')

const question = computed(
  () =>
    `请对「${currentRegion.value.name}」${date.value} 的拟申报做「提交前体检」并给出 go/no-go 评分卡：\n` +
    (intent.value.trim() ? `拟申报概述：${intent.value.trim()}\n` : '') +
    `1) 合规预检：用 check_declaration_compliance 校验限价、申报量、规则口径；\n` +
    `2) 偏差考核风险：评估申报与预计出力/负荷的偏差及考核费用敞口；\n` +
    `3) 出清博弈：用 estimate_rival_bidding / simulate_clearing_game 推演中标概率与出清价；\n` +
    `4) 评分卡：合规 / 风险 / 收益 三维各给 0–100 分与一句话理由，最后给总评与 go/no-go 建议。\n` +
    `结合本地区限价与结算规则；用 Markdown 表格呈现评分；不要编造数据，合成/示意数据需注明。`
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

const COLLAPSE_KEY = 'agent_history_collapsed_pre_submit_check'
const collapsed = ref<boolean>(readCollapsed())
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}
function setCollapsed(v: boolean) {
  collapsed.value = v
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// 「开始体检/重新体检」：置 runQuestion + runKey++ 重挂面板 → 新实例 onMounted 自动发送开新会话
//（一次一份体检评分卡，历史侧栏据此累积）。重挂销毁旧实例，避免与在跑流式请求交叉污染。
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
  <div class="ps-root">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="智能体体检结果为分析示意，含合成/模拟数据，仅供参考，请勿作为正式申报依据。"
    />
    <header class="ps-head">
      <div class="ps-title">
        <h2>✅ 申报前体检评分卡</h2>
        <span class="ps-sub">{{ currentRegion.name }} · 提交前合规 / 风险 / 博弈三维体检与 go/no-go 建议</span>
      </div>
    </header>
    <div class="ps-form">
      <label class="ps-field">目标日<input v-model="date" type="date" /></label>
      <label class="ps-field ps-grow">拟申报概述（可选）
        <input v-model="intent" type="text" placeholder="如：晚高峰顶格申报 80MW，午谷压价补仓" />
      </label>
      <el-button type="primary" @click="run">{{ hasRun ? '重新体检' : '开始体检' }}</el-button>
    </div>
    <div class="ps-workspace">
      <aside class="ps-aside" :class="{ collapsed }">
        <AgentHistorySidebar
          ref="sidebarRef"
          page-key="pre_submit_check"
          :active-session-id="activeSessionId"
          :collapsed="collapsed"
          @select="onSelectHistory"
          @new-chat="onNewChat"
          @update:collapsed="setCollapsed"
        />
      </aside>
      <div class="ps-body">
        <AgentChatPanel
          ref="panelRef"
          :key="runKey"
          scenario="chat"
          :initial-question="runQuestion"
          :payload="regionPayload"
          :prompt-key="promptKey"
          history-key="pre_submit_check"
          @history-changed="onHistoryChanged"
          @session-ready="onSessionReady"
        />
      </div>
    </div>
    <!-- 结论区不可移除水印：体检口径 advisory_only，非结算/申报依据（trustGate.trustWatermark）常驻 -->
    <div class="ps-watermark">{{ conclusionWatermark }}</div>
  </div>
</template>

<style scoped>
.ps-root { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.ps-head {
  padding: 14px 18px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.ps-title h2 { margin: 0; font-size: var(--font-19); color: var(--text, #111); }
.ps-sub { font-size: var(--font-12-5); color: var(--muted, #667085); }
.ps-form {
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px;
  padding: 12px 18px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.ps-field { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-12-5); font-weight: 600; color: var(--text-body, #222); }
.ps-grow { flex: 1; min-width: 240px; }
.ps-field input {
  padding: 7px 10px; font-size: var(--font-md); font-weight: 400;
  border: 1px solid var(--line, #d0d5dd); border-radius: 8px; background: var(--panel, #fff); color: var(--text-body, #222);
}
/* 两列工作区：左历史侧栏 + 右对话面板 */
.ps-workspace { flex: 1; min-height: 0; display: flex; gap: 12px; }
.ps-aside { width: 260px; flex-shrink: 0; transition: width 0.18s ease; }
.ps-aside.collapsed { width: 48px; }
.ps-body {
  flex: 1; min-width: 0;
  background: var(--panel, #fff); border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 14px; overflow: hidden;
}
.ps-watermark {
  padding: 7px 14px; font-size: var(--font-sm); line-height: 1.5;
  font-family: var(--ck-mono, 'SF Mono', ui-monospace, monospace);
  color: var(--warning, #b45309);
  background: color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning, #f59e0b) 32%, transparent);
  border-radius: 10px;
}
@media (max-width: 900px) {
  /* 窄屏：侧栏收成顶部窄条，面板占全宽堆叠 */
  .ps-workspace { flex-direction: column; }
  .ps-aside { width: 100%; height: 44px; overflow: hidden; }
  .ps-aside.collapsed { width: 100%; }
  .ps-body { min-height: 420px; }
}
</style>
