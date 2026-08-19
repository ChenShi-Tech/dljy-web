<script setup lang="ts">
// AI 建议回溯面板（#1969），建议 vs 实际的偏差可统计，判断该不该信它。
//
// 数据来自 assistTraceStore（AiAssistFill 建议到达即留痕、采纳回填 adopted）；
// decision_log 类建议经 StageDailyClose 与日志条目关联后，T+2 回填实际值即出命中。
// 原型态存储警示常驻（服务端化随决策日志 #2037 一并处理）。
import { computed, ref } from 'vue'
import {
  assistHitOf,
  ASSIST_TRACE_NOTICE,
  listAssistTrace,
  type AssistTraceEntry
} from '@/services/trading/assistTraceStore'

const props = defineProps<{ targetDate: string }>()

const traces = ref<AssistTraceEntry[]>([])
function reload() {
  traces.value = listAssistTrace(props.targetDate).length
    ? listAssistTrace(props.targetDate)
    : listAssistTrace()
}
reload()

const KIND_LABEL: Record<string, string> = {
  morning_review: 'S1 归因',
  direction: 'S3 方向',
  contract_gap: 'S6 执行',
  decision_log: 'S7 日志'
}

const stats = computed(() => {
  const rows = traces.value.filter((t) => t.kind === 'decision_log')
  const judged = rows.map(assistHitOf).filter((v): v is boolean => v !== null)
  return {
    total: traces.value.length,
    adopted: traces.value.filter((t) => t.adopted).length,
    judged: judged.length,
    hitRate: judged.length ? Math.round((judged.filter(Boolean).length / judged.length) * 100) : null
  }
})
</script>

<template>
  <details class="atp">
    <summary>
      AI 建议回溯
      <em>
        {{ stats.adopted }}/{{ stats.total }} 被采纳
        <template v-if="stats.hitRate !== null"> · P10–P90 命中 {{ stats.hitRate }}%（{{ stats.judged }} 条已回填实际）</template>
      </em>
      <button type="button" class="atp-refresh" @click.prevent="reload">刷新</button>
    </summary>
    <p class="atp-note">{{ ASSIST_TRACE_NOTICE }}</p>
    <table v-if="traces.length" class="atp-table">
      <thead>
        <tr><th>时间</th><th>判断点</th><th>建议</th><th>置信</th><th>采纳</th><th>实际/命中</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in traces.slice().reverse()" :key="t.id">
          <td>{{ t.at.slice(5, 16).replace('T', ' ') }}</td>
          <td>{{ KIND_LABEL[t.kind] ?? t.kind }}</td>
          <td class="atp-sugg">{{ JSON.stringify(t.suggestion).slice(0, 60) }}</td>
          <td>{{ t.confidence }}</td>
          <td>{{ t.adopted ? `✓ ${t.adoptedFields.join('/')}` : '未采纳' }}</td>
          <td>
            <span v-if="assistHitOf(t) === null">{{ t.kind === 'decision_log' ? '待回填' : '无实际值来源' }}</span>
            <span v-else :class="assistHitOf(t) ? 'hit' : 'miss'">{{ t.actual }} {{ assistHitOf(t) ? '命中' : '偏离' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="atp-empty">尚无建议记录——用各步「AI 帮我判断」后自动留痕。</p>
  </details>
</template>

<style scoped>
.atp { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 6px 10px; }
.atp summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.atp summary em { font-style: normal; font-weight: 400; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.atp-refresh { padding: 1px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; background: #fff; font-size: 10px; cursor: pointer; }
.atp[open] summary { margin-bottom: 6px; }
.atp-note { margin: 0 0 6px; font-size: 10px; color: #b45309; }
.atp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.atp-table th, .atp-table td { padding: 4px 5px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; vertical-align: top; }
.atp-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.atp-sugg { max-width: 200px; word-break: break-all; font-family: ui-monospace, monospace; font-size: 10px; }
.hit { color: #15803d; }
.miss { color: #b91c1c; }
.atp-empty { margin: 0; padding: 6px 0; font-size: 12px; color: var(--el-text-color-secondary, #667); }
</style>
