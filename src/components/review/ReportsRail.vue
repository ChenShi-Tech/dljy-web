<script setup lang="ts">
// 复盘报告库（Epic #2033 · #2038 外壳）：右栏下半，最新一份高亮。
// 待办箱是隔壁 TodoInbox（#2039 接服务端 feed），两者不互相持有状态。
import { computed } from 'vue'
import type { ReportItem } from '@/services/quant/quantClient'

const props = withDefaults(
  defineProps<{
    reports: ReportItem[]
    maxReports?: number
  }>(),
  { maxReports: 8 }
)
const emit = defineEmits<{
  (e: 'open-report', item: ReportItem): void
  (e: 'all-reports'): void
}>()

const shown = computed(() => props.reports.slice(0, props.maxReports))

function reportMeta(r: ReportItem): string {
  const when = new Date(r.mtime * 1000)
  const d = when.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  const t = when.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${d} ${t} · ${r.session_id.startsWith('sched_') ? '定时' : '手动'}`
}
</script>

<template>
  <section class="panel box rep" data-testid="review-reports">
    <header>复盘报告 <b class="cnt">{{ reports.length }}</b>
      <button v-if="reports.length > maxReports" type="button" class="lnk all" @click="emit('all-reports')">全部 ›</button>
    </header>
    <p v-if="!reports.length" class="empty">暂无报告。点头部「生成报告」或等每日定时任务产出。</p>
    <div v-for="(r, i) in shown" :key="r.session_id + r.path" class="li" :class="{ latest: i === 0 }">
      <div class="body">
        <span class="t">{{ r.title }}</span>
        <span class="m">{{ reportMeta(r) }}</span>
      </div>
      <button type="button" :class="i === 0 ? 'btn' : 'lnk'" @click="emit('open-report', r)">阅读</button>
    </div>
  </section>
</template>

<style scoped>
.box { padding: 0; }
.box > header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft); font-size: var(--font-md); font-weight: 600;
}
.cnt { color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.all { margin-left: auto; font-weight: 500; }
.empty { margin: 0; padding: 14px; font-size: var(--font-12-5); color: var(--muted); line-height: 1.6; }
.li { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-top: 1px solid var(--line-soft); font-size: var(--font-md); }
.li:nth-child(2) { border-top: 0; }
.li.latest { background: var(--panel-sub); }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.t { line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.m { font-family: ui-monospace, monospace; font-size: var(--font-xs); color: var(--muted); }
.btn {
  flex: none; height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--panel); font: inherit; font-size: var(--font-sm); font-weight: 600; color: var(--text-body); cursor: pointer; white-space: nowrap;
}
.btn:hover { border-color: var(--primary); color: var(--primary); }
.lnk { flex: none; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: var(--font-12-5); font-weight: 600; padding: 2px 4px; border-radius: 3px; cursor: pointer; }
.lnk:hover { background: var(--primary-tint); }
</style>
