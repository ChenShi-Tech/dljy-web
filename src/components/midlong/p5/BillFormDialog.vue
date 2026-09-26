<script setup lang="ts">
// 外部账单登记 / 修订对话框（dljy#3016，MR-03）：
// - 编号/来源/主体/期间（月粒度）/外部修订标识/总金额/金额口径（币种 CNY、含税口径、价格构成）；
// - 有中长期明确分项（ITEMIZED）至少一条分项：交割月可空 = 期间合计行（不强制按月拆分），量/价/金额按外部账单明确给出的登记、不推算；
// - 综合账单（UNITEMIZED）只归档并标未分项：表单不提供分项输入（携带分项会被服务端 422 UNITEMIZED_BILL_NO_SPLIT）；
// - 修订模式：业务键（主体+来源+外部编号）不可换，必填修订原因与 expectedRowVersion；旧版保留、金额聚合只取当前有效版本。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { registerBill, reviseBill } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { settlementFailureText } from '@/services/midlong/midlongP5Format'
import {
  BILL_KIND_LABELS, BILL_KINDS, SETTLEMENT_NOTICES,
  type BillDetailDto, type BillKind, type BillRegisterInput, type BillRegisterResult, type BillReviseResult,
} from '@/services/midlong/midlongP5Types'
import { PRICE_COMPONENTS, PRICE_COMPONENT_LABELS, TAX_BASES, TAX_BASIS_LABELS, type MidlongSubject, type PriceComponent, type TaxBasis } from '@/services/midlong/midlongTypes'

const props = defineProps<{
  modelValue: boolean
  subjects: MidlongSubject[]
  /** 修订模式：要修订的账单详情（含 rowVersion 与全部版本）；null = 登记。 */
  bill?: BillDetailDto | null
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [number] }>()

type LineItemForm = { deliveryMonth: string; quantity: string; price: string; amount: string; note: string }
const blank = () => ({
  subjectId: null as number | null,
  sourceNamespace: '',
  externalBillNo: '',
  billKind: 'ITEMIZED' as BillKind,
  sourceName: '',
  externalRevisionLabel: '',
  periodStartMonth: '',
  periodEndMonth: '',
  taxBasis: 'UNKNOWN' as TaxBasis | 'UNKNOWN',
  priceComponent: 'UNVERIFIED' as PriceComponent | 'UNVERIFIED',
  amount: '',
  note: '',
  changeReason: '',
  lineItems: [{ deliveryMonth: '', quantity: '', price: '', amount: '', note: '' }] as LineItemForm[],
})
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const result = ref<BillRegisterResult | BillReviseResult | null>(null)
const reviseResult = ref<BillReviseResult | null>(null)
// 写入会话：登记 = 本对话框的一次登记（业务身份进幂等键，不随表单填写变化）；修订 = 账单 id + 行版本。
// 关闭或重开让进行中的保存失效（读取账单原件期间点取消不会写入）。
const session = createWriteSession(() => (props.bill ? `revise:${props.bill.id}:${props.bill.rowVersion}` : 'register'))
onBeforeUnmount(() => session.close())

function reset() {
  Object.assign(form, blank())
  const base = props.bill
  if (base) {
    const current = base.revisions.find((r) => r.revisionNo === base.currentRevisionNo) ?? base.revisions.at(-1)
    form.subjectId = base.subjectId
    form.sourceNamespace = base.sourceNamespace
    form.externalBillNo = base.externalBillNo
    form.billKind = (current?.billKind ?? 'ITEMIZED') as BillKind
    form.sourceName = current?.sourceName ?? ''
    form.externalRevisionLabel = current?.externalRevisionLabel ?? ''
    form.periodStartMonth = current?.periodStartMonth ?? ''
    form.periodEndMonth = current?.periodEndMonth ?? ''
    form.taxBasis = (current?.taxBasis ?? 'UNKNOWN') as TaxBasis | 'UNKNOWN'
    form.priceComponent = (current?.priceComponent ?? 'UNVERIFIED') as PriceComponent | 'UNVERIFIED'
    form.amount = current?.amount ?? ''
    form.note = current?.note ?? ''
    form.lineItems = (current?.lineItems.length ? current.lineItems : [{ id: 0, deliveryMonth: null, quantity: null, price: null, amount: null, note: null }])
      .map((i) => ({ deliveryMonth: i.deliveryMonth ?? '', quantity: i.quantity ?? '', price: i.price ?? '', amount: i.amount ?? '', note: i.note ?? '' }))
  }
  file.value = null
  saving.value = false
  error.value = ''
  result.value = null
  reviseResult.value = null
}

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  reset()
}, { immediate: true })

function addItem() { form.lineItems.push({ deliveryMonth: '', quantity: '', price: '', amount: '', note: '' }) }
function removeItem(index: number) { if (form.lineItems.length > 1) form.lineItems.splice(index, 1) }

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; input.value = ''; file.value = null; return }
  file.value = selected
}

/** 分项校验：ITEMIZED 至少一行且每行「电量或金额至少一项」；交割月可空（= 期间合计）、非空时须落在期间内。 */
const lineItemsValid = computed(() => {
  if (form.billKind === 'UNITEMIZED') return true
  if (!form.lineItems.length) return false
  return form.lineItems.every((i) => (i.quantity.trim() !== '' || i.amount.trim() !== '')
    && (i.deliveryMonth === '' || /^\d{4}-\d{2}$/.test(i.deliveryMonth)))
})

const valid = computed(() =>
  form.subjectId !== null
  && form.sourceNamespace.trim() !== '' && form.externalBillNo.trim() !== ''
  && /^\d{4}-\d{2}$/.test(form.periodStartMonth) && /^\d{4}-\d{2}$/.test(form.periodEndMonth)
  && form.periodEndMonth >= form.periodStartMonth
  && form.amount.trim() !== '' && Number(form.amount) >= 0
  && lineItemsValid.value
  && (!props.bill || form.changeReason.trim() !== ''))

function lineItemsInput() {
  // UNITEMIZED 绝不携带分项（MR-03：服务端 422 UNITEMIZED_BILL_NO_SPLIT 双保险）。
  if (form.billKind === 'UNITEMIZED') return []
  return form.lineItems.map((i) => ({
    deliveryMonth: i.deliveryMonth || null,
    quantity: i.quantity.trim() || null,
    price: i.price.trim() || null,
    amount: i.amount.trim() || null,
    note: i.note.trim() || null,
  }))
}

async function submit() {
  if (!valid.value || saving.value || form.subjectId === null) return
  saving.value = true
  error.value = ''
  const ticket = session.begin()
  const target = props.bill
  const fields: BillRegisterInput = {
    subjectId: form.subjectId,
    sourceNamespace: form.sourceNamespace.trim(),
    externalBillNo: form.externalBillNo.trim(),
    billKind: form.billKind,
    sourceName: form.sourceName.trim() || null,
    externalRevisionLabel: form.externalRevisionLabel.trim() || null,
    periodStartMonth: form.periodStartMonth,
    periodEndMonth: form.periodEndMonth,
    currency: 'CNY',
    taxBasis: form.taxBasis,
    priceComponent: form.priceComponent,
    amount: form.amount.trim(),
    note: form.note.trim() || null,
    lineItems: lineItemsInput(),
  }
  const selected = file.value
  try {
    ticket.assertCurrent()
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    ticket.assertCurrent()
    const input = { ...fields, file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null }
    const saved = target
      ? await reviseBill(target.id, { ...input, expectedRowVersion: target.rowVersion, changeReason: form.changeReason.trim() })
      : await registerBill(input)
    if (target) {
      reviseResult.value = saved as BillReviseResult
      result.value = null
      ElMessage.success(`账单修订已登记：v${(saved as BillReviseResult).revisionNo}（旧版保留，金额聚合改按新当前版本）`)
    } else {
      result.value = saved
      ElMessage.success(saved.businessKeyReplay ? '同一外部账单重复处理：已链接既有记录，金额不重复累计' : '外部账单已登记')
    }
    emit('saved', 'billId' in saved ? saved.billId : 0)
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = settlementFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的账单保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue" :title="bill ? `修订外部账单 #${bill.id}（生成新版本）` : '登记外部账单'" width="920px" top="4vh" append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="p5-form">
      <MidlongNotice tone="info">
        {{ SETTLEMENT_NOTICES.threeAmounts }} 账单金额按当前有效版本累计：同号修订旧版保留、两版不重复相加。
      </MidlongNotice>
      <el-form label-width="150px" @submit.prevent>
        <div class="p5-grid">
          <el-form-item label="所属交易主体" required>
            <el-select v-model="form.subjectId" filterable placeholder="选择主体" :disabled="Boolean(bill)" style="width: 240px" data-test="bill-subject">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源" required>
            <el-input v-model="form.sourceNamespace" :disabled="Boolean(bill)" placeholder="如：昆明交易中心 / MANUAL" data-test="bill-source" />
          </el-form-item>
          <el-form-item label="外部账单编号" required>
            <el-input v-model="form.externalBillNo" :disabled="Boolean(bill)" data-test="bill-no" />
          </el-form-item>
          <el-form-item label="账单形态" required>
            <el-radio-group v-model="form.billKind" data-test="bill-kind">
              <el-radio v-for="k in BILL_KINDS" :key="k" :value="k">{{ BILL_KIND_LABELS[k] }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="期间（起始月）" required>
            <el-date-picker v-model="form.periodStartMonth" type="month" value-format="YYYY-MM" placeholder="YYYY-MM" style="width: 140px" data-test="bill-period-start" />
          </el-form-item>
          <el-form-item label="期间（结束月）" required>
            <el-date-picker v-model="form.periodEndMonth" type="month" value-format="YYYY-MM" placeholder="YYYY-MM" style="width: 140px" data-test="bill-period-end" />
          </el-form-item>
          <el-form-item label="账单总金额(元)" required>
            <el-input v-model="form.amount" placeholder="十进制，最多 6 位小数" style="width: 200px" data-test="bill-amount" />
          </el-form-item>
          <el-form-item label="外部修订标识">
            <el-input v-model="form.externalRevisionLabel" placeholder="可空；外部更正版本的标识留档" style="width: 200px" data-test="bill-revision-label" />
          </el-form-item>
          <el-form-item label="金额含税口径">
            <el-select v-model="form.taxBasis" style="width: 140px" data-test="bill-tax-basis">
              <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="价格构成">
            <el-select v-model="form.priceComponent" style="width: 200px" data-test="bill-price-component">
              <el-option v-for="p in PRICE_COMPONENTS" :key="p" :label="PRICE_COMPONENT_LABELS[p]" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item label="来源名称"><el-input v-model="form.sourceName" placeholder="可空（出具方名称）" style="width: 200px" /></el-form-item>
          <el-form-item label="币种"><el-input value="CNY" disabled style="width: 100px" /></el-form-item>
        </div>

        <MidlongNotice v-if="form.billKind === 'UNITEMIZED'" tone="warn" data-test="unitemized-hint">
          {{ SETTLEMENT_NOTICES.unitemizedArchive }}
        </MidlongNotice>

        <template v-if="form.billKind === 'ITEMIZED'">
          <div class="p5-sub">中长期明确分项（至少一条；交割月可空 = 期间合计行；只登记外部账单上明确给出的行，不做任何推算）</div>
          <div v-for="(item, i) in form.lineItems" :key="i" class="p5-item">
            <el-date-picker v-model="item.deliveryMonth" type="month" value-format="YYYY-MM" placeholder="交割月（可空=期间合计）" style="width: 190px" :data-test="`bill-item-month-${i}`" />
            <el-input v-model="item.quantity" placeholder="电量 MWh（可空）" style="width: 150px" :data-test="`bill-item-quantity-${i}`" />
            <el-input v-model="item.price" placeholder="单价 元/MWh（可空）" style="width: 150px" :data-test="`bill-item-price-${i}`" />
            <el-input v-model="item.amount" placeholder="金额 元（与电量至少一项）" style="width: 180px" :data-test="`bill-item-amount-${i}`" />
            <el-input v-model="item.note" placeholder="备注（可空）" style="width: 140px" />
            <el-button v-if="form.lineItems.length > 1" link type="danger" @click="removeItem(i)">删除</el-button>
          </div>
          <el-button link type="primary" class="p5-add" data-test="bill-add-item" @click="addItem">+ 添加分项</el-button>
        </template>

        <div class="p5-sub">依据与说明</div>
        <el-form-item label="账单原件"><input type="file" data-test="bill-file" @change="onFile" /></el-form-item>
        <el-form-item v-if="bill" label="修订原因" required>
          <el-input v-model="form.changeReason" placeholder="如：收到更正版本 C-2026-001-R2" data-test="bill-change-reason" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>

      <template v-if="result">
        <MidlongNotice tone="info" :title="`登记完成：账单 #${result.billId} v${result.revisionNo}${result.businessKeyReplay ? '（重复处理回放，金额不重复累计）' : ''}`" data-test="bill-result">
          <div v-for="notice in result.notices" :key="notice">{{ notice }}</div>
        </MidlongNotice>
      </template>
      <template v-if="reviseResult">
        <MidlongNotice tone="warn" :title="`修订完成：账单 #${reviseResult.billId} v${reviseResult.revisionNo}（旧版保留）`" data-test="bill-revise-result">
          <div v-for="notice in reviseResult.notices" :key="notice">{{ notice }}</div>
          <div v-if="reviseResult.recheckedDiscrepancies.length">
            已转「需重新核对」的差异：{{ reviseResult.recheckedDiscrepancies.map((d) => `#${d.discrepancyId}（${d.deliveryMonth ?? '？'}${d.wasResolved ? '，原已解决的登记快照保持冻结' : '，外部侧快照已按新版本刷新'}）`).join('、') }}
          </div>
        </MidlongNotice>
      </template>
      <MidlongNotice v-if="error" tone="danger" title="未能保存" data-test="bill-form-error">{{ error }}</MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result || reviseResult ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result && !reviseResult" type="primary" :loading="saving" :disabled="!valid" data-test="bill-submit" @click="submit">{{ bill ? '生成修订版本' : '登记' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p5-form { display: flex; flex-direction: column; gap: 10px; }
.p5-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.p5-sub { margin: 6px 0 2px; font-size: var(--font-sm); color: var(--muted); }
.p5-item { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.p5-add { width: fit-content; margin-bottom: 8px; }
@media (max-width: 960px) { .p5-grid { grid-template-columns: 1fr; } }
</style>
