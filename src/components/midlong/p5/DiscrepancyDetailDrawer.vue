<script setup lang="ts">
// 差异详情抽屉（dljy#3016，MR-04）：两侧快照（台账侧持仓口径 / 外部侧账单分项）与差值如实展示、
// 价格可比性、处理闭环（补充原因/负责人/证据 → 关闭必须处理说明）；已解决后登记快照与说明冻结（409），
// 账单修订转回「需重新核对」。关闭差异不改变任何台账数据（来源一致性核对 ≠ 完整结算复算）。
import { computed, reactive, ref, watch } from 'vue'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchDiscrepancy, resolveDiscrepancy, updateDiscrepancy } from '@/services/midlong/midlongP5Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { createLoadGuard, fileToBase64, oversizeUploadMessage } from '@/services/midlong/midlongFormat'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { DISCREPANCY_BASIS_TEXT, discrepancySidesLines, discrepancyStatusTag, priceDeltaText, settlementFailureText, signedDeltaLabel } from '@/services/midlong/midlongP5Format'
import { SETTLEMENT_EVENT_TYPE_LABELS, SETTLEMENT_NOTICES, type DiscrepancyDetailDto } from '@/services/midlong/midlongP5Types'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

const props = defineProps<{ modelValue: boolean; discrepancyId: number | null; canWrite: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] }>()

const detail = ref<DiscrepancyDetailDto | null>(null)
const loading = ref(false)
const failure = ref('')
const actionError = ref('')
const busy = ref('')
const guard = createLoadGuard()
const scopeKey = () => `${selectedCompanyId.value}|${currentRegion.value.id}`
const loadKey = () => `${scopeKey()}|${props.discrepancyId}`

async function load() {
  if (!props.discrepancyId) return
  const key = loadKey()
  const token = guard.begin(key)
  failure.value = ''
  loading.value = true
  if (detail.value?.id !== props.discrepancyId) detail.value = null
  try {
    const d = await fetchDiscrepancy(props.discrepancyId)
    if (!guard.isCurrent(token, key)) return
    detail.value = d
  } catch (e) {
    if (!guard.isCurrent(token, key)) return
    failure.value = midlongFailureOf(e).message
  } finally {
    if (guard.isCurrent(token, key)) loading.value = false
  }
}

// ── 补充（PATCH）：原因 / 负责人 / 证据；已解决后 409 冻结 ─────────────────────
const updateDialog = reactive({ open: false, reason: '', ownerName: '', evidence: [] as File[] })
const updateSession = createWriteSession(() => `update:${props.discrepancyId}`)
function openUpdate() {
  const d = detail.value
  updateDialog.reason = d?.reason ?? ''
  updateDialog.ownerName = d?.ownerName ?? ''
  updateDialog.evidence = []
  updateSession.open()
  updateDialog.open = true
}
function onUpdateFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = [...(input.files ?? [])]
  for (const file of selected) {
    const oversize = oversizeUploadMessage(file)
    if (oversize) { actionError.value = oversize; input.value = ''; return }
  }
  updateDialog.evidence = [...updateDialog.evidence, ...selected]
  input.value = ''
}

async function submitUpdate() {
  const d = detail.value
  if (!d || busy.value) return
  busy.value = 'update'
  actionError.value = ''
  const ticket = updateSession.begin()
  const files = [...updateDialog.evidence]
  try {
    ticket.assertCurrent()
    const uploads = []
    for (const file of files) {
      uploads.push({ fileName: file.name, contentBase64: await fileToBase64(file), mediaType: file.type || null })
      ticket.assertCurrent()
    }
    await updateDiscrepancy(d.id, {
      expectedRowVersion: d.rowVersion,
      reason: updateDialog.reason.trim() || null,
      ownerName: updateDialog.ownerName.trim() || null,
      evidence: uploads.length ? uploads : null,
    })
    updateDialog.open = false
    updateSession.close()
    emit('changed')
    await load()
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    actionError.value = settlementFailureText(f.errorCode, f.message, f.details)
  } finally {
    busy.value = ''
  }
}

// ── 关闭（resolve）：处理说明必填（422 DISCREPANCY_RESOLUTION_NOTE_REQUIRED）──
const resolveDialog = reactive({ open: false, resolutionNote: '' })
const resolveSession = createWriteSession(() => `resolve:${props.discrepancyId}`)

function resetView() {
  busy.value = ''
  actionError.value = ''
  updateDialog.open = false
  updateDialog.reason = ''
  updateDialog.ownerName = ''
  updateDialog.evidence = []
  resolveDialog.open = false
  resolveDialog.resolutionNote = ''
}
watch(() => [props.modelValue, props.discrepancyId] as const, ([open]) => {
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
function openResolve() {
  resolveDialog.resolutionNote = ''
  resolveSession.open()
  resolveDialog.open = true
}

async function submitResolve() {
  const d = detail.value
  if (!d || busy.value) return
  const note = resolveDialog.resolutionNote.trim()
  if (!note) { actionError.value = SETTLEMENT_NOTICES.resolutionNoteRequired; return }
  busy.value = 'resolve'
  actionError.value = ''
  const ticket = resolveSession.begin()
  try {
    ticket.assertCurrent()
    await resolveDiscrepancy(d.id, { expectedRowVersion: d.rowVersion, resolutionNote: note })
    resolveDialog.open = false
    resolveSession.close()
    emit('changed')
    await load()
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    actionError.value = settlementFailureText(f.errorCode, f.message, f.details)
  } finally {
    busy.value = ''
  }
}

const resolved = computed(() => detail.value?.status === 'RESOLVED')
</script>

<template>
  <el-drawer :model-value="modelValue" title="量价差异详情" size="720px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div v-if="loading" v-loading="true" class="p5-drawer" />
    <div v-else-if="failure" class="p5-drawer">
      <MidlongNotice tone="danger" title="差异加载失败">{{ failure }} <el-button link type="primary" @click="load">重试</el-button></MidlongNotice>
    </div>
    <div v-else-if="detail" class="p5-drawer">
      <div class="p5-head">
        <h3>#{{ detail.id }} · {{ detail.subjectName ?? `主体 #${detail.subjectId}` }} · {{ detail.deliveryMonth ?? '交割月未知' }}</h3>
        <div class="p5-row">
          <el-tag :type="discrepancyStatusTag(detail.status).type">{{ discrepancyStatusTag(detail.status).label }}</el-tag>
          <span class="p5-muted">比对账单 <span class="p5-mono">#{{ detail.billId }}{{ detail.billRevisionNo !== null ? ` · 登记时版本 v${detail.billRevisionNo}` : '' }}</span>（当前有效版本为准可重新核对）</span>
        </div>
      </div>

      <MidlongNotice v-for="notice in detail.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>
      <MidlongNotice v-if="detail.status === 'RECHECK_REQUIRED'" tone="warn" data-test="recheck-notice">{{ SETTLEMENT_NOTICES.billRevisionRecheck }}</MidlongNotice>

      <div class="p5-section">
        <h4>两侧快照与差值（如实显示，登记不自动改台账）</h4>
        <div v-for="line in discrepancySidesLines(detail)" :key="line" class="p5-row">{{ line }}</div>
        <div class="p5-row">
          <b data-test="quantity-delta">量差（外部 − 台账）：{{ signedDeltaLabel(detail.quantityDelta) }}</b>
          <b data-test="price-delta">价差：{{ priceDeltaText(detail) }}</b>
        </div>
        <div class="p5-muted">差值口径：{{ DISCREPANCY_BASIS_TEXT }}</div>
      </div>

      <div class="p5-section">
        <h4>处理信息</h4>
        <div class="p5-row">原因：{{ detail.reason ?? '未登记' }} · 负责人：{{ detail.ownerName ?? '未指定' }} · 证据：{{ detail.evidenceIds.length ? detail.evidenceIds.map((id) => `#${id}`).join('、') : '无' }}</div>
        <template v-if="resolved">
          <MidlongNotice tone="info" title="已解决（登记快照与处理说明冻结）" data-test="resolved-box">
            <div>处理说明：{{ detail.resolutionNote ?? '—' }}</div>
            <div>解决于 {{ beijingDateTime(detail.resolvedAt) }} · {{ detail.resolvedBy ?? '—' }}</div>
          </MidlongNotice>
        </template>
      </div>

      <div class="p5-section">
        <h4>事件</h4>
        <el-timeline>
          <el-timeline-item v-for="event in detail.events" :key="event.id" :timestamp="beijingDateTime(event.occurredAt)" placement="top">
            {{ SETTLEMENT_EVENT_TYPE_LABELS[event.eventType as keyof typeof SETTLEMENT_EVENT_TYPE_LABELS] ?? event.eventType }}<template v-if="event.actor"> · {{ event.actor }}</template><template v-if="event.reason"> · {{ event.reason }}</template>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div v-if="canWrite && !resolved" class="p5-actions">
        <el-button plain :disabled="Boolean(busy)" data-test="update-discrepancy" @click="openUpdate">补充原因 / 负责人 / 证据</el-button>
        <el-button type="primary" plain :disabled="Boolean(busy)" data-test="resolve-discrepancy" @click="openResolve">关闭（必须填处理说明）</el-button>
      </div>
      <MidlongNotice v-if="actionError" tone="danger" title="操作未完成" data-test="discrepancy-action-error">{{ actionError }}</MidlongNotice>
    </div>

    <el-dialog v-model="updateDialog.open" title="补充差异处理信息" width="560px" append-to-body>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="差异原因"><el-input v-model="updateDialog.reason" type="textarea" :rows="2" data-test="update-reason" /></el-form-item>
        <el-form-item label="负责人"><el-input v-model="updateDialog.ownerName" style="width: 200px" data-test="update-owner" /></el-form-item>
        <el-form-item label="证据文件">
          <input type="file" multiple data-test="update-evidence" @change="onUpdateFiles" />
          <div v-for="(file, i) in updateDialog.evidence" :key="file.name" class="p5-file-chip">{{ file.name }} <el-button link type="danger" size="small" @click="updateDialog.evidence.splice(i, 1)">移除</el-button></div>
        </el-form-item>
      </el-form>
      <MidlongNotice v-if="actionError" tone="danger">{{ actionError }}</MidlongNotice>
      <template #footer>
        <el-button @click="updateDialog.open = false">取消</el-button>
        <el-button type="primary" :loading="busy === 'update'" data-test="update-submit" @click="submitUpdate">保存补充</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resolveDialog.open" title="关闭差异（处理说明必填）" width="560px" append-to-body>
      <MidlongNotice tone="info">{{ SETTLEMENT_NOTICES.resolutionNoteRequired }} {{ SETTLEMENT_NOTICES.consistencyNotRecompute }}</MidlongNotice>
      <el-input v-model="resolveDialog.resolutionNote" type="textarea" :rows="3" placeholder="说明原因、依据与处理结果（关闭后登记快照与处理说明冻结）" data-test="resolution-note" />
      <MidlongNotice v-if="actionError" tone="danger">{{ actionError }}</MidlongNotice>
      <template #footer>
        <el-button @click="resolveDialog.open = false">取消</el-button>
        <el-button type="primary" :loading="busy === 'resolve'" :disabled="!resolveDialog.resolutionNote.trim()" data-test="resolve-submit" @click="submitResolve">关闭（留痕）</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped>
.p5-drawer { display: flex; flex-direction: column; gap: 12px; padding: 0 4px; }
.p5-head { display: flex; flex-direction: column; gap: 6px; }
.p5-head h3 { margin: 0; font-size: var(--font-18); }
.p5-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p5-section h4 { margin: 0; font-size: var(--font-md); }
.p5-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); font-variant-numeric: tabular-nums; }
.p5-actions { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px dashed var(--line); padding-top: 10px; }
.p5-muted { color: var(--muted); font-size: var(--font-sm); }
.p5-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
.p5-file-chip { display: inline-flex; gap: 6px; align-items: center; font-size: var(--font-sm); color: var(--muted); }
</style>
