<script setup lang="ts">
// 市场洞察对象多选器（dljy#2996，OpenSpec 任务 5.5）
// ----------------------------------------------------------------------------
// 分析对象（节点 / 场站 / 通道等）的多选入口。选项由页面传入——本阶段不建对象目录
// 接口，目录从哪来（获权清单、绑定表、历史选择、远程检索）由业务页决定：
//   - 静态模式（默认）：options 由页面一次性备好；
//   - 远程模式（dljy#3007 价格页）：remote + remoteMethod，页面边搜边把结果写回
//     options（本组件不持检索状态，检索失败重试也由页面负责）。
//   - 上限来自 analysis.limits.maxObjects：选满后禁止继续选（multiple-limit）并明示
//     「最多可选 N 个」，不静默截断用户的选择；
//   - requiresObjects 的分析未选对象时由页面拦截查询（不发请求）；本组件只负责
//     如实显示「请先选择节点或场站」的引导（prop 控制显隐）。

import { computed } from 'vue'

export type InsightObjectOption = { id: string; label: string }

const props = defineProps<{
  modelValue: string[]
  options: InsightObjectOption[]
  /** analysis.limits.maxObjects；0 表示无对象维度（不渲染本组件即可） */
  maxObjects?: number
  /** requiresObjects 时未选对象的引导文案开关（由页面按 limits 判断） */
  requiresObjects?: boolean
  placeholder?: string
  disabled?: boolean
  /** 远程检索（dljy#3007 价格页节点搜索）：true 时启用 el-select remote 模式 */
  remote?: boolean
  /** 远程检索回调（输入变化触发）；选项由页面写回 options prop */
  remoteMethod?: (query: string) => void
  /** 远程检索进行中（el-select loading 态） */
  remoteLoading?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

const selected = computed({
  get: () => props.modelValue,
  set: (ids: string[]) => emit('update:modelValue', ids),
})

/** 占位提示：requiresObjects 且未选时引导用户，而不是发一个注定 400 的查询。 */
const placeholderText = computed(() =>
  props.requiresObjects && !props.modelValue.length
    ? '请先选择节点或场站'
    : props.placeholder ?? '选择分析对象'
)

const atLimit = computed(() => Boolean(props.maxObjects && props.modelValue.length >= props.maxObjects))
</script>

<template>
  <div class="insight-object-picker">
    <el-select
      v-model="selected"
      multiple
      filterable
      clearable
      collapse-tags
      collapse-tags-tooltip
      :multiple-limit="maxObjects || 0"
      :placeholder="placeholderText"
      :disabled="disabled"
      :remote="remote"
      :remote-method="remoteMethod"
      :loading="remoteLoading"
      :reserve-keyword="remote"
      class="insight-object-picker__select"
    >
      <el-option v-for="option in options" :key="option.id" :label="option.label" :value="option.id" />
    </el-select>
    <p v-if="requiresObjects && !modelValue.length" class="insight-object-picker__hint">
      请先选择节点或场站，再进行查询。
    </p>
    <p v-else-if="atLimit" class="insight-object-picker__hint">最多可选 {{ maxObjects }} 个对象。</p>
  </div>
</template>

<style scoped>
.insight-object-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.insight-object-picker__select {
  min-width: 260px;
}

.insight-object-picker__hint {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}
</style>
