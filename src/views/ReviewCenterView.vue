<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
function openWorkbench() {
  void router.push({ query: { ...route.query, layout: undefined, dim: undefined, report: undefined, run: undefined } })
}
const Workbench = defineAsyncComponent(() => import('./review/ReviewWorkbenchView.vue'))
const Classic = defineAsyncComponent(() => import('./ReviewClassicView.vue'))
</script>
<template>
  <template v-if="route.query.layout === 'classic' && route.path !== '/xhjy/review/analysis'">
    <div class="archive-navigation"><span>历史专题与报告</span><button type="button" @click="openWorkbench">返回复盘中心</button></div>
    <Classic />
  </template>
  <Workbench v-else :standalone-topics="route.path === '/xhjy/review/analysis'" />
</template>
<style scoped>
.archive-navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; color: var(--muted); font-size: var(--font-sm); }
.archive-navigation button { cursor: pointer; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--primary); font: inherit; }
.archive-navigation button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
</style>
