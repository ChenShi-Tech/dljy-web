<script setup lang="ts">
// 通用加载态（Phase 5）。取代各页面手写的「转圈/加载中」碎片写法，统一无障碍语义。
defineProps<{ text?: string }>()
</script>

<template>
  <div class="ds-loading" role="status" aria-live="polite">
    <span class="ds-loading__spinner" />
    <span class="ds-loading__text">{{ text || '加载中…' }}</span>
  </div>
</template>

<style scoped>
.ds-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--el-text-color-secondary);
}
.ds-loading__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--el-border-color);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: ds-spin 0.8s linear infinite;
}
.ds-loading__text {
  font-size: 13px;
}
@keyframes ds-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
