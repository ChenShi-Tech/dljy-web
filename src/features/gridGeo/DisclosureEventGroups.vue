<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { fetchGridDisclosureEvents } from './client'
import DisclosureMaintenanceList from './DisclosureMaintenanceList.vue'
import type { MaintenanceTiming } from './disclosureMaintenance'
import type { GridDisclosureCategory, GridDisclosureEvent, GridDisclosureGroup } from './types'

const props = defineProps<{
  groups: GridDisclosureGroup[]
  query: Record<string, string | number>
  scopeKey: string
  selectedId?: string | null
  selectedEvent?: GridDisclosureEvent | null
  focusGroupKey?: string | null
  eventTiming: (event: GridDisclosureEvent) => MaintenanceTiming
}>()
const emit = defineEmits<{ select: [event: GridDisclosureEvent] }>()
type GroupPage = { items: GridDisclosureEvent[]; page: number; pageSize: number; total: number; loaded: boolean; loading: boolean; error: string }
const states = shallowRef<Record<string, GroupPage>>({})
const openKeys = shallowRef(new Set<string>())
const favoriteUpdates = shallowRef<Record<string, boolean>>({})
const requests = new Map<string, AbortController>()
const idPrefix = useId()
const pageSize = 8
let generation = 0
const categoryLabels: Record<GridDisclosureCategory, string> = { maintenance: '检修计划', outage: '非计划停运', intervention: '人工干预', congestion: '断面阻塞', constraint: '输电约束' }
const categories = Object.keys(categoryLabels) as GridDisclosureCategory[]
const displayed = computed(() => props.groups.map(group => {
  const state = states.value[group.groupKey]
  return {
    ...group,
    panelId: `${idPrefix}-group-${encodeURIComponent(group.groupKey)}`,
    open: openKeys.value.has(group.groupKey),
    badges: categories.filter(category => group.countsByCategory[category] > 0),
    state,
    pages: state ? Math.max(1, Math.ceil(state.total / state.pageSize)) : 1,
    rows: (state?.items ?? []).map(event => {
      const favorite = favoriteUpdates.value[event.eventId]
      const current = favorite === undefined ? event : { ...event, personalFavorite: favorite }
      return { event: current, timing: props.eventTiming(current) }
    }),
  }
}))
function updateState(key: string, state: GroupPage) { states.value = { ...states.value, [key]: state } }
async function loadGroup(group: GridDisclosureGroup, page = 1) {
  const token = generation
  const key = group.groupKey
  requests.get(key)?.abort()
  const controller = new AbortController()
  requests.set(key, controller)
  updateState(key, { items: [], page, pageSize, total: states.value[key]?.total ?? group.total, loaded: false, loading: true, error: '' })
  const current = () => token === generation && requests.get(key) === controller && !controller.signal.aborted
  try {
    const result = await fetchGridDisclosureEvents({ ...props.query, groupKey: key, page, pageSize }, { signal: controller.signal })
    if (!current()) return
    updateState(key, { items: result.items, page: result.page, pageSize: result.pageSize, total: result.total, loaded: true, loading: false, error: '' })
  } catch (cause) {
    if (!current()) return
    updateState(key, { ...states.value[key]!, loading: false, error: cause instanceof Error ? cause.message : '该组披露读取失败，请重试' })
  } finally { if (requests.get(key) === controller) requests.delete(key) }
}
function expandGroup(group: GridDisclosureGroup) {
  openKeys.value = new Set([...openKeys.value, group.groupKey])
  const state = states.value[group.groupKey]
  if (!state?.loaded && !state?.loading && !state?.error) void loadGroup(group)
}
function toggleGroup(group: GridDisclosureGroup) {
  if (!openKeys.value.has(group.groupKey)) { expandGroup(group); return }
  const next = new Set(openKeys.value)
  next.delete(group.groupKey)
  openKeys.value = next
}
function reset() {
  generation += 1
  for (const controller of requests.values()) controller.abort()
  requests.clear()
  states.value = {}
  openKeys.value = new Set()
  favoriteUpdates.value = {}
}
watch([() => props.query, () => props.scopeKey], reset, { deep: true })
watch([() => props.focusGroupKey, () => props.groups], () => {
  const group = props.groups.find(item => item.groupKey === props.focusGroupKey)
  if (group) expandGroup(group)
}, { immediate: true })
watch(() => props.selectedEvent, event => {
  if (event?.personalFavorite !== undefined) favoriteUpdates.value = { ...favoriteUpdates.value, [event.eventId]: event.personalFavorite }
}, { immediate: true, deep: true })
onBeforeUnmount(reset)
</script>

<template>
  <div class="disclosure-groups" data-testid="disclosure-groups">
    <div v-if="openKeys.size" class="group-actions"><button type="button" @click="openKeys = new Set()">全部收起</button></div>
    <p v-if="!groups.length" class="empty" role="status">没有符合当前筛选条件的披露记录。</p>
    <section v-for="group in displayed" :key="group.groupKey" class="event-group" :class="{ expanded: group.open }" :data-group-key="group.groupKey">
      <h3 class="group-heading"><button type="button" class="group-toggle" :aria-expanded="group.open" :aria-controls="group.panelId" @click="toggleGroup(group)">
        <ChevronDown v-if="group.open" :size="17" aria-hidden="true" /><ChevronRight v-else :size="17" aria-hidden="true" />
        <span class="group-name">{{ group.label }}</span><span class="group-total">{{ group.total.toLocaleString('zh-CN') }} 条</span>
        <span class="group-categories"><span v-for="category in group.badges" :key="category" class="category-badge">{{ categoryLabels[category] }} {{ group.countsByCategory[category].toLocaleString('zh-CN') }}</span></span>
      </button></h3>
      <div v-show="group.open" :id="group.panelId" class="group-body" :aria-busy="group.state?.loading ?? false">
        <p v-if="group.state?.loading" class="message" role="status">正在读取{{ group.label }}的披露…</p>
        <div v-else-if="group.state?.error" class="message error" role="alert"><span>{{ group.state.error }}</span><button type="button" :aria-label="`重试读取${group.label}的披露`" @click="loadGroup(group, group.state.page)"><RefreshCw :size="14" />重试</button></div>
        <template v-else-if="group.state?.loaded">
          <DisclosureMaintenanceList :rows="group.rows" :selected-id="selectedId" generic @select="emit('select', $event)" />
          <nav class="group-pagination" :aria-label="`${group.label}披露分页`"><span>共 {{ group.state.total.toLocaleString('zh-CN') }} 条 · 第 {{ group.state.page }}/{{ group.pages }} 页</span><button type="button" :disabled="group.state.page <= 1" @click="loadGroup(group, group.state.page - 1)">上一页</button><button type="button" :disabled="group.state.page >= group.pages" @click="loadGroup(group, group.state.page + 1)">下一页</button></nav>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.disclosure-groups{min-width:0;padding:0 16px 16px}.group-actions{display:flex;justify-content:flex-end;margin:0 0 8px}.group-actions button{padding:4px 0;border:0;background:transparent;color:var(--primary);font:inherit;font-size:var(--font-xs);cursor:pointer}.event-group{min-width:0;border:1px solid var(--line);border-radius:7px;overflow:hidden;margin-top:8px;background:var(--panel)}.event-group.expanded{border-color:var(--primary-soft,var(--line))}.group-heading{margin:0;font:inherit}.group-toggle{display:flex;align-items:center;gap:10px;width:100%;padding:14px;border:0;background:var(--panel-sub);color:var(--text);text-align:left;font:inherit;cursor:pointer}.group-toggle:hover{background:var(--primary-tint)}.group-toggle>svg{flex-shrink:0;color:var(--primary)}.group-name{font-size:var(--font-sm);font-weight:600;overflow-wrap:anywhere;min-width:0}.group-total{flex-shrink:0;font-size:var(--font-sm);color:var(--muted);font-variant-numeric:tabular-nums}.group-categories{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto;justify-content:flex-end}.category-badge{padding:3px 6px;background:var(--panel);border:1px solid var(--line-soft);border-radius:4px;font-size:var(--font-xs);color:var(--text-soft);white-space:nowrap}.group-body{border-top:1px solid var(--line);min-width:0}.message,.empty{padding:18px 14px;margin:0;color:var(--muted);font-size:var(--font-sm);line-height:1.6}.empty{text-align:center}.error{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--danger)}.error button{display:inline-flex;align-items:center;gap:5px}.group-pagination{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:10px 14px;background:var(--panel-sub);font-size:var(--font-xs);color:var(--muted)}.group-pagination>span{margin-right:auto}.group-pagination button,.error button{border:1px solid var(--line);background:var(--panel);color:var(--text);padding:5px 9px;border-radius:5px;font:inherit;font-size:var(--font-xs);cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid var(--primary);outline-offset:-3px}@media(max-width:650px){.disclosure-groups{padding:0 8px 10px}.group-toggle{gap:7px;padding:12px;flex-wrap:wrap}.group-total{margin-left:auto}.group-categories{width:100%;margin-left:24px;justify-content:flex-start}.group-pagination{padding:10px;gap:6px}.group-pagination>span{flex-basis:100%;margin:0}}
</style>
