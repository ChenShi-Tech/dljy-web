<script setup lang="ts">
// 复盘域兼容别名（#2954）：实现已上移至 src/components/common/CalloutBox.vue；tone 'note' 映射为公共 'info'，对外 props 不变。
import CalloutBox from '@/components/common/CalloutBox.vue'

withDefaults(defineProps<{ tone?: 'note' | 'warn' | 'mock'; title?: string }>(), { tone: 'note', title: '' })
</script>

<template>
  <CalloutBox :tone="tone === 'note' ? 'info' : tone" :title="title"><slot /></CalloutBox>
</template>
