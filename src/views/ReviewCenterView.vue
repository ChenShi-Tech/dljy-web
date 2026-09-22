<script setup lang="ts">
import { defineAsyncComponent, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQuery } from 'vue-router'
const route = useRoute()
const router = useRouter()
type ReviewViewMode = 'workbench' | 'analysis' | 'classic'
function resolveReviewViewMode(path: string, layout: unknown): ReviewViewMode {
  if (path === '/xhjy/review/analysis') return 'analysis'
  return layout === 'classic' ? 'classic' : 'workbench'
}
const viewMode = ref(resolveReviewViewMode(route.path, route.query.layout))
const reviewRoute = ref<{ path: string; query: LocationQuery }>({ path: route.path, query: { ...route.query } })
const routeActive = ref(true)
onActivated(() => { routeActive.value = true })
onDeactivated(() => { routeActive.value = false })
watch(() => [route.path, route.query] as const, ([path, query]) => {
  // KeepAlive 失活后 useRoute 仍会跟随全局导航。离开复盘路由时保持最后一个有效模式，
  // 避免缓存中的异步工作台在 Transition 搬移 DOM 的同时被目标页 path 触发重建。
  if (path === '/xhjy/review' || path === '/xhjy/review/analysis') {
    viewMode.value = resolveReviewViewMode(path, query.layout)
    reviewRoute.value = { path, query: { ...query } }
  }
})
function openWorkbench() {
  void router.push({ query: { ...route.query, layout: undefined, dim: undefined, report: undefined, run: undefined } })
}
const Workbench = defineAsyncComponent(() => import('./review/ReviewWorkbenchView.vue'))
const Classic = defineAsyncComponent(() => import('./ReviewClassicView.vue'))
</script>
<template>
  <!-- 全局 RouterView 同时套了 Transition 与 KeepAlive。这里必须保留稳定的元素根节点：
       Fragment 根在失活后重新激活时可能丢失异步组件锚点，最终只剩页面壳并触发
       insertBefore / parentNode / subTree 为空。 -->
  <div class="review-center-route">
    <template v-if="viewMode === 'classic'">
      <div class="archive-navigation"><span>历史专题与报告</span><button type="button" @click="openWorkbench">返回复盘中心</button></div>
      <Classic />
    </template>
    <Workbench
      v-else
      :key="viewMode"
      :standalone-topics="viewMode === 'analysis'"
      :review-route="reviewRoute"
      :route-active="routeActive"
    />
  </div>
</template>
<style scoped>
.review-center-route { width: 100%; min-width: 0; }
.archive-navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; color: var(--muted); font-size: var(--font-sm); }
.archive-navigation button { cursor: pointer; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--primary); font: inherit; }
.archive-navigation button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
</style>
