<script setup lang="ts">
// 流程清单 artifact：带状态(完成/进行中/待办/阻塞)的有序步骤或勾选清单。
// 契合交易操作流程、合规检查清单、申报步骤跟踪。ordered=true 编号步骤；false 勾选清单。
import { computed } from 'vue'
import { ListChecks, CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-vue-next'
import type { StepsArtifactBlock, StepStatus } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: StepsArtifactBlock }>()

const STATUS_ICON = { done: CheckCircle2, doing: CircleDot, blocked: XCircle, todo: Circle }
function iconOf(s?: StepStatus) {
  return s ? STATUS_ICON[s] : Circle
}

// 有状态时显示完成进度；纯无状态步骤不打扰。
const progress = computed(() => {
  const total = props.block.steps.length
  const tracked = props.block.steps.filter((s) => s.status)
  if (!tracked.length) return null
  const done = props.block.steps.filter((s) => s.status === 'done').length
  return { done, total }
})
</script>

<template>
  <ArtifactFrame kind="steps" :title="block.title">
    <template #icon><ListChecks :size="14" /></template>
    <template v-if="progress" #actions>
      <span class="steps-sum">{{ progress.done }}/{{ progress.total }}</span>
    </template>
    <ol class="steps" :class="{ unordered: !block.ordered }">
      <li v-for="(s, i) in block.steps" :key="i" class="step" :class="s.status">
        <span class="step-node">
          <span v-if="block.ordered" class="step-num">{{ i + 1 }}</span>
          <component :is="iconOf(s.status)" v-else :size="15" />
        </span>
        <div class="step-body">
          <div class="step-row">
            <span class="step-title">{{ s.title }}</span>
            <span v-if="s.time" class="step-time">{{ s.time }}</span>
          </div>
          <div v-if="s.desc" class="step-desc">{{ s.desc }}</div>
        </div>
      </li>
    </ol>
  </ArtifactFrame>
</template>

<style scoped>
.steps-sum { font-size: var(--font-11-5); opacity: 0.6; font-variant-numeric: tabular-nums; }
.steps { list-style: none; margin: 0; padding: 12px 14px; }
.step { position: relative; display: flex; gap: 10px; padding-bottom: 12px; }
.step:last-child { padding-bottom: 0; }
/* 竖向连接线（编号步骤） */
.steps:not(.unordered) .step::before {
  content: ''; position: absolute; left: 11px; top: 24px; bottom: -2px; width: 1px;
  background: rgba(125, 125, 125, 0.22);
}
.steps:not(.unordered) .step:last-child::before { display: none; }
.step-node {
  flex-shrink: 0; width: 23px; height: 23px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(125, 125, 125, 0.12); color: #6b7280;
  font-size: var(--font-sm); font-weight: 600; font-variant-numeric: tabular-nums;
}
.step.done .step-node { background: rgba(22, 163, 74, 0.14); color: #16a34a; }
.step.doing .step-node { background: rgba(37, 99, 235, 0.14); color: var(--el-color-primary, #2563eb); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
.step.blocked .step-node { background: rgba(220, 38, 38, 0.14); color: #dc2626; }
.step-body { flex: 1; min-width: 0; padding-top: 2px; }
.step-row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.step-title { font-size: var(--font-13-5); font-weight: 600; }
.step.done .step-title { opacity: 0.65; }
.step.blocked .step-title { color: #dc2626; }
.step-time { font-size: var(--font-11-5); opacity: 0.5; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.step-desc { font-size: var(--font-12-5); opacity: 0.72; margin-top: 2px; line-height: 1.5; white-space: pre-wrap; }
</style>
