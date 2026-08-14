<script setup lang="ts">
// 动态参数面板（Phase 1 / PR-A）。输入 provider 的 paramsSchema，按字段类型渲染对应 Element Plus
// 控件，v-model:params 双向绑定。支持 visibleWhen 联动显隐。切换算法 → 换 schema → 面板自动重渲染，
// 这就是「不同算法不同参数面板」的落地点。本组件纯受控、无副作用，PR-B 工作台直接复用。
import { computed } from 'vue'
import type { ParamField } from '@/services/forecast/forecastProviders'

const props = defineProps<{
  schema: ParamField[]
  params: Record<string, unknown>
}>()
const emit = defineEmits<{ (e: 'update:params', value: Record<string, unknown>): void }>()

const visibleFields = computed(() => props.schema.filter((f) => !f.visibleWhen || f.visibleWhen(props.params)))

function update(key: string, value: unknown) {
  emit('update:params', { ...props.params, [key]: value })
}
</script>

<template>
  <div v-if="visibleFields.length" class="param-panel">
    <div v-for="f in visibleFields" :key="f.key" class="param-row">
      <span class="param-label">{{ f.label }}</span>
      <!-- 滑块 -->
      <el-slider
        v-if="f.type === 'slider'"
        :model-value="(params[f.key] as number)"
        :min="f.min" :max="f.max" :step="f.step ?? 1"
        show-input size="small" class="param-slider"
        @update:model-value="update(f.key, $event)"
      />
      <!-- 数值 -->
      <el-input-number
        v-else-if="f.type === 'number'"
        :model-value="(params[f.key] as number)"
        :min="f.min" :max="f.max" :step="f.step ?? 1"
        size="small"
        @update:model-value="update(f.key, $event)"
      />
      <span v-if="f.type === 'number' && f.unit" class="param-unit">{{ f.unit }}</span>
      <!-- 下拉 -->
      <el-select
        v-else-if="f.type === 'select'"
        :model-value="params[f.key]"
        size="small" style="width: 180px"
        @update:model-value="update(f.key, $event)"
      >
        <el-option v-for="o in (f.options ?? [])" :key="String(o.value)" :label="o.label" :value="(o.value as string | number)" />
      </el-select>
      <!-- 开关 -->
      <el-switch
        v-else-if="f.type === 'switch'"
        :model-value="(params[f.key] as boolean)"
        @update:model-value="update(f.key, $event)"
      />
      <!-- 权重/多选维度组（如 KNN 特征维度）-->
      <el-checkbox-group
        v-else-if="f.type === 'weight-group'"
        :model-value="(params[f.key] as string[])"
        size="small"
        @update:model-value="update(f.key, $event)"
      >
        <el-checkbox v-for="it in (f.items ?? [])" :key="it.key" :value="it.key" border>{{ it.label }}</el-checkbox>
      </el-checkbox-group>
      <!-- 日期范围 -->
      <el-date-picker
        v-else-if="f.type === 'daterange'"
        :model-value="(params[f.key] as [string, string])"
        type="daterange" value-format="YYYY-MM-DD" unlink-panels range-separator="~"
        start-placeholder="开始" end-placeholder="结束" size="small" style="width: 240px"
        @update:model-value="update(f.key, $event)"
      />
    </div>
  </div>
  <div v-else class="param-empty">该算法无可调参数（平台官方直接回放真实采集）</div>
</template>

<style scoped>
.param-panel { display: flex; flex-direction: column; gap: 10px; }
.param-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.param-label { min-width: 168px; color: var(--el-text-color-regular); font-size: 13px; font-weight: 600; }
.param-slider { width: 280px; }
.param-unit { color: var(--el-text-color-secondary); font-size: 12px; }
.param-empty { color: var(--el-text-color-secondary); font-size: 13px; padding: 6px 0; }
</style>
