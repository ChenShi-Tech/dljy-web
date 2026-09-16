<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DecisionReference, Publication } from '@/services/review/workpapers'
import { decisionReferenceCaption, reportEvidenceCaption, rendersMaterial, segmentCaption } from '@/services/review/reportPresentation'
import DecisionReferenceCard from './DecisionReferenceCard.vue'
import ReportEvidenceChart from './ReportEvidenceChart.vue'
const props = defineProps<{ publication: Publication }>()
const router = useRouter()
// 摘要模式只出说明文字（与证据说明同形态），但关联依据不能因此消失：
// 管理层版本里申报相关的结论同样需要出处与「不代表因果关系」的提示。
// 关联块缺冻结副本只可能是数据残缺；静默过滤会让读者把一份不完整的报告当成完整的读，导出也已拒绝同样的版本。
const incompleteDecisions = computed(() => props.publication.content.blocks.some(block => block.kind === 'decision' && !block.reference))
const decisionCaptions = computed(() => props.publication.content.blocks.filter(block => block.kind === 'decision' && block.reference).map(block => ({ id: block.id, text: decisionReferenceCaption(block.reference!) })))
function openDeclaration(reference: DecisionReference) {
  void router.push({ path: '/xhjy/desk', query: { declarationId: reference.declarationId, targetDate: reference.targetDate } })
}
const brief = ref(false)
const exporting = ref(false), exportError = ref('')
async function exportReport(format: 'word' | 'print') {
  if (exporting.value) return
  exporting.value = true; exportError.value = ''
  const version = props.publication, summary = brief.value
  try {
    if (format === 'word') { const { downloadReportWord } = await import('@/services/review/reportWordExport'); await downloadReportWord(version, summary) }
    else { const { printPublishedReport } = await import('@/services/review/reportPrintExport'); await printPublishedReport(version, summary) }
  }
  catch { exportError.value = '导出未完成，请重试。已发布版本仍保存在服务器。' }
  finally { exporting.value = false }
}
</script>
<template>
  <section class="published-reader">
    <header><b>已发布报告 · 第 {{ publication.revision }} 版</b><label><input v-model="brief" type="checkbox" />只看管理层摘要</label><button type="button" :disabled="exporting" @click="exportReport('word')">导出 Word</button><button type="button" :disabled="exporting" @click="exportReport('print')">打印 / 保存 PDF</button><span v-if="exporting" role="status">正在准备报告…</span></header>
    <p v-if="exportError" role="alert">{{ exportError }}</p>
    <p v-if="incompleteDecisions" role="alert">这份发布版本的关联申报资料不完整，不能当作完整报告阅读或导出，请联系主笔重新发布。</p>
    <h2>{{ publication.content.title }}</h2>
    <p>{{ publication.content.scope.objectLabel }} · {{ publication.content.scope.startDate }}—{{ publication.content.scope.endDate }} · 主笔 {{ publication.content.authorId }}</p>
    <p class="notice">{{ publication.content.notice }}</p>
    <h3>管理层摘要</h3><p class="text">{{ publication.content.summary || '本版本未单独撰写摘要，请查看正文。' }}</p>
    <p v-for="item in brief ? publication.content.evidence : []" :key="item.id" class="notice">{{ reportEvidenceCaption(item) }}</p>
    <p v-for="item in brief ? decisionCaptions : []" :key="item.id" class="notice">{{ item.text }}</p>
    <template v-if="!brief"><article v-for="block in publication.content.blocks" :key="block.id"><h3>{{ block.title }}</h3><p v-if="block.segments?.length" class="text">{{ segmentCaption(block, publication.content.evidence.find(item => item.id === block.evidenceId)) }}</p><template v-if="rendersMaterial(publication.content.blocks, block)"><p>{{ block.evidenceRole === 'comparison' ? '比较依据' : '本次依据' }}</p><ReportEvidenceChart v-if="publication.content.evidence.find(item => item.id === block.evidenceId)" :evidence="publication.content.evidence.find(item => item.id === block.evidenceId)!" /></template><DecisionReferenceCard v-if="block.kind === 'decision' && block.reference" :reference="block.reference" @open="openDeclaration" /><p class="text">{{ block.text }}</p><template v-if="block.kind === 'reason'"><p>{{ block.state === 'confirmed' ? '交易员已核实' : '待核实的可能原因' }}</p><p class="text">支持证据：{{ block.supports || '未记录' }}</p><p class="text">反对证据：{{ block.refutes || '未记录' }}</p></template></article></template>
  </section>
</template>
<style scoped>.published-reader{padding:20px;border:1px solid var(--line);border-radius:8px;margin-top:18px}header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.text{white-space:pre-wrap;overflow-wrap:anywhere}p{line-height:1.8;font-size:var(--font-sm)}.notice{color:var(--muted)}h2{font-size:var(--font-xl)}h3{font-size:var(--font-lg)}article{padding-top:12px;border-top:1px solid var(--line)}</style>
