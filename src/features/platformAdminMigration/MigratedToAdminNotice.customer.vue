<script setup lang="ts">
// 迁移提示组件的客户交付版空壳（ChenShi-Tech/dljy#3464）。
// 客户版构建时 dljy-customer-edition 插件把 MigratedToAdminNotice.vue 重定向到这里：客户版没有
// 已迁入口（登记表空壳恒答未迁移），调用方的 v-if 本就不会渲染它；空壳保证提示文字不进交付产物。
// 本文件会进交付产物（源码注释虽被压缩掉），故连注释也不写提示原文。
defineProps<{ entries: readonly string[]; variant?: 'inline' | 'page' }>()
</script>

<template>
  <template v-if="false" />
</template>
