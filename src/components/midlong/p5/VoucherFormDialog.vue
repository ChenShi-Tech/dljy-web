<script setup lang="ts">
// 收款凭证登记对话框（dljy#3016，MR-02）：凭证编号、金额（>0）、收款日期必填，文件可选；只追加。
// 无凭证不显示到账——凭证（编号+金额+日期+文件）是到账依据，账单金额本身不代表已收款。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { addVoucher } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { settlementFailureText } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_NOTICES, type VoucherResult } from '@/services/midlong/midlongP5Types'

const props = defineProps<{ modelValue: boolean; billId: number | null; billLabel?: string }>()
// 操作导引（dljy#3407）：凭证表单接给「调整与复盘账单」导引，登记成功发含 voucherId 的推进信号。
import { emitGuideSignal, useGuideForm } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()

const blank = () => ({ voucherNo: '', amount: '', receivedAt: '', note: '' })
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const result = ref<VoucherResult | null>(null)

// 操作导引（dljy#3407）
useGuideForm(
  FORM.voucherRegister,
  {
    read: () => ({ ...form, hasFile: file.value !== null }),
    fill: (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (key === 'file') file.value = value as File | null
        else (form as unknown as Record<string, unknown>)[key] = value
      }
    },
  },
  { active: () => props.modelValue },
)
const session = createWriteSession(() => `voucher:${props.billId}`)
onBeforeUnmount(() => session.close())

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  Object.assign(form, blank())
  file.value = null
  saving.value = false
  error.value = ''
  result.value = null
}, { immediate: true })

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; input.value = ''; file.value = null; return }
  file.value = selected
}

const valid = computed(() => form.voucherNo.trim() !== '' && form.amount.trim() !== '' && Number(form.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.receivedAt))

async function submit() {
  if (!valid.value || saving.value || !props.billId) return
  saving.value = true
  error.value = ''
  const ticket = session.begin()
  const selected = file.value
  try {
    ticket.assertCurrent()
    const contentBase64 = selected ? await fileToBase64(selected) : ''
    ticket.assertCurrent()
    const saved = await addVoucher(props.billId, {
      voucherNo: form.voucherNo.trim(),
      amount: form.amount.trim(),
      receivedAt: form.receivedAt,
      note: form.note.trim() || null,
      file: selected ? { fileName: selected.name, contentBase64, mediaType: selected.type || null } : null,
    })
    ElMessage.success('收款凭证已登记（到账金额以凭证为准）')
    emit('saved')
    // 操作导引（dljy#3407）：登记成功发含 voucherId 的推进信号。
    emitGuideSignal(SIGNAL.voucherSaved, { billId: saved.billId, voucherId: saved.voucherId, voucherNo: saved.voucherNo, amount: saved.amount })
    if (ticket.sameSession()) result.value = saved
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = settlementFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的凭证保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="`登记收款凭证${billLabel ? `（${billLabel}）` : ''}`" width="600px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="p5-form">
      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.noVoucherNoReceipt }}</MidlongNotice>
      <el-form label-width="120px" @submit.prevent>
        <el-form-item label="凭证编号" required data-guide="ml-voucher-no"><el-input v-model="form.voucherNo" data-test="voucher-no" /></el-form-item>
        <el-form-item label="收款金额(元)" required data-guide="ml-voucher-amount"><el-input v-model="form.amount" placeholder="大于 0" style="width: 200px" data-test="voucher-amount" /></el-form-item>
        <el-form-item label="收款日期" required data-guide="ml-voucher-date">
          <el-date-picker v-model="form.receivedAt" type="date" value-format="YYYY-MM-DD" placeholder="YYYY-MM-DD" style="width: 170px" data-test="voucher-date" />
        </el-form-item>
        <el-form-item label="凭证文件"><input type="file" data-guide="ml-voucher-file" data-test="voucher-file" @change="onFile" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <MidlongNotice data-guide="ml-voucher-result" v-if="result" tone="info" :title="`已登记：凭证 ${result.voucherNo}（${result.receivedAt}）`" data-test="voucher-result">
        <div>{{ result.notice }}</div>
      </MidlongNotice>
      <MidlongNotice v-if="error" tone="danger" title="未能保存" data-test="voucher-form-error">{{ error }}</MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="saving" :disabled="!valid" data-guide="ml-voucher-submit" data-test="voucher-submit" @click="submit">登记（只追加）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p5-form { display: flex; flex-direction: column; gap: 10px; }
</style>
