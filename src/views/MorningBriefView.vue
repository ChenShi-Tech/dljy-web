<script setup lang="ts">
// 交易晨报（工作台）：确定性状态机 + dljy-ui 生成式工作台。
// 左栏「数据预检」：fetchMorningBriefBundle 确定性装配 bundle，直接用 dljy-ui 组件
//   （DataQualityPanel/MarketSnapshot/ForecastBandCard/RiskChecklist）确定性渲染一屏结构化
//   数据——不依赖 LLM，点预检即有内容（前后端对齐：后端 bundle 7 类数据这里全部上屏）。
// 右栏「晨报研判」：AgentChatPanel scenario="morning_brief" 驱动后端四角色并行确定性图
//   （assemble→gap_check→四角色 fan-out→compose→confirm→finalize）；graph_status 进度、
//   gap_check/confirm 两 interrupt 的 approval_request、compose 产出的 dljy-ui 围栏均自动渲染。
//
// 历史侧栏（#562/#564）：最左 AgentHistorySidebar 按 page_key="morning_brief" 只列本接入点会话，
// 经 panelRef + 事件协调回放/新建（照 AgentWorkbenchView 范式）。三列布局历史侧栏默认折叠省空间。
// 面板恒挂载：进入即由面板 onMounted 恢复上次晨报，点「生成晨报/重新生成」= 先跑数据预检再
// newConversation()+ask(date) 开新晨报会话（首条发目标日期，等价原 initial-question）。
import { computed, ref } from 'vue'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import DataQualityPanel from '../components/agent/dljy-ui/common/DataQualityPanel.vue'
import RiskChecklist from '../components/agent/dljy-ui/common/RiskChecklist.vue'
import MarketSnapshot from '../components/agent/dljy-ui/brief/MarketSnapshot.vue'
import ForecastBandCard from '../components/agent/dljy-ui/brief/ForecastBandCard.vue'
import { currentRegion } from '@/services/region/regionContext'
import { PAGE_PROMPT_KEYS } from '../prompts'
import { fetchMorningBriefBundle, type MorningBriefBundle } from '@/services/agent/morningBriefClient'

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const date = ref(todayISO())
const hasRun = ref(false)
const promptKey = PAGE_PROMPT_KEYS.morningBrief
// 重挂开新会话：runKey 递增触发面板 :key 重挂、销毁旧实例（根治与在跑流式请求的交叉污染）；
// runQuestion 平时空 → 首次挂载 onMounted 走历史恢复；生成时置为目标日期 → 重挂后 onMounted 自动发送启动状态机。
const runKey = ref(0)
const runQuestion = ref('')

const bundle = ref<MorningBriefBundle | null>(null)
const bundleLoading = ref(false)
const bundleError = ref('')

// 确定性渲染：把 bundle 各分块映射到对应 dljy-ui 组件 props（不经 LLM）。
const forecastBand = computed(() => (bundle.value?.forecast_band ?? {}) as Record<string, unknown>)
const risk = computed(() => (bundle.value?.risk ?? {}) as Record<string, unknown>)
const basisLabel = computed(() =>
  bundle.value ? (bundle.value.basis === 'captured' ? '真实采集' : '含模拟/缺失') : ''
)

async function runPrecheck() {
  bundleLoading.value = true
  bundleError.value = ''
  try {
    bundle.value = await fetchMorningBriefBundle({
      date: date.value,
      region_id: currentRegion.value.id,
      region_name: currentRegion.value.name
    })
  } catch (e) {
    bundleError.value = e instanceof Error ? e.message : String(e)
  } finally {
    bundleLoading.value = false
  }
}

// 晨报 scenario：AgentChatPanel 首条消息发目标日期（后端解析为 brief_date 启动图）；
// payload 带地区与运行模式（后端注入图初始 state；region 主要靠 x-region-id 头，此为回退+region_name）。
const briefPayload = computed(() => ({
  region_id: currentRegion.value.id,
  region_name: currentRegion.value.name,
  run_mode: 'interactive'
}))

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

// 三列布局较宽 → 历史侧栏默认折叠（无 localStorage 记录时 true），用户可按需展开。
const COLLAPSE_KEY = 'agent_history_collapsed_morning_brief'
const collapsed = ref<boolean>(readCollapsed())
function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY)
    return v === null ? true : v === '1'
  } catch { return true }
}
function setCollapsed(v: boolean) {
  collapsed.value = v
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// 「生成晨报/重新生成」：先跑数据预检装配左栏，再置 runQuestion=目标日期 + runKey++ 重挂面板 →
// 新实例 onMounted 自动发送日期启动确定性状态机。重挂销毁旧实例，避免与在跑流式请求交叉污染。
async function generate() {
  if (!bundle.value && !bundleError.value) await runPrecheck()
  runQuestion.value = date.value
  runKey.value++
  hasRun.value = true
  activeSessionId.value = null
}
function onSelectHistory(sessionId: string) {
  runQuestion.value = '' // 防御：清待发送目标日期，杜绝未来重挂 onMounted 误发覆盖已回放历史
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
  <div class="mb-root">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="智能体生成内容为分析示意，含合成/模拟数据，仅供参考，请勿作为实际交易决策依据。"
    />
    <header class="mb-head">
      <div class="mb-title">
        <h2>📰 交易晨报</h2>
        <span class="mb-sub">{{ currentRegion.name }} · 数据预检 + 四角色并行确定性状态机</span>
      </div>
      <div class="mb-ctrl">
        <input v-model="date" type="date" class="mb-date" />
        <el-button :loading="bundleLoading" @click="runPrecheck">数据预检</el-button>
        <el-button type="primary" @click="generate">{{ hasRun ? '重新生成' : '生成晨报' }}</el-button>
      </div>
    </header>

    <div class="mb-main">
      <!-- 最左：历史会话侧栏（page_key 隔离，默认折叠） -->
      <aside class="mb-aside" :class="{ collapsed }">
        <AgentHistorySidebar
          ref="sidebarRef"
          page-key="morning_brief"
          :active-session-id="activeSessionId"
          :collapsed="collapsed"
          @select="onSelectHistory"
          @new-chat="onNewChat"
          @update:collapsed="setCollapsed"
        />
      </aside>

      <!-- 中栏：数据预检工作台（bundle 各分块 → dljy-ui 组件确定性渲染，不依赖 LLM） -->
      <aside v-if="bundle || bundleError" class="mb-rail">
        <div v-if="bundleError" class="mb-err">
          数据预检失败：{{ bundleError }}（请确认 agent-backend 已启动）
        </div>
        <template v-else-if="bundle">
          <div class="mb-rail-tag" :class="bundle.basis === 'captured' ? 't-real' : 't-mock'">
            数据口径：{{ basisLabel }}
          </div>
          <DataQualityPanel :data="bundle" title="数据预检" :basis="bundle.basis" />
          <MarketSnapshot :data="bundle" title="市场快照" :basis="bundle.basis" />
          <ForecastBandCard :data="forecastBand" title="次日价格预测带" basis="forecast" />
          <RiskChecklist :data="risk" title="风险清单" basis="synthetic" />
        </template>
      </aside>

      <!-- 右栏：晨报研判（确定性状态机 + 四角色并行 + dljy-ui 围栏），面板恒挂载 -->
      <section class="mb-stage">
        <AgentChatPanel
          ref="panelRef"
          :key="runKey"
          scenario="morning_brief"
          :initial-question="runQuestion"
          :payload="briefPayload"
          :prompt-key="promptKey"
          history-key="morning_brief"
          @history-changed="onHistoryChanged"
          @session-ready="onSessionReady"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.mb-root { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.mb-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 14px 18px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.mb-title h2 { margin: 0; font-size: 19px; color: var(--text, #111); }
.mb-sub { font-size: 12.5px; color: var(--muted, #667085); }
.mb-ctrl { display: flex; align-items: center; gap: 10px; }
.mb-date {
  padding: 7px 10px; font-size: 13px; border: 1px solid var(--line, #d0d5dd);
  border-radius: 8px; background: var(--panel, #fff); color: var(--text-body, #222);
}
.mb-main { flex: 1; min-height: 0; display: flex; gap: 12px; }
.mb-aside { width: 260px; flex-shrink: 0; transition: width 0.18s ease; }
.mb-aside.collapsed { width: 48px; }
.mb-rail {
  width: 380px; flex: none; overflow-y: auto; padding-right: 2px;
  display: flex; flex-direction: column; gap: 12px;
}
.mb-rail-tag { font-size: 12px; padding: 5px 10px; border-radius: 8px; align-self: flex-start; }
.mb-rail-tag.t-real { color: #15803d; background: rgba(22, 163, 74, 0.12); }
.mb-rail-tag.t-mock { color: #b45309; background: rgba(245, 158, 11, 0.14); }
.mb-err { font-size: 13px; color: #dc2626; padding: 12px 16px; background: var(--panel, #fff); border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px; }
.mb-stage {
  flex: 1; min-width: 0; min-height: 0;
  background: var(--panel, #fff); border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 14px; overflow: hidden;
}
@media (max-width: 1024px) {
  /* 窄屏：三列改纵向堆叠，历史侧栏与预检栏限高，面板保底高度 */
  .mb-main { flex-direction: column; }
  .mb-aside { width: 100%; height: 44px; overflow: hidden; }
  .mb-aside.collapsed { width: 100%; }
  .mb-rail { width: auto; max-height: 46vh; }
  .mb-stage { min-height: 420px; }
}
</style>
