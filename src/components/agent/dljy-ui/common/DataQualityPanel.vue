<script setup lang="ts">
// 数据可用性面板（common）：渲染 MorningBriefBundle.data_availability 四态清单
// （real/forecast/mock/missing），口径由后端确定性标注，不靠 LLM 自报。
// 跨板块复用（晨报/申报前体检/复盘），故入 common 包。
import { computed } from 'vue'
import { arr, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Item = { key: string; label: string; status: string; note: string }
const STATUS: Record<string, { label: string; cls: string }> = {
  real: { label: '真实', cls: 's-real' },
  forecast: { label: '预测', cls: 's-forecast' },
  mock: { label: '模拟', cls: 's-mock' },
  missing: { label: '缺失', cls: 's-missing' }
}
function meta(s: string) {
  return STATUS[s] ?? STATUS.missing
}

const items = computed<Item[]>(() => {
  const raw = arr(props.data.items ?? props.data.data_availability ?? props.data)
  return raw.map((r) => {
    const o = obj(r)
    return {
      key: str(o.key, str(o.label)),
      label: str(o.label, str(o.key, '—')),
      status: str(o.status, 'missing'),
      note: str(o.note)
    }
  })
})
const mock = computed(
  () => props.data.mock === true || items.value.some((i) => i.status === 'mock' || i.status === 'missing')
)
const gaps = computed(() => items.value.filter((i) => i.status === 'missing'))
</script>

<template>
  <section class="dq-panel">
    <header>
      <h3>{{ title || '数据可用性' }}</h3>
      <span class="dq-basis" :class="mock ? 'b-mock' : 'b-real'">{{ mock ? '含模拟/缺失' : '真实采集' }}</span>
    </header>
    <ul class="dq-list">
      <li v-for="it in items" :key="it.key" :title="it.note">
        <span class="dq-dot" :class="meta(it.status).cls"></span>
        <span class="dq-label">{{ it.label }}</span>
        <span class="dq-status" :class="meta(it.status).cls">{{ meta(it.status).label }}</span>
        <span v-if="it.note" class="dq-note">{{ it.note }}</span>
      </li>
    </ul>
    <p v-if="gaps.length" class="dq-gaps">⚠ 缺口：{{ gaps.map((g) => g.label).join('、') }}</p>
  </section>
</template>

<style scoped>
.dq-panel {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
h3 { margin: 0; font-size: 16px; color: var(--text, #111827); }
.dq-basis { font-size: 12px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.dq-basis.b-real { color: #15803d; background: rgba(22, 163, 74, 0.12); }
.dq-basis.b-mock { color: #b45309; background: rgba(245, 158, 11, 0.14); }
.dq-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.dq-list li { display: flex; align-items: center; gap: 8px; font-size: 13px; min-width: 0; }
.dq-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dq-label { color: var(--text-body, #344054); flex: none; }
.dq-status { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; flex: none; }
.dq-note { color: var(--muted, #98a2b3); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-real { color: #15803d; }
.dq-dot.s-real { background: #16a34a; }
.dq-status.s-real { background: rgba(22, 163, 74, 0.14); }
.s-forecast { color: #1d4ed8; }
.dq-dot.s-forecast { background: #2563eb; }
.dq-status.s-forecast { background: rgba(37, 99, 235, 0.14); }
.s-mock { color: #b45309; }
.dq-dot.s-mock { background: #f59e0b; }
.dq-status.s-mock { background: rgba(245, 158, 11, 0.16); }
.s-missing { color: #6b7280; }
.dq-dot.s-missing { background: #9ca3af; }
.dq-status.s-missing { background: rgba(107, 114, 128, 0.16); }
.dq-gaps { margin: 10px 0 0; font-size: 12px; color: #b45309; }
</style>
