<script setup lang="ts">
// 中长期合同调整（建议路由 /zcqjy/adjustments，dljy#3014，MA-01..05；路由/导航由主执行者注册，本组件只导出）。
// 全部调整列表：状态（待生效/待核对/已生效）、类型、方向、待核对筛选；登记调整（选合同）、详情抽屉、映射登记入口。
// 合同详情页的「合同调整」区块复用同一组组件；该页是跨合同的总视图。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import AdjustmentFormDialog from '@/components/midlong/p4/AdjustmentFormDialog.vue'
import AdjustmentDetailDrawer from '@/components/midlong/p4/AdjustmentDetailDrawer.vue'
import AdjustmentMappingDialog from '@/components/midlong/p4/AdjustmentMappingDialog.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { CompanyNotSelectedError, fetchCapabilities, fetchContracts, midlongFailureOf } from '@/services/midlong/midlongApi'
import { fetchAdjustments, p4ModuleOn } from '@/services/midlong/midlongP4Api'
import { createLoadGuard, fmtQuantity } from '@/services/midlong/midlongFormat'
import { adjustmentStatusTag, adjustmentTypeLabel, directionLabel, signedDeltaLabel } from '@/services/midlong/midlongP4Format'
import { ADJUSTMENT_STATUSES, ADJUSTMENT_STATUS_LABELS, ADJUSTMENT_TYPES, ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_NOTICES, type AdjustmentStatus, type AdjustmentSummaryRow, type AdjustmentType } from '@/services/midlong/midlongP4Types'
import type { MidlongCapabilities, MidlongContractSummary } from '@/services/midlong/midlongTypes'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'module-off' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const PAGE_SIZE = 50
const rows = ref<AdjustmentSummaryRow[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
// 登记对话框的合同候选：已核验确认的合同才能调整（服务端同样校验，这里只做候选过滤的展示）。
const contracts = ref<MidlongContractSummary[]>([])
const contractsLoading = ref(false)

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = reactive({
  status: q('status') as AdjustmentStatus | '',
  adjustmentType: q('adjustmentType') as AdjustmentType | '',
  pendingDirectionOnly: q('pendingDirection') === 'true',
  page: Math.max(1, Number(q('page')) || 1),
})
const filterKey = () => JSON.stringify([filters.status, filters.adjustmentType, filters.pendingDirectionOnly])
let lastFilterKey = filterKey()

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const pageGuard = createLoadGuard()
const listGuard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function loadList() {
  if (filterKey() !== lastFilterKey) filters.page = 1
  lastFilterKey = filterKey()
  const key = `${scopeKey()}|${filterKey()}|${filters.page}`
  const token = listGuard.begin(key)
  loading.value = true
  loadError.value = ''
  try {
    const page = await fetchAdjustments({
      page: filters.page, pageSize: PAGE_SIZE,
      status: filters.status || undefined,
      adjustmentType: filters.adjustmentType || undefined,
      pendingDirection: filters.pendingDirectionOnly ? true : undefined,
    })
    if (!listGuard.isCurrent(token, key)) return
    rows.value = page.rows
    total.value = page.total
  } catch (error) {
    if (!listGuard.isCurrent(token, key)) return
    rows.value = []
    total.value = 0
    loadError.value = midlongFailureOf(error).message
  } finally {
    if (listGuard.isCurrent(token, key)) loading.value = false
  }
}

async function load() {
  const key = scopeKey()
  const token = pageGuard.begin(key)
  if (key !== loadedScope) { rows.value = []; total.value = 0; contracts.value = [] }
  loadedScope = key
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!pageGuard.isCurrent(token, scopeKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    if (!p4ModuleOn(caps, 'adjustments')) { state.value = 'module-off'; return }
    state.value = 'ready'
  } catch (error) {
    if (!pageGuard.isCurrent(token, scopeKey())) return
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 401 || f.status === 403 ? 'denied' : 'failed'
    failureText.value = f.message
    return
  }
  await loadList()
}

function syncRoute() {
  if (filterKey() !== lastFilterKey) filters.page = 1
  const next: Record<string, string> = {}
  if (filters.status) next.status = filters.status
  if (filters.adjustmentType) next.adjustmentType = filters.adjustmentType
  if (filters.pendingDirectionOnly) next.pendingDirection = 'true'
  if (filters.page > 1) next.page = String(filters.page)
  void router.replace({ query: next })
}

function search() {
  syncRoute()
  if (state.value === 'ready') void loadList()
  else void load()
}

function changePage(page: number) {
  filters.page = page
  search()
}

/** 登记调整：逐页取已核验确认的合同作候选（未确认合同服务端会拒绝调整，不在候选里误导）。 */
async function loadContractCandidates(): Promise<MidlongContractSummary[]> {
  const collected: MidlongContractSummary[] = []
  for (let page = 1; ; page += 1) {
    const result = await fetchContracts({ page, pageSize: 100, confirmationStatus: 'CONFIRMED' })
    collected.push(...result.rows)
    if (!result.rows.length || collected.length >= result.total) return collected
  }
}

const registerDialog = ref(false)
const formDialog = ref(false)
const registerContract = ref<MidlongContractSummary | null>(null)
async function openRegister() {
  if (contractsLoading.value) return
  contractsLoading.value = true
  try {
    contracts.value = await loadContractCandidates()
  } catch (error) {
    if (selectedCompanyId.value) ElMessage.warning(`合同候选加载失败：${midlongFailureOf(error).message}`)
  } finally {
    contractsLoading.value = false
  }
  registerDialog.value = true
}
function pickContract(id: number | null) {
  registerContract.value = contracts.value.find((c) => c.contractId === id) ?? null
}

const drawer = reactive({ open: false, adjustmentId: null as number | null })
function openAdjustment(id: number) {
  Object.assign(drawer, { open: true, adjustmentId: id })
}
const mappingDialog = ref(false)

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  drawer.open = false
  registerDialog.value = false
  mappingDialog.value = false
  Object.assign(filters, { page: 1 })
  lastFilterKey = filterKey()
  void load()
})

const registerContractId = computed(() => registerContract.value?.contractId ?? contracts.value[0]?.contractId ?? 0)
const registerContractLabel = computed(() => {
  const c = registerContract.value ?? contracts.value[0]
  return c ? `${c.contractName ?? `合同 #${c.contractId}`}（${c.externalContractNo ?? '编号待补'}）` : ''
})
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">合同调整</h2>
      <span class="ml-sub">外部调整 · 转让 · 部分终止（与录入更正分开；只改指定交割片段，不按比例缩小）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading'" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}。不回退读取其他地区数据。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'module-off'" tone="info" title="合同调整功能尚未开放">当前环境未开放调整登记功能。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failureText }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="调整数据加载失败（未显示任何替代数值）">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="state === 'ready'">
      <div class="ml-filters">
        <el-select v-model="filters.status" placeholder="状态" clearable style="width: 160px" data-test="status-filter">
          <el-option v-for="s in ADJUSTMENT_STATUSES" :key="s" :label="ADJUSTMENT_STATUS_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.adjustmentType" placeholder="类型" clearable style="width: 130px" data-test="type-filter">
          <el-option v-for="t in ADJUSTMENT_TYPES" :key="t" :label="ADJUSTMENT_TYPE_LABELS[t]" :value="t" />
        </el-select>
        <el-checkbox v-model="filters.pendingDirectionOnly" data-test="pending-direction-filter">只看方向待核对</el-checkbox>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button v-if="canWrite" type="primary" :loading="contractsLoading" data-test="register-adjustment" @click="openRegister">登记调整</el-button>
        <el-button v-if="canWrite" plain :loading="contractsLoading" data-test="open-mapping" @click="mappingDialog = true">产品映射登记</el-button>
      </div>
      <MidlongNotice tone="info" title="调整口径">
        {{ ADJUSTMENT_NOTICES.directionNoInference }} {{ ADJUSTMENT_NOTICES.priceIndependent }} {{ ADJUSTMENT_NOTICES.adjustableBalance }}
      </MidlongNotice>
      <MidlongNotice v-if="loadError" tone="danger" title="调整列表加载失败" data-test="adjustments-error">
        {{ loadError }} <el-button link type="primary" @click="loadList">重试</el-button>
      </MidlongNotice>
      <el-table :data="rows" border size="small" @row-click="(row: AdjustmentSummaryRow) => openAdjustment(row.id)">
        <el-table-column label="调整" width="80"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="adjustmentStatusTag(row.status).type">{{ adjustmentStatusTag(row.status).label }}</el-tag>
            <el-tag v-if="row.pendingReason" size="small" type="danger" effect="plain">方向待核对</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100"><template #default="{ row }">{{ adjustmentTypeLabel(row.adjustmentType) }}</template></el-table-column>
        <el-table-column label="我方义务方向" width="130"><template #default="{ row }">{{ directionLabel(row.direction) }}</template></el-table-column>
        <el-table-column label="合同" min-width="200">
          <template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link" @click.stop>{{ row.contractName ?? `合同 #${row.contractId}` }}</router-link> <span class="ml-mono ml-muted">{{ row.contractNo ?? '' }}</span></template>
        </el-table-column>
        <el-table-column label="来源 / 外部编号" min-width="180"><template #default="{ row }"><span class="ml-mono">{{ row.sourceNamespace }} / {{ row.externalAdjustmentNo }} r{{ row.externalRevisionNo }}</span></template></el-table-column>
        <el-table-column label="变化量合计(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
        <el-table-column label="生效结果" width="180">
          <template #default="{ row }">
            <template v-if="row.effective">合同 v{{ row.effective.contractRevisionNo }} · {{ signedDeltaLabel(row.effective.totalDelta) }}</template>
            <span v-else class="ml-muted">{{ row.status === 'PENDING_VERIFICATION' ? '待核对，未生效' : '待确认生效' }}</span>
          </template>
        </el-table-column>
        <template #empty>尚未登记合同调整。</template>
      </el-table>
      <el-pagination
        v-if="total > PAGE_SIZE" class="ml-pagination" layout="total, prev, pager, next" :total="total" :page-size="PAGE_SIZE"
        :current-page="filters.page" @current-change="changePage"
      />
    </template>

    <el-dialog v-model="registerDialog" title="选择要调整的合同" width="560px" append-to-body>
      <MidlongNotice tone="info">只能调整已核验确认的合同；未确认合同请直接修改草稿（候选已按此过滤，服务端同样校验）。</MidlongNotice>
      <el-select
        :model-value="registerContractId || undefined" filterable placeholder="选择合同" style="width: 100%" data-test="contract-select"
        @update:model-value="(v: number) => pickContract(v)"
      >
        <el-option v-for="c in contracts" :key="c.contractId" :label="`${c.contractName ?? `合同 #${c.contractId}`}（${c.externalContractNo ?? '编号待补'}）`" :value="c.contractId" />
      </el-select>
      <template #footer>
        <el-button @click="registerDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!registerContractId" data-test="open-adjustment-form" @click="registerDialog = false; formDialog = true">下一步</el-button>
      </template>
    </el-dialog>
    <AdjustmentFormDialog
      v-if="formDialog" v-model="formDialog" :contract-id="registerContractId" :contract-label="registerContractLabel" @saved="loadList"
    />
    <AdjustmentDetailDrawer v-model="drawer.open" :adjustment-id="drawer.adjustmentId" :can-write="canWrite" @changed="loadList" />
    <AdjustmentMappingDialog v-model="mappingDialog" />
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
.ml-mono { font-family: var(--font-mono, monospace); }
.ml-pagination { margin-top: 10px; justify-content: flex-end; }
</style>
