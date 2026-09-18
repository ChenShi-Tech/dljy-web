<script setup lang="ts">
// 中长期售电合同列表（/zcqjy/contracts，dljy#2939，MC-01..06 / MW-02..04）。
// - 筛选、分页、统计、导出全部在服务端完成：统计与导出覆盖整个筛选集，不随当前页丢量。
// - 导出用「加载当前结果时的查询快照」：改了筛选没点「查询」时，导出的文件仍与页面所见一致（dljy#2983）。
// - 三维状态分开呈现：确认状态 / 交割进度（按北京时间日期派生，结束 ≠ 逾期）/ 质量缺口（可并存）。
// - 切换公司或地区时，旧请求迟到返回一律丢弃（MW-03）；无权限、未开通、无数据、服务失败分别提示。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import MidlongContractFormDialog from '@/components/midlong/MidlongContractFormDialog.vue'
import MidlongImportDialog from '@/components/midlong/MidlongImportDialog.vue'
import MidlongSubjectDialog from '@/components/midlong/MidlongSubjectDialog.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'
import { currentRegion } from '@/services/region/regionContext'
import {
  CompanyNotSelectedError, exportContracts, fetchCapabilities, fetchContracts, fetchSubjects, midlongFailureOf,
} from '@/services/midlong/midlongApi'
import {
  CONFIRMATION_STATUSES, CONFIRMATION_STATUS_LABELS, DELIVERY_PROGRESS_LABELS, DELIVERY_PROGRESS_VALUES, DOCUMENT_KIND_LABELS,
  ENERGY_ATTRIBUTES, ENERGY_ATTRIBUTE_LABELS, PRODUCT_KINDS, PRODUCT_KIND_LABELS, QUALITY_FLAGS, QUALITY_FLAG_LABELS, TRADE_METHODS,
  TRADE_METHOD_LABELS,
  type MidlongCapabilities, type MidlongContractListResult, type MidlongContractQuery, type MidlongSubject,
} from '@/services/midlong/midlongTypes'
import { confirmationTag, createLoadGuard, downloadCsv, fmtPrice, fmtQuantity, progressTag, qualityTags } from '@/services/midlong/midlongFormat'

const route = useRoute()
const router = useRouter()

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'denied' | 'failed'
const state = ref<LoadState>('loading')
const failure = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const result = ref<MidlongContractListResult | null>(null)
// 当前结果对应的查询快照：与 result 同生共死（同一时刻写入、清空时机一致），供导出使用（dljy#2983）。
const appliedQuery = ref<MidlongContractQuery | null>(null)
const subjects = ref<MidlongSubject[]>([])
const stations = ref<CompanyStation[]>([])
const exporting = ref(false)
const dialogs = reactive({ form: false, import: false, subjects: false })

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = reactive({
  keyword: q('keyword'),
  deliveryRange: (q('deliveryFrom') && q('deliveryTo') ? [q('deliveryFrom'), q('deliveryTo')] : []) as string[],
  confirmationStatus: q('confirmationStatus'),
  deliveryProgress: q('deliveryProgress'),
  qualityFlag: q('qualityFlag'),
  productKind: q('productKind'),
  tradeMethod: q('tradeMethod'),
  energyAttribute: q('energyAttribute'),
  subjectId: q('subjectId'),
  stationId: q('stationId'),
  frameworkContractId: q('frameworkContractId'),
})
const page = ref(Number(q('page')) || 1)
const pageSize = ref(20)

const query = computed<MidlongContractQuery>(() => {
  const out: MidlongContractQuery = { page: page.value, pageSize: pageSize.value }
  if (filters.keyword.trim()) out.keyword = filters.keyword.trim()
  if (filters.deliveryRange.length === 2) { out.deliveryFrom = filters.deliveryRange[0]; out.deliveryTo = filters.deliveryRange[1] }
  if (filters.confirmationStatus) out.confirmationStatus = filters.confirmationStatus
  if (filters.deliveryProgress) out.deliveryProgress = filters.deliveryProgress as MidlongContractQuery['deliveryProgress']
  if (filters.qualityFlag) out.qualityFlag = filters.qualityFlag as MidlongContractQuery['qualityFlag']
  if (filters.productKind) out.productKind = filters.productKind as MidlongContractQuery['productKind']
  if (filters.tradeMethod) out.tradeMethod = filters.tradeMethod as MidlongContractQuery['tradeMethod']
  if (filters.energyAttribute) out.energyAttribute = filters.energyAttribute as MidlongContractQuery['energyAttribute']
  if (filters.subjectId) out.subjectId = filters.subjectId
  if (filters.stationId) out.stationId = filters.stationId
  if (filters.frameworkContractId) out.frameworkContractId = filters.frameworkContractId
  return out
})

const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${JSON.stringify(query.value)}`
// 公司/地区范围：换了范围就先清掉上一范围的合同，加载期间不在新公司的范围栏下继续显示旧公司的数据；
// 同一范围内翻页或改筛选仍保留旧结果直到新结果返回。
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
let loadedScope = ''

async function load() {
  const token = guard.begin(contextKey())
  if (scopeKey() !== loadedScope) { result.value = null; appliedQuery.value = null }
  loadedScope = scopeKey()
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    // 发请求时先快照本次实际用的查询；确认仍是当前请求、与结果同一时刻生效，迟到或失败的请求不更新快照。
    const snapshot = query.value
    const [list, subjectRows, stationRows] = await Promise.all([fetchContracts(query.value), fetchSubjects(), fetchStations()])
    if (!guard.isCurrent(token, contextKey())) return
    result.value = list
    appliedQuery.value = snapshot
    subjects.value = subjectRows
    stations.value = stationRows
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    result.value = null
    appliedQuery.value = null
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 403 || f.status === 401 ? 'denied' : 'failed'
    failure.value = f.message
  }
}

function syncUrl() {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(query.value)) if (v !== undefined && v !== '' && !(k === 'pageSize')) next[k] = String(v)
  if (next.page === '1') delete next.page
  void router.replace({ query: next })
}

function applyFilters() {
  page.value = 1
  syncUrl()
  void load()
}

function resetFilters() {
  Object.assign(filters, { keyword: '', deliveryRange: [], confirmationStatus: '', deliveryProgress: '', qualityFlag: '', productKind: '', tradeMethod: '', energyAttribute: '', subjectId: '', stationId: '', frameworkContractId: '' })
  applyFilters()
}

function quickFilter(status: string, flag = '') {
  filters.confirmationStatus = status
  filters.qualityFlag = flag
  applyFilters()
}

function onPage(p: number) {
  page.value = p
  syncUrl()
  void load()
}

async function doExport() {
  // 导出用加载当前结果时的快照，不用筛选控件实时值（dljy#2983）；正常路径导出按钮只在有结果时可见，这里兜底提示。
  const applied = appliedQuery.value
  if (!applied) { ElMessage.warning('请先查询出结果，再导出'); return }
  exporting.value = true
  const scope = scopeKey()
  try {
    const { page: _p, pageSize: _s, ...rest } = applied
    const file = await exportContracts(rest)
    // 导出返回前切换了公司/地区：丢弃旧范围的文件，不在新范围下载或提示旧公司的行数。
    if (scope !== scopeKey()) { ElMessage.warning('公司或地区已切换，已丢弃切换前发起的导出'); return }
    downloadCsv(file.fileName, file.content)
    ElMessage.success(`已导出筛选范围内全部 ${file.rowCount} 份合同`)
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  } finally {
    exporting.value = false
  }
}

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const stationName = (id: number | null) => (id ? stations.value.find((s) => s.id === id)?.name ?? `#${id}` : '未分配')
const isTestData = (ns: string) => /^TEST/i.test(ns)
const hasTestData = computed(() => (result.value?.rows ?? []).some((r) => isTestData(r.sourceNamespace)))

onMounted(load)
// 交易主体、场站、框架协议的编号只在所属公司/地区内有意义：切换后清掉这些筛选并同步地址栏，
// 否则新公司会被旧编号筛成「没有合同」，或误筛到恰好复用同一编号的对象。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  filters.subjectId = ''
  filters.stationId = ''
  filters.frameworkContractId = ''
  page.value = 1
  syncUrl()
  void load()
})
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <h2 class="ml-title">中长期售电合同</h2>
      <span class="ml-sub">云南试点 · 电源侧售电 · 只含中长期合同（不含现货与零售）</span>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !result" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司，请在上方公司切换器中选择本地区公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">
      {{ capabilities?.reason }}。P1 仅开通云南；其他地区不回退读取任何地区的合同数据。原「公司管理 › 合同管理」入口不受影响。
    </MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">中长期售电模块已由管理员暂停；已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'denied'" tone="danger" title="无权访问">{{ failure }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="合同数据加载失败（未显示任何替代数据）">
      {{ failure }} <el-button link type="primary" @click="load">重试</el-button>
    </MidlongNotice>

    <template v-if="result && (state === 'ready' || state === 'loading')">
      <div class="ml-tiles">
        <button class="ml-tile" type="button" @click="quickFilter('')"><span>筛选范围合同</span><b>{{ result.stats.total }}</b><small>框架协议 {{ result.stats.frameworkCount }}</small></button>
        <button class="ml-tile warn" type="button" @click="quickFilter('PENDING_VERIFICATION')"><span>待核对</span><b>{{ result.stats.byStatus.PENDING_VERIFICATION }}</b><small>核验确认后计入持仓</small></button>
        <button class="ml-tile" type="button" @click="quickFilter('DRAFT')"><span>草稿</span><b>{{ result.stats.byStatus.DRAFT }}</b><small>未确认</small></button>
        <button class="ml-tile ok" type="button" @click="quickFilter('CONFIRMED')"><span>已确认电量合同</span><b>{{ fmtQuantity(result.stats.confirmedObligationQuantity) }}<i>MWh</i></b><small>{{ result.stats.byStatus.CONFIRMED }} 份</small></button>
        <!-- 质量缺口有多种类型，没有「任一缺口」的聚合筛选：这张卡只展示数量，按类型查看用上方「质量缺口」筛选。 -->
        <div class="ml-tile static"><span>有质量缺口</span><b>{{ result.stats.withQualityGaps }}</b><small>按类型查看请用「质量缺口」筛选</small></div>
      </div>

      <MidlongNotice tone="info">
        交割期已结束只表示日期已过，不代表逾期、违约或已结清；列表电量为当前版本合同电量，月度持仓以已确认版本的正式月分解为准。
      </MidlongNotice>
      <MidlongNotice v-if="hasTestData" tone="warn" title="当前列表含测试数据">来源以 TEST 开头的合同是工程测试夹具，不代表真实合同，不作为业务验收依据。</MidlongNotice>

      <div class="ml-toolbar">
        <template v-if="canWrite">
          <el-button type="primary" @click="dialogs.form = true">录入合同草稿</el-button>
          <el-button @click="dialogs.import = true">导入合同</el-button>
        </template>
        <el-button @click="dialogs.subjects = true">交易主体</el-button>
        <el-button :loading="exporting" @click="doExport">导出筛选结果</el-button>
        <router-link to="/zcqjy/positions" class="ml-link">查看月度持仓 →</router-link>
        <span v-if="!canWrite" class="ml-muted">只读：当前角色无公司合同写入权限</span>
      </div>

      <div class="ml-filters">
        <el-input v-model="filters.keyword" placeholder="名称 / 外部编号" clearable style="width: 200px" @keyup.enter="applyFilters" />
        <el-date-picker v-model="filters.deliveryRange" type="monthrange" value-format="YYYY-MM" range-separator="至" start-placeholder="交割月起" end-placeholder="交割月止" style="width: 240px" />
        <el-select v-model="filters.confirmationStatus" placeholder="确认状态" clearable style="width: 120px">
          <el-option v-for="s in CONFIRMATION_STATUSES" :key="s" :label="CONFIRMATION_STATUS_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.deliveryProgress" placeholder="交割进度" clearable style="width: 130px">
          <el-option v-for="s in DELIVERY_PROGRESS_VALUES" :key="s" :label="DELIVERY_PROGRESS_LABELS[s]" :value="s" />
        </el-select>
        <el-select v-model="filters.qualityFlag" placeholder="质量缺口" clearable style="width: 160px">
          <el-option v-for="f in QUALITY_FLAGS" :key="f" :label="QUALITY_FLAG_LABELS[f]" :value="f" />
        </el-select>
        <el-select v-model="filters.productKind" placeholder="品种周期" clearable style="width: 110px">
          <el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="filters.tradeMethod" placeholder="交易方式" clearable style="width: 120px">
          <el-option v-for="k in TRADE_METHODS" :key="k" :label="TRADE_METHOD_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="filters.energyAttribute" placeholder="电能属性" clearable style="width: 110px">
          <el-option v-for="k in ENERGY_ATTRIBUTES" :key="k" :label="ENERGY_ATTRIBUTE_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="filters.subjectId" placeholder="交易主体" clearable filterable style="width: 150px">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="String(s.id)" />
        </el-select>
        <el-select v-model="filters.stationId" placeholder="场站" clearable filterable style="width: 140px">
          <el-option label="未分配场站" value="UNALLOCATED" />
          <el-option v-for="s in stations" :key="s.id" :label="s.name" :value="String(s.id)" />
        </el-select>
        <el-tag v-if="filters.frameworkContractId" closable data-testid="ml-framework-filter" @close="filters.frameworkContractId = ''; applyFilters()">框架协议 #{{ filters.frameworkContractId }} 下的合同</el-tag>
        <el-button type="primary" @click="applyFilters">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <el-table v-loading="state === 'loading'" :data="result.rows" border stripe row-key="contractId">
        <el-table-column label="外部编号" min-width="150">
          <template #default="{ row }">
            <router-link :to="{ path: `/zcqjy/contracts/${row.contractId}`, query: route.query }" class="ml-link">{{ row.externalContractNo }}</router-link>
            <el-tag v-if="isTestData(row.sourceNamespace)" size="small" type="warning" effect="plain" class="ml-gap">测试数据</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="contractName" label="合同名称" min-width="190" show-overflow-tooltip />
        <el-table-column label="分类" width="170">
          <template #default="{ row }">
            <div class="ml-cell-stack">
              <span>{{ DOCUMENT_KIND_LABELS[row.documentKind as keyof typeof DOCUMENT_KIND_LABELS] }} · {{ row.productKind ? PRODUCT_KIND_LABELS[row.productKind as keyof typeof PRODUCT_KIND_LABELS] : '—' }}</span>
              <small>{{ row.tradeMethod ? TRADE_METHOD_LABELS[row.tradeMethod as keyof typeof TRADE_METHOD_LABELS] : '交易方式待核对' }} · {{ row.energyAttribute ? ENERGY_ATTRIBUTE_LABELS[row.energyAttribute as keyof typeof ENERGY_ATTRIBUTE_LABELS] : '—' }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="主体 / 场站" min-width="150">
          <template #default="{ row }">
            <div class="ml-cell-stack"><span>{{ row.subjectName ?? '主体待补' }}</span><small>{{ stationName(row.stationId) }}</small></div>
          </template>
        </el-table-column>
        <el-table-column label="交割期" width="200">
          <template #default="{ row }">
            <div class="ml-cell-stack">
              <span>{{ row.current.deliveryStart ?? '—' }} ~ {{ row.current.deliveryEnd ?? '—' }}</span>
              <el-tag size="small" :type="progressTag(row.deliveryProgress).type" effect="plain">{{ progressTag(row.deliveryProgress).label }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="确认状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="confirmationTag(row.confirmationStatus).type">{{ confirmationTag(row.confirmationStatus).label }}</el-tag>
            <div class="ml-muted">版本 {{ row.currentRevisionNo }}</div>
          </template>
        </el-table-column>
        <el-table-column label="合同电量(MWh)" width="130" align="right">
          <template #default="{ row }">{{ fmtQuantity(row.current.totalQuantity) }}</template>
        </el-table-column>
        <el-table-column label="售电价(元/MWh)" width="120" align="right">
          <template #default="{ row }">{{ row.current.priceStatus === 'KNOWN' ? fmtPrice(row.current.sellerPrice) : '待核对' }}</template>
        </el-table-column>
        <el-table-column label="质量缺口" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="t in qualityTags(row.qualityFlags)" :key="t.flag" size="small" :type="t.type" effect="plain" class="ml-gap">{{ t.label }}</el-tag>
            <span v-if="!row.qualityFlags.length" class="ml-muted">无</span>
          </template>
        </el-table-column>
        <el-table-column prop="sourceNamespace" label="来源" width="120" show-overflow-tooltip />
        <template #empty>
          <div class="ml-empty">当前筛选下没有合同。{{ canWrite ? '可录入草稿或导入标准模板。' : '' }}</div>
        </template>
      </el-table>
      <el-pagination class="ml-pager" layout="total, prev, pager, next" :total="result.total" :page-size="pageSize" :current-page="page" @current-change="onPage" />
    </template>

    <MidlongContractFormDialog v-model="dialogs.form" :subjects="subjects" :stations="stations" @saved="(id: number) => router.push(`/zcqjy/contracts/${id}`)" />
    <MidlongImportDialog v-model="dialogs.import" @committed="load" />
    <MidlongSubjectDialog v-model="dialogs.subjects" :subjects="subjects" :stations="stations" :can-write="canWrite" @created="load" />
  </div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ml-title { margin: 0; font-size: var(--font-20); }
.ml-sub { color: var(--muted); font-size: var(--font-md); }
.ml-placeholder { min-height: 200px; }
.ml-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.ml-tile {
  text-align: left; cursor: pointer; font: inherit; color: inherit; display: flex; flex-direction: column; gap: 3px;
  padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius, 8px); background: var(--panel);
}
.ml-tile:hover { border-color: var(--accent); }
.ml-tile.static { cursor: default; }
.ml-tile.static:hover { border-color: var(--line); }
.ml-tile span { font-size: var(--font-sm); color: var(--muted); }
.ml-tile b { font-size: var(--font-24); font-weight: 650; font-variant-numeric: tabular-nums; font-family: var(--font-display); }
.ml-tile b i { font-style: normal; font-size: var(--font-sm); color: var(--muted); margin-left: 4px; font-weight: 500; }
.ml-tile small { font-size: var(--font-xs); color: var(--muted); }
.ml-tile.ok b { color: var(--success); }
.ml-tile.warn b { color: var(--warning); }
.ml-toolbar, .ml-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
.ml-gap { margin: 2px 4px 2px 0; }
.ml-cell-stack { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.ml-cell-stack small { color: var(--muted); font-size: var(--font-sm); }
.ml-empty { padding: 24px 0; color: var(--muted); }
.ml-pager { justify-content: flex-end; }
@media (max-width: 1100px) { .ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
