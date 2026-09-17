<script setup lang="ts">
// 交易方案详情（dljy#2973，MS-03/MS-04/MS-05、MT-01/MT-02）。
// - 方案测算：交易前正式持仓 / 方案 / 交易后（模拟）的电量、名义金额、均价，适用目标交易前后的剩余计划待售量与完成率；
//   标「方案测算」，不是实际收入；没有可比中长期行情时不判断价格优劣。
// - 确认可执行建立占用，撤销/关闭释放占用；余额冲突时显示服务端返回的最新可安排计划量，不在前端自行判定通过。
// - 公告已更正：显示引用版本与当前版本差异，提示按新版本重新核对。
// - 执行页模式（mode=execution）：导出申报材料（只读，不改状态、不操作外部平台）、登记外部提交与回执（只记事实，不宣称受理）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import SubmissionDialog from './SubmissionDialog.vue'
import {
  cancelProposal, closeProposal, confirmProposal, exportProposal, fetchPlanningAttachment, fetchProposal, fetchProposalComparison, markAwaitingResult,
  recheckProposalWindow,
} from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { createLoadGuard, downloadBase64, downloadCsv, fmtAmount, fmtPrice, fmtQuantity } from '@/services/midlong/midlongFormat'
import {
  afterQuantityLabel, arrangeableLabel, beijingDateTime, completionLabel, confirmFailureText, expectedPlanRevisionsOf, planPeriodLabel,
  proposalStatusTag, receiptTag, remainingLabel,
} from '@/services/midlong/midlongP3Format'
import {
  OCCUPATION_RELEASE_REASON_LABELS, PLANNING_EVENT_TYPE_LABELS, PLANNING_NOTICES, PROPOSAL_CLOSE_KINDS, PROPOSAL_CLOSE_KIND_LABELS,
  RECEIPT_ELEMENT_LABELS, proposalActionAllowed,
  type ProposalCloseKind, type ProposalComparison, type ProposalSubmission, type TradeProposalDetail,
} from '@/services/midlong/midlongP3Types'
import { PRICE_COMPONENT_LABELS, PRODUCT_KIND_LABELS, TAX_BASIS_LABELS, TRADE_METHOD_LABELS } from '@/services/midlong/midlongTypes'

const props = withDefaults(defineProps<{ modelValue: boolean; proposalId: number | null; canWrite: boolean; mode?: 'plans' | 'execution' }>(), { mode: 'plans' })
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [number]; edit: [TradeProposalDetail] }>()

const detail = ref<TradeProposalDetail | null>(null)
const comparison = ref<ProposalComparison | null>(null)
const comparisonFailure = ref('')
const failure = ref('')
const actionError = ref('')
const loading = ref(false)
const busy = ref('')
const guard = createLoadGuard()
// 取数代次按「公司 + 地区 + 方案」判断：切换公司或地区后，旧范围的迟到结果一律丢弃，不显示成新范围的方案。
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.proposalId}`

async function load() {
  if (!props.proposalId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  comparisonFailure.value = ''
  loading.value = true
  if (detail.value?.id !== props.proposalId) { detail.value = null; comparison.value = null }
  try {
    const d = await fetchProposal(props.proposalId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
    loading.value = false
    return
  }
  try {
    const c = await fetchProposalComparison(props.proposalId)
    if (!guard.isCurrent(token, key)) return
    comparison.value = c
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    comparison.value = null
    comparisonFailure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

watch(() => [props.modelValue, props.proposalId] as const, ([open]) => {
  actionError.value = ''
  if (open) void load()
}, { immediate: true })

watch(scopeKey, () => {
  guard.begin(loadKey())
  detail.value = null
  comparison.value = null
  actionError.value = ''
  loading.value = false
})

async function run(label: string, action: () => Promise<unknown>, success: string) {
  if (busy.value) return
  busy.value = label
  actionError.value = ''
  try {
    await action()
    ElMessage.success(success)
    if (detail.value) emit('changed', detail.value.id)
    await load()
  } catch (e) {
    const f = midlongFailureOf(e)
    actionError.value = confirmFailureText(f.errorCode, f.message, f.details)
  } finally {
    busy.value = ''
  }
}

const allowed = (action: Parameters<typeof proposalActionAllowed>[1]) => Boolean(detail.value) && props.canWrite && proposalActionAllowed(detail.value!.status, action)

function confirmExecutable() {
  const d = detail.value
  const c = comparison.value
  if (!d || !c) return
  void run('confirm', () => confirmProposal(d.id, { expectedRowVersion: d.rowVersion, expectedPlanRevisions: expectedPlanRevisionsOf(c) }), '方案已确认可执行，占用已建立')
}

const endDialog = reactive({ open: false, kind: 'cancel' as 'cancel' | 'close', reason: '', closeKind: 'NO_LONGER_NEEDED' as ProposalCloseKind })
function openEnd(kind: 'cancel' | 'close') {
  Object.assign(endDialog, { open: true, kind, reason: '', closeKind: 'NO_LONGER_NEEDED' })
}
function submitEnd() {
  const d = detail.value
  if (!d || !endDialog.reason.trim()) return
  endDialog.open = false
  if (endDialog.kind === 'cancel') void run('cancel', () => cancelProposal(d.id, { expectedRowVersion: d.rowVersion, reason: endDialog.reason.trim() }), '方案已撤销，占用已释放')
  else void run('close', () => closeProposal(d.id, { expectedRowVersion: d.rowVersion, closeKind: endDialog.closeKind, reason: endDialog.reason.trim() }), '方案已关闭，占用已释放')
}

const recheckNote = ref('')
function recheck() {
  const d = detail.value
  if (!d?.window || !recheckNote.value.trim()) return
  const window = d.window
  void run('recheck', () => recheckProposalWindow(d.id, { expectedRowVersion: d.rowVersion, windowRevisionNo: window.currentRevisionNo, note: recheckNote.value.trim() }), '已按公告新版本重新核对')
  recheckNote.value = ''
}

/** 导出申报材料：只读请求，完成后不刷新状态、不发任何写请求。 */
async function doExport() {
  const d = detail.value
  if (!d || busy.value) return
  busy.value = 'export'
  actionError.value = ''
  try {
    const scope = scopeKey()
    const file = await exportProposal(d.id)
    if (detail.value?.id !== d.id || scope !== scopeKey()) return
    downloadCsv(file.fileName, file.content)
    ElMessage.info(`已导出方案 v${file.proposalRowVersion} 的申报材料；${PLANNING_NOTICES.exportNotSubmission}`)
  } catch (e) {
    actionError.value = midlongFailureOf(e).message
  } finally {
    busy.value = ''
  }
}

function awaitResult() {
  const d = detail.value
  if (!d) return
  void run('await', () => markAwaitingResult(d.id, { expectedRowVersion: d.rowVersion }), '已标记待结果')
}

const submissionDialog = reactive({ open: false, mode: 'submission' as 'submission' | 'receipt', submission: null as ProposalSubmission | null })
function openSubmission(mode: 'submission' | 'receipt', submission: ProposalSubmission | null = null) {
  Object.assign(submissionDialog, { open: true, mode, submission })
}
async function onSubmissionSaved() {
  if (detail.value) emit('changed', detail.value.id)
  await load()
}

async function downloadAttachment(attachmentId: number) {
  try {
    const file = await fetchPlanningAttachment(attachmentId)
    downloadBase64(file.attachment.originalFileName, file.contentBase64, file.attachment.mediaType ?? undefined)
  } catch (e) {
    ElMessage.error(midlongFailureOf(e).message)
  }
}

const statusTag = computed(() => (detail.value ? proposalStatusTag(detail.value.status) : null))
</script>

<template>
  <el-drawer :model-value="modelValue" size="900px" :title="detail ? `交易方案 #${detail.id}` : '交易方案'" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading && !detail" v-loading="true" class="p3-placeholder" />
    <MidlongNotice v-else-if="failure" tone="danger" title="方案加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    <div v-else-if="detail" class="p3-detail">
      <div class="p3-head">
        <el-tag v-if="statusTag" :type="statusTag.type">{{ statusTag.label }}</el-tag>
        <b>{{ detail.subjectName ?? `主体 #${detail.subjectId}` }}</b>
        <span>方案版本号 {{ detail.rowVersion }}</span>
        <span>合计拟售 {{ fmtQuantity(detail.totalQuantity) }} MWh</span>
        <span>未完成占用 {{ fmtQuantity(detail.openOccupationQuantity) }} MWh</span>
      </div>
      <MidlongNotice tone="info">{{ PLANNING_NOTICES.occupation }}</MidlongNotice>

      <div class="p3-actions">
        <template v-if="mode === 'plans'">
          <el-button v-if="allowed('UPDATE_DRAFT')" @click="emit('edit', detail)">修改草稿</el-button>
          <el-button v-if="allowed('CONFIRM')" type="primary" :loading="busy === 'confirm'" :disabled="!comparison" @click="confirmExecutable">确认可执行（建立占用）</el-button>
        </template>
        <template v-else>
          <el-button :loading="busy === 'export'" @click="doExport">导出申报材料</el-button>
          <el-button v-if="allowed('REGISTER_SUBMISSION')" type="primary" @click="openSubmission('submission')">登记外部提交</el-button>
          <el-button v-if="allowed('AWAIT_RESULT')" :loading="busy === 'await'" @click="awaitResult">标记待结果</el-button>
        </template>
        <el-button v-if="allowed('CANCEL')" :loading="busy === 'cancel'" @click="openEnd('cancel')">撤销方案</el-button>
        <el-button v-if="allowed('CLOSE')" :loading="busy === 'close'" @click="openEnd('close')">关闭方案</el-button>
      </div>
      <MidlongNotice v-if="mode === 'execution'" tone="info">{{ PLANNING_NOTICES.exportNotSubmission }}</MidlongNotice>
      <MidlongNotice v-if="actionError" tone="danger" title="操作未完成">{{ actionError }}</MidlongNotice>

      <MidlongNotice v-if="detail.readiness && (detail.readiness.missing.length || detail.readiness.windowMismatches.length)" tone="warn" title="确认可执行前需补齐（草稿可以保存）">
        <div v-if="detail.readiness.missing.length">缺：{{ detail.readiness.missing.join('、') }}</div>
        <div v-for="m in detail.readiness.windowMismatches" :key="m.field">{{ m.message }}</div>
      </MidlongNotice>

      <template v-if="detail.window">
        <h4>交易窗口</h4>
        <div class="p3-kv">
          <span>公告：{{ detail.window.referenced?.announcementName ?? `#${detail.window.windowId}` }}（引用 v{{ detail.window.referencedRevisionNo }}）</span>
          <span>申报截止：{{ beijingDateTime(detail.window.referenced?.declarationClosesAt) }}</span>
          <span>确认时间：{{ beijingDateTime(detail.window.referenced?.confirmationAt) }}</span>
        </div>
        <MidlongNotice v-if="detail.window.referenced?.pendingFields.length" tone="warn" title="公告参数待核对">{{ detail.window.referenced.pendingFields.map((p) => p.label).join('、') }}</MidlongNotice>
        <MidlongNotice v-if="detail.window.needsRecheck" tone="warn" :title="`${PLANNING_NOTICES.windowRevised}（当前 v${detail.window.currentRevisionNo}）`">
          <div v-for="c in detail.window.changesSinceReferenced" :key="c.field">{{ c.label }}：{{ c.previous ?? '空' }} → {{ c.next ?? '空' }}</div>
          <div v-if="allowed('RECHECK_WINDOW')" class="p3-inline">
            <el-input v-model="recheckNote" size="small" placeholder="核对说明（必填）" style="width: 260px" />
            <el-button size="small" type="primary" :loading="busy === 'recheck'" :disabled="!recheckNote.trim()" @click="recheck">按新版本重新核对</el-button>
          </div>
        </MidlongNotice>
      </template>
      <MidlongNotice v-else tone="warn">未关联交易窗口（公告），确认可执行前必须关联。</MidlongNotice>

      <h4>方案内容</h4>
      <div class="p3-kv">
        <span>交易方式：{{ detail.tradeMethod ? TRADE_METHOD_LABELS[detail.tradeMethod] : '待填写' }}</span>
        <span>品种周期：{{ detail.productKind ? PRODUCT_KIND_LABELS[detail.productKind] : '待填写' }}</span>
        <span>报价：{{ detail.proposedPrice === null ? '待填写' : `${fmtPrice(detail.proposedPrice)} 元/MWh` }}（{{ TAX_BASIS_LABELS[detail.priceTaxBasis] }} · {{ PRICE_COMPONENT_LABELS[detail.priceComponent] }}）</span>
        <span>负责人：{{ detail.ownerName ?? '待填写' }}</span>
      </div>
      <div class="p3-rationale">理由：{{ detail.rationale ?? '待填写' }}</div>

      <h4>方案测算 <small>{{ PLANNING_NOTICES.simulation }}</small></h4>
      <MidlongNotice v-if="comparisonFailure" tone="danger" title="方案测算加载失败（未显示任何替代数值）">{{ comparisonFailure }}</MidlongNotice>
      <template v-else-if="comparison">
        <MidlongNotice tone="info">{{ PLANNING_NOTICES.priceNotAssessed }}</MidlongNotice>
        <el-table :data="comparison.months" border size="small">
          <el-table-column prop="month" label="交割月" width="86" />
          <el-table-column label="交易前正式持仓(MWh)" min-width="130" align="right">
            <template #default="{ row }">{{ row.before ? `${fmtQuantity(row.before.formalQuantity)}${row.before.soldComplete ? '' : '（另有未分解）'}` : '无' }}</template>
          </el-table-column>
          <el-table-column label="方案电量(MWh)" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.proposalQuantity) }}</template></el-table-column>
          <el-table-column label="方案名义金额(元)" width="130" align="right"><template #default="{ row }">{{ row.proposalNotionalAmount === null ? '报价待填写' : fmtAmount(row.proposalNotionalAmount) }}</template></el-table-column>
          <el-table-column label="交易后电量（模拟）" min-width="130" align="right"><template #default="{ row }">{{ afterQuantityLabel(row) }}</template></el-table-column>
          <el-table-column label="交易后名义金额（模拟）" min-width="150" align="right">
            <template #default="{ row }">{{ !row.after.comparable ? '口径不可比' : row.after.notionalAmount === null ? '无已知价格' : `${fmtAmount(row.after.notionalAmount)}${row.after.notionalAmountComplete ? '' : '（仅已知部分）'}` }}</template>
          </el-table-column>
          <el-table-column label="交易后均价（模拟）" min-width="130" align="right">
            <template #default="{ row }">{{ !row.after.comparable ? '口径不可比' : row.after.averagePrice === null ? '无' : `${fmtPrice(row.after.averagePrice)} 元/MWh` }}</template>
          </el-table-column>
        </el-table>
        <MidlongNotice v-if="comparison.uncoveredMonths.length" tone="warn">交割月 {{ comparison.uncoveredMonths.join('、') }} 没有已确认的售电目标，不能确认占用。</MidlongNotice>
        <el-table :data="comparison.plans" border size="small" class="p3-gap">
          <el-table-column label="适用目标" min-width="130"><template #default="{ row }">{{ planPeriodLabel(row.periodType, row.periodKey) }}</template></el-table-column>
          <el-table-column label="目标版本" min-width="140">
            <template #default="{ row }">
              {{ row.currentRevisionNo ? `当前 v${row.currentRevisionNo}` : '未确认' }}
              <el-tag v-if="row.revisionSuperseded" size="small" type="warning">方案引用 v{{ row.referencedRevisionNo }}（已换版）</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="确认目标(MWh)" width="110" align="right"><template #default="{ row }">{{ row.before.targetQuantity === null ? '未确认' : fmtQuantity(row.before.targetQuantity) }}</template></el-table-column>
          <el-table-column label="剩余计划待售量 交易前 → 后" min-width="200"><template #default="{ row }">{{ remainingLabel(row.before) }} → {{ remainingLabel(row.after) }}</template></el-table-column>
          <el-table-column label="完成率 交易前 → 后" min-width="170"><template #default="{ row }">{{ completionLabel(row.before) }} → {{ completionLabel(row.after) }}</template></el-table-column>
          <el-table-column label="可安排计划量（当前）" min-width="140"><template #default="{ row }">{{ arrangeableLabel(row.before) }}</template></el-table-column>
          <template #empty>方案交割月没有适用的售电目标。</template>
        </el-table>
      </template>

      <h4>交割片段与占用</h4>
      <el-table :data="detail.segments" border size="small">
        <el-table-column prop="deliveryMonth" label="交割月" width="100" />
        <el-table-column label="拟售电量(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
        <el-table-column label="占用" min-width="260">
          <template #default="{ row }">
            <template v-for="o in detail.occupations.filter((x) => x.deliveryMonth === row.deliveryMonth)" :key="o.id">
              {{ o.open ? `未完成占用 ${fmtQuantity(o.quantity)} MWh（${beijingDateTime(o.occupiedAt)} 建立）` : `已释放：${OCCUPATION_RELEASE_REASON_LABELS[o.releaseReason ?? 'CLOSED']} · ${beijingDateTime(o.releasedAt)}` }}
            </template>
            <span v-if="!detail.occupations.some((x) => x.deliveryMonth === row.deliveryMonth)" class="p3-muted">未建立占用</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="detail.planRefs.length" class="p3-refs">
        确认时引用的目标版本：
        <span v-for="r in detail.planRefs" :key="r.planId">{{ planPeriodLabel(r.periodType, r.periodKey) }} v{{ r.revisionNo }}（{{ fmtQuantity(r.targetQuantity) }} MWh）<b v-if="r.superseded" class="p3-warn">已换版为 v{{ r.currentConfirmedRevisionNo }}</b>；</span>
      </div>

      <h4>外部提交登记 <small>{{ PLANNING_NOTICES.submissionNotAccepted }}</small></h4>
      <el-table :data="detail.submissions" border size="small">
        <el-table-column label="外部提交时间" width="140"><template #default="{ row }">{{ beijingDateTime(row.submittedAt) }}</template></el-table-column>
        <el-table-column label="外部操作人 / 渠道" min-width="140"><template #default="{ row }">{{ row.submittedByName }} / {{ row.channel ?? '未填写' }}</template></el-table-column>
        <el-table-column label="登记人 / 时间" min-width="150"><template #default="{ row }">{{ row.registeredBy ?? '未知' }} · {{ beijingDateTime(row.registeredAt) }}</template></el-table-column>
        <el-table-column label="回执完整度" min-width="200">
          <template #default="{ row }">
            <el-tag size="small" :type="receiptTag(row.receiptCompleteness).type">{{ receiptTag(row.receiptCompleteness).label }}</el-tag>
            <div v-if="row.receiptMissing.length" class="p3-muted">依据待补：{{ row.receiptMissing.map((k: keyof typeof RECEIPT_ELEMENT_LABELS) => RECEIPT_ELEMENT_LABELS[k]).join('、') }}</div>
          </template>
        </el-table-column>
        <el-table-column label="回执" min-width="170">
          <template #default="{ row }">
            <div v-for="r in row.receipts" :key="r.id">
              {{ r.externalReference ?? '' }} {{ r.receiptAt ? beijingDateTime(r.receiptAt) : '' }}
              <el-button v-if="r.attachmentId" link type="primary" @click="downloadAttachment(r.attachmentId)">{{ r.attachment?.originalFileName ?? '回执文件' }}</el-button>
            </div>
            <el-button v-if="mode === 'execution' && allowed('ADD_RECEIPT')" link type="primary" @click="openSubmission('receipt', row)">补充回执</el-button>
          </template>
        </el-table-column>
        <template #empty>尚未登记外部提交。</template>
      </el-table>

      <h4>变更记录</h4>
      <el-timeline>
        <el-timeline-item v-for="e in detail.events ?? []" :key="e.id" :timestamp="beijingDateTime(e.occurredAt)">
          {{ PLANNING_EVENT_TYPE_LABELS[e.eventType] ?? e.eventType }}<template v-if="e.reason"> · {{ e.reason }}</template> · {{ e.actor ?? '未知' }}
        </el-timeline-item>
      </el-timeline>
    </div>

    <el-dialog v-model="endDialog.open" :title="endDialog.kind === 'cancel' ? '撤销方案（释放占用）' : '关闭方案（释放占用）'" width="460px" append-to-body>
      <el-form label-width="80px" @submit.prevent>
        <el-form-item v-if="endDialog.kind === 'close'" label="关闭类型">
          <el-select v-model="endDialog.closeKind" style="width: 100%">
            <el-option v-for="k in PROPOSAL_CLOSE_KINDS" :key="k" :label="PROPOSAL_CLOSE_KIND_LABELS[k]" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因" required><el-input v-model="endDialog.reason" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="endDialog.open = false">取消</el-button>
        <el-button type="primary" :disabled="!endDialog.reason.trim()" @click="submitEnd">确定</el-button>
      </template>
    </el-dialog>
    <SubmissionDialog
      v-if="detail" v-model="submissionDialog.open" :mode="submissionDialog.mode" :proposal="detail" :submission="submissionDialog.submission"
      @saved="onSubmissionSaved"
    />
  </el-drawer>
</template>

<style scoped>
.p3-placeholder { min-height: 200px; }
.p3-detail { display: flex; flex-direction: column; gap: 10px; }
.p3-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.p3-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.p3-detail h4 { margin: 8px 0 0; font-size: var(--font-md); display: flex; gap: 8px; align-items: baseline; }
.p3-detail h4 small { color: var(--muted); font-weight: 400; font-size: var(--font-sm); }
.p3-kv { display: flex; gap: 18px; flex-wrap: wrap; font-size: var(--font-md); }
.p3-rationale { font-size: var(--font-md); color: var(--text-body); }
.p3-inline { display: flex; gap: 8px; margin-top: 6px; align-items: center; }
.p3-refs { font-size: var(--font-sm); color: var(--muted); }
.p3-muted { color: var(--muted); font-size: var(--font-sm); }
.p3-warn { color: var(--warning); font-weight: 500; }
.p3-gap { margin-top: 8px; }
</style>
