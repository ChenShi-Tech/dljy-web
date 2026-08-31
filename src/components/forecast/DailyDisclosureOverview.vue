<script setup lang="ts">
import { computed, onBeforeUnmount, onBeforeUpdate, ref, watch, type ComponentPublicInstance } from 'vue'
import DisclosureDatasetCard from './DisclosureDatasetCard.vue'
import DailyDisclosureTexts from './DailyDisclosureTexts.vue'
import { DISCLOSURE_GROUPS, loadDailyDisclosure, type DisclosureDatasetResult } from '@/services/forecast/dailyDisclosure'
import { buildDisclosurePanels, matchesDisclosurePanel } from '@/services/forecast/disclosureDashboard'
import { selectedCompanyId } from '@/services/company/companyContext'

const props = defineProps<{
  regionId: string
  date: string
}>()

type CardExpose = { resize: () => void }

interface CoverageRow {
  id: string
  title: string
  nature: string
  scope: string
  date: string
  targetDate: string
  points: string
  status: string
  reason: string
}

const loading = ref(false)
const results = ref<DisclosureDatasetResult[]>([])
const loadError = ref('')
const search = ref('')
const attempted = ref(false)
const textReloadKey = ref(0)
const hiddenCurves = ref<string[]>([])
const selectionOpen = ref(false)
const preferenceKey = computed(() => `dljy.disclosure-board.v1.${props.regionId}.${selectedCompanyId.value}`)
let cardRefs: CardExpose[] = []
let requestId = 0

function invalidateRequest(clearAttempted = false) {
  requestId += 1
  loading.value = false
  results.value = []
  loadError.value = ''
  cardRefs = []
  if (clearAttempted) attempted.value = false
}

const canQuery = computed(() => Boolean(props.date) && props.regionId === 'yunnan')
const disabledReason = computed(() => {
  if (!props.date) return '请先在页面顶部选择日期，再加载当日披露。'
  if (props.regionId !== 'yunnan') return '当日披露总览当前只接入云南公开数据，其他地区不会展示模拟占位。'
  return ''
})

async function reload() {
  if (!canQuery.value) return
  textReloadKey.value += 1
  const currentRequest = ++requestId
  attempted.value = true
  loading.value = true
  loadError.value = ''
  results.value = []
  cardRefs = []
  try {
    const loaded = await loadDailyDisclosure(props.regionId, props.date)
    if (currentRequest !== requestId) return
    results.value = loaded
  } catch (error) {
    if (currentRequest !== requestId) return
    loadError.value = error instanceof Error ? error.message : '披露数据加载失败'
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

// 只保存显示偏好，不保存业务数值；换日保留选择，切换公司/地区重新读取各自偏好。
watch(preferenceKey, (key) => {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    hiddenCurves.value = Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string' && item.length <= 1024).slice(0, 256)
      : []
  } catch { hiddenCurves.value = [] }
}, { immediate: true, flush: 'sync' })

watch(
  () => [props.regionId, props.date, selectedCompanyId.value] as const,
  () => {
    invalidateRequest(true)
    if (canQuery.value) void reload()
  },
  { immediate: true, flush: 'sync' },
)

onBeforeUnmount(() => {
  invalidateRequest(true)
})
// 函数ref在每次更新后重新收集，避免搜索/重载保留已卸载图表实例。
onBeforeUpdate(() => { cardRefs = [] })

const searchKeyword = computed(() => search.value.trim().toLowerCase())

function matchesSearch(result: DisclosureDatasetResult): boolean {
  if (!searchKeyword.value) return true
  const haystack = [
    result.spec.title,
    result.spec.id,
    result.sourceLabel,
    ...result.warnings,
    ...result.series.flatMap((series) => [series.label, series.scopeLabel, series.scope, series.targetDate ?? '']),
  ].join(' ').toLowerCase()
  return haystack.includes(searchKeyword.value)
}

const filteredResults = computed(() => results.value.filter(matchesSearch))
const panels = computed(() => buildDisclosurePanels(results.value))
const filteredPanels = computed(() => panels.value.filter((panel) => matchesDisclosurePanel(panel, searchKeyword.value)))
const selectedPanels = computed(() => panels.value.filter((panel) => !hiddenCurves.value.includes(panel.selectionKey)))
const selectionGroups = computed(() => DISCLOSURE_GROUPS.map((group) => ({
  ...group,
  panels: filteredPanels.value.filter((panel) => panel.dataset.spec.group === group.id),
})))
const groupedCards = computed(() => DISCLOSURE_GROUPS.map((group) => ({
  ...group,
  panels: filteredPanels.value.filter((panel) => panel.dataset.spec.group === group.id && !hiddenCurves.value.includes(panel.selectionKey)),
})))
const rawOnlyResults = computed(() => filteredResults.value.filter((result) =>
  ['ready', 'partial'].includes(result.status) && result.rows.length > 0
  && !panels.value.some((panel) => panel.dataset.spec.id === result.spec.id),
))

function saveSelection(keys: string[]) {
  hiddenCurves.value = [...new Set(keys)]
  try { window.localStorage.setItem(preferenceKey.value, JSON.stringify(hiddenCurves.value)) } catch { /* 禁用存储时仍可在本页选择。 */ }
}
function toggleCurve(key: string) {
  saveSelection(hiddenCurves.value.includes(key) ? hiddenCurves.value.filter((item) => item !== key) : [...hiddenCurves.value, key])
}
function selectAll() { saveSelection([]) }
function clearSelection() { saveSelection([...hiddenCurves.value, ...panels.value.map((panel) => panel.selectionKey)]) }

const coverageRows = computed<CoverageRow[]>(() => filteredResults.value.map((result) => {
  const scope = [...new Set(result.series.map((series) => series.scopeLabel))].filter(Boolean)
  const targetDates = [...new Set(result.series.map((series) => series.targetDate).filter(Boolean))] as string[]
  const pointLabels = result.series.map((series) => `${series.validPoints}/${series.expectedPoints}`).filter(Boolean)
  return {
    id: result.spec.id,
    title: result.spec.title,
    nature: result.spec.nature === 'price'
      ? '价格'
      : result.spec.nature === 'forecast'
        ? '预测'
        : result.spec.nature === 'actual'
          ? '实际'
          : '供需',
    scope: scope.join(' / ') || '—',
    date: result.date,
    targetDate: targetDates.join(' / ') || '仅记录日',
    points: pointLabels.length ? pointLabels.join('；') : '0',
    status: ({
      ready: '已导入',
      partial: '部分可用',
      empty: '无当日记录',
      error: '读取失败',
      rejected: '已拒绝',
    } as Record<DisclosureDatasetResult['status'], string>)[result.status],
    reason: result.error || result.warnings[0] || '已导入，可在上方查看曲线',
  }
}))

const hasVisibleCards = computed(() => groupedCards.value.some((group) => group.panels.length > 0))
const failureCount = computed(() => results.value.filter((result) => result.status === 'error' || result.status === 'rejected').length)
const emptyCount = computed(() => results.value.filter((result) => result.status === 'empty').length)
const latestAcquisition = computed(() => {
  const values = results.value
    .map((result) => result.capturedAt ?? result.ingestedAt ?? '')
    .filter(Boolean)
    .sort()
  return values.at(-1) ?? ''
})

function setCardRef(instance: Element | ComponentPublicInstance | null) {
  if (!instance || !('resize' in instance) || typeof instance.resize !== 'function') return
  const card = instance as CardExpose
  if (!cardRefs.includes(card)) cardRefs.push(card)
}

function resize() {
  for (const card of cardRefs) card.resize()
}

defineExpose({ resize })
</script>

<template>
  <section class="daily-disclosure">
    <header class="daily-disclosure__hero">
      <div>
        <h2 class="daily-disclosure__title">当日披露总览</h2>
        <p class="daily-disclosure__subtitle">
          已导入的官方披露，包含预测、实际、价格与检修运行记录；不触发模型计算。
        </p>
      </div>
      <div class="daily-disclosure__toolbar">
        <el-button type="primary" :loading="loading" :disabled="!canQuery" @click="reload">
          加载当日披露
        </el-button>
        <el-input
          v-model="search"
          clearable
          placeholder="输入指标名称"
          class="daily-disclosure__search"
        />
      </div>
    </header>

    <el-alert
      v-if="disabledReason"
      :title="disabledReason"
      type="info"
      :closable="false"
      show-icon
      class="daily-disclosure__alert"
    />
    <el-alert
      v-else-if="latestAcquisition || attempted"
      :title="latestAcquisition
        ? `按已导入源记录日期展示，不代表官方精确披露时刻；页面非实时回源。最近采集/导入时间：${latestAcquisition}。`
        : '按已导入源记录日期展示，不代表官方精确披露时刻；页面非实时回源。'"
      type="info"
      :closable="false"
      show-icon
      class="daily-disclosure__alert"
    />
    <el-alert
      v-if="failureCount || emptyCount"
      :title="`数值部分共覆盖 ${results.length} 个已接数据集；${failureCount} 个读取失败或被拒绝，${emptyCount} 个在该日没有记录。可点击“加载当日披露”整体重试。`"
      type="warning"
      :closable="false"
      show-icon
      class="daily-disclosure__alert"
    />
    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      :closable="false"
      show-icon
      class="daily-disclosure__alert"
    />

    <section v-if="panels.length && !loading" class="daily-disclosure__selection" aria-label="曲线看板设置">
      <div class="daily-disclosure__board-head">
        <div>
          <h3 class="daily-disclosure__group-title">曲线看板</h3>
          <p class="daily-disclosure__board-summary" aria-live="polite">
            共 {{ panels.length }} 条可用曲线，已选择 {{ selectedPanels.length }} 条；不同指标和统计范围分别展示。
          </p>
        </div>
        <div class="daily-disclosure__board-actions">
          <a href="#daily-disclosure-texts">检修与运行文本</a>
          <button type="button" class="daily-disclosure__control" :aria-expanded="selectionOpen" aria-controls="disclosure-curve-options" @click="selectionOpen = !selectionOpen">
            {{ selectionOpen ? '收起选择' : '选择展示曲线' }}
          </button>
        </div>
      </div>
      <div v-show="selectionOpen" id="disclosure-curve-options" class="daily-disclosure__options">
        <div class="daily-disclosure__board-actions">
          <button type="button" class="daily-disclosure__control" @click="selectAll">显示全部曲线</button>
          <button type="button" class="daily-disclosure__control" @click="clearSelection">清空选择</button>
          <span>选择会自动记住；上方搜索只过滤当前展示，不改变勾选。</span>
        </div>
        <fieldset v-for="group in selectionGroups.filter((item) => item.panels.length)" :key="group.id" class="daily-disclosure__choices">
          <legend>{{ group.label }}</legend>
          <div class="daily-disclosure__choice-grid">
            <label v-for="panel in group.panels" :key="panel.id" class="daily-disclosure__choice" :title="`${panel.title} · ${panel.scopeLabel}`">
              <input type="checkbox" :checked="!hiddenCurves.includes(panel.selectionKey)" :aria-label="`${panel.title} · ${panel.scopeLabel}`" @change="toggleCurve(panel.selectionKey)">
              <span><strong>{{ panel.title }}</strong><small>{{ panel.scopeLabel }} · {{ panel.dataset.series[0].targetDate ?? '仅记录日' }}</small></span>
            </label>
          </div>
        </fieldset>
        <p v-if="!filteredPanels.length" class="daily-disclosure__board-summary">当前搜索未匹配曲线，清除上方搜索可查看全部选择。</p>
      </div>
    </section>

    <div v-if="loading" class="daily-disclosure__state">
      正在读取当日披露数据…
    </div>

    <template v-else-if="hasVisibleCards">
      <section
        v-for="group in groupedCards"
        v-show="group.panels.length"
        :key="group.id"
        class="daily-disclosure__group"
      >
        <div class="daily-disclosure__group-head">
          <h3 class="daily-disclosure__group-title">{{ group.label }}</h3>
          <span class="daily-disclosure__group-count">{{ group.panels.length }} 条曲线</span>
        </div>

        <div class="daily-disclosure__grid" :class="{ 'daily-disclosure__grid--price': group.id === 'price' }">
          <DisclosureDatasetCard
            v-for="panel in group.panels"
            :key="panel.id"
            :ref="setCardRef"
            :dataset="panel.dataset"
            :display-title="panel.title"
          />
        </div>
      </section>
    </template>
    <div v-else-if="!loading && panels.length" class="daily-disclosure__state" role="status">
      {{ selectedPanels.length ? '当前搜索条件下没有已选曲线，请清除搜索或调整曲线选择。' : '你尚未选择展示曲线。' }}
      <button v-if="!selectedPanels.length" type="button" class="daily-disclosure__control" @click="selectAll">显示全部曲线</button>
    </div>
    <div v-else-if="rawOnlyResults.length" class="daily-disclosure__state" role="status">
      当日有原始记录，但暂没有可安全绘制的数值曲线。请展开下方原始记录核查。
    </div>
    <div
      v-else-if="attempted && !loadError && filteredResults.length"
      class="daily-disclosure__state"
    >
      该日期没有可展示的已导入数值记录；各数据集的读取结果已列在下方覆盖清单。
    </div>
    <div
      v-else-if="attempted && !loadError && !filteredResults.length"
      class="daily-disclosure__state"
    >
      当前搜索条件下没有匹配的数据集。
    </div>

    <details v-if="rawOnlyResults.length" class="daily-disclosure__coverage">
      <summary>有原始记录但暂不可绘图（{{ rawOnlyResults.length }} 个数据集）</summary>
      <div class="daily-disclosure__grid">
        <DisclosureDatasetCard v-for="dataset in rawOnlyResults" :key="dataset.spec.id" :dataset="dataset" />
      </div>
    </details>

    <div id="daily-disclosure-texts">
      <DailyDisclosureTexts :region-id="regionId" :date="date" :reload-key="textReloadKey" />
    </div>

    <section v-if="attempted && coverageRows.length" class="daily-disclosure__coverage">
      <div class="daily-disclosure__group-head">
        <h3 class="daily-disclosure__group-title">数值数据覆盖清单</h3>
        <span class="daily-disclosure__group-count">{{ coverageRows.length }} 项</span>
      </div>

      <el-table :data="coverageRows" border size="small" class="daily-disclosure__table">
        <el-table-column prop="title" label="数据集" min-width="170" show-overflow-tooltip />
        <el-table-column prop="nature" label="数据性质" width="100" />
        <el-table-column prop="scope" label="统计范围" min-width="160" show-overflow-tooltip />
        <el-table-column prop="date" label="数据日期" width="118" />
        <el-table-column prop="targetDate" label="目标日" min-width="140" show-overflow-tooltip />
        <el-table-column prop="points" label="有效时段" min-width="140" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="reason" label="说明" min-width="260" show-overflow-tooltip />
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.daily-disclosure {
  container-type: inline-size;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.daily-disclosure__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 6px;
}

.daily-disclosure__title {
  margin: 0 0 6px;
  color: var(--text, #1f2a37);
  font-size: var(--font-xl);
  font-weight: 700;
}

.daily-disclosure__subtitle {
  margin: 0;
  color: var(--muted, #667085);
  font-size: var(--font-md);
  line-height: 1.7;
}

.daily-disclosure__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.daily-disclosure__search {
  width: 15rem;
}

.daily-disclosure__selection {
  padding: 16px 20px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 6px;
}

.daily-disclosure__board-head,
.daily-disclosure__board-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.daily-disclosure__board-head { justify-content: space-between; }
.daily-disclosure__board-actions { font-size: var(--font-sm); color: var(--muted, #667085); }
.daily-disclosure__board-actions a { color: var(--primary, #0f9d8a); text-underline-offset: 3px; }
.daily-disclosure__board-summary { margin: 6px 0 0; font-size: var(--font-sm); color: var(--muted, #667085); line-height: 1.6; }

.daily-disclosure__control {
  padding: 7px 12px;
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 4px;
  background: var(--panel, #fff);
  color: var(--primary, #0f9d8a);
  font-family: inherit;
  font-size: var(--font-sm);
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
}
.daily-disclosure__control:hover { border-color: var(--primary, #0f9d8a); background: var(--panel-sub, #f8fafc); }
.daily-disclosure__control:focus-visible,
.daily-disclosure__choice:focus-within { outline: 2px solid var(--primary, #0f9d8a); outline-offset: 2px; }
.daily-disclosure__options { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line, #d9e2ec); }
.daily-disclosure__choices { min-width: 0; border: 0; padding: 0; margin: 16px 0 0; }
.daily-disclosure__choices legend { padding: 0 0 10px; font-size: var(--font-md); font-weight: 600; color: var(--text, #1f2a37); }
.daily-disclosure__choice-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; }
.daily-disclosure__choice { display: flex; align-items: center; min-width: 0; gap: 9px; padding: 8px; border-radius: 4px; cursor: pointer; }
.daily-disclosure__choice:hover { background: var(--panel-sub, #f8fafc); }
.daily-disclosure__choice input { flex: none; accent-color: var(--primary, #0f9d8a); width: 1rem; height: 1rem; }
.daily-disclosure__choice span { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
.daily-disclosure__choice strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-sm); font-weight: 500; color: var(--text, #1f2a37); }
.daily-disclosure__choice small { font-size: var(--font-xs); color: var(--muted, #667085); }
#daily-disclosure-texts { scroll-margin-top: 20px; min-width: 0; }

.daily-disclosure__alert,
.daily-disclosure__state,
.daily-disclosure__coverage,
.daily-disclosure__group {
  background: var(--panel, #fff);
  border: 1px solid var(--line, #d9e2ec);
  border-radius: 6px;
}

.daily-disclosure__state {
  padding: 18px 20px;
  color: var(--muted, #667085);
  font-size: var(--font-md);
}

.daily-disclosure__group,
.daily-disclosure__coverage {
  padding: 18px 20px 20px;
}

.daily-disclosure__group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.daily-disclosure__group-title {
  margin: 0;
  color: var(--text, #1f2a37);
  font-size: var(--font-lg);
  font-weight: 700;
}

.daily-disclosure__group-count {
  color: var(--primary, #0f9d8a);
  font-size: var(--font-sm);
  font-weight: 600;
}

.daily-disclosure__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

@container (min-width: 70rem) {
  .daily-disclosure__grid:not(.daily-disclosure__grid--price) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container (max-width: 44rem) {
  .daily-disclosure__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .daily-disclosure__hero {
    flex-direction: column;
  }

  .daily-disclosure__toolbar,
  .daily-disclosure__search {
    width: 100%;
  }

  .daily-disclosure__choice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container (max-width: 28rem) {
  .daily-disclosure__choice-grid { grid-template-columns: minmax(0, 1fr); }
  .daily-disclosure__selection,
  .daily-disclosure__group,
  .daily-disclosure__coverage,
  .daily-disclosure__hero { padding: 12px; }
}
</style>
