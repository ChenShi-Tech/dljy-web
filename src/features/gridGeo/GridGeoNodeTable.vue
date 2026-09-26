<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { buildNodeTableRows } from './nodeTable'
import type { GridGeoNode } from './types'

const props = withDefaults(defineProps<{ nodes: GridGeoNode[]; grouped?: boolean; selectedId?: string | null; caption?: string }>(), { grouped: true, selectedId: null })
const emit = defineEmits<{ select: [node: GridGeoNode] }>()
const rows = computed(() => buildNodeTableRows(props.nodes, props.grouped))
const statuses = { located: '已定位', approximate: '近似位置', unresolved: '未定位' }
const kinds = { pricing: '定价节点', bus: '母线节点', substation: '变电站', boundary: '边界节点', other: '其他' }
</script>

<template>
  <div class="table-scroll" tabindex="0" role="region" aria-label="节点资产表格，可横向滚动" data-testid="node-table">
    <table>
      <caption v-if="caption">{{ caption }}</caption><caption v-else>当前页 {{ nodes.length }} 条节点 · {{ grouped ? '按所属站 → 电压等级 → 节点整理' : '按服务端顺序展示' }}</caption>
      <thead><tr><th scope="col">节点名称</th><th scope="col">所属站</th><th scope="col">电压等级</th><th scope="col">地区</th><th scope="col">位置状态</th><th scope="col">关联信息</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.node.nodeId" :data-node-id="row.node.nodeId" :class="{ selected: selectedId === row.node.nodeId, 'station-start': grouped && row.stationSpan > 0 }">
          <th scope="row" class="name-cell"><button type="button" :aria-label="`查看${row.node.nodeName}详情`" :aria-pressed="selectedId === row.node.nodeId" @click="emit('select', row.node)"><span>{{ row.node.nodeName }}</span><ChevronRight :size="15" /></button><small>{{ kinds[row.node.nodeKind] ?? row.node.nodeKind }}</small></th>
          <td class="station-cell"><span>{{ row.station }}</span><small>{{ row.station === '所属站未提供' ? '未提供' : '名称解析' }}</small></td>
          <td class="voltage-cell"><span>{{ row.voltage }}</span><small>{{ row.voltageBasis }}</small></td>
          <td class="region-cell">{{ row.region }}</td>
          <td><span class="location-badge" :class="row.node.locationStatus">{{ statuses[row.node.locationStatus] ?? '未知' }}</span><small v-if="row.node.location?.locationLabel" class="location-label">{{ row.node.location.locationLabel }}</small></td>
          <td class="links-cell"><template v-if="row.links.length"><span v-for="link in row.links" :key="link">{{ link }}</span><small>引用不保证时序覆盖</small></template><span v-else class="muted">查看详情与笔记</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-scroll { overflow-x: auto; border: 1px solid var(--border, #dbe5eb); border-radius: 10px; background: var(--surface, #fff); }
table { width: 100%; min-width: 1000px; border-collapse: collapse; text-align: left; color: var(--text, #243b49); font-size: var(--font-sm, 14px); }
caption { padding: 10px 14px; text-align: left; color: var(--text-secondary, #607482); font-size: var(--font-xs, 12px); }
thead { background: var(--surface-muted, #f2f6f8); }
th, td { padding: 11px 14px; border-top: 1px solid var(--border, #e1e8ed); vertical-align: top; }
thead th { white-space: nowrap; color: var(--text-secondary, #526c79); font-weight: 600; }
th.name-cell { width: 29%; min-width: 280px; font-weight: 400; }
small { display: block; margin-top: 4px; color: var(--text-secondary, #637984); font-size: var(--font-xs, 12px); line-height: 1.45; }
.name-cell button { display: flex; align-items: center; gap: 5px; padding: 0; border: 0; background: none; color: var(--primary, #087f87); font: inherit; font-weight: 600; cursor: pointer; text-align: left; line-height: 1.55; }
.name-cell button span { overflow-wrap: anywhere; }.name-cell svg { flex-shrink: 0; }
.station-cell { min-width: 135px; max-width: 190px; background: var(--surface-muted, #f8fafb); overflow-wrap: anywhere; }.voltage-cell { min-width: 130px; }.region-cell { min-width: 50px; }
.station-start > th, .station-start > td { border-top-color: #c7d7df; }
.location-badge { display: inline-block; padding: 3px 7px; border-radius: 5px; white-space: nowrap; font-size: var(--font-xs, 12px); }.located { color: #08735c; background: #e5f5ef; }.approximate { color: #8a6419; background: #fff2d9; }.unresolved { color: #626d7a; background: #edf1f5; }.location-label { max-width: 200px; }.links-cell { min-width: 160px; }.links-cell > span { display: block; }.muted { color: var(--text-secondary, #637984); }
tr:hover > .name-cell, tr:hover > td { background: #f4faf9; }.selected > .name-cell { background: #e8f6f3; }
button:focus-visible, .table-scroll:focus-visible { outline: 2px solid var(--primary, #087f87); outline-offset: 3px; }
</style>
