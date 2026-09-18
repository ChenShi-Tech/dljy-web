<script setup lang="ts">
// 确认单详情抽屉（dljy#3014，MT-03..06）：版本链（旧版本保留）、当前版本交割段、合同关联（跳转）、
// 冲正记录、占用转换台账与计划偏差；操作 = 修订（内容变化 → 新版本）、外部撤销冲正（旧成交保留）、
// 关联既有合同（补纸质合同只新增关联、持仓不增，文案与跳转一并给出）。
// 隐藏按钮不是权限校验：canWrite=false 只藏写入口，后端 403/404 照常展示错误。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import BeijingDateTimeInput from '../p3/BeijingDateTimeInput.vue'
import ConfirmationFormDialog from './ConfirmationFormDialog.vue'
import { fetchConfirmation, linkConfirmationContract, revokeConfirmation } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fileToBase64, fmtPrice, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { conversionReasonLabel, deviationRemainingLabel, executionFailureText, executionResultTag, linkKindText, pendingReviewText } from '@/services/midlong/midlongP4Format'
import {
  EXECUTION_EVENT_TYPE_LABELS, EXECUTION_LINK_KIND_LABELS, EXECUTION_NOTICES, EXECUTION_RESULT_STATUS_LABELS,
  type ExecutionConfirmationDetailDto,
} from '@/services/midlong/midlongP4Types'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'
import type { TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const props = withDefaults(defineProps<{ modelValue: boolean; confirmationId: number | null; canWrite: boolean; subjects?: MidlongSubject[]; proposals?: TradeProposalDetail[] }>(), { subjects: () => [], proposals: () => [] })
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] ; openProposal: [number] }>()

const detail = ref<ExecutionConfirmationDetailDto | null>(null)
const loading = ref(false)
const failure = ref('')
const busy = ref('')
const actionError = ref('')
const reviseDialog = ref(false)
const linkDialog = reactive({ open: false, contractId: '', externalContractNo: '', sourceNamespace: '', note: '' })
const revokeDialog = reactive({ open: false, reason: '', revokedAt: '', file: null as File | null })
// 展示代次：开关、换确认单、换范围都自增；进行中的操作返回后不落到新展示的确认单上。
let viewGeneration = 0
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.confirmationId}`
let detailScope = ''

async function load() {
  if (!props.confirmationId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  loading.value = true
  if (detail.value?.id !== props.confirmationId) detail.value = null
  try {
    const d = await fetchConfirmation(props.confirmationId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
    detailScope = scopeKey()
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

function resetView() {
  viewGeneration += 1
  busy.value = ''
  actionError.value = ''
  reviseDialog.value = false
  linkDialog.open = false
  revokeDialog.open = false
}

watch(() => [props.modelValue, props.confirmationId] as const, ([open]) => {
  resetView()
  if (open) void load()
}, { immediate: true })

watch(scopeKey, () => {
  resetView()
  guard.begin(loadKey())
  detail.value = null
  loading.value = false
})
defineExpose({ reload: load })

/** 详情里进行写操作：请求发出前核对范围仍属于加载详情时的范围；返回后若已换展示，错误不落在新确认单上。 */
async function run(label: string, action: () => Promise<unknown>, success: string) {
  const d = detail.value
  if (busy.value || !d) return
  const at = viewGeneration
  busy.value = label
  actionError.value = ''
  const scope = captureScope()
  try {
    if (scope.key !== detailScope) throw new Error('公司或地区已切换，已放弃本次操作（未写入任何数据）')
    await action()
    ElMessage.success(`确认单 #${d.id}：${success}`)
    emit('changed')
    if (at === viewGeneration) await load()
  } catch (e) {
    const f = midlongFailureOf(e)
    const message = executionFailureText(f.errorCode, f.message, f.details)
    if (at === viewGeneration) actionError.value = message
    else ElMessage.warning(`确认单 #${d.id} 的操作未完成：${message}`)
  } finally {
    if (at === viewGeneration) busy.value = ''
  }
}

const current = computed(() => detail.value?.revisions.at(-1) ?? null)
const withdrawn = computed(() => detail.value?.resultStatus === 'WITHDRAWN')
const canLink = computed(() => Boolean(detail.value && !withdrawn.value && !detail.value.contractLinks.length))

function openRevise() {
  reviseDialog.value = true
}
function openLink() {
  Object.assign(linkDialog, { open: true, contractId: '', externalContractNo: '', sourceNamespace: '', note: '' })
}
function submitLink() {
  const d = detail.value
  if (!d) return
  const body = linkDialog.contractId.trim() !== ''
    ? { contractId: Number(linkDialog.contractId), note: linkDialog.note.trim() }
    : { externalContractNo: linkDialog.externalContractNo.trim() || null, sourceNamespace: linkDialog.sourceNamespace.trim() || null, note: linkDialog.note.trim() }
  void run('link', async () => {
    const saved = await linkConfirmationContract(d.id, body)
    // 补纸质合同只新增关联：文案与跳转在操作后立刻给出（详情重载后仍有关联行）。
    ElMessage.info(saved.notice)
  }, '已关联合同（不新增同一义务，持仓不变）')
}
function onRevokeFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { actionError.value = oversize; input.value = ''; revokeDialog.file = null; return }
  revokeDialog.file = selected
}
function submitRevoke() {
  const d = detail.value
  if (!d || !revokeDialog.reason.trim()) return
  const fields = { reason: revokeDialog.reason.trim(), revokedAt: revokeDialog.revokedAt || null }
  const selected = revokeDialog.file
  void run('revoke', async () => {
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    await revokeConfirmation(d.id, {
      expectedRowVersion: d.rowVersion, reason: fields.reason, externalRevokedAt: fields.revokedAt,
      file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null,
    })
    revokeDialog.open = false
  }, '已按冲正处理（旧成交记录与合同版本保留）')
}

const events = computed(() => detail.value?.events ?? [])
</script>

<template>
  <el-drawer :model-value="modelValue" title="成交确认单详情" size="720px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading" v-loading="true" class="p4-drawer" />
    <div v-else-if="failure" class="p4-drawer">
      <MidlongNotice tone="danger" title="确认单加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    </div>
    <div v-else-if="detail" class="p4-drawer">
      <div class="p4-head">
        <h3>#{{ detail.id }} <span class="p4-mono">{{ detail.sourceNamespace }} / {{ detail.confirmationNo }}</span></h3>
        <div class="p4-tags">
          <el-tag :type="executionResultTag(detail.resultStatus).type">{{ executionResultTag(detail.resultStatus).label }}</el-tag>
          <el-tag v-if="detail.pendingReview" type="danger" effect="plain">待核对</el-tag>
          <el-tag effect="plain">v{{ detail.currentRevisionNo }}</el-tag>
        </div>
        <div class="p4-muted">
          交易主体 {{ detail.subjectName ?? `#${detail.subjectId}` }} ·
          总量 {{ fmtQuantity(detail.totalQuantity) }} MWh ·
          价格{{ detail.priceKnown ? '齐全' : '未知（不编价）' }} ·
          已转换占用 {{ fmtQuantity(detail.convertedQuantity) }} MWh
        </div>
        <div v-if="detail.pendingReview && current?.unsupportedProduct" class="p4-warn" data-test="pending-review-raw">{{ pendingReviewText(current.unsupportedProduct) }}</div>
        <div v-if="detail.proposalId" class="p4-muted">
          关联方案
          <el-button link type="primary" @click="emit('openProposal', detail.proposalId!)">#{{ detail.proposalId }}</el-button>
          <el-tag v-if="detail.proposalStatus" size="small" effect="plain">{{ detail.proposalStatus }}</el-tag>
        </div>
      </div>

      <MidlongNotice v-for="notice in detail.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>

      <div class="p4-section">
        <h4>合同关联（{{ detail.contractLinks.length }}）</h4>
        <div v-for="link in detail.contractLinks" :key="link.contractId" class="p4-row">
          <router-link :to="`/zcqjy/contracts/${link.contractId}`" class="p4-link">合同 #{{ link.contractId }}</router-link>
          <el-tag size="small" effect="plain">{{ EXECUTION_LINK_KIND_LABELS[link.linkKind] }}</el-tag>
          <span class="p4-muted">{{ linkKindText(link.linkKind) }} · {{ beijingDateTime(link.createdAt) }} {{ link.createdBy ?? '' }}</span>
        </div>
        <div v-if="!detail.contractLinks.length" class="p4-muted">未关联合同义务。{{ EXECUTION_NOTICES.linkRequiresConfirmed }}</div>
      </div>

      <div v-if="detail.reversals.length" class="p4-section">
        <h4>冲正记录（旧成交保留）</h4>
        <div v-for="r in detail.reversals" :key="r.id" class="p4-row">
          <el-tag size="small" type="danger">基于 v{{ r.baseRevisionNo }}</el-tag>
          <span>{{ r.reason }}</span>
          <span class="p4-muted">外部撤销时间 {{ beijingDateTime(r.externalRevokedAt) }} · {{ beijingDateTime(r.createdAt) }} {{ r.createdBy ?? '' }}</span>
          <router-link v-if="r.contractId" :to="`/zcqjy/contracts/${r.contractId}`" class="p4-link">更正版本 v{{ r.contractRevisionNo }}</router-link>
        </div>
        <MidlongNotice tone="warn">{{ EXECUTION_NOTICES.revokeReversal }}</MidlongNotice>
      </div>

      <div class="p4-section">
        <h4>版本链（旧版本保留）</h4>
        <el-timeline>
          <el-timeline-item v-for="rev in [...detail.revisions].reverse()" :key="rev.id" :timestamp="beijingDateTime(rev.recordedAt)" placement="top" :type="rev.revisionNo === detail.currentRevisionNo ? 'primary' : undefined">
            <div class="p4-row">
              <b>v{{ rev.revisionNo }}</b>
              <el-tag size="small" effect="plain">{{ EXECUTION_RESULT_STATUS_LABELS[rev.resultStatus] ?? rev.resultStatus }}</el-tag>
              <span v-if="rev.pendingReview" class="p4-warn">待核对：来源产品原文「{{ rev.unsupportedProduct }}」，人工核对后以修订补齐品种</span>
              <span v-if="rev.changeReason" class="p4-muted">修订原因：{{ rev.changeReason }}</span>
            </div>
            <div class="p4-segments">
              <span v-for="s in rev.segments" :key="s.id" class="p4-chip">{{ s.deliveryMonth }} · {{ fmtQuantity(s.quantity) }} MWh · {{ s.price === null ? '价格未知' : `${fmtPrice(s.price)} 元/MWh` }}</span>
            </div>
            <div v-if="rev.conversion?.months?.length" class="p4-muted">
              占用转换：
              <span v-for="m in rev.conversion.months" :key="m.deliveryMonth">{{ m.deliveryMonth }} {{ fmtQuantity(m.delta) }} MWh（{{ conversionReasonLabel(m.reason) }}）</span>
              <template v-if="rev.conversion.lateResult">；{{ EXECUTION_NOTICES.lateResult }}</template>
            </div>
            <div v-if="rev.conversion?.deviation?.rows?.length" class="p4-muted" data-test="deviation-in-revision">
              计划偏差：<span v-for="row in rev.conversion.deviation.rows" :key="row.planId">{{ row.periodKey }} 本次成交 {{ fmtQuantity(row.confirmedQuantityInPeriod) }} MWh、剩余计划待售量 {{ deviationRemainingLabel(row) }}{{ row.overPlan ? '（超计划）' : '' }}；</span>
            </div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div class="p4-section">
        <h4>事件</h4>
        <el-timeline>
          <el-timeline-item v-for="e in events" :key="e.id" :timestamp="beijingDateTime(e.occurredAt)">
            {{ EXECUTION_EVENT_TYPE_LABELS[e.eventType as keyof typeof EXECUTION_EVENT_TYPE_LABELS] ?? e.eventType }}<template v-if="e.revisionNo"> · v{{ e.revisionNo }}</template> · {{ e.actor ?? '—' }}
            <div v-if="e.reason" class="p4-muted">{{ e.reason }}</div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div v-if="canWrite && !withdrawn" class="p4-actions">
        <el-button type="primary" plain :disabled="Boolean(busy)" data-test="revise-button" @click="openRevise">修订（新版本）</el-button>
        <el-button v-if="canLink" plain :disabled="Boolean(busy)" data-test="link-button" @click="openLink">关联既有合同</el-button>
        <el-button type="danger" plain :disabled="Boolean(busy) || detail.resultStatus !== 'CLEARED'" data-test="revoke-button" @click="Object.assign(revokeDialog, { open: true, reason: '', revokedAt: '', file: null })">外部撤销冲正</el-button>
      </div>
      <MidlongNotice v-if="actionError" tone="danger" title="操作未完成" data-test="drawer-action-error">{{ actionError }}</MidlongNotice>
    </div>

    <el-dialog v-model="linkDialog.open" title="关联既有合同（补纸质合同）" width="560px" append-to-body>
      <MidlongNotice tone="info">{{ EXECUTION_NOTICES.linkNoDoubleCount }}</MidlongNotice>
      <div class="p4-fields">
        <label class="p4-field"><span>合同 ID（优先）</span><el-input v-model="linkDialog.contractId" placeholder="如：7" /></label>
        <label class="p4-field"><span>或外部编号</span><el-input v-model="linkDialog.externalContractNo" placeholder="按编号查找本公司合同" /></label>
        <label class="p4-field"><span>外部编号来源（默认确认单来源）</span><el-input v-model="linkDialog.sourceNamespace" /></label>
        <label class="p4-field"><span>核对说明（必填）</span><el-input v-model="linkDialog.note" type="textarea" :rows="2" /></label>
      </div>
      <MidlongNotice v-if="actionError" tone="danger">{{ actionError }}</MidlongNotice>
      <template #footer>
        <el-button @click="linkDialog.open = false">取消</el-button>
        <el-button type="primary" :loading="busy === 'link'" :disabled="linkDialog.note.trim() === '' || (linkDialog.contractId.trim() === '' && linkDialog.externalContractNo.trim() === '')" @click="submitLink">关联（持仓不变）</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="revokeDialog.open" title="外部撤销冲正" width="560px" append-to-body>
      <MidlongNotice tone="warn">{{ EXECUTION_NOTICES.revokeReversal }}</MidlongNotice>
      <div class="p4-fields">
        <label class="p4-field"><span>撤销原因（必填）</span><el-input v-model="revokeDialog.reason" type="textarea" :rows="2" /></label>
        <div class="p4-field"><span>外部撤销时刻</span><BeijingDateTimeInput v-model="revokeDialog.revokedAt" /></div>
        <label class="p4-field"><span>撤销依据文件（可空）</span><input type="file" @change="onRevokeFile" /></label>
      </div>
      <MidlongNotice v-if="actionError" tone="danger">{{ actionError }}</MidlongNotice>
      <template #footer>
        <el-button @click="revokeDialog.open = false">取消</el-button>
        <el-button type="danger" :loading="busy === 'revoke'" :disabled="revokeDialog.reason.trim() === ''" @click="submitRevoke">确认冲正</el-button>
      </template>
    </el-dialog>

    <ConfirmationFormDialog v-model="reviseDialog" :confirmation="detail" :subjects="subjects" :proposals="proposals" @saved="load" />
  </el-drawer>
</template>

<style scoped>
.p4-drawer { display: flex; flex-direction: column; gap: 12px; padding: 0 4px; }
.p4-head { display: flex; flex-direction: column; gap: 6px; }
.p4-head h3 { margin: 0; font-size: var(--font-18); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.p4-tags { display: flex; gap: 8px; align-items: center; }
.p4-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p4-section h4 { margin: 0; font-size: var(--font-md); }
.p4-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); }
.p4-segments { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0; }
.p4-chip { padding: 2px 8px; border: 1px solid var(--line); border-radius: 10px; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.p4-actions { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px dashed var(--line); padding-top: 10px; }
.p4-fields { display: flex; flex-direction: column; gap: 10px; }
.p4-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.p4-link { color: var(--accent); text-decoration: none; }
.p4-muted { color: var(--muted); font-size: var(--font-sm); }
.p4-warn { color: var(--warning); font-size: var(--font-md); }
.p4-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
</style>
