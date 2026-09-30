<script setup lang="ts">
// 合同调整登记 / 修订（dljy#3014，MA-01..04）：类型（外部调整/转让/部分终止）、来源与外部调整编号+修订号、
// 逐交割段变化量（绝对值，方向统一给出——不从正负推断）、我方义务方向（可空 = 待核对并阻止生效）、
// 独立价款（转让价款/补偿/手续费，单列不进售电均价）、生效时间（可空 = 确认即生效）。
// 打开时展示该合同当前版本的可调余额（按正式分解片段）；方向未选时明确提示「待核对、不改变持仓」。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchAdjustableBalance, registerAdjustment, reviseAdjustment } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { adjustmentFailureText, adjustmentStatusTag, directionLabel, priceLines } from '@/services/midlong/midlongP4Format'
import {
  ADJUSTMENT_NOTICES, ADJUSTMENT_PRICE_KINDS, ADJUSTMENT_PRICE_KIND_LABELS, ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_TYPES,
  OBLIGATION_DIRECTIONS, type AdjustmentDetailDto, type AdjustmentInput, type AdjustmentStatus, type AdjustmentType,
  type AdjustmentWriteResult, type ObligationDirection,
} from '@/services/midlong/midlongP4Types'
import type { TaxBasis } from '@/services/midlong/midlongTypes'
import { TAX_BASES, TAX_BASIS_LABELS } from '@/services/midlong/midlongTypes'
// 操作导引（dljy#3407）：调整表单接给「调整与复盘账单」导引，登记成功发推进信号。
import { emitGuideSignal, useGuideForm } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'

const props = defineProps<{
  modelValue: boolean
  contractId: number
  contractLabel: string
  /** 修订模式：要修订的调整详情（含 rowVersion）；null = 登记。 */
  adjustment?: AdjustmentDetailDto | null
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [number] }>()

type SegmentForm = { deliveryMonth: string; quantity: string }
type PriceForm = { enabled: boolean; amount: string; taxBasis: TaxBasis | 'UNKNOWN'; note: string }
const blank = () => ({
  adjustmentType: 'ADJUSTMENT' as AdjustmentType,
  sourceNamespace: 'MANUAL',
  externalAdjustmentNo: '',
  externalRevisionNo: '1',
  direction: '' as '' | ObligationDirection,
  externalProductCode: '',
  counterpartyName: '',
  businessEffectiveAt: '',
  reason: '',
  note: '',
  changeReason: '',
  segments: [{ deliveryMonth: '', quantity: '' }] as SegmentForm[],
  prices: { transferPrice: { enabled: false, amount: '', taxBasis: 'UNKNOWN' as TaxBasis | 'UNKNOWN', note: '' }, compensation: { enabled: false, amount: '', taxBasis: 'UNKNOWN' as TaxBasis | 'UNKNOWN', note: '' }, handlingFee: { enabled: false, amount: '', taxBasis: 'UNKNOWN' as TaxBasis | 'UNKNOWN', note: '' } } as Record<'transferPrice' | 'compensation' | 'handlingFee', PriceForm>,
})
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const result = ref<AdjustmentWriteResult | null>(null)
const balance = ref<Awaited<ReturnType<typeof fetchAdjustableBalance>> | null>(null)
const balanceError = ref('')
// 写入会话：登记 = 该合同的新调整；修订 = 调整 id + 行版本。关闭或重开让进行中的保存失效。
const session = createWriteSession(() => (props.adjustment ? `revise:${props.adjustment.id}:${props.adjustment.rowVersion}` : `register:${props.contractId}`))
onBeforeUnmount(() => session.close())

async function loadBalance() {
  balance.value = null
  balanceError.value = ''
  try {
    balance.value = await fetchAdjustableBalance(props.contractId)
  } catch (e) {
    balanceError.value = midlongFailureOf(e).message
  }
}

function reset() {
  Object.assign(form, blank())
  const base = props.adjustment
  if (base) {
    // 修订预填当前版本；来源业务键（来源 + 外部编号 + 修订号）与合同不可换。
    const current = base.revisions.at(-1)
    form.adjustmentType = current?.adjustmentType ?? 'ADJUSTMENT'
    form.sourceNamespace = base.sourceNamespace
    form.externalAdjustmentNo = base.externalAdjustmentNo
    form.externalRevisionNo = String(base.externalRevisionNo)
    form.direction = current?.direction ?? ''
    form.externalProductCode = current?.externalProductCode ?? ''
    form.counterpartyName = current?.counterpartyName ?? ''
    form.reason = current?.reason ?? ''
    form.note = current?.note ?? ''
    form.changeReason = ''
    form.segments = (current?.segments.length ? current.segments : [{ deliveryMonth: '', quantity: '' }]).map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity }))
    for (const kind of ADJUSTMENT_PRICE_KINDS) {
      const item = current?.prices?.[kind]
      form.prices[kind] = { enabled: Boolean(item), amount: item?.amount ?? '', taxBasis: item?.taxBasis ?? 'UNKNOWN', note: item?.note ?? '' }
    }
  }
  file.value = null
  saving.value = false
  error.value = ''
  result.value = null
}

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  reset()
  void loadBalance()
}, { immediate: true })

function addSegment() { form.segments.push({ deliveryMonth: '', quantity: '' }) }
function removeSegment(index: number) { if (form.segments.length > 1) form.segments.splice(index, 1) }

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; input.value = ''; file.value = null; return }
  file.value = selected
}

const segmentsValid = computed(() => form.segments.length > 0 && form.segments.every((s) => /^\d{4}-\d{2}$/.test(s.deliveryMonth) && s.quantity.trim() !== '' && Number(s.quantity) > 0))
const pricesValid = computed(() => Object.values(form.prices).every((p) => !p.enabled || (p.amount.trim() !== '' && Number(p.amount) > 0)))
const valid = computed(() =>
  form.sourceNamespace.trim() !== '' && form.externalAdjustmentNo.trim() !== '' && /^\d+$/.test(form.externalRevisionNo.trim())
  && form.reason.trim() !== '' && segmentsValid.value && pricesValid.value
  && (!props.adjustment || form.changeReason.trim() !== ''))

/** 勾选独立价款才提交对应科目；未勾选的不进请求（服务端只存提交的科目；币种默认 CNY）。 */
function pricesInput() {
  const value: NonNullable<AdjustmentInput['prices']> = {}
  for (const kind of ADJUSTMENT_PRICE_KINDS) {
    const p = form.prices[kind]
    if (!p.enabled) continue
    value[kind] = { amount: p.amount.trim(), currency: 'CNY', taxBasis: p.taxBasis, note: p.note.trim() || null }
  }
  return Object.keys(value).length ? value : null
}

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  const ticket = session.begin()
  const target = props.adjustment
  const fields = {
    contractId: props.contractId,
    sourceNamespace: form.sourceNamespace.trim(),
    externalAdjustmentNo: form.externalAdjustmentNo.trim(),
    externalRevisionNo: Number(form.externalRevisionNo.trim()),
    adjustmentType: form.adjustmentType,
    direction: form.direction || null,
    externalProductCode: form.externalProductCode.trim() || null,
    counterpartyName: form.counterpartyName.trim() || null,
    businessEffectiveAt: form.businessEffectiveAt || null,
    reason: form.reason.trim(),
    note: form.note.trim() || null,
    prices: pricesInput(),
    segments: form.segments.map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity.trim() })),
  }
  const selected = file.value
  try {
    ticket.assertCurrent()
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    ticket.assertCurrent()
    const input: AdjustmentInput = { ...fields, file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null }
    const saved = target
      ? await reviseAdjustment(target.id, { ...input, expectedRowVersion: target.rowVersion, changeReason: form.changeReason.trim() })
      : await registerAdjustment(input)
    ElMessage.success(target ? '调整修订已登记（旧版本保留）' : saved.status === 'PENDING_VERIFICATION' ? '调整已登记（待核对，未生效）' : '调整已登记（待确认生效）')
    emit('saved', saved.adjustmentId)
    // 操作导引（dljy#3407）：登记成功发推进信号（方向/状态供 recover 与文案）。
    emitGuideSignal(SIGNAL.adjustmentSaved, { adjustmentId: saved.adjustmentId, revisionNo: saved.revisionNo, status: saved.status, direction: saved.direction })
    if (ticket.sameSession()) result.value = saved
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = adjustmentFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的调整保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}

// 操作导引（dljy#3407）：登记模式才对导引可见；segments 按行覆盖，file 单独暴露。
useGuideForm(
  FORM.adjustmentRegister,
  {
    read: () => ({
      ...form,
      segments: form.segments.map((s) => ({ ...s })),
      hasFile: file.value !== null,
      pricesTransfer: form.prices.transferPrice?.enabled ?? false,
    }),
    fill: (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (key === 'segments') form.segments = (value as Array<{ deliveryMonth: string; quantity: string }>).map((s) => ({ ...s }))
        else if (key === 'file') file.value = value as File | null
        else (form as unknown as Record<string, unknown>)[key] = value
      }
    },
  },
  { active: () => props.modelValue && !props.adjustment },
)

const statusTagOf = (status: AdjustmentStatus) => adjustmentStatusTag(status)
</script>

<template>
  <el-dialog
    :model-value="modelValue" :title="adjustment ? `修订合同调整 #${adjustment.id}（生成新版本）` : `登记合同调整（${contractLabel}）`"
    width="880px" top="4vh" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="p4-form">
      <MidlongNotice tone="info">
        {{ ADJUSTMENT_NOTICES.segmentScopeOnly }} {{ ADJUSTMENT_NOTICES.directionNoInference }}
      </MidlongNotice>
      <el-form label-width="140px" @submit.prevent>
        <div class="p4-grid">
          <el-form-item label="调整类型" required data-guide="ml-adjustment-type">
            <el-select v-model="form.adjustmentType" :disabled="Boolean(adjustment)" data-test="adjustment-type">
              <el-option v-for="t in ADJUSTMENT_TYPES" :key="t" :label="ADJUSTMENT_TYPE_LABELS[t]" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源" required data-guide="ml-adjustment-source">
            <el-input v-model="form.sourceNamespace" :disabled="Boolean(adjustment)" data-test="adjustment-source" placeholder="如：昆明交易中心 / MANUAL" />
          </el-form-item>
          <el-form-item label="外部调整编号" required data-guide="ml-adjustment-no">
            <el-input v-model="form.externalAdjustmentNo" :disabled="Boolean(adjustment)" data-test="external-adjustment-no" />
          </el-form-item>
          <el-form-item label="外部修订号" required>
            <el-input v-model="form.externalRevisionNo" :disabled="Boolean(adjustment)" data-test="external-revision-no" placeholder="同一文件的新修订号 = 新调整记录" />
          </el-form-item>
          <el-form-item label="我方义务方向" data-guide="ml-adjustment-direction">
            <el-select v-model="form.direction" clearable placeholder="留空 = 待核对（阻止生效）" data-test="direction">
              <el-option v-for="d in OBLIGATION_DIRECTIONS" :key="d" :label="directionLabel(d)" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="外部产品代码">
            <el-input v-model="form.externalProductCode" placeholder="可空；用于显式映射登记自动判定方向" data-test="external-product-code" />
          </el-form-item>
          <el-form-item label="交易对手"><el-input v-model="form.counterpartyName" placeholder="可空（如受让方）" /></el-form-item>
          <el-form-item label="业务生效时间">
            <el-date-picker v-model="form.businessEffectiveAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" placeholder="可空 = 确认即生效" style="width: 220px" data-test="business-effective-at" />
          </el-form-item>
          <el-form-item label="调整原因" required data-guide="ml-adjustment-reason">
            <el-input v-model="form.reason" type="textarea" :rows="2" data-test="adjustment-reason" placeholder="如：经平台转让 10—12 月电量 200 MWh 给买方" />
          </el-form-item>
        </div>

        <MidlongNotice v-if="form.direction === ''" tone="warn" data-test="direction-pending-hint">{{ ADJUSTMENT_NOTICES.directionPending }}</MidlongNotice>

        <div class="p4-sub" data-guide="ml-adjustment-segments">交割段（各月变化量的绝对值；方向由上面统一给出，减少的校验以片段可调余额为准）</div>
        <div v-for="(s, i) in form.segments" :key="i" class="p4-segment">
          <el-date-picker v-model="s.deliveryMonth" type="month" value-format="YYYY-MM" placeholder="交割月" style="width: 130px" :data-test="`adj-segment-month-${i}`" />
          <el-input v-model="s.quantity" placeholder="变化量 MWh（绝对值）" style="width: 200px" :data-test="`adj-segment-quantity-${i}`" />
          <span v-if="balance" class="p4-balance">
            可调 {{ fmtQuantity(balance.months.find((m) => m.deliveryMonth === s.deliveryMonth)?.adjustableQuantity ?? null) }} MWh
            <el-tag v-if="balance.months.find((m) => m.deliveryMonth === s.deliveryMonth)?.ended" size="small" type="info" effect="plain">已结束片段</el-tag>
          </span>
          <el-button v-if="form.segments.length > 1" link type="danger" @click="removeSegment(i)">删除</el-button>
        </div>
        <el-button link type="primary" class="p4-add" @click="addSegment">+ 添加交割段</el-button>

        <div class="p4-sub">独立价款（与原合同售电价分开记录，不进入持仓均价）</div>
        <div v-for="kind in ADJUSTMENT_PRICE_KINDS" :key="kind" class="p4-price">
          <el-checkbox v-model="form.prices[kind].enabled" :data-test="`price-${kind}`">{{ ADJUSTMENT_PRICE_KIND_LABELS[kind] }}</el-checkbox>
          <template v-if="form.prices[kind].enabled">
            <el-input v-model="form.prices[kind].amount" placeholder="金额（元）" style="width: 150px" :data-test="`price-${kind}-amount`" />
            <el-select v-model="form.prices[kind].taxBasis" style="width: 130px">
              <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
            </el-select>
            <el-input v-model="form.prices[kind].note" placeholder="备注（可空）" style="width: 200px" />
          </template>
        </div>

        <div class="p4-sub">依据与说明</div>
        <el-form-item label="依据文件（可后补）" data-guide="ml-adjustment-file"><input type="file" data-test="adjustment-file" @change="onFile" /></el-form-item>
        <el-form-item v-if="adjustment" label="修订原因" required>
          <el-input v-model="form.changeReason" data-test="adjustment-change-reason" placeholder="如：人工核对单据后补明确方向 / 基线移动后按原内容重新对准" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>

      <template v-if="result">
        <MidlongNotice :tone="result.status === 'PENDING_VERIFICATION' ? 'warn' : 'info'" :title="`登记完成：${statusTagOf(result.status).label}（调整 #${result.adjustmentId} v${result.revisionNo}，基线版本 v${result.baseRevisionNo}）`" data-guide="ml-adjustment-result" data-test="adjustment-result">
          <div>{{ directionLabel(result.direction) }}<template v-if="result.directionSource">（{{ result.directionSource === 'DOCUMENT_FIELD' ? '核验单据明确字段' : '显式映射登记' }}）</template>。</div>
          <div v-if="result.businessKeyReplay">{{ ADJUSTMENT_NOTICES.duplicateReplay }}</div>
          <div>交割段：{{ result.segments.map((s) => `${s.deliveryMonth} ${fmtQuantity(s.quantity)} MWh`).join('、') }}；确认生效后{{ result.direction === 'OBLIGATION_INCREASE' ? '增加' : '减少' }}各片段义务。</div>
          <div v-for="line in priceLines(result.prices)" :key="line">{{ line }}</div>
        </MidlongNotice>
        <MidlongNotice v-for="notice in result.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>
      </template>

      <MidlongNotice v-if="balanceError" tone="warn" title="可调余额加载失败" data-test="balance-error">{{ balanceError }}（仍可登记，生效时由服务端校验片段余额）</MidlongNotice>
      <MidlongNotice v-if="balance" tone="info" data-test="balance-notice">
        当前版本 v{{ balance.revisionNo }} 可调余额（{{ ADJUSTMENT_NOTICES.adjustableBalance }}）：
        {{ balance.months.map((m) => `${m.deliveryMonth} ${fmtQuantity(m.adjustableQuantity)} MWh${m.ended ? '（已结束）' : ''}`).join('；') || '该合同没有正式月度分解片段' }}
        <template v-if="balance.unallocatedQuantity && Number(balance.unallocatedQuantity) > 0">；另有未分解电量 {{ fmtQuantity(balance.unallocatedQuantity) }} MWh（{{ ADJUSTMENT_NOTICES.unallocatedPool }}）</template>
      </MidlongNotice>
      <MidlongNotice v-if="error" tone="danger" title="未能保存" data-test="adjustment-form-error">{{ error }}</MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="saving" :disabled="!valid" data-guide="ml-adjustment-submit" data-test="adjustment-submit" @click="submit">{{ adjustment ? '生成修订版本' : '登记（未生效）' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p4-form { display: flex; flex-direction: column; gap: 10px; }
.p4-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.p4-sub { margin: 6px 0 2px; font-size: var(--font-sm); color: var(--muted); }
.p4-segment { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.p4-balance { font-size: var(--font-sm); color: var(--muted); font-variant-numeric: tabular-nums; display: inline-flex; gap: 6px; align-items: center; }
.p4-price { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.p4-add { width: fit-content; margin-bottom: 8px; }
@media (max-width: 900px) { .p4-grid { grid-template-columns: 1fr; } }
</style>
