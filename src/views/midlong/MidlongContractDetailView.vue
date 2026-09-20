<script setup lang="ts">
// 中长期售电合同详情（/zcqjy/contracts/:id，dljy#2939，MC-03..06 / MA-01/04；P4 合同调整区块 dljy#3014，MA-01..05）。
// 原始量与当前有效量、月度分解、版本历史、资料、事件分区展示；操作按确认状态开放：
// 草稿/待核对 → 修改、补资料、核验确认；已确认 → 录入更正（生成新版本）、整笔纠错作废；不提供物理删除。
// P4 起：已确认合同的「外部调整/转让/部分终止」在「合同调整」区块登记（与录入更正分开），
// 版本历史里更正与调整产生的版本同一条时间线、都有「影响对比」。
// 所有有状态写入带 rowVersion：他人先改过时提示刷新核对差异，不静默覆盖。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { currentRegion } from '@/services/region/regionContext'
import {
  CompanyNotSelectedError, addEvidence, correctContract, fetchCapabilities, fetchContract, fetchEvidenceContent, fetchSubjects,
  linkAlias, midlongFailureOf, putContractLabels, verifyContract, voidContract, type EvidenceUpload, type MidlongFailure,
} from '@/services/midlong/midlongApi'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import MidlongNotice from '@/components/midlong/MidlongNotice.vue'
import MidlongContractFormDialog from '@/components/midlong/MidlongContractFormDialog.vue'
import MidlongEconomicsEditor from '@/components/midlong/MidlongEconomicsEditor.vue'
import MidlongContractCurvesPanel from '@/components/midlong/p2/MidlongContractCurvesPanel.vue'
import MidlongContractStationsPanel from '@/components/midlong/p2/MidlongContractStationsPanel.vue'
import MidlongContractAdjustmentsPanel from '@/components/midlong/p4/MidlongContractAdjustmentsPanel.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'
import { p2ModuleOn } from '@/services/midlong/midlongP2Api'
import { p4ModuleOn } from '@/services/midlong/midlongP4Api'
import {
  DELIVERY_CYCLE_LABELS, DOCUMENT_KIND_LABELS, ENERGY_ATTRIBUTE_LABELS, EVENT_TYPE_LABELS, EVIDENCE_BASIS_LABELS,
  EVIDENCE_DOCUMENT_TYPES, EVIDENCE_DOCUMENT_TYPE_LABELS, MARKET_SCOPE_LABELS, PRICE_COMPONENT_LABELS, PRICE_TYPE_LABELS,
  PRODUCT_KIND_LABELS, REVISION_KIND_LABELS, TAX_BASIS_LABELS, TRADE_METHOD_LABELS, VERIFICATION_EVIDENCE_TYPES,
  type MidlongCapabilities, type MidlongContractDetail, type MidlongRevision, type MidlongSubject,
} from '@/services/midlong/midlongTypes'
import { draftFromRevision, toEconomicsInput, type EconomicsDraft } from '@/services/midlong/economicsDraft'
import {
  confirmationTag, createLoadGuard, downloadBase64, fileToBase64, fmtPrice, fmtQuantity, oversizeUploadMessage, progressTag, qualityTags,
} from '@/services/midlong/midlongFormat'

const route = useRoute()
// 返回列表时带回进入详情时的列表筛选（含旧深链转来的交割期），不丢筛选。
const backToList = computed(() => ({ path: '/zcqjy/contracts', query: route.query }))
const contractId = computed(() => Number(route.params.id))

type LoadState = 'loading' | 'ready' | 'no-company' | 'unsupported' | 'disabled' | 'not-found' | 'failed'
const state = ref<LoadState>('loading')
const failureText = ref('')
const capabilities = ref<MidlongCapabilities | null>(null)
const detail = ref<MidlongContractDetail | null>(null)
const subjects = ref<MidlongSubject[]>([])
const stations = ref<CompanyStation[]>([])
const guard = createLoadGuard()
const contextKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}|${contractId.value}`

// 换了公司/地区/合同就先清掉旧详情，加载期间不在新范围下显示上一份合同。
let loadedKey = ''

async function load() {
  const token = guard.begin(contextKey())
  if (contextKey() !== loadedKey) detail.value = null
  loadedKey = contextKey()
  state.value = 'loading'
  try {
    const caps = await fetchCapabilities()
    if (!guard.isCurrent(token, contextKey())) return
    capabilities.value = caps
    if (!caps.enabled) { state.value = 'disabled'; return }
    if (!caps.regionSupported) { state.value = 'unsupported'; return }
    const [d, subjectRows, stationRows] = await Promise.all([fetchContract(contractId.value), fetchSubjects(), fetchStations()])
    if (!guard.isCurrent(token, contextKey())) return
    detail.value = d
    subjects.value = subjectRows
    stations.value = stationRows
    state.value = 'ready'
  } catch (error) {
    if (!guard.isCurrent(token, contextKey())) return
    detail.value = null
    if (error instanceof CompanyNotSelectedError) { state.value = 'no-company'; return }
    const f = midlongFailureOf(error)
    state.value = f.status === 404 ? 'not-found' : 'failed'
    failureText.value = f.message
  }
}

onMounted(load)
watch([selectedCompanyId, () => currentRegion.value.id, contractId], () => void load())

const canWrite = computed(() => Boolean(capabilities.value?.canWrite))
const status = computed(() => detail.value?.confirmationStatus)
const isEditable = computed(() => status.value === 'DRAFT' || status.value === 'PENDING_VERIFICATION')
const current = computed(() => detail.value?.currentRevision ?? null)
const blockingGaps = computed(() => qualityTags(detail.value?.qualityFlags ?? []).filter((t) => t.blocksVerification))
const hintGaps = computed(() => qualityTags(detail.value?.qualityFlags ?? []).filter((t) => !t.blocksVerification))
const isTestData = computed(() => /^TEST/i.test(detail.value?.sourceNamespace ?? ''))
const stationName = (id: number | null) => (id ? stations.value.find((s) => s.id === id)?.name ?? `#${id}` : '未分配（主体统签）')
const subjectLabel = computed(() => {
  const d = detail.value
  if (!d?.subjectId) return '待补'
  return `${d.subjectName}（${d.subjectKey}${d.subjectUnitCode ? ` · 单元 ${d.subjectUnitCode}` : ' · 单元代码待补'}）`
})
const releasedAliases = computed(() => (detail.value?.aliases ?? []).filter((a) => a.releasedAt))
// P2 分时分解与场站分配（dljy#2971）：能力开关打开且是电量合同时才出现，关闭时不调用对应接口。
const showCurves = computed(() => p2ModuleOn(capabilities.value, 'curves') && detail.value?.documentKind === 'OBLIGATION')
const showStations = computed(() => p2ModuleOn(capabilities.value, 'stationAllocations') && detail.value?.documentKind === 'OBLIGATION')
// P4 合同调整区块（dljy#3014）：adjustments 能力打开即出现（任何确认状态都可看历史，登记入口只对已确认合同开放）。
const showAdjustments = computed(() => p4ModuleOn(capabilities.value, 'adjustments'))
const adjustmentsPanel = ref<InstanceType<typeof MidlongContractAdjustmentsPanel> | null>(null)
const openRevisionImpact = (revisionNo: number) => { adjustmentsPanel.value?.openRevisionImpact(revisionNo) }
const stationOptions = computed(() => stations.value.map((s) => ({ id: s.id, name: s.name ?? `场站 ${s.id}` })))
const evidenceById = computed(() => new Map((detail.value?.evidence ?? []).map((e) => [e.id, e])))

function allocationPrice(rev: MidlongRevision, a: MidlongRevision['allocations'][number]) {
  if (a.priceStatus === 'KNOWN') return `${fmtPrice(a.price)}（月分解）`
  if (rev.priceType !== 'TIME_OF_USE' && rev.priceStatus === 'KNOWN') return `${fmtPrice(rev.sellerPrice)}（合同固定价）`
  return '待核对'
}

// ── 操作对话框 ────────────────────────────────────────────────────────────────
const dialogs = reactive({ form: false, verify: false, correct: false, void: false, alias: false, evidence: false })
const busy = ref(false)
const actionError = ref<MidlongFailure | null>(null)

function openAction(name: keyof typeof dialogs) {
  actionError.value = null
  dialogs[name] = true
}

async function runAction(name: keyof typeof dialogs, action: () => Promise<unknown>, success: string) {
  if (busy.value) return
  busy.value = true
  actionError.value = null
  try {
    await action()
    ElMessage.success(success)
    dialogs[name] = false
    await load()
  } catch (error) {
    actionError.value = midlongFailureOf(error)
  } finally {
    busy.value = false
  }
}

// 核验确认
const verifyForm = reactive({ evidenceIds: [] as number[], note: '' })
const verifiableEvidence = computed(() => (detail.value?.evidence ?? []).filter((e) => VERIFICATION_EVIDENCE_TYPES.includes(e.documentType)))
function openVerify() {
  verifyForm.evidenceIds = verifiableEvidence.value.map((e) => e.id)
  verifyForm.note = ''
  openAction('verify')
}
function submitVerify() {
  const d = detail.value
  if (!d) return
  void runAction('verify', () => verifyContract(d.contractId, { expectedRowVersion: d.rowVersion, evidenceIds: verifyForm.evidenceIds, note: verifyForm.note || undefined }), '已核验确认，合同将按确认版本计入月度持仓')
}

// 录入更正
const correctForm = reactive({ reason: '', evidenceIds: [] as number[], businessEffectiveAt: '' })
const correctEconomics = ref<EconomicsDraft | null>(null)
const correctEditor = ref<InstanceType<typeof MidlongEconomicsEditor> | null>(null)
const correctionEvidence = computed(() => (detail.value?.evidence ?? []).filter((e) => [...VERIFICATION_EVIDENCE_TYPES, 'SUPPLEMENT_SCAN'].includes(e.documentType)))
function openCorrect() {
  if (!current.value) return
  correctEconomics.value = draftFromRevision(current.value)
  Object.assign(correctForm, { reason: '', evidenceIds: [], businessEffectiveAt: '' })
  openAction('correct')
}
// 录入更正纠正的是已发生的事实：生效时间不能晚于当前，未来生效的合同变更属于后续调整功能（服务端同样拒绝）。
const isFutureMoment = (date: Date) => date.getTime() > Date.now()
const correctEffectiveInFuture = computed(() => Boolean(correctForm.businessEffectiveAt) && isFutureMoment(new Date(correctForm.businessEffectiveAt)))
function submitCorrect() {
  const d = detail.value
  const draft = correctEconomics.value
  if (!d || !draft) return
  if (correctEffectiveInFuture.value) {
    actionError.value = { status: 422, errorCode: 'VALIDATION_FAILED', message: '业务生效时间不能晚于当前时间；未来生效的合同变更属于后续调整功能', details: { field: 'businessEffectiveAt' } }
    return
  }
  void runAction('correct', () => correctContract(d.contractId, {
    expectedRowVersion: d.rowVersion, changeType: 'CORRECTION', reason: correctForm.reason.trim(), evidenceIds: correctForm.evidenceIds,
    businessEffectiveAt: correctForm.businessEffectiveAt || null, economics: toEconomicsInput(draft),
  }), '已生成更正版本，原版本保留可查')
}

// 作废
const voidForm = reactive({ reason: '', evidenceIds: [] as number[] })
function openVoid() {
  Object.assign(voidForm, { reason: '', evidenceIds: [] })
  openAction('void')
}
function submitVoid() {
  const d = detail.value
  if (!d) return
  void runAction('void', () => voidContract(d.contractId, { expectedRowVersion: d.rowVersion, reason: voidForm.reason.trim(), evidenceIds: voidForm.evidenceIds }), '合同已作废，历史版本保留')
}

// 关联外部编号
const aliasForm = reactive({ sourceNamespace: '', externalObligationId: '', verificationNote: '' })
function openAlias() {
  Object.assign(aliasForm, { sourceNamespace: '', externalObligationId: '', verificationNote: '' })
  openAction('alias')
}
function submitAlias() {
  const d = detail.value
  if (!d) return
  void runAction('alias', () => linkAlias(d.contractId, { expectedRowVersion: d.rowVersion, ...aliasForm }), '已关联外部编号')
}

// 购方类别标注（build-midlong-spot-hedging 3.3/D3）：分类事实，不进版本与指纹。
const buyerCategoryForm = reactive<{ value: string; rowVersion: number | null }>({ value: 'GRID_AGENCY', rowVersion: null })
const buyerCategoryVisible = ref(false)
const buyerCategorySaving = ref(false)
const BUYER_CATEGORY_OPTIONS = [
  { value: 'GRID_AGENCY', label: '电网代理购电' },
  { value: 'PRIORITY_GENERATION', label: '优先发电计划' },
  { value: 'RETAILER', label: '售电公司' },
  { value: 'END_USER', label: '电力用户' },
  { value: 'INTER_PROVINCIAL_BUYER', label: '省外购方' },
  { value: 'OTHER', label: '其他' },
]
function buyerCategoryLabel(value: string) {
  return BUYER_CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value
}
function openBuyerCategory() {
  const d = detail.value
  if (!d) return
  buyerCategoryForm.value = d.labels?.BUYER_CATEGORY ?? 'GRID_AGENCY'
  // 标注行的 rowVersion 与合同行版本无关：重开对话框不校验直接写（后端省略即直写）；
  // 保存成功后记住返回的 rowVersion，同一会话内的后续提交带它做乐观校验。
  buyerCategoryForm.rowVersion = null
  buyerCategoryVisible.value = true
}
async function submitBuyerCategory() {
  const d = detail.value
  if (!d || buyerCategorySaving.value) return
  buyerCategorySaving.value = true
  try {
    const payload = await putContractLabels(d.contractId, {
      dimension: 'BUYER_CATEGORY',
      value: buyerCategoryForm.value === '' ? null : buyerCategoryForm.value,
      rowVersion: buyerCategoryForm.rowVersion,
    })
    ElMessage.success('购方类别已保存（不产生合同版本）')
    buyerCategoryVisible.value = false
    buyerCategoryForm.rowVersion = payload?.rowVersion ?? null
    await load()
  } catch (err) {
    const failure: MidlongFailure = midlongFailureOf(err)
    if (failure.status === 409) ElMessage.error('标注已被他人更新，请刷新后核对')
    else if (failure.status === 403) ElMessage.error('当前账号无公司写权限，无法修改标注')
    else ElMessage.error(failure.message || '保存失败')
  } finally {
    buyerCategorySaving.value = false
  }
}

// 补充资料
const evidenceForm = reactive({ documentType: 'ELECTRONIC_CONFIRMATION' as EvidenceUpload['documentType'], note: '', file: null as File | null })
const uploadableTypes = EVIDENCE_DOCUMENT_TYPES.filter((t) => t !== 'IMPORT_SOURCE_FILE') as EvidenceUpload['documentType'][]
function openEvidence() {
  Object.assign(evidenceForm, { documentType: 'ELECTRONIC_CONFIRMATION', note: '', file: null })
  openAction('evidence')
}
function onEvidenceFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  const oversize = file ? oversizeUploadMessage(file) : null
  actionError.value = oversize ? { status: 413, errorCode: 'VALIDATION_FAILED', message: oversize, details: null } : null
  if (oversize) input.value = ''
  evidenceForm.file = oversize ? null : file
}
async function submitEvidence() {
  const d = detail.value
  const file = evidenceForm.file
  if (!d || !file) return
  const oversize = oversizeUploadMessage(file)
  if (oversize) {
    actionError.value = { status: 413, errorCode: 'VALIDATION_FAILED', message: oversize, details: null }
    return
  }
  const contentBase64 = await fileToBase64(file)
  void runAction('evidence', () => addEvidence(d.contractId, { fileName: file.name, contentBase64, documentType: evidenceForm.documentType, note: evidenceForm.note || undefined, mediaType: file.type || undefined }), '资料已补充（不改变合同电量）')
}

async function downloadEvidence(evidenceId: number) {
  const d = detail.value
  if (!d) return
  try {
    const { evidence, contentBase64 } = await fetchEvidenceContent(d.contractId, evidenceId)
    downloadBase64(evidence.originalFileName, contentBase64, evidence.mediaType ?? undefined)
  } catch (error) {
    ElMessage.error(`资料读取失败：${midlongFailureOf(error).message}`)
  }
}

const conflictDetails = computed(() => {
  if (actionError.value?.errorCode !== 'VERSION_CONFLICT') return null
  return actionError.value.details as { currentRowVersion?: number; currentRevisionNo?: number } | null
})
const missingBasis = computed(() => (actionError.value?.errorCode === 'INCOMPLETE_BASIS' ? ((actionError.value.details as { missing?: string[] } | null)?.missing ?? []) : []))
</script>

<template>
  <div class="ml-page">
    <div class="ml-head">
      <router-link :to="backToList" class="ml-link">← 售电合同</router-link>
    </div>
    <CompanyScopeBar />

    <div v-if="state === 'loading' && !detail" v-loading="true" class="ml-placeholder" />
    <MidlongNotice v-else-if="state === 'no-company'" tone="warn" title="请选择公司">当前地区尚未选择有效公司。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'unsupported'" tone="info" title="当前地区未开通中长期售电模块">{{ capabilities?.reason }}</MidlongNotice>
    <MidlongNotice v-else-if="state === 'disabled'" tone="warn" title="模块已暂停使用">已确认合同的版本与写保护保持不变。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'not-found'" tone="warn" title="合同不存在或不属于当前公司">请确认公司切换器中的公司，或返回列表重新查找。</MidlongNotice>
    <MidlongNotice v-else-if="state === 'failed'" tone="danger" title="合同加载失败">{{ failureText }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>

    <template v-if="detail && (state === 'ready' || state === 'loading')">
      <div class="ml-titlebar">
        <div>
          <h2 class="ml-title">{{ detail.contractName }}</h2>
          <div class="ml-tags">
            <span class="ml-mono">{{ detail.externalContractNo }}</span>
            <el-tag :type="confirmationTag(detail.confirmationStatus).type">{{ confirmationTag(detail.confirmationStatus).label }}</el-tag>
            <el-tag :type="progressTag(detail.deliveryProgress).type" effect="plain">{{ progressTag(detail.deliveryProgress).label }}</el-tag>
            <el-tag effect="plain">版本 {{ detail.currentRevisionNo }}</el-tag>
            <el-tag v-if="isTestData" type="warning" effect="plain">测试数据</el-tag>
            <el-tag v-if="detail.labels?.BUYER_CATEGORY" type="info" effect="plain" data-test="buyer-category-tag">
              购方：{{ buyerCategoryLabel(detail.labels.BUYER_CATEGORY) }}
            </el-tag>
            <el-tag v-else type="info" effect="plain" data-test="buyer-category-unclassified">购方：未分类</el-tag>
          </div>
        </div>
        <div v-if="canWrite" class="ml-actions">
          <template v-if="isEditable">
            <el-button @click="openAction('form')">修改草稿</el-button>
            <el-button type="primary" @click="openVerify">核验确认</el-button>
          </template>
          <el-button v-if="status === 'CONFIRMED'" type="primary" @click="openCorrect">录入更正</el-button>
          <template v-if="status !== 'VOIDED'">
            <el-button @click="openEvidence">补充资料</el-button>
            <el-button @click="openAlias">关联外部编号</el-button>
            <el-button data-test="buyer-category-edit" @click="openBuyerCategory">标注购方类别</el-button>
            <el-button type="danger" plain @click="openVoid">{{ status === 'CONFIRMED' ? '整笔纠错作废' : '作废草稿' }}</el-button>
          </template>
        </div>
      </div>

      <MidlongNotice v-if="status === 'VOIDED'" tone="warn" title="已作废">
        {{ detail.voidReason }}（{{ detail.voidedBy }} · {{ detail.voidedAt ? new Date(detail.voidedAt).toLocaleString('zh-CN') : '' }}）。作废合同不计入持仓，全部历史版本保留可查。
      </MidlongNotice>
      <MidlongNotice v-if="isTestData" tone="warn">该合同来源为 {{ detail.sourceNamespace }}，是工程测试数据，不代表真实合同，不作为业务验收依据。</MidlongNotice>
      <MidlongNotice v-if="isEditable && blockingGaps.length" tone="danger" title="核验确认前需补齐">
        {{ blockingGaps.map((g) => g.label).join('、') }}。
      </MidlongNotice>
      <MidlongNotice v-if="hintGaps.length" tone="warn" title="质量提示（不阻止确认，已证明的义务照常计入）">
        {{ hintGaps.map((g) => g.label).join('、') }}。
      </MidlongNotice>
      <MidlongNotice v-if="status === 'VOIDED' && releasedAliases.length" tone="info">
        外部编号 {{ releasedAliases.map((a) => a.externalObligationId).join('、') }} 已随作废释放，可以按正确内容重新登记（重新登记时会提示曾作废）。
      </MidlongNotice>

      <div class="ml-tiles">
        <div class="ml-tile"><span>当前有效电量</span><b>{{ fmtQuantity(current?.totalQuantity) }}<i>MWh</i></b><small>版本 {{ detail.currentRevisionNo }}</small></div>
        <div class="ml-tile"><span>原始录入电量</span><b>{{ fmtQuantity(detail.originalQuantity) }}<i>MWh</i></b><small>版本 1</small></div>
        <div class="ml-tile"><span>售电价格</span><b>{{ current?.priceStatus === 'KNOWN' ? fmtPrice(current?.sellerPrice) : '待核对' }}<i v-if="current?.priceStatus === 'KNOWN'">元/MWh</i></b><small>{{ current?.priceType ? PRICE_TYPE_LABELS[current.priceType] : '价格类型未定' }} · {{ current ? TAX_BASIS_LABELS[current.taxBasis] : '' }}</small></div>
        <div class="ml-tile"><span>月度分解</span><b>{{ { COMPLETE: '完整', PARTIAL: '不完整', NONE: '无' }[current?.allocationCompleteness ?? 'NONE'] }}</b><small>{{ current?.allocations.filter((a) => a.evidenceBasis === 'FORMAL').length ?? 0 }} 个月正式分解</small></div>
        <div class="ml-tile"><span>关联成交电量</span><b>{{ fmtQuantity(detail.linkedTrades.volume) }}<i>MWh</i></b><small>{{ detail.linkedTrades.tradeCount }} 笔 · 非实际交割量/履约率</small></div>
      </div>

      <div class="ml-panel">
        <h3>合同信息</h3>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="文件类型">{{ DOCUMENT_KIND_LABELS[detail.documentKind] }}</el-descriptions-item>
          <el-descriptions-item label="交易品种周期">{{ detail.productKind ? PRODUCT_KIND_LABELS[detail.productKind] : '待核对' }}</el-descriptions-item>
          <el-descriptions-item label="交割周期">{{ detail.deliveryCycle ? DELIVERY_CYCLE_LABELS[detail.deliveryCycle] : '—' }}</el-descriptions-item>
          <el-descriptions-item label="交易方式">{{ detail.tradeMethod ? TRADE_METHOD_LABELS[detail.tradeMethod] : '待核对' }}</el-descriptions-item>
          <el-descriptions-item label="市场范围">{{ detail.marketScope ? MARKET_SCOPE_LABELS[detail.marketScope] : '待核对' }}</el-descriptions-item>
          <el-descriptions-item label="电能属性">{{ detail.energyAttribute ? ENERGY_ATTRIBUTE_LABELS[detail.energyAttribute] : '待核对' }}</el-descriptions-item>
          <el-descriptions-item label="交易主体">{{ subjectLabel }}</el-descriptions-item>
          <el-descriptions-item label="场站">{{ stationName(detail.stationId) }}</el-descriptions-item>
          <el-descriptions-item label="购电方">{{ detail.counterpartyName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="交割期">{{ current?.deliveryStart ?? '—' }} ~ {{ current?.deliveryEnd ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="签订日期">{{ detail.signedDate ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="价格构成">{{ current ? PRICE_COMPONENT_LABELS[current.priceComponent] : '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ detail.sourceNamespace }}（{{ { MANUAL: '人工录入', IMPORT: '文件导入', ONBOARDING: '存量纳管' }[detail.origin] }}）</el-descriptions-item>
          <el-descriptions-item label="首次确认">{{ detail.firstConfirmedAt ? `${new Date(detail.firstConfirmedAt).toLocaleString('zh-CN')} · ${detail.firstConfirmedBy}` : '未确认' }}</el-descriptions-item>
          <el-descriptions-item label="导入批次">{{ detail.importBatchId ?? '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.documentKind === 'OBLIGATION'" label="所属框架协议">
            <template v-if="detail.framework">
              <router-link :to="`/zcqjy/contracts/${detail.framework.contractId}`" class="ml-link">{{ detail.framework.contractName }}（{{ detail.framework.externalContractNo }}）</router-link>
              <el-tag v-if="detail.framework.confirmationStatus === 'VOIDED'" size="small" type="info" effect="plain" class="ml-gap">框架协议已作废（保留历史关联）</el-tag>
            </template>
            <template v-else>未关联</template>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div v-if="detail.documentKind === 'FRAMEWORK'" class="ml-panel">
        <h3>框架下的合同（{{ detail.linkedContracts.length }}）</h3>
        <el-table :data="detail.linkedContracts" border size="small">
          <el-table-column label="合同" min-width="220">
            <template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link">{{ row.contractName }}</router-link> <span class="ml-mono ml-muted">{{ row.externalContractNo }}</span></template>
          </el-table-column>
          <el-table-column label="确认状态" width="110"><template #default="{ row }"><el-tag size="small" :type="confirmationTag(row.confirmationStatus).type">{{ confirmationTag(row.confirmationStatus).label }}</el-tag></template></el-table-column>
          <el-table-column label="电量(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
          <el-table-column label="交割期" width="210"><template #default="{ row }">{{ row.deliveryStart ?? '—' }} ~ {{ row.deliveryEnd ?? '—' }}</template></el-table-column>
          <template #empty>尚无合同关联到该框架协议。框架协议本身不产生正式持仓。</template>
        </el-table>
        <router-link v-if="detail.linkedContracts.length" :to="{ path: '/zcqjy/contracts', query: { frameworkContractId: String(detail.contractId) } }" class="ml-link ml-muted">在合同列表中查看</router-link>
      </div>

      <div class="ml-panel">
        <h3>当前版本月度分解</h3>
        <el-table v-if="current" :data="current.allocations" border size="small">
          <el-table-column prop="deliveryMonth" label="交割月" width="110" />
          <el-table-column label="电量(MWh)" width="140" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="售电价格(元/MWh)" min-width="180"><template #default="{ row }">{{ allocationPrice(current!, row) }}</template></el-table-column>
          <el-table-column label="依据" width="120">
            <template #default="{ row }"><el-tag size="small" :type="row.evidenceBasis === 'FORMAL' ? 'success' : 'info'" effect="plain">{{ EVIDENCE_BASIS_LABELS[row.evidenceBasis as 'FORMAL'] }}</el-tag></template>
          </el-table-column>
          <el-table-column label="来源" min-width="160"><template #default="{ row }">{{ row.derivation === 'SINGLE_MONTH_TERMS' ? '单月交割期（由合同条款确定）' : row.sourceQuantity ?? '分解明细' }}</template></el-table-column>
          <template #empty>无月度分解：合同电量计入月度持仓的「跨期未分解」，不按月均摊。</template>
        </el-table>
        <p v-if="current?.allocations.some((a) => a.evidenceBasis === 'INTERNAL_ESTIMATE')" class="ml-muted">内部估算分解仅供参考，不计入正式持仓。</p>
      </div>

      <!-- 核验、更正、作废等操作都会让 rowVersion 前进：面板据此重新取概览，否则仍显示旧版本状态、提交旧的 expectedRevisionNo。 -->
      <MidlongContractCurvesPanel v-if="showCurves" :contract-id="detail.contractId" :row-version="detail.rowVersion" :can-write="canWrite" :evidence="detail.evidence" />
      <MidlongContractStationsPanel v-if="showStations" :contract-id="detail.contractId" :row-version="detail.rowVersion" :can-write="canWrite" :evidence="detail.evidence" :stations="stationOptions" />
      <MidlongContractAdjustmentsPanel
        v-if="showAdjustments" ref="adjustmentsPanel" :contract-id="detail.contractId" :contract-label="detail.contractName"
        :row-version="detail.rowVersion" :can-write="canWrite" :confirmation-status="detail.confirmationStatus" @changed="load"
      />

      <div class="ml-panel">
        <h3>版本历史（{{ detail.revisions.length }}）</h3>
        <el-timeline>
          <el-timeline-item v-for="rev in [...detail.revisions].reverse()" :key="rev.id" :timestamp="new Date(rev.recordedAt).toLocaleString('zh-CN')" placement="top" :type="rev.revisionNo === detail.currentRevisionNo ? 'primary' : undefined">
            <div class="ml-rev">
              <div class="ml-rev-head">
                <b>版本 {{ rev.revisionNo }}</b>
                <el-tag size="small" effect="plain">{{ REVISION_KIND_LABELS[rev.revisionKind] }}</el-tag>
                <el-tag size="small" :type="rev.status === 'CONFIRMED' ? 'success' : 'info'" effect="plain">{{ rev.status === 'CONFIRMED' ? '已确认（不可覆盖）' : '草稿' }}</el-tag>
                <span class="ml-muted">录入 {{ rev.recordedBy ?? '—' }}<template v-if="rev.confirmedAt"> · 确认 {{ rev.confirmedBy }} {{ new Date(rev.confirmedAt).toLocaleString('zh-CN') }}</template></span>
              </div>
              <div>电量 {{ fmtQuantity(rev.totalQuantity) }} MWh · 售电价 {{ rev.priceStatus === 'KNOWN' ? `${fmtPrice(rev.sellerPrice)} 元/MWh` : '待核对' }} · 交割期 {{ rev.deliveryStart ?? '—' }} ~ {{ rev.deliveryEnd ?? '—' }} · 分解 {{ rev.allocations.length }} 行</div>
              <div v-if="rev.changeReason">{{ rev.revisionKind === 'CORRECTION' ? '更正原因' : '变更原因' }}：{{ rev.changeReason }}<template v-if="rev.affectedMonths.length">；受影响月份 {{ rev.affectedMonths.join('、') }}</template></div>
              <div v-if="rev.evidenceIds.length" class="ml-muted">依据：{{ rev.evidenceIds.map((id) => evidenceById.get(id)?.originalFileName ?? `#${id}`).join('、') }}</div>
              <!-- MA-05：更正与调整产生的变更版本同一条时间线，都可看变更前后快照（初始/基线版本没有「变更前」）。 -->
              <el-button
                v-if="showAdjustments && rev.supersedesRevisionNo !== null" link type="primary" size="small"
                :data-test="`revision-impact-${rev.revisionNo}`" @click.stop="openRevisionImpact(rev.revisionNo)"
              >影响对比（变更前后快照）</el-button>
            </div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div class="ml-panel">
        <h3>资料（{{ detail.evidence.length }}）</h3>
        <el-table :data="detail.evidence" border size="small">
          <el-table-column label="类型" width="150"><template #default="{ row }">{{ EVIDENCE_DOCUMENT_TYPE_LABELS[row.documentType as 'OTHER'] }}</template></el-table-column>
          <el-table-column prop="originalFileName" label="文件" min-width="200" show-overflow-tooltip />
          <el-table-column label="大小" width="90" align="right"><template #default="{ row }">{{ (row.byteSize / 1024).toFixed(1) }} KB</template></el-table-column>
          <el-table-column label="上传" width="200"><template #default="{ row }">{{ row.uploadedBy ?? '—' }} · {{ new Date(row.uploadedAt).toLocaleDateString('zh-CN') }}</template></el-table-column>
          <el-table-column prop="note" label="说明" min-width="160" show-overflow-tooltip />
          <el-table-column label="校验值" width="110"><template #default="{ row }"><span class="ml-mono">{{ row.sha256.slice(0, 10) }}</span></template></el-table-column>
          <el-table-column label="" width="80"><template #default="{ row }"><el-button link type="primary" @click="downloadEvidence(row.id)">下载</el-button></template></el-table-column>
          <template #empty>暂无资料。核验确认需要至少一份电子交易确认单、纸质合同或交易中心系统导出。</template>
        </el-table>
      </div>

      <div class="ml-panel ml-split">
        <div>
          <h3>业务事件</h3>
          <el-timeline>
            <el-timeline-item v-for="ev in [...detail.events].reverse()" :key="ev.id" :timestamp="new Date(ev.occurredAt).toLocaleString('zh-CN')">
              {{ EVENT_TYPE_LABELS[ev.eventType] }}<template v-if="ev.revisionNo"> · 版本 {{ ev.revisionNo }}</template> · {{ ev.actor ?? '—' }}
              <div v-if="ev.reason" class="ml-muted">{{ ev.reason }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
        <div>
          <h3>外部编号</h3>
          <el-table :data="detail.aliases" border size="small">
            <el-table-column prop="sourceNamespace" label="来源" width="140" />
            <el-table-column prop="externalObligationId" label="编号" min-width="150" />
            <el-table-column label="类型" width="110"><template #default="{ row }">{{ row.aliasKind === 'PRIMARY' ? '主编号' : '已核对别名' }}</template></el-table-column>
            <el-table-column label="状态" width="130"><template #default="{ row }">{{ row.releasedAt ? '已随作废释放' : '占用中' }}</template></el-table-column>
          </el-table>
        </div>
      </div>
    </template>

    <MidlongContractFormDialog v-model="dialogs.form" :detail="detail" :subjects="subjects" :stations="stations" @saved="load" />

    <el-dialog v-model="dialogs.verify" title="核验确认" width="620px">
      <div class="ml-dialog">
        <MidlongNotice tone="info">确认后经济内容以不可覆盖版本保存，按确认版本计入月度持仓；价格或分解缺失不阻止确认，但会持续提示。</MidlongNotice>
        <div class="ml-field">
          <span>核验依据（至少一份电子交易确认单、纸质合同或交易中心系统导出）</span>
          <el-checkbox-group v-model="verifyForm.evidenceIds">
            <el-checkbox v-for="e in verifiableEvidence" :key="e.id" :value="e.id">{{ EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType] }} · {{ e.originalFileName }}</el-checkbox>
          </el-checkbox-group>
          <span v-if="!verifiableEvidence.length" class="ml-muted">尚无可作为依据的资料，请先「补充资料」。</span>
        </div>
        <label class="ml-field"><span>核验说明（可空）</span><el-input v-model="verifyForm.note" type="textarea" :rows="2" /></label>
        <MidlongNotice v-if="actionError" tone="danger" :title="missingBasis.length ? '核验依据不完整' : '未能确认'">
          <template v-if="missingBasis.length">缺：{{ missingBasis.join('、') }}</template>
          <template v-else>{{ actionError.message }}</template>
          <el-button v-if="conflictDetails" link type="primary" @click="load">刷新合同</el-button>
        </MidlongNotice>
      </div>
      <template #footer>
        <el-button @click="dialogs.verify = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submitVerify">确认该义务</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogs.correct" title="录入更正（生成新版本）" width="960px" top="5vh">
      <div v-if="correctEconomics && detail" class="ml-dialog">
        <MidlongNotice tone="info">
          更正用于纠正录入错误：基于当前版本 {{ detail.currentRevisionNo }} 生成版本 {{ detail.currentRevisionNo + 1 }}，原版本与依据保留可查。
          外部转让、部分终止等业务变更属于后续阶段，不能用更正代替；不做按比例缩放。
        </MidlongNotice>
        <MidlongEconomicsEditor ref="correctEditor" v-model="correctEconomics" :document-kind="detail.documentKind" :energy-attribute="detail.energyAttribute ?? 'CONVENTIONAL'" />
        <div class="ml-grid">
          <label class="ml-field ml-wide"><span>更正原因（必填）</span><el-input v-model="correctForm.reason" placeholder="如：原确认单为 1000 MWh，系统误录为 1100 MWh" /></label>
          <label class="ml-field"><span>业务生效时间（可空 = 立即；不能晚于当前）</span><el-date-picker v-model="correctForm.businessEffectiveAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" :disabled-date="isFutureMoment" /></label>
        </div>
        <div class="ml-field">
          <span>更正依据（至少一份）</span>
          <el-checkbox-group v-model="correctForm.evidenceIds">
            <el-checkbox v-for="e in correctionEvidence" :key="e.id" :value="e.id">{{ EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType] }} · {{ e.originalFileName }}</el-checkbox>
          </el-checkbox-group>
        </div>
        <MidlongNotice v-if="actionError" tone="danger" :title="conflictDetails ? '合同已被他人更新' : '未能生成更正版本'">
          <template v-if="conflictDetails">
            你基于的版本已过期（当前修订号 {{ conflictDetails.currentRowVersion }}、经济版本 {{ conflictDetails.currentRevisionNo }}）。请刷新核对最新版本后重新填写，本次内容未保存。
            <el-button link type="primary" @click="dialogs.correct = false; load()">刷新合同</el-button>
          </template>
          <template v-else>{{ actionError.message }}</template>
        </MidlongNotice>
      </div>
      <template #footer>
        <el-button @click="dialogs.correct = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!correctForm.reason.trim() || !correctForm.evidenceIds.length || Boolean(correctEditor?.check.errors.length)" @click="submitCorrect">生成更正版本</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogs.void" :title="status === 'CONFIRMED' ? '整笔纠错作废' : '作废草稿'" width="580px">
      <div class="ml-dialog">
        <MidlongNotice tone="warn">作废后该合同不再计入持仓，记录与全部历史版本保留、不可恢复为有效；部分终止不能用作废处理。外部编号随作废释放，录错品种、交易方式或场站时可按正确内容重新登记。</MidlongNotice>
        <label class="ml-field"><span>作废原因（必填）</span><el-input v-model="voidForm.reason" type="textarea" :rows="2" /></label>
        <div v-if="status === 'CONFIRMED'" class="ml-field">
          <span>作废依据（已确认合同必填）</span>
          <el-checkbox-group v-model="voidForm.evidenceIds">
            <el-checkbox v-for="e in correctionEvidence" :key="e.id" :value="e.id">{{ EVIDENCE_DOCUMENT_TYPE_LABELS[e.documentType] }} · {{ e.originalFileName }}</el-checkbox>
          </el-checkbox-group>
        </div>
        <MidlongNotice v-if="actionError" tone="danger">{{ actionError.message }}</MidlongNotice>
      </div>
      <template #footer>
        <el-button @click="dialogs.void = false">取消</el-button>
        <el-button type="danger" :loading="busy" :disabled="!voidForm.reason.trim() || (status === 'CONFIRMED' && !voidForm.evidenceIds.length)" @click="submitVoid">确认作废</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogs.alias" title="关联外部编号" width="560px">
      <div class="ml-dialog">
        <MidlongNotice tone="info">用于「不同来源的同一份确认单」：人工核对为同一售电义务后建立关联，之后从该来源导入会识别为同一合同，持仓只计一次。</MidlongNotice>
        <label class="ml-field"><span>来源</span><el-input v-model="aliasForm.sourceNamespace" placeholder="如 交易中心" /></label>
        <label class="ml-field"><span>该来源下的编号</span><el-input v-model="aliasForm.externalObligationId" /></label>
        <label class="ml-field"><span>核对说明（必填）</span><el-input v-model="aliasForm.verificationNote" type="textarea" :rows="2" /></label>
        <MidlongNotice v-if="actionError" tone="danger">{{ actionError.message }}</MidlongNotice>
      </div>
      <template #footer>
        <el-button @click="dialogs.alias = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!aliasForm.sourceNamespace.trim() || !aliasForm.externalObligationId.trim() || !aliasForm.verificationNote.trim()" @click="submitAlias">建立关联</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogs.evidence" title="补充资料" width="560px">
      <div class="ml-dialog">
        <MidlongNotice tone="info">补充资料只留痕，不改变合同电量，也不新增义务。</MidlongNotice>
        <label class="ml-field"><span>资料类型</span>
          <el-select v-model="evidenceForm.documentType"><el-option v-for="t in uploadableTypes" :key="t" :label="EVIDENCE_DOCUMENT_TYPE_LABELS[t]" :value="t" /></el-select>
        </label>
        <label class="ml-field"><span>文件（≤ 20 MB）</span><input type="file" data-testid="ml-evidence-file" @change="onEvidenceFile" /></label>
        <label class="ml-field"><span>说明（可空）</span><el-input v-model="evidenceForm.note" /></label>
        <MidlongNotice v-if="actionError" tone="danger">{{ actionError.message }}</MidlongNotice>
      </div>
      <template #footer>
        <el-button @click="dialogs.evidence = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!evidenceForm.file" @click="submitEvidence">上传</el-button>
      </template>
    </el-dialog>
      <el-dialog v-model="buyerCategoryVisible" title="标注购方类别" width="420px" data-test="buyer-category-dialog">
      <el-select v-model="buyerCategoryForm.value" data-test="buyer-category-select" style="width: 100%">
        <el-option v-for="o in BUYER_CATEGORY_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
      </el-select>
      <p class="bc-note">分类事实：不产生合同版本、不改变指纹；清除选择即回到「未分类」。保存需公司写权限。</p>
      <template #footer>
        <el-button @click="buyerCategoryVisible = false">取消</el-button>
        <el-button type="primary" :loading="buyerCategorySaving" data-test="buyer-category-save" @click="submitBuyerCategory">保存</el-button>
      </template>
    </el-dialog>
</div>
</template>

<style scoped>
.ml-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.ml-head { display: flex; gap: 12px; }
.ml-placeholder { min-height: 200px; }
.ml-titlebar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.ml-title { margin: 0 0 6px; font-size: var(--font-20); }
.ml-tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ml-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ml-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.ml-tile { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius, 8px); background: var(--panel); }
.ml-tile span { font-size: var(--font-sm); color: var(--muted); }
.ml-tile b { font-size: var(--font-24); font-weight: 650; font-variant-numeric: tabular-nums; font-family: var(--font-display); }
.ml-tile b i { font-style: normal; font-size: var(--font-sm); color: var(--muted); margin-left: 4px; font-weight: 500; }
.ml-tile small { font-size: var(--font-xs); color: var(--muted); }
.ml-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 14px 16px; background: var(--panel); }
.ml-panel h3 { margin: 0 0 10px; font-size: var(--font-16); }
.ml-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.ml-rev { display: flex; flex-direction: column; gap: 3px; font-size: var(--font-md); }
.ml-rev-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ml-link { color: var(--accent); text-decoration: none; }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
.ml-mono { font-family: var(--font-mono, monospace); }
.ml-gap { margin-left: 6px; }
.ml-dialog { display: flex; flex-direction: column; gap: 12px; }
.ml-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.ml-field { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-md); color: var(--muted); }
.ml-field :deep(.el-select), .ml-field :deep(.el-date-editor) { width: 100%; }
.ml-wide { grid-column: span 2; }
@media (max-width: 1100px) { .ml-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ml-split { grid-template-columns: 1fr; } }
</style>
