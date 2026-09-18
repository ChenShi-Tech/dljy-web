<script setup lang="ts">
// 确认单登记 / 修订（dljy#3014，MT-03..06）：登记外部成交确认单——结果状态（预成交/确认成交）、来源与确认编号、
// 逐交割段量价、依据文件（确认成交必填）；关联方案与关联合同为可选。
// 保存成功后展示「登记事实」结果：链接类型（创建义务 / 关联既有 → 同一义务只计一次）、占用转换逐月、
// 计划偏差与固定提示；platformAcceptance NOT_ASSERTED —— 页面不出现「平台已受理」。
// 本系统不自动登录或提交外部交易平台；来源不支持的产品填原文，登记后停在待核对。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import BeijingDateTimeInput from '../p3/BeijingDateTimeInput.vue'
import { registerConfirmation, reviseConfirmation, type ConfirmationInput } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { conversionReasonLabel, deviationRemainingLabel, executionFailureText, linkKindText, pendingReviewText } from '@/services/midlong/midlongP4Format'
import { EXECUTION_NOTICES, type ExecutionConfirmationDetailDto, type PlanDeviationRow, type RegisterConfirmationResultDto } from '@/services/midlong/midlongP4Types'
import type { MidlongSubject, PriceComponent, ProductKind, TaxBasis, TradeMethod } from '@/services/midlong/midlongTypes'
import { PRICE_COMPONENTS, PRICE_COMPONENT_LABELS, PRODUCT_KIND_LABELS, PRODUCT_KINDS, TAX_BASES, TAX_BASIS_LABELS, TRADE_METHOD_LABELS, TRADE_METHODS } from '@/services/midlong/midlongTypes'
import type { TradeProposalDetail } from '@/services/midlong/midlongP3Types'
import { isCompleteBeijingDateTimeInput } from '@/services/midlong/midlongP3Types'

const props = defineProps<{
  modelValue: boolean
  subjects: MidlongSubject[]
  /** 执行链路方案候选（服务端已排除草稿）；可空 = 不关联方案。 */
  proposals: TradeProposalDetail[]
  /** 修订模式：要修订的确认单详情（含 rowVersion）；null = 登记。 */
  confirmation?: ExecutionConfirmationDetailDto | null
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [number] }>()

type SegmentForm = { deliveryMonth: string; quantity: string; price: string }
const blank = () => ({
  subjectId: '' as string,
  sourceNamespace: '',
  confirmationNo: '',
  resultStatus: 'PRE_CLEARED' as 'PRE_CLEARED' | 'CLEARED',
  productMode: 'SUPPORTED' as 'SUPPORTED' | 'UNSUPPORTED',
  productKind: '' as ProductKind | '',
  tradeMethod: '' as TradeMethod | '',
  unsupportedProduct: '',
  priceTaxBasis: 'UNKNOWN' as TaxBasis,
  priceComponent: 'UNVERIFIED' as PriceComponent,
  externalConfirmedAt: '',
  counterpartyName: '',
  proposalId: '' as string,
  linkContractId: '' as string,
  note: '',
  changeReason: '',
  segments: [{ deliveryMonth: '', quantity: '', price: '' }] as SegmentForm[],
})
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const result = ref<RegisterConfirmationResultDto | null>(null)
// 写入会话：打开时快照范围与写入目标（登记 = 本表单；修订 = 确认单 id + 行版本），关闭或重开让进行中的保存失效。
// 目标标识不含表单字段：登记内容是打开后才填的，不能让填写本身改变写入目标。
const session = createWriteSession(() => (props.confirmation ? `revise:${props.confirmation.id}:${props.confirmation.rowVersion}` : 'register:new'))
onBeforeUnmount(() => session.close())

function reset() {
  Object.assign(form, blank())
  const base = props.confirmation
  if (base) {
    // 修订预填当前版本内容：来源与编号不可改（业务键），只改内容并必须给修订原因。
    const current = base.revisions.at(-1)
    form.subjectId = String(base.subjectId)
    form.sourceNamespace = base.sourceNamespace
    form.confirmationNo = base.confirmationNo
    form.resultStatus = base.resultStatus === 'CLEARED' ? 'CLEARED' : 'PRE_CLEARED'
    form.productMode = base.pendingReview ? 'UNSUPPORTED' : 'SUPPORTED'
    form.productKind = current?.productKind ?? ''
    form.tradeMethod = current?.tradeMethod ?? ''
    form.unsupportedProduct = current?.unsupportedProduct ?? ''
    form.priceTaxBasis = (current?.priceTaxBasis ?? 'UNKNOWN') as TaxBasis
    form.priceComponent = (current?.priceComponent ?? 'UNVERIFIED') as PriceComponent
    form.externalConfirmedAt = ''
    form.counterpartyName = ''
    form.proposalId = base.proposalId === null ? '' : String(base.proposalId)
    form.note = current?.note ?? ''
    form.changeReason = ''
    form.segments = (current?.segments.length ? current.segments : [{ deliveryMonth: '', quantity: '', price: '' }]).map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity, price: s.price ?? '' }))
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
}, { immediate: true })

function addSegment() { form.segments.push({ deliveryMonth: '', quantity: '', price: '' }) }
function removeSegment(index: number) { if (form.segments.length > 1) form.segments.splice(index, 1) }

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; input.value = ''; file.value = null; return }
  file.value = selected
}

const confirmedAtIncomplete = computed(() => form.externalConfirmedAt !== '' && !isCompleteBeijingDateTimeInput(form.externalConfirmedAt))
const segmentsValid = computed(() => form.segments.length > 0 && form.segments.every((s) => /^\d{4}-\d{2}$/.test(s.deliveryMonth) && s.quantity.trim() !== '' && Number(s.quantity) > 0))
const productValid = computed(() => form.productMode === 'UNSUPPORTED' ? form.unsupportedProduct.trim() !== '' : true)
const valid = computed(() =>
  form.subjectId !== '' && form.sourceNamespace.trim() !== '' && form.confirmationNo.trim() !== ''
  && segmentsValid.value && productValid.value && !confirmedAtIncomplete.value
  && (form.resultStatus !== 'CLEARED' || file.value !== null)
  && (!props.confirmation || form.changeReason.trim() !== ''))

/** 依据文件必填只对确认成交（预成交登记可不附，后端同样校验）。 */
const fileRequired = computed(() => form.resultStatus === 'CLEARED')

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  // 写入目标与表单值在点保存时同步读取；await 之后只核对，不再读 props 或表单。
  const ticket = session.begin()
  const target = props.confirmation
  const fields = {
    subjectId: Number(form.subjectId),
    sourceNamespace: form.sourceNamespace.trim(),
    confirmationNo: form.confirmationNo.trim(),
    resultStatus: form.resultStatus,
    productKind: form.productMode === 'SUPPORTED' && form.productKind ? form.productKind : null,
    tradeMethod: form.tradeMethod || null,
    unsupportedProduct: form.productMode === 'UNSUPPORTED' ? form.unsupportedProduct.trim() : null,
    priceTaxBasis: form.priceTaxBasis,
    priceComponent: form.priceComponent,
    externalConfirmedAt: form.externalConfirmedAt || null,
    counterpartyName: form.counterpartyName.trim() || null,
    proposalId: form.proposalId === '' ? null : Number(form.proposalId),
    // 修订不换关联合同（补关联走详情里的「关联合同」），登记时才允许显式指定。
    linkContractId: !target && form.linkContractId !== '' ? Number(form.linkContractId) : null,
    note: form.note.trim() || null,
    segments: form.segments.map((s) => ({ deliveryMonth: s.deliveryMonth, quantity: s.quantity.trim(), price: s.price.trim() || null })),
  }
  const selected = file.value
  try {
    ticket.assertCurrent()
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    ticket.assertCurrent()
    const input: ConfirmationInput = { ...fields, file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null }
    const saved = target
      ? await reviseConfirmation(target.id, { ...input, expectedRowVersion: target.rowVersion, changeReason: form.changeReason.trim() })
      : await registerConfirmation(input)
    ElMessage.success(target ? '确认单修订已登记（旧版本保留）' : '确认单已登记')
    emit('saved', saved.confirmationId)
    // 写请求返回前表单已关闭或重开：结果属于上一次打开，不显示到当前表单。
    if (ticket.sameSession()) result.value = saved
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = executionFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的确认单保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}

const deviationRows = (report: RegisterConfirmationResultDto | null): PlanDeviationRow[] => report?.deviation?.rows ?? []
</script>

<template>
  <el-dialog
    :model-value="modelValue" :title="confirmation ? `修订确认单 #${confirmation.id}（生成新版本）` : '登记成交确认单'"
    width="880px" top="4vh" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="p4-form">
      <MidlongNotice tone="info">
        {{ form.resultStatus === 'CLEARED' ? EXECUTION_NOTICES.clearedAtomic : EXECUTION_NOTICES.preClearedNotFormal }}
        登记只记录外部结果事实，不等于平台已受理，也不自动操作外部交易平台。
      </MidlongNotice>
      <el-form label-width="130px" @submit.prevent>
        <div class="p4-grid">
          <el-form-item label="交易主体" required>
            <el-select v-model="form.subjectId" :disabled="Boolean(confirmation)" placeholder="选择主体" filterable data-test="subject">
              <el-option v-for="s in subjects" :key="s.id" :label="`${s.displayName}（${s.subjectKey}）`" :value="String(s.id)" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源" required>
            <el-input v-model="form.sourceNamespace" :disabled="Boolean(confirmation)" placeholder="如：昆明交易中心" data-test="source-namespace" />
          </el-form-item>
          <el-form-item label="外部确认编号" required>
            <el-input v-model="form.confirmationNo" :disabled="Boolean(confirmation)" data-test="confirmation-no" />
          </el-form-item>
          <el-form-item label="确认结果" required>
            <el-radio-group v-model="form.resultStatus" data-test="result-status">
              <el-radio-button value="PRE_CLEARED">预成交</el-radio-button>
              <el-radio-button value="CLEARED">确认成交</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="外部确认时刻">
            <BeijingDateTimeInput v-model="form.externalConfirmedAt" />
          </el-form-item>
          <el-form-item label="交易对手">
            <el-input v-model="form.counterpartyName" placeholder="可空（创建合同义务时使用）" />
          </el-form-item>
          <el-form-item label="关联方案">
            <el-select v-model="form.proposalId" clearable placeholder="可空" filterable data-test="proposal">
              <el-option v-for="p in proposals" :key="p.id" :label="`#${p.id} ${p.subjectName ?? ''} · ${fmtQuantity(p.totalQuantity)} MWh`" :value="String(p.id)" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="!confirmation" label="关联合同">
            <el-input v-model="form.linkContractId" placeholder="可空：显式关联既有合同 ID" data-test="link-contract" />
          </el-form-item>
        </div>

        <div class="p4-sub">品种与方式（创建合同义务必需；来源不支持的产品填原文，登记后停在待核对）</div>
        <div class="p4-grid">
          <el-form-item label="品种周期">
            <el-radio-group v-model="form.productMode" data-test="product-mode">
              <el-radio-button value="SUPPORTED">支持品种</el-radio-button>
              <el-radio-button value="UNSUPPORTED">不支持（原文）</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.productMode === 'SUPPORTED'" label="交易品种">
            <el-select v-model="form.productKind" clearable>
              <el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item v-else label="来源产品原文" required>
            <el-input v-model="form.unsupportedProduct" placeholder="照抄确认单上的产品名称" data-test="unsupported-product" />
          </el-form-item>
          <el-form-item label="交易方式">
            <el-select v-model="form.tradeMethod" clearable>
              <el-option v-for="m in TRADE_METHODS" :key="m" :label="TRADE_METHOD_LABELS[m]" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item label="价格含税口径">
            <el-select v-model="form.priceTaxBasis">
              <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="价格构成">
            <el-select v-model="form.priceComponent">
              <el-option v-for="c in PRICE_COMPONENTS" :key="c" :label="PRICE_COMPONENT_LABELS[c]" :value="c" />
            </el-select>
          </el-form-item>
        </div>

        <div class="p4-sub">交割段（各月实际成交量与价格；价格可空 = 价格未知，不编价）</div>
        <div v-for="(s, i) in form.segments" :key="i" class="p4-segment">
          <el-date-picker v-model="s.deliveryMonth" type="month" value-format="YYYY-MM" placeholder="交割月" style="width: 130px" :data-test="`segment-month-${i}`" />
          <el-input v-model="s.quantity" placeholder="电量 MWh" style="width: 150px" :data-test="`segment-quantity-${i}`" />
          <el-input v-model="s.price" placeholder="价格 元/MWh（可空）" style="width: 180px" :data-test="`segment-price-${i}`" />
          <el-button v-if="form.segments.length > 1" link type="danger" @click="removeSegment(i)">删除</el-button>
        </div>
        <el-button link type="primary" class="p4-add" @click="addSegment">+ 添加交割段</el-button>

        <div class="p4-sub">依据与说明</div>
        <el-form-item :label="fileRequired ? '确认单文件（必填）' : '确认单文件（预成交可后补）'">
          <input type="file" :data-test="`file-input-${fileRequired ? 'required' : 'optional'}`" @change="onFile" />
        </el-form-item>
        <el-form-item v-if="confirmation" label="修订原因" required>
          <el-input v-model="form.changeReason" placeholder="如：预成交转确认成交 / 量价按正式结果修订" data-test="change-reason" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>

      <template v-if="result">
        <MidlongNotice tone="info" :title="`登记完成：${result.resultStatus === 'CLEARED' ? '确认成交' : '预成交'}（确认单 #${result.confirmationId} v${result.revisionNo}）`" data-test="register-result">
          <div>{{ linkKindText(result.linkKind) }}<template v-if="result.contractId">，<router-link :to="`/zcqjy/contracts/${result.contractId}`" class="p4-link">查看合同 #{{ result.contractId }}</router-link></template>。</div>
          <div v-if="result.businessKeyReplay">{{ EXECUTION_NOTICES.duplicateReplay }}</div>
          <div v-if="result.linkKind === 'EXISTING_LINKED'">{{ EXECUTION_NOTICES.linkNoDoubleCount }}</div>
          <div v-if="result.pendingReview" data-test="pending-review">{{ pendingReviewText(result.pendingReview.raw) }} {{ EXECUTION_NOTICES.unsupportedProduct }}</div>
          <div v-if="result.conversion?.months?.length">
            占用转换（合计 {{ fmtQuantity(result.conversion.totalDelta) }} MWh）：
            <span v-for="m in result.conversion.months" :key="m.deliveryMonth" class="p4-chip">
              {{ m.deliveryMonth }} {{ fmtQuantity(m.delta) }} MWh（{{ conversionReasonLabel(m.reason) }}）
            </span>
          </div>
        </MidlongNotice>
        <div v-if="deviationRows(result).length" class="p4-panel" data-test="deviation-rows">
          <h4>计划偏差（重算后）</h4>
          <div v-for="row in deviationRows(result)" :key="row.planId" class="p4-deviation">
            {{ row.periodKey }}：本次成交 {{ fmtQuantity(row.confirmedQuantityInPeriod) }} MWh，
            已售（已知）{{ row.knownSoldQuantityAfter === null ? '待核验' : fmtQuantity(row.knownSoldQuantityAfter) }} MWh，
            剩余计划待售量 {{ deviationRemainingLabel(row) }}<el-tag v-if="row.overPlan" size="small" type="danger">超计划</el-tag>
          </div>
        </div>
        <MidlongNotice v-for="notice in result.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>
      </template>

      <MidlongNotice v-if="confirmedAtIncomplete" tone="warn">外部确认时刻须同时填写日期与时:分，不能只选日期。</MidlongNotice>
      <MidlongNotice v-if="error" tone="danger" title="未能保存" data-test="form-error">{{ error }}</MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="saving" :disabled="!valid" data-test="submit" @click="submit">{{ confirmation ? '生成修订版本' : '登记' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p4-form { display: flex; flex-direction: column; gap: 10px; }
.p4-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.p4-sub { margin: 6px 0 2px; font-size: var(--font-sm); color: var(--muted); }
.p4-segment { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.p4-add { width: fit-content; margin-bottom: 8px; }
.p4-link { color: var(--accent); }
.p4-chip { display: inline-block; margin: 0 8px 4px 0; padding: 2px 8px; border: 1px solid var(--line); border-radius: 10px; font-size: var(--font-sm); }
.p4-panel { border: 1px solid var(--line); border-radius: var(--radius, 8px); padding: 10px 12px; background: var(--panel); }
.p4-panel h4 { margin: 0 0 6px; font-size: var(--font-md); }
.p4-deviation { font-size: var(--font-md); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
@media (max-width: 900px) { .p4-grid { grid-template-columns: 1fr; } }
</style>
