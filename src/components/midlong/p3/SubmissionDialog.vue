<script setup lang="ts">
// 外部提交登记 / 补充回执（dljy#2973，MT-02）：只记录「谁、什么时候在外部平台提交了」这一事实与回执依据。
// 本系统不登录、不提交外部交易平台；无回执或回执不完整时明确「不代表平台已受理」，登记也不形成持仓、不转换占用。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import BeijingDateTimeInput from './BeijingDateTimeInput.vue'
import { addReceipt, registerSubmission, type ReceiptInput } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { receiptTag } from '@/services/midlong/midlongP3Format'
import { PLANNING_NOTICES, RECEIPT_ELEMENT_LABELS, isCompleteBeijingDateTimeInput, type ProposalSubmission, type ReceiptCompleteness, type ReceiptElement, type TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const props = defineProps<{ modelValue: boolean; mode: 'submission' | 'receipt'; proposal: TradeProposalDetail; submission: ProposalSubmission | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [number] }>()

const blank = () => ({ submittedAt: '', submittedByName: '', channel: '', note: '', externalReference: '', receiptAt: '', receiptNote: '' })
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const result = ref<{ completeness: ReceiptCompleteness; missing: ReceiptElement[] } | null>(null)
// 写入会话：打开时快照公司/地区范围与写入目标（为某个方案行版本登记提交，或给某条提交补回执），关闭或重新打开让进行中的保存失效。
// 读取回执文件期间点了取消、或关掉后又对另一条提交打开「补充回执」，转换完成后都不能再写入。
const session = createWriteSession(() => (props.mode === 'receipt' ? `receipt:${props.submission?.id ?? ''}` : `submission:${props.proposal.id}:${props.proposal.rowVersion}`))
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

/** 时刻只接受日期 + 时:分完整输入：只选日期会被当成零点，外部提交与回执时间不能这样猜。 */
const receiptAtComplete = computed(() => form.receiptAt === '' || isCompleteBeijingDateTimeInput(form.receiptAt))
const submittedAtIncomplete = computed(() => form.submittedAt !== '' && !isCompleteBeijingDateTimeInput(form.submittedAt))
const valid = computed(() => receiptAtComplete.value && (props.mode === 'receipt'
  ? Boolean(form.externalReference.trim() || form.receiptAt || file.value)
  : Boolean(isCompleteBeijingDateTimeInput(form.submittedAt) && form.submittedByName.trim())))

function onFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; file.value = null; return }
  file.value = selected
}

/** 回执输入：表单值在调用时同步读取，只有读取文件内容要等待。 */
async function receiptInput(): Promise<ReceiptInput | null> {
  const selected = file.value
  const fields = { externalReference: form.externalReference.trim() || null, receiptAt: form.receiptAt || null, note: form.receiptNote.trim() || null }
  if (!fields.externalReference && !fields.receiptAt && !selected) return null
  return { ...fields, file: selected ? { fileName: selected.name, contentBase64: await fileToBase64(selected), mediaType: selected.type || null } : null }
}

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  // 写入目标与表单值在点保存时同步读取；await 之后只核对，不再读 props 或表单。
  const ticket = session.begin()
  const mode = props.mode
  const proposal = props.proposal
  const submission = props.submission
  const submissionFields = { submittedAt: form.submittedAt, submittedByName: form.submittedByName.trim(), channel: form.channel.trim() || null, note: form.note.trim() || null }
  try {
    ticket.assertCurrent()
    const receipt = await receiptInput()
    // 读取回执文件期间可能切换了公司、关闭了表单或换成了另一条提交：核对后同步发请求。
    ticket.assertCurrent()
    const saved = mode === 'receipt' && submission
      ? await addReceipt(submission.id, receipt ?? {})
      : await registerSubmission(proposal.id, { expectedRowVersion: proposal.rowVersion, ...submissionFields, receipt })
    ElMessage.success(mode === 'receipt' ? '回执已补充' : '已登记外部提交（不代表平台已受理）')
    emit('saved', proposal.id)
    // 写请求返回前表单已关闭或重开：结果属于上一次打开，不显示到当前表单。
    if (ticket.sameSession()) result.value = { completeness: saved.receiptCompleteness, missing: saved.receiptMissing }
  } catch (e) {
    const message = isWriteAbandoned(e) ? e.message : midlongFailureOf(e).message
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(isWriteAbandoned(e) ? message : `已关闭的提交登记保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="mode === 'receipt' ? '补充回执' : `登记外部提交（方案 #${proposal.id}）`" width="560px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <MidlongNotice tone="warn">{{ PLANNING_NOTICES.submissionNotAccepted }}</MidlongNotice>
    <el-form label-width="120px" class="p3-form" @submit.prevent>
      <template v-if="mode === 'submission'">
        <el-form-item label="外部提交时间" required>
          <BeijingDateTimeInput v-model="form.submittedAt" data-test="submittedAt" />
        </el-form-item>
        <el-form-item label="外部操作人" required><el-input v-model="form.submittedByName" /></el-form-item>
        <el-form-item label="渠道"><el-input v-model="form.channel" placeholder="如：交易平台人工申报" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </template>
      <div class="p3-sub">回执依据（可暂缺，缺失项会显示为待补）</div>
      <el-form-item label="申报/回执编号"><el-input v-model="form.externalReference" /></el-form-item>
      <el-form-item label="平台回执时间">
        <BeijingDateTimeInput v-model="form.receiptAt" data-test="receiptAt" />
      </el-form-item>
      <div v-if="submittedAtIncomplete || !receiptAtComplete" class="p3-time-hint" data-test="incomplete-time">时间须同时填写日历上存在的日期与时:分，不能只选日期。</div>
      <el-form-item label="回执文件"><input type="file" data-test="receipt-file" @change="onFile" /></el-form-item>
      <el-form-item label="回执说明"><el-input v-model="form.receiptNote" /></el-form-item>
    </el-form>
    <MidlongNotice v-if="result" :tone="result.completeness === 'COMPLETE' ? 'info' : 'warn'" :title="`登记完成：${receiptTag(result.completeness).label}`">
      <template v-if="result.missing.length">依据待补：{{ result.missing.map((k) => RECEIPT_ELEMENT_LABELS[k]).join('、') }}。</template>
      平台是否受理由外部平台结果为准，本系统不作判断。
    </MidlongNotice>
    <MidlongNotice v-if="error" tone="danger">{{ error }}</MidlongNotice>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="saving" :disabled="!valid" @click="submit">登记</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p3-form { margin-top: 12px; }
.p3-sub { margin: 4px 0 8px 12px; font-size: var(--font-sm); color: var(--muted); }
.p3-time-hint { margin: -6px 0 10px 120px; font-size: var(--font-sm); color: var(--danger); }
</style>
