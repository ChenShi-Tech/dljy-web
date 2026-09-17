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
import { confirmPlan, fetchPlanProgress, fetchProposals, fetchWindows } from '@/services/midlong/midlongP3Api'
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
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const report = ref<PlanProgressReport | null>(null)
const proposals = ref<TradeProposalDetail[]>([])
const subjects = ref<MidlongSubject[]>([])
const windows = ref<TradingWindowListRow[]>([])

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const tab = ref(q('tab') === 'proposals' ? 'proposals' : 'targets')
const filters = reactive({ year: q('year'), subjectId: q('subjectId'), periodType: q('periodType') as PlanPeriodType | '', asOf: q('asOf'), planId: q('planId'), status: q('status') as ProposalStatus | '' })

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const contextKey = () => `${scopeKey()}|${JSON.stringify(filters)}`
let loadedScope = ''

async function load() {
  const token = guard.begin(contextKey())
  if (scopeKey() !== loadedScope) { report.value = null; proposals.value = [] }
  loadedScope = scopeKey()
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!caps.modules.plans) { state.value = 'module-off'; return }
    const progressQuery = { year: filters.year || undefined, subjectId: filters.subjectId || undefined, periodType: filters.periodType || undefined, asOf: filters.asOf || undefined, planId: filters.planId || undefined }
    const [progress, proposalRows, subjectRows, windowRows] = await Promise.all([
      fetchPlanProgress(progressQuery),
      fetchProposals({ status: filters.status || undefined, subjectId: filters.subjectId || undefined }),
      fetchSubjects(),
      caps.modules.execution ? fetchWindows() : Promise.resolve([] as TradingWindowListRow[]),
    ])
    if (!guard.isCurrent(token, contextKey())) return
    report.value = progress
    proposals.value = proposalRows
    subjects.value = subjectRows
    windows.value = windowRows
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    report.value = null
    proposals.value = []
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
  }
}

function apply() {
  const next: Record<string, string> = { tab: tab.value }
  for (const [k, v] of Object.entries(filters)) if (v) next[k] = String(v)
  void router.replace({ query: next })
  void load()
}

onMounted(load)
// 切换公司/地区：主体、目标、方案编号都属于原公司，清掉筛选后重新取数，旧请求迟到直接丢弃。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  Object.assign(filters, { subjectId: '', planId: '', asOf: '' })
  apply()
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
    await load()
  } catch (e) {
    const f = midlongFailureOf(e)
    planActionError.value = confirmFailureText(f.errorCode, f.message, f.details)
  } finally {
    confirming.value = null
  }
}

const hasUnverified = computed(() => (report.value?.rows ?? []).some((r) => r.progress.verificationStatus === 'UNVERIFIED'))
const hasOverPlan = computed(() => (report.value?.rows ?? []).some((r) => r.progress.overPlan))

// ── 方案 ─────────────────────────────────────────────────────────────────────
const proposalDialog = reactive({ open: false, proposal: null as TradeProposalDetail | null })
const proposalDrawer = reactive({ open: false, proposalId: null as number | null })

function openProposal(id: number) {
  Object.assign(proposalDrawer, { open: true, proposalId: id })
}
function editProposal(proposal: TradeProposalDetail) {
  Object.assign(proposalDialog, { open: true, proposal })
}
async function onProposalSaved(result: { proposalId: number }) {
  await load()
  openProposal(result.proposalId)
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

    <div v-if="state === 'loading' && !report" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="售电计划功能尚未开放">当前环境未开放售电目标与交易方案功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="计划加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="report && (state === 'ready' || state === 'loading')">
      <MidlongNotice tone="info" title="口径">{{ PLANNING_NOTICES.targetNature }} {{ PLANNING_NOTICES.occupation }}</MidlongNotice>

      <el-tabs v-model="tab" @tab-change="apply">
        <el-tab-pane label="目标与完成情况" name="targets">
          <div class="ml-filters">
            <el-date-picker v-model="filters.year" type="year" value-format="YYYY" placeholder="交割年" style="width: 120px" />
            <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 170px">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
            </el-select>
            <el-select v-model="filters.periodType" placeholder="粒度" clearable style="width: 100px">
              <el-option v-for="t in PLAN_PERIOD_TYPES" :key="t" :label="PLAN_PERIOD_TYPE_LABELS[t]" :value="t" />
            </el-select>
            <el-button type="primary" @click="apply">查询</el-button>
            <el-button v-if="canWrite && report.view === 'CURRENT'" @click="openPlanDialog('create')">新建目标</el-button>
          </div>

          <MidlongNotice v-if="report.view === 'AS_OF'" tone="info" title="历史视图（旧报告）">
            按 {{ beijingDateTime(report.asOf) }} 当时已确认的目标版本、合同与占用计算；之后的目标更改、合同确认不影响本视图。
            <el-button link type="primary" @click="backToCurrent">回到当前视图</el-button>
          </MidlongNotice>
          <MidlongNotice v-if="hasUnverified" tone="warn" title="部分结果未完成核验">{{ PLANNING_NOTICES.unverified }}</MidlongNotice>
          <MidlongNotice v-if="hasOverPlan" tone="warn" title="存在超计划">{{ PLANNING_NOTICES.overPlan }}</MidlongNotice>
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
          <div class="ml-foot">计算时点 {{ beijingDateTime(report.asOf) }} · 数据生成于 {{ beijingDateTime(report.generatedAt) }}</div>
        </el-tab-pane>

        <el-tab-pane label="交易方案" name="proposals">
          <div class="ml-filters">
            <el-select v-model="filters.status" placeholder="方案状态" clearable style="width: 140px">
              <el-option v-for="s in PROPOSAL_STATUSES" :key="s" :label="PROPOSAL_STATUS_LABELS[s]" :value="s" />
            </el-select>
            <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 170px">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
            </el-select>
            <el-button type="primary" @click="apply">查询</el-button>
            <el-button v-if="canWrite" @click="Object.assign(proposalDialog, { open: true, proposal: null })">新建方案草稿</el-button>
          </div>
          <MidlongNotice tone="info">{{ PLANNING_NOTICES.simulation }}</MidlongNotice>
          <el-table :data="proposals" border size="small" class="ml-table" @row-click="(row: TradeProposalDetail) => openProposal(row.id)">
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
            <template #empty>尚无交易方案。</template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <PlanFormDialog v-model="planDialog.open" :mode="planDialog.mode" :plan="planDialog.plan" :subjects="subjects" @saved="load" />
    <PlanDetailDrawer v-model="planDrawer.open" :plan-id="planDrawer.planId" @history="showHistory" />
    <ProposalFormDialog v-model="proposalDialog.open" :proposal="proposalDialog.proposal" :subjects="subjects" :windows="windows" @saved="onProposalSaved" />
    <ProposalDetailDrawer v-model="proposalDrawer.open" :proposal-id="proposalDrawer.proposalId" :can-write="canWrite" mode="plans" @changed="load" @edit="editProposal" />
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
.ml-warn { color: var(--warning); }
.ml-muted { color: var(--muted); }
</style>
