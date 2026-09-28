<script setup lang="ts">
// 摄取 / 生效结果回显（dljy#3385 从数据摄取管理与数据接入向导两页抽出的同款结果框）。
// 诚实红线：成功/失败/超时如实回显，附 ETL 输出尾部；成功时按输出嗅探真伪（合成兜底降级为仅决策支持）。
import { computed } from 'vue'
import TrustBadge from '@/components/common/TrustBadge.vue'
import { ingestResultBasis, type IngestResult } from '@/services/data/ingestClient'

const props = withDefaults(defineProps<{ result?: IngestResult | null; error?: string; verb?: string }>(), {
  result: null,
  error: '',
  verb: '摄取'
})

const basis = computed(() => (props.result ? ingestResultBasis(props.result) : null))

const headline = computed(() => {
  const r = props.result
  if (!r) return ''
  const status = r.ok ? (basis.value === 'synthetic' ? `✓ ${props.verb}完成·合成兜底` : `✓ ${props.verb}成功`) : `✗ ${props.verb}失败`
  return `${status} · exitCode ${r.exitCode}${r.timedOut ? ' · 超时' : ''}`
})

// 只留输出尾部：ETL 日志动辄上千行，结果框只用来确认「跑到哪、为什么失败」。
const tail = computed(() => {
  const r = props.result
  if (!r) return ''
  return r.stdout.slice(-400) || r.stderr.slice(-200)
})
</script>

<template>
  <div v-if="error" class="result err">⚠ {{ error }}</div>
  <div v-else-if="result" class="result" :class="result.ok ? 'ok' : 'fail'">
    <div class="result-head">
      <span>{{ headline }}</span>
      <TrustBadge v-if="result.ok" :basis="basis" />
    </div>
    <pre v-if="tail" class="stdout">{{ tail }}</pre>
  </div>
</template>

<style scoped>
.result { padding: 8px 10px; border-radius: var(--radius-sm, 6px); font-size: var(--font-sm); border: 1px solid; }
.result.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 7%, transparent); }
.result.fail, .result.err { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 500; }
.stdout {
  margin: 6px 0 0; font-size: var(--font-xs); color: var(--text-soft); font-family: var(--ck-mono, ui-monospace, monospace);
  white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto;
}
</style>
