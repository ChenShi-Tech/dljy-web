<script setup lang="ts">
// 智能体历史对话侧边栏（类 ChatGPT 左栏）：按登录用户列出历史会话，
// 点击回放并续聊；支持新建、重命名、删除、折叠。
// 数据走 Node /api/agent-history（见 services/agentClient.ts + server/chat-store.mjs），
// 按登录 token 隔离——每个用户只看到自己的历史。
import { onMounted, ref, watch } from 'vue'
import { Loader2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Pencil, Trash2 } from 'lucide-vue-next'
import SavedAnalysisViews from './SavedAnalysisViews.vue'
import {
  listHistorySessions,
  renameHistorySession,
  deleteHistorySession,
  type AgentRunScenario,
  type HistorySessionMeta
} from '@/services/agent/agentClient'

const props = withDefaults(
  defineProps<{ activeSessionId?: string | null; collapsed?: boolean; pageKey?: string }>(),
  { activeSessionId: null, collapsed: false, pageKey: '' }
)
const emit = defineEmits<{
  select: [sessionId: string, scenario: AgentRunScenario]
  newChat: []
  'update:collapsed': [value: boolean]
}>()

const sessions = ref<HistorySessionMeta[]>([])
const loading = ref(false)
const errorMsg = ref('')
const editingId = ref<string | null>(null)
const editingTitle = ref('')
// Esc 取消重命名护栏：Esc → cancelRename 置位 → 移除 input 触发 @blur → commitRename 据此跳过（否则 Esc 仍会提交）
let justCancelled = false

const SCENARIO_LABELS: Record<AgentRunScenario, string> = {
  chat: '对话',
  declaration_prep: '申报准备',
  daily_review: '每日复盘',
  morning_brief: '交易晨报',
  strategic_qa: '战略问答',
  declaration_checkup: '申报体检',
  custom_graph: '自定义编排'
}
function scenarioLabel(s: string): string {
  return SCENARIO_LABELS[s as AgentRunScenario] ?? '自定义编排'
}

// 来源接入点标签（#498 全入口持久化后区分会话来自哪个页面；与各接入点 history-key 一一对应）。
// 未命中（旧数据/未标注）回退 scenario 标签。
const PAGE_KEY_LABELS: Record<string, string> = {
  workbench: '工作台',
  ai_center: 'AI 中心',
  sidekick_exposure: '敞口分析',
  sidekick_spot: '监盘解读',
  morning_brief: '交易晨报',
  pre_submit_check: '申报体检',
  policy_intel: '政策情报',
  storage_copilot: '储能测算',
  review_center: '复盘中心',
  declaration_market: '申报台·情报',
  declaration_draft: '申报台·起草',
  captured_browser: '数据浏览器'
}
function sourceLabel(s: HistorySessionMeta): string {
  return PAGE_KEY_LABELS[s.page_key ?? ''] ?? scenarioLabel(s.scenario)
}

// updated_at 为 epoch 秒 → 今天 HH:MM / 昨天 / MM-DD / YYYY-MM-DD
function formatTime(epochSeconds: number): string {
  if (!epochSeconds) return ''
  const d = new Date(epochSeconds * 1000)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 世代守卫：pageKey 变化会触发 reload（申报台在情报/起草间切模式），快切即产生并发请求。
// 无守卫时旧请求晚归会用上一模式的结果覆盖当前列表——起草标签下列出 chat 场景会话，
// 点进去还会把 chat 会话加载进起草面板。
let reloadGeneration = 0
// 当前 sessions 属于哪个作用域。世代守卫只保证"旧响应不覆盖新列表"，管不住**请求在途
// 那几百毫秒里屏幕上还挂着旧作用域的会话**——模板的 v-for 不受 loading 分支约束，用户
// 从「情报问询」切到「协助起草」后仍能点到 declaration_market 的会话，点下去就把 chat
// transcript 载进起草面板、并把该 id 记进 draft 槽。故作用域一变先清空。
// 只在作用域变化时清（改名/删除触发的同作用域 reload 不清），避免列表闪烁。
let loadedPageKey: string | undefined

async function reload() {
  const generation = ++reloadGeneration
  const wantedPageKey = props.pageKey
  if (wantedPageKey !== loadedPageKey) sessions.value = []
  loading.value = true
  errorMsg.value = ''
  try {
    // pageKey 非空 → 只列本接入点会话（父视图传 :page-key）；空 → 全局（工作台/AI 中心）。
    const rows = await listHistorySessions({ limit: 100, pageKey: wantedPageKey || undefined })
    // 双重校验：世代号防并发覆盖，pageKey 比对防"请求发出后父组件又切了模式"
    if (generation !== reloadGeneration || wantedPageKey !== props.pageKey) return
    sessions.value = rows
    loadedPageKey = wantedPageKey
  } catch (err) {
    if (generation !== reloadGeneration) return
    errorMsg.value = err instanceof Error ? err.message : '加载历史失败'
  } finally {
    // 只有最新一次请求可解除 loading，否则旧请求收尾会让转圈提前消失
    if (generation === reloadGeneration) loading.value = false
  }
}
defineExpose({ reload })

function onSelect(s: HistorySessionMeta) {
  if (editingId.value === s.session_id) return
  emit('select', s.session_id, s.scenario)
}

function startRename(s: HistorySessionMeta, e: Event) {
  e.stopPropagation()
  editingId.value = s.session_id
  editingTitle.value = s.title || ''
}
async function commitRename(s: HistorySessionMeta) {
  if (justCancelled) { justCancelled = false; return } // Esc 取消后 @blur 不再误提交
  const title = editingTitle.value.trim()
  editingId.value = null
  if (!title || title === s.title) return
  try {
    await renameHistorySession(s.session_id, title)
    s.title = title
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '重命名失败'
  }
}
function cancelRename() {
  justCancelled = true // Esc 取消：置位护栏，随后 @blur 触发的 commitRename 直接跳过（修复 Esc 仍提交的 bug）
  editingId.value = null
}

async function remove(s: HistorySessionMeta, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`删除会话「${s.title || '未命名对话'}」？该操作不可恢复。`)) return
  try {
    await deleteHistorySession(s.session_id)
    sessions.value = sessions.value.filter((x) => x.session_id !== s.session_id)
    if (props.activeSessionId === s.session_id) emit('newChat') // 删的是当前会话 → 回到空白新对话
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '删除失败'
  }
}

function toggleCollapse() {
  emit('update:collapsed', !props.collapsed)
}

// 重命名输入框自动聚焦（<script setup> 局部指令，命名 vXxx 即可在模板用 v-xxx）
const vFocus = {
  mounted(el: HTMLInputElement) {
    el.focus()
    el.select()
  }
}

onMounted(reload)

// pageKey 变化即重拉：它是本组件自己的输入，自洽刷新是组件职责（申报台按情报/起草
// 两种模式切 page_key，不重拉会一直显示上一模式的会话列表）。
// 其余已接入页面传的都是常量字面量，watch 永不触发，零回归；比 :key 强制重挂更轻
// （不丢滚动位置与折叠动画、不重跑 onMounted）。
watch(() => props.pageKey, () => { void reload() })
</script>

<template>
  <!-- 折叠态：窄条，仅展开按钮 + 新建 -->
  <div v-if="collapsed" class="history-rail collapsed">
    <button class="rail-btn" title="展开历史" @click="toggleCollapse"><PanelLeftOpen :size="18" /></button>
    <button class="rail-btn" title="新建对话" @click="emit('newChat')"><MessageSquarePlus :size="18" /></button>
  </div>

  <!-- 展开态 -->
  <div v-else class="history-rail">
    <div class="rail-head">
      <button class="new-btn" @click="emit('newChat')">
        <MessageSquarePlus :size="16" /><span>新建对话</span>
      </button>
      <button class="rail-btn" title="收起历史" @click="toggleCollapse"><PanelLeftClose :size="18" /></button>
    </div>

    <div class="rail-body">
      <div v-if="loading" class="rail-state"><Loader2 :size="14" class="spin" /> 加载中…</div>
      <div v-else-if="errorMsg" class="rail-state error">{{ errorMsg }}</div>
      <div v-else-if="!sessions.length" class="rail-state">暂无历史对话</div>

      <button
        v-for="s in sessions"
        :key="s.session_id"
        class="hist-item"
        :class="{ active: s.session_id === activeSessionId }"
        @click="onSelect(s)"
      >
        <div class="hist-main">
          <input
            v-if="editingId === s.session_id"
            v-model="editingTitle"
            class="rename-input"
            @click.stop
            @keydown.enter.prevent="commitRename(s)"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename(s)"
            v-focus
          />
          <div v-else class="hist-title">{{ s.title || '未命名对话' }}</div>
          <div class="hist-meta">
            <span class="hist-scenario">{{ sourceLabel(s) }}</span>
            <span class="hist-time">{{ formatTime(s.updated_at) }}</span>
          </div>
          <div v-if="s.preview" class="hist-preview">{{ s.preview }}</div>
        </div>
        <div class="hist-actions">
          <span class="act" title="重命名" @click="startRename(s, $event)"><Pencil :size="13" /></span>
          <span class="act danger" title="删除" @click="remove(s, $event)"><Trash2 :size="13" /></span>
        </div>
      </button>

      <div class="rail-divider" />
      <SavedAnalysisViews />
    </div>
  </div>
</template>

<style scoped>
.rail-divider { height: 1px; background: var(--border, #eee); margin: 8px 6px; }
.history-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel-sub);
  border-right: 1px solid var(--line);
  border-radius: 12px 0 0 12px;
  overflow: hidden;
}
.history-rail.collapsed {
  align-items: center;
  gap: 8px;
  padding: 10px 6px;
  width: 100%;
}

.rail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--line-faint);
}
.new-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel);
  cursor: pointer;
  font-size: var(--font-md);
  font-weight: 600;
  color: inherit;
}
.new-btn:hover { border-color: var(--primary); color: var(--primary); }
.rail-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.65;
}
.rail-btn:hover { opacity: 1; background: var(--surface-hover); }

.rail-body { flex: 1; overflow-y: auto; padding: 6px; }
.rail-state { padding: 16px 12px; font-size: var(--font-12-5); opacity: 0.55; display: flex; gap: 6px; align-items: center; }
.rail-state.error { color: var(--danger); opacity: 0.85; }

.hist-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  margin-bottom: 2px;
  border: none;
  border-radius: 9px;
  background: none;
  cursor: pointer;
  color: inherit;
}
.hist-item:hover { background: var(--surface-hover); }
.hist-item.active { background: var(--primary-tint); }
.hist-item.active .hist-title { color: var(--primary); }
.hist-main { flex: 1; min-width: 0; }
.hist-title {
  font-size: var(--font-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rename-input {
  width: 100%;
  font-size: var(--font-md);
  padding: 2px 6px;
  border: 1px solid var(--primary);
  border-radius: 6px;
  outline: none;
  background: var(--panel);
  color: inherit;
}
.hist-meta { display: flex; gap: 8px; font-size: var(--font-xs); opacity: 0.5; margin-top: 2px; }
.hist-scenario { font-weight: 600; }
.hist-preview {
  font-size: var(--font-11-5);
  opacity: 0.55;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hist-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  flex-shrink: 0;
}
.hist-item:hover .hist-actions { opacity: 1; }
.act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  opacity: 0.6;
}
.act:hover { opacity: 1; background: var(--surface-hover); }
.act.danger:hover { color: var(--danger); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
