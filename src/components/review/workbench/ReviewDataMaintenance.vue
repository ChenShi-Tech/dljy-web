<script setup lang="ts">
import ReviewImportFields from './ReviewImportFields.vue'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { fetchUploadTemplate, downloadTemplateFile, type ReviewImportMetadata } from '@/services/data/uploadClient'
import { fetchUploadContracts, fetchUploadBatches, readLocalFile, precheckUpload, commitUpload, type UploadContractSummary, type UploadBatchRow, type PrecheckReport, type UploadScope } from '@/services/data/uploadClient'

const props = defineProps<{ companyId: string; companyLabel: string; region: string; preferredDataset?: string; view?: ReviewImportMetadata['view'] }>()
const emit = defineEmits<{ busy: [value: boolean]; saved: [] }>()
const contracts = ref<UploadContractSummary[]>([]), dataset = ref(''), batches = ref<UploadBatchRow[]>([])
const selected = computed(() => contracts.value.find(item => item.dataset === dataset.value))
const isInterval = computed(() => selected.value?.kind === 'review-intervals')
const metadata = reactive<ReviewImportMetadata>({ view: props.view ?? 'generator', simulated: false, basisLabel: '', actualLabel: '', sourceLabel: '', sourceVersion: '' })
const file = ref<File | null>(null), report = ref<PrecheckReport | null>(null), accepted = ref(false)
const loading = ref(false), checking = ref(false), committing = ref(false), message = ref(''), error = ref('')
let generation = 0
let catalogGeneration = 0
onBeforeUnmount(() => { ++generation; ++catalogGeneration; emit('busy', false) })
let checked: { payload: Awaited<ReturnType<typeof readLocalFile>> & { dataset: string; region: string; review?: ReviewImportMetadata; expectedToken?: string | null; confirmed?: boolean }; scope: UploadScope } | null = null
const scope = (): UploadScope => ({ companyId: props.companyId, region: props.region })
function invalidate() { report.value = null; checked = null; accepted.value = false; message.value = ''; error.value = '' }
watch(metadata, () => { ++generation; invalidate() }, { deep: true, flush: 'sync' })
watch(() => props.view, value => { metadata.view = value ?? 'generator' })
async function downloadFormat() {
  const ticket = generation
  try { const template = await fetchUploadTemplate(dataset.value, 'xlsx', scope()); if (ticket === generation) downloadTemplateFile('复盘分时资料.xlsx', template.contentBase64, template.content) }
  catch { if (ticket === generation) error.value = '填报格式暂时无法下载，请稍后重试。' }
}
watch(() => [props.companyId, props.region], async () => {
  ++generation
  const ticket = ++catalogGeneration, requestScope = scope()
  contracts.value = []; dataset.value = ''; batches.value = []; file.value = null; invalidate(); loading.value = true
  try {
    const result = await fetchUploadContracts(requestScope)
    if (ticket !== catalogGeneration) return
    contracts.value = result.filter(item => item.review && (!item.region || item.region === requestScope.region))
    dataset.value = contracts.value.find(item => item.dataset === props.preferredDataset)?.dataset ?? contracts.value[0]?.dataset ?? ''
  } catch { if (ticket === catalogGeneration) error.value = '资料目录暂时无法读取，请稍后重试。' }
  finally { if (ticket === catalogGeneration) loading.value = false }
}, { immediate: true })
watch(dataset, async () => {
  const ticket = ++generation, target = dataset.value, requestScope = scope()
  invalidate(); file.value = null; batches.value = []
  if (!target) return
  try { const rows = await fetchUploadBatches(target, requestScope); if (ticket === generation) batches.value = rows }
  catch { if (ticket === generation) error.value = '历史导入记录暂时无法读取。' }
})
function chooseFile(event: Event) { ++generation; file.value = (event.target as HTMLInputElement).files?.[0] ?? null; invalidate() }
async function checkFile() {
  if (!file.value || !selected.value || checking.value || committing.value) return
  const ticket = generation, source = file.value, requestScope = scope(), target = dataset.value
  invalidate(); checking.value = true
  try {
    const review = isInterval.value ? { ...metadata } : undefined
    const payload = { ...await readLocalFile(source), dataset: target, region: requestScope.region, ...(review ? { review } : {}) }
    if (ticket !== generation) return
    const result = await precheckUpload(payload, requestScope)
    if (ticket !== generation) return
    if (!result.ok || !result.rows) { error.value = '文件格式未通过校验，请核对资料类型，并使用该业务系统的原始导出文件。'; return }
    report.value = result
    if (result.canCommit) checked = { payload: { ...payload, ...(review ? { expectedToken: result.expectedToken } : {}) }, scope: requestScope }
  } catch { if (ticket === generation) error.value = '预检未完成，请核对文件、公司和资料类型后重试。' }
  finally { checking.value = false }
}
async function saveFile() {
  if (!checked || !accepted.value || !selected.value?.review?.canWrite || committing.value) return
  const input = checked, ticket = generation
  committing.value = true; emit('busy', true); error.value = ''
  try {
    const result = await commitUpload({ ...input.payload, ...(input.payload.review ? { confirmed: accepted.value } : {}) }, input.scope)
    if (ticket !== generation) return
    if (result.code !== 200) { error.value = '导入未完成，服务器重新校验后未确认成功，请重新预检。'; checked = null; accepted.value = false; return }
    invalidate(); file.value = null
    message.value = result.idempotentReplay ? '这份内容已导入，无需重复保存。' : '资料已导入，并登记在统一批次记录中。返回专题后请重新统计。'
    emit('saved')
    const rows = await fetchUploadBatches(input.payload.dataset, input.scope)
    if (ticket === generation) batches.value = rows
  } catch { if (ticket === generation) error.value = '尚未确认导入结果，请先查看批次记录；重新提交相同内容会按统一流程检查重复。' }
  finally { committing.value = false; emit('busy', false) }
}
</script>
<template>
  <section class="review-maintenance" aria-label="维护复盘资料">
    <p><b>{{ companyLabel }}</b> · 资料由交易员维护，与统一数据维护共用校验和导入记录。</p>
    <p class="muted">此处接收已有业务系统导出资料。导入成功代表资料已保存；是否可用于某项统计，仍取决于资料口径和覆盖范围。</p>
    <p v-if="loading" role="status">正在读取资料目录…</p>
    <p v-else-if="!contracts.length">当前公司尚未配置可在此维护的资料通道，请通过统一数据维护完善接入。</p>
    <template v-else>
      <label>资料类型 <select v-model="dataset" :disabled="checking || committing"><option v-for="item in contracts" :key="item.dataset" :value="item.dataset">{{ item.review?.purpose }}</option></select></label>
      <template v-if="isInterval"><ReviewImportFields :model-value="metadata" :disabled="checking || committing" fixed-view @update:model-value="Object.assign(metadata, $event)" /><button :disabled="checking || committing" @click="downloadFormat">下载中文填报格式</button></template>
      <p v-if="!selected?.review?.canWrite" class="muted">你可以查看并预检当前公司的资料，但没有提交权限。</p>
      <div class="file-row"><input :key="dataset + companyId" aria-label="选择原始资料文件" type="file" accept=".csv,.xlsx" :disabled="checking || committing" @change="chooseFile" /><button :disabled="!file || checking || committing" @click="checkFile">{{ checking ? '正在校验…' : '预检文件' }}</button></div>
      <section v-if="report" class="preview" aria-label="导入预检">
        <p>共 {{ report.rows.total }} 行 · 有效 {{ report.rows.valid }} 行 · 待修正 {{ report.rows.invalid }} 行 · 文件内重复 {{ report.keyDupes?.count ?? 0 }} 项</p>
        <p v-if="report.rows.invalid || report.header.missingRequired.length">存在不符合格式的内容，请核对原始导出文件，补齐所选资料类型要求的数据后重新预检。</p>
        <template v-if="isInterval"><p>{{ report.notice }}</p><p>将更新已有时段 {{ report.overlap.count ?? 0 }} 条；原版本保留。</p><ul v-if="report.rowErrors?.length"><li v-for="(item,index) in report.rowErrors.slice(0,50)" :key="index">第 {{ item.row }} 行：{{ item.message }}</li></ul><p v-if="(report.rowErrors?.length ?? 0) > 50">仅展示前 50 项，请修正后重新预检。</p></template>
        <p v-if="report.overlap.window">涉及日期：{{ report.overlap.window.from }}—{{ report.overlap.window.to }}</p>
        <p>相同日期重新导入，按本资料通道的更新规则处理；其他来源资料和历史报告版本保留。</p>
        <label v-if="report.canCommit && selected?.review?.canWrite"><input v-model="accepted" type="checkbox" :disabled="committing" />我已核对公司、文件与预检结果，同意更新本次涉及的资料。</label>
        <button :disabled="!report.canCommit || !accepted || !selected?.review?.canWrite || committing" @click="saveFile">{{ committing ? '正在导入…' : '确认导入' }}</button>
      </section>
      <details><summary>最近导入记录（最多 50 条）</summary><table v-if="batches.length"><thead><tr><th>导入时间</th><th>文件</th><th>有效行数</th><th>状态</th></tr></thead><tbody><tr v-for="batch in batches" :key="batch.id"><td>{{ batch.created_at.slice(0, 16).replace('T', ' ') }}</td><td>{{ batch.file_name }}</td><td>{{ batch.rows_valid }}</td><td>{{ batch.status === 'REVERTED' ? '已撤销' : '已导入' }}</td></tr></tbody></table><p v-else>当前资料类型暂无可见导入记录。</p></details>
    </template>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.review-maintenance{display:grid;gap:14px;padding:8px}p{margin:0;line-height:1.7}.muted{color:var(--muted)}label,.file-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}select,button{padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:var(--card)}.preview{display:grid;gap:12px;padding:16px;border:1px solid var(--line);border-radius:8px}.preview button{justify-self:start}table{width:100%;border-collapse:collapse;font-size:var(--font-sm)}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}summary{cursor:pointer;padding:8px 0}[role=alert]{color:var(--danger)}button:disabled{opacity:.5;cursor:not-allowed}
</style>
