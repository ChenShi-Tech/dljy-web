<script setup lang="ts">
// 通用错误态（Phase 5）。复用 el-alert，统一各页面错误展示（取代散落的 el-alert 各自配置）。
defineProps<{ message?: string; title?: string }>()
</script>

<template>
  <el-alert
    :title="title || message || '加载失败'"
    type="error"
    show-icon
    :closable="false"
  >
    <template v-if="message && title" #default>{{ message }}</template>
  </el-alert>
</template>
