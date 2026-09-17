<script setup lang="ts">
// 售电目标录入（dljy#2973，MS-01）：新建目标草稿 / 修改待确认版本 / 发起更改（生成新版本）。
// 目标是人工确认的经营安排，不是物理可发电量或法定额度；更改必须写原因，旧版本保留在版本历史里。
// 电量、价格按十进制字符串提交，空值表示未知（不填 0）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from '../MidlongNotice.vue'
import { createPlan, createPlanRevision, updatePlanDraft, type PlanWriteResult } from '@/services/midlong/midlongP3Api'
import { midlongFailureOf } from '@/services/midlong/midlongApi'
import { PLANNING_NOTICES, PLAN_PERIOD_TYPES, PLAN_PERIOD_TYPE_LABELS, isPeriodKey, type PlanPeriodType, type SalesPlanListRow, type SalesPlanRevision } from '@/services/midlong/midlongP3Types'
import { TAX_BASES, TAX_BASIS_LABELS, type MidlongSubject, type TaxBasis } from '@/services/midlong/midlongTypes'

const props = defineProps<{ modelValue: boolean; mode: 'create' | 'edit' | 'revise'; plan: SalesPlanListRow | null; subjects: MidlongSubject[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [PlanWriteResult] }>()

const blank = () => ({
  subjectId: null as number | null, periodType: 'MONTH' as PlanPeriodType, periodKey: '', targetQuantity: '', targetPriceLow: '', targetPriceHigh: '',
  priceTaxBasis: 'UNKNOWN' as TaxBasis, basisNote: '', ownerName: '', changeReason: '',
})
const form = reactive(blank())
const saving = ref(false)
const error = ref('')

function fillFrom(revision: SalesPlanRevision | null, keepReason: boolean) {
  form.targetQuantity = revision?.targetQuantity ?? ''
  form.targetPriceLow = revision?.targetPriceLow ?? ''
  form.targetPriceHigh = revision?.targetPriceHigh ?? ''
  form.priceTaxBasis = revision?.priceTaxBasis ?? 'UNKNOWN'
  form.basisNote = revision?.basisNote ?? ''
  form.ownerName = revision?.ownerName ?? ''
  form.changeReason = keepReason ? (revision?.changeReason ?? '') : ''
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  Object.assign(form, blank())
  error.value = ''
  if (props.plan) {
    form.subjectId = props.plan.subjectId
    form.periodType = props.plan.periodType
    form.periodKey = props.plan.periodKey
    if (props.mode === 'edit') fillFrom(props.plan.draftRevision, true)
    if (props.mode === 'revise') fillFrom(props.plan.confirmedRevision, false)
  }
}, { immediate: true })

const title = computed(() => ({ create: '新建售电目标', edit: '修改待确认目标', revise: '发起目标更改（生成新版本）' })[props.mode])
const needsReason = computed(() => props.mode === 'revise' || (props.mode === 'edit' && (props.plan?.currentRevisionNo ?? 1) > 1))
const periodValid = computed(() => isPeriodKey(form.periodType, form.periodKey))
const valid = computed(() => Boolean(form.subjectId) && periodValid.value && (!needsReason.value || form.changeReason.trim()))
const text = (v: string) => (v.trim() === '' ? null : v.trim())

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''
  const revision = {
    targetQuantity: text(form.targetQuantity), targetPriceLow: text(form.targetPriceLow), targetPriceHigh: text(form.targetPriceHigh),
    priceTaxBasis: form.priceTaxBasis, basisNote: text(form.basisNote), ownerName: text(form.ownerName), changeReason: text(form.changeReason),
  }
  try {
    let result: PlanWriteResult
    if (props.mode === 'create') {
      result = await createPlan({ ...revision, subjectId: form.subjectId as number, periodType: form.periodType, periodKey: form.periodKey })
    } else if (props.mode === 'edit' && props.plan) {
      result = await updatePlanDraft(props.plan.id, { ...revision, expectedRowVersion: props.plan.rowVersion })
    } else if (props.plan) {
      result = await createPlanRevision(props.plan.id, { ...revision, changeReason: form.changeReason.trim(), expectedRowVersion: props.plan.rowVersion })
    } else {
      return
    }
    ElMessage.success(props.mode === 'revise' ? '已发起更改，确认后生效' : '目标草稿已保存，确认后生效')
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (e) {
    const f = midlongFailureOf(e)
    error.value = f.errorCode === 'VERSION_CONFLICT' ? `${f.message}（请关闭后刷新列表再操作）` : f.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="title" width="640px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <MidlongNotice tone="info">{{ PLANNING_NOTICES.targetNature }}</MidlongNotice>
    <el-form label-width="120px" class="p3-form" @submit.prevent>
      <el-form-item label="交易主体" required>
        <el-select v-model="form.subjectId" :disabled="mode !== 'create'" filterable placeholder="选择交易主体" style="width: 100%">
          <el-option v-for="s in subjects" :key="s.id" :label="`${s.displayName}（${s.subjectKey}）`" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="交割期" required>
        <el-select v-model="form.periodType" :disabled="mode !== 'create'" style="width: 110px">
          <el-option v-for="t in PLAN_PERIOD_TYPES" :key="t" :label="PLAN_PERIOD_TYPE_LABELS[t]" :value="t" />
        </el-select>
        <el-date-picker
          v-model="form.periodKey" :type="form.periodType === 'YEAR' ? 'year' : 'month'" :value-format="form.periodType === 'YEAR' ? 'YYYY' : 'YYYY-MM'"
          :disabled="mode !== 'create'" placeholder="交割年/月" style="width: 160px; margin-left: 8px"
        />
      </el-form-item>
      <el-form-item label="目标电量(MWh)">
        <el-input v-model="form.targetQuantity" placeholder="空=未确定（确认前必填，可为 0）" />
      </el-form-item>
      <el-form-item label="目标价格区间">
        <el-input v-model="form.targetPriceLow" placeholder="下限 元/MWh" style="width: 150px" />
        <span class="p3-dash">—</span>
        <el-input v-model="form.targetPriceHigh" placeholder="上限 元/MWh" style="width: 150px" />
        <el-select v-model="form.priceTaxBasis" style="width: 110px; margin-left: 8px">
          <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标依据">
        <el-input v-model="form.basisNote" type="textarea" :rows="2" placeholder="经营会议、批复文件等（确认前必填）" />
      </el-form-item>
      <el-form-item label="负责人">
        <el-input v-model="form.ownerName" placeholder="确认前必填" />
      </el-form-item>
      <el-form-item v-if="needsReason" label="更改原因" required>
        <el-input v-model="form.changeReason" type="textarea" :rows="2" placeholder="说明为何调整目标（旧版本与原因会保留在版本历史）" />
      </el-form-item>
    </el-form>
    <MidlongNotice v-if="error" tone="danger">{{ error }}</MidlongNotice>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!valid" @click="submit">保存（待确认）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.p3-form { margin-top: 12px; }
.p3-dash { margin: 0 6px; color: var(--muted); }
</style>
