<script setup lang="ts">
// 交易测算 / 指标卡片 artifact：指标网格 + 涨跌色（涨红跌绿，贴合电价/行情习惯）+ 脚注。
import { LayoutGrid } from 'lucide-vue-next'
import type { CardArtifactBlock, CardMetric } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

defineProps<{ block: CardArtifactBlock }>()

// 语义色：tone 优先；否则按 trend。
function toneClass(m: CardMetric): string {
  const t = m.tone ?? m.trend
  if (t === 'up') return 'up'
  if (t === 'down') return 'down'
  return 'flat'
}
function arrow(m: CardMetric): string {
  const t = m.trend ?? m.tone
  if (t === 'up') return '▲'
  if (t === 'down') return '▼'
  return ''
}
</script>

<template>
  <ArtifactFrame kind="card" :title="block.title" :subtitle="block.subtitle">
    <template #icon><LayoutGrid :size="14" /></template>
    <div class="metric-grid">
      <div v-for="(m, i) in block.metrics" :key="i" class="metric">
        <div class="m-label">{{ m.label }}</div>
        <div class="m-value">{{ m.value }}<span v-if="m.unit" class="m-unit">{{ m.unit }}</span></div>
        <div v-if="m.delta !== undefined && m.delta !== ''" class="m-delta" :class="toneClass(m)">
          <span v-if="arrow(m)" class="m-arrow">{{ arrow(m) }}</span>{{ m.delta }}
        </div>
        <div v-if="m.hint" class="m-hint">{{ m.hint }}</div>
      </div>
    </div>
    <div v-if="block.footnote" class="card-foot">{{ block.footnote }}</div>
  </ArtifactFrame>
</template>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 1px;
  background: rgba(125, 125, 125, 0.14);
}
.metric {
  background: var(--panel-bg, #fff);
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 3px;
}
.m-label { font-size: 12px; opacity: 0.6; }
.m-value { font-size: 21px; font-weight: 700; line-height: 1.2; word-break: break-all; }
.m-unit { font-size: 12px; font-weight: 500; opacity: 0.55; margin-left: 3px; }
.m-delta { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 2px; }
.m-delta.up { color: #dc2626; }
.m-delta.down { color: #16a34a; }
.m-delta.flat { color: #6b7280; }
.m-arrow { font-size: 10px; }
.m-hint { font-size: 11px; opacity: 0.5; }
.card-foot {
  padding: 8px 14px; font-size: 11.5px; opacity: 0.55;
  border-top: 1px solid rgba(125, 125, 125, 0.14);
}
</style>
