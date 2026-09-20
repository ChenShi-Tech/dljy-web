<script setup lang="ts">
// 入口锚定一次性提示（dljy#3134）：今日无数据、已定位到最新有数据日，可切回今天。
// 只呈现锚定结果，不改任何查询状态；动作交由 useInsightEntryAnchor 的宿主页面执行。
import type { InsightAnchorNotice } from '@/composables/useInsightEntryAnchor'

defineProps<{ notice: InsightAnchorNotice }>()
const emit = defineEmits<{ backToday: []; dismiss: [] }>()
</script>

<template>
  <el-alert
    type="info"
    :closable="true"
    data-testid="insight-anchor-notice"
    @close="emit('dismiss')"
  >
    <template #title>
      今日（{{ notice.requested }}）暂无数据，已定位到最新有数据日 {{ notice.anchoredTo }}。
      <el-button link type="primary" size="small" data-testid="insight-anchor-back-today" @click="emit('backToday')">切回今天</el-button>
    </template>
  </el-alert>
</template>
