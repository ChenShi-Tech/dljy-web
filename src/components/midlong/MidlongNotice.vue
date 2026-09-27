<script setup lang="ts">
// 中长期域兼容别名（#2954）：实现已上移至 src/components/common/CalloutBox.vue；对外 props（info/warn/danger + title）不变，既有引用点无需改动。
import CalloutBox from '@/components/common/CalloutBox.vue'

withDefaults(defineProps<{ tone?: 'info' | 'warn' | 'danger'; title?: string }>(), { tone: 'info', title: '' })
</script>

<template>
  <CalloutBox :tone="tone" :title="title"><slot /></CalloutBox>
</template>
