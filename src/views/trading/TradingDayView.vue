<script setup lang="ts">
// 交易员一日作业台 —— v1.0 日常运营七步的**单页连续承载**
//
// 为什么是单页而不是七个路由页（2026-08-10 用户拍板）：七步是一条链，前一步产出是后一步
// 输入。散在七个独立路由页时，每页各自绑单据、各自加载、各自维护一份状态——交易员在页
// 与页之间跳转，本质是在当人肉传送带：结论要靠记忆或手抄带到下一页。单页把这层消除：
// 一份单据、一份状态、一次加载，七步在页内切换，`?stage=` 深链定位到具体一步。
//
// 容器只管三件事：① 绑定/建单（顶部条）；② 步进条（页内切换，不走路由）；③ 按当前步
// 渲染对应面板。各步的业务逻辑全在自己面板里，容器不掺和——这样每步可独立演进。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FileText, Plus } from 'lucide-vue-next'
import WorkflowStepper from '@/components/spot/WorkflowStepper.vue'
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
import StageMorningReview from '@/components/trading/stages/StageMorningReview.vue'
import StageMarketAnalysis from '@/components/trading/stages/StageMarketAnalysis.vue'
import StageDirection from '@/components/trading/stages/StageDirection.vue'
import StageDeclare from '@/components/trading/stages/StageDeclare.vue'
import StageClearing from '@/components/trading/stages/StageClearing.vue'
import StageContract from '@/components/trading/stages/StageContract.vue'
import StageDailyClose from '@/components/trading/stages/StageDailyClose.vue'

const route = useRoute()
const router = useRouter()

// ── 标的交易日（默认明日 D+1）────────────────────────────────────────────────
function tomorrow(): string {
  const d = new Date(Date.now() + 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const targetDate = ref(tomorrow())

// ── 作业主线单据 ─────────────────────────────────────────────────────────────
const declaration = ref<DeclarationOrder | null>(null)
const loading = ref(false)
const declError = ref('')

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

// ── 建单（无单时就地建，不跳出作业链）────────────────────────────────────────
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

// ── 当前步：?stage= 深链，缺省取第一个未完成的步 ────────────────────────────
const VALID_STAGES = new Set(ALL_STAGES.map((s) => s.id))

function readStageFromQuery(): StageId {
  const q = route.query.stage
  if (typeof q === 'string' && VALID_STAGES.has(q as StageId)) return q as StageId
  // 缺省：第一个未完成的步——让交易员一进来就落在「该干的事」上
  const first = ALL_STAGES.find((s) => !isStageDone(s.id, declaration.value))
  return first?.id ?? 'morning-review'
}

const activeStage = ref<StageId>(readStageFromQuery())

function selectStage(stage: StageId) {
  activeStage.value = stage
  router.replace({ query: { ...route.query, stage } })
}

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
          v1.0 日常运营七步：晨会复盘 → 早间分析 → 方向判断 → 申报执行 → 出清分析 → 中长期补仓 → 日报收尾。
          一步产出自动喂给下一步，不必手抄。
        </p>
      </div>
      <div class="td-progress" :title="`${progress.done}/${progress.total} 步完成`">
        <div class="td-progress-bar">
          <div class="td-progress-fill" :style="{ width: `${(progress.done / progress.total) * 100}%` }" />
        </div>
        <span>{{ progress.done }}/{{ progress.total }}</span>
      </div>
    </header>

    <!-- 单据绑定条 -->
    <section class="td-bind">
      <label class="td-date">
        标的交易日
        <input v-model="targetDate" type="date" />
      </label>
      <template v-if="loading">
        <span class="td-muted">读取中…</span>
      </template>
      <template v-else-if="declaration">
        <span class="td-decl">
          <FileText :size="13" /> {{ declaration.id }}
          <em>{{ STATUS_LABEL[declaration.status] }}</em>
        </span>
        <span class="td-cap">容量 {{ declaration.capacityMw }} MW</span>
      </template>
      <template v-else>
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
    </section>

    <p v-if="declError" class="td-err">{{ declError }}</p>

    <!-- 页内步进条（不走路由）-->
    <WorkflowStepper :current="activeStage" :declaration="declaration" @select="selectStage" />

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
.td-head h2 { margin: 0 0 4px; font-size: 18px; }
.td-sub { margin: 0; max-width: 680px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.td-progress { display: flex; align-items: center; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.td-progress-bar { width: 100px; height: 8px; border-radius: 4px; background: #e2e8f0; overflow: hidden; }
.td-progress-fill { height: 100%; background: #2563eb; transition: width .3s; }

.td-bind { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; font-size: 12px; background: #fff; }
.td-date { display: inline-flex; align-items: center; gap: 6px; }
.td-date input { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.td-decl { display: inline-flex; align-items: center; gap: 5px; font-family: ui-monospace, monospace; }
.td-decl em { font-style: normal; padding: 1px 7px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-family: inherit; }
.td-cap { color: var(--el-text-color-secondary, #667); }
.td-muted { color: var(--el-text-color-secondary, #667); }
.td-input-cap { width: 90px; padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.td-rat { min-width: 240px; flex: 1; padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.td-create { display: inline-flex; align-items: center; gap: 4px; padding: 4px 14px; border: 1px solid #2563eb; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.td-create:disabled { opacity: .45; cursor: not-allowed; }
.td-rat-hint { font-size: 11px; color: #b45309; }
.td-err { margin: 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }

.td-stage { padding: 14px 16px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.td-stage-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); }
.td-stage-head h3 { margin: 0; font-size: 15px; }
.td-stage-state { font-size: 11px; padding: 2px 10px; border-radius: 9px; background: #eff6ff; color: #1d4ed8; }
</style>
