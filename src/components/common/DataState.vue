<script setup lang="ts">
// ============================================================================
// DataState — 通用数据态容器（Phase 5）
// ----------------------------------------------------------------------------
// 统一页面级 loading / error / empty / data 四态展示，消除各页面手写
// `loading=ref(true)` + `error=ref('')` + `<el-alert v-if="error">` + 空判断碎片
// （DataAnalysisView/ClearingSpotAnalysis/PriceAnalysis/ForecastMultiTypeCurve 等模式
// 相同却各写一套）。优先级：loading > error > empty > 默认插槽(data)。
//
// loading 态两档（#450 增强，向后兼容）：
//   - 提供具名插槽 #skeleton → 渲染骨架屏（推荐配 <SpotSkeleton>，贴近最终布局降 CLS）
//   - 未提供 → 退回默认 <LoadingState> 转圈
//
// 用法：
//   <DataState :loading="loading" :error="error" :empty="!result?.length">
//     <template #skeleton><SpotSkeleton variant="chart" :height="360" /></template>
//     <MyChart :data="result" />
//   </DataState>
// ============================================================================
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import LoadingState from './LoadingState.vue'

defineProps<{
  loading?: boolean
  error?: string
  empty?: boolean
  emptyText?: string
  loadingText?: string
}>()
</script>

<template>
  <template v-if="loading">
    <slot v-if="$slots.skeleton" name="skeleton" />
    <LoadingState v-else :text="loadingText" />
  </template>
  <ErrorState v-else-if="error" :message="error" />
  <EmptyState v-else-if="empty" :text="emptyText" />
  <slot v-else />
</template>
