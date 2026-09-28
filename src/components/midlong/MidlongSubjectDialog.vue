<script setup lang="ts">
// 交易主体 / 交易单元登记（dljy#2939）：公司内稳定编码作身份，展示名不作唯一键；
// 交易中心单元代码未取得时留空，填写时必须注明来源（不虚构官方编码）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from './MidlongNotice.vue'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'
import { createSubject, midlongFailureOf } from '@/services/midlong/midlongApi'
import { emitGuideSignal, useGuideForm } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'
import type { CompanyStation } from '@/services/company/companyApi'

const props = defineProps<{ modelValue: boolean; subjects: MidlongSubject[]; stations: CompanyStation[]; canWrite: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [MidlongSubject] }>()

const form = reactive({ subjectKey: '', displayName: '', unitCode: '', unitCodeSource: '', verificationNote: '', stationIds: [] as number[] })
const saving = ref(false)
const error = ref('')

// 操作导引：登记表单值与「帮我填」兜底直接共享这个 reactive（dljy#3404）。
useGuideForm(FORM.subject, form)

watch(() => props.modelValue, (open) => {
  if (!open) return
  Object.assign(form, { subjectKey: '', displayName: '', unitCode: '', unitCodeSource: '', verificationNote: '', stationIds: [] })
  error.value = ''
})

const stationName = (id: number) => props.stations.find((s) => s.id === id)?.name ?? `#${id}`
const valid = computed(() => form.subjectKey.trim() && form.displayName.trim() && (!form.unitCode.trim() || form.unitCodeSource.trim()))

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const subject = await createSubject({
      subjectKey: form.subjectKey.trim(), displayName: form.displayName.trim(), unitCode: form.unitCode.trim() || null,
      unitCodeSource: form.unitCodeSource.trim() || null, verificationNote: form.verificationNote.trim() || null, stationIds: form.stationIds,
    })
    ElMessage.success('交易主体已登记')
    emitGuideSignal(SIGNAL.subjectCreated, { id: subject.id, subjectKey: subject.subjectKey })
    emit('created', subject)
    Object.assign(form, { subjectKey: '', displayName: '', unitCode: '', unitCodeSource: '', verificationNote: '', stationIds: [] })
  } catch (e) {
    error.value = midlongFailureOf(e).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="交易主体 / 交易单元" width="820px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="ml-subjects">
      <el-table :data="subjects" border size="small" max-height="260">
        <el-table-column prop="subjectKey" label="主体编码" width="150" />
        <el-table-column prop="displayName" label="名称" min-width="150" />
        <el-table-column label="交易单元代码" width="170">
          <template #default="{ row }">{{ row.unitCode ? `${row.unitCode}（${row.unitCodeSource}）` : '待补（未取得）' }}</template>
        </el-table-column>
        <el-table-column label="关联场站" min-width="180">
          <template #default="{ row }">{{ row.stationIds.length ? row.stationIds.map(stationName).join('、') : '未关联' }}</template>
        </el-table-column>
        <template #empty>尚未登记交易主体；合同核验确认前必须指定主体。</template>
      </el-table>
      <template v-if="canWrite">
        <div class="ml-grid">
          <label class="ml-field" data-guide="ml-subject-key"><span>主体编码（公司内唯一）</span><el-input v-model="form.subjectKey" placeholder="如 CGN-YN-WIND-01" /></label>
          <label class="ml-field" data-guide="ml-subject-name"><span>名称</span><el-input v-model="form.displayName" /></label>
          <label class="ml-field"><span>交易中心单元代码（可空）</span><el-input v-model="form.unitCode" /></label>
          <label class="ml-field"><span>代码来源（填代码时必填）</span><el-input v-model="form.unitCodeSource" placeholder="如 交易中心注册回执" /></label>
          <label class="ml-field ml-wide" data-guide="ml-subject-stations"><span>关联场站（本公司本地区）</span>
            <el-select v-model="form.stationIds" multiple filterable placeholder="可多选">
              <el-option v-for="s in stations" :key="s.id" :label="`${s.name}（${s.type}）`" :value="s.id" />
            </el-select>
          </label>
          <label class="ml-field ml-wide"><span>核验说明</span><el-input v-model="form.verificationNote" /></label>
        </div>
        <MidlongNotice v-if="error" tone="danger">{{ error }}</MidlongNotice>
      </template>
    </div>
    <template #footer>
      <el-button data-guide="ml-subject-close" @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="canWrite" data-guide="ml-subject-submit" type="primary" :loading="saving" :disabled="!valid" @click="submit">登记主体</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-subjects { display: flex; flex-direction: column; gap: 12px; }
.ml-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.ml-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.ml-field :deep(.el-select) { width: 100%; }
.ml-wide { grid-column: span 2; }
</style>
