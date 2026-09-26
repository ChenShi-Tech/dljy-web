<script setup lang="ts">
// 中长期交易执行（/zcqjy/execution，dljy#2973，MT-01/MT-02；P4 执行确认 dljy#3014，MT-03..06）。
// - 交易日历（默认标签）：只显示公告明确给出的申报开始、申报截止、确认时间；时间未知的公告列入「待补」，
//   不套默认时刻、不借其他地区或历史日期生成提醒。
// - 公告登记：人工登记与更正（原版保留），待核对参数、引用方案是否需要按新版本重新核对。
// - 方案执行：导出申报材料（只读，不等于提交）、登记外部提交与回执（只记事实，不宣称受理、不形成持仓）、标记待结果、关闭。
// - 执行确认（P4）：外部成交确认单列表与登记；详情含版本链、冲正、关联合同、占用转换与计划偏差；修订/撤销冲正/关联操作。
// - 本系统不自动登录或提交外部交易平台；登记只记录事实，不显示「平台已受理」。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import ProposalDetailDrawer from '@/components/midlong/p3/ProposalDetailDrawer.vue'
import WindowDetailDrawer from '@/components/midlong/p3/WindowDetailDrawer.vue'
import WindowFormDialog from '@/components/midlong/p3/WindowFormDialog.vue'
import ConfirmationFormDialog from '@/components/midlong/p4/ConfirmationFormDialog.vue'
import ConfirmationDetailDrawer from '@/components/midlong/p4/ConfirmationDetailDrawer.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { fetchProposals, fetchWindowCalendar, fetchWindows } from '@/services/midlong/midlongP3Api'
import { fetchExecutions, p4ModuleOn } from '@/services/midlong/midlongP4Api'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { beijingDateTime, groupEventsByBeijingDate, proposalStatusTag, receiptTag } from '@/services/midlong/midlongP3Format'
import { executionResultTag } from '@/services/midlong/midlongP4Format'
import {
  PLANNING_NOTICES, PROPOSAL_STATUS_LABELS,
  type ProposalStatus, type TradeProposalDetail, type TradingWindowDetail, type TradingWindowListRow, type WindowCalendarReport,
} from '@/services/midlong/midlongP3Types'
import { EXECUTION_RESULT_STATUSES, EXECUTION_RESULT_STATUS_LABELS, EXECUTION_NOTICES, type ExecutionConfirmationSummaryRow } from '@/services/midlong/midlongP4Types'
import { beijingToday, monthsBetween, type MidlongCapabilities, type MidlongSubject } from '@/services/midlong/midlongTypes'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
/** 页面级状态只管能力与权限；各标签页各自加载、各自报错，一个失败不清空其他标签已加载的数据。 */
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const PAGE_SIZE = 50
const calendar = ref<WindowCalendarReport | null>(null)
const calendarLoading = ref(false)
const calendarError = ref('')
const windows = ref<TradingWindowListRow[]>([])
const windowTotal = ref(0)
const windowsLoading = ref(false)
const windowsError = ref('')
const proposals = ref<TradeProposalDetail[]>([])
const proposalTotal = ref(0)
const proposalsLoading = ref(false)
const proposalsError = ref('')
const subjects = ref<MidlongSubject[]>([])
// P4 执行确认：确认单列表（executions 能力未开放时标签整体不渲染、接口不请求）。
const executionsEnabled = ref(false)
const confirmations = ref<ExecutionConfirmationSummaryRow[]>([])
const confirmationTotal = ref(0)
const confirmationsLoading = ref(false)
const confirmationsError = ref('')
/** 登记确认单对话框的方案候选（执行链路方案；与公告表单的主体候选同策略：打开时才加载）。 */
const proposalCandidates = ref<TradeProposalDetail[]>([])

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const TABS = ['calendar', 'windows', 'proposals', 'confirmations'] as const
const tab = ref<(typeof TABS)[number]>((TABS as readonly string[]).includes(q('tab')) ? (q('tab') as (typeof TABS)[number]) : 'calendar')
const thisMonth = beijingToday().slice(0, 7)
const defaultRange = (): string[] => [thisMonth, monthsBetween(thisMonth, `${Number(thisMonth.slice(0, 4)) + 1}-12`)[2]]
const filters = reactive({
  monthRange: (q('fromMonth') && q('toMonth') ? [q('fromMonth'), q('toMonth')] : defaultRange()) as string[], status: q('status') as ProposalStatus | '',
  windowPage: Math.max(1, Number(q('windowPage')) || 1), proposalPage: Math.max(1, Number(q('proposalPage')) || 1),
  // 执行确认标签：结果状态 + 只看待核对；pendingReview 只以 true 进入（false 等于不筛，语义没增量）。
  confirmationStatus: q('confirmationStatus') as ExecutionConfirmationSummaryRow['resultStatus'] | '',
  pendingReviewOnly: q('pendingReview') === 'true',
  confirmationPage: Math.max(1, Number(q('confirmationPage')) || 1),
})
// 方案标签的筛选条件（不含页码）变化就回到第一页，不论入口是查询按钮还是改完条件直接切换标签。
const proposalsFilterKey = () => JSON.stringify([filters.status])
let lastProposalsFilterKey = proposalsFilterKey()
const confirmationsFilterKey = () => JSON.stringify([filters.confirmationStatus, filters.pendingReviewOnly])
let lastConfirmationsFilterKey = confirmationsFilterKey()

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const pageGuard = createLoadGuard()
const calendarGuard = createLoadGuard()
const windowsGuard = createLoadGuard()
const proposalsGuard = createLoadGuard()
const confirmationsGuard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function loadCalendar() {
  const [fromMonth, toMonth] = filters.monthRange.length === 2 ? filters.monthRange : defaultRange()
  const key = `${scopeKey()}|${fromMonth}|${toMonth}`
  const token = calendarGuard.begin(key)
  calendarLoading.value = true
  calendarError.value = ''
  try {
    const report = await fetchWindowCalendar({ fromMonth, toMonth })
    if (!calendarGuard.isCurrent(token, key)) return
    calendar.value = report
  } catch (error) {
    if (!calendarGuard.isCurrent(token, key)) return
    calendar.value = null
    calendarError.value = midlongFailureOf(error).message
  } finally {
    if (calendarGuard.isCurrent(token, key)) calendarLoading.value = false
  }
}

async function loadWindows() {
  const key = `${scopeKey()}|${filters.windowPage}`
  const token = windowsGuard.begin(key)
  windowsLoading.value = true
  windowsError.value = ''
  try {
    const page = await fetchWindows({ page: filters.windowPage, pageSize: PAGE_SIZE })
    if (!windowsGuard.isCurrent(token, key)) return
    windows.value = page.rows
    windowTotal.value = page.total
  } catch (error) {
    if (!windowsGuard.isCurrent(token, key)) return
    windows.value = []
    windowTotal.value = 0
    windowsError.value = midlongFailureOf(error).message
  } finally {
    if (windowsGuard.isCurrent(token, key)) windowsLoading.value = false
  }
}

async function loadProposals() {
  if (proposalsFilterKey() !== lastProposalsFilterKey) filters.proposalPage = 1
  lastProposalsFilterKey = proposalsFilterKey()
  const key = `${scopeKey()}|${proposalsFilterKey()}|${filters.proposalPage}`
  const token = proposalsGuard.begin(key)
  proposalsLoading.value = true
  proposalsError.value = ''
  try {
    // 执行页只列出已进入执行链路的方案：由服务端排除草稿并返回总数，不在前端过滤一页结果（否则会静默漏掉）。
    const page = await fetchProposals({ stage: 'execution', status: filters.status || undefined, page: filters.proposalPage, pageSize: PAGE_SIZE })
    if (!proposalsGuard.isCurrent(token, key)) return
    proposals.value = page.rows
    proposalTotal.value = page.total
  } catch (error) {
    if (!proposalsGuard.isCurrent(token, key)) return
    proposals.value = []
    proposalTotal.value = 0
    proposalsError.value = midlongFailureOf(error).message
  } finally {
    if (proposalsGuard.isCurrent(token, key)) proposalsLoading.value = false
  }
}

async function loadConfirmations() {
  if (confirmationsFilterKey() !== lastConfirmationsFilterKey) filters.confirmationPage = 1
  lastConfirmationsFilterKey = confirmationsFilterKey()
  const key = `${scopeKey()}|${confirmationsFilterKey()}|${filters.confirmationPage}`
  const token = confirmationsGuard.begin(key)
  confirmationsLoading.value = true
  confirmationsError.value = ''
  try {
    const page = await fetchExecutions({
      page: filters.confirmationPage, pageSize: PAGE_SIZE,
      resultStatus: filters.confirmationStatus || undefined,
      pendingReview: filters.pendingReviewOnly ? true : undefined,
    })
    if (!confirmationsGuard.isCurrent(token, key)) return
    confirmations.value = page.rows
    confirmationTotal.value = page.total
  } catch (error) {
    if (!confirmationsGuard.isCurrent(token, key)) return
    confirmations.value = []
    confirmationTotal.value = 0
    confirmationsError.value = midlongFailureOf(error).message
  } finally {
    if (confirmationsGuard.isCurrent(token, key)) confirmationsLoading.value = false
  }
}

function loadActiveTab() {
  if (tab.value === 'windows') return loadWindows()
  if (tab.value === 'proposals') return loadProposals()
  if (tab.value === 'confirmations' && executionsEnabled.value) return loadConfirmations()
  return loadCalendar()
}

async function load() {
  const key = scopeKey()
  const token = pageGuard.begin(key)
  // 换了公司或地区：三个标签的数据与交易主体都属于原范围，全部清空，切到其他标签时不短暂显示原公司记录
  // （错误与加载状态由各标签取数开始时重置；能力在下面重新读取，读取期间页面整体处于加载态）。
  if (key !== loadedScope) {
    calendar.value = null; windows.value = []; windowTotal.value = 0; proposals.value = []; proposalTotal.value = 0; subjects.value = []
    confirmations.value = []; confirmationTotal.value = 0; proposalCandidates.value = []
  }
  loadedScope = key
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!pageGuard.isCurrent(token, scopeKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!caps.modules.execution) { state.value = 'module-off'; return }
    // P4 执行确认能力（executions）：关闭时「执行确认」标签不渲染、列表接口不请求（更正的 404 语义由能力开关表达）。
    executionsEnabled.value = p4ModuleOn(caps, 'executions')
    if (tab.value === 'confirmations' && !executionsEnabled.value) tab.value = 'calendar'
    state.value = 'ready'
  } catch (error) {
    if (!pageGuard.isCurrent(token, scopeKey())) return
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
    return
  }
  await loadActiveTab()
}

/** 同步路由。方案/确认单条件变化先回到第一页再写路由：否则 URL 留着旧页码，刷新或分享时又按旧页码初始化。 */
function syncRoute() {
  if (proposalsFilterKey() !== lastProposalsFilterKey) filters.proposalPage = 1
  if (confirmationsFilterKey() !== lastConfirmationsFilterKey) filters.confirmationPage = 1
  const next: Record<string, string> = { tab: tab.value }
  if (filters.monthRange.length === 2) { next.fromMonth = filters.monthRange[0]; next.toMonth = filters.monthRange[1] }
  if (filters.status) next.status = filters.status
  if (filters.windowPage > 1) next.windowPage = String(filters.windowPage)
  if (filters.proposalPage > 1) next.proposalPage = String(filters.proposalPage)
  if (filters.confirmationStatus) next.confirmationStatus = filters.confirmationStatus
  if (filters.pendingReviewOnly) next.pendingReview = 'true'
  if (filters.confirmationPage > 1) next.confirmationPage = String(filters.confirmationPage)
  void router.replace({ query: next })
}

function apply() {
  syncRoute()
  if (state.value === 'ready') void loadActiveTab()
  else void load()
}

/** 查询按钮：方案条件变化由筛选键自动回到第一页。 */
function search() {
  apply()
}

function changePage(target: 'windows' | 'proposals' | 'confirmations', page: number) {
  if (target === 'windows') filters.windowPage = page
  else if (target === 'proposals') filters.proposalPage = page
  else filters.confirmationPage = page
  apply()
}

onMounted(load)
// 切换公司/地区：关闭详情抽屉与公告表单，回到第一页；与计划页一致重跑页面级加载（重新取能力与写权限、清空全部标签），
// 不能只重载当前标签。旧范围的迟到结果由各代次守卫丢弃。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  windowDrawer.open = false
  proposalDrawer.open = false
  windowDialog.open = false
  confirmationDrawer.open = false
  confirmationDialog.value = false
  Object.assign(filters, { windowPage: 1, proposalPage: 1, confirmationPage: 1 })
  lastProposalsFilterKey = proposalsFilterKey()
  lastConfirmationsFilterKey = confirmationsFilterKey()
  syncRoute()
  void load()
})

const calendarGroups = computed(() => groupEventsByBeijingDate(calendar.value?.events ?? []))

const windowDialog = reactive({ open: false, window: null as TradingWindowDetail | null })
const windowDrawer = reactive({ open: false, windowId: null as number | null })
const windowDrawerRef = ref<InstanceType<typeof WindowDetailDrawer> | null>(null)
const proposalDrawer = reactive({ open: false, proposalId: null as number | null })

function openWindow(id: number) {
  Object.assign(windowDrawer, { open: true, windowId: id })
}
function openProposal(id: number) {
  windowDrawer.open = false
  Object.assign(proposalDrawer, { open: true, proposalId: id })
}
const subjectsLoading = ref(false)
/**
 * 打开公告表单时才加载交易主体（适用主体候选）；加载失败只提示、表单照样可以登记公告原文范围。
 * 加载期间切换了公司就放弃打开：候选与待更正的公告都属于原公司。
 */
async function openWindowForm(window: TradingWindowDetail | null) {
  if (subjectsLoading.value) return
  const scope = captureScope()
  let rows: MidlongSubject[] = []
  subjectsLoading.value = true
  try {
    rows = await fetchSubjects()
  } catch (error) {
    if (scope.isCurrent()) ElMessage.warning(`交易主体加载失败：${midlongFailureOf(error).message}；可先只登记公告原文的适用范围`)
  } finally {
    subjectsLoading.value = false
  }
  // 唯一的范围核对：加载期间切换了公司，主体候选与待更正的公告都属于原公司，放弃打开。
  if (!scope.isCurrent()) return
  // 登记更正：加载期间公告抽屉已关闭或换成了另一条公告，再弹出原公告的更正表单会被当成在更正眼前的公告，放弃打开。
  if (window && !(windowDrawer.open && windowDrawer.windowId === window.id)) return
  subjects.value = rows
  Object.assign(windowDialog, { open: true, window })
}
async function onWindowSaved() {
  await loadActiveTab()
  if (windowDrawer.open) await windowDrawerRef.value?.reload()
}

const latestReceipt = (p: TradeProposalDetail) => p.submissions.at(-1) ?? null

// ── 执行确认（P4）：登记对话框与详情抽屉 ──────────────────────────────────────
const confirmationDialog = ref(false)
const confirmationDrawer = reactive({ open: false, confirmationId: null as number | null })
const candidatesLoading = ref(false)

/**
 * 打开确认单登记表单时才加载主体与执行链路方案候选；加载失败只提示，主体候选为空时仍可登记（后端会校验主体）。
 * 加载期间切换了公司或地区就放弃打开：候选属于原公司。
 */
async function openConfirmationForm() {
  if (candidatesLoading.value) return
  const scope = captureScope()
  let subjectRows: MidlongSubject[] = []
  let proposalRows: TradeProposalDetail[] = []
  candidatesLoading.value = true
  try {
    const [rows, proposalPage] = await Promise.all([fetchSubjects(), fetchProposals({ stage: 'execution', pageSize: 100 })])
    subjectRows = rows
    proposalRows = proposalPage.rows
  } catch (error) {
    if (scope.isCurrent()) ElMessage.warning(`候选加载失败：${midlongFailureOf(error).message}；可稍后重试或直接登记`)
  } finally {
    candidatesLoading.value = false
  }
  if (!scope.isCurrent()) return
  subjects.value = subjectRows
  proposalCandidates.value = proposalRows
  confirmationDialog.value = true
}
function openConfirmation(id: number) {
  Object.assign(confirmationDrawer, { open: true, confirmationId: id })
}
function openConfirmationProposal(proposalId: number) {
  confirmationDrawer.open = false
  openProposal(proposalId)
}
/** 确认单登记/修订/冲正/关联后：刷新当前标签（确认单与方案列表都受影响；日历与公告无关）。 */
async function onConfirmationSaved() {
  await loadActiveTab()
}
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期交易执行</h2>
      <span class="ml-sub">交易日历 · 公告登记 · 申报材料与外部提交登记 · 成交确认单（不自动操作外部平台）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading'" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="交易执行功能尚未开放">当前环境未开放公告日历与执行登记功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="执行数据加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="state === 'ready'">
      <el-tabs v-model="tab" @tab-change="apply">
        <el-tab-pane label="交易日历" name="calendar">
          <div class="ml-filters">
            <el-date-picker v-model="filters.monthRange" type="monthrange" value-format="YYYY-MM" range-separator="至" start-placeholder="起始月" end-placeholder="结束月" style="width: 240px" />
            <el-button type="primary" @click="search">查询</el-button>
          </div>
          <div v-if="calendarLoading && !calendar" v-loading="true" class="ml-placeholder" />
          <MidlongNotice v-if="calendarError" tone="danger" title="日历加载失败（未显示任何替代事件）" data-test="calendar-error">
            {{ calendarError }} <el-button link type="primary" @click="loadCalendar">重试</el-button>
          </MidlongNotice>
          <template v-if="calendar">
          <MidlongNotice tone="info">{{ calendar.notice }}</MidlongNotice>
          <MidlongNotice v-if="calendar.truncated" tone="warn" title="日历未显示全部公告" data-test="calendar-truncated">
            所选月份内相关公告共 {{ calendar.windowTotal }} 条，本次只统计了前 {{ calendar.windowLimit }} 条，请缩小月份区间后查看。
          </MidlongNotice>
          <div class="ml-calendar">
            <div class="ml-panel">
              <h3>已明确时间的事件 <small>北京时间</small></h3>
              <div v-for="g in calendarGroups" :key="g.date" class="ml-day">
                <div class="ml-day-date">{{ g.date }}</div>
                <div v-for="e in g.events" :key="`${e.windowId}-${e.kind}`" class="ml-event">
                  <el-tag size="small" :type="e.kind === 'DECLARATION_CLOSES' ? 'danger' : 'info'">{{ e.label }}</el-tag>
                  <span>{{ beijingDateTime(e.at).slice(11) }}</span>
                  <el-button link type="primary" @click="openWindow(e.windowId)">{{ e.announcementName }}（v{{ e.revisionNo }}）</el-button>
                </div>
              </div>
              <div v-if="!calendarGroups.length" class="ml-muted">所选月份内没有公告明确给出的时间。</div>
            </div>
            <div class="ml-panel">
              <h3>时间待补的公告（{{ calendar.pending.length }}）<small>不生成提醒</small></h3>
              <div v-for="p in calendar.pending" :key="p.windowId" class="ml-event">
                <el-button link type="primary" @click="openWindow(p.windowId)">{{ p.announcementName }}（v{{ p.revisionNo }}）</el-button>
                <span class="ml-muted">交割期 {{ p.deliveryStartMonth ?? '待核对' }} ~ {{ p.deliveryEndMonth ?? '待核对' }}</span>
                <el-tag v-for="t in p.pendingTimes" :key="t.kind" size="small" type="warning">{{ t.label }}</el-tag>
              </div>
              <div v-if="!calendar.pending.length" class="ml-muted">没有时间待补的公告。</div>
            </div>
          </div>
          </template>
        </el-tab-pane>

        <el-tab-pane label="公告登记" name="windows">
          <div class="ml-filters">
            <el-button v-if="canWrite" type="primary" :loading="subjectsLoading" @click="openWindowForm(null)">登记公告</el-button>
          </div>
          <MidlongNotice v-if="windowsError" tone="danger" title="公告列表加载失败" data-test="windows-error">
            {{ windowsError }} <el-button link type="primary" @click="loadWindows">重试</el-button>
          </MidlongNotice>
          <el-table :data="windows" border size="small" @row-click="(row: TradingWindowListRow) => openWindow(row.id)">
            <el-table-column label="公告名称" min-width="220"><template #default="{ row }">{{ row.current.announcementName }}</template></el-table-column>
            <el-table-column label="来源" width="140"><template #default="{ row }">{{ row.current.sourceName ?? '待核对' }}</template></el-table-column>
            <el-table-column label="发布日期" width="110"><template #default="{ row }">{{ row.current.publishedDate ?? '待核对' }}</template></el-table-column>
            <el-table-column label="交割期" width="160"><template #default="{ row }">{{ row.current.deliveryStartMonth ?? '待核对' }} ~ {{ row.current.deliveryEndMonth ?? '待核对' }}</template></el-table-column>
            <el-table-column label="申报截止" width="150"><template #default="{ row }">{{ beijingDateTime(row.current.declarationClosesAt) }}</template></el-table-column>
            <el-table-column label="待核对参数" width="100" align="right"><template #default="{ row }"><span :class="{ 'ml-warn': row.current.pendingFields.length }">{{ row.current.pendingFields.length }}</span></template></el-table-column>
            <el-table-column label="版本" width="70"><template #default="{ row }">v{{ row.currentRevisionNo }}</template></el-table-column>
            <el-table-column label="待重新核对方案" width="120" align="right"><template #default="{ row }"><span :class="{ 'ml-warn': row.proposalsNeedingRecheck }">{{ row.proposalsNeedingRecheck }}</span> / {{ row.proposalCount }}</template></el-table-column>
            <template #empty>尚未登记交易公告。没有真实公告时日历为空，不生成示意窗口。</template>
          </el-table>
          <el-pagination
            v-if="windowTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="windowTotal" :page-size="PAGE_SIZE"
            :current-page="filters.windowPage" @current-change="(p: number) => changePage('windows', p)"
          />
        </el-tab-pane>

        <el-tab-pane label="方案执行" name="proposals">
          <div class="ml-filters">
            <el-select v-model="filters.status" placeholder="方案状态" clearable style="width: 140px">
              <el-option v-for="s in ['EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT', 'CANCELLED', 'CLOSED'] as ProposalStatus[]" :key="s" :label="PROPOSAL_STATUS_LABELS[s]" :value="s" />
            </el-select>
            <el-button type="primary" @click="search">查询</el-button>
            <router-link to="/zcqjy/plans?tab=proposals" class="ml-link">方案草稿与测算 →</router-link>
          </div>
          <MidlongNotice tone="info">{{ PLANNING_NOTICES.exportNotSubmission }} {{ PLANNING_NOTICES.submissionNotAccepted }}</MidlongNotice>
          <MidlongNotice v-if="proposalsError" tone="danger" title="方案列表加载失败" data-test="proposals-error">
            {{ proposalsError }} <el-button link type="primary" @click="loadProposals">重试</el-button>
          </MidlongNotice>
          <el-table :data="proposals" border size="small" @row-click="(row: TradeProposalDetail) => openProposal(row.id)">
            <el-table-column label="方案" width="80"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="proposalStatusTag(row.status).type">{{ proposalStatusTag(row.status).label }}</el-tag></template></el-table-column>
            <el-table-column label="交易主体" min-width="120"><template #default="{ row }">{{ row.subjectName ?? `#${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="拟售电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
            <el-table-column label="公告申报截止" width="150"><template #default="{ row }">{{ beijingDateTime(row.window?.referenced?.declarationClosesAt) }}</template></el-table-column>
            <el-table-column label="最近提交登记" min-width="210">
              <template #default="{ row }">
                <template v-if="latestReceipt(row)">
                  {{ beijingDateTime(latestReceipt(row)!.submittedAt) }}
                  <el-tag size="small" :type="receiptTag(latestReceipt(row)!.receiptCompleteness).type">{{ receiptTag(latestReceipt(row)!.receiptCompleteness).label }}</el-tag>
                </template>
                <span v-else class="ml-muted">未登记提交</span>
              </template>
            </el-table-column>
            <el-table-column label="公告核对" width="130"><template #default="{ row }"><el-tag v-if="row.window?.needsRecheck" size="small" type="warning">公告已更正待核对</el-tag></template></el-table-column>
            <template #empty>没有已确认可执行的方案。</template>
          </el-table>
          <el-pagination
            v-if="proposalTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="proposalTotal" :page-size="PAGE_SIZE"
            :current-page="filters.proposalPage" @current-change="(p: number) => changePage('proposals', p)"
          />
        </el-tab-pane>

        <el-tab-pane v-if="executionsEnabled" label="执行确认" name="confirmations">
          <div class="ml-filters">
            <el-select v-model="filters.confirmationStatus" placeholder="结果状态" clearable style="width: 150px" data-test="confirmation-status-filter">
              <el-option v-for="s in EXECUTION_RESULT_STATUSES" :key="s" :label="EXECUTION_RESULT_STATUS_LABELS[s]" :value="s" />
            </el-select>
            <el-checkbox v-model="filters.pendingReviewOnly" data-test="pending-review-filter">只看待核对</el-checkbox>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button v-if="canWrite" type="primary" :loading="candidatesLoading" data-test="register-confirmation" @click="openConfirmationForm">登记确认单</el-button>
          </div>
          <MidlongNotice tone="info" title="执行确认口径（登记事实）">
            预成交只保留记录（{{ EXECUTION_NOTICES.preClearedNotFormal }}）；{{ EXECUTION_NOTICES.clearedAtomic }}
            登记不等于平台已受理；来源不支持的产品停在待核对，不自动映射。
          </MidlongNotice>
          <MidlongNotice v-if="confirmationsError" tone="danger" title="确认单列表加载失败" data-test="confirmations-error">
            {{ confirmationsError }} <el-button link type="primary" @click="loadConfirmations">重试</el-button>
          </MidlongNotice>
          <el-table :data="confirmations" border size="small" @row-click="(row: ExecutionConfirmationSummaryRow) => openConfirmation(row.id)">
            <el-table-column label="确认单" width="80"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
            <el-table-column label="结果状态" width="130">
              <template #default="{ row }">
                <el-tag size="small" :type="executionResultTag(row.resultStatus).type">{{ executionResultTag(row.resultStatus).label }}</el-tag>
                <el-tag v-if="row.pendingReview" size="small" type="danger" effect="plain">待核对</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源 / 确认编号" min-width="200"><template #default="{ row }"><span class="ml-mono">{{ row.sourceNamespace }} / {{ row.confirmationNo }}</span></template></el-table-column>
            <el-table-column label="交易主体" min-width="110"><template #default="{ row }">{{ row.subjectName ?? `#${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="总量(MWh)" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
            <el-table-column label="价格" width="90"><template #default="{ row }">{{ row.priceKnown ? '齐全' : '未知' }}</template></el-table-column>
            <el-table-column label="已转换占用(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.convertedQuantity) }}</template></el-table-column>
            <el-table-column label="关联合同" width="120">
              <template #default="{ row }">
                <template v-if="row.linkedContracts.length">
                  <span v-for="l in row.linkedContracts" :key="l.contractId">#{{ l.contractId }}{{ l.linkKind === 'EXISTING_LINKED' ? '（关联）' : '' }}</span>
                </template>
                <span v-else class="ml-muted">未关联</span>
              </template>
            </el-table-column>
            <el-table-column label="方案" width="90"><template #default="{ row }">{{ row.proposalId ? `#${row.proposalId}` : '—' }}</template></el-table-column>
            <template #empty>尚未登记外部成交确认单。</template>
          </el-table>
          <el-pagination
            v-if="confirmationTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="confirmationTotal" :page-size="PAGE_SIZE"
            :current-page="filters.confirmationPage" @current-change="(p: number) => changePage('confirmations', p)"
          />
        </el-tab-pane>
      </el-tabs>
    </template>

    <WindowFormDialog v-model="windowDialog.open" :window="windowDialog.window" :subjects="subjects" @saved="onWindowSaved" />
    <WindowDetailDrawer
      ref="windowDrawerRef" v-model="windowDrawer.open" :window-id="windowDrawer.windowId" :can-write="canWrite"
      @correct="(w: TradingWindowDetail) => openWindowForm(w)" @open-proposal="openProposal"
    />
    <ProposalDetailDrawer v-model="proposalDrawer.open" :proposal-id="proposalDrawer.proposalId" :can-write="canWrite" mode="execution" @changed="load" />
    <ConfirmationFormDialog v-model="confirmationDialog" :subjects="subjects" :proposals="proposalCandidates" @saved="onConfirmationSaved" />
    <ConfirmationDetailDrawer
      v-model="confirmationDrawer.open" :confirmation-id="confirmationDrawer.confirmationId" :can-write="canWrite"
      :subjects="subjects" :proposals="proposalCandidates" @changed="loadActiveTab" @open-proposal="openConfirmationProposal"
    />
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.ml-calendar { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 12px; margin-top: 10px; }
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 12px 14px; background: var(--panel); }
.ml-panel h3 { margin: 0 0 8px; font-size: var(--font-16); display: flex; gap: 8px; align-items: baseline; }
.ml-panel h3 small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; }
.ml-day { padding: 6px 0; border-bottom: 1px dashed var(--line); }
.ml-day-date { font-weight: 600; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
.ml-event { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); padding: 2px 0; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-pagination { margin-top: 10px; justify-content: flex-end; }
.ml-warn { color: var(--warning); }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
@media (max-width: 1100px) { .ml-calendar { grid-template-columns: 1fr; } }
</style>
