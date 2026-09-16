<script setup lang="ts">
// 智能体工作台（/ai-agent）：六个入口合并后的唯一对话工作台（#2023）。
//
// 合并前「AI 交易助手」下并排挂着 6 个页面，全是 AgentChatPanel 的薄壳，各自复制一份
// 「历史侧栏 + 面板 + 启动问 + 折叠状态」。真正的差异只有四项（scenario / 页面提示 key /
// 启动问 / 额外挂件），已声明化进 services/agent/workbenchEntries.ts，壳在这里只写一遍。
//
// 布局：左历史侧栏 · 中入口专属挂件（仅晨报有）· 右对话面板；顶部是入口切换 + 该入口的
// 输入控件 + 启动按钮。切换入口 = 换 (scenario, promptKey, historyKey) 三元组。
//
// **historyKey 按入口隔离、没有跨入口聚合**：每个入口的历史本来就是按自己的 page_key 落的，
// 聚合会把六份历史混进一个列表（反而找不着），分开则一条不丢、与合并前语义一致。
//
// 深链：
// - `?entry=<key>` 主参数（五条旧路径的 redirect 一律带它）；
// - `?scenario=` 仍认（浮层助手「交给智能体深度处理」与合并前工作台在用），映射见 resolveEntry；
// - `?q=<问题>` 由浮层移交并自动开跑。
// 三者都要保持响应式：工作台已挂载时浮层再次移交（query 变化）要 remount 面板开新会话。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import AgentHistorySidebar from '../components/agent/AgentHistorySidebar.vue'
import MorningBriefRail from '../components/agent/workbench/MorningBriefRail.vue'
import StrategicQaGaps from '../components/agent/workbench/StrategicQaGaps.vue'
import CheckupAutoApprove from '../components/agent/workbench/CheckupAutoApprove.vue'
import { currentRegion, packageRegionSummary } from '@/services/region/regionContext'
import { trustWatermark } from '@/services/data/trustGate'
import {
  WORKBENCH_ENTRIES,
  initialInputValues,
  resolveEntry,
  type WorkbenchEntry
} from '@/services/agent/workbenchEntries'

const route = useRoute()
const router = useRouter()

const resolved = computed(() => resolveEntry(route.query))
const entry = computed<WorkbenchEntry>(() => resolved.value.entry)
const scenario = computed(() => resolved.value.scenario)
const initialQuestion = computed(() =>
  typeof route.query.q === 'string' ? route.query.q : ''
)

// 输入控件的值按入口隔离保存：切回某个入口时它上次填的日期/关键词还在。
// 初始化由 watch(immediate) 负责而不是写在 computed 里：computed 内写 ref 是副作用
// （eslint vue/no-side-effects-in-computed-properties），求值期改依赖会让 Vue 在同一
// 轮里重新求值，且 setValue 的写回目标可能是个还没进 inputsByEntry 的临时对象。
const inputsByEntry = ref<Record<string, Record<string, string>>>({})
function ensureValues(key: string): Record<string, string> {
  if (!inputsByEntry.value[key]) inputsByEntry.value[key] = initialInputValues(entry.value)
  return inputsByEntry.value[key]
}
watch(() => entry.value.key, (key) => { ensureValues(key) }, { immediate: true })
const values = computed<Record<string, string>>(() => inputsByEntry.value[entry.value.key] || {})
function setValue(inputKey: string, v: string) {
  ensureValues(entry.value.key)[inputKey] = v
}

// 重挂开新会话：runKey 递增触发面板 :key 重挂、销毁旧实例（根治与在跑流式请求的交叉污染）。
// runQuestion 平时空 → 首次挂载 onMounted 走历史恢复；启动时置为完整问题 → 重挂后自动发送。
const runKey = ref(0)
const runQuestion = ref('')
const hasRun = ref(false)
const activeSessionId = ref<string | null>(typeof route.query.session === 'string' ? route.query.session : null)
// 续接指定会话（统一 AI 侧边栏「在工作台打开」经 ?session= 传入）：只作用于进入后的第一次挂载，
// 用户随后开始新任务/新建/切入口时清掉，避免面板重挂时又被恢复成这个会话。
const resumeTarget = ref<string>(typeof route.query.session === 'string' ? route.query.session : '')
watch(() => route.query.session, (v) => {
  resumeTarget.value = typeof v === 'string' ? v : ''
  if (resumeTarget.value) {
    activeSessionId.value = resumeTarget.value
    runKey.value++
  }
})

const briefRailRef = ref<{ ensureLoaded: () => Promise<void> } | null>(null)

// 结论区不可移除水印（申报前体检）：输入含合成/示意数据，结论口径恒为 advisory_only。
// 与顶栏通用警示互补——顶栏说的是「这一页的内容」，水印钉的是「这一条结论」的口径，
// 防止用户把评分卡截图当成正式申报/结算依据。守卫见 verify:trust-gate。
const conclusionWatermark = computed(() =>
  entry.value.watermarkBasis ? trustWatermark(entry.value.watermarkBasis) : ''
)

// 换入口 = 换会话上下文：清掉待发送问题与当前会话高亮，避免上一个入口的状态串过来
watch(() => entry.value.key, () => {
  runQuestion.value = ''
  hasRun.value = false
  // 同一次导航可能同时换入口并带 ?session=（侧边栏「在工作台打开」，工作台页被缓存时）：以路由为准，
  // 不能无条件清空，否则先执行的 session watch 刚设好的续接目标会被这里抹掉
  const session = typeof route.query.session === 'string' ? route.query.session : ''
  resumeTarget.value = session
  activeSessionId.value = session || null
  collapsed.value = readCollapsed()
  runKey.value++
})

const payload = computed<Record<string, unknown> | undefined>(() => {
  const base = entry.value.sendRegionSummary
    ? (packageRegionSummary() as unknown as Record<string, unknown>)
    : undefined
  if (entry.value.key !== 'morning_brief') return base
  // 晨报：地区随消息下发（region 主要靠 x-region-id 头，此为回退 + region_name）
  return {
    ...(base || {}),
    region_id: currentRegion.value.id,
    region_name: currentRegion.value.name
  }
})

// 续接目标一旦被放弃（开始新任务/新建/选历史），同步去掉地址栏里的 ?session=，
// 否则刷新或分享链接会重新打开那个旧会话（dljy-web#119 审查 P2）
function dropSessionQuery() {
  if (typeof route.query.session !== 'string') return
  const { session: _session, ...rest } = route.query
  void router.replace({ path: '/ai-agent', query: rest })
}

async function start() {
  if (entry.value.key === 'morning_brief') await briefRailRef.value?.ensureLoaded()
  runQuestion.value = entry.value.buildQuestion
    ? entry.value.buildQuestion({ values: values.value, regionName: currentRegion.value.name })
    : ''
  resumeTarget.value = ''
  dropSessionQuery()
  runKey.value++
  hasRun.value = true
  activeSessionId.value = null
}

function selectEntry(key: string) {
  if (key === entry.value.key) return
  // 走路由而不是本地状态：入口是可分享的深链，切换后地址栏要跟着变
  void router.replace({ path: '/ai-agent', query: { entry: key } })
}

// ── 历史侧栏协调 ──
type PanelExpose = {
  ask: (q: string) => void
  newConversation: () => void
  loadHistory: (id: string, opts?: { fromClick?: boolean }) => Promise<void>
}
type SidebarExpose = { reload: () => Promise<void> }
const panelRef = ref<PanelExpose | null>(null)
const sidebarRef = ref<SidebarExpose | null>(null)

const collapsed = ref<boolean>(readCollapsed())
function collapseKey(): string {
  // 折叠状态按入口分开记：晨报三列布局默认折叠，通用对话默认展开（与合并前各页一致）
  return `agent_history_collapsed_${entry.value.key}`
}
function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(collapseKey())
    return v === null ? entry.value.collapsedByDefault === true : v === '1'
  } catch { return entry.value.collapsedByDefault === true }
}
function setCollapsed(v: boolean) {
  collapsed.value = v
  try { localStorage.setItem(collapseKey(), v ? '1' : '0') } catch { /* ignore */ }
}

function onSelectHistory(sessionId: string) {
  runQuestion.value = '' // 防御：清待发送启动问，杜绝未来重挂 onMounted 误发覆盖已回放历史
  dropSessionQuery()
  void panelRef.value?.loadHistory(sessionId, { fromClick: true })
  hasRun.value = true
}
function onNewChat() {
  runQuestion.value = ''
  resumeTarget.value = ''
  dropSessionQuery()
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
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="智能体生成内容为分析示意，含合成/模拟数据，仅供参考，请勿作为实际交易决策依据。"
    />
    <header class="wb-head">
      <nav class="wb-entries" role="tablist" aria-label="智能体入口">
        <button
          v-for="e in WORKBENCH_ENTRIES"
          :key="e.key"
          type="button"
          role="tab"
          class="wb-entry"
          :class="{ active: e.key === entry.key }"
          :aria-selected="e.key === entry.key"
          :title="e.desc"
          @click="selectEntry(e.key)"
        >
          {{ e.title }}
        </button>
      </nav>
      <p class="wb-desc">{{ entry.desc }}</p>
      <div v-if="entry.inputs?.length || entry.buildQuestion" class="wb-ctrl">
        <template v-for="input in entry.inputs || []" :key="input.key">
          <label class="wb-field">
            <span class="wb-label">{{ input.label }}</span>
            <input
              v-if="input.kind === 'date'"
              type="date"
              class="wb-input wb-date"
              :value="values[input.key]"
              @input="setValue(input.key, ($event.target as HTMLInputElement).value)"
            />
            <input
              v-else
              type="text"
              class="wb-input"
              :placeholder="input.placeholder"
              :value="values[input.key]"
              @input="setValue(input.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
        <el-button v-if="entry.buildQuestion" type="primary" @click="start">
          {{ hasRun ? '重新开始' : (entry.actionLabel || '开始') }}
        </el-button>
      </div>
      <div v-if="conclusionWatermark" class="wb-watermark">{{ conclusionWatermark }}</div>
      <StrategicQaGaps v-if="entry.extra === 'strategic-qa-gaps'" />
      <CheckupAutoApprove
        v-if="entry.extra === 'checkup-auto-approve'"
        :session-id="activeSessionId || ''"
      />
    </header>

    <div class="wb-body">
      <aside class="wb-aside" :class="{ collapsed }">
        <AgentHistorySidebar
          ref="sidebarRef"
          :page-key="entry.key"
          :active-session-id="activeSessionId"
          :collapsed="collapsed"
          @select="onSelectHistory"
          @new-chat="onNewChat"
          @update:collapsed="setCollapsed"
        />
      </aside>

      <MorningBriefRail
        v-if="entry.extra === 'morning-brief-rail'"
        ref="briefRailRef"
        :date="values.date || ''"
      />

      <main class="wb-main">
        <AgentChatPanel
          ref="panelRef"
          :key="entry.key + '|' + scenario + '|' + runKey + '|' + initialQuestion"
          :scenario="scenario"
          :initial-question="runQuestion || initialQuestion"
          :resume-session-id="resumeTarget || null"
          :payload="payload"
          :prompt-key="entry.promptKey"
          :history-key="entry.key"
          @history-changed="onHistoryChanged"
          @session-ready="onSessionReady"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.agent-workbench {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  padding: 12px;
  gap: 12px;
}
.wb-head {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 16px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.wb-entries { display: flex; flex-wrap: wrap; gap: 6px; }
.wb-entry {
  padding: 6px 12px; font-size: var(--font-md); cursor: pointer;
  border: 1px solid var(--line, #d0d5dd); border-radius: 999px;
  background: transparent; color: var(--text-body, #222);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.wb-entry:hover { border-color: var(--el-color-primary, #409eff); }
.wb-entry.active {
  background: var(--el-color-primary, #409eff); color: #fff;
  border-color: var(--el-color-primary, #409eff);
}
.wb-desc { margin: 0; font-size: var(--font-12-5); color: var(--muted, #667085); }
.wb-watermark {
  font-size: var(--font-sm); color: #b45309; background: rgba(245, 158, 11, 0.12);
  padding: 5px 10px; border-radius: 8px; align-self: flex-start;
}
.wb-ctrl { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.wb-field { display: flex; flex-direction: column; gap: 4px; }
.wb-label { font-size: var(--font-sm); color: var(--muted, #667085); }
.wb-input {
  padding: 7px 10px; font-size: var(--font-md); border: 1px solid var(--line, #d0d5dd);
  border-radius: 8px; background: var(--panel, #fff); color: var(--text-body, #222);
}
.wb-input:not(.wb-date) { min-width: 240px; }
.wb-body { flex: 1; min-height: 0; display: flex; gap: 12px; }
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
  min-height: 0;
}
@media (max-width: 1024px) {
  /* 窄屏：侧栏与挂件栏改纵向堆叠，面板保底高度 */
  .wb-body { flex-direction: column; }
  .wb-aside { width: 100%; height: 44px; overflow: hidden; }
  .wb-aside.collapsed { width: 100%; }
  .wb-main { min-height: 420px; }
}
@media (max-width: 480px) {
  .agent-workbench { height: auto; min-height: calc(100vh - 120px); }
  .wb-input:not(.wb-date) { min-width: 0; width: 100%; }
}
</style>
