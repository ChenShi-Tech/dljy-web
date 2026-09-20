<script setup lang="ts">
// 中长期业务复盘 / 月报页（建议路由 /zcqjy/review，dljy#3016，MR-01/02/05/06；路由/导航由主执行者注册，本组件只导出）。
// 按月份/主体查看复盘指标（计划完成、成交量价分组、分布、绿电组成、未成交、错过窗口、变更、资料缺口、三种金额）；
// 生成月度报告（冻结输入与指标快照）、版本列表与详情（冻结快照口径、导出与归档一致）、受影响报告定位（迟到修订）。
// 只展示已开放能力：review 模块关闭 = 不渲染指标区、不发任何请求；不导入现货复盘状态。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import ReviewMetricsPanel from '@/components/midlong/p5/ReviewMetricsPanel.vue'
import ReviewReportDrawer from '@/components/midlong/p5/ReviewReportDrawer.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { fetchAffectedReports, fetchReports, fetchReviewMetrics, generateReport, p5ModuleOn } from '@/services/midlong/midlongP5Api'
import { createLoadGuard } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { reportChangeLine, reportScopeLabel, settlementFailureText } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_NOTICES, type AffectedReportInputKind, type AffectedReportsResult, type GenerateReportResult, type ReviewMetrics, type ReviewReportSummaryRow } from '@/services/midlong/midlongP5Types'
import type { MidlongCapabilities, MidlongSubject } from '@/services/midlong/midlongTypes'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const currentMonth = () => new Date().toISOString().slice(0, 7)
const filters = reactive({
  month: MONTH_RE.test(q('month')) ? q('month') : currentMonth(),
  subjectId: q('subject') ? Number(q('subject')) : null,
  page: Math.max(1, Number(q('page')) || 1),
})
const filterKey = () => JSON.stringify([filters.month, filters.subjectId])
let lastFilterKey = filterKey()

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const pageGuard = createLoadGuard()
const metricsGuard = createLoadGuard()
const reportsGuard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

const metrics = ref<ReviewMetrics | null>(null)
const metricsError = ref('')
const metricsLoading = ref(false)
const subjects = ref<MidlongSubject[]>([])

const PAGE_SIZE = 20
const reports = ref<ReviewReportSummaryRow[]>([])
const reportsTotal = ref(0)
const reportsLoading = ref(false)
const reportsError = ref('')

async function loadMetrics() {
  if (!MONTH_RE.test(filters.month)) { metricsError.value = '请选择有效交割月（YYYY-MM）'; metrics.value = null; return }
  const key = `${scopeKey()}|${filterKey()}`
  const token = metricsGuard.begin(key)
  metricsLoading.value = true
  metricsError.value = ''
  try {
    const result = await fetchReviewMetrics({ month: filters.month, subjectId: filters.subjectId })
    if (!metricsGuard.isCurrent(token, key)) return
    metrics.value = result
  } catch (e) {
    if (!metricsGuard.isCurrent(token, key)) return
    metrics.value = null
    metricsError.value = midlongFailureOf(e).message
  } finally {
    if (metricsGuard.isCurrent(token, key)) metricsLoading.value = false
  }
}

async function loadReports() {
  const key = `${scopeKey()}|${filterKey()}|${filters.page}`
  const token = reportsGuard.begin(key)
  reportsLoading.value = true
  reportsError.value = ''
  try {
    const result = await fetchReports({ month: filters.month, subjectId: filters.subjectId, page: filters.page, pageSize: PAGE_SIZE })
    if (!reportsGuard.isCurrent(token, key)) return
    reports.value = result.rows
    reportsTotal.value = result.total
  } catch (e) {
    if (!reportsGuard.isCurrent(token, key)) return
    reports.value = []
    reportsTotal.value = 0
    reportsError.value = midlongFailureOf(e).message
  } finally {
    if (reportsGuard.isCurrent(token, key)) reportsLoading.value = false
  }
}

async function load() {
  const key = scopeKey()
  const token = pageGuard.begin(key)
  if (key !== loadedScope) {
    metrics.value = null
    reports.value = []
    reportsTotal.value = 0
    subjects.value = []
    Object.assign(filters, { page: 1 })
    lastFilterKey = filterKey()
  }
  loadedScope = key
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!pageGuard.isCurrent(token, scopeKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p5ModuleOn(caps, 'review')) { state.value = 'module-off'; return }
    state.value = 'ready'
  } catch (error) {
    if (!pageGuard.isCurrent(token, scopeKey())) return
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
    return
  }
  try {
    subjects.value = await fetchSubjects()
  } catch {
    subjects.value = []
  }
  if (pageGuard.isCurrent(token, scopeKey())) {
    void loadMetrics()
    void loadReports()
  }
}

function syncRoute() {
  if (filterKey() !== lastFilterKey) filters.page = 1
  lastFilterKey = filterKey()
  const next: Record<string, string> = { month: filters.month }
  if (filters.subjectId) next.subject = String(filters.subjectId)
  if (filters.page > 1) next.page = String(filters.page)
  void router.replace({ query: next })
}

function search() {
  syncRoute()
  if (state.value === 'ready') { void loadMetrics(); void loadReports() }
  else void load()
}

function changePage(page: number) {
  filters.page = page
  syncRoute()
  void loadReports()
}

// ── 生成月报（冻结报告；REPORT_INPUTS_UNCHANGED / 迟到修订新版本）────────────

const generateDialog = ref(false)
const generateNote = ref('')
const generating = ref(false)
const generateError = ref('')
const generateResult = ref<GenerateReportResult | null>(null)
// 写会话：生成 = 该月份+主体范围的报告；关闭或重开让进行中的保存失效。
const generateSession = createWriteSession(() => `report:${filters.month}:${filters.subjectId ?? 0}`)

function openGenerate() {
  generateNote.value = ''
  generateError.value = ''
  generateResult.value = null
  generateDialog.value = true
  generateSession.open()
}

watch(generateDialog, (open) => {
  if (!open) generateSession.close()
})

async function submitGenerate() {
  if (generating.value) return
  generating.value = true
  generateError.value = ''
  const ticket = generateSession.begin()
  const input = { month: filters.month, subjectId: filters.subjectId, note: generateNote.value.trim() || null }
  try {
    ticket.assertCurrent()
    const result = await generateReport(input)
    ElMessage.success(`报告已生成：v${result.versionNo}（输入已冻结）`)
    // 成功后对话框保持打开展示冻结结果（版本、变化输入与输入计数），用户确认后再关闭。
    if (ticket.sameSession()) generateResult.value = result
    void loadReports()
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = settlementFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) generateError.value = message
    else ElMessage.warning(`报告生成未完成：${message}`)
  } finally {
    if (ticket.sameSession()) generating.value = false
  }
}

// ── 受影响报告定位（/reports/affected）──────────────────────────────────────

const affectedKind = ref<AffectedReportInputKind>('contractId')
const affectedId = ref('')
const affected = ref<AffectedReportsResult | null>(null)
const affectedLoading = ref(false)
const affectedError = ref('')
const affectedGuard = createLoadGuard()

async function locateAffected() {
  const id = Number(affectedId.value)
  if (!Number.isInteger(id) || id < 1) { affectedError.value = '请输入要定位的输入对象 ID（正整数）'; return }
  const key = `${scopeKey()}|${affectedKind.value}|${id}`
  const token = affectedGuard.begin(key)
  affectedLoading.value = true
  affectedError.value = ''
  try {
    const result = await fetchAffectedReports({ kind: affectedKind.value, id })
    if (!affectedGuard.isCurrent(token, key)) return
    affected.value = result
  } catch (e) {
    if (!affectedGuard.isCurrent(token, key)) return
    affected.value = null
    affectedError.value = midlongFailureOf(e).message
  } finally {
    if (affectedGuard.isCurrent(token, key)) affectedLoading.value = false
  }
}

// ── 报告详情抽屉 ─────────────────────────────────────────────────────────────

const drawer = reactive({ open: false, reportId: null as number | null })
function openReport(id: number) {
  Object.assign(drawer, { open: true, reportId: id })
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  drawer.open = false
  generateDialog.value = false
  generateSession.close()
  affected.value = null
  affectedError.value = ''
  metricsError.value = ''
  reportsError.value = ''
  Object.assign(filters, { page: 1 })
  lastFilterKey = filterKey()
  void load()
})

const subjectLabel = (id: number | null) => (id === null ? null : subjects.value.find((s) => s.id === id)?.displayName ?? `主体 #${id}`)
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">业务复盘与月报</h2>
      <span class="ml-sub">中长期量价事实 · 报告冻结版本（不推断市场择时、套保或利润结论）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading'" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="业务复盘功能尚未开放" data-test="review-module-off">当前环境未开放复盘与月报功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="复盘数据加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="state === 'ready'">
      <div class="ml-filters">
        <el-date-picker v-model="filters.month" type="month" value-format="YYYY-MM" placeholder="交割月（必选）" style="width: 150px" data-test="month-filter" />
        <el-select v-model="filters.subjectId" filterable clearable placeholder="交易主体（可空 = 全公司）" style="width: 220px" data-test="subject-filter">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button v-if="canWrite" type="primary" plain data-test="generate-report" @click="openGenerate">生成月报（冻结）</el-button>
      </div>

      <div v-if="metricsLoading" v-loading="true" class="ml-placeholder" />
      <MidlongNotice v-else-if="metricsError" tone="danger" title="复盘指标加载失败" data-test="metrics-error">
        {{ metricsError }} <el-button link type="primary" @click="loadMetrics">重试</el-button>
      </MidlongNotice>
      <ReviewMetricsPanel v-else-if="metrics" :metrics="metrics" />

      <div class="ml-reports">
        <h3 class="ml-subtitle">月度报告版本</h3>
        <MidlongNotice v-if="reportsError" tone="danger" title="报告列表加载失败" data-test="reports-error">
          {{ reportsError }} <el-button link type="primary" @click="loadReports">重试</el-button>
        </MidlongNotice>
        <el-table v-else :data="reports" border size="small" v-loading="reportsLoading" @row-click="(row: ReviewReportSummaryRow) => openReport(row.id)">
          <el-table-column label="报告" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column label="交割月" width="100"><template #default="{ row }">{{ row.reportMonth }}</template></el-table-column>
          <el-table-column label="范围" min-width="180"><template #default="{ row }">{{ reportScopeLabel(row.scope, row.subjectName) }}</template></el-table-column>
          <el-table-column label="当前版本" width="90" align="center"><template #default="{ row }">v{{ row.currentVersionNo }}（共 {{ row.versionCount }} 版）</template></el-table-column>
          <el-table-column label="当前版本变更说明" min-width="220"><template #default="{ row }">{{ row.currentChangeReason ?? '—' }}</template></el-table-column>
          <el-table-column label="生成" width="160"><template #default="{ row }">{{ beijingDateTime(row.generatedAt) }}</template></el-table-column>
          <template #empty>尚未生成月报（点「生成月报」冻结当前输入与指标快照）。</template>
        </el-table>
        <el-pagination
          v-if="reportsTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="reportsTotal" :page-size="PAGE_SIZE"
          :current-page="filters.page" @current-change="changePage"
        />
      </div>

      <div class="ml-affected" data-test="affected-locator">
        <h3 class="ml-subtitle">受影响报告定位（迟到修订后）</h3>
        <div class="ml-filters">
          <el-select v-model="affectedKind" style="width: 150px" data-test="affected-kind">
            <el-option label="合同" value="contractId" />
            <el-option label="售电计划" value="planId" />
            <el-option label="成交确认" value="confirmationId" />
            <el-option label="外部账单" value="billId" />
          </el-select>
          <el-input v-model="affectedId" placeholder="输入对象 ID" style="width: 160px" data-test="affected-id" />
          <el-button :loading="affectedLoading" data-test="affected-search" @click="locateAffected">定位</el-button>
        </div>
        <MidlongNotice v-if="affectedError" tone="danger" title="定位失败">{{ affectedError }}</MidlongNotice>
        <template v-if="affected">
          <MidlongNotice tone="warn">{{ affected.notice }}</MidlongNotice>
          <el-table v-if="affected.rows.length" :data="affected.rows" border size="small" @row-click="(row: AffectedReportsResult['rows'][number]) => openReport(row.reportId)">
            <el-table-column label="报告" width="80"><template #default="{ row }">#{{ row.reportId }}（{{ row.reportMonth }}）</template></el-table-column>
            <el-table-column label="冻结版本" width="90" align="center"><template #default="{ row }">v{{ row.versionNo }}<el-tag v-if="row.isCurrentVersion" size="small" type="warning">仍是当前</el-tag></template></el-table-column>
            <el-table-column label="冻结输入版本" width="110" align="center"><template #default="{ row }">v{{ row.frozenRevisionNo }} → 当前 v{{ affected.input.currentRevisionNo }}</template></el-table-column>
            <el-table-column label="变更说明" min-width="200"><template #default="{ row }">{{ row.changeReason ?? '—' }}</template></el-table-column>
            <el-table-column label="生成" width="160"><template #default="{ row }">{{ beijingDateTime(row.generatedAt) }}</template></el-table-column>
          </el-table>
          <MidlongNotice v-else tone="info">没有冻结旧版本的报告（输入变化尚未影响任何已归档报告）。</MidlongNotice>
        </template>
      </div>
    </template>

    <el-dialog v-model="generateDialog" title="生成月度报告（冻结输入与指标快照）" width="640px" append-to-body>
      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.reportFrozen }}</MidlongNotice>
      <div class="ml-generate-fields">
        <div>交割月：<b data-test="generate-month">{{ filters.month }}</b> · 范围：<b data-test="generate-scope">{{ filters.subjectId ? `按交易主体 · ${subjectLabel(filters.subjectId)}` : '全公司（该月有确认目标的主体，超过 50 个须按主体筛选）' }}</b></div>
        <el-input v-model="generateNote" type="textarea" :rows="2" placeholder="生成说明（可空）" data-test="generate-note" />
      </div>
      <template v-if="generateResult">
        <MidlongNotice tone="info" :title="`已生成：报告 #${generateResult.reportId} v${generateResult.versionNo}`" data-test="generate-result">
          <div>变更说明：{{ generateResult.changeReason }}</div>
          <div v-if="generateResult.changes.length">变化输入：{{ generateResult.changes.map(reportChangeLine).join('、') }}</div>
          <div>冻结输入：合同 {{ generateResult.frozenInputs.contracts }} · 计划 {{ generateResult.frozenInputs.plans }} · 成交确认 {{ generateResult.frozenInputs.confirmations }} · 账单 {{ generateResult.frozenInputs.bills }}</div>
        </MidlongNotice>
        <MidlongNotice v-for="notice in generateResult.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>
      </template>
      <MidlongNotice v-if="generateError" tone="danger" title="未能生成" data-test="generate-error">{{ generateError }}</MidlongNotice>
      <template #footer>
        <el-button @click="generateDialog = false">{{ generateResult ? '完成' : '取消' }}</el-button>
        <el-button v-if="!generateResult" type="primary" :loading="generating" data-test="generate-submit" @click="submitGenerate">生成（冻结当前输入）</el-button>
      </template>
    </el-dialog>

    <ReviewReportDrawer v-model="drawer.open" :report-id="drawer.reportId" />
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-subtitle { margin: 0 0 8px; font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.ml-reports, .ml-affected { border-top: 1px dashed var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.ml-pagination { margin-top: 10px; justify-content: flex-end; }
.ml-generate-fields { display: flex; flex-direction: column; gap: 10px; font-size: var(--font-md); }
</style>
