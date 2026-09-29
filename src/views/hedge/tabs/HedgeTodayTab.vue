<script setup lang="ts">
// 套保工作台「今明两日」页签（openspec build-midlong-spot-hedging 任务 8.2/8.4/8.7，HW-01/02/05/06/09；ChenShi-Tech/dljy#3420）。
//
// 默认页签：数据腿新鲜度（HW-01）、今明两日逐时段敞口图与表格（HW-02：未知断开不连线，实际/预测分色，
// 「台账无合同=已知 0」与「分解缺段/失败=未知」分开）、两个套保率与判级（FORBIDDEN 显示无权限文案、不显示数值）、
// 需关注清单与数据缺口分区（读取失败与数据覆盖分开）、CSV 导出（HW-05：导当前结果 + 它对应的那次查询参数，
// 文件内带认知时点）、智能体侧边栏摘要（HW-09：不含试算与方案对比，未覆盖时段不带数值）。
//
// 结果以 { data, query } 快照保存：导出与侧边栏摘要都用快照里的查询参数，不是输入框里尚未生效的值。
// 生命周期走 useHedgeTabLifecycle（公司/地区切换清空并重取）；认知时点/粒度变化清空旧结果并防抖重取（HW-06）；
// 每个 await 之后先过 scopedRequest() 判定作用域、再比对本次 load 的序号（KeepAlive 重激活/维护写入重取会让
// 同一作用域内并发两个请求，旧请求后返回不得覆盖新结果、不得在新请求成功后清空页面或报错）——旧请求晚到一律丢弃。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { defineAiPage } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import { exportCsv } from '@/utils/exportCsv'
import { HedgeApiError, fetchOverview } from '@/services/hedge/hedgeApi'
import type { TodayResult } from '@/services/hedge/hedgeTodayModel'
import {
  assessmentLevelLabel,
  assessmentReasonLabel,
  buildExposureSeries,
  buildTodayCsv,
  buildTodaySummary,
  generationSourceLabel,
  intervalLabel,
  legRowsOf,
  midlongText,
  ratioStatusText,
  ratioValueText,
  splitGaps,
  todayOverviewOf,
  uncoveredLabel,
  watchlistDirectionLabel,
} from '@/services/hedge/hedgeTodayModel'
import TodayExposureChart from './today/TodayExposureChart.vue'
import TodayLegsPanel from './today/TodayLegsPanel.vue'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

const loading = ref(false)
const loadError = ref<string | null>(null)
/** 当前结果 + 它对应的那次查询参数（同生共死）：导出与侧边栏摘要只认这里的参数。 */
const result = ref<TodayResult | null>(null)

/** load 的最新请求序号：作用域/会话代次之外，同一作用域内也要只认最新一次 load（KeepAlive 重激活、维护写入重取）。 */
let latestLoadSeq = 0

async function load() {
  if (!workbench.regionOpen.value) return
  const current = workbench.scopedRequest()
  const seq = ++latestLoadSeq
  const isCurrent = () => current() && seq === latestLoadSeq
  loading.value = true
  loadError.value = null
  const range = today2Range()
  const query = {
    fromDate: range.fromDate, toDate: range.toDate,
    granularity: workbench.granularity.value, asOf: workbench.asOf.value,
  }
  try {
    const raw = await fetchOverview({
      fromDate: query.fromDate, toDate: query.toDate, granularity: query.granularity,
      scope: 'company', asOf: query.asOf ?? undefined,
    })
    if (!isCurrent()) return // HW-06：迟到响应丢弃（作用域外，或已被更新的 load 取代）
    result.value = { data: todayOverviewOf(raw), query }
    workbench.syncAsOfBanner()
  } catch (err) {
    if (!isCurrent()) return
    loadError.value = err instanceof HedgeApiError
      ? `${err.errorCode}：${err.message}`
      : '数据加载失败，可重试'
    result.value = null
  } finally {
    if (isCurrent()) loading.value = false
  }
}

function reset() {
  result.value = null
  loading.value = false
  loadError.value = null
}

useHedgeTabLifecycle(workbench, { load, reset })

// 认知时点/粒度变化：立即清空旧结果（不得显示旧口径的数据）并防抖重取。
// 公司/地区变化走 useHedgeTabLifecycle（contextKey），这里跳过，避免双重加载。
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let lastContextKey = workbench.contextKey.value
watch(workbench.scopeKey, () => {
  const contextKey = workbench.contextKey.value
  if (contextKey !== lastContextKey) {
    lastContextKey = contextKey
    return
  }
  result.value = null
  loadError.value = null
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void load(), 150)
})
// 维护写入成功（区间方案、月度基准、机制参数）后重取：写入后下一次读取即反映到套保计算。
watch(workbench.dataRevision, () => { void load() })
onBeforeUnmount(() => { if (reloadTimer) clearTimeout(reloadTimer) })

// ── 派生显示 ─────────────────────────────────────────────────────────────────

const overview = computed(() => result.value?.data ?? null)
const legRows = computed(() => (overview.value ? legRowsOf(overview.value) : []))
const legsDegraded = computed(() => Boolean((overview.value?.legs as { degraded?: unknown } | null)?.degraded))
const series = computed(() => (overview.value ? buildExposureSeries(overview.value.intervals) : null))
const gapGroups = computed(() => splitGaps(overview.value?.gaps ?? []))
const assessment = computed(() => overview.value?.standardMetrics?.TODAY2_INTERVAL ?? null)

const sensitivityText = computed(() => {
  const sens = overview.value?.sensitivity
  if (!sens || sens.value === null) return '不完整'
  return sens.value
})

function exportCurrent() {
  const snapshot = result.value
  if (!snapshot) return
  const { filename, headers, rows } = buildTodayCsv(snapshot)
  exportCsv(filename, headers, rows)
}

// ── 智能体侧边栏（HW-09）：摘要只含当前视图结论，不含试算与方案对比数据 ─────────

function supplementQuestion(): string {
  const summary = buildTodaySummary(result.value)
  const level = (summary?.assessment as { level?: string } | null)?.level
  return level
    ? `今明两日逐时段判级为「${level}」，请结合逐时段敞口与数据腿状态判断明天要不要补仓，给出建议与风险提示。`
    : '请结合今明两日逐时段敞口与数据腿状态判断明天要不要补仓，给出建议与风险提示。'
}

defineAiPage({
  label: '中长期与现货套保·今明两日',
  promptKey: PAGE_PROMPT_KEYS.workbench,
  interpret: { context: () => buildTodaySummary(result.value) },
  presets: [
    { label: '明天要不要补仓', question: supplementQuestion, context: () => buildTodaySummary(result.value) },
  ],
})
</script>

<template>
  <div class="hedge-today-tab">
    <p v-if="loadError" class="load-error" data-test="load-error">{{ loadError }} <button type="button" @click="load">重试</button></p>
    <p v-else-if="loading && !overview" data-test="loading">加载中…</p>

    <section v-if="overview" class="body">
      <div class="toolbar">
        <span class="grain">窗口 {{ overview.fromDate ?? '—' }} ~ {{ overview.toDate ?? '—' }} · {{ overview.granularity === 'DAY' ? '日' : '小时' }}粒度</span>
        <button type="button" data-test="export-csv" :disabled="!overview.intervals.length" @click="exportCurrent">导出 CSV（含认知时点）</button>
      </div>

      <TodayLegsPanel :rows="legRows" :degraded="legsDegraded" />

      <div class="metrics" data-test="metrics">
        <div class="metric-card" data-test="metric-today2">
          <h3>今明两日逐时段套保率</h3>
          <p data-test="ratio-with-mechanism">含机制：<b>{{ ratioValueText(overview.ratio?.withMechanism) }}</b><span v-if="ratioStatusText(overview.ratio?.withMechanism)">（{{ ratioStatusText(overview.ratio?.withMechanism) }}）</span></p>
          <p data-test="ratio-midlong-only">仅中长期：<b>{{ ratioValueText(overview.ratio?.midlongOnly) }}</b><span v-if="ratioStatusText(overview.ratio?.midlongOnly)">（{{ ratioStatusText(overview.ratio?.midlongOnly) }}）</span></p>
          <p data-test="assessment">
            判级：{{ assessment ? assessmentLevelLabel(assessment.level) : '未评估' }}<span v-if="assessment?.reason">（{{ assessmentReasonLabel(assessment.reason) }}）</span>
          </p>
          <p v-if="overview.scheme" class="scheme">生效方案：{{ overview.scheme.name }} v{{ overview.scheme.versionNo }}（{{ overview.scheme.basis === 'WITH_MECHANISM' ? '含机制' : '仅中长期' }} 判级）</p>
          <p v-else class="scheme">未评估：套保区间未配置</p>
        </div>
        <div class="metric-card" data-test="sensitivity">
          <h3>价格敏感度</h3>
          <p>{{ sensitivityText }}<span v-if="overview.sensitivity?.note">（{{ overview.sensitivity?.note }}）</span></p>
        </div>
      </div>

      <TodayExposureChart :series="series" />

      <section class="intervals" data-test="intervals">
        <h3>逐时段明细（未知时段不做平滑/插值，不以 0 冒充）</h3>
        <div class="grid-wrap">
          <table>
            <thead>
              <tr><th>时段</th><th>发电</th><th>来源</th><th>中长期锁价</th><th>机制</th><th>敞口（含机制）</th><th>敞口（仅中长期）</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in overview.intervals" :key="row.start" :class="{ uncovered: row.generation.value === null || row.locked.midlong === null }">
                <td>{{ intervalLabel(row.start) }}</td>
                <td>{{ row.generation.value ?? '未知' }}</td>
                <td>{{ row.generation.value === null ? uncoveredLabel(row.generation.uncoveredReason) ?? '未知' : generationSourceLabel(row.generation.source) }}</td>
                <td data-test="midlong-cell">{{ midlongText(row) }}</td>
                <td>{{ row.locked.mechanism.value ?? '未知' }}<span v-if="row.locked.mechanism.note">（{{ row.locked.mechanism.note }}）</span></td>
                <td>{{ row.exposure.withMechanism ?? '未知' }}</td>
                <td>{{ row.exposure.midlongOnly ?? '未知' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="watchlist" data-test="watchlist">
        <h3>需关注时段（服务端生成）</h3>
        <p v-if="!overview.watchlist?.rows?.length">暂无已覆盖的风险时段</p>
        <ul v-else>
          <li v-for="(row, wi) in overview.watchlist.rows" :key="wi" data-test="watchlist-row">
            {{ intervalLabel(String(row.start ?? '')) }} 敞口 {{ row.exposureMwh ?? '未知' }} MWh（{{ watchlistDirectionLabel(String(row.direction ?? 'ZERO')) }}）
            <span v-if="row.note">【{{ row.note }}】</span>
            <span v-if="row.riskNote">【{{ row.riskNote }}】</span>
            <span v-if="row.priceTag">【{{ row.priceTag }}】</span>
          </li>
        </ul>
        <p class="disclaimer">{{ overview.watchlist?.disclaimer }}</p>
      </section>

      <section class="gaps" data-test="gaps">
        <h3>数据缺口</h3>
        <div v-if="gapGroups.failures.length" data-test="gap-failures">
          <h4>数据读取失败</h4>
          <ul><li v-for="gap in gapGroups.failures" :key="gap.code" class="failure">{{ gap.message }}（{{ gap.code }}）<span v-if="gap.affected">：{{ gap.affected }}</span></li></ul>
        </div>
        <div v-if="gapGroups.coverage.length" data-test="gap-coverage">
          <h4>数据覆盖</h4>
          <ul><li v-for="gap in gapGroups.coverage" :key="gap.code">{{ gap.message }}<span v-if="gap.affected">：{{ gap.affected }}</span></li></ul>
        </div>
        <p v-if="!gapGroups.failures.length && !gapGroups.coverage.length" class="muted">无</p>
      </section>
    </section>
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.grain { font-size: var(--font-xs); color: var(--muted); }
.metric-card { border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
.metric-card h3 { margin: 0 0 8px; }
.metrics { display: flex; flex-wrap: wrap; gap: 12px; }
.intervals h3, .watchlist h3, .gaps h3 { margin: 0 0 8px; }
.grid-wrap { overflow-x: auto; }
.intervals table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
.intervals th, .intervals td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; white-space: nowrap; }
tr.uncovered td { color: var(--muted); }
.watchlist ul { margin: 0; padding-left: 18px; font-size: var(--font-sm); }
.watchlist .disclaimer { color: var(--muted); font-size: var(--font-xs); }
.gaps h4 { margin: 8px 0 4px; font-size: var(--font-sm); }
.gaps ul { margin: 0; padding-left: 18px; font-size: var(--font-sm); }
.gaps li.failure { color: var(--danger); }
.muted { color: var(--muted); font-size: var(--font-sm); }
.load-error { color: var(--danger); }
</style>
