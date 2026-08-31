<script setup lang="ts">
import { computed, onBeforeUnmount, onBeforeUpdate, ref, watch, type ComponentPublicInstance } from 'vue'
import DisclosureDatasetCard from './DisclosureDatasetCard.vue'
import DailyDisclosureTexts from './DailyDisclosureTexts.vue'
import { DISCLOSURE_GROUPS, loadDailyDisclosure, type DisclosureDatasetResult } from '@/services/forecast/dailyDisclosure'

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

watch(
  () => [props.regionId, props.date] as const,
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

function renderable(result: DisclosureDatasetResult): boolean {
  return result.series.some((series) => series.validPoints > 0) || result.rows.length > 0
}

const filteredResults = computed(() => results.value.filter(matchesSearch))
const groupedCards = computed(() => DISCLOSURE_GROUPS.map((group) => ({
  ...group,
  datasets: filteredResults.value.filter((result) => result.spec.group === group.id && renderable(result)),
})))

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

const hasVisibleCards = computed(() => groupedCards.value.some((group) => group.datasets.length > 0))
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

    <DailyDisclosureTexts :region-id="regionId" :date="date" :reload-key="textReloadKey" />

    <div v-if="loading" class="daily-disclosure__state">
      正在读取当日披露数据…
    </div>

    <template v-else-if="hasVisibleCards">
      <section
        v-for="group in groupedCards"
        v-show="group.datasets.length"
        :key="group.id"
        class="daily-disclosure__group"
      >
        <div class="daily-disclosure__group-head">
          <h3 class="daily-disclosure__group-title">{{ group.label }}</h3>
          <span class="daily-disclosure__group-count">{{ group.datasets.length }} 项有数据</span>
        </div>

        <div class="daily-disclosure__grid" :class="{ 'daily-disclosure__grid--price': group.id === 'price' }">
          <DisclosureDatasetCard
            v-for="dataset in group.datasets"
            :key="dataset.spec.id"
            :ref="setCardRef"
            :dataset="dataset"
          />
        </div>
      </section>
    </template>
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
}
</style>
