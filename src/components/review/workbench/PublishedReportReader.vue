<script setup lang="ts">
import { ref } from 'vue'
import type { Publication } from '@/services/review/workpapers'
import { reportEvidenceCaption } from '@/services/review/reportPresentation'
import ReportEvidenceChart from './ReportEvidenceChart.vue'
const props = defineProps<{ publication: Publication }>()
const brief = ref(false)
const exporting = ref(false), exportError = ref('')
async function exportWord() {
  if (exporting.value) return
  exporting.value = true; exportError.value = ''
  const version = props.publication, summary = brief.value
  try { const { downloadReportWord } = await import('@/services/review/reportWordExport'); await downloadReportWord(version, summary) }
  catch { exportError.value = '导出未完成，请重试。已发布版本仍保存在服务器。' }
  finally { exporting.value = false }
}
</script>
<template>
  <section class="published-reader">
    <header><b>已发布报告 · 第 {{ publication.revision }} 版</b><label><input v-model="brief" type="checkbox" />只看管理层摘要</label><button type="button" :disabled="exporting" @click="exportWord">{{ exporting ? '正在导出…' : '导出 Word' }}</button></header>
    <p v-if="exportError" role="alert">{{ exportError }}</p>
    <h2>{{ publication.content.title }}</h2>
    <p>{{ publication.content.scope.objectLabel }} · {{ publication.content.scope.startDate }}—{{ publication.content.scope.endDate }} · 主笔 {{ publication.content.authorId }}</p>
    <p class="notice">{{ publication.content.notice }}</p>
    <h3>管理层摘要</h3><p class="text">{{ publication.content.summary || '本版本未单独撰写摘要，请查看正文。' }}</p>
    <p v-for="item in brief ? publication.content.evidence : []" :key="item.id" class="notice">{{ reportEvidenceCaption(item) }}</p>
    <template v-if="!brief"><article v-for="block in publication.content.blocks" :key="block.id"><h3>{{ block.title }}</h3><template v-if="block.evidenceId"><p>{{ block.evidenceRole === 'comparison' ? '比较依据' : '本次依据' }}</p><ReportEvidenceChart v-if="publication.content.evidence.find(item => item.id === block.evidenceId)" :evidence="publication.content.evidence.find(item => item.id === block.evidenceId)!" /></template><p class="text">{{ block.text }}</p><template v-if="block.kind === 'reason'"><p>{{ block.state === 'confirmed' ? '交易员已核实' : '待核实的可能原因' }}</p><p class="text">支持证据：{{ block.supports || '未记录' }}</p><p class="text">反对证据：{{ block.refutes || '未记录' }}</p></template></article></template>
  </section>
</template>
<style scoped>.published-reader{padding:20px;border:1px solid var(--line);border-radius:8px;margin-top:18px}header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.text{white-space:pre-wrap;overflow-wrap:anywhere}p{line-height:1.8;font-size:var(--font-sm)}.notice{color:var(--muted)}h2{font-size:var(--font-xl)}h3{font-size:var(--font-lg)}article{padding-top:12px;border-top:1px solid var(--line)}</style>
