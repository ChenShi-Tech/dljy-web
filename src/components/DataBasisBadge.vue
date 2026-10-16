<script setup lang="ts">
// 数据口径角标：与 DataBasis 全链路标注配套，区别于 region/IllustrativeBadge（仅示意一档）。
import { DATA_BASIS_LABEL, type DataBasis } from '@/services/dataBasis'

defineProps<{ basis: DataBasis; prefix?: string }>()
</script>

<template>
  <span class="data-basis-badge" :class="basis">{{ prefix ? `${prefix}：` : '' }}{{ DATA_BASIS_LABEL[basis] }}</span>
</template>

<style scoped>
.data-basis-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px dashed currentColor;
  border-radius: 10px;
  font-size: var(--font-xs);
  line-height: 1.4;
  white-space: nowrap;
}

.data-basis-badge.real {
  color: #15803d;
  background: #f0fdf4;
}

.data-basis-badge.captured {
  color: #1d4ed8;
  background: #eff6ff;
}

/* 走 EP 语义色变量：浅色档视觉同原值（EP 默认 light-9 即浅底），弧光/流光暗色档自动暗底 */
.data-basis-badge.provisional {
  color: var(--el-color-warning-dark-2, #b45309);
  background: var(--el-color-warning-light-9, #fffbeb);
}

.data-basis-badge.illustrative {
  color: var(--el-color-warning-dark-2, #a16207);
  background: var(--el-color-warning-light-9, #fffaf0);
}

.data-basis-badge.synthetic {
  color: var(--el-color-danger, #b91c1c);
  background: var(--el-color-danger-light-9, #fef2f2);
}
</style>
