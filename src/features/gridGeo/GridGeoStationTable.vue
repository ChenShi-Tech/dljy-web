<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { regionProfiles } from '@/data/regions'
import { fetchGridGeoNodes } from './client'
import GridGeoNodeTable from './GridGeoNodeTable.vue'
import type { GridGeoNode, GridGeoNodeStationGroup } from './types'

const props = defineProps<{
  groups: GridGeoNodeStationGroup[]
  query: Record<string, string | number>
  scopeKey: string
  selectedId?: string | null
}>()
const emit = defineEmits<{ select: [node: GridGeoNode] }>()
type StationPage = { items: GridGeoNode[]; page: number; total: number; totalPages: number; loaded: boolean; loading: boolean; error: string; retryPage: number; missing: boolean; mock: boolean }
const states = shallowRef<Record<string, StationPage>>({})
const openKeys = shallowRef(new Set<string>())
const requests = new Map<string, AbortController>()
const idPrefix = useId()
const pageSize = 60
let epoch = 0
const querySignature = computed(() => JSON.stringify(Object.entries(props.query).sort(([a], [b]) => a.localeCompare(b))))
const contextSignature = computed(() => JSON.stringify([props.scopeKey, querySignature.value]))
const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '未提供'
const displayed = computed(() => props.groups.map(group => {
  const state = states.value[group.groupKey]
  const voltages = [...new Set(group.voltageLevels.filter(value => Number.isFinite(value) && value >= 1 && value <= 1000))].sort((a, b) => b - a)
  return {
    ...group, state, open: openKeys.value.has(group.groupKey),
    panelId: `${idPrefix}-station-${encodeURIComponent(group.groupKey)}`,
    region: regionProfiles.find(region => region.id === group.regionId)?.shortName ?? group.regionId,
    voltageLabel: voltages.length ? `${voltages.join(' / ')} kV` : '未提供节点电压',
    incomplete: state?.loaded && state.page >= state.totalPages && state.items.length < state.total,
  }
}))

function updateState(key: string, state: StationPage) { states.value = { ...states.value, [key]: state } }
async function loadStation(group: GridGeoNodeStationGroup, page = 1) {
  const key = group.groupKey
  const previous = states.value[key]
  if (previous?.loading) return
  const requestEpoch = epoch, requestContext = contextSignature.value
  const controller = new AbortController()
  requests.get(key)?.abort(); requests.set(key, controller)
  updateState(key, { items: page > 1 ? previous?.items ?? [] : [], page: page > 1 ? previous?.page ?? 0 : 0, total: previous?.total ?? group.nodeCount, totalPages: previous?.totalPages ?? 1, loaded: page > 1 && Boolean(previous?.loaded), loading: true, error: '', retryPage: page, missing: false, mock: page > 1 && Boolean(previous?.mock) })
  const isCurrent = () => requestEpoch === epoch && requestContext === contextSignature.value && requests.get(key) === controller && !controller.signal.aborted
  try {
    const result = await fetchGridGeoNodes({ ...props.query, stationGroupKey: key, page, pageSize }, { signal: controller.signal })
    if (!isCurrent()) return
    const pagination = result.data?.pagination
    if (!Array.isArray(result.data?.items) || !pagination || pagination.page !== page || !Number.isSafeInteger(pagination.total) || pagination.total < 0 || !Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0) throw new Error('节点分页信息不完整，请重试读取。')
    const existing = page > 1 ? previous?.items ?? [] : []
    const unique = new Map(existing.map(item => [item.nodeId, item]))
    for (const item of result.data.items) unique.set(item.nodeId, item)
    updateState(key, { items: [...unique.values()], page, total: pagination.total, totalPages: Math.max(1, pagination.totalPages), loaded: true, loading: false, error: '', retryPage: page, missing: result.data.dataAvailability?.status === 'missing', mock: Boolean(result.mock) || page > 1 && Boolean(previous?.mock) })
  } catch (cause) {
    if (!isCurrent()) return
    updateState(key, { ...states.value[key]!, loading: false, error: cause instanceof Error ? cause.message : '该站节点读取失败，请重试。' })
  } finally { if (requests.get(key) === controller) requests.delete(key) }
}
function toggleStation(group: GridGeoNodeStationGroup) {
  const next = new Set(openKeys.value)
  if (next.has(group.groupKey)) next.delete(group.groupKey)
  else {
    next.add(group.groupKey)
    const state = states.value[group.groupKey]
    if (!state?.loaded && !state?.loading && !state?.error) void loadStation(group)
  }
  openKeys.value = next
}
function reset() {
  epoch += 1
  for (const controller of requests.values()) controller.abort()
  requests.clear(); states.value = {}; openKeys.value = new Set()
}
watch(contextSignature, reset, { flush: 'sync' })
watch(() => props.groups, groups => {
  const visible = new Set(groups.map(group => group.groupKey))
  for (const [key, controller] of requests) if (!visible.has(key)) { controller.abort(); requests.delete(key) }
  states.value = Object.fromEntries(Object.entries(states.value).filter(([key]) => visible.has(key)))
  openKeys.value = new Set([...openKeys.value].filter(key => visible.has(key)))
})
onBeforeUnmount(reset)
</script>

<template>
  <section class="station-table" data-testid="station-table">
    <div class="station-tools"><p>按所属站收拢 · 电压概览含名称解析值，展开查看每条节点及其依据。</p><button v-if="openKeys.size" type="button" @click="openKeys = new Set()">全部收起</button></div>
    <p v-if="!groups.length" class="empty" role="status">没有匹配的站或节点。</p>
    <div v-else class="station-scroll" role="region" tabindex="0" aria-label="所属站汇总表，可横向滚动">
      <table class="station-summary-table">
        <caption class="sr-only">当前筛选的所属站汇总；展开后读取该站全部匹配节点。</caption>
        <thead><tr><th scope="col">所属站 / 对象</th><th scope="col">节点数</th><th scope="col">电压概览</th><th scope="col">地区</th><th scope="col">位置状态</th><th scope="col">价格引用</th></tr></thead>
        <tbody v-for="group in displayed" :key="group.groupKey" :data-group-key="group.groupKey">
          <tr class="station-row" :class="{ expanded: group.open }">
            <th scope="row" class="station-name"><button type="button" class="station-toggle" :aria-label="`${group.open ? '收起' : '展开'}${group.displayName}的节点`" :aria-expanded="group.open" :aria-controls="group.panelId" @click="toggleStation(group)"><ChevronDown v-if="group.open" :size="16" aria-hidden="true" /><ChevronRight v-else :size="16" aria-hidden="true" /><span>{{ group.displayName }}</span></button><small v-if="!group.stationName">所属站未提供 · 独立条目</small></th>
            <td class="node-count">{{ count(group.nodeCount) }}</td>
            <td class="voltage"><span>{{ group.voltageLabel }}</span><small v-if="group.unknownVoltageCount">电压待补 {{ count(group.unknownVoltageCount) }} 条</small></td>
            <td class="region">{{ group.region }}</td>
            <td class="location-counts"><span>已定位 {{ count(group.summary.locatedCount) }}</span><span>近似 {{ count(group.summary.approximateCount) }} · 未定位 {{ count(group.summary.unresolvedCount) }}</span></td>
            <td class="price-count"><span>{{ count(group.priceReferenceCount) }} 条节点引用</span><small>不保证时序覆盖</small></td>
          </tr>
          <tr v-if="group.open" class="station-detail-row"><td colspan="6">
            <div :id="group.panelId" class="station-detail" :aria-busy="group.state?.loading ?? false">
              <p v-if="group.state?.mock" class="message simulated">模拟数据</p>
              <GridGeoNodeTable v-if="group.state?.items.length" :nodes="group.state.items" :selected-id="selectedId" :caption="`已显示 ${count(group.state.items.length)} / 本站匹配 ${count(group.state.total)} 条节点`" @select="emit('select', $event)" />
              <p v-if="group.state?.loading" class="message" role="status">正在读取{{ group.displayName }}的节点…</p>
              <div v-if="group.state?.error" class="message error" role="alert"><span>{{ group.state.error }}</span><button type="button" :aria-label="`重试读取${group.displayName}的节点`" @click="loadStation(group, group.state.retryPage)"><RefreshCw :size="14" />重试</button></div>
              <p v-else-if="group.state?.loaded && !group.state.items.length" class="message" role="status">{{ group.state.missing ? '该站节点资料暂未接入。' : '该站在当前筛选下暂无匹配节点，记录可能已更新。' }}</p>
              <div v-if="group.state?.loaded" class="station-progress">
                <span>已显示 {{ count(group.state.items.length) }} / 本站匹配 {{ count(group.state.total) }} 条节点</span>
                <button v-if="group.state.page < group.state.totalPages && !group.state.error" type="button" :disabled="group.state.loading" :aria-label="`加载更多${group.displayName}的节点`" @click="loadStation(group, group.state.page + 1)">加载更多节点</button>
                <template v-else-if="group.incomplete && !group.state.error"><span>记录在读取期间发生变化，请重新读取。</span><button type="button" :disabled="group.state.loading" @click="loadStation(group)">重新读取该站节点</button></template>
              </div>
            </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.station-table { min-width: 0; color: var(--text, #243b49); font-size: var(--font-sm, 14px); }
.station-tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }.station-tools p { margin: 0; color: var(--text-secondary, #637984); font-size: var(--font-xs, 12px); line-height: 1.5; }.station-tools button { flex: none; }
.station-scroll { max-width: 100%; overflow-x: auto; border: 1px solid var(--border, #dbe5eb); border-radius: 10px; background: var(--surface, #fff); }.station-summary-table { width: 100%; min-width: 860px; border-collapse: collapse; text-align: left; }.station-summary-table > thead { background: var(--surface-muted, #f2f6f8); }.station-summary-table > thead th { padding: 11px 12px; font-weight: 600; white-space: nowrap; color: var(--text-secondary, #526c79); }.station-row > th,.station-row > td { padding: 11px 12px; border-top: 1px solid var(--border, #dbe5eb); vertical-align: top; line-height: 1.55; }.station-row:hover,.station-row.expanded { background: #f3faf8; }
.station-name { width: 30%; min-width: 220px; max-width: 360px; }.station-toggle { display: flex; align-items: flex-start; gap: 7px; width: 100%; border: 0; padding: 0; color: var(--primary, #087f79); background: transparent; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }.station-toggle svg { flex: none; margin-top: 3px; }.station-toggle span { overflow-wrap: anywhere; }.station-name small { padding-left: 23px; }.node-count { min-width: 55px; font-weight: 600; font-variant-numeric: tabular-nums; }.voltage { min-width: 120px; }.region { min-width: 45px; }.location-counts { min-width: 140px; }.location-counts span { display: block; }.price-count { min-width: 110px; }small { display: block; color: var(--text-secondary, #637984); font-size: var(--font-xs, 12px); font-weight: 400; }
.station-detail-row > td { padding: 0; border-top: 1px solid #d7e5e1; }.station-detail { min-width: 0; padding: 10px 12px 12px; background: var(--surface-muted, #f6f9fa); }.station-detail :deep(.table-scroll) { max-width: 100%; }.station-progress { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: flex-end; padding-top: 10px; color: var(--text-secondary, #637984); font-size: var(--font-xs, 12px); }.station-progress > span:first-child { margin-right: auto; }
.station-tools button,.station-progress button,.error button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border, #ccdce3); border-radius: 6px; padding: 6px 9px; color: var(--primary, #087f79); background: var(--surface, #fff); font: inherit; cursor: pointer; }.message,.empty { margin: 0; padding: 14px 8px; line-height: 1.6; color: var(--text-secondary, #637984); }.empty { text-align: center; }.error { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: #b42318; }.simulated { color: #9a6617; font-weight: 600; }button:disabled { opacity: .5; cursor: not-allowed; }button:focus-visible,.station-scroll:focus-visible { outline: 2px solid var(--primary, #087f79); outline-offset: -2px; }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media(max-width:760px) { .station-tools { align-items: flex-start; }.station-summary-table > thead th,.station-row > th,.station-row > td { padding: 9px; }.station-name { min-width: 190px; }.station-detail { padding: 8px; } }
</style>
