<script setup lang="ts">
// 通用空态（Phase 5）。复用 el-empty，统一「无数据」展示（取代各页面 v-if 空提示碎片）。
defineProps<{ text?: string; description?: string }>()
</script>

<template>
  <el-empty :description="text || description || '暂无数据'" />
</template>
