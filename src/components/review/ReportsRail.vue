<script setup lang="ts">
// 复盘报告库（Epic #2033 · #2038 外壳）：右栏下半，最新一份高亮。
// 待办箱是隔壁 TodoInbox（#2039 接服务端 feed），两者不互相持有状态。
// 报告文件交付（清单 R4 文件半边 + C-1 批量下载）：单份下载 + 复选多选批量下载；
// 取正文走服务层（组件不发请求），由父组件 ReviewCenterView 落 Blob 触发浏览器下载。
import { computed, ref } from 'vue'
import type { ReportItem } from '@/services/quant/quantClient'

const props = withDefaults(
  defineProps<{
    reports: ReportItem[]
    maxReports?: number
    /** 父组件正在逐份取正文下载时置 true：下载/批量按钮禁用，防重复点击。 */
    downloading?: boolean
  }>(),
  { maxReports: 8, downloading: false }
)
const emit = defineEmits<{
  (e: 'open-report', item: ReportItem): void
  (e: 'all-reports'): void
  (e: 'download-report', item: ReportItem): void
  (e: 'download-reports', items: ReportItem[]): void
}>()

const shown = computed(() => props.reports.slice(0, props.maxReports))

// 多选（键 session_id）：勾选集只记 id，批量时按当前列表映射回完整条目
const selected = ref(new Set<string>())
const allShownSelected = computed(
  () => shown.value.length > 0 && shown.value.every((r) => selected.value.has(r.session_id))
)
function toggleOne(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll() {
  const next = new Set(selected.value)
  if (allShownSelected.value) shown.value.forEach((r) => next.delete(r.session_id))
  else shown.value.forEach((r) => next.add(r.session_id))
  selected.value = next
}
function downloadSelected() {
  const items = shown.value.filter((r) => selected.value.has(r.session_id))
  if (!items.length || props.downloading) return
  emit('download-reports', items)
}

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
    <template v-else>
      <div class="bulk">
        <label class="pick-all" title="全选/取消当前列表">
          <input type="checkbox" :checked="allShownSelected" @change="toggleAll" /> 全选
        </label>
        <button
          type="button" class="bulk-btn" :disabled="!selected.size || downloading"
          title="逐份下载勾选的报告（.md）。浏览器对连续多文件下载可能询问授权，属正常行为。"
          @click="downloadSelected"
        >{{ downloading ? '下载中…' : `批量下载${selected.size ? `（${selected.size}）` : ''}` }}</button>
      </div>
      <div v-for="(r, i) in shown" :key="r.session_id + r.path" class="li" :class="{ latest: i === 0 }">
        <input
          class="pick" type="checkbox" :checked="selected.has(r.session_id)"
          :aria-label="`选择 ${r.title}`" @change="toggleOne(r.session_id)"
        />
        <div class="body">
          <span class="t">{{ r.title }}</span>
          <span class="m">{{ reportMeta(r) }}</span>
        </div>
        <button type="button" :class="i === 0 ? 'btn' : 'lnk'" @click="emit('open-report', r)">阅读</button>
        <button
          type="button" class="lnk" :disabled="downloading"
          title="下载该报告的 Markdown 文件"
          @click="emit('download-report', r)"
        >下载</button>
      </div>
    </template>
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
.bulk { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line-soft); font-size: var(--font-12-5); }
.pick-all { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); cursor: pointer; }
.bulk-btn {
  height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--panel); font: inherit; font-size: var(--font-12-5); font-weight: 600; color: var(--text-body); cursor: pointer;
}
.bulk-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.bulk-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.li { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-top: 1px solid var(--line-soft); font-size: var(--font-md); }
/* 首行与 bulk 条之间不留双线：.bulk 已带 border-bottom */
.li:nth-child(3) { border-top: 0; }
.li.latest { background: var(--panel-sub); }
.pick { flex: none; accent-color: var(--primary); }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.t { line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.m { font-family: ui-monospace, monospace; font-size: var(--font-xs); color: var(--muted); }
.btn {
  flex: none; height: 24px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--panel); font: inherit; font-size: var(--font-sm); font-weight: 600; color: var(--text-body); cursor: pointer; white-space: nowrap;
}
.btn:hover { border-color: var(--primary); color: var(--primary); }
.lnk { flex: none; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: var(--font-12-5); font-weight: 600; padding: 2px 4px; border-radius: 3px; cursor: pointer; }
.lnk:hover:not(:disabled) { background: var(--primary-tint); }
.lnk:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
