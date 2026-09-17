<script setup lang="ts">
// 中长期售电计划（/zcqjy/plans，dljy#2973，MS-01..05）。
// - 售电目标：人工确认的经营安排（不是物理可发电量或法定额度），按交易主体 + 年/月管理；更改生成新版本，旧版本可查看当时的完成情况。
// - 完成情况：剩余计划待售量 = 确认目标 − 确认已售；完成率 = 确认已售 / 确认目标；可安排计划量再扣未完成占用。
//   目标未确认、已售覆盖不完整时显示待核验，不当 0；超计划如实显示负数与超过 100%。
// - 交易方案：草稿、方案测算（名义金额，非实际收入，不判断价格优劣）、确认可执行（建立占用）、撤销/关闭（释放占用）。
// - 本页只读合同底账与人工登记的计划/方案，不调用现货、预测或智能体服务；服务失败显示错误，不回退示意数值。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import PlanDetailDrawer from '@/components/midlong/p3/PlanDetailDrawer.vue'
import PlanFormDialog from '@/components/midlong/p3/PlanFormDialog.vue'
import ProposalDetailDrawer from '@/components/midlong/p3/ProposalDetailDrawer.vue'
import ProposalFormDialog from '@/components/midlong/p3/ProposalFormDialog.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { confirmPlan, fetchAllWindows, fetchPlanProgress, fetchProposals, type PlanWriteResult, type ProposalWriteResult } from '@/services/midlong/midlongP3Api'
import { captureScope, type ScopeSnapshot } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fmtPrice, fmtQuantity } from '@/services/midlong/midlongFormat'
import {
  arrangeableLabel, beijingDateTime, completionLabel, confirmFailureText, planPeriodLabel, proposalStatusTag, remainingLabel, verificationTag,
} from '@/services/midlong/midlongP3Format'
import {
  PLANNING_NOTICES, PLAN_PERIOD_TYPES, PLAN_PERIOD_TYPE_LABELS, PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS,
  type PlanPeriodType, type PlanProgressReport, type PlanProgressRow, type ProposalStatus, type TradeProposalDetail, type TradingWindowListRow,
} from '@/services/midlong/midlongP3Types'
import type { MidlongCapabilities, MidlongSubject } from '@/services/midlong/midlongTypes'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
/** 页面级状态只管能力与权限；两个标签页各自加载、各自报错，一个失败不清空另一个已加载的数据。 */
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const PAGE_SIZE = 50
const subjects = ref<MidlongSubject[]>([])
const subjectsError = ref('')

const report = ref<PlanProgressReport | null>(null)
const targetsLoading = ref(false)
const targetsError = ref('')
const proposals = ref<TradeProposalDetail[]>([])
const proposalTotal = ref(0)
const proposalsLoading = ref(false)
const proposalsError = ref('')
const proposalsLoaded = ref(false)
const windows = ref<TradingWindowListRow[]>([])

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const tab = ref(q('tab') === 'proposals' ? 'proposals' : 'targets')
const pageOfQuery = (key: string) => Math.max(1, Number(q(key)) || 1)
const filters = reactive({
  year: q('year'), subjectId: q('subjectId'), periodType: q('periodType') as PlanPeriodType | '', asOf: q('asOf'), planId: q('planId'), status: q('status') as ProposalStatus | '',
  page: pageOfQuery('page'), proposalPage: pageOfQuery('proposalPage'),
})

// 每个标签页的「筛选条件」（不含页码）。条件与上次取数不同就回到第一页：无论改条件的入口是查询按钮、
// 查看历史、回到当前还是切换标签，都不会拿着旧页码请求新条件下不存在的页（例如只剩一行的历史视图第 2 页）。
const targetsFilterKey = () => JSON.stringify([filters.year, filters.subjectId, filters.periodType, filters.asOf, filters.planId])
const proposalsFilterKey = () => JSON.stringify([filters.status, filters.subjectId])
let lastTargetsFilterKey = targetsFilterKey()
let lastProposalsFilterKey = proposalsFilterKey()

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const pageGuard = createLoadGuard()
const targetsGuard = createLoadGuard()
const proposalsGuard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function loadTargets() {
  if (targetsFilterKey() !== lastTargetsFilterKey) filters.page = 1
  lastTargetsFilterKey = targetsFilterKey()
  const key = `${scopeKey()}|${targetsFilterKey()}|${filters.page}`
  const token = targetsGuard.begin(key)
  targetsLoading.value = true
  targetsError.value = ''
  try {
    const progress = await fetchPlanProgress({
      year: filters.year || undefined, subjectId: filters.subjectId || undefined, periodType: filters.periodType || undefined,
      asOf: filters.asOf || undefined, planId: filters.planId || undefined, page: filters.page, pageSize: PAGE_SIZE,
    })
    if (!targetsGuard.isCurrent(token, key)) return
    report.value = progress
  } catch (error) {
    if (!targetsGuard.isCurrent(token, key)) return
    // 只清本标签的数据：失败时不显示旧条件下的数值，方案标签已加载的数据不受影响。
    report.value = null
    targetsError.value = midlongFailureOf(error).message
  } finally {
    if (targetsGuard.isCurrent(token, key)) targetsLoading.value = false
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
    const page = await fetchProposals({ status: filters.status || undefined, subjectId: filters.subjectId || undefined, page: filters.proposalPage, pageSize: PAGE_SIZE })
    if (!proposalsGuard.isCurrent(token, key)) return
    proposals.value = page.rows
    proposalTotal.value = page.total
    proposalsLoaded.value = true
  } catch (error) {
    if (!proposalsGuard.isCurrent(token, key)) return
    proposals.value = []
    proposalTotal.value = 0
    proposalsError.value = midlongFailureOf(error).message
  } finally {
    if (proposalsGuard.isCurrent(token, key)) proposalsLoading.value = false
  }
}

function loadActiveTab() {
  return tab.value === 'proposals' ? loadProposals() : loadTargets()
}

async function load() {
  const key = scopeKey()
  const token = pageGuard.begin(key)
  // 换了公司或地区：各标签数据与交易主体都属于原范围，全部清空，不在新范围里短暂显示
  // （错误与加载状态由各标签取数开始时重置；公告候选在打开表单时重新加载）。
  if (key !== loadedScope) {
    report.value = null
    proposals.value = []
    proposalTotal.value = 0
    proposalsLoaded.value = false
    subjects.value = []
  }
  loadedScope = key
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!pageGuard.isCurrent(token, scopeKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!caps.modules.plans) { state.value = 'module-off'; return }
    state.value = 'ready'
  } catch (error) {
    if (!pageGuard.isCurrent(token, scopeKey())) return
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
    return
  }
  // 交易主体只用于筛选与表单，加载失败单独提示，不影响完成情况与方案列表。
  subjectsError.value = ''
  fetchSubjects().then((rows) => {
    if (pageGuard.isCurrent(token, scopeKey())) subjects.value = rows
  }).catch((error) => {
    if (pageGuard.isCurrent(token, scopeKey())) subjectsError.value = midlongFailureOf(error).message
  })
  await loadActiveTab()
}

/** 查询按钮：条件变化由各标签的筛选键自动回到第一页。 */
function search() {
  apply()
}

/** 条件与上次取数不同的标签回到第一页。必须在写路由之前调用：否则 URL 留着旧页码，刷新或分享时又按旧页码初始化。 */
function resetChangedPages() {
  if (targetsFilterKey() !== lastTargetsFilterKey) filters.page = 1
  if (proposalsFilterKey() !== lastProposalsFilterKey) filters.proposalPage = 1
}

function apply() {
  resetChangedPages()
  const next: Record<string, string> = { tab: tab.value }
  for (const [k, v] of Object.entries(filters)) if (v) next[k] = String(v)
  void router.replace({ query: next })
  if (state.value === 'ready') void loadActiveTab()
  else void load()
}

function changePage(target: 'targets' | 'proposals', page: number) {
  if (target === 'targets') filters.page = page
  else filters.proposalPage = page
  apply()
}

onMounted(load)
// 切换公司/地区：主体、目标、方案编号都属于原公司——关闭详情抽屉与表单（与执行页一致），清掉筛选后重新取数，旧请求迟到直接丢弃。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  planDrawer.open = false
  proposalDrawer.open = false
  planDialog.open = false
  proposalDialog.open = false
  planActionError.value = ''
  Object.assign(filters, { subjectId: '', planId: '', asOf: '', page: 1, proposalPage: 1 })
  lastTargetsFilterKey = targetsFilterKey()
  lastProposalsFilterKey = proposalsFilterKey()
  const next: Record<string, string> = { tab: tab.value }
  void router.replace({ query: next })
  void load()
})

function showHistory(payload: { planId: number; asOf: string; revisionNo: number }) {
  planDrawer.open = false
  Object.assign(filters, { planId: String(payload.planId), asOf: payload.asOf })
  tab.value = 'targets'
  apply()
}
function backToCurrent() {
  Object.assign(filters, { planId: '', asOf: '' })
  apply()
}

// ── 目标 ─────────────────────────────────────────────────────────────────────
const planDialog = reactive({ open: false, mode: 'create' as 'create' | 'edit' | 'revise', plan: null as PlanProgressRow | null })
const planDrawer = reactive({ open: false, planId: null as number | null })
const planDrawerRef = ref<InstanceType<typeof PlanDetailDrawer> | null>(null)
const planActionError = ref('')
const confirming = ref<number | null>(null)

function openPlanDialog(mode: 'create' | 'edit' | 'revise', plan: PlanProgressRow | null = null) {
  Object.assign(planDialog, { open: true, mode, plan })
}

async function doConfirmPlan(row: PlanProgressRow) {
  if (confirming.value) return
  confirming.value = row.id
  planActionError.value = ''
  try {
    await confirmPlan(row.id, row.rowVersion)
    ElMessage.success(`目标 ${planPeriodLabel(row.periodType, row.periodKey)} 已确认新版本`)
    await Promise.all([loadTargets(), reloadPlanDrawer(row.id)])
  } catch (e) {
    const f = midlongFailureOf(e)
    planActionError.value = confirmFailureText(f.errorCode, f.message, f.details)
  } finally {
    confirming.value = null
  }
}

/** 目标写入后：详情抽屉若正开着同一目标，planId 没变、抽屉不会自己重新取数，显式重新加载，避免继续显示旧版本与旧占用。 */
function reloadPlanDrawer(planId: number) {
  return planDrawer.open && planDrawer.planId === planId ? planDrawerRef.value?.reload() : undefined
}
async function onPlanSaved(result: PlanWriteResult) {
  await Promise.all([load(), reloadPlanDrawer(result.planId)])
}

const hasUnverified = computed(() => (report.value?.rows ?? []).some((r) => r.progress.verificationStatus === 'UNVERIFIED'))
const hasOverPlan = computed(() => (report.value?.rows ?? []).some((r) => r.progress.overPlan))
const hasOverCommitted = computed(() => (report.value?.rows ?? []).some((r) => r.progress.overCommitted))

// ── 方案 ─────────────────────────────────────────────────────────────────────
const proposalDialog = reactive({ open: false, proposal: null as TradeProposalDetail | null })
const proposalDrawer = reactive({ open: false, proposalId: null as number | null })
const proposalDrawerRef = ref<InstanceType<typeof ProposalDetailDrawer> | null>(null)
/** 打开方案表单时的范围：保存结果只在同一公司与地区内刷新列表、打开或重载抽屉。 */
let proposalFormScope: ScopeSnapshot | null = null

function openProposal(id: number) {
  Object.assign(proposalDrawer, { open: true, proposalId: id })
}
const windowsLoading = ref(false)
/**
 * 打开方案表单时才加载公告候选（不在进入页面时加载）：公告接口失败只影响候选，不影响目标与方案列表；
 * 加载期间切换了公司就放弃打开，候选与表单都属于原公司。
 */
async function openProposalForm(proposal: TradeProposalDetail | null) {
  if (windowsLoading.value) return
  const scope = captureScope()
  let rows: TradingWindowListRow[] = []
  if (capabilities.value?.modules.execution) {
    windowsLoading.value = true
    try {
      rows = await fetchAllWindows()
    } catch (error) {
      if (scope.isCurrent()) ElMessage.warning(`公告候选加载失败：${midlongFailureOf(error).message}；可先保存不关联公告的草稿`)
    } finally {
      windowsLoading.value = false
    }
  }
  // 唯一的范围核对：加载期间切换了公司，候选与表单都属于原公司，放弃打开。
  if (!scope.isCurrent()) return
  windows.value = rows
  proposalFormScope = scope
  Object.assign(proposalDialog, { open: true, proposal })
}
function editProposal(proposal: TradeProposalDetail) {
  void openProposalForm(proposal)
}
async function onProposalSaved(result: ProposalWriteResult) {
  const scope = proposalFormScope
  // 在已打开的同一方案抽屉里修改草稿：proposalId 没变、抽屉不会自己重新取数，必须显式重新加载；
  // 否则抽屉继续显示旧字段、旧测算与旧版本号，随后确认会带旧版本撞版本冲突。
  // （切换公司时抽屉已被关闭，不会走到这里。）
  if (proposalDrawer.open && proposalDrawer.proposalId === result.proposalId) {
    await Promise.all([loadProposals(), proposalDrawerRef.value?.reload()])
    return
  }
  await loadProposals()
  // 唯一的范围核对：保存返回前或列表加载期间切换了公司，方案属于原公司，不在新公司里打开它。
  if (scope?.isCurrent()) openProposal(result.proposalId)
}

const segmentSummary = (p: TradeProposalDetail) => p.segments.map((s) => `${s.deliveryMonth} ${fmtQuantity(s.quantity)}`).join('；')
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期售电计划</h2>
      <span class="ml-sub">人工售电目标 · 剩余计划待售量与完成率 · 交易方案测算与占用</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading'" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="售电计划功能尚未开放">当前环境未开放售电目标与交易方案功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="计划加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="state === 'ready'">
      <MidlongNotice tone="info" title="口径">{{ PLANNING_NOTICES.targetNature }} {{ PLANNING_NOTICES.occupation }}</MidlongNotice>
      <MidlongNotice v-if="subjectsError" tone="warn" title="交易主体加载失败">{{ subjectsError }}（筛选与表单暂不能选择主体）</MidlongNotice>

      <el-tabs v-model="tab" @tab-change="apply">
        <el-tab-pane label="目标与完成情况" name="targets">
          <div v-if="targetsLoading && !report" v-loading="true" class="ml-placeholder" />
          <MidlongNotice v-if="targetsError" tone="danger" title="完成情况加载失败（未显示任何替代数值）" data-test="targets-error">
            {{ targetsError }} <el-button link type="primary" @click="loadTargets">重试</el-button>
          </MidlongNotice>
          <template v-if="report">
          <div class="ml-filters">
            <el-date-picker v-model="filters.year" type="year" value-format="YYYY" placeholder="交割年" style="width: 120px" />
            <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 170px">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
            </el-select>
            <el-select v-model="filters.periodType" placeholder="粒度" clearable style="width: 100px">
              <el-option v-for="t in PLAN_PERIOD_TYPES" :key="t" :label="PLAN_PERIOD_TYPE_LABELS[t]" :value="t" />
            </el-select>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button v-if="canWrite && report.view === 'CURRENT'" @click="openPlanDialog('create')">新建目标</el-button>
          </div>

          <MidlongNotice v-if="report.view === 'AS_OF'" tone="info" title="历史视图（旧报告）">
            按 {{ beijingDateTime(report.asOf) }} 当时已确认的目标版本、合同与占用计算；之后的目标更改、合同确认不影响本视图。
            <el-button link type="primary" @click="backToCurrent">回到当前视图</el-button>
          </MidlongNotice>
          <MidlongNotice v-if="hasUnverified" tone="warn" title="部分结果未完成核验">{{ PLANNING_NOTICES.unverified }}</MidlongNotice>
          <MidlongNotice v-if="hasOverPlan" tone="warn" title="存在超计划">{{ PLANNING_NOTICES.overPlan }}</MidlongNotice>
          <MidlongNotice v-if="hasOverCommitted" tone="warn" title="占用超过目标">{{ PLANNING_NOTICES.overCommitted }}</MidlongNotice>
          <MidlongNotice v-if="planActionError" tone="danger" title="操作未完成">{{ planActionError }}</MidlongNotice>

          <el-table :data="report.rows" border size="small" class="ml-table">
            <el-table-column label="交易主体" min-width="130"><template #default="{ row }">{{ row.subjectName ?? `#${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="交割期" width="130"><template #default="{ row }">{{ planPeriodLabel(row.periodType, row.periodKey) }}</template></el-table-column>
            <el-table-column label="确认目标(MWh)" width="130" align="right">
              <template #default="{ row }">{{ row.confirmedRevision ? `${fmtQuantity(row.progress.targetQuantity)}（v${row.confirmedRevision.revisionNo}）` : '目标未确认' }}</template>
            </el-table-column>
            <el-table-column label="确认已售电量(MWh)" width="150" align="right">
              <template #default="{ row }">{{ row.progress.knownSoldQuantity === null ? '未知' : fmtQuantity(row.progress.knownSoldQuantity) }}<span v-if="!row.progress.soldComplete" class="ml-warn">（另有未分解）</span></template>
            </el-table-column>
            <el-table-column label="剩余计划待售量" min-width="150" align="right">
              <template #default="{ row }"><span :class="{ 'ml-warn': row.progress.overPlan }">{{ remainingLabel(row.progress) }}</span></template>
            </el-table-column>
            <el-table-column label="完成率" width="130" align="right">
              <template #default="{ row }"><span :class="{ 'ml-warn': row.progress.overPlan }">{{ completionLabel(row.progress) }}</span></template>
            </el-table-column>
            <el-table-column label="未完成占用(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.progress.openOccupationQuantity) }}</template></el-table-column>
            <el-table-column label="可安排计划量" min-width="140" align="right"><template #default="{ row }">{{ arrangeableLabel(row.progress) }}</template></el-table-column>
            <el-table-column label="核验" width="140">
              <template #default="{ row }">
                <el-tag size="small" :type="verificationTag(row.progress).type">{{ verificationTag(row.progress).label }}</el-tag>
                <el-tag v-if="row.progress.overPlan" size="small" type="danger">超计划</el-tag>
                <el-tag v-if="row.progress.overCommitted" size="small" type="warning">占用超目标</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="待确认版本" width="150">
              <template #default="{ row }">{{ row.draftRevision ? `v${row.draftRevision.revisionNo}：${row.draftRevision.targetQuantity === null ? '电量未定' : `${fmtQuantity(row.draftRevision.targetQuantity)} MWh`}` : '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="230" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="Object.assign(planDrawer, { open: true, planId: row.id })">版本与占用</el-button>
                <template v-if="canWrite && report.view === 'CURRENT'">
                  <el-button v-if="row.draftRevision" link @click="openPlanDialog('edit', row)">修改</el-button>
                  <el-button v-if="row.draftRevision" link type="primary" :loading="confirming === row.id" @click="doConfirmPlan(row)">确认</el-button>
                  <el-button v-if="!row.draftRevision && row.confirmedRevision" link @click="openPlanDialog('revise', row)">发起更改</el-button>
                </template>
              </template>
            </el-table-column>
            <template #empty>所选范围内没有售电目标。</template>
          </el-table>
          <el-pagination
            v-if="report.total > report.pageSize" class="ml-pagination" layout="total, prev, pager, next" :total="report.total" :page-size="report.pageSize"
            :current-page="report.page" @current-change="(p: number) => changePage('targets', p)"
          />
          <div class="ml-foot">计算时点 {{ beijingDateTime(report.asOf) }} · 数据生成于 {{ beijingDateTime(report.generatedAt) }}</div>
          </template>
        </el-tab-pane>

        <el-tab-pane label="交易方案" name="proposals">
          <div class="ml-filters">
            <el-select v-model="filters.status" placeholder="方案状态" clearable style="width: 140px">
              <el-option v-for="s in PROPOSAL_STATUSES" :key="s" :label="PROPOSAL_STATUS_LABELS[s]" :value="s" />
            </el-select>
            <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 170px">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
            </el-select>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button v-if="canWrite" :loading="windowsLoading" @click="openProposalForm(null)">新建方案草稿</el-button>
          </div>
          <MidlongNotice tone="info">{{ PLANNING_NOTICES.simulation }}</MidlongNotice>
          <MidlongNotice v-if="proposalsError" tone="danger" title="方案列表加载失败" data-test="proposals-error">
            {{ proposalsError }} <el-button link type="primary" @click="loadProposals">重试</el-button>
          </MidlongNotice>
          <el-table v-loading="proposalsLoading" :data="proposals" border size="small" class="ml-table" @row-click="(row: TradeProposalDetail) => openProposal(row.id)">
            <el-table-column label="方案" width="80"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="proposalStatusTag(row.status).type">{{ proposalStatusTag(row.status).label }}</el-tag></template></el-table-column>
            <el-table-column label="交易主体" min-width="120"><template #default="{ row }">{{ row.subjectName ?? `#${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="交割片段（MWh）" min-width="220"><template #default="{ row }">{{ segmentSummary(row) }}</template></el-table-column>
            <el-table-column label="报价" width="120" align="right"><template #default="{ row }">{{ row.proposedPrice === null ? '待填写' : fmtPrice(row.proposedPrice) }}</template></el-table-column>
            <el-table-column label="未完成占用" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.openOccupationQuantity) }}</template></el-table-column>
            <el-table-column label="公告" min-width="170">
              <template #default="{ row }">
                <template v-if="row.window">{{ row.window.referenced?.announcementName ?? `#${row.window.windowId}` }} v{{ row.window.referencedRevisionNo }}</template>
                <span v-else class="ml-muted">未关联</span>
                <el-tag v-if="row.window?.needsRecheck" size="small" type="warning">公告已更正待核对</el-tag>
              </template>
            </el-table-column>
            <template #empty>{{ proposalsError ? '方案列表未加载' : proposalsLoaded ? '尚无交易方案。' : '加载中' }}</template>
          </el-table>
          <el-pagination
            v-if="proposalTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="proposalTotal" :page-size="PAGE_SIZE"
            :current-page="filters.proposalPage" @current-change="(p: number) => changePage('proposals', p)"
          />
        </el-tab-pane>
      </el-tabs>
    </template>

    <PlanFormDialog v-model="planDialog.open" :mode="planDialog.mode" :plan="planDialog.plan" :subjects="subjects" @saved="onPlanSaved" />
    <PlanDetailDrawer ref="planDrawerRef" v-model="planDrawer.open" :plan-id="planDrawer.planId" @history="showHistory" />
    <ProposalFormDialog v-model="proposalDialog.open" :proposal="proposalDialog.proposal" :subjects="subjects" :windows="windows" @saved="onProposalSaved" />
    <ProposalDetailDrawer
      ref="proposalDrawerRef" v-model="proposalDrawer.open" :proposal-id="proposalDrawer.proposalId" :can-write="canWrite" mode="plans"
      @changed="load" @edit="editProposal"
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
.ml-table { margin-top: 10px; }
.ml-foot { margin-top: 8px; font-size: var(--font-xs); color: var(--muted); }
.ml-pagination { margin-top: 10px; justify-content: flex-end; }
.ml-warn { color: var(--warning); }
.ml-muted { color: var(--muted); }
</style>
