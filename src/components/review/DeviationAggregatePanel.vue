<script setup lang="ts">
// 偏差周月聚合面板（Epic #2033 · M2 · #2042：模板七/八）
// ---------------------------------------------------------------------------
// 周（默认）/月切换，逐日调 quant /review 聚合：合计与逐日之和恒等（缺数日如实
// 列出不进合计）；按业务成因占比来自 S1 写回；责任归因二轴仅周聚合人工补填
// （AI 只给映射建议）；「上期改进措施回查」接 improvement_actions 端点（已上线，
// 自动带入 open/carried_over 未闭环项；回查结论回写走复盘会议纪要）；阈值连续
// 超标的自动登记在风险维·风险事件库面板（#2047 触发即草稿），此处仅提示不登记。
import { computed, onMounted, ref, watch } from 'vue'
import { shiftIsoDate } from 'shared/trading-rules/trading-calendar.mjs'
import { fetchReviewRange, type PeriodReview } from '@/services/review/reviewPeriodClient'
import {
  aggregateDeviation,
  consecutiveDeviationBreach,
  isoWeekKeyOf,
  mondayOfIso,
  responsibilityLabelOf,
  RESPONSIBILITY_AXES,
  suggestResponsibility
} from '@/services/review/deviationAggregate'
import { fetchCarryOverActions, type ImprovementActionFeed } from '@/services/review/reviewStoreClient'
import { fetchTemplateInstanceFeed, invalidateTemplateInstanceCache, patchTemplateInstance } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'
import { FEED_ABSENT_NOTE } from '@/services/review/templateInstanceApi'
import { todayBeijing } from '@/utils/beijingDate'
import { currentRegion } from '@/services/region/regionContext'
import {
  fetchDailyWeather,
  regionWeatherCity,
  weatherCellText,
  type DayWeather
} from '@/services/review/reviewWeather'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip } from '@/services/chart/chartOptions'

const props = defineProps<{ tolerancePct: number; penaltyPrice: number }>()

type Period = 'week' | 'month'
const period = ref<Period>('week')
/** 周期锚日：周=周一，月=当月 1 日（默认本周一 / 本月）。mondayOfIso 为 TZ 安全口径
 *  （本地 getDay 在 UTC 机器上会把 +08 锚定日算错星期，周锚点漂 6 天，见 mondayOfIso 注） */
const anchor = ref(mondayOfIso(todayBeijing()))
const loading = ref(false)
const data = ref<PeriodReview | null>(null)

function daysOfPeriod(p: Period, anchorIso: string): string[] {
  if (p === 'week') return Array.from({ length: 7 }, (_, i) => shiftIsoDate(anchorIso, i))
  const [y, m] = anchorIso.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}
const rangeProgress = ref<{ done: number; total: number } | null>(null)
const progressText = computed(() =>
  rangeProgress.value ? `，已取 ${rangeProgress.value.done}/${rangeProgress.value.total} 天` : ''
)
async function load() {
  loading.value = true
  data.value = null
  rangeProgress.value = null
  try {
    const today = todayBeijing()
    // 只取到今天为止（本周/本月未过的日子不进聚合，也不算缺数）
    const dates = daysOfPeriod(period.value, anchor.value).filter((d) => d <= today)
    data.value = await fetchReviewRange(dates, {
      tolerancePct: props.tolerancePct,
      penaltyPrice: props.penaltyPrice,
      onProgress: (done, total) => (rangeProgress.value = { done, total })
    })
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  void loadActions()
  void loadInstanceFeed()
  restoreLocalResp()
})
watch([period, anchor], load)
// 换周/换模式 = 换归因语境：清掉上一周的暂存选择与回显，恢复新周的本机暂存（如有）
watch([period, anchor], () => {
  respDirty.value = false
  respOutcome.value = { kind: 'idle', text: '' }
  responsibility.value = ''
  restoreLocalResp()
})

// 上期改进措施回查（#2042）：improvement_actions 端点已上线，自动带入未闭环项
// （open/carried_over）。回查结论（done/dropped/carried_over）的逐项回写走复盘
// 会议纪要（MeetingMinutesForm），此处只读带入——两个入口写同一份服务端事实，
// 各自重复一套回写 UI 迟早口径分叉。
const actionsLoading = ref(false)
const actionsFeed = ref<ImprovementActionFeed | null>(null)
async function loadActions() {
  actionsLoading.value = true
  try {
    actionsFeed.value = await fetchCarryOverActions()
  } finally {
    actionsLoading.value = false
  }
}

const agg = computed(() => (data.value ? aggregateDeviation(data.value.days) : null))
const breach = computed(() =>
  agg.value ? consecutiveDeviationBreach(agg.value.rows, 0.05) : null
)

// ── 逐日柱状可视化（清单 R3）：偏差率柱（±5% 容差线，超带红柱）+ 考核费柱（右轴）──
// 数据与下方表格同源（agg.rows），缺数日不出柱（null，诚实纪律）；超标判定与表格
// `.bad` 同一阈值（5%），不另起一套口径。
const aggChartEl = ref<HTMLElement | null>(null)
const aggChart = useEChart(aggChartEl, { render: renderAggChart })
function renderAggChart() {
  const rows = agg.value?.rows ?? []
  if (!aggChartEl.value || !rows.length) return
  const tolPct = 5
  const danger = '#b91c1c'
  const primary = cssVar('--primary') || '#0f766e'
  const amber = '#d97706'
  const rateBars = rows.map((r) =>
    r.deviationPct === null
      ? null
      : { value: Math.round(r.deviationPct * 10000) / 100, itemStyle: { color: Math.abs(r.deviationPct) > tolPct / 100 ? danger : primary } }
  )
  const feeBars = rows.map((r) => Math.round(r.estimatedPenaltyYuan * 100) / 100)
  aggChart.setOption({
    tooltip: axisTooltip({ units: { '偏差率': '%', '估算考核费': '元' }, pointer: 'shadow' }),
    legend: { top: 0, textStyle: { fontSize: 10 } },
    grid: { left: 44, right: 52, top: 28, bottom: 22 },
    xAxis: { type: 'category', data: rows.map((r) => r.date.slice(5)) },
    yAxis: [
      { type: 'value', name: '偏差率%', scale: true },
      { type: 'value', name: '考核费元', splitLine: { show: false } }
    ],
    series: [
      {
        name: '偏差率', type: 'bar', data: rateBars, barMaxWidth: 18,
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: danger, opacity: 0.7 },
          label: { fontSize: 10, formatter: '容差 ±5%' },
          data: [{ yAxis: tolPct }, { yAxis: -tolPct }]
        }
      },
      { name: '估算考核费', type: 'bar', yAxisIndex: 1, data: feeBars, itemStyle: { color: amber, opacity: 0.55 }, barMaxWidth: 18 }
    ]
  })
}
watch(agg, () => { if (agg.value) renderAggChart() }, { flush: 'post' })

// 责任归因二轴：仅周聚合人工补填；存 id 不存中文。
// 补全（清单 #2042 断链修复）：选择写入锚定周 T07 实例的 causeCategory 字段
// （模板七的必填人工字段），并回显落库结果；无实例时如实说明未落库。
const responsibility = ref('')
const respDirty = ref(false) // 用户本轮已手选：实例 feed 刷新不回灌覆盖
const respSaving = ref(false)
const respOutcome = ref<{ kind: 'idle' | 'saved' | 'locked' | 'missing' | 'error'; text: string }>({
  kind: 'idle',
  text: ''
})
const responsibilityNote = computed(() => {
  const suggestion = agg.value?.rows.find((r) => r.causeId)?.causeId ?? null
  const s = suggestResponsibility(suggestion)
  return s ? `映射建议（AI 建议、人确认）：${s.label}——依据本周主要业务成因推导，可改选。` : '本周无已判定的业务成因，不建议默认项——数据不够时逼答第二问只会得到假归因。'
})

// 锚定周的 T07 实例（引擎生成）：责任归因选择落它的 causeCategory 字段
const instanceFeed = ref<Awaited<ReturnType<typeof fetchTemplateInstanceFeed>> | null>(null)
const t07Weekly = computed<TemplateInstanceSummary | null>(() => {
  const feed = instanceFeed.value
  if (!feed?.available || period.value !== 'week') return null
  const key = isoWeekKeyOf(anchor.value)
  return feed.instances.find((i) => i.templateId === 'T07' && i.periodKey === key) ?? null
})
async function loadInstanceFeed() {
  instanceFeed.value = await fetchTemplateInstanceFeed()
}

// 本机暂存（无实例时选择不丢失）：按周键存 localStorage（RiskReviewPanel near_miss 同款
// 「暂存本机」模式）。实例 payload 是落库权威——有实例时由 payload 回灌，本机暂存让位。
const RESP_DRAFT_STORAGE_KEY = 'dljy.review.respDraft'
function loadLocalRespDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RESP_DRAFT_STORAGE_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}
function saveLocalRespDraft(weekKey: string, id: string) {
  try {
    const map = loadLocalRespDrafts()
    map[weekKey] = id
    localStorage.setItem(RESP_DRAFT_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 隐私模式/配额满：暂存失败不阻塞选择本身，仅刷新后丢失 */
  }
}
function restoreLocalResp() {
  if (respDirty.value || t07Weekly.value) return // 实例 payload 权威，由其回灌
  const id = loadLocalRespDrafts()[isoWeekKeyOf(anchor.value)]
  if (id) responsibility.value = id
}
// 回填：实例 payload 已有责任归因且用户本轮未手选 → 按中文标签反查 id 回灌选择框
watch(t07Weekly, (inst) => {
  if (respDirty.value || !inst) return
  const v = inst.payload?.causeCategory
  if (typeof v !== 'string' || !v) return
  const id = RESPONSIBILITY_AXES.find((a) => a.label === v)?.id
  if (id) responsibility.value = id
})
async function onResponsibilityChange() {
  respDirty.value = true
  const id = responsibility.value
  if (!id) {
    respOutcome.value = { kind: 'idle', text: '' }
    return
  }
  const label = responsibilityLabelOf(id) ?? id
  const inst = t07Weekly.value
  if (!inst) {
    // 无实例：本机按周键暂存（刷新保留），如实标注未落库——不冒充已提交
    saveLocalRespDraft(isoWeekKeyOf(anchor.value), id)
    respOutcome.value = {
      kind: 'missing',
      text: `已暂存选择：${label}（本机暂存，刷新保留；本周未生成 T07 实例，未落库）`
    }
    return
  }
  if (inst.status === 'submitted' || inst.status === 'reviewed') {
    respOutcome.value = { kind: 'locked', text: `T07 实例 #${inst.id} 已提交锁定，责任归因不可再改（更正走追加记录）` }
    return
  }
  respSaving.value = true
  try {
    await patchTemplateInstance(inst.id, {
      payload: { ...(inst.payload ?? {}), causeCategory: label }
    })
    respOutcome.value = {
      kind: 'saved',
      text: `已记录责任归因：${label}（写入 T07 周报实例 #${inst.id}，周期 ${inst.periodKey}）`
    }
    invalidateTemplateInstanceCache()
  } catch (e) {
    respOutcome.value = { kind: 'error', text: `责任归因写入失败：${e instanceof Error ? e.message : '未知错误'}` }
  } finally {
    respSaving.value = false
  }
}
const periodLabel = computed(() => (period.value === 'week' ? `周（${anchor.value} 起）` : `月（${anchor.value.slice(0, 7)}）`))

// ── 逐日「天气」列（清单 R7b）：偏差解释的第一外生变量，纯展示不进任何考核口径 ──
// 数据=Open-Meteo Archive 历史再分析（真实观测级数据，非合成），覆盖窗内日期可回溯；
// 默认关闭，打开才发一次区间请求；缺日（再分析近 2~5 天延迟）留空、整体失败给提示，不合成。
const weatherOn = ref(false)
const weatherMap = ref<Map<string, DayWeather> | null>(null)
const weatherFailed = ref(false)
let weatherSeq = 0
async function loadWeather() {
  const s = ++weatherSeq
  weatherMap.value = null
  weatherFailed.value = false
  if (!weatherOn.value) return
  const rows = agg.value?.rows ?? []
  if (!rows.length) return
  const city = regionWeatherCity(currentRegion.value.id)
  if (!city) {
    weatherFailed.value = true
    return
  }
  const dates = rows.map((r) => r.date)
  const start = dates.reduce((a, b) => (a < b ? a : b))
  const end = dates.reduce((a, b) => (a > b ? a : b))
  const map = await fetchDailyWeather(city, start, end)
  if (s !== weatherSeq) return
  weatherMap.value = map
  weatherFailed.value = !map
}
watch([weatherOn, agg, () => currentRegion.value.id], () => { void loadWeather() })
</script>

<template>
  <section class="dap">
    <header class="dap-head">
      <b>
        <el-tooltip content="独立于上方复盘日期，默认本周/本月" placement="top" :show-after="150">
          <span class="dap-title">偏差周/月聚合（模板七 · 偏差归因 / 模板八 · 偏差成本核算）</span>
        </el-tooltip>
      </b>
      <span class="dap-ctrl">
        <button type="button" :class="{ on: period === 'week' }" @click="period = 'week'">周</button>
        <button type="button" :class="{ on: period === 'month' }" @click=" period = 'month'">月</button>
        <input v-model="anchor" type="date" :title="period === 'week' ? '周锚日（自动取周一）' : '月锚日'" />
        <button
          type="button" :class="{ on: weatherOn }"
          title="叠加逐日天气列（Open-Meteo 历史再分析，纯展示参考，不进任何考核计算；缺日留空不合成）"
          @click="weatherOn = !weatherOn"
        >天气</button>
      </span>
    </header>

    <p v-if="loading" class="dap-muted">逐日取 quant /review 聚合中（{{ periodLabel }}{{ progressText }}）…</p>

    <template v-else-if="agg">
      <p v-if="agg.missingDays.length" class="dap-warn">
        缺数 {{ agg.missingDays.length }} 日（未接入/覆盖区外/当日无数据，不进合计）：
        {{ agg.missingDays.join('、') }}
      </p>
      <p v-if="!agg.totals.days" class="dap-muted">本周期无可用数据日——诚实空态，不合成。</p>
      <p v-if="weatherOn && !agg.totals.days" class="dap-muted">天气列无对象可标：本周期没有可复盘数据日。</p>

      <!-- 逐日柱状可视化（清单 R3）：与下方表格同源同口径，缺数日不出柱 -->
      <div v-if="agg.rows.length" ref="aggChartEl" class="dap-chart" />

      <table v-if="agg.rows.length" class="dap-table">
        <thead>
          <tr>
            <th>日期</th><th>偏差率</th><th>总偏差 MWh</th><th>受考核 MWh</th><th>考核费估算 元</th>
            <th v-if="weatherOn" title="当日天气（太原·Open-Meteo 历史再分析；纯展示参考，不进考核口径；缺日留空）">天气</th>
            <th>S1 业务成因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in agg.rows" :key="r.date">
            <td>{{ r.date }}</td>
            <td :class="{ bad: r.deviationPct !== null && Math.abs(r.deviationPct) > 0.05 }">
              {{ r.deviationPct === null ? '—' : (r.deviationPct * 100).toFixed(2) + '%' }}
            </td>
            <td>{{ r.totalAbsDeviationMwh.toFixed(2) }}</td>
            <td>{{ r.assessedMwh.toFixed(2) }}</td>
            <td>{{ r.estimatedPenaltyYuan.toLocaleString() }}</td>
            <td v-if="weatherOn">{{ weatherCellText(weatherMap?.get(r.date)) }}</td>
            <td>{{ r.causeLabel ?? '未判定' }}</td>
          </tr>
          <tr class="dap-total">
            <td>合计（{{ agg.totals.days }} 日）</td>
            <td>{{ agg.totals.deviationPct === null ? '—' : (agg.totals.deviationPct * 100).toFixed(2) + '%' }}</td>
            <td>{{ agg.totals.deviationMwh.toFixed(2) }}</td>
            <td>{{ agg.totals.assessedMwh.toFixed(2) }}</td>
            <td>{{ agg.totals.penaltyYuan.toLocaleString() }}</td>
            <td v-if="weatherOn" />
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p v-if="weatherOn && weatherFailed" class="dap-muted">
        天气数据不可用（该地区无天气参考点，或外部历史天气源失败）——本列留空，不合成。
      </p>
      <p class="dap-note">合计与逐日之和恒等；金额为自算口径（caliber: self-computed，结算细则未核验）。</p>

      <!-- 按业务成因占比（第一轴：负荷/新能源/通道/价格，S1 写回） -->
      <div v-if="agg.byCause.length" class="dap-cause">
        <b>业务成因分布（第一轴 · 来自 S1 晨会写回）</b>
        <span v-for="c in agg.byCause" :key="c.causeId" class="dap-chip">
          {{ c.causeLabel }} {{ c.days }} 天
        </span>
      </div>

      <!-- 责任归因二轴：仅周聚合、人工补填 -->
      <div v-if="period === 'week'" class="dap-axis">
        <label>
          责任归因（第二轴 · 仅周聚合人工补填，与第一轴正交不合并）
          <select v-model="responsibility" :disabled="respSaving" @change="onResponsibilityChange">
            <option value="">选择…</option>
            <option v-for="a in RESPONSIBILITY_AXES" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </label>
        <p class="dap-note">{{ responsibilityNote }}</p>
        <p v-if="respOutcome.text" class="dap-note" :class="{ 'dap-resp-ok': respOutcome.kind === 'saved', 'dap-resp-err': respOutcome.kind === 'error' }">
          {{ respOutcome.text }}
        </p>
      </div>

      <!-- 阈值预警：自动登记已由风险维实现（确定性幂等键 + 按月去重），此处仅提示不重复登记 -->
      <p v-if="breach" class="dap-warn">
        偏差率连续 {{ breach.streak }} 日超 5%（{{ breach.from }} ~ {{ breach.to }}）——
        越限即预警型待办，事件库草稿已在「风险」维·风险事件库面板自动登记（#2047）。
      </p>

      <!-- 上期改进措施回查（#2042）：端点已上线，自动带入未闭环项；结论回写走会议纪要 -->
      <details class="dap-actions">
        <summary>上期改进措施落实情况回查（未闭环项自动带入）</summary>
        <p v-if="actionsLoading" class="dap-note">改进措施库读取中…</p>
        <template v-else-if="actionsFeed?.available">
          <p v-if="!actionsFeed.actions.length" class="dap-note">
            改进措施库无未闭环项（open/carried_over 均已闭环）——本期无待回查项。
          </p>
          <template v-else>
            <ul class="dap-action-list">
              <li v-for="a in actionsFeed.actions" :key="a.id">
                {{ a.action }} · {{ a.status === 'carried_over' ? '已顺延' : '未落实' }}<template v-if="a.owner"> · 责任人 {{ a.owner }}</template><template v-if="a.dueDate"> · 时限 {{ a.dueDate }}</template>
              </li>
            </ul>
            <p class="dap-note">
              共 {{ actionsFeed.actions.length }} 项未闭环。回查结论（done/dropped/carried_over）在
              「风险」维·复盘会议纪要中逐项回写，此处只读带入，不做两套回写入口。
            </p>
          </template>
        </template>
        <p v-else class="dap-note">
          {{ FEED_ABSENT_NOTE }}改进措施库读取端点未接入/不可达——上期未落实项需人工带入，不做假回查。
        </p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.dap { display: flex; flex-direction: column; gap: 8px; font-size: var(--font-12-5); }
.dap-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dap-title { cursor: help; }
.dap-ctrl { display: inline-flex; gap: 4px; align-items: center; }
.dap-ctrl button { padding: 2px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.dap-ctrl button.on { border-color: var(--el-color-primary, #2563eb); color: var(--el-color-primary, #2563eb); }
.dap-ctrl input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.dap-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.dap-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.dap-chart { width: 100%; height: 210px; }
.dap-table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); font-variant-numeric: tabular-nums; }
.dap-table th, .dap-table td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.dap-table th:first-child, .dap-table td:first-child { text-align: left; }
.dap-table th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: var(--font-10-5); }
.dap-total td { font-weight: 600; border-top: 1px solid var(--el-border-color, #dcdfe6); }
.dap-table .bad { color: #b91c1c; }
.dap-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.dap-cause { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dap-cause b { font-size: var(--font-sm); }
.dap-chip { font-size: var(--font-xs); border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 999px; padding: 1px 8px; }
.dap-axis label { display: flex; align-items: center; gap: 8px; font-size: var(--font-sm); flex-wrap: wrap; }
.dap-axis select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-sm); }
.dap-resp-ok { color: #15803d; }
.dap-resp-err { color: #b91c1c; }
.dap-actions summary { cursor: pointer; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.dap-action-list { margin: 4px 0; padding-left: 18px; font-size: var(--font-11-5); line-height: 1.8; color: var(--el-text-color-regular, #444); }
</style>
