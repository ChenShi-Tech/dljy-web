<script setup lang="ts">
// 市场洞察业务日期窗选择器（dljy#2996，OpenSpec 任务 5.5）
// ----------------------------------------------------------------------------
// 业务日期窗（北京时间闭区间）的 daterange 封装：跨度上限来自 analysis.limits.maxDays。
// 超出上限时提示并保持原值——不截断（截断出来的窗口不是用户选的窗口，口径会悄悄变）。
// 清空选择视为无效输入：保持原值并提示（洞察查询必须有日期窗）。

import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: { start: string; end: string }
  /** analysis.limits.maxDays；0 / 缺省回落契约上限 366 天 */
  maxDays?: number
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [window: { start: string; end: string }] }>()

const DAY_MS = 86_400_000
const effectiveMaxDays = computed(() => props.maxDays || 366)

/** el-date-picker 的 v-model（[start, end] 字符串对）。 */
const pickerValue = computed(() => [props.modelValue.start, props.modelValue.end])
const limitNotice = ref<string | null>(null)

/** 日历确认选择：跨度合法才上抛；超限/清空提示并维持原窗口。 */
function onChange(value: string[] | null): void {
  if (!value || value.length !== 2 || !value[0] || !value[1]) {
    limitNotice.value = '请选择完整的开始与结束日期'
    return
  }
  const [start, end] = value
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1
  if (!Number.isFinite(days) || days < 1) {
    limitNotice.value = '日期不正确，请重新选择'
    return
  }
  if (days > effectiveMaxDays.value) {
    limitNotice.value = `单次分析最多 ${effectiveMaxDays.value} 天，当前 ${days} 天；请缩小范围（未自动截断）`
    return
  }
  limitNotice.value = null
  emit('update:modelValue', { start, end })
}
</script>

<template>
  <div class="insight-date-range">
    <el-date-picker
      :model-value="pickerValue"
      type="daterange"
      value-format="YYYY-MM-DD"
      range-separator="至"
      start-placeholder="开始日期"
      end-placeholder="结束日期"
      :disabled="disabled"
      :clearable="false"
      @update:model-value="onChange"
      @visible-change="() => (limitNotice = null)"
    />
    <p v-if="limitNotice" class="insight-date-range__notice">{{ limitNotice }}</p>
  </div>
</template>

<style scoped>
.insight-date-range {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.insight-date-range__notice {
  margin: 0;
  color: #b45309;
  font-size: var(--font-xs, 12px);
}
</style>
