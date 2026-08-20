<script setup lang="ts">
// 表格单元格内迷你条形：在数字旁叠加一条相对长度的背景条，让「电量/容量/持仓」
// 等数值列一眼看出大小分布。零依赖，宽度 = value/max。
import { computed } from 'vue'
import { fmtNum } from '@/services/chart/chartOptions'

const props = withDefaults(defineProps<{
  value: number | null | undefined
  max: number
  color?: string
  digits?: number
  unit?: string
}>(), {
  color: 'var(--primary, #0f766e)',
  digits: 2,
  unit: ''
})

const pct = computed(() => {
  const v = Number(props.value)
  if (!Number.isFinite(v) || !props.max) return 0
  return Math.max(0, Math.min(100, (v / props.max) * 100))
})
const text = computed(() => {
  const t = fmtNum(props.value, props.digits)
  return props.unit && t !== '-' ? `${t} ${props.unit}` : t
})
</script>

<template>
  <div class="sparkbar">
    <div class="sparkbar__track">
      <div class="sparkbar__fill" :style="{ width: pct + '%', background: color }" />
    </div>
    <span class="sparkbar__val">{{ text }}</span>
  </div>
</template>

<style scoped>
.sparkbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sparkbar__track {
  position: relative;
  flex: 1;
  min-width: 36px;
  height: 6px;
  border-radius: 3px;
  background: var(--line-faint, #f0f2f5);
  overflow: hidden;
}
.sparkbar__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.sparkbar__val {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  color: var(--text-body, #344054);
}
</style>
