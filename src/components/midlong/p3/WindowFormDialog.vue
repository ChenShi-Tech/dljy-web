<script setup lang="ts">
// 交易公告（窗口）登记与更正（dljy#2973，MT-01）。
// - 按公告原文人工登记；没给的参数留空，页面显示「待核对」，时间未知不套默认（只填日期不填时刻不接受）。
// - 公告里出现本系统不支持的参数，按「参数名 → 原文」登记，显示待核对，不自动映射。
// - 更正公告生成新版本（必须写更正原因），原版本保留；引用旧版本的方案会被列出并提示重新核对。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import BeijingDateTimeInput from './BeijingDateTimeInput.vue'
import { correctWindow, registerWindow, type WindowWriteResult } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { PLANNING_NOTICES, PROPOSAL_STATUS_LABELS, isCompleteBeijingDateTimeInput, type TradingWindowDetail, type TradingWindowInput } from '@/services/midlong/midlongP3Types'
import { PRODUCT_KINDS, PRODUCT_KIND_LABELS, TRADE_METHODS, TRADE_METHOD_LABELS, type MidlongSubject, type ProductKind, type TradeMethod } from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; window: TradingWindowDetail | null; subjects: MidlongSubject[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [WindowWriteResult] }>()

const blank = () => ({
  announcementName: '', sourceName: '', sourceReference: '', publishedDate: '', announcementVersion: '', effectiveFrom: '', effectiveTo: '',
  applicableScope: '', applicableSubjectIds: [] as number[], tradeMethod: '' as TradeMethod | '', productKind: '' as ProductKind | '',
  deliveryStartMonth: '', deliveryEndMonth: '', declarationOpensAt: '', declarationClosesAt: '', confirmationAt: '', changeReason: '',
  keepAttachment: true, unsupported: [] as Array<{ name: string; raw: string }>,
})
const form = reactive(blank())
const file = ref<File | null>(null)
const saving = ref(false)
const error = ref('')
const outcome = ref<WindowWriteResult | null>(null)
// 写入会话：打开时快照公司/地区范围与写入目标（登记新公告，或更正某条公告的某个行版本），关闭或重新打开让进行中的保存失效。
// 读取附件期间点了取消、或关掉后又对另一条公告打开，转换完成后都不能再写入。
const session = createWriteSession(() => (props.window ? `correct:${props.window.id}:${props.window.rowVersion}` : 'register'))
onBeforeUnmount(() => session.close())

/** 已登记的时刻按北京时间回填（YYYY-MM-DD HH:mm），未知保持空，不补默认。 */
const localTime = (iso: string | null) => (iso ? beijingDateTime(iso, '') : '')

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  Object.assign(form, blank())
  file.value = null
  saving.value = false
  error.value = ''
  outcome.value = null
  const current = props.window?.revisions.find((r) => r.revisionNo === props.window?.currentRevisionNo)
  if (current) {
    Object.assign(form, {
      announcementName: current.announcementName, sourceName: current.sourceName ?? '', sourceReference: current.sourceReference ?? '',
      publishedDate: current.publishedDate ?? '', announcementVersion: current.announcementVersion ?? '', effectiveFrom: current.effectiveFrom ?? '',
      effectiveTo: current.effectiveTo ?? '', applicableScope: current.applicableScope ?? '', applicableSubjectIds: [...current.applicableSubjectIds],
      tradeMethod: current.tradeMethod ?? '', productKind: current.productKind ?? '', deliveryStartMonth: current.deliveryStartMonth ?? '',
      deliveryEndMonth: current.deliveryEndMonth ?? '', declarationOpensAt: localTime(current.declarationOpensAt),
      declarationClosesAt: localTime(current.declarationClosesAt), confirmationAt: localTime(current.confirmationAt),
      unsupported: Object.entries(current.unsupportedParams).map(([name, raw]) => ({ name, raw })),
    })
  }
}, { immediate: true })

const correcting = computed(() => Boolean(props.window))
/**
 * 时刻要么留空（未知），要么日期与时:分都填；只填日期不允许提交，避免把未知时刻默认成零点。
 * 完整性判断与后端同一规则：日期必须在日历上存在（2031-02-30 这类手输值不会被当成 3 月 2 日提交）。
 */
const TIME_FIELDS = ['declarationOpensAt', 'declarationClosesAt', 'confirmationAt'] as const
const incompleteTimes = computed(() => TIME_FIELDS.filter((f) => form[f] !== '' && !isCompleteBeijingDateTimeInput(form[f])))
const valid = computed(() => Boolean(form.announcementName.trim()) && (!correcting.value || Boolean(form.changeReason.trim())) && incompleteTimes.value.length === 0)
const text = (v: string) => (v.trim() === '' ? null : v.trim())

function onFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0] ?? null
  const oversize = selected ? oversizeUploadMessage(selected) : null
  if (oversize) { error.value = oversize; file.value = null; return }
  file.value = selected
}

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  // 写入目标与表单值在点保存时同步读取；await 之后只核对，不再读 props 或表单。
  const ticket = session.begin()
  const target = props.window
  const selected = file.value
  const changeReason = form.changeReason.trim()
  const keepAttachment = form.keepAttachment
  try {
    ticket.assertCurrent()
    const fields: Omit<TradingWindowInput, 'file'> = {
      announcementName: form.announcementName.trim(), sourceName: text(form.sourceName), sourceReference: text(form.sourceReference),
      publishedDate: text(form.publishedDate), announcementVersion: text(form.announcementVersion), effectiveFrom: text(form.effectiveFrom),
      effectiveTo: text(form.effectiveTo), applicableScope: text(form.applicableScope), applicableSubjectIds: form.applicableSubjectIds,
      tradeMethod: form.tradeMethod || null, productKind: form.productKind || null, deliveryStartMonth: text(form.deliveryStartMonth),
      deliveryEndMonth: text(form.deliveryEndMonth), declarationOpensAt: text(form.declarationOpensAt), declarationClosesAt: text(form.declarationClosesAt),
      confirmationAt: text(form.confirmationAt),
      unsupportedParams: Object.fromEntries(form.unsupported.filter((u) => u.name.trim() && u.raw.trim()).map((u) => [u.name.trim(), u.raw.trim()])),
    }
    const input: TradingWindowInput = {
      ...fields,
      file: selected ? { fileName: selected.name, contentBase64: await fileToBase64(selected), mediaType: selected.type || null } : null,
    }
    // 读取附件期间可能切换了公司、关闭了表单或换成了另一条公告：核对后同步发请求（写请求的 company 参数在发出时读取）。
    ticket.assertCurrent()
    const saved = target
      ? await correctWindow(target.id, { ...input, expectedRowVersion: target.rowVersion, changeReason, keepAttachment })
      : await registerWindow(input)
    ElMessage.success(target ? '更正公告已登记，原版本保留' : '公告已登记')
    emit('saved', saved)
    // 写请求返回前表单已关闭或重开：结果属于上一次打开，不关闭、不改写当前表单。
    if (!ticket.sameSession()) return
    if (saved.affectedProposals?.length) outcome.value = saved
    else emit('update:modelValue', false)
  } catch (e) {
    const message = isWriteAbandoned(e) ? e.message : midlongFailureOf(e).message
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(isWriteAbandoned(e) ? message : `已关闭的公告表单保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="window ? `登记更正公告（当前 v${window.currentRevisionNo}）` : '登记交易公告'" width="760px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <MidlongNotice tone="info">{{ PLANNING_NOTICES.windowPending }}</MidlongNotice>
    <el-form label-width="120px" class="p3-form" @submit.prevent>
      <el-form-item label="公告名称" required><el-input v-model="form.announcementName" /></el-form-item>
      <el-form-item label="来源">
        <el-input v-model="form.sourceName" placeholder="发布机构/渠道" style="width: 220px" />
        <el-input v-model="form.sourceReference" placeholder="文号或链接" style="width: 300px; margin-left: 8px" />
      </el-form-item>
      <el-form-item label="发布日期 / 版本">
        <el-date-picker v-model="form.publishedDate" type="date" value-format="YYYY-MM-DD" placeholder="发布日期" style="width: 160px" />
        <el-input v-model="form.announcementVersion" placeholder="公告版本（原文）" style="width: 200px; margin-left: 8px" />
      </el-form-item>
      <el-form-item label="生效期">
        <el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width: 160px" />
        <span class="p3-dash">—</span>
        <el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width: 160px" />
      </el-form-item>
      <el-form-item label="适用主体">
        <el-input v-model="form.applicableScope" placeholder="公告原文的适用范围" />
        <el-select v-model="form.applicableSubjectIds" multiple filterable placeholder="已核对的本公司交易主体（可空）" style="width: 100%; margin-top: 6px">
          <el-option v-for="s in subjects" :key="s.id" :label="s.displayName" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="交易方式 / 品种">
        <el-select v-model="form.tradeMethod" clearable placeholder="待核对" style="width: 160px">
          <el-option v-for="k in TRADE_METHODS" :key="k" :label="TRADE_METHOD_LABELS[k]" :value="k" />
        </el-select>
        <el-select v-model="form.productKind" clearable placeholder="待核对" style="width: 120px; margin-left: 8px">
          <el-option v-for="k in PRODUCT_KINDS" :key="k" :label="PRODUCT_KIND_LABELS[k]" :value="k" />
        </el-select>
      </el-form-item>
      <el-form-item label="交割期">
        <el-date-picker v-model="form.deliveryStartMonth" type="month" value-format="YYYY-MM" placeholder="起始月" style="width: 140px" />
        <span class="p3-dash">—</span>
        <el-date-picker v-model="form.deliveryEndMonth" type="month" value-format="YYYY-MM" placeholder="结束月" style="width: 140px" />
      </el-form-item>
      <el-form-item label="申报开始">
        <BeijingDateTimeInput v-model="form.declarationOpensAt" data-test="declarationOpensAt" />
      </el-form-item>
      <el-form-item label="申报截止">
        <BeijingDateTimeInput v-model="form.declarationClosesAt" data-test="declarationClosesAt" />
      </el-form-item>
      <el-form-item label="确认时间">
        <BeijingDateTimeInput v-model="form.confirmationAt" data-test="confirmationAt" />
      </el-form-item>
      <div v-if="incompleteTimes.length" class="p3-time-hint" data-test="incomplete-time">申报、确认时间须同时填写日历上存在的日期与时:分；公告未给出确切时刻时请整项留空（显示待补），不要只选日期。</div>
      <el-form-item label="不支持的参数">
        <div class="p3-unsupported">
          <div v-for="(u, i) in form.unsupported" :key="i" class="p3-segment">
            <el-input v-model="u.name" placeholder="参数名" style="width: 150px" />
            <el-input v-model="u.raw" placeholder="公告原文" style="width: 320px" />
            <el-button link type="danger" @click="form.unsupported.splice(i, 1)">删除</el-button>
          </div>
          <el-button link type="primary" @click="form.unsupported.push({ name: '', raw: '' })">+ 登记原文参数（显示待核对）</el-button>
        </div>
      </el-form-item>
      <el-form-item label="公告原文件">
        <input type="file" @change="onFile" />
        <el-checkbox v-if="window" v-model="form.keepAttachment" style="margin-left: 10px">未上传新文件时沿用原文件</el-checkbox>
      </el-form-item>
      <el-form-item v-if="window" label="更正原因" required><el-input v-model="form.changeReason" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <MidlongNotice v-if="outcome?.affectedProposals?.length" tone="warn" title="以下方案引用了旧版本公告，需按新版本重新核对">
      <div v-for="p in outcome.affectedProposals" :key="p.proposalId">方案 #{{ p.proposalId }}（{{ PROPOSAL_STATUS_LABELS[p.status] }}，引用 v{{ p.referencedRevisionNo }}）</div>
      <div v-if="outcome.changes?.length">变更参数：{{ outcome.changes.map((c) => c.label).join('、') }}</div>
    </MidlongNotice>
    <MidlongNotice v-if="error" tone="danger">{{ error }}</MidlongNotice>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ outcome ? '完成' : '取消' }}</el-button>
      <el-button v-if="!outcome" type="primary" :loading="saving" :disabled="!valid" @click="submit">{{ window ? '登记更正版本' : '登记' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p3-form { margin-top: 12px; }
.p3-dash { margin: 0 6px; color: var(--muted); }
.p3-unsupported { display: flex; flex-direction: column; gap: 6px; }
.p3-time-hint { margin: -6px 0 10px 120px; font-size: var(--font-sm); color: var(--danger); }
.p3-segment { display: flex; gap: 8px; align-items: center; }
</style>
