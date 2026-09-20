<script setup lang="ts">
// 显式映射登记（dljy#3014，MA-02 / 11.1 工程部分）：（来源, 外部产品代码）→（调整类型, 我方义务方向），带依据。
// 映射是方向的合法来源之一（directionSource=MAPPING_REGISTERED）：登记后同来源产品的调整不再停在待核对；
// 与单据明确字段冲突时服务端拒绝，前端不静默取一。
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { fetchMappings, registerMapping } from '@/services/midlong/midlongP4Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { createWriteSession, isWriteAbandoned } from '@/services/midlong/midlongP3Scope'
import { adjustmentFailureText, adjustmentTypeLabel, directionLabel } from '@/services/midlong/midlongP4Format'
import {
  ADJUSTMENT_NOTICES, ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_TYPES, OBLIGATION_DIRECTIONS,
  type AdjustmentMappingDto, type AdjustmentType, type ObligationDirection,
} from '@/services/midlong/midlongP4Types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()

const form = reactive({ sourceNamespace: '', externalProductCode: '', adjustmentType: 'ADJUSTMENT' as AdjustmentType, direction: '' as '' | ObligationDirection, basisNote: '', note: '' })
const saving = ref(false)
const error = ref('')
const rows = ref<AdjustmentMappingDto[]>([])
const loadingRows = ref(false)
const notice = ref('')
const session = createWriteSession(() => 'mapping:new')
onBeforeUnmount(() => session.close())

async function loadRows() {
  loadingRows.value = true
  try {
    const result = await fetchMappings()
    rows.value = result.rows
    notice.value = result.notice
  } catch (e) {
    rows.value = []
    notice.value = `既有映射加载失败：${midlongFailureOf(e).message}`
  } finally {
    loadingRows.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) { session.close(); return }
  session.open()
  Object.assign(form, { sourceNamespace: '', externalProductCode: '', adjustmentType: 'ADJUSTMENT', direction: '', basisNote: '', note: '' })
  error.value = ''
  void loadRows()
}, { immediate: true })

const valid = () => form.sourceNamespace.trim() !== '' && form.externalProductCode.trim() !== '' && form.direction !== '' && form.basisNote.trim() !== ''

async function submit() {
  if (!valid() || saving.value) return
  saving.value = true
  error.value = ''
  const ticket = session.begin()
  const fields = {
    sourceNamespace: form.sourceNamespace.trim(),
    externalProductCode: form.externalProductCode.trim(),
    adjustmentType: form.adjustmentType,
    // valid() 已保证方向非空；'' 只存在于未填状态。
    direction: form.direction as ObligationDirection,
    basisNote: form.basisNote.trim(),
    note: form.note.trim() || null,
  }
  try {
    ticket.assertCurrent()
    const saved = await registerMapping(fields)
    ElMessage.success(saved.updated ? '映射已按新依据修正（映射键与登记留痕保留）' : '映射登记已保存')
    emit('saved')
    if (ticket.sameSession()) {
      notice.value = saved.notice
      await loadRows()
    }
  } catch (e) {
    const f = e instanceof Error && isWriteAbandoned(e) ? { message: (e as Error).message, errorCode: '', details: null } : midlongFailureOf(e)
    const message = adjustmentFailureText(f.errorCode, f.message, f.details)
    if (ticket.sameSession()) error.value = message
    else ElMessage.warning(`已关闭的映射登记保存失败：${message}`)
  } finally {
    if (ticket.sameSession()) saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="外部产品映射登记（方向的合法来源）" width="720px" append-to-body @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="p4-form">
      <MidlongNotice tone="info">{{ ADJUSTMENT_NOTICES.directionNoInference }} {{ ADJUSTMENT_NOTICES.directionFromMapping }}</MidlongNotice>
      <el-form label-width="140px" @submit.prevent>
        <div class="p4-grid">
          <el-form-item label="来源" required><el-input v-model="form.sourceNamespace" data-test="mapping-source" placeholder="如：昆明交易中心" /></el-form-item>
          <el-form-item label="外部产品代码" required><el-input v-model="form.externalProductCode" data-test="mapping-product-code" placeholder="如：月内合约转让" /></el-form-item>
          <el-form-item label="调整类型" required>
            <el-select v-model="form.adjustmentType" data-test="mapping-type">
              <el-option v-for="t in ADJUSTMENT_TYPES" :key="t" :label="ADJUSTMENT_TYPE_LABELS[t]" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="我方义务方向" required>
            <el-select v-model="form.direction" data-test="mapping-direction" placeholder="以核验单据为准">
              <el-option v-for="d in OBLIGATION_DIRECTIONS" :key="d" :label="directionLabel(d)" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="映射依据" required>
            <el-input v-model="form.basisNote" type="textarea" :rows="2" data-test="mapping-basis" placeholder="如：《XX 交易细则》第 N 条：该品种转让后我方义务减少，附文件名与核对人" />
          </el-form-item>
        </div>
      </el-form>

      <div class="p4-sub">既有映射（同键按新依据修正；键与留痕不可改）</div>
      <el-table v-loading="loadingRows" :data="rows" border size="small" max-height="240">
        <el-table-column label="来源 / 产品代码" min-width="200"><template #default="{ row }"><span class="p4-mono">{{ row.sourceNamespace }} / {{ row.externalProductCode }}</span></template></el-table-column>
        <el-table-column label="类型" width="110"><template #default="{ row }">{{ adjustmentTypeLabel(row.adjustmentType) }}</template></el-table-column>
        <el-table-column label="方向" min-width="130"><template #default="{ row }">{{ directionLabel(row.direction) }}</template></el-table-column>
        <el-table-column prop="basisNote" label="依据" min-width="220" show-overflow-tooltip />
        <template #empty>尚无映射登记。</template>
      </el-table>
      <div v-if="notice" class="p4-muted">{{ notice }}</div>
      <MidlongNotice v-if="error" tone="danger" title="未能保存" data-test="mapping-error">{{ error }}</MidlongNotice>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :loading="saving" :disabled="!valid()" data-test="mapping-submit" @click="submit">保存映射</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p4-form { display: flex; flex-direction: column; gap: 10px; }
.p4-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.p4-sub { margin: 4px 0 2px; font-size: var(--font-sm); color: var(--muted); }
.p4-muted { color: var(--muted); font-size: var(--font-sm); }
.p4-mono { font-family: var(--font-mono, monospace); font-size: var(--font-sm); }
@media (max-width: 900px) { .p4-grid { grid-template-columns: 1fr; } }
</style>
