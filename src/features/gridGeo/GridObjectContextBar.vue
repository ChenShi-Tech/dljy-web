<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { routeLocationKey, routerKey, type LocationQueryRaw } from 'vue-router'
import { ArrowLeft, ArrowUpRight, X } from 'lucide-vue-next'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { useGridObjectContext } from './useGridObjectContext'
import { buildGridObjectLocation, clearGridObjectQuery, safeGridReturnPath } from './objectNavigation'
import GridObjectDrawer from './GridObjectDrawer.vue'
import { useGridObjectReadingPosition } from './useGridObjectReadingPosition'

const props = defineProps<{ date?: string; from?: string; to?: string }>()
useGridObjectReadingPosition()
const route = inject(routeLocationKey, null), router = inject(routerKey, null)
const { hasContext, reference, detail, loading, error, date: contextDate, timeWindow } = useGridObjectContext()
const detailOpen = ref(false)
const returnTo = computed(() => safeGridReturnPath(route?.query.returnTo))
const currentDate = computed(() => props.date ?? contextDate.value)
const currentWindow = computed(() => props.from && props.to ? { from: props.from, to: props.to } : currentDate.value === contextDate.value ? timeWindow.value : null)
const hasPlant = computed(() => Boolean(detail.value?.plant || detail.value?.relations.plants.length))
function go(path: string) {
  if (!reference.value || !router || !selectedCompanyId.value) return
  void router.push(buildGridObjectLocation(path, reference.value, { companyId: selectedCompanyId.value, date: currentDate.value, from: currentWindow.value?.from, to: currentWindow.value?.to, returnTo: returnTo.value ?? route?.fullPath }))
}
function clear() { if (route && router) void router.replace({ path: route.path, query: clearGridObjectQuery(route.query) as LocationQueryRaw }) }
</script>

<template>
  <section v-if="hasContext" class="object-context" aria-label="当前关联对象">
    <div class="identity"><span>{{ currentRegion.name }} · {{ currentDate }}</span><strong v-if="detail">{{ detail.objectType }} · {{ detail.name }}</strong><strong v-else-if="loading" role="status">正在读取关联对象…</strong><strong v-else role="alert">{{ error || '对象关联不可用' }}</strong></div>
    <nav aria-label="关联对象操作">
      <button v-if="returnTo && router" @click="router.push(returnTo)"><ArrowLeft :size="14" />返回来源</button>
      <button :disabled="!detail" @click="detailOpen = true">对象详情与笔记</button>
      <button v-if="route?.path !== '/grid-assets/command'" :disabled="!detail" @click="go('/grid-assets/command')">位置<ArrowUpRight :size="12" /></button>
      <button v-if="route?.path !== '/grid-assets/nodes'" :disabled="!detail || !detail.node && !detail.relations.nodes.length" @click="go('/grid-assets/nodes')">节点<ArrowUpRight :size="12" /></button>
      <button v-if="route?.path !== '/grid-assets/market'" :disabled="!hasPlant" @click="go('/grid-assets/market')">出力<ArrowUpRight :size="12" /></button>
      <button v-if="route?.path !== '/grid-assets/weather-impact'" :disabled="!hasPlant" @click="go('/grid-assets/weather-impact')">气象<ArrowUpRight :size="12" /></button>
      <button v-if="route?.path !== '/grid-assets/disclosures'" :disabled="!detail" @click="go('/grid-assets/disclosures')">披露<ArrowUpRight :size="12" /></button>
      <button aria-label="清除对象关联" @click="clear"><X :size="14" />清除关联</button>
    </nav>
    <GridObjectDrawer v-model="detailOpen" :object="reference" :date="currentDate" :from="currentWindow?.from" :to="currentWindow?.to" />
  </section>
</template>

<style scoped>
.object-context { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; margin: 10px 0; border: 1px solid #b7dcd3; border-radius: 8px; color: var(--text, #244b45); background: var(--panel, #f1fbf7); font-size: var(--font-sm); }.identity { display: flex; flex-direction: column; gap: 3px; min-width: 180px; }.identity span { color: var(--text-soft, #647a75); font-size: var(--font-xs); }.identity strong { overflow-wrap: anywhere; }nav { display: flex; flex-wrap: wrap; gap: 6px; }button { display: inline-flex; align-items: center; gap: 4px; padding: 6px 8px; border: 1px solid var(--line, #c4ddd6); border-radius: 5px; color: var(--text, #244b45); background: var(--panel, #fff); font: inherit; cursor: pointer; }button:disabled { opacity: .45; cursor: not-allowed; }button:focus-visible { outline: 2px solid #078c86; outline-offset: 2px; }
</style>
