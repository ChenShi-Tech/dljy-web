<script setup lang="ts">
// 北京时间「日期 + 时刻」输入（dljy#2973，MT-01/MT-02）。
// Element Plus 的 datetime 选择器在只点日期时会自动补 00:00（组件测试实测：点日期后值即为「YYYY-MM-DD 00:00」），
// 会把「只知道日期」伪装成确切时刻、绕过后端「只给日期不接受」的校验。这里把日期与时刻拆成两个必须都填的输入：
// 两项都填 → 「YYYY-MM-DD HH:mm」；都不填 → 空串（未知）；只填一项 → 原样回传不完整值，由使用方判定不可提交。
// 本组件不修正任何值：手输出的不存在日期（如 2031-02-30）原样回传，使用方用 isCompleteBeijingDateTimeInput 判定不可提交。
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ modelValue: string; datePlaceholder?: string; timePlaceholder?: string }>(), { datePlaceholder: '日期', timePlaceholder: '时:分' })
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const date = ref('')
const time = ref('')

function split(value: string) {
  const [d = '', t = ''] = String(value ?? '').split(' ')
  date.value = d
  time.value = t
}
watch(() => props.modelValue, (value) => {
  if (value !== compose()) split(value)
}, { immediate: true })

/** 只填日期 → 「YYYY-MM-DD」，只填时刻 → 「 HH:mm」，都不填 → 空串；都填才是完整的「YYYY-MM-DD HH:mm」。 */
function compose(): string {
  if (!time.value) return date.value
  return `${date.value} ${time.value}`
}

function onDate(value: string | null) {
  date.value = value ?? ''
  emit('update:modelValue', compose())
}
function onTime(value: string | null) {
  time.value = value ?? ''
  emit('update:modelValue', compose())
}
</script>

<template>
  <span class="bj-datetime">
    <el-date-picker :model-value="date" type="date" value-format="YYYY-MM-DD" :placeholder="datePlaceholder" style="width: 150px" data-test="bj-date" @update:model-value="onDate" />
    <el-time-picker :model-value="time" format="HH:mm" value-format="HH:mm" :placeholder="timePlaceholder" style="width: 110px" data-test="bj-time" @update:model-value="onTime" />
    <span class="bj-zone">北京时间</span>
  </span>
</template>

<style scoped>
.bj-datetime { display: inline-flex; align-items: center; gap: 6px; }
.bj-zone { font-size: var(--font-xs); color: var(--muted); }
</style>
