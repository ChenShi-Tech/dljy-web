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
  font-size: 11px;
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

.data-basis-badge.illustrative {
  color: #a16207;
  background: #fffaf0;
}

.data-basis-badge.synthetic {
  color: #b91c1c;
  background: #fef2f2;
}
</style>
