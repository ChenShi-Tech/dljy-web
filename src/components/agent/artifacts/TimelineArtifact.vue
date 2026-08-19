<script setup lang="ts">
// 时间线 artifact：竖向事件流，节点按 tone 着色(涨/跌/进行中)。
// 契合 OODA 决策步骤、复盘事件序列、申报流程节点。
import { Clock } from 'lucide-vue-next'
import type { TimelineArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

defineProps<{ block: TimelineArtifactBlock }>()
</script>

<template>
  <ArtifactFrame kind="timeline" :title="block.title">
    <template #icon><Clock :size="14" /></template>
    <ul class="tl">
      <li v-for="(e, i) in block.events" :key="i" class="tl-item" :class="e.tone">
        <span class="tl-dot" />
        <div class="tl-content">
          <div class="tl-row">
            <span v-if="e.time" class="tl-time">{{ e.time }}</span>
            <span class="tl-title">{{ e.title }}</span>
          </div>
          <div v-if="e.desc" class="tl-desc">{{ e.desc }}</div>
        </div>
      </li>
    </ul>
  </ArtifactFrame>
</template>

<style scoped>
.tl { list-style: none; margin: 0; padding: 12px 14px 12px 8px; }
.tl-item { position: relative; padding-left: 20px; padding-bottom: 12px; }
.tl-item::before {
  content: ''; position: absolute; left: 5px; top: 12px; bottom: -2px; width: 1px;
  background: rgba(125, 125, 125, 0.25);
}
.tl-item:last-child { padding-bottom: 0; }
.tl-item:last-child::before { display: none; }
.tl-dot {
  position: absolute; left: 1px; top: 4px; width: 9px; height: 9px; border-radius: 50%;
  background: #9ca3af; border: 2px solid var(--panel-bg, #fff);
}
.tl-item.up .tl-dot { background: #16a34a; }
.tl-item.down .tl-dot { background: #dc2626; }
.tl-item.active .tl-dot { background: var(--el-color-primary, #2563eb); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
.tl-row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.tl-time { font-size: var(--font-11-5); opacity: 0.55; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.tl-title { font-size: var(--font-13-5); font-weight: 600; }
.tl-desc { font-size: var(--font-12-5); opacity: 0.75; margin-top: 2px; }
</style>
