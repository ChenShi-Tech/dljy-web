<script setup lang="ts">
// 合同调整详情抽屉（dljy#3014，MA-02..05）：版本链（含方向来源与待核对原因）、逐月 before/after/delta 影响、
// 受影响 P3 计划与方案占用（只读）、独立价款单列、asOf 视角说明；操作 = 确认生效（原子；并发同基线 409 引导重对基线）
// 与修订（补方向 / 内容修正 / 基线移动后重报）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import AdjustmentFormDialog from './AdjustmentFormDialog.vue'
import { confirmAdjustment, fetchAdjustment, fetchAdjustmentImpact } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { captureScope } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fileToBase64, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { adjustmentFailureText, adjustmentStatusTag, adjustmentTypeLabel, directionLabel, impactMonthLine, priceLines, signedDeltaLabel } from '@/services/midlong/midlongP4Format'
import {
  ADJUSTMENT_DIRECTION_SOURCE_LABELS, ADJUSTMENT_NOTICES,
  type AdjustmentConfirmResult, type AdjustmentDetailDto, type AdjustmentImpactReport,
} from '@/services/midlong/midlongP4Types'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{ modelValue: boolean; adjustmentId: number | null; canWrite: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] }>()

const detail = ref<AdjustmentDetailDto | null>(null)
const impact = ref<AdjustmentImpactReport | null>(null)
const impactFailure = ref('')
const loading = ref(false)
const failure = ref('')
const busy = ref('')
const actionError = ref('')
const reviseDialog = ref(false)
const confirmDialog = reactive({ open: false, file: null as File | null })
const confirmResult = ref<AdjustmentConfirmResult | null>(null)
let viewGeneration = 0
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.adjustmentId}`
let detailScope = ''

async function load() {
  if (!props.adjustmentId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  impactFailure.value = ''
  loading.value = true
  if (detail.value?.id !== props.adjustmentId) { detail.value = null; impact.value = null }
  try {
    const d = await fetchAdjustment(props.adjustmentId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
    detailScope = scopeKey()
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
    loading.value = false
    return
  }
  try {
    const r = await fetchAdjustmentImpact(props.adjustmentId)
    if (!guard.isCurrent(token, key)) return
    impact.value = r
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    impact.value = null
    impactFailure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

function resetView() {
  viewGeneration += 1
  busy.value = ''
  actionError.value = ''
  reviseDialog.value = false
  confirmDialog.open = false
  confirmResult.value = null
}

watch(() => [props.modelValue, props.adjustmentId] as const, ([open]) => {
  resetView()
  if (open) void load()
}, { immediate: true })

watch(scopeKey, () => {
  resetView()
  guard.begin(loadKey())
  detail.value = null
  impact.value = null
  loading.value = false
})
defineExpose({ reload: load })

/** 详情内写操作：请求发出前核对范围；返回后已换展示时错误只做消息提示，不落在新调整上。 */
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
    ElMessage.success(`调整 #${d.id}：${success}`)
    emit('changed')
    if (at === viewGeneration) await load()
  } catch (e) {
    const f = midlongFailureOf(e)
    const message = adjustmentFailureText(f.errorCode, f.message, f.details)
    if (at === viewGeneration) actionError.value = message
    else ElMessage.warning(`调整 #${d.id} 的操作未完成：${message}`)
  } finally {
    if (at === viewGeneration) busy.value = ''
  }
}

const current = computed(() => detail.value?.revisions.at(-1) ?? null)
const effective = computed(() => detail.value?.status === 'EFFECTIVE')
const pendingDirection = computed(() => detail.value?.status === 'PENDING_VERIFICATION')

function onConfirmFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { actionError.value = oversize; input.value = ''; confirmDialog.file = null; return }
  confirmDialog.file = selected
}
function submitConfirm() {
  const d = detail.value
  if (!d) return
  const selected = confirmDialog.file
  void run('confirm', async () => {
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    const saved = await confirmAdjustment(d.id, {
      expectedRowVersion: d.rowVersion,
      file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null,
    })
    confirmResult.value = saved
    confirmDialog.open = false
  }, '已生效（合同新版本与生效台账已生成）')
}
</script>

<template>
  <el-drawer :model-value="modelValue" title="合同调整详情" size="760px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading" v-loading="true" class="p4-drawer" />
    <div v-else-if="failure" class="p4-drawer">
      <MidlongNotice tone="danger" title="调整加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    </div>
    <div v-else-if="detail" class="p4-drawer">
      <div class="p4-head">
        <h3>#{{ detail.id }} <span class="p4-mono">{{ detail.sourceNamespace }} / {{ detail.externalAdjustmentNo }} r{{ detail.externalRevisionNo }}</span></h3>
        <div class="p4-tags">
          <el-tag :type="adjustmentStatusTag(detail.status).type">{{ adjustmentStatusTag(detail.status).label }}</el-tag>
          <el-tag effect="plain">{{ adjustmentTypeLabel(detail.adjustmentType) }}</el-tag>
          <el-tag effect="plain" :type="detail.direction === 'OBLIGATION_INCREASE' ? 'primary' : detail.direction === 'OBLIGATION_DECREASE' ? 'warning' : 'danger'">{{ directionLabel(detail.direction) }}</el-tag>
          <el-tag v-if="detail.effective" type="success" effect="plain">合同 v{{ detail.effective.contractRevisionNo }} · {{ signedDeltaLabel(detail.effective.totalDelta) }}</el-tag>
        </div>
        <div class="p4-muted">
          <router-link :to="`/zcqjy/contracts/${detail.contractId}`" class="p4-link">{{ detail.contractName ?? `合同 #${detail.contractId}` }}</router-link>
          （{{ detail.contractNo ?? '编号待补' }}） · 交易主体 {{ detail.subjectName ?? '未知' }} · 基线版本 v{{ detail.baseRevisionNo ?? '未知' }}
        </div>
        <div v-if="pendingDirection" class="p4-warn" data-test="direction-pending">{{ ADJUSTMENT_NOTICES.directionPending }}</div>
        <div v-if="current?.directionSource" class="p4-muted">方向来源：{{ ADJUSTMENT_DIRECTION_SOURCE_LABELS[current.directionSource] }}</div>
      </div>

      <MidlongNotice v-for="notice in detail.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>

      <div class="p4-section">
        <h4>当前版本交割段（变化量绝对值）与价款</h4>
        <div class="p4-segments">
          <span v-for="s in current?.segments ?? []" :key="s.id" class="p4-chip">{{ s.deliveryMonth }} · {{ fmtQuantity(s.quantity) }} MWh</span>
        </div>
        <template v-if="priceLines(current?.prices).length">
          <div v-for="line in priceLines(current!.prices)" :key="line" class="p4-price-line" data-test="price-lines">{{ line }}</div>
          <MidlongNotice tone="info">{{ ADJUSTMENT_NOTICES.priceIndependent }}</MidlongNotice>
        </template>
        <div v-else class="p4-muted">无独立价款（转让价款、补偿与手续费单列登记；未填不进售电均价）。</div>
        <div v-if="current?.businessEffectiveAt" class="p4-muted">预定业务生效时间：{{ beijingDateTime(current.businessEffectiveAt) }}（{{ ADJUSTMENT_NOTICES.futureEffective }}）</div>
      </div>

      <div class="p4-section">
        <h4>变更影响（{{ impact?.snapshot.frozen ? '生效台账冻结快照' : '拟变更（未生效）' }}）</h4>
        <MidlongNotice v-if="impactFailure" tone="warn" title="影响查询失败">{{ impactFailure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
        <template v-if="impact">
          <div v-for="m in impact.snapshot.months" :key="m.deliveryMonth" class="p4-row" :data-test="`impact-month-${m.deliveryMonth}`">
            <b>{{ impactMonthLine(m) }}</b>
          </div>
          <div v-if="impact.snapshot.totalDelta !== null" class="p4-muted">总差量 {{ signedDeltaLabel(impact.snapshot.totalDelta) }}；版本 v{{ impact.snapshot.beforeRevisionNo }} → v{{ impact.snapshot.afterRevisionNo ?? '（未生效）' }}，总量 {{ fmtQuantity(impact.snapshot.beforeTotalQuantity) }} → {{ fmtQuantity(impact.snapshot.afterTotalQuantity) }} MWh。</div>
          <div v-if="impact.endedMonths.length" class="p4-warn">{{ ADJUSTMENT_NOTICES.retroactive }}（已结束片段：{{ impact.endedMonths.join('、') }}）</div>
          <div v-if="impact.affectedPlans.length" class="p4-muted" data-test="affected-plans">
            受影响售电目标：{{ impact.affectedPlans.map((p) => `${p.periodKey}${p.targetQuantity === null ? '（目标未确认）' : ` 目标 ${fmtQuantity(p.targetQuantity)} MWh`}`).join('；') }}
          </div>
          <div v-for="p in impact.affectedProposals" :key="p.proposalId" class="p4-muted">
            受影响方案 #{{ p.proposalId }}（{{ p.status }}）：{{ p.months.map((m) => `${m.deliveryMonth} 占用 ${fmtQuantity(m.occupiedQuantity)} MWh、未完成 ${fmtQuantity(m.openQuantity)} MWh`).join('；') }}
          </div>
        </template>
      </div>

      <div v-if="detail.effectuation" class="p4-section">
        <h4>生效台账</h4>
        <div class="p4-muted">
          生效于 {{ beijingDateTime(detail.effectuation.effectiveAt) }} · {{ detail.effectuation.effectedBy ?? '—' }}；
          合同版本 v{{ detail.effectuation.baseRevisionNo }} → v{{ detail.effectuation.newRevisionNo }}，总差量 {{ signedDeltaLabel(detail.effectuation.totalDelta) }}。
        </div>
      </div>

      <div class="p4-section">
        <h4>版本链（旧版本保留）</h4>
        <el-timeline>
          <el-timeline-item v-for="rev in [...detail.revisions].reverse()" :key="rev.id" :timestamp="beijingDateTime(rev.recordedAt)" placement="top" :type="rev.revisionNo === detail.currentRevisionNo ? 'primary' : undefined">
            <div class="p4-row">
              <b>v{{ rev.revisionNo }}</b>
              <el-tag size="small" effect="plain">{{ adjustmentTypeLabel(rev.adjustmentType) }}</el-tag>
              <span>{{ directionLabel(rev.direction) }}<template v-if="rev.directionSource">（{{ ADJUSTMENT_DIRECTION_SOURCE_LABELS[rev.directionSource] }}）</template></span>
              <span v-if="rev.pendingReason" class="p4-warn">待核对原因：无法确认我方义务增减方向</span>
            </div>
            <div class="p4-muted">
              基线版本 v{{ rev.baseContractRevisionNo }} · 交割段 {{ rev.segments.map((s) => `${s.deliveryMonth} ${fmtQuantity(s.quantity)} MWh`).join('、') }}
              <template v-if="rev.businessEffectiveAt"> · 预定生效 {{ beijingDateTime(rev.businessEffectiveAt) }}</template>
            </div>
            <div class="p4-muted">原因：{{ rev.reason }}<template v-if="rev.counterpartyName"> · 对手方 {{ rev.counterpartyName }}</template></div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <template v-if="confirmResult">
        <MidlongNotice tone="info" :title="`已生效：合同 v${confirmResult.contractRevisionNo}（基线 v${confirmResult.baseRevisionNo}）`" data-test="confirm-result">
          <div v-for="m in confirmResult.months" :key="m.deliveryMonth">{{ impactMonthLine(m) }}</div>
          <div>总差量 {{ signedDeltaLabel(confirmResult.totalDelta) }}，调整后总量 {{ fmtQuantity(confirmResult.totalQuantityAfter) }} MWh。</div>
          <div v-for="line in priceLines(confirmResult.prices)" :key="line">{{ line }}</div>
        </MidlongNotice>
        <MidlongNotice v-for="notice in confirmResult.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>
      </template>

      <div v-if="canWrite && !effective" class="p4-actions">
        <el-button type="primary" plain :disabled="Boolean(busy) || pendingDirection" data-test="confirm-adjustment" @click="Object.assign(confirmDialog, { open: true, file: null })">确认生效</el-button>
        <el-button plain :disabled="Boolean(busy)" data-test="revise-adjustment" @click="reviseDialog = true">修订（新版本）</el-button>
      </div>
      <div v-if="canWrite && pendingDirection" class="p4-muted">方向待核对：请以修订补明确方向（或先登记显式映射）后再确认生效。</div>
      <MidlongNotice v-if="actionError" tone="danger" title="操作未完成" data-test="drawer-action-error">{{ actionError }}</MidlongNotice>
    </div>

    <el-dialog v-model="confirmDialog.open" title="确认调整生效" width="560px" append-to-body>
      <MidlongNotice tone="info">{{ ADJUSTMENT_NOTICES.atomicEffect }}</MidlongNotice>
      <MidlongNotice v-if="!current?.evidenceIds.length" tone="warn" data-test="confirm-evidence-hint">
        该调整尚无依据资料：生效必须附核验依据，请选择文件（登记时未附的在此补传）。
      </MidlongNotice>
      <div class="p4-fields">
        <label class="p4-field"><span>依据文件（无既有依据时必填）</span><input type="file" data-test="confirm-file" @change="onConfirmFile" /></label>
      </div>
      <MidlongNotice v-if="actionError" tone="danger">{{ actionError }}</MidlongNotice>
      <template #footer>
        <el-button @click="confirmDialog.open = false">取消</el-button>
        <el-button type="primary" :loading="busy === 'confirm'" :disabled="!current?.evidenceIds.length && !confirmDialog.file" data-test="submit-confirm" @click="submitConfirm">确认生效（原子）</el-button>
      </template>
    </el-dialog>

    <AdjustmentFormDialog
      v-if="detail" v-model="reviseDialog" :contract-id="detail.contractId" :contract-label="detail.contractName ?? `合同 #${detail.contractId}`" :adjustment="detail" @saved="load"
    />
  </el-drawer>
</template>

<style scoped>
.p4-drawer { display: flex; flex-direction: column; gap: 12px; padding: 0 4px; }
.p4-head { display: flex; flex-direction: column; gap: 6px; }
.p4-head h3 { margin: 0; font-size: var(--font-18); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.p4-tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.p4-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p4-section h4 { margin: 0; font-size: var(--font-md); }
.p4-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); }
.p4-segments { display: flex; gap: 6px; flex-wrap: wrap; }
.p4-chip { padding: 2px 8px; border: 1px solid var(--line); border-radius: 10px; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.p4-price-line { font-size: var(--font-md); font-variant-numeric: tabular-nums; }
.p4-actions { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px dashed var(--line); padding-top: 10px; }
.p4-fields { display: flex; flex-direction: column; gap: 10px; }
.p4-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.p4-link { color: var(--accent); text-decoration: none; }
.p4-muted { color: var(--muted); font-size: var(--font-sm); }
.p4-warn { color: var(--warning); font-size: var(--font-md); }
.p4-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
</style>
