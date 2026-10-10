<script setup lang="ts">
// 量价差异登记对话框（dljy#3016，MR-04）：指定主体 + 交割月 + 外部账单，两侧快照与差值由服务端计算
// （台账侧 = P1 持仓该月正式分解，外部侧 = 账单当前版本该月中长期分项；差值「外部 − 台账」如实）。
// 前端只提交比对目标与处理线索（原因/负责人/证据文件）；登记不自动改台账。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchBills, registerDiscrepancy } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { DISCREPANCY_BASIS_TEXT, settlementFailureText } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_NOTICES, type BillSummaryRow, type DiscrepancyRegisterResult } from '@/services/midlong/midlongP5Types'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; subjects: MidlongSubject[]; presetMonth?: string | null }>()
// 操作导引（dljy#3407）：差异表单接给「调整与复盘账单」导引，登记成功发含 discrepancyId 的推进信号。
import { emitGuideSignal, useGuideForm } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()

const blank = () => ({ subjectId: null as number | null, billId: null as number | null, deliveryMonth: props.presetMonth ?? '', reason: '', ownerName: '' })
const form = reactive(blank())
const evidence = ref<File[]>([])
const saving = ref(false)
const error = ref('')
const result = ref<DiscrepancyRegisterResult | null>(null)

// 操作导引（dljy#3407）
useGuideForm(
  FORM.discrepancyRegister,
  {
    read: () => ({ ...form, evidenceCount: evidence.value.length, subjectOptions: props.subjects.map((s) => s.id), subjectsReady: props.subjects.length > 0 }),
    fill: (values) => {
      for (const [key, value] of Object.entries(values)) (form as unknown as Record<string, unknown>)[key] = value
    },
  },
  { active: () => props.modelValue },
)
const bills = ref<BillSummaryRow[]>([])
const billsLoading = ref(false)
const billsError = ref('')
// 写入会话：登记 = 本对话框的一次登记（比对目标进幂等键，不随表单填写变化）。关闭或重开让进行中的保存失效
//（读证据文件期间点取消不写入）。
const session = createWriteSession(() => 'register')
onBeforeUnmount(() => session.close())

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  Object.assign(form, blank())
  evidence.value = []
  saving.value = false
  error.value = ''
  result.value = null
  bills.value = []
  billsError.value = ''
}, { immediate: true })

/** 选主体后取该主体的账单候选（有分项的可比；综合账单服务端会 INCOMPLETE_BASIS 拒绝，候选里明确标注）。 */
watch(() => form.subjectId, async (subjectId) => {
  form.billId = null
  if (!subjectId) { bills.value = []; return }
  billsLoading.value = true
  billsError.value = ''
  try {
    const page = await fetchBills({ subjectId, pageSize: 100 })
    bills.value = page.rows
  } catch (e) {
    bills.value = []
    billsError.value = midlongFailureOf(e).message
  } finally {
    billsLoading.value = false
  }
})

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files ?? [])]
  for (const file of selected) {
    const oversize = oversizeUploadMessage(file)
    if (oversize) { error.value = oversize; input.value = ''; return }
  }
  evidence.value = [...evidence.value, ...selected]
  input.value = ''
}
function removeEvidence(index: number) { evidence.value.splice(index, 1) }

const valid = computed(() => form.subjectId !== null && form.billId !== null && /^\d{4}-\d{2}$/.test(form.deliveryMonth))

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  const ticket = session.begin()
  const target = { subjectId: form.subjectId!, deliveryMonth: form.deliveryMonth, billId: form.billId!, reason: form.reason.trim() || null, ownerName: form.ownerName.trim() || null }
  const files = [...evidence.value]
  try {
    ticket.assertCurrent()
    const uploads = []
    for (const file of files) {
      uploads.push({ fileName: file.name, contentBase64: await fileToBase64(file), mediaType: file.type || null })
      ticket.assertCurrent()
    }
    const saved = await registerDiscrepancy({ ...target, evidence: uploads.length ? uploads : null })
    ElMessage.success(`差异 #${saved.id} 已登记（不自动改台账）`)
    emit('saved')
    // 操作导引（dljy#3407）：登记成功发含 discrepancyId 的推进信号。
    emitGuideSignal(SIGNAL.discrepancySaved, { discrepancyId: saved.id, quantityDelta: saved.quantityDelta, status: saved.status })
    if (ticket.sameSession()) result.value = saved
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = settlementFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的差异登记失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="登记量价差异（服务端计算两侧快照）" width="720px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="p5-form">
      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.consistencyNotRecompute }} {{ SETTLEMENT_NOTICES.discrepancyNoAutoLedger }}</MidlongNotice>
      <el-form label-width="130px" @submit.prevent>
        <div class="p5-grid">
          <el-form-item label="交易主体" required data-guide="ml-discrepancy-subject">
            <el-select v-model="form.subjectId" filterable placeholder="选择主体" style="width: 240px" data-test="discrepancy-subject">
              <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="交割月" required data-guide="ml-discrepancy-month">
            <el-date-picker v-model="form.deliveryMonth" type="month" value-format="YYYY-MM" placeholder="YYYY-MM" style="width: 140px" data-test="discrepancy-month" />
          </el-form-item>
        </div>
        <el-form-item label="比对的外部账单" required data-guide="ml-discrepancy-bill">
          <el-select v-model="form.billId" filterable :loading="billsLoading" placeholder="选择账单（该主体名下）" style="width: 420px" data-test="discrepancy-bill">
            <el-option v-for="b in bills" :key="b.id" :value="b.id" :label="`#${b.id} ${b.sourceNamespace} / ${b.externalBillNo}（${b.billKind === 'UNITEMIZED' ? '综合账单未分项，无可比基础' : `v${b.currentRevisionNo} · ${b.periodStartMonth ?? '?'}—${b.periodEndMonth ?? '?'}`}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="差异原因（可后补）"><el-input v-model="form.reason" type="textarea" :rows="2" placeholder="如：计量周期差异 / 待与交易中心核对" data-test="discrepancy-reason" /></el-form-item>
        <el-form-item label="负责人（可后补）"><el-input v-model="form.ownerName" style="width: 200px" data-test="discrepancy-owner" /></el-form-item>
        <el-form-item label="证据文件（可多选）">
          <input type="file" multiple data-test="discrepancy-evidence" @change="onFiles" />
          <div v-for="(file, i) in evidence" :key="file.name" class="p5-file-chip">{{ file.name }} <el-button link type="danger" size="small" @click="removeEvidence(i)">移除</el-button></div>
        </el-form-item>
      </el-form>

      <template v-if="result">
        <MidlongNotice tone="warn" :title="`差异 #${result.id} 已登记：量差 ${result.quantityDelta ?? '未知'} MWh${result.priceDelta !== null ? ` · 价差 ${result.priceDelta} 元/MWh` : ' · 价格不可比'}`" data-guide="ml-discrepancy-result" data-test="discrepancy-result">
          <div>差值口径：{{ result.basis }}</div>
          <div v-if="result.comparableSides.length">可比性：{{ result.comparableSides.join('；') }}</div>
          <div v-for="notice in result.notices" :key="notice">{{ notice }}</div>
        </MidlongNotice>
      </template>
      <MidlongNotice v-if="billsError" tone="warn" title="账单候选加载失败" data-test="discrepancy-bills-error">{{ billsError }} <el-button link type="primary" @click="form.subjectId = form.subjectId">重试</el-button></MidlongNotice>
      <MidlongNotice v-if="error" tone="danger" title="未能登记" data-test="discrepancy-form-error">{{ error }}</MidlongNotice>
      <div class="p5-muted">差值口径固定：{{ DISCREPANCY_BASIS_TEXT }}</div>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="saving" :disabled="!valid" data-guide="ml-discrepancy-submit" data-test="discrepancy-submit" @click="submit">登记（不自动改台账）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p5-form { display: flex; flex-direction: column; gap: 10px; }
.p5-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.p5-file-chip { display: inline-flex; gap: 6px; align-items: center; font-size: var(--font-sm); color: var(--muted); }
.p5-muted { color: var(--muted); font-size: var(--font-sm); }
</style>
