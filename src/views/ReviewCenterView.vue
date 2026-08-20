<script setup lang="ts">
// 复盘中心（/xhjy/review，D+1 动线）：偏差考核 + 申报回测 + 智能体复盘报告。
// 确定性数字走 /quant/review 直调端点；归因叙事走 daily_review 智能体场景。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { FileText, Sparkles, X } from 'lucide-vue-next'
import AgentChatPanel from '../components/agent/AgentChatPanel.vue'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { renderMarkdown } from '../utils/miniMarkdown'
import {
  fetchReportContent,
  fetchReports,
  fetchReview,
  fetchSettlementReview,
  classifyReviewError,
  type ReportItem,
  type ReviewFailure,
  type ReviewResult,
  type SettlementReviewResult
} from '@/services/quant/quantClient'
import { captureCoverage, clampToCoverage, isOutOfCoverage } from '@/services/market/captureCoverage'
import { getDeclaration, type DeclarationOrder } from '@/services/declarations'
import { EFFECTIVENESS_LABEL, getSettlementRuleSpec } from '../rules/settlement'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { apiGet } from '@/services/api'
import DimensionGrid from '@/components/review/DimensionGrid.vue'
import TodoInbox from '@/components/review/TodoInbox.vue'
import ReviewTemplateForm from '@/components/review/ReviewTemplateForm.vue'
import DeviationAggregatePanel from '@/components/review/DeviationAggregatePanel.vue'
import PnlDecomposePanel from '@/components/review/PnlDecomposePanel.vue'
import MarketAttributionPanel from '@/components/review/MarketAttributionPanel.vue'
import RiskReviewPanel from '@/components/review/RiskReviewPanel.vue'
import SubjectCockpit from '@/components/review/SubjectCockpit.vue'
import EmotionPatternPanel from '@/components/review/EmotionPatternPanel.vue'
import MeetingMinutesForm from '@/components/review/MeetingMinutesForm.vue'
import {
  buildDimensionCards,
  deviationMetricOf,
  RISK_CARD_NOTE,
  type DimensionCard,
  type TemplateCard,
  type TodoRow
} from '@/services/review/cockpitModel'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'
import { getRegionWinStats } from '@/services/tradingMemory'

const route = useRoute()

function yesterday(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

// P2：结算规则参数化，免考核带默认值改读当前地区 SettlementRuleSpec；
// 未沉淀规格的地区保留 3% 通用默认并显示"未参数化"提示（不静默借用别省参数）。
const settlementSpec = computed(() => getSettlementRuleSpec(currentRegion.value.id))

// 复盘默认日期是「昨天」，而真实采集是历史批次，默认值落在覆盖区外就永远空手而归。
// 覆盖区间集中登记在 captureCoverage（原先只有云南一条硬编码在本文件；#1531 起山西的
// 申报/价格也按日取真实数据，同样需要钳）。只钳默认值，不限制用户手选。
function defaultDateFor(regionId: string): string {
  return clampToCoverage(regionId, 'review', yesterday())
}

const date = ref(
  typeof route.query.date === 'string' ? route.query.date : defaultDateFor(currentRegion.value.id)
)
// 结算口径复盘（云南三段式）：与上面的偏差考核是两套口径，各自独立加载、互不阻塞
const settlementReview = ref<SettlementReviewResult | null>(null)
const settlementReviewError = ref('')
const isYunnan = computed(() => currentRegion.value.id === 'yunnan')
const coverage = computed(() => captureCoverage(currentRegion.value.id, 'review'))
const outOfCoverage = computed(() => isOutOfCoverage(currentRegion.value.id, 'review', date.value))
const tolerancePct = ref(settlementSpec.value?.deviationTolerancePct ?? 3.0)
const penaltyPrice = ref(100)
const loading = ref(false)
const error = ref('')
const result = ref<ReviewResult | null>(null)
const reviewFailure = ref<ReviewFailure | null>(null)

// P1-4：申报单作为回测基准（来自申报台 ④ 步深链 ?declarationId=）
const declarationId = ref(typeof route.query.declarationId === 'string' ? route.query.declarationId : '')
const declaration = ref<DeclarationOrder | null>(null)

// P2-4：结算对账，导入中心的结算台账（/api/v1/settlements）与自算考核对照
type ImportedSettlementRow = { 结算月份: string; 结算对象: string; 电量: number; 电费: number; 偏差费用: number }
const settlementRows = ref<ImportedSettlementRow[]>([])
const reviewMonth = computed(() => date.value.slice(0, 7))
const importedDeviationFee = computed(() =>
  Math.round(settlementRows.value.reduce((sum, row) => sum + (Number(row.偏差费用) || 0), 0))
)
const daysInMonth = computed(() => new Date(Number(reviewMonth.value.slice(0, 4)), Number(reviewMonth.value.slice(5, 7)), 0).getDate())
const reconcileDiff = computed(() => {
  if (!result.value || !settlementRows.value.length) return 0
  const dailyShare = importedDeviationFee.value / Math.max(daysInMonth.value, 1)
  return Math.round(result.value.deviation.estimated_penalty_yuan - dailyShare)
})

async function loadSettlements() {
  try {
    const res = await apiGet<{ data: { rows: ImportedSettlementRow[] } }>('/v1/settlements', { month: reviewMonth.value })
    settlementRows.value = ((res.data ?? res) as unknown as { rows?: ImportedSettlementRow[] }).rows ?? []
  } catch {
    // 结算台账加载失败时显式提醒（区别于"尚未导入"的正常空态）
    settlementRows.value = []
    ElMessage.warning(`结算台账（${reviewMonth.value}）加载失败，结算对账卡片按未导入处理`)
  }
}

const chartEl = ref<HTMLElement | null>(null)
const deviationChart = useEChart(chartEl, { render: renderChart })

// 智能体复盘
const reportRunning = ref(false)
const reports = ref<ReportItem[]>([])
const readingReport = ref<{ title: string; html: string } | null>(null)

const pnlClass = computed(() =>
  (result.value?.backtest.da_rt_spread_pnl_yuan ?? 0) >= 0 ? 'good' : 'bad'
)

// 六维驾驶舱 v1（Epic #2033 · #2038）
// 两张真数指标卡之一：偏差率（总偏差/申报总量，quant /review 权威口径，仅覆盖区出数）；
// 风险事件卡 M3 前占位空态；覆盖率/填写率不上（#2039 已有分母，KPI 面板接入归 M2，不提前凑数）。
const dimensionCards = buildDimensionCards()
const declaredTotalMwh = computed(() =>
  result.value?.detail.length ? result.value.detail.reduce((a, p) => a + (p.declared ?? 0), 0) : null
)
const deviationMetric = computed(() =>
  deviationMetricOf({
    totalAbsDeviationMwh: result.value?.deviation.total_abs_deviation_mwh ?? null,
    declaredTotalMwh: declaredTotalMwh.value,
    estimatedPenaltyYuan: result.value?.deviation.estimated_penalty_yuan ?? null
  })
)

/** 三主体驾驶舱（批1 售电 R1/R4 公司级日度行）喂当日 /review 真数。 */
const subjectDaySummary = computed(() =>
  result.value && deviationMetric.value.totalAbsDeviationMwh !== null
    ? {
        date: date.value,
        declaredTotalMwh: declaredTotalMwh.value,
        deviationMwh: deviationMetric.value.totalAbsDeviationMwh,
        deviationPct: deviationMetric.value.deviationPct,
        estimatedPenaltyYuan: deviationMetric.value.estimatedPenaltyYuan
      }
    : null
)

// 模板抽屉：chip/待办行打开单模板；无锚点维度先看维度模板清单再进。
// 待办行带上实例（#2037）：表单直连服务端草稿/提交；模板 chip 直开仍是纯预览。
const templateDrawer = ref<
  | { mode: 'template'; templateId: string; instance?: TemplateInstanceSummary | null }
  | { mode: 'dimension'; dimension: DimensionCard['key'] }
  | null
>(null)

function openTemplate(t: TemplateCard) {
  templateDrawer.value = { mode: 'template', templateId: t.id }
}
/** 三主体驾驶舱等按 id 直开模板渲染器。 */
function openTemplateById(id: string) {
  templateDrawer.value = { mode: 'template', templateId: id }
}
function openTodoInstance(row: TodoRow) {
  // row 即实例摘要（id/status/payload）——不传实例表单只是预览，传了才能落库提交
  templateDrawer.value = { mode: 'template', templateId: row.templateId, instance: toInstanceSummary(row) }
}
/** TodoRow（实例 + 模板元信息）→ 表单需要的实例摘要。 */
function toInstanceSummary(row: TodoRow): TemplateInstanceSummary {
  return {
    id: row.id,
    templateId: row.templateId,
    periodKey: row.periodKey,
    status: row.status,
    dueAt: row.dueAt,
    updatedAt: row.updatedAt,
    payload: row.payload
  }
}
/** 表单保存/提交成功：抽屉实例状态同步 + 待办箱强制重取（缓存已被 PATCH 作废）。 */
const todoInboxRef = ref<InstanceType<typeof TodoInbox> | null>(null)
async function refreshTodoFeed() {
  await todoInboxRef.value?.reload()
}
async function onInstanceSaved(status: 'draft' | 'submitted') {
  const d = templateDrawer.value
  if (d?.mode === 'template' && d.instance) {
    d.instance = { ...d.instance, status }
  }
  await refreshTodoFeed()
}
function onSelectDimension(card: DimensionCard) {
  if (card.anchor) {
    // 维度面板默认折叠（details），先展开再滚到锚点
    openedDims.value.add(card.anchor)
    nextTick(() => document.getElementById(`sec-${card.anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  } else {
    templateDrawer.value = { mode: 'dimension', dimension: card.key }
  }
}
const drawerCard = computed(() => {
  const d = templateDrawer.value
  return d && d.mode === 'dimension' ? (dimensionCards.find((c) => c.key === d.dimension) ?? null) : null
})

// M2–M4 维度面板区：策略/市场/风险/决策 + 三主体，默认折叠、维度入口点击展开
const openedDims = ref(new Set<string>())
function dimOpen(key: string): boolean {
  return openedDims.value.has(key)
}
function toggleDim(key: string, open: boolean) {
  const next = new Set(openedDims.value)
  if (open) next.add(key)
  else next.delete(key)
  openedDims.value = next
}

// 策略维度：胜率概览（tradingMemory 后验真数据；样本 <30 不出结论只标样本不足，T04 硬规则）
const winStats = computed(() => getRegionWinStats(currentRegion.value.id))

async function load() {
  loading.value = true
  deviationChart.showLoading()
  error.value = ''
  reviewFailure.value = null
  result.value = null
  try {
    // 申报单基准：拿得到曲线则回测以真实申报单为准；拿不到降级合成基准并提示
    if (declarationId.value && !declaration.value) {
      try {
        declaration.value = await getDeclaration(declarationId.value)
      } catch {
        // 失败降级合成基准：参数条会显示"申报单 xxx 不可达"提示，非静默吞错
        declaration.value = null
      }
    }
    result.value = await fetchReview({
      date: date.value,
      tolerance_pct: tolerancePct.value,
      penalty_price: penaltyPrice.value,
      declared_mwh_96: declaration.value?.energyCurveMwh96,
      declaration_id: declaration.value?.id
    })
    await nextTick()
    renderChart()
  } catch (e) {
    reviewFailure.value = classifyReviewError(e)
  } finally {
    loading.value = false
    deviationChart.hideLoading()
  }
}

function renderChart() {
  const r = result.value
  if (!r || !chartEl.value) return
  deviationChart.setOption({
    ...emptyOverlay(!r.detail.length),
    tooltip: axisTooltip({ unit: 'MWh' }),
    legend: { data: ['申报电量', '实际电量', '受考核电量'], top: 0, right: 110 },
    toolbox: chartToolbox('申报vs实际偏差'),
    grid: { left: 48, right: 16, top: 30, bottom: 26 },
    dataZoom: insideZoom(),
    xAxis: { type: 'category', data: r.detail.map((p) => String(p.datetime).slice(-5)) },
    yAxis: { type: 'value', name: 'MWh', scale: true },
    series: [
      // 分时电量按时段恒定，阶梯线真实呈现；申报为决策值虚线、实际计量实线加粗
      { name: '申报电量', type: 'line', step: 'end', showSymbol: false, data: r.detail.map((p) => p.declared), lineStyle: { width: 1.4, type: 'dashed' } },
      { name: '实际电量', type: 'line', step: 'end', showSymbol: false, data: r.detail.map((p) => p.actual), lineStyle: { width: 2 } },
      {
        name: '受考核电量', type: 'bar',
        data: r.detail.map((p) => ({
          value: p.assessed_mwh,
          itemStyle: { color: 'rgba(245,158,11,0.6)' }
        }))
      }
    ]
  }, { replaceMerge: ['graphic'] }) // 空态 graphic 需整组替换才能在有数据时清掉
}

async function loadReports() {
  reports.value = await fetchReports('daily_review')
}

function onReportDone() {
  // 智能体复盘流结束 → 刷新历史报告列表（done emit，无需轮询）
  loadReports()
}

async function openReport(item: ReportItem) {
  try {
    const md = await fetchReportContent(item.session_id, item.path)
    readingReport.value = { title: item.title, html: renderMarkdown(md) }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '报告读取失败'
  }
}

/** 结算明细格式化：源行缺字段时显示「—」，不折成 0（「没这项」≠「这项是零」）。 */
function num(v: number | null): string {
  return v == null ? '—' : String(v)
}
function money(v: number | null): string {
  return v == null ? '—' : Math.round(v).toLocaleString()
}

// 请求序号：日期/地区连续切换时，先发出的请求可能后返回。只认最新一次的结果，
// 否则旧响应会覆盖新参数的结果（#1502）。
let settlementSeq = 0

async function loadSettlementReview() {
  const seq = ++settlementSeq
  // 先清空再取：不清的话请求期间会把上一日的数字和新日期并排显示；选到覆盖区间外时
  // 更会出现「范围警告」与上一日结算数字同屏，读者无从判断看到的是哪天。
  settlementReview.value = null
  settlementReviewError.value = ''
  // 仅云南接入结算族；其他地区后端会 not_onboarded，没必要发这个请求
  if (!isYunnan.value) return
  // 覆盖区间外直接展示范围提示，不发注定 503 的请求
  if (outOfCoverage.value) return
  const dateAtStart = date.value
  try {
    const out = await fetchSettlementReview(dateAtStart)
    if (seq !== settlementSeq) return  // 期间已有更新的请求，丢弃本次结果
    settlementReview.value = out
  } catch (e) {
    if (seq !== settlementSeq) return
    // 独立 catch：结算口径失败不阻断偏差考核区，反之亦然
    settlementReviewError.value = e instanceof Error ? e.message : '结算口径复盘加载失败'
  }
}

onMounted(() => {
  load()
  void loadSettlementReview()
  loadReports().then(() => openDeepLinkedReport())
  loadSettlements()
  // 深链（#2038/#2040）：?todo=1 滚到待办箱；?run=1 直接展开一键生成（S1 报告卡手动触发入口）
  if (route.query.todo === '1') {
    nextTick(() => document.getElementById('review-todo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  if (route.query.run === '1') {
    reportRunning.value = true
  }
})

/** ?report=<session_id>：S1 昨夜报告卡「看全文」直开阅读器。 */
async function openDeepLinkedReport() {
  const sid = typeof route.query.report === 'string' ? route.query.report : ''
  if (!sid) return
  const item = reports.value.find((r) => r.session_id === sid)
  if (item) await openReport(item)
}
watch(reviewMonth, loadSettlements)
// 地区切换：onRegionChange 自包含地按新地区 SettlementRuleSpec 更新容差并重载，
// 不依赖 settlementSpec watch 的执行顺序（加固：守卫逻辑收敛到单一 watch 内）。
// regionSwitching 守卫避免 onRegionChange 改 tolerancePct 穿透到参数 watch 造成双重 load；
// 参数 watch 仅响应用户手改 date/tolerancePct/penaltyPrice。
let regionSwitching = false
watch([date, tolerancePct, penaltyPrice], () => {
  if (regionSwitching) return
  void load()
  void loadSettlementReview()
})
onRegionChange(() => {
  regionSwitching = true
  const spec = getSettlementRuleSpec(currentRegion.value.id)
  tolerancePct.value = spec?.deviationTolerancePct ?? 3.0
  // 切地区时若当前日期在该地区的采集覆盖区间外，落回区间内（否则切过去就是空页面）
  if (isOutOfCoverage(currentRegion.value.id, 'review', date.value)) {
    date.value = clampToCoverage(currentRegion.value.id, 'review', date.value)
  }
  void load()
  void loadSettlementReview()
  void loadReports()  // 切地区也重载历史报告列表（报告 sidecar 带 region_id，后端按地区过滤）
  nextTick(() => { regionSwitching = false })
})
</script>

<template>
  <div class="review page-stack">
    <RegionDataBanner />
    <!-- 参数条 -->
    <section class="panel params">
      <label>复盘日期 <input v-model="date" type="date" /></label>
      <label>免考核带(%) <input v-model.number="tolerancePct" type="number" min="0" max="50" step="0.5" /></label>
      <label>考核单价(元/MWh) <input v-model.number="penaltyPrice" type="number" min="0" /></label>
      <span v-if="settlementSpec" class="rule-tag" :title="settlementSpec.notes.join('；')">
        规则 {{ settlementSpec.version }} · {{ EFFECTIVENESS_LABEL[settlementSpec.effectiveness] }}
      </span>
      <span v-else class="demo-tag">本地区结算规则未参数化，使用通用默认值</span>
      <span v-if="declaration" class="baseline-tag">回测基准：申报单 {{ declaration.id }}</span>
      <span v-else-if="declarationId" class="demo-tag">申报单 {{ declarationId }} 不可达，已降级合成基准</span>
      <span v-if="result?.source === 'synthetic_mock'" class="demo-tag">演示数据</span>
      <span v-if="error" class="error-tag">{{ error }}</span>
    </section>

    <!-- 六维驾驶舱 v1（Epic #2033 · #2038）：两张真数指标卡 + 六维入口。
         偏差/结果维度锚到下方既有区块（升级现页不另建）；其余维度入口=模板抽屉。 -->
    <section class="cockpit">
      <div class="metric-cards">
        <div class="metric-card" :class="{ empty: !result }">
          <div class="m-head">
            偏差率（{{ date }}）
            <span class="m-src">{{ result?.actual_source ? `实际侧：${result.actual_source}` : 'quant /review 权威口径' }}</span>
          </div>
          <template v-if="result">
            <b class="m-value" :class="deviationMetric.deviationPct !== null && deviationMetric.deviationPct > 0.05 ? 'bad' : ''">
              {{ deviationMetric.deviationPct === null ? '—' : (deviationMetric.deviationPct * 100).toFixed(2) + '%' }}
            </b>
            <span class="m-sub">
              总偏差 {{ deviationMetric.totalAbsDeviationMwh ?? '—' }} MWh ·
              考核费估算 {{ deviationMetric.estimatedPenaltyYuan?.toLocaleString() ?? '—' }} 元
              · 免考核带 ±{{ result.deviation.tolerance_pct }}%
            </span>
          </template>
          <p v-else class="m-note">未出数：未接入地区/覆盖区外/参数未定时诚实空态（见下方引导卡），不合成、不串读他省。</p>
        </div>
        <div class="metric-card placeholder">
          <div class="m-head">风险事件<span class="m-tag">M3 前占位</span></div>
          <p class="m-note">{{ RISK_CARD_NOTE }}</p>
        </div>
      </div>
      <DimensionGrid :cards="dimensionCards" @select-dimension="onSelectDimension" @open-template="openTemplate" />
    </section>

    <!-- 结算口径日复盘（云南三段式）：与下方「申报 vs 实际偏差考核」是两套口径。
         这里是电网结算单给出的结果：实际上网电量按中长期/日前增量/实时增量三段分解并逐段计价。 -->
    <section v-if="isYunnan" class="panel settlement-review">
      <div class="block-title">
        结算口径复盘 · 三段式电量分解
        <span class="basis-tag">电网结算单口径</span>
        <span v-if="settlementReview" class="plant-tag">{{ settlementReview.plant_count }} 座厂站汇总</span>
      </div>

      <p v-if="outOfCoverage && coverage" class="coverage-hint">
        云南结算数据目前只采集到 {{ coverage.start }} ~ {{ coverage.end }}，
        当前所选 {{ date }} 不在覆盖区间内。换到区间内的日期即可查看。
      </p>
      <p v-else-if="settlementReviewError" class="error-tag">{{ settlementReviewError }}</p>

      <template v-if="settlementReview">
        <p v-if="settlementReview.mock" class="mock-banner">
          ⚠ <strong>模拟数据</strong> ·
          {{ settlementReview.warning ?? '该结算为结构同构的模拟数据（mock-capture 生成），仅供联调查看形态，不可作为结算或复盘依据' }}
        </p>
        <div class="seg-row">
          <div class="seg-card ltm">
            <div class="seg-label">中长期</div>
            <div class="seg-value">{{ settlementReview.summary.ltmEnergy.toFixed(1) }}<i>MWh</i></div>
          </div>
          <div class="seg-op">+</div>
          <div class="seg-card da">
            <div class="seg-label">日前增量</div>
            <div class="seg-value">{{ settlementReview.summary.daDevEnergy.toFixed(1) }}<i>MWh</i></div>
            <div class="seg-fee">{{ Math.round(settlementReview.summary.daDevFee).toLocaleString() }} 元</div>
          </div>
          <div class="seg-op">+</div>
          <div class="seg-card rt">
            <div class="seg-label">实时增量</div>
            <div class="seg-value">{{ settlementReview.summary.rtDevEnergy.toFixed(1) }}<i>MWh</i></div>
            <div class="seg-fee">{{ Math.round(settlementReview.summary.rtDevFee).toLocaleString() }} 元</div>
          </div>
          <div class="seg-op">=</div>
          <div class="seg-card total">
            <div class="seg-label">实际上网</div>
            <div class="seg-value">{{ settlementReview.summary.actualOnGridEnergy.toFixed(1) }}<i>MWh</i></div>
            <div class="seg-fee">
              总电费 {{ Math.round(settlementReview.summary.totalFee).toLocaleString() }} 元 ·
              均价 {{ settlementReview.summary.avgPrice ?? '—' }} 元/MWh
            </div>
          </div>
        </div>

        <p class="basis-note">{{ settlementReview.basis_note }}</p>

        <details class="plant-detail">
          <summary>分厂站明细（按实际上网电量降序）</summary>
          <table class="plant-table">
            <thead>
              <tr>
                <th>厂站</th><th>中长期</th><th>日前出清</th><th>日前增量</th>
                <th>实时增量</th><th>实际上网</th><th>总电费(元)</th><th>均价</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in settlementReview.plants" :key="p.plant">
                <td class="plant-name">{{ p.plant }}</td>
                <td>{{ num(p.ltmEnergy) }}</td>
                <td>{{ num(p.daClearedEnergy) }}</td>
                <td>{{ num(p.daDevEnergy) }}</td>
                <td>{{ num(p.rtDevEnergy) }}</td>
                <td>{{ num(p.actualOnGridEnergy) }}</td>
                <td>{{ money(p.totalFee) }}</td>
                <td>{{ num(p.avgPrice) }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </template>
    </section>

    <div class="review-grid">
      <!-- 左：图 + 数字卡 -->
      <div class="left-col">
        <section v-if="reviewFailure" class="panel review-guidance" :class="`state-${reviewFailure.kind}`">
          <el-empty :image-size="82">
            <template #description>
              <strong>{{ reviewFailure.title }}</strong>
              <p>{{ reviewFailure.description }}</p>
              <small v-if="reviewFailure.detail">后端返回：{{ reviewFailure.detail }}</small>
            </template>
          </el-empty>
        </section>
        <section v-else id="sec-deviation" class="panel chart-block">
          <div class="block-title">申报 vs 实际 · 96 点偏差</div>
          <div ref="chartEl" class="main-chart chart-host" />
        </section>

        <!-- 口径边界：后端随响应下发，原样呈现。数字本身不带口径：不显示等于把
             「按平台实时电量自算」悄悄当成了「电网结算结论」。 -->
        <section v-if="result?.caliber_caveats?.length" class="panel caliber-note">
          <div class="block-title">口径边界 · 这份复盘不能当作什么</div>
          <ul>
            <li v-for="(c, i) in result.caliber_caveats" :key="i">{{ c }}</li>
          </ul>
        </section>

        <div class="card-row" id="sec-result" v-if="result">
          <section class="panel num-card">
            <div class="block-title">偏差考核（容差 ±{{ result.deviation.tolerance_pct }}%）</div>
            <div class="num-row"><span>总偏差电量</span><b>{{ result.deviation.total_abs_deviation_mwh }} MWh</b></div>
            <div class="num-row"><span>受考核电量</span><b>{{ result.deviation.assessed_mwh }} MWh</b></div>
            <div class="num-row main"><span>估算考核费</span><b class="bad">{{ result.deviation.estimated_penalty_yuan.toLocaleString() }} 元</b></div>
            <div class="num-row"><span>最差时点</span>
              <b>{{ String(result.deviation.worst_point.datetime ?? '-').slice(-5) }}
                （{{ result.deviation.worst_point.deviation > 0 ? '+' : '' }}{{ result.deviation.worst_point.deviation }} MWh）</b>
            </div>
          </section>

          <section class="panel num-card">
            <div class="block-title">申报回测</div>
            <div class="num-row"><span>日前收益</span><b>{{ result.backtest.da_revenue_yuan.toLocaleString() }} 元</b></div>
            <div class="num-row"><span>申报均价</span><b>{{ result.backtest.avg_da_price }} 元/MWh</b></div>
            <div class="num-row main"><span>日前-实时价差盈亏</span>
              <b :class="pnlClass">{{ (result.backtest.da_rt_spread_pnl_yuan ?? 0).toLocaleString() }} 元</b>
            </div>
            <p class="hint">{{ result.backtest.note }}</p>
          </section>

          <!-- P2-4 结算对账：导入的正式结算单 vs 自算考核（数据来自导入中心"结算导入"）-->
          <section class="panel num-card">
            <div class="block-title">结算对账（{{ reviewMonth }}）</div>
            <template v-if="settlementRows.length">
              <div class="num-row"><span>导入结算行</span><b>{{ settlementRows.length }} 行</b></div>
              <div class="num-row"><span>结算单偏差费用合计</span><b>{{ importedDeviationFee.toLocaleString() }} 元</b></div>
              <div class="num-row main"><span>自算 vs 结算单差异</span>
                <b :class="reconcileDiff >= 0 ? 'bad' : 'good'">{{ reconcileDiff.toLocaleString() }} 元</b>
              </div>
              <p class="hint">差异 = 当日自算考核费 − 结算单月度偏差费用按日均摊；仅作量级对照，正式对账以分日结算单为准。</p>
            </template>
            <template v-else>
              <p class="muted">{{ reviewMonth }} 暂无导入结算单。在「数据导入融合台 → 结算」上传 CSV 后，此处自动对账。</p>
            </template>
          </section>
        </div>

        <!-- 偏差维度深入：周/月聚合（#2042 模板七/八） -->
        <DeviationAggregatePanel :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" />

        <!-- 结果维度深入：收益三层拆解与 Top5（#2043 模板二/三） -->
        <PnlDecomposePanel :spec="settlementSpec" :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" />
      </div>

      <!-- 右：待办箱 + 智能体复盘 + 历史报告 -->
      <div class="right-col">
        <TodoInbox ref="todoInboxRef" @open-instance="openTodoInstance" />

        <section class="panel agent-block">
          <div class="block-title"><Sparkles :size="14" /> 智能体复盘（归因叙事 + 报告落盘）</div>
          <button v-if="!reportRunning" class="launch" @click="reportRunning = true">
            一键生成 {{ date }} 复盘报告
          </button>
          <div v-else class="agent-embed">
            <AgentChatPanel
              scenario="daily_review"
              :initial-question="date"
              :prompt-key="PAGE_PROMPT_KEYS.reviewCenter"
              history-key="review_center"
              @done="onReportDone"
            />
          </div>
        </section>

        <section class="panel reports-block">
          <div class="block-title"><FileText :size="14" /> 历史复盘报告（{{ reports.length }}）</div>
          <p v-if="!reports.length" class="muted">暂无报告。生成一份或等待每日定时任务产出。</p>
          <button v-for="r in reports.slice(0, 12)" :key="r.session_id + r.path" class="report-row" @click="openReport(r)">
            <span class="report-title">{{ r.title }}</span>
            <span class="report-meta">{{ new Date(r.mtime * 1000).toLocaleString() }}
              · {{ r.session_id.startsWith('sched_') ? '定时' : '手动' }}</span>
          </button>
        </section>
      </div>
    </div>

    <!-- 六维深入面板区（M2–M4 · #2042–#2049）：默认折叠，六维入口卡点击展开并滚到锚点 -->
    <section class="dim-panels">
      <details id="sec-strategy" class="panel dim-panel" :open="dimOpen('strategy')" @toggle="e => toggleDim('strategy', (e.target as HTMLDetailsElement).open)">
        <summary>策略复盘 · 胜率概览（模板四）</summary>
        <div class="dim-body">
          <div class="win-facts">
            <span>后验胜率 <b>{{ (winStats.posteriorWinRate * 100).toFixed(1) }}%</b></span>
            <span>样本 {{ winStats.sampleSize }} 笔</span>
            <span v-if="winStats.sampleSize > 0">90% 可信区间 {{ (winStats.credibleLow * 100).toFixed(0) }}%–{{ (winStats.credibleHigh * 100).toFixed(0) }}%</span>
          </div>
          <p v-if="winStats.sampleSize < 30" class="dim-note">
            样本 &lt;30 不出胜率结论、只标「样本不足」（T04 方案原文硬规则）——上方数字仅为后验分布参考。
          </p>
          <p class="dim-note">
            策略库与胜率分析报告的服务端化（tradingMemory 收编 PG、回测/实盘双口径分列）归 #2045；
            本区当前消费前端 Beta-Binomial 后验真数据。
          </p>
        </div>
      </details>

      <details id="sec-market" class="panel dim-panel" :open="dimOpen('market')" @toggle="e => toggleDim('market', (e.target as HTMLDetailsElement).open)">
        <summary>市场复盘 · 月度市场归因（#2046 模板六）</summary>
        <div class="dim-body"><MarketAttributionPanel /></div>
      </details>

      <details id="sec-risk" class="panel dim-panel" :open="dimOpen('risk')" @toggle="e => toggleDim('risk', (e.target as HTMLDetailsElement).open)">
        <summary>风险复盘 · 事件库与压力测试（#2047 模板九/十）</summary>
        <div class="dim-body"><RiskReviewPanel :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" /></div>
      </details>

      <details id="sec-decision" class="panel dim-panel" :open="dimOpen('decision')" @toggle="e => toggleDim('decision', (e.target as HTMLDetailsElement).open)">
        <summary>决策复盘 · 情绪化识别与会议纪要（#2049 模板十一/十二）</summary>
        <div class="dim-body dim-stack">
          <EmotionPatternPanel />
          <MeetingMinutesForm />
        </div>
      </details>

      <details id="sec-subject" class="panel dim-panel" :open="dimOpen('subject')" @toggle="e => toggleDim('subject', (e.target as HTMLDetailsElement).open)">
        <summary>三主体驾驶舱 · 售电/新能源/储能（#2048）</summary>
        <div class="dim-body"><SubjectCockpit :day-summary="subjectDaySummary" @open-template="id => openTemplateById(id)" /></div>
      </details>
    </section>

    <!-- 报告阅读弹层 -->
    <div v-if="readingReport" class="report-overlay" @click.self="readingReport = null">
      <div class="report-modal panel">
        <header>
          <b>{{ readingReport.title }}</b>
          <button class="close" @click="readingReport = null"><X :size="16" /></button>
        </header>
        <div class="report-body md" v-html="readingReport.html" />
      </div>
    </div>

    <!-- 复盘模板抽屉（#2038 通用渲染器）：维度清单 → 单模板表单 -->
    <div v-if="templateDrawer" class="tpl-overlay" @click.self="templateDrawer = null">
      <div class="tpl-drawer panel">
        <header>
          <b>复盘模板</b>
          <button class="close" @click="templateDrawer = null"><X :size="16" /></button>
        </header>
        <div class="tpl-body">
          <template v-if="drawerCard">
            <p class="muted">
              「{{ drawerCard.label }}」维度 {{ drawerCard.templates.length }} 项模板——
              就绪 {{ drawerCard.counts.ready }} · 缺数据 {{ drawerCard.counts.dataGap }} · 后置 {{ drawerCard.counts.deferred }}。点击查看渲染。
            </p>
            <button
              v-for="t in drawerCard.templates"
              :key="t.id"
              class="tpl-pick"
              @click="openTemplate(t)"
            >
              <span>{{ t.id }} {{ t.name }}{{ t.slots24 ? ' · 24 时段' : '' }}</span>
              <i :class="`rd-${t.readiness}`">{{ t.readiness === 'ready' ? '就绪' : t.readiness === 'data_gap' ? '缺数据' : '后置' }}</i>
            </button>
          </template>
          <ReviewTemplateForm
            v-else-if="templateDrawer.mode === 'template'"
            :template-id="templateDrawer.templateId"
            :spec="settlementSpec"
            :instance="templateDrawer.instance ?? null"
            @saved="onInstanceSaved"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review { gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); }

/* 六维驾驶舱 v1（#2038） */
.cockpit { display: flex; flex-direction: column; gap: 10px; }
.metric-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.metric-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel, #fff);
}
.metric-card.placeholder { border-style: dashed; background: transparent; }
.metric-card.empty { border-style: dashed; }
.m-head { display: flex; align-items: center; gap: 8px; font-size: var(--font-12-5); font-weight: 600; color: var(--text); }
.m-src { font-size: var(--font-10-5); font-weight: 400; color: var(--muted); border: 1px dashed var(--line); border-radius: 999px; padding: 0 7px; }
.m-tag { font-size: var(--font-10); font-weight: 400; color: #a16207; background: #fffbeb; border-radius: 999px; padding: 0 7px; }
.m-value { font-size: var(--font-26); font-variant-numeric: tabular-nums; color: var(--text); }
.m-value.bad { color: #b91c1c; }
.m-sub { font-size: var(--font-11-5); color: var(--muted); font-variant-numeric: tabular-nums; }
.m-note { margin: 2px 0 0; font-size: var(--font-11-5); line-height: 1.7; color: var(--muted); }

/* 六维深入面板区（M2–M4）：默认折叠，锚点由六维入口卡触发展开 */
.dim-panels { display: flex; flex-direction: column; gap: 10px; }
.dim-panel { padding: 0; }
.dim-panel summary {
  cursor: pointer; padding: 11px 16px; font-size: var(--font-md); font-weight: 600;
  color: var(--text); list-style: revert;
}
.dim-panel[open] summary { border-bottom: 1px solid var(--line); }
.dim-body { padding: 12px 16px; }
.dim-stack { display: flex; flex-direction: column; gap: 14px; }
.win-facts { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--font-12-5); font-variant-numeric: tabular-nums; }
.win-facts b { font-size: var(--font-15); }
.dim-note { margin: 8px 0 0; font-size: var(--font-11-5); line-height: 1.7; color: var(--muted); }

/* 模板抽屉（沿用报告弹层的浮层模式） */
.tpl-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  display: grid; place-items: center;
}
.tpl-drawer {
  width: min(860px, 94vw); max-height: 86vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.tpl-drawer header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--line);
}
.tpl-drawer .close { border: none; background: transparent; cursor: pointer; color: var(--muted); }
.tpl-body { padding: 14px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.tpl-pick {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-12-5); cursor: pointer; text-align: left;
}
.tpl-pick:hover { border-color: var(--primary); background: #f8fbff; }
.tpl-pick i { font-style: normal; font-size: var(--font-10-5); border-radius: 999px; padding: 0 7px; }
.tpl-pick .rd-ready { background: #f0fdf4; color: #15803d; }
.tpl-pick .rd-data_gap { background: #fffbeb; color: #a16207; }
.tpl-pick .rd-deferred { background: #f1f5f9; color: #64748b; }
.params {
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  padding: 12px 16px; font-size: var(--font-md);
}
.params label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.params input {
  padding: 5px 9px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); font-size: var(--font-md);
}
.params input[type='number'] { width: 90px; }
.demo-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.baseline-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(14, 165, 233, 0.12); color: #0369a1;
  font-family: ui-monospace, monospace;
}
.rule-tag {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  border: 1px dashed #0f766e; color: #0f766e; background: rgba(15, 118, 110, 0.06);
}
.error-tag { color: #ef4444; font-size: var(--font-sm); }

/* 结算口径复盘（云南三段式） */
.settlement-review { padding: 14px 16px; }
.basis-tag {
  margin-left: 8px; padding: 1px 7px; border-radius: 4px;
  background: #e0f2fe; color: #0369a1; font-size: var(--font-xs); font-weight: 500;
}
.plant-tag { margin-left: 6px; color: #64748b; font-size: var(--font-xs); font-weight: 400; }
.coverage-hint {
  margin: 8px 0 0; padding: 8px 10px; border-radius: 6px;
  background: #fffbeb; color: #92400e; font-size: var(--font-sm); line-height: 1.6;
}
.seg-row { display: flex; align-items: stretch; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.seg-card {
  flex: 1 1 150px; min-width: 130px; padding: 10px 12px;
  border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;
}
.seg-card.total { background: #f0f9ff; border-color: #bae6fd; }
.seg-label { color: #64748b; font-size: var(--font-sm); }
.seg-value { margin-top: 4px; font-size: var(--font-20); font-weight: 600; color: #0f172a; }
.seg-value i { margin-left: 3px; font-size: var(--font-xs); font-weight: 400; font-style: normal; color: #94a3b8; }
.seg-fee { margin-top: 3px; color: #475569; font-size: var(--font-xs); }
.seg-op { display: flex; align-items: center; color: #94a3b8; font-size: var(--font-18); }
.basis-note { margin: 10px 0 0; color: #64748b; font-size: var(--font-xs); line-height: 1.7; }
/* AGENTS.md Mock 红线：模拟结算单必须可见标注，不得伪装真实结算口径（#1562 P1） */
.mock-banner {
  margin: 0 0 10px; padding: 8px 12px; border-radius: 6px;
  background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
  font-size: var(--font-sm); line-height: 1.6;
}
.mock-banner strong { color: #b45309; }
.plant-detail { margin-top: 10px; }
.plant-detail summary { cursor: pointer; color: #475569; font-size: var(--font-sm); }
.plant-table { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: var(--font-sm); }
.plant-table th, .plant-table td {
  padding: 5px 8px; border-bottom: 1px solid #f1f5f9; text-align: right; white-space: nowrap;
}
.plant-table th { color: #64748b; font-weight: 500; }
.plant-table th:first-child, .plant-table .plant-name { text-align: left; }
.plant-detail { overflow-x: auto; }

/* 右列跟视口宽度走（不是跟栅格走）：智能体对话是这页的主要工作区之一，
   固定 380px 在宽屏上被挤成一条缝。34vw 保证它不低于屏幕三分之一。 */
.review-grid { display: grid; grid-template-columns: minmax(0, 1fr) max(400px, 34vw); gap: 14px; }
/* 断点从 1100 提到 1180：右列变宽后 1100~1180 这一段左列窄到 ~450px，
   图表的 y 轴名「MWh」被图例压住。实测 1181 起两者刚好错开，更窄就改单列。 */
@media (max-width: 1180px) { .review-grid { grid-template-columns: 1fr; } }
.left-col, .right-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.chart-block { padding: 12px 16px; }
.review-guidance { padding: 12px 16px; }
.review-guidance strong { display: block; color: var(--text); }
.review-guidance p { margin: 6px 0; color: var(--muted); }
.review-guidance small { color: var(--muted); }
.block-title { display: flex; align-items: center; gap: 6px; font-size: var(--font-13-5); font-weight: 600; margin-bottom: 6px; }
.main-chart { width: 100%; height: 320px; }

.card-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 700px) { .card-row { grid-template-columns: 1fr; } }
.num-card { padding: 12px 14px; }
.num-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: var(--font-md); color: var(--muted); }
.num-row b { color: var(--text); font-variant-numeric: tabular-nums; }
.num-row.main { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 8px; }
.num-row .good { color: #16a34a; }
.num-row .bad { color: #ef4444; }
.hint { font-size: var(--font-11-5); color: var(--muted); margin: 6px 0 0; }

.agent-block { padding: 12px 14px; }
.launch {
  width: 100%; padding: 10px; font-size: var(--font-13-5); font-weight: 600;
  border: none; border-radius: 10px; cursor: pointer;
  background: var(--primary); color: #fff;
}
.launch:hover { filter: brightness(1.1); }
.agent-embed { height: 460px; }

.reports-block { padding: 12px 14px; }
.report-row {
  display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: 7px 10px; margin-top: 5px; text-align: left;
  border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); cursor: pointer;
}
.report-row:hover { border-color: var(--primary); }
.report-title { font-size: var(--font-12-5); font-weight: 600; }
.report-meta { font-size: var(--font-xs); color: var(--muted); }

.report-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  display: grid; place-items: center;
}
.report-modal {
  width: min(760px, 92vw); max-height: 84vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.report-modal header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--line);
}
.report-modal .close { border: none; background: transparent; cursor: pointer; color: var(--muted); }
.report-body { padding: 14px 18px; overflow-y: auto; font-size: var(--font-13-5); line-height: 1.8; }
.md :deep(table) { border-collapse: collapse; font-size: var(--font-12-5); }
.md :deep(th), .md :deep(td) { border: 1px solid var(--line); padding: 3px 8px; }
.md :deep(pre) { background: rgba(20, 24, 34, 0.92); color: #e5e7eb; padding: 10px; border-radius: 8px; overflow-x: auto; }
/* 口径边界：警示但不报错，它说明的是「这份数据是什么」，不是「出了问题」 */
.caliber-note { border-left: 3px solid var(--el-color-warning, #e6a23c); }
.caliber-note ul { margin: 6px 0 0; padding-left: 18px; }
.caliber-note li { font-size: var(--font-sm); line-height: 1.7; color: var(--el-text-color-regular, #606266); }
.caliber-note li + li { margin-top: 4px; }
</style>
