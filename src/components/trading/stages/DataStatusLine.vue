<script setup lang="ts">
// 数据与口径状态行（trading-day-morning-summary-and-lazy-stages 任务 4.3）
// ---------------------------------------------------------------------------
// 收纳「看完一次就够」的说明性内容：窗口提示、口径未登记、通道未接说明等散落的
// 常驻黄条与徽章——默认一行摘要，展开逐条看原文（spec「警示与口径状态收纳」）。
// 诚实边界：阻断性提示（强制补写拦截、硬约束拦截）、取数三态（无权限/读取失败/无
// 数据）与 Mock/原型态标识不由本组件承载，必须保持直接可见——调用方不得把这几类
// 塞进 items。
export interface DataStatusItem {
  tone: 'info' | 'caveat'
  text: string
}

withDefaults(defineProps<{ items?: DataStatusItem[]; label?: string }>(), {
  items: () => [],
  label: '数据与口径状态'
})

import { ref } from 'vue'
import { ChevronDown, Info } from 'lucide-vue-next'

const open = ref(false)
</script>

<template>
  <div v-if="items.length" class="dsl">
    <button type="button" class="dsl-bar" :aria-expanded="open" @click="open = !open">
      <Info :size="13" />
      <span>{{ label }} {{ items.length }} 条</span>
      <ChevronDown :size="13" class="dsl-chevron" :class="{ 'dsl-chevron-open': open }" />
    </button>
    <ul v-if="open" class="dsl-list">
      <li v-for="(item, i) in items" :key="i" :class="`dsl-item-${item.tone}`">{{ item.text }}</li>
    </ul>
  </div>
</template>

<style scoped>
.dsl { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsl-bar { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 3px 10px; border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 999px; background: #fafafa; color: var(--el-text-color-secondary, #666); font-size: var(--font-11-5); cursor: pointer; }
.dsl-bar:hover { color: var(--el-text-color-regular, #606266); }
.dsl-chevron { transition: transform 0.15s ease; }
.dsl-chevron-open { transform: rotate(180deg); }
.dsl-list { list-style: none; margin: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 8px; background: #fafafa; }
.dsl-item-info { font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.dsl-item-caveat { font-size: var(--font-11-5); color: var(--el-color-warning, #b45309); }
</style>
