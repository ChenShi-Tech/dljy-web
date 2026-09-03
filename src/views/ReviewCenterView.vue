<script setup lang="ts">
// 复盘中心（/xhjy/review，D+1 动线）—— 六维驾驶舱（Epic #2033 · #2038）。
// 壳子只做三件事：头部（地区/日期/参数/生成报告）、七标签（六维 + 主体视角）、按标签切换主体区 + 右栏。
// 确定性数字走 quant /review、/settlement-review 直调端点；归因叙事走 daily_review 智能体场景（弹层）。
// 深链：?date= / ?declarationId=（申报台 ④ 步回测基准）/ ?dim=（S1 面板与待办跳转落点）。
//
// 外壳重做说明：M2–M4 的面板（偏差聚合/收益拆解/市场归因/风险/情绪/纪要/三主体，#2042–#2049）
// 与模板填报器、待办箱（#2037/#2039）原样保留，只是从「旧平铺页 + 折叠 details」改挂到对应维度标签下。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { X } from 'lucide-vue-next'
import { renderMarkdown } from '../utils/miniMarkdown'
import { beijingDay } from '@/utils/beijingDate'
import { isRealCalendarDate } from '@/utils/calendarDate'
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
import { declarationModeOf, getDeclaration, type DeclarationOrder } from '@/services/declarations'
import { EFFECTIVENESS_LABEL, getSettlementRuleSpec } from '../rules/settlement'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { apiGet } from '@/services/api'
import {
  buildDimensionCards,
  deviationMetricOf,
  type DimensionCard,
  type TemplateCard,
  type TodoRow
} from '@/services/review/cockpitModel'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'
import { dimSignal, parseDimQuery, priceStats, type DimSignal, type ShellTab } from '@/services/review/reviewDashboard'
import ReviewHeader, { type HeaderBadge } from '@/components/review/ReviewHeader.vue'
import ReviewDimTabs from '@/components/review/ReviewDimTabs.vue'
import ReportsRail from '@/components/review/ReportsRail.vue'
import ReportReaderModal from '@/components/review/ReportReaderModal.vue'
import ReportGenerateDialog from '@/components/review/ReportGenerateDialog.vue'
import TodoInbox from '@/components/review/TodoInbox.vue'
import ReviewTemplateForm from '@/components/review/ReviewTemplateForm.vue'
import DeviationDim from '@/components/review/dims/DeviationDim.vue'
import ResultDim from '@/components/review/dims/ResultDim.vue'
import MarketDim from '@/components/review/dims/MarketDim.vue'
import StrategyDim from '@/components/review/dims/StrategyDim.vue'
import RiskDim from '@/components/review/dims/RiskDim.vue'
import DecisionDim from '@/components/review/dims/DecisionDim.vue'
import SubjectDim from '@/components/review/dims/SubjectDim.vue'

const route = useRoute()
const router = useRouter()

function yesterday(): string {
  return beijingDay(-1)
}

// P2：结算规则参数化，免考核带默认值改读当前地区 SettlementRuleSpec；
// 未沉淀规格的地区保留 3% 通用默认并在 ⚙ 弹层显示"未参数化"（不静默借用别省参数）。
const settlementSpec = computed(() => getSettlementRuleSpec(currentRegion.value.id))
const ruleLabel = computed(() =>
  settlementSpec.value ? `${settlementSpec.value.version} · ${EFFECTIVENESS_LABEL[settlementSpec.value.effectiveness]}` : ''
)

// 复盘默认日期是「昨天」，而真实采集是历史批次，默认值落在覆盖区外就永远空手而归。
// 覆盖区间集中登记在 captureCoverage。只钳默认值，不限制用户手选。
function defaultDateFor(regionId: string): string {
  return clampToCoverage(regionId, 'review', yesterday())
}

/** ?date= 形态+语义双守卫：非 YYYY-MM-DD 或伪日期（2026-13-99 / 2026-02-30）一律回落
 *  采集覆盖区内默认——reviewMonth 不污染对账分母、台账请求不带垃圾月份发出去。 */
function dateFromQuery(q: unknown): string {
  return typeof q === 'string' && isRealCalendarDate(q) ? q : defaultDateFor(currentRegion.value.id)
}

const date = ref(dateFromQuery(route.query.date))
const tab = ref<ShellTab>(parseDimQuery(route.query.dim))

// 结算口径复盘（云南三段式）：与偏差考核是两套口径，各自独立加载、互不阻塞
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
    ElMessage.warning(`结算台账（${reviewMonth.value}）加载失败，结算对账按未导入处理`)
  }
}

// 智能体复盘：报告库 + 生成弹层 + 阅读弹层
const generating = ref(false)
const reports = ref<ReportItem[]>([])
const readingReport = ref<{ title: string; html: string } | null>(null)

// 六维模型（#2038 首版交付）：模板清单/就绪度计数按维取用
const dimensionCards = buildDimensionCards()
function cardOf(key: ShellTab): DimensionCard | null {
  return key === 'subject' ? null : (dimensionCards.find((c) => c.key === key) ?? null)
}
function templatesOf(key: ShellTab): TemplateCard[] {
  return cardOf(key)?.templates ?? []
}

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

// 模板抽屉：模板 chip / 待办行打开单模板。
// 待办行带上实例（#2037）：表单直连服务端草稿/提交；模板 chip 直开仍是纯预览。
const templateDrawer = ref<{ templateId: string; instance?: TemplateInstanceSummary | null } | null>(null)

function openTemplate(t: TemplateCard) {
  templateDrawer.value = { templateId: t.id }
}
/** 三主体驾驶舱等按 id 直开模板渲染器。 */
function openTemplateById(id: string) {
  templateDrawer.value = { templateId: id }
}
function openTodoInstance(row: TodoRow) {
  // row 即实例摘要（id/status/payload）——不传实例表单只是预览，传了才能落库提交
  templateDrawer.value = { templateId: row.templateId, instance: toInstanceSummary(row) }
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
  if (d?.instance) {
    d.instance = { ...d.instance, status }
  }
  await refreshTodoFeed()
}

// 请求序号：日期/地区连续切换时，先发出的请求可能后返回。只认最新一次的结果（#1502）。
let reviewSeq = 0
let settlementSeq = 0

async function load() {
  const seq = ++reviewSeq
  loading.value = true
  error.value = ''
  reviewFailure.value = null
  result.value = null
  try {
    // 申报单基准：拿得到曲线则回测以真实申报单为准；拿不到降级合成基准并提示
    if (declarationId.value && !declaration.value) {
      try {
        declaration.value = await getDeclaration(declarationId.value)
      } catch {
        declaration.value = null  // 头部徽标显示「申报单 xxx 不可达」，非静默吞错
      }
    }
    const out = await fetchReview({
      date: date.value,
      tolerance_pct: tolerancePct.value,
      penalty_price: penaltyPrice.value,
      declared_mwh_96: declaration.value?.energyCurveMwh96,
      declaration_id: declaration.value?.id
    })
    if (seq !== reviewSeq) return
    result.value = out
  } catch (e) {
    if (seq !== reviewSeq) return
    reviewFailure.value = classifyReviewError(e)
  } finally {
    if (seq === reviewSeq) loading.value = false
  }
}

async function loadSettlementReview() {
  const seq = ++settlementSeq
  // 先清空再取：不清的话请求期间会把上一日的数字和新日期并排显示
  settlementReview.value = null
  settlementReviewError.value = ''
  if (!isYunnan.value) return           // 仅云南接入结算族；其他地区后端 not_onboarded，不发
  if (outOfCoverage.value) return       // 覆盖区间外直接展示范围提示，不发注定 503 的请求
  const dateAtStart = date.value
  try {
    const out = await fetchSettlementReview(dateAtStart)
    if (seq !== settlementSeq) return
    settlementReview.value = out
  } catch (e) {
    if (seq !== settlementSeq) return
    settlementReviewError.value = e instanceof Error ? e.message : '结算口径复盘加载失败'
  }
}

async function loadReports() {
  reports.value = await fetchReports('daily_review')
}

function onReportDone() {
  // 智能体复盘流结束 → 刷新历史报告列表（done emit，无需轮询）
  generating.value = false
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

// ── 头部徽标：只放状态，不放说明 ──
const badges = computed<HeaderBadge[]>(() => {
  const list: HeaderBadge[] = []
  if (declaration.value) list.push({ text: `基准 申报单 ${declaration.value.id}`, tone: 'info', title: '回测以该申报单曲线为基准' })
  else if (declarationId.value) list.push({ text: `申报单 ${declarationId.value} 不可达`, tone: 'warn', title: '已降级为合成基准' })
  // 走查清单 #6：历史模拟单的申报曲线是演练口径（如 30MW 平铺），与实际负荷量级可能相差
  // 悬殊，偏差率/考核费会得出看似荒谬的数值（实测 1111.7%、253 万）——不标注会被误读成
  // 系统算错。徽标只标状态，解释放 title。
  if (declaration.value && declarationModeOf(declaration.value) === 'REHEARSAL') {
    list.push({
      text: '演练基准 · 量级不可比',
      tone: 'warn',
      title: '基准为历史模拟单：申报曲线为演练口径，与实际负荷量级可能相差悬殊，偏差率/考核费等数值仅作流程演练演示，不构成真实考核口径。'
    })
  }
  if (result.value?.source === 'synthetic_mock') list.push({ text: '演示数据', tone: 'warn' })
  if (outOfCoverage.value && coverage.value) list.push({ text: `覆盖至 ${coverage.value.end}`, tone: 'off', title: `真实采集覆盖 ${coverage.value.start} ~ ${coverage.value.end}` })
  if (error.value) list.push({ text: error.value, tone: 'danger' })
  return list
})

// ── 标签就绪度：live 由本次加载结果判定；其余按注册表就绪度台账 ──
const signals = computed<Partial<Record<ShellTab, DimSignal>>>(() => ({
  deviation: dimSignal(!!result.value, cardOf('deviation')),
  result: dimSignal(!!result.value || !!settlementReview.value, cardOf('result')),
  market: dimSignal(!!result.value && priceStats(result.value.detail) != null, cardOf('market')),
  strategy: dimSignal(false, cardOf('strategy')),
  risk: dimSignal(false, cardOf('risk')),
  decision: dimSignal(false, cardOf('decision')),
  subject: dimSignal(!!subjectDaySummary.value, null)
}))

// tab ↔ ?dim= 双向：切标签写回地址（可分享 / S1 深链），不新增历史记录
watch(tab, (t) => {
  if (route.query.dim === t) return
  router.replace({ query: { ...route.query, dim: t } })
})
watch(() => route.query.dim, (q) => { const t = parseDimQuery(q); if (t !== tab.value) tab.value = t })

// 深链 ?date= / ?declarationId= 的同路由再导航（组件复用不重跑 setup）：query 变了要跟上。
// declarationId 有值→空（参数被删）同样清空基准单，否则残留旧申报曲线继续当基准。
watch(() => route.query.date, (q) => {
  const d = dateFromQuery(q)
  if (d !== date.value) date.value = d // 复用既有 [date,…] watch 触发重载
})
watch(() => route.query.declarationId, (q) => {
  const id = typeof q === 'string' ? q : ''
  if (id === declarationId.value) return
  declaration.value = null // 换/清基准单：旧申报曲线不可复用，load() 重新取
  declarationId.value = id
  void load()
  void loadSettlementReview()
})

// 深链 ?todo=1（S1 待办徽标跳转落点，设计稿 U7「直开待办箱」）：滚动定位 + 短促高亮
function focusTodoInbox(): void {
  if (route.query.todo !== '1') return
  void nextTick(() => {
    const el = document.getElementById('review-todo')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.remove('todo-flash')
    void el.offsetWidth // 重置动画：同会话二次深链也能再闪
    el.classList.add('todo-flash')
    window.setTimeout(() => el.classList.remove('todo-flash'), 1800)
  })
}
watch(() => route.query.todo, focusTodoInbox, { immediate: true })

// 深链 ?report={session}（S1 夜间报告卡「点击看全文」落点）：按 session_id 在报告库
// 匹配并直开阅读器。匹配不到如实提示（报告可能未生成/不属于当前公司数据范围），不静默吞。
// 用后即清参数：刷新/分享落地页不再反复弹层。
watch(() => route.query.report, async (q) => {
  const sid = typeof q === 'string' ? q : ''
  if (!sid) return
  try {
    if (!reports.value.length) reports.value = await fetchReports('daily_review')
    const hit = reports.value.find((r) => r.session_id === sid)
    if (hit) await openReport(hit)
    else ElMessage.warning('未在报告库找到该会话的报告：可能尚未生成，或不属于当前公司数据范围')
  } catch {
    ElMessage.warning('报告库读取失败，请稍后在右侧报告列表中重试')
  } finally {
    if (route.query.report !== undefined) void router.replace({ query: { ...route.query, report: undefined } })
  }
}, { immediate: true })

// 深链 ?run=1（S1 夜间报告卡「去复盘中心手动生成」落点）：直开生成弹层
watch(() => route.query.run, (q) => {
  if (q !== '1') return
  generating.value = true
  void router.replace({ query: { ...route.query, run: undefined } })
}, { immediate: true })

onMounted(() => {
  load()
  void loadSettlementReview()
  loadReports()
  loadSettlements()
})
watch(reviewMonth, loadSettlements)
// 地区切换：按新地区 SettlementRuleSpec 更新容差并重载；regionSwitching 守卫避免穿透到参数 watch 造成双重 load
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
  void loadReports()  // 报告 sidecar 带 region_id，后端按地区过滤
  nextTick(() => { regionSwitching = false })
})
</script>

<template>
  <div class="review page-stack">
    <RegionDataBanner />

    <ReviewHeader
      v-model:date="date"
      v-model:tolerance-pct="tolerancePct"
      v-model:penalty-price="penaltyPrice"
      :region-label="currentRegion.shortName || currentRegion.name"
      :rule-label="ruleLabel"
      :badges="badges"
      :generating="generating"
      @generate="generating = true"
    />

    <ReviewDimTabs v-model:active="tab" :signals="signals" />

    <div class="body">
      <main class="main">
        <DeviationDim
          v-if="tab === 'deviation'"
          :result="result" :failure="reviewFailure" :loading="loading"
          :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice"
          :templates="templatesOf('deviation')" @open-template="openTemplate"
        />
        <ResultDim
          v-else-if="tab === 'result'"
          :result="result"
          :settlement-review="settlementReview"
          :settlement-review-error="settlementReviewError"
          :is-yunnan="isYunnan"
          :out-of-coverage="outOfCoverage"
          :coverage="coverage"
          :review-month="reviewMonth"
          :settlement-row-count="settlementRows.length"
          :imported-deviation-fee="importedDeviationFee"
          :reconcile-diff="reconcileDiff"
          :spec="settlementSpec"
          :tolerance-pct="tolerancePct"
          :penalty-price="penaltyPrice"
          :templates="templatesOf('result')" @open-template="openTemplate"
        />
        <MarketDim v-else-if="tab === 'market'" :result="result" :templates="templatesOf('market')" @open-template="openTemplate" />
        <StrategyDim v-else-if="tab === 'strategy'" :templates="templatesOf('strategy')" @open-template="openTemplate" />
        <RiskDim
          v-else-if="tab === 'risk'"
          :templates="templatesOf('risk')" :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice"
          @open-template="openTemplate"
        />
        <DecisionDim v-else-if="tab === 'decision'" :templates="templatesOf('decision')" @open-template="openTemplate" />
        <SubjectDim v-else :day-summary="subjectDaySummary" @open-template="openTemplateById" />
      </main>

      <aside class="rail">
        <TodoInbox ref="todoInboxRef" @open-instance="openTodoInstance" />
        <ReportsRail :reports="reports" @open-report="openReport" />
      </aside>
    </div>

    <!-- 模板填报器（#2037）：待办行带实例可存草稿/提交；chip 直开为预览。
         沿用本页原有的自写抽屉（非 el-drawer）——结构与样式与迁移前一致 -->
    <div v-if="templateDrawer" class="tpl-overlay" @click.self="templateDrawer = null">
      <div class="tpl-drawer panel">
        <header>
          <b>模板 {{ templateDrawer.templateId }}</b>
          <button type="button" class="close" aria-label="关闭" @click="templateDrawer = null"><X :size="16" /></button>
        </header>
        <div class="tpl-body">
          <ReviewTemplateForm
            :template-id="templateDrawer.templateId"
            :spec="settlementSpec"
            :instance="templateDrawer.instance ?? null"
            @saved="onInstanceSaved"
          />
        </div>
      </div>
    </div>

    <ReportGenerateDialog v-model:open="generating" :date="date" @done="onReportDone" />
    <ReportReaderModal :report="readingReport" @close="readingReport = null" />
  </div>
</template>

<style scoped>
.review { gap: 12px; }
/* 右栏固定 292px：待办/报告是列表不是工作区，不再像旧版那样吃掉 34vw */
.body { display: grid; grid-template-columns: minmax(0, 1fr) 292px; gap: 12px; align-items: start; }
@media (max-width: 960px) { .body { grid-template-columns: 1fr; } }
.main { min-width: 0; }
.rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

/* 模板抽屉：尺寸与层级复刻迁移前实现 */
.tpl-overlay { position: fixed; inset: 0; z-index: 50; background: var(--mask-bg); display: grid; place-items: center; }
.tpl-drawer {
  width: min(860px, 94vw); max-height: 86vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.tpl-drawer header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--line);
}
.tpl-drawer .close { border: none; background: transparent; cursor: pointer; color: var(--muted); display: grid; place-items: center; }
.tpl-drawer .close:hover { color: var(--text); }
.tpl-body { padding: 14px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }

/* 深链 ?todo=1 落点：待办箱短促两闪高亮（用主题色，结束移除类不留常驻样式） */
@keyframes todo-flash-kf {
  0%, 100% { box-shadow: none; }
  25%, 75% { box-shadow: 0 0 0 3px var(--el-color-primary-light-5); }
}
.todo-flash { animation: todo-flash-kf 0.8s ease-in-out 2; }
</style>
