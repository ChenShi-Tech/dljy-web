<script setup lang="ts">
// 昨夜智能体报告卡（Epic #2033 · M1 · #2040，S1 体系消费元素之二）
// ---------------------------------------------------------------------------
// 调度系统夜跑 daily_review（scheduler kind 已存在），晨会第一屏看到昨夜结论。
// 数据复用报告库闭环：fetchReports('daily_review') → 取 36h 内最新 sched_ 前缀
// （定时产出）→ fetchReportContent 取摘要。S1 刻意不内嵌对话面板（<5 分钟红线），
// 手动触发入口=跳复盘中心。无报告/加载失败全部诚实呈现，不静默吞。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, MoonStar } from 'lucide-vue-next'
import { fetchReportContent, fetchReports, type ReportItem } from '@/services/quant/quantClient'
import { summarizeReportMd } from '@/services/review/reportDigest'

/** 昨夜窗口：夜跑跨零点，放宽到 36h 内的最新定时报告 */
const OVERNIGHT_WINDOW_MS = 36 * 3600 * 1000

const router = useRouter()
const loading = ref(true)
const latest = ref<ReportItem | null>(null)
const summary = ref('')
const contentError = ref('')

async function load() {
  loading.value = true
  try {
    const rows = await fetchReports('daily_review')
    const now = Date.now()
    latest.value =
      rows
        .filter((r) => r.session_id.startsWith('sched_') && now - r.mtime * 1000 <= OVERNIGHT_WINDOW_MS)
        .sort((a, b) => b.mtime - a.mtime)[0] ?? null
    if (latest.value) {
      try {
        const md = await fetchReportContent(latest.value.session_id, latest.value.path)
        summary.value = summarizeReportMd(md)
      } catch (e) {
        contentError.value = e instanceof Error ? e.message : '报告正文读取失败'
      }
    }
  } catch {
    // 报告列表软失败：卡片降级为「昨夜未生成」，不阻断 S1 其它区块
    latest.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
const timeLabel = computed(() =>
  latest.value ? new Date(latest.value.mtime * 1000).toLocaleString('zh-CN', { hour12: false }) : ''
)

function openFull() {
  // 全文阅读走复盘中心阅读器（报告库阅读器已有，不重复建设）
  router.push({ path: '/xhjy/review', query: { report: latest.value?.session_id ?? '' } })
}
function triggerManually() {
  router.push({ path: '/xhjy/review', query: { run: '1' } })
}
</script>

<template>
  <section class="orc">
    <header class="orc-head">
      <MoonStar :size="14" />
      <b>昨夜智能体报告</b>
      <span class="orc-src">daily_review 夜跑</span>
    </header>

    <p v-if="loading" class="orc-muted">查昨夜报告…</p>

    <template v-else-if="latest">
      <button type="button" class="orc-card" @click="openFull">
        <span class="orc-title"><FileText :size="12" /> {{ latest.title }}</span>
        <span class="orc-meta">{{ timeLabel }} · 定时产出 · 点击看全文</span>
      </button>
      <p v-if="summary" class="orc-summary">{{ summary }}</p>
      <p v-else-if="contentError" class="orc-muted">正文摘要不可用：{{ contentError }}</p>
      <p v-else class="orc-muted">正文为空或无文字段落。</p>
    </template>

    <template v-else>
      <p class="orc-empty">昨夜未生成（36 小时内无定时任务产出）。</p>
      <button type="button" class="orc-trigger" @click="triggerManually">去复盘中心手动生成 →</button>
    </template>
  </section>
</template>

<style scoped>
.orc { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; min-width: 0; }
.orc-head { display: flex; align-items: center; gap: 6px; font-size: var(--font-sm); }
.orc-head b { font-size: var(--font-12-5); }
.orc-src { margin-left: auto; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #666); border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 999px; padding: 0 7px; }
.orc-card { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 7px 9px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; background: #f8fafc; cursor: pointer; min-width: 0; }
.orc-card:hover { border-color: var(--el-color-primary, #2563eb); }
.orc-title { display: flex; align-items: center; gap: 5px; font-size: var(--font-12-5); font-weight: 600; color: var(--el-text-color-primary, #303133); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.orc-meta { font-size: var(--font-xs); color: var(--el-text-color-secondary, #666); }
.orc-summary { margin: 0; font-size: var(--font-sm); line-height: 1.6; color: var(--el-text-color-regular, #606266); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.orc-muted { margin: 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.orc-empty { margin: 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #666); }
.orc-trigger { align-self: flex-start; padding: 0; border: none; background: none; color: #2563eb; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
</style>
