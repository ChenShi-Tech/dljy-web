<script setup lang="ts">
import { Activity, Database, Gauge, Layers3 } from 'lucide-vue-next'
import type { GridTopologyManifest } from '../types'
import type { TopologyTransportMeta } from './topologyViewportLoader'

defineProps<{ manifest: GridTopologyManifest; sourceType: 'CONFIG' | 'DB' | 'IMPORT'; rendered: number; total: number; lod: 0 | 1 | 2; truncated: boolean; transport: TopologyTransportMeta | null }>()
</script>

<template>
  <section class="topology-layer-status" aria-label="授权网架视觉状态">
    <div><Database :size="14" /><span><small>来源与版本</small><strong>{{ sourceType }} · {{ manifest.topologyVersion || '未配置' }}</strong></span></div>
    <div><Layers3 :size="14" /><span><small>视口实体</small><strong>{{ rendered }}/{{ total }} · LOD {{ lod }}</strong></span></div>
    <div><Gauge :size="14" /><span><small>预算</small><strong>{{ transport?.budgetStatus || '—' }} · {{ transport?.responseBytes ?? '—' }} B</strong></span></div>
    <div><Activity :size="14" /><span><small>SLO / 截断</small><strong>{{ transport?.sloStatus || '—' }} · {{ truncated ? '分页截断' : '完整' }}</strong></span></div>
  </section>
</template>

<style scoped>
.topology-layer-status{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0}.topology-layer-status>div{display:flex;min-width:0;align-items:center;gap:7px;padding:9px;color:#b594ee;border:1px solid #9476bd24;border-radius:9px;background:#090e214d}.topology-layer-status span,.topology-layer-status small,.topology-layer-status strong{display:block;min-width:0}.topology-layer-status small{color:#677f91;font-size: var(--font-lg)}.topology-layer-status strong{overflow:hidden;margin-top:2px;color:#c9dce6;font-size: var(--font-lg);text-overflow:ellipsis;white-space:nowrap}
</style>
