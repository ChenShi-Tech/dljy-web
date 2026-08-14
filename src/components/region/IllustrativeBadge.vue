<script setup lang="ts">
// 特征示意角标：标注“非实时/示意”数据，符合项目对量化画像的数据诚实性要求。
defineProps<{ label?: string }>()
</script>

<template>
  <span class="illustrative-badge">{{ label ?? '特征示意（非实时）' }}</span>
</template>

<style scoped>
.illustrative-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px dashed var(--warning);
  border-radius: 10px;
  background: var(--panel-sub);
  color: var(--warning);
  font-size: 11px;
  line-height: 1.4;
}
</style>
