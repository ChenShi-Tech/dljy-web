<script setup lang="ts">
// 分时估算草稿（dljy#2971，MP-04「用户生成的分配草案必须标估算且不覆盖原资料」）。
// 按合同正式月度分解均分或按一天各时段权重分摊；结果一律是内部估算，不计入正式分时持仓、不覆盖正式资料。
// 月量未知的月份不生成（不把年总量均摊到月）；舍入与尾差规则按估算模板公示。
import { computed, reactive, ref, watch } from 'vue'
import MidlongNotice from '../MidlongNotice.vue'
import { midlongFailureOf, type MidlongFailure } from '@/services/midlong/midlongApi'
import { createCurveEstimate } from '@/services/midlong/midlongP2Api'
import {
  CURVE_ESTIMATE_GRANULARITIES, CURVE_ESTIMATE_METHOD_LABELS, CURVE_GRANULARITY_LABELS, CURVE_TEMPLATES,
  type CurveDraftResult, type CurveEstimateMethod,
} from '@/services/midlong/midlongP2Types'
import { parseProfileWeights, rangeValue } from '@/services/midlong/midlongP2Format'

const props = defineProps<{ modelValue: boolean; contractId: number; revisionNo: number; deliveryStart: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [CurveDraftResult] }>()

const template = CURVE_TEMPLATES['MIDLONG-CURVE-ESTIMATE-V1']
const form = reactive({ method: 'FLAT' as CurveEstimateMethod, granularityMinutes: 60 as 15 | 30 | 60, coverage: [] as string[], profileText: '', note: '' })
const busy = ref(false)
const failure = ref<MidlongFailure | null>(null)
const result = ref<CurveDraftResult | null>(null)

watch(() => props.modelValue, (open) => {
  if (!open) return
  Object.assign(form, { method: 'FLAT', granularityMinutes: 60, profileText: '', note: '' })
  form.coverage = props.deliveryStart ? [props.deliveryStart.slice(0, 7), props.deliveryStart.slice(0, 7)] : []
  failure.value = null
  result.value = null
})

const periodsPerDay = computed(() => 1440 / form.granularityMinutes)
const profile = computed(() => (form.method === 'PROFILE' ? parseProfileWeights(form.profileText, periodsPerDay.value) : null))
const blockedReason = computed(() => {
  if (form.coverage.length !== 2) return '请选择覆盖月份'
  if (profile.value && !profile.value.ok) return profile.value.message
  if (!form.note.trim()) return '请写明估算依据'
  return ''
})

async function submit() {
  if (blockedReason.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
    result.value = await createCurveEstimate(props.contractId, {
      expectedRevisionNo: props.revisionNo,
      coverageFromMonth: form.coverage[0],
      coverageToMonth: form.coverage[1],
      granularityMinutes: form.granularityMinutes,
      method: form.method,
      profile: profile.value?.ok ? profile.value.weights : undefined,
      note: form.note.trim(),
    })
    emit('created', result.value)
  } catch (error) {
    failure.value = midlongFailureOf(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="生成分时估算（内部估算）" width="620px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <template v-if="!result">
      <MidlongNotice tone="warn" title="结果是内部估算">不计入正式分时持仓，不覆盖正式资料；只有月量的月份在正式视图里仍显示「分时未知」。</MidlongNotice>
      <MidlongNotice tone="info" :title="template.label">{{ template.roundingRuleText }}</MidlongNotice>
      <el-form label-width="96px" class="ml-form">
        <el-form-item label="估算方法">
          <el-radio-group v-model="form.method">
            <el-radio v-for="(label, m) in CURVE_ESTIMATE_METHOD_LABELS" :key="m" :value="m">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="粒度">
          <el-select v-model="form.granularityMinutes" style="width: 140px">
            <el-option v-for="g in CURVE_ESTIMATE_GRANULARITIES" :key="g" :label="CURVE_GRANULARITY_LABELS[g]" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="覆盖月份">
          <el-date-picker :model-value="form.coverage" type="monthrange" @update:model-value="(v: unknown) => (form.coverage = rangeValue(v))" value-format="YYYY-MM" range-separator="至" start-placeholder="起始月" end-placeholder="结束月" style="width: 240px" />
        </el-form-item>
        <el-form-item v-if="form.method === 'PROFILE'" label="时段权重">
          <el-input v-model="form.profileText" type="textarea" :rows="3" :placeholder="`${periodsPerDay} 个非负权重，逗号或空格分隔，第 1 个对应 00:00 起的时段`" />
        </el-form-item>
        <el-form-item label="估算依据" required>
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="500" placeholder="用途与权重来源（必填）" />
        </el-form-item>
      </el-form>
      <MidlongNotice v-if="failure" tone="danger" :title="`未能生成：${failure.message}`" />
    </template>
    <MidlongNotice v-else :tone="result.validation.blocking ? 'danger' : 'info'" :title="`估算草稿 #${result.setNo} 已生成`">
      确认后保存为内部估算，仍不计入正式分时持仓。
      <router-link :to="`/zcqjy/curves/${result.curveSetId}`" class="ml-link">查看估算草稿 →</router-link>
    </MidlongNotice>
    <template #footer>
      <span v-if="!result && blockedReason" class="ml-hint">{{ blockedReason }}</span>
      <el-button @click="emit('update:modelValue', false)">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :loading="busy" :disabled="Boolean(blockedReason)" @click="submit">生成估算草稿</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-form { margin-top: 12px; }
.ml-hint { color: var(--muted); font-size: var(--font-sm); margin-right: 8px; }
.ml-link { color: var(--accent); text-decoration: none; margin-left: 6px; }
</style>
