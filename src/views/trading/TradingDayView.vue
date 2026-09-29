<script setup lang="ts">
// 交易员一日作业台，v1.0 日常运营七步的单页连续承载
//
// 为什么是单页而不是七个路由页（2026-08-10 用户拍板）：七步是一条链，前一步产出是后一步
// 输入。散在七个独立路由页时，每页各自绑单据、各自加载、各自维护一份状态，交易员在页
// 与页之间跳转，本质是在当人肉传送带：结论要靠记忆或手抄带到下一页。单页把这层消除：
// 一份单据、一份状态、一次加载，七步在页内切换，`?stage=` 深链定位到具体一步。
//
// 容器只管三件事：① 绑定/建单（顶部条）；② 步进条（页内切换，不走路由）；③ 按当前步
// 渲染对应面板。各步的业务逻辑全在自己面板里，容器不掺和，这样每步可独立演进。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FileText, Plus } from 'lucide-vue-next'
import WorkflowStepper from '@/components/spot/WorkflowStepper.vue'
import { lazyStage } from '@/components/trading/stages/lazyStage'
import {
  ALL_STAGES,
  isStageDone,
  stageStates,
  type StageId
} from '@/data/workflowStages'
import {
  createDeclaration,
  listDeclarations,
  STATUS_LABEL,
  type DeclarationOrder
} from '@/services/declarations'

// 七步面板按需加载（trading-day-morning-summary-and-lazy-stages 任务 3.1）：路由级已有
// 代码分割（router 动态 import），这里补路由内分割——首屏只取当前步面板代码，切步再取。
// loading/error 态由 lazyStage（defineAsyncComponent 壳）承载，失败可重试；步进条、
// ?stage= 深链与 Alt 键盘动线在容器层，不受懒加载影响。
const StageMorningReview = lazyStage(() => import('@/components/trading/stages/StageMorningReview.vue'))
const StageMarketAnalysis = lazyStage(() => import('@/components/trading/stages/StageMarketAnalysis.vue'))
const StageDirection = lazyStage(() => import('@/components/trading/stages/StageDirection.vue'))
const StageDeclare = lazyStage(() => import('@/components/trading/stages/StageDeclare.vue'))
const StageClearing = lazyStage(() => import('@/components/trading/stages/StageClearing.vue'))
const StageContract = lazyStage(() => import('@/components/trading/stages/StageContract.vue'))
const StageDailyClose = lazyStage(() => import('@/components/trading/stages/StageDailyClose.vue'))

const route = useRoute()
const router = useRouter()

// 标的交易日（默认值按地区 D+N 口径取：新疆 D+2 / 山西 D+1）
// 口径权威在 shared/trading-rules/trading-calendar.mjs（作业日视角：今天做的是
// D+几的交易）。未登记地区不默认抄邻省，回落明日但显式标「口径未登记，请人工
// 确认」：一个错的标的日会让全天产出挂到错误的一天上。
import {
  defaultTargetDate,
  getTradingCalendar,
  workdaySummary
} from 'shared/trading-rules/trading-calendar.mjs'
import { currentRegion } from '@/services/region/regionContext'

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function tomorrow(): string {
  return isoOf(new Date(Date.now() + 86400000))
}
const calendar = computed(() => getTradingCalendar(currentRegion.value.id))
const calendarSummary = computed(() =>
  calendar.value ? workdaySummary(calendar.value, isoOf(new Date())) : ''
)

const targetDate = ref(defaultTargetDate(currentRegion.value.id, isoOf(new Date())) ?? tomorrow())

// 换地区 = 换口径：标的日按新口径重置（旧日期是旧口径下的选择，跟着换不算粗暴）
watch(
  () => currentRegion.value.id,
  (rid) => {
    targetDate.value = defaultTargetDate(rid, isoOf(new Date())) ?? tomorrow()
  }
)

// 作业主线单据
const declaration = ref<DeclarationOrder | null>(null)
const loading = ref(false)
const declError = ref('')

// 绑定/口径摘要行（降噪任务 4.1）：默认一行收起，展开才见完整绑定与建单控件——
// 首屏让位给当前步主任务（spec「容器固定层级收敛直达主内容」）。
const bindOpen = ref(false)
const bindCalTitle = computed(() =>
  calendar.value
    ? `${calendar.value.source}${calendar.value.verify ? '（口径待复核）' : ''}`
    : '该地区没有权威依据的 D+N 口径，不抄邻省。标的日为默认明日（D+1），请按当地交易安排人工确认。'
)

let loadToken = 0
async function loadDeclaration() {
  const token = ++loadToken
  loading.value = true
  declError.value = ''
  try {
    const rows = await listDeclarations({ date: targetDate.value, limit: 20 })
    if (token !== loadToken) return
    declaration.value = rows.length ? rows.reduce((a, c) => (c.updatedAt > a.updatedAt ? c : a)) : null
  } catch (e) {
    if (token !== loadToken) return
    declError.value = e instanceof Error ? e.message : '申报单读取失败'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

// 建单（无单时就地建，不跳出作业链）
const newCapacityMw = ref(50)
const newRationale = ref('')
const rationaleValid = computed(() => newRationale.value.trim().length >= 8)
const creating = ref(false)

async function createForToday() {
  if (!rationaleValid.value) return
  creating.value = true
  declError.value = ''
  try {
    declaration.value = await createDeclaration({
      targetDate: targetDate.value,
      capacityMw: newCapacityMw.value,
      quoteRationale: newRationale.value.trim()
    })
  } catch (e) {
    declError.value = e instanceof Error ? e.message : '建单失败'
  } finally {
    creating.value = false
  }
}

// 当前步：?stage= 深链，缺省取第一个未完成的步
const VALID_STAGES = new Set(ALL_STAGES.map((s) => s.id))

function readStageFromQuery(): StageId {
  const q = route.query.stage
  if (typeof q === 'string' && VALID_STAGES.has(q as StageId)) return q as StageId
  // 缺省：第一个未完成的步，让交易员一进来就落在「该干的事」上
  const first = ALL_STAGES.find((s) => !isStageDone(s.id, declaration.value))
  return first?.id ?? 'morning-review'
}

const activeStage = ref<StageId>(readStageFromQuery())

function selectStage(stage: StageId) {
  activeStage.value = stage
  router.replace({ query: { ...route.query, stage } })
}

// 键盘动线（#1970）：高频作业不摸鼠标也能走完七步
// Alt+←/→ 相邻步切换；Alt+1…7 直达第 N 步（用 e.code 判定，macOS 上 Alt+数字会
// 产出特殊字符，按 e.key 判会把 ¡ 当 1）。表单输入不受影响（无 Alt 修饰不触发）。
function onKeydown(e: KeyboardEvent) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return
  const idx = ALL_STAGES.findIndex((st) => st.id === activeStage.value)
  const digit = /^Digit([1-7])$/.exec(e.code)
  if (e.code === 'ArrowRight' && idx >= 0 && idx < ALL_STAGES.length - 1) {
    e.preventDefault()
    selectStage(ALL_STAGES[idx + 1]!.id)
  } else if (e.code === 'ArrowLeft' && idx > 0) {
    e.preventDefault()
    selectStage(ALL_STAGES[idx - 1]!.id)
  } else if (digit) {
    e.preventDefault()
    selectStage(ALL_STAGES[Number(digit[1]) - 1]!.id)
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// 单据刷新后，若当前步因前置未做而该回退，重新校准（但不覆盖用户显式选的 ?stage=）
watch(declaration, () => {
  const q = route.query.stage
  if (typeof q !== 'string' || !VALID_STAGES.has(q as StageId)) {
    activeStage.value = readStageFromQuery()
  }
})

// 切标的日重载单据，并重置步进
watch(targetDate, () => { loadDeclaration() })

const states = computed(() => stageStates(ALL_STAGES, declaration.value))
const progress = computed(() => {
  const done = ALL_STAGES.filter((s) => isStageDone(s.id, declaration.value)).length
  return { done, total: ALL_STAGES.length }
})

/** 面板产出写回后刷新单据（保持容器持有的为最新，下游步读到刚写的产出）。 */
function onUpdated(d: DeclarationOrder) {
  declaration.value = d
}

onMounted(loadDeclaration)
</script>

<template>
  <div class="td">
    <!-- 页头 -->
    <header class="td-head">
      <div>
        <h2>交易员一日作业台</h2>
        <p class="td-sub">
          七步产出自动串联：前一步的结论直接喂给下一步，不必手抄。
        </p>
      </div>
      <div class="td-progress" :title="`${progress.done}/${progress.total} 步完成`">
        <div class="td-progress-bar">
          <div class="td-progress-fill" :style="{ width: `${(progress.done / progress.total) * 100}%` }" />
        </div>
        <span>{{ progress.done }}/{{ progress.total }}</span>
      </div>
    </header>

    <!-- 单据绑定/口径摘要行（降噪 4.1）：一行摘要 + 展开明细；建单/换单功能等价 -->
    <section class="td-bind">
      <button type="button" class="td-bind-bar" :aria-expanded="bindOpen" @click="bindOpen = !bindOpen">
        <FileText :size="13" />
        <b class="td-bind-date">{{ targetDate }}</b>
        <template v-if="loading">
          <span class="td-muted">读取中…</span>
        </template>
        <template v-else-if="declaration">
          <span class="td-decl">{{ declaration.id }} <em>{{ STATUS_LABEL[declaration.status] }}</em></span>
          <span class="td-cap">容量 {{ declaration.capacityMw }} MW</span>
        </template>
        <span v-else class="td-bind-missing">该标的日还没有申报单——展开建单</span>
        <span class="td-cal-mini" :class="{ unregistered: !calendar }" :title="bindCalTitle">
          {{ calendar ? `${currentRegion.shortName || currentRegion.id} · ${calendarSummary}` : `${currentRegion.shortName || currentRegion.id} · D+N 口径未登记` }}
        </span>
        <span class="td-bind-toggle">{{ bindOpen ? '收起 ▴' : '标的日与单据 ▾' }}</span>
      </button>

      <div v-if="bindOpen" class="td-bind-detail">
        <label class="td-date">
          标的交易日
          <input v-model="targetDate" type="date" />
        </label>
        <span
          v-if="calendar"
          class="td-cal"
          :title="`${calendar.source}${calendar.verify ? '（口径待复核）' : ''}`"
        >
          {{ currentRegion.shortName || currentRegion.id }} D+N 口径：{{ calendarSummary }}
          <em v-if="calendar.verify">待复核</em>
        </span>
        <span
          v-else
          class="td-cal unregistered"
          title="该地区没有权威依据的 D+N 口径，不抄邻省。标的日为默认明日（D+1），请按当地交易安排人工确认。"
        >
          {{ currentRegion.shortName || currentRegion.id }} D+N 口径未登记——标的日按默认 D+1，请人工确认
        </span>
        <template v-if="!loading && !declaration">
          <span
            class="td-muted"
            title="申报单 = 这一天作业的主线单据：S1–S7 每步的产出（复盘要点/市场判断/方向决策/出清分析/补仓决定/日报）都写回它，最终以它为载体走风控→审批→提交申报。没有它各步结论就无处存放。"
          >
            该标的日还没有申报单 ⓘ——它是全天作业的主线单据，各步产出都写回它；先建一张：
          </span>
          <input v-model.number="newCapacityMw" type="number" class="td-input-cap" placeholder="容量 MW" title="本公司该日可用申报容量（后续可改）" />
          <input v-model="newRationale" type="text" class="td-rat" placeholder="报价依据摘要（必填，≥8 字）——为何按此容量/价位申报，监管质询时的自证材料" />
          <button
            type="button"
            class="td-create"
            :disabled="!rationaleValid || creating"
            :title="rationaleValid ? '' : '需先填「报价依据摘要」（≥8 字）——它是必填项，为何按此容量申报的自证材料'"
            @click="createForToday"
          >
            <Plus :size="12" /> 建申报单
          </button>
          <span v-if="!rationaleValid && newRationale.length > 0" class="td-rat-hint">
            摘要还差 {{ 8 - newRationale.trim().length }} 字（≥8 字才能建单）
          </span>
        </template>
        <template v-else-if="!loading && declaration">
          <span class="td-muted">换单：改上方标的交易日后自动重读该日最新单据。</span>
        </template>
      </div>
    </section>

    <p v-if="declError" class="td-err">{{ declError }}</p>

    <!-- 页内步进条（不走路由）+ 首次引导（降噪 4.1：引导并入步进条区域，不单独占层）-->
    <div class="td-nav">
      <WorkflowStepper :current="activeStage" :declaration="declaration" @select="selectStage" />
      <p class="td-guide">
        首次使用：按 S1→S7 顺序走，<strong>高亮步 = 当前该做的</strong>，上一步产出自动喂下一步。
        快捷键：Alt+←/→ 切换相邻步，Alt+1…7 直达。
      </p>
    </div>

    <!-- 当前面板 -->
    <main class="td-stage">
      <div class="td-stage-head">
        <h3>{{ ALL_STAGES.find((s) => s.id === activeStage)?.scenario }}
          {{ ALL_STAGES.find((s) => s.id === activeStage)?.title }}</h3>
        <span class="td-stage-state">{{ states[activeStage] === 'done' ? '已完成' : states[activeStage] === 'current' ? '进行中' : states[activeStage] === 'locked' ? '待前置' : '待办' }}</span>
      </div>

      <StageMorningReview
        v-if="activeStage === 'morning-review'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageMarketAnalysis
        v-else-if="activeStage === 'market-analysis'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageDirection
        v-else-if="activeStage === 'direction'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageDeclare
        v-else-if="activeStage === 'declare'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageClearing
        v-else-if="activeStage === 'clearing'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageContract
        v-else-if="activeStage === 'contract'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
      <StageDailyClose
        v-else-if="activeStage === 'daily-close'"
        :declaration="declaration" :target-date="targetDate"
        @updated="onUpdated" @go="selectStage"
      />
    </main>
  </div>
</template>

<style scoped>
.td { display: flex; flex-direction: column; gap: 12px; }
.td-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.td-head h2 { margin: 0 0 4px; font-size: var(--font-18); }
.td-sub { margin: 0; max-width: 680px; font-size: var(--font-sm); line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.td-progress { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.td-progress-bar { width: 100px; height: 8px; border-radius: 4px; background: #e2e8f0; overflow: hidden; }
.td-progress-fill { height: 100%; background: #2563eb; transition: width .3s; }

.td-bind { display: flex; flex-direction: column; gap: 8px; padding: 6px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; font-size: var(--font-sm); background: #fff; }
.td-bind-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; padding: 2px 0; border: none; background: none; font: inherit; color: inherit; cursor: pointer; text-align: left; }
.td-bind-date { font-variant-numeric: tabular-nums; }
.td-bind-missing { color: #b45309; }
.td-cal-mini { margin-left: auto; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 9px; border-radius: 8px; background: #f0f9ff; color: #075985; font-size: var(--font-10-5); }
.td-cal-mini.unregistered { background: #fffbeb; color: #92400e; }
.td-bind-toggle { font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.td-bind-detail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 6px; border-top: 1px dashed var(--el-border-color-lighter, #ebeef5); }
.td-nav { display: flex; flex-direction: column; gap: 2px; }
.td-stage-loading { margin: 0; padding: 10px 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #667); }
.td-stage-error { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; padding: 10px 12px; border: 1px solid #fecaca; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); }
.td-stage-error p { margin: 0; }
.td-date { display: inline-flex; align-items: center; gap: 6px; }
.td-date input { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.td-cal { max-width: 100%; padding: 3px 10px; border-radius: 8px; background: #f0f9ff; color: #075985; font-size: var(--font-xs); line-height: 1.5; cursor: help; }
.td-cal em { font-style: normal; margin-left: 4px; padding: 0 6px; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: var(--font-10); }
.td-cal.unregistered { background: #fffbeb; color: #92400e; cursor: help; }
.td-decl { display: inline-flex; align-items: center; gap: 5px; font-family: ui-monospace, monospace; }
.td-decl em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-family: inherit; }
.td-cap { color: var(--el-text-color-secondary, #667); }
.td-muted { color: var(--el-text-color-secondary, #667); }
.td-input-cap { width: 90px; padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.td-rat { min-width: 240px; flex: 1; padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-sm); }
.td-create { display: inline-flex; align-items: center; gap: 4px; padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: var(--font-sm); cursor: pointer; }
.td-create:disabled { opacity: .45; cursor: not-allowed; }
.td-rat-hint { font-size: var(--font-xs); color: #b45309; }
.td-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: var(--font-sm); }

.td-guide { margin: 0; font-size: var(--font-xs); line-height: 1.6; color: var(--el-text-color-secondary, #889); }
.td-stage { padding: 14px 16px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.td-stage-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }
.td-stage-head h3 { margin: 0; font-size: var(--font-15); }
.td-stage-state { font-size: var(--font-xs); padding: 2px 10px; border-radius: 9px; background: #eff6ff; color: #1d4ed8; }
</style>
