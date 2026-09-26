<script setup lang="ts">
// 中长期账单与差异页（建议路由 /zcqjy/bills，dljy#3016，MR-02..04；路由/导航由主执行者注册，本组件只导出）。
// 账单台账（登记/修订/凭证，UNITEMIZED 只归档标未分项）+ 差异台账（登记/处理闭环，差值「外部−台账」如实）。
// 只展示已开放能力：bills 模块关闭 = 不渲染数据区、不发任何请求；无凭证不显示到账、未独立复算不显示复算通过。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import BillFormDialog from '@/components/midlong/p5/BillFormDialog.vue'
import BillDetailDrawer from '@/components/midlong/p5/BillDetailDrawer.vue'
import DiscrepancyFormDialog from '@/components/midlong/p5/DiscrepancyFormDialog.vue'
import DiscrepancyDetailDrawer from '@/components/midlong/p5/DiscrepancyDetailDrawer.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchSubjects, midlongFailureOf } from '@/services/midlong/midlongApi'
import { exportBills, exportDiscrepancies, fetchBills, fetchDiscrepancies, p5ModuleOn } from '@/services/midlong/midlongP5Api'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, downloadCsv, fmtAmount } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { billKindTag, billPeriodLabel, discrepancyStatusTag, settlementFailureText, signedDeltaLabel, voucherText } from '@/services/midlong/midlongP5Format'
import { DISCREPANCY_STATUSES, DISCREPANCY_STATUS_LABELS, SETTLEMENT_NOTICES, type BillSummaryRow, type DiscrepancyStatus, type DiscrepancySummaryRow } from '@/services/midlong/midlongP5Types'
import type { MidlongCapabilities, MidlongSubject } from '@/services/midlong/midlongTypes'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const tab = ref(q('tab') === 'discrepancies' ? 'discrepancies' : 'bills')

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const pageGuard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

const subjects = ref<MidlongSubject[]>([])

// ── 账单台账 ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50
const billFilters = reactive({
  subjectId: q('subjectId') ? Number(q('subjectId')) : undefined as number | undefined,
  billKind: q('billKind') || undefined as string | undefined,
  externalBillNo: q('externalBillNo') || undefined as string | undefined,
  month: q('billMonth') || undefined as string | undefined,
  page: Math.max(1, Number(q('billPage')) || 1),
})
const bills = ref<BillSummaryRow[]>([])
const billsTotal = ref(0)
const billsLoading = ref(false)
const billsError = ref('')
const billsGuard = createLoadGuard()

const billFilterKey = () => JSON.stringify([billFilters.subjectId, billFilters.billKind, billFilters.externalBillNo, billFilters.month])
let lastBillFilterKey = billFilterKey()

async function loadBills() {
  if (billFilterKey() !== lastBillFilterKey) billFilters.page = 1
  lastBillFilterKey = billFilterKey()
  const key = `${scopeKey()}|bills|${billFilterKey()}|${billFilters.page}`
  const token = billsGuard.begin(key)
  billsLoading.value = true
  billsError.value = ''
  try {
    const page = await fetchBills({
      page: billFilters.page, pageSize: PAGE_SIZE,
      subjectId: billFilters.subjectId, billKind: billFilters.billKind,
      externalBillNo: billFilters.externalBillNo, month: billFilters.month,
    })
    if (!billsGuard.isCurrent(token, key)) return
    bills.value = page.rows
    billsTotal.value = page.total
  } catch (e) {
    if (!billsGuard.isCurrent(token, key)) return
    bills.value = []
    billsTotal.value = 0
    billsError.value = midlongFailureOf(e).message
  } finally {
    if (billsGuard.isCurrent(token, key)) billsLoading.value = false
  }
}

// ── 差异台账 ─────────────────────────────────────────────────────────────────
const discrepancyFilters = reactive({
  subjectId: q('subjectId') ? Number(q('subjectId')) : undefined as number | undefined,
  status: (q('status') || undefined) as DiscrepancyStatus | undefined,
  month: q('month') || undefined as string | undefined,
  page: Math.max(1, Number(q('page')) || 1),
})
const discrepancies = ref<DiscrepancySummaryRow[]>([])
const discrepanciesTotal = ref(0)
const discrepanciesLoading = ref(false)
const discrepanciesError = ref('')
const discrepanciesGuard = createLoadGuard()

const discrepancyFilterKey = () => JSON.stringify([discrepancyFilters.subjectId, discrepancyFilters.status, discrepancyFilters.month])
let lastDiscrepancyFilterKey = discrepancyFilterKey()

async function loadDiscrepancies() {
  if (discrepancyFilterKey() !== lastDiscrepancyFilterKey) discrepancyFilters.page = 1
  lastDiscrepancyFilterKey = discrepancyFilterKey()
  const key = `${scopeKey()}|discrepancies|${discrepancyFilterKey()}|${discrepancyFilters.page}`
  const token = discrepanciesGuard.begin(key)
  discrepanciesLoading.value = true
  discrepanciesError.value = ''
  try {
    const page = await fetchDiscrepancies({
      page: discrepancyFilters.page, pageSize: PAGE_SIZE,
      subjectId: discrepancyFilters.subjectId, status: discrepancyFilters.status, month: discrepancyFilters.month,
    })
    if (!discrepanciesGuard.isCurrent(token, key)) return
    discrepancies.value = page.rows
    discrepanciesTotal.value = page.total
  } catch (e) {
    if (!discrepanciesGuard.isCurrent(token, key)) return
    discrepancies.value = []
    discrepanciesTotal.value = 0
    discrepanciesError.value = midlongFailureOf(e).message
  } finally {
    if (discrepanciesGuard.isCurrent(token, key)) discrepanciesLoading.value = false
  }
}

// ── 页面装配与切换 ───────────────────────────────────────────────────────────

async function load() {
  const key = scopeKey()
  const token = pageGuard.begin(key)
  if (key !== loadedScope) {
    bills.value = []
    billsTotal.value = 0
    discrepancies.value = []
    discrepanciesTotal.value = 0
    subjects.value = []
    billFilters.page = 1
    discrepancyFilters.page = 1
    lastBillFilterKey = billFilterKey()
    lastDiscrepancyFilterKey = discrepancyFilterKey()
  }
  loadedScope = key
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!pageGuard.isCurrent(token, scopeKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p5ModuleOn(caps, 'bills')) { state.value = 'module-off'; return }
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
  if (!pageGuard.isCurrent(token, scopeKey())) return
  void loadBills()
  void loadDiscrepancies()
}

function search() {
  const next: Record<string, string> = { tab: tab.value }
  if (billFilters.subjectId) next.subjectId = String(billFilters.subjectId)
  if (billFilters.billKind) next.billKind = billFilters.billKind
  if (billFilters.externalBillNo) next.externalBillNo = billFilters.externalBillNo
  if (billFilters.month) next.billMonth = billFilters.month
  if (billFilters.page > 1) next.billPage = String(billFilters.page)
  if (discrepancyFilters.status) next.status = discrepancyFilters.status
  if (discrepancyFilters.month) next.month = discrepancyFilters.month
  if (discrepancyFilters.page > 1) next.page = String(discrepancyFilters.page)
  void router.replace({ query: next })
  void loadBills()
  void loadDiscrepancies()
}

function changeBillPage(page: number) { billFilters.page = page; void loadBills() }
function changeDiscrepancyPage(page: number) { discrepancyFilters.page = page; void loadDiscrepancies() }

// ── 写入口与抽屉 ─────────────────────────────────────────────────────────────

const billDialog = ref(false)
const billDrawer = reactive({ open: false, billId: null as number | null })
const discrepancyDialog = ref(false)
const discrepancyDrawer = reactive({ open: false, discrepancyId: null as number | null })
const exporting = ref('')

async function exportCurrent(kind: 'bills' | 'discrepancies') {
  if (exporting.value) return
  const scope = captureScope()
  exporting.value = kind
  try {
    const result = kind === 'bills'
      ? await exportBills({ subjectId: billFilters.subjectId, billKind: billFilters.billKind, externalBillNo: billFilters.externalBillNo, month: billFilters.month })
      : await exportDiscrepancies({ subjectId: discrepancyFilters.subjectId, status: discrepancyFilters.status, month: discrepancyFilters.month })
    scope.assertCurrent()
    downloadCsv(result.fileName, result.content)
    ElMessage.success(`已导出 ${result.fileName}（${result.rowCount} 行，同列表筛选与当前有效版本口径）`)
  } catch (e) {
    const f = midlongFailureOf(e)
    ElMessage.error(settlementFailureText(f.errorCode, f.message, f.details))
  } finally {
    exporting.value = ''
  }
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  billDrawer.open = false
  discrepancyDrawer.open = false
  billDialog.value = false
  discrepancyDialog.value = false
  Object.assign(billFilters, { page: 1 })
  Object.assign(discrepancyFilters, { page: 1 })
  lastBillFilterKey = billFilterKey()
  lastDiscrepancyFilterKey = discrepancyFilterKey()
  void load()
})
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">外部账单与差异</h2>
      <span class="ml-sub">三种金额分离（名义 / 账单 / 收款）· 差异闭环（外部 − 台账，如实）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading'" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已登记账单、差异与冻结报告全部保留，写保护不受开关影响。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="账单与差异功能尚未开放" data-test="bills-module-off">当前环境未开放账单登记与差异处理功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="账单数据加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="state === 'ready'">
      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.threeAmounts }}</MidlongNotice>
      <el-tabs v-model="tab">
        <el-tab-pane label="账单台账" name="bills">
          <div class="ml-filters">
            <el-select v-model="billFilters.subjectId" filterable clearable placeholder="交易主体" style="width: 190px" data-test="bill-subject-filter">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
            </el-select>
            <el-select v-model="billFilters.billKind" clearable placeholder="形态" style="width: 170px" data-test="bill-kind-filter">
              <el-option label="有中长期明确分项" value="ITEMIZED" />
              <el-option label="综合账单（未分项）" value="UNITEMIZED" />
            </el-select>
            <el-date-picker v-model="billFilters.month" type="month" value-format="YYYY-MM" placeholder="覆盖月份" style="width: 140px" data-test="bill-month-filter" />
            <el-input v-model="billFilters.externalBillNo" placeholder="外部账单编号" clearable style="width: 170px" data-test="bill-no-filter" />
            <el-button type="primary" @click="search">查询</el-button>
            <el-button v-if="canWrite" type="primary" data-test="register-bill" @click="billDialog = true">登记账单</el-button>
            <el-button :loading="exporting === 'bills'" data-test="export-bills" @click="exportCurrent('bills')">导出台账</el-button>
          </div>
          <MidlongNotice v-if="billsError" tone="danger" title="账单列表加载失败" data-test="bills-error">
            {{ billsError }} <el-button link type="primary" @click="loadBills">重试</el-button>
          </MidlongNotice>
          <el-table v-else :data="bills" border size="small" v-loading="billsLoading" @row-click="(row: BillSummaryRow) => Object.assign(billDrawer, { open: true, billId: row.id })">
            <el-table-column label="账单" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
            <el-table-column label="形态" width="150">
              <template #default="{ row }">
                <el-tag size="small" :type="billKindTag(row.billKind).type">{{ billKindTag(row.billKind).label }}</el-tag>
                <el-tag v-if="row.revisionCount > 1" size="small" type="warning" effect="plain" data-test="bill-revised-tag">已修订</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源 / 外部编号" min-width="180"><template #default="{ row }"><span class="ml-mono">{{ row.sourceNamespace }} / {{ row.externalBillNo }}</span></template></el-table-column>
            <el-table-column label="交易主体" width="140"><template #default="{ row }">{{ row.subjectName ?? `主体 #${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="期间" width="130"><template #default="{ row }">{{ billPeriodLabel(row.periodStartMonth, row.periodEndMonth) }}</template></el-table-column>
            <el-table-column label="当前版本金额" width="150" align="right"><template #default="{ row }">{{ row.billKind === 'UNITEMIZED' ? `${fmtAmount(row.amount)} 元（未分项）` : `${fmtAmount(row.lineItemAmount ?? row.amount)} 元` }}</template></el-table-column>
            <el-table-column label="收款凭证" width="160"><template #default="{ row }">{{ voucherText(row) }}</template></el-table-column>
            <el-table-column label="差异" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.openDiscrepancyCount" size="small" type="warning">待处理 {{ row.openDiscrepancyCount }}</el-tag>
                <el-tag v-if="row.recheckDiscrepancyCount" size="small" type="danger">需重核 {{ row.recheckDiscrepancyCount }}</el-tag>
                <span v-if="!row.openDiscrepancyCount && !row.recheckDiscrepancyCount" class="ml-muted">—</span>
              </template>
            </el-table-column>
            <template #empty>尚未登记外部账单。</template>
          </el-table>
          <el-pagination
            v-if="billsTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="billsTotal" :page-size="PAGE_SIZE"
            :current-page="billFilters.page" @current-change="changeBillPage"
          />
        </el-tab-pane>

        <el-tab-pane label="差异台账" name="discrepancies">
          <div class="ml-filters">
            <el-select v-model="discrepancyFilters.subjectId" filterable clearable placeholder="交易主体" style="width: 190px" data-test="discrepancy-subject-filter">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
            </el-select>
            <el-select v-model="discrepancyFilters.status" clearable placeholder="状态" style="width: 210px" data-test="discrepancy-status-filter">
              <el-option v-for="s in DISCREPANCY_STATUSES" :key="s" :label="DISCREPANCY_STATUS_LABELS[s]" :value="s" />
            </el-select>
            <el-date-picker v-model="discrepancyFilters.month" type="month" value-format="YYYY-MM" placeholder="交割月" style="width: 140px" data-test="discrepancy-month-filter" />
            <el-button type="primary" @click="search">查询</el-button>
            <el-button v-if="canWrite" type="primary" data-test="register-discrepancy" @click="discrepancyDialog = true">登记差异</el-button>
            <el-button :loading="exporting === 'discrepancies'" data-test="export-discrepancies" @click="exportCurrent('discrepancies')">导出台账</el-button>
          </div>
          <MidlongNotice v-if="discrepanciesError" tone="danger" title="差异列表加载失败" data-test="discrepancies-error">
            {{ discrepanciesError }} <el-button link type="primary" @click="loadDiscrepancies">重试</el-button>
          </MidlongNotice>
          <el-table v-else :data="discrepancies" border size="small" v-loading="discrepanciesLoading" @row-click="(row: DiscrepancySummaryRow) => Object.assign(discrepancyDrawer, { open: true, discrepancyId: row.id })">
            <el-table-column label="差异" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
            <el-table-column label="状态" width="190"><template #default="{ row }"><el-tag size="small" :type="discrepancyStatusTag(row.status).type">{{ discrepancyStatusTag(row.status).label }}</el-tag></template></el-table-column>
            <el-table-column label="交易主体" width="140"><template #default="{ row }">{{ row.subjectName ?? `主体 #${row.subjectId}` }}</template></el-table-column>
            <el-table-column label="交割月" width="100"><template #default="{ row }">{{ row.deliveryMonth ?? '未知' }}</template></el-table-column>
            <el-table-column label="比对账单" width="150"><template #default="{ row }">#{{ row.billId }} <span class="ml-mono">{{ row.billNo ?? '' }}</span></template></el-table-column>
            <el-table-column label="量差（外部−台账）" width="150" align="right"><template #default="{ row }">{{ signedDeltaLabel(row.quantityDelta) }}</template></el-table-column>
            <el-table-column label="价差" width="170"><template #default="{ row }">{{ row.priceComparable ? signedDeltaLabel(row.priceDelta, '元/MWh') : '不可比（只核对电量）' }}</template></el-table-column>
            <el-table-column label="负责人" width="110"><template #default="{ row }">{{ row.ownerName ?? '未指定' }}</template></el-table-column>
            <el-table-column label="登记" width="150"><template #default="{ row }">{{ beijingDateTime(row.createdAt) }}</template></el-table-column>
            <template #empty>尚未登记差异（台账与账单分项可比时才可登记；一致时服务端拒绝空差异）。</template>
          </el-table>
          <el-pagination
            v-if="discrepanciesTotal > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="discrepanciesTotal" :page-size="PAGE_SIZE"
            :current-page="discrepancyFilters.page" @current-change="changeDiscrepancyPage"
          />
        </el-tab-pane>
      </el-tabs>
    </template>

    <BillFormDialog v-if="billDialog" v-model="billDialog" :subjects="subjects" @saved="() => { void loadBills(); void loadDiscrepancies() }" />
    <BillDetailDrawer v-model="billDrawer.open" :bill-id="billDrawer.billId" :can-write="canWrite" :subjects="subjects" @changed="() => { void loadBills(); void loadDiscrepancies() }" />
    <DiscrepancyFormDialog v-if="discrepancyDialog" v-model="discrepancyDialog" :subjects="subjects" @saved="loadDiscrepancies" />
    <DiscrepancyDetailDrawer v-model="discrepancyDrawer.open" :discrepancy-id="discrepancyDrawer.discrepancyId" :can-write="canWrite" @changed="loadDiscrepancies" />
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.ml-mono { font-family: var(--font-mono, monospace); }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
.ml-pagination { margin-top: 10px; justify-content: flex-end; }
</style>
