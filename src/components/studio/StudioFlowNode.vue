<template>
  <div class="sn" :class="[`sn-${kind}`, runClass, { selected }]">
    <!-- 入口 Handle（start 无）-->
    <Handle v-if="kind !== 'start'" type="target" :position="Position.Left" />

    <div class="sn-body">
      <span class="sn-icon">{{ icon }}</span>
      <div class="sn-text">
        <div class="sn-title">{{ data.label || defaultLabel }}</div>
        <div v-if="subtitle" class="sn-sub">{{ subtitle }}</div>
      </div>
      <i v-if="runStatus === 'done'" class="sn-tick">✓</i>
      <i v-else-if="runStatus === 'running'" class="sn-spin" />
      <i v-else-if="runStatus === 'skipped'" class="sn-skip">⤼</i>
      <i v-else-if="issue" class="sn-issue" :class="issue" :title="issueMsg">{{ issue === 'error' ? '!' : '?' }}</i>
    </div>

    <!-- 出口 Handle（end 无）-->
    <Handle v-if="kind !== 'end'" type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { roleMeta, type NodeType } from '@/services/agent/studioClient'

// Vue Flow 自定义节点 props（v-bind="props" 透传）
const props = defineProps<{
  id: string
  data: {
    kind: NodeType
    label?: string
    role?: string | null
    task?: string
    tool?: string | null
    items?: unknown[]
    runStatus?: 'running' | 'done' | 'skipped' | ''
    issue?: 'error' | 'warn' | ''
    issueMsg?: string
  }
  selected?: boolean
}>()

const kind = computed<NodeType>(() => props.data.kind)
const runStatus = computed(() => props.data.runStatus || '')
const issue = computed(() => props.data.issue || '')
const issueMsg = computed(() => props.data.issueMsg || '')
const selected = computed(() => props.selected)

const ICONS: Record<NodeType, string> = {
  start: '▶',
  end: '■',
  agent: '◆',
  tool: '⚙',
  map: '⛶',
  report: '▤',
  condition: '◇',
  approval: '⚑'
}
const DEFAULT_LABELS: Record<NodeType, string> = {
  start: '开始',
  end: '结束',
  agent: '智能体',
  tool: '数据工具',
  map: '动态扇出',
  report: '汇总报告',
  condition: '条件分支',
  approval: '人工审批'
}

const icon = computed(() => {
  if (kind.value === 'agent' || kind.value === 'report' || kind.value === 'condition' || kind.value === 'map') {
    return roleMeta(props.data.role)?.char || ICONS[kind.value]
  }
  return ICONS[kind.value]
})
const defaultLabel = computed(() => DEFAULT_LABELS[kind.value])
const subtitle = computed(() => {
  if (kind.value === 'agent' || kind.value === 'report') {
    return roleMeta(props.data.role)?.name || (props.data.role ?? '默认角色')
  }
  if (kind.value === 'map') {
    const n = Array.isArray(props.data.items) ? props.data.items.length : 0
    return `并行 ${n} 项 · ${roleMeta(props.data.role)?.name || '默认角色'}`
  }
  if (kind.value === 'tool') return props.data.tool || '未选工具'
  if (kind.value === 'condition') return '条件路由'
  if (kind.value === 'approval') return '挂起等待审批'
  return ''
})
const runClass = computed(() => (runStatus.value ? `run-${runStatus.value}` : ''))
</script>

<style scoped>
.sn {
  min-width: 132px;
  max-width: 200px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-image), var(--panel);
  box-shadow: var(--shadow);
  font-family: inherit;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
}
.sn.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-tint);
}
.sn-body {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
}
.sn-icon {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  font-size: var(--font-lg);
  background: var(--primary-tint);
  color: var(--primary);
  font-family: var(--font-display);
}
.sn-text {
  min-width: 0;
  flex: 1;
}
.sn-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sn-sub {
  font-size: var(--font-10-5);
  color: var(--muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sn-tick {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--success);
  color: #fff;
  font-size: var(--font-xs);
  display: grid;
  place-items: center;
  font-style: normal;
}
.sn-skip {
  flex: none;
  color: var(--muted);
  font-style: normal;
  font-size: var(--font-lg);
}
.sn-issue {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: var(--font-sm);
  font-weight: 700;
  font-style: normal;
  display: grid;
  place-items: center;
  cursor: help;
}
.sn-issue.error { background: var(--danger, #dc2626); }
.sn-issue.warn { background: #d97706; }
.sn-spin {
  flex: none;
  width: 15px;
  height: 15px;
  border: 2px solid var(--primary-tint);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: sn-rot 0.8s linear infinite;
}
@keyframes sn-rot {
  to {
    transform: rotate(360deg);
  }
}

/* 按类型着色 icon */
.sn-start .sn-icon,
.sn-end .sn-icon {
  background: var(--surface-hover);
  color: var(--muted);
}
.sn-condition .sn-icon {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.sn-approval .sn-icon {
  background: color-mix(in srgb, #d97706 18%, transparent);
  color: #d97706;
}
.sn-report .sn-icon {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--primary);
}
.sn-tool .sn-icon {
  background: color-mix(in srgb, #0891b2 16%, transparent);
  color: #0891b2;
}
.sn-map .sn-icon {
  background: color-mix(in srgb, #7c3aed 16%, transparent);
  color: #7c3aed;
}

/* 运行态高亮 */
.sn.run-running {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary), 0 0 22px -4px var(--primary);
}
.sn.run-done {
  border-color: var(--success);
}
.sn.run-skipped {
  opacity: 0.6;
}

/* Handle 命中区放大、配色 */
.sn :deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--panel);
  border: 1.5px solid var(--primary);
}
.sn :deep(.vue-flow__handle:hover) {
  background: var(--primary);
}
</style>
