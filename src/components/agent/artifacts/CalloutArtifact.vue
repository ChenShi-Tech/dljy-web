<script setup lang="ts">
// 提示框 artifact：info/warning/critical/success/tip 五级，左色条 + 图标 + Markdown 正文。
// 契合风控哨兵预警分级、合规注意事项等场景。
import type { Component } from 'vue'
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, Lightbulb } from 'lucide-vue-next'
import type { CalloutArtifactBlock } from '../../../utils/artifactBlocks'

defineProps<{ block: CalloutArtifactBlock }>()

const ICONS: Record<CalloutArtifactBlock['level'], Component> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertOctagon,
  success: CheckCircle2,
  tip: Lightbulb
}
</script>

<template>
  <div class="callout" :class="block.level">
    <component :is="ICONS[block.level]" :size="16" class="cl-icon" />
    <div class="cl-main">
      <div v-if="block.title" class="cl-title">{{ block.title }}</div>
      <div class="cl-body md" v-html="block.html" />
    </div>
  </div>
</template>

<style scoped>
.callout {
  display: flex;
  gap: 9px;
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 8px;
  border-left: 3px solid;
  font-size: 13.5px;
  line-height: 1.6;
  animation: art-in 0.3s ease-out both;
}
@keyframes art-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
.cl-icon { flex-shrink: 0; margin-top: 1px; }
.cl-main { min-width: 0; }
.cl-title { font-weight: 600; margin-bottom: 2px; }

.callout.info { border-color: #2563eb; background: rgba(37, 99, 235, 0.07); }
.callout.info .cl-icon, .callout.info .cl-title { color: #2563eb; }
.callout.warning { border-color: #f59e0b; background: rgba(245, 158, 11, 0.08); }
.callout.warning .cl-icon, .callout.warning .cl-title { color: #b45309; }
.callout.critical { border-color: #dc2626; background: rgba(220, 38, 38, 0.07); }
.callout.critical .cl-icon, .callout.critical .cl-title { color: #dc2626; }
.callout.success { border-color: #16a34a; background: rgba(22, 163, 74, 0.07); }
.callout.success .cl-icon, .callout.success .cl-title { color: #16a34a; }
.callout.tip { border-color: #7c3aed; background: rgba(124, 58, 237, 0.07); }
.callout.tip .cl-icon, .callout.tip .cl-title { color: #7c3aed; }

.cl-body :deep(p) { margin: 3px 0; }
.cl-body :deep(p:first-child) { margin-top: 0; }
.cl-body :deep(p:last-child) { margin-bottom: 0; }
.cl-body :deep(code) {
  background: rgba(125, 125, 125, 0.14); padding: 1px 5px; border-radius: 4px; font-size: 12px;
}
.cl-body :deep(ul), .cl-body :deep(ol) { padding-left: 18px; margin: 3px 0; }
.cl-body :deep(a) { color: inherit; text-decoration: underline; }
</style>
