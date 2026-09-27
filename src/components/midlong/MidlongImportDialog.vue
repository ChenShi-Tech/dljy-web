<script setup lang="ts">
// 中长期售电合同标准导入（dljy#2939，MI-01..05）：选择文件 → 声明映射 → 预览（逐单元格错误、跳过/冲突/新增）
// → 提交 → 批次结果。上传成功只登记为「待核对」，不自动确认义务；冲突合同不在导入里覆盖。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MidlongNotice from './MidlongNotice.vue'
import MetricTile from '@/components/common/MetricTile.vue'
import {
  ENERGY_UNIT_FACTORS, EVIDENCE_DOCUMENT_TYPE_LABELS, PRICE_UNIT_FACTORS,
  type MidlongImportBatch, type MidlongImportIssue, type MidlongImportMapping, type MidlongImportPreview, type MidlongImportRowReport,
} from '@/services/midlong/midlongTypes'
import { commitImport, createImportPreview, fetchImportTemplate, midlongFailureOf, type ImportFileInput } from '@/services/midlong/midlongApi'
import { downloadBase64, downloadCsv, fileToBase64, fmtPrice, fmtQuantity, oversizeUploadMessage } from '@/services/midlong/midlongFormat'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; committed: [MidlongImportBatch] }>()

const step = ref<'select' | 'preview' | 'done'>('select')
const format = ref<'xlsx' | 'csv'>('xlsx')
const files = reactive<{ workbook: File | null; contracts: File | null; allocations: File | null }>({ workbook: null, contracts: null, allocations: null })
const mapping = reactive<{ sourceNamespace: string; quantityUnit: string; priceUnit: string; acceptPrecisionRounding: boolean; sourceDocumentType: NonNullable<MidlongImportMapping['sourceDocumentType']> }>({
  sourceNamespace: '', quantityUnit: '', priceUnit: '', acceptPrecisionRounding: false, sourceDocumentType: 'IMPORT_SOURCE_FILE',
})
const busy = ref(false)
const preview = ref<MidlongImportPreview | null>(null)
const batch = ref<MidlongImportBatch | null>(null)
const problem = ref<{ tone: 'warn' | 'danger'; title: string; message: string } | null>(null)
const opFilter = ref<'ALL' | MidlongImportRowReport['op']>('ALL')

watch(() => props.modelValue, (open) => {
  if (!open) return
  step.value = 'select'
  preview.value = null
  batch.value = null
  problem.value = null
  files.workbook = null
  files.contracts = null
  files.allocations = null
})

function onFile(role: 'workbook' | 'contracts' | 'allocations', event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  const oversize = file ? oversizeUploadMessage(file) : null
  if (oversize) {
    problem.value = { tone: 'danger', title: '文件过大', message: oversize }
    files[role] = null
    input.value = ''
    return
  }
  files[role] = file
}

const ready = computed(() => (format.value === 'xlsx' ? Boolean(files.workbook) : Boolean(files.contracts)))
const OP_LABEL: Record<MidlongImportRowReport['op'], { label: string; type: 'success' | 'info' | 'warning' | 'danger' }> = {
  CREATE: { label: '新增', type: 'success' },
  SKIP: { label: '同内容跳过', type: 'info' },
  CONFLICT: { label: '内容冲突', type: 'warning' },
  ERROR: { label: '有错误', type: 'danger' },
}
const rows = computed(() => (preview.value?.rows ?? []).filter((r) => opFilter.value === 'ALL' || r.op === opFilter.value))

function issueLocation(issue: MidlongImportIssue) {
  return [issue.sheet, issue.rowNumber ? `第 ${issue.rowNumber} 行` : '', issue.column ? `「${issue.column}」` : ''].filter(Boolean).join(' ')
}

async function downloadTemplate(kind: 'xlsx' | 'csv') {
  try {
    const template = await fetchImportTemplate(kind)
    for (const f of template.files) {
      if (f.contentBase64) downloadBase64(f.fileName, f.contentBase64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      else if (f.content !== undefined) downloadCsv(f.fileName, f.content)
    }
  } catch (error) {
    ElMessage.error(midlongFailureOf(error).message)
  }
}

async function runPreview() {
  if (!ready.value || busy.value) return
  busy.value = true
  problem.value = null
  try {
    const payload: ImportFileInput[] = []
    if (format.value === 'xlsx' && files.workbook) payload.push({ role: 'workbook', fileName: files.workbook.name, contentBase64: await fileToBase64(files.workbook) })
    if (format.value === 'csv' && files.contracts) payload.push({ role: 'contracts', fileName: files.contracts.name, contentBase64: await fileToBase64(files.contracts) })
    if (format.value === 'csv' && files.allocations) payload.push({ role: 'allocations', fileName: files.allocations.name, contentBase64: await fileToBase64(files.allocations) })
    preview.value = await createImportPreview(payload, {
      sourceNamespace: mapping.sourceNamespace.trim() || null,
      quantityUnit: mapping.quantityUnit || null,
      priceUnit: mapping.priceUnit || null,
      acceptPrecisionRounding: mapping.acceptPrecisionRounding,
      sourceDocumentType: mapping.sourceDocumentType,
    })
    opFilter.value = 'ALL'
    step.value = 'preview'
  } catch (error) {
    const failure = midlongFailureOf(error)
    problem.value = { tone: 'danger', title: '文件未能预览', message: failure.message }
  } finally {
    busy.value = false
  }
}

async function runCommit() {
  if (!preview.value?.summary.canCommit || busy.value) return
  busy.value = true
  problem.value = null
  try {
    batch.value = await commitImport(preview.value.previewId)
    step.value = 'done'
    emit('committed', batch.value)
  } catch (error) {
    const failure = midlongFailureOf(error)
    const report = (failure.details as { report?: MidlongImportPreview } | null)?.report
    if (report) preview.value = { ...report, previewId: preview.value.previewId }
    if (failure.errorCode === 'PREVIEW_STALE') {
      problem.value = { tone: 'warn', title: '预览已失效，整批未入库', message: `${failure.message}。下方已刷新为最新核对结果，请重新预览后再提交。` }
      if (preview.value) preview.value = { ...preview.value, summary: { ...preview.value.summary, canCommit: false } }
    } else {
      problem.value = { tone: 'danger', title: '整批未入库', message: failure.message }
    }
  } finally {
    busy.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="导入中长期售电合同" width="1080px" top="4vh" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="ml-import">
      <el-steps :active="step === 'select' ? 0 : step === 'preview' ? 1 : 2" finish-status="success" simple>
        <el-step title="选择文件与映射" />
        <el-step title="预览与核对" />
        <el-step title="批次结果" />
      </el-steps>

      <MidlongNotice v-if="problem" :tone="problem.tone" :title="problem.title">{{ problem.message }}</MidlongNotice>

      <template v-if="step === 'select'">
        <MidlongNotice tone="info">
          使用标准模板：Excel 含「合同主表」「月度分解」两张表；CSV 为合同主表文件 + 可选的月度分解文件（UTF-8 编码）。
          电量单位必须明确（单位列、表头括号如「合同电量（MWh）」或下方映射），无法确定时不会默认。模板中以 # 开头的示例行不会导入。
        </MidlongNotice>
        <div class="ml-row">
          <el-radio-group v-model="format">
            <el-radio-button value="xlsx">Excel 工作簿</el-radio-button>
            <el-radio-button value="csv">规范 CSV</el-radio-button>
          </el-radio-group>
          <el-button link type="primary" @click="downloadTemplate('xlsx')">下载 Excel 模板</el-button>
          <el-button link type="primary" @click="downloadTemplate('csv')">下载 CSV 模板</el-button>
        </div>
        <div class="ml-files">
          <label v-if="format === 'xlsx'" class="ml-file">工作簿（.xlsx）<input type="file" accept=".xlsx" data-testid="ml-import-workbook" @change="onFile('workbook', $event)" /></label>
          <template v-else>
            <label class="ml-file">合同主表（.csv）<input type="file" accept=".csv" data-testid="ml-import-contracts" @change="onFile('contracts', $event)" /></label>
            <label class="ml-file">月度分解（.csv，可选）<input type="file" accept=".csv" data-testid="ml-import-allocations" @change="onFile('allocations', $event)" /></label>
          </template>
        </div>
        <div class="ml-grid">
          <label class="ml-field"><span>来源（文件未带「来源」列时必填）</span><el-input v-model="mapping.sourceNamespace" placeholder="如 交易中心、营销系统" /></label>
          <label class="ml-field"><span>电量单位（文件未声明时）</span>
            <el-select v-model="mapping.quantityUnit" clearable placeholder="不声明"><el-option v-for="u in Object.keys(ENERGY_UNIT_FACTORS)" :key="u" :label="u" :value="u" /></el-select>
          </label>
          <label class="ml-field"><span>价格单位（文件未声明时）</span>
            <el-select v-model="mapping.priceUnit" clearable placeholder="不声明"><el-option v-for="u in Object.keys(PRICE_UNIT_FACTORS)" :key="u" :label="u" :value="u" /></el-select>
          </label>
          <label class="ml-field"><span>文件性质</span>
            <el-select v-model="mapping.sourceDocumentType">
              <el-option v-for="t in (['IMPORT_SOURCE_FILE', 'TRADING_CENTER_EXPORT', 'ELECTRONIC_CONFIRMATION'] as const)" :key="t" :label="EVIDENCE_DOCUMENT_TYPE_LABELS[t]" :value="t" />
            </el-select>
          </label>
        </div>
        <el-checkbox v-model="mapping.acceptPrecisionRounding">超过 6 位小数的数值，确认按 6 位四舍五入保存（原值另存留痕）</el-checkbox>
      </template>

      <template v-if="step === 'preview' && preview">
        <div class="tile-grid">
          <MetricTile label="合同行" :value="String(preview.summary.contractRows)" />
          <MetricTile tone="good" label="新增" :value="String(preview.summary.createCount)" />
          <MetricTile label="同内容跳过" :value="String(preview.summary.skipCount)" />
          <MetricTile tone="warn" label="内容冲突" :value="String(preview.summary.conflictCount)" />
          <MetricTile tone="bad" label="错误行" :value="String(preview.summary.errorRowCount)" />
          <MetricTile label="文件级问题" :value="String(preview.summary.fileErrorCount)" />
          <MetricTile tone="warn" label="提示" :value="String(preview.summary.warningCount)" />
        </div>
        <MidlongNotice v-if="preview.summary.conflictCount" tone="warn" title="存在同编号不同内容的合同">
          冲突合同不会被导入覆盖，也不会另建第二份有效合同。请打开原合同核对差异，确需修改时走「录入更正」；核对无误后可从文件中去掉这些行再导入。
        </MidlongNotice>
        <MidlongNotice v-if="preview.fileErrors.length" tone="danger" title="文件级问题">
          <div v-for="(e, i) in preview.fileErrors" :key="i">{{ issueLocation(e) }}：{{ e.message }}</div>
        </MidlongNotice>
        <MidlongNotice v-if="preview.fileWarnings.length" tone="warn" title="整份文件的提示（不阻止提交，提交前请确认）">
          <div v-for="(e, i) in preview.fileWarnings" :key="i">{{ issueLocation(e) }}：{{ e.message }}</div>
        </MidlongNotice>
        <div v-if="preview.columns" class="ml-columns">
          列映射：<span v-for="c in preview.columns.contracts" :key="c.name" class="ml-col">{{ c.header }}<template v-if="c.via === 'alias'">→{{ c.name }}</template><template v-if="c.unitFromHeader">（{{ c.unitFromHeader }}）</template></span>
        </div>
        <div class="ml-row">
          <el-radio-group v-model="opFilter" size="small">
            <el-radio-button value="ALL">全部</el-radio-button>
            <el-radio-button value="CREATE">新增</el-radio-button>
            <el-radio-button value="SKIP">跳过</el-radio-button>
            <el-radio-button value="CONFLICT">冲突</el-radio-button>
            <el-radio-button value="ERROR">错误</el-radio-button>
          </el-radio-group>
          <span class="ml-muted">预览有效期至 {{ new Date(preview.expiresAt).toLocaleString('zh-CN') }}</span>
        </div>
        <el-table :data="rows" border size="small" max-height="420" row-key="rowId">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="ml-expand">
                <div v-for="(e, i) in row.errors" :key="`e${i}`" class="bad">✕ {{ issueLocation(e) }}：{{ e.message }}</div>
                <div v-for="(w, i) in row.warnings" :key="`w${i}`" class="warn">! {{ issueLocation(w) }}：{{ w.message }}</div>
                <div v-for="(d, i) in row.diffs" :key="`d${i}`">差异「{{ d.field }}」：已登记 {{ JSON.stringify(d.existing) }} → 文件 {{ JSON.stringify(d.incoming) }}</div>
                <div v-if="row.candidateDuplicates.length">
                  疑似同一义务（不同来源，需人工核对后关联）：
                  <router-link v-for="c in row.candidateDuplicates" :key="c.contractId" :to="`/zcqjy/contracts/${c.contractId}`" class="ml-link" target="_blank">{{ c.externalContractNo }}（{{ c.sourceNamespace }}）</router-link>
                </div>
                <div v-if="row.previouslyVoided?.length">
                  该编号曾登记后作废（本行仍会新增，请确认不是重复录入）：
                  <router-link v-for="v in row.previouslyVoided" :key="v.contractId" :to="`/zcqjy/contracts/${v.contractId}`" class="ml-link" target="_blank">合同 #{{ v.contractId }}</router-link>
                </div>
                <div v-if="!row.errors.length && !row.warnings.length && !row.diffs.length && !row.candidateDuplicates.length" class="ml-muted">无问题</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="行号" width="70"><template #default="{ row }">{{ row.location.rowNumber }}</template></el-table-column>
          <el-table-column label="结果" width="110">
            <template #default="{ row }"><el-tag size="small" :type="OP_LABEL[row.op as MidlongImportRowReport['op']].type" effect="plain">{{ OP_LABEL[row.op as MidlongImportRowReport['op']].label }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="externalObligationId" label="外部编号" min-width="140" show-overflow-tooltip />
          <el-table-column prop="contractName" label="合同名称" min-width="180" show-overflow-tooltip />
          <el-table-column label="交割期" width="190"><template #default="{ row }">{{ row.deliveryStart || '—' }} ~ {{ row.deliveryEnd || '—' }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.totalQuantity) }}</template></el-table-column>
          <el-table-column label="售电价(元/MWh)" width="120" align="right"><template #default="{ row }">{{ fmtPrice(row.sellerPrice) }}</template></el-table-column>
          <el-table-column label="月分解" width="110"><template #default="{ row }">{{ { COMPLETE: '完整', PARTIAL: '不完整', NONE: '无' }[row.allocationCompleteness as 'COMPLETE'] }}</template></el-table-column>
          <el-table-column label="已登记合同" width="100">
            <template #default="{ row }"><router-link v-if="row.contractId" :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link" target="_blank">#{{ row.contractId }}</router-link><span v-else>—</span></template>
          </el-table-column>
        </el-table>
      </template>

      <template v-if="step === 'done' && batch">
        <MidlongNotice tone="info" :title="`批次 ${batch.batchId}`">
          新增 {{ batch.createdCount }} 份、同内容跳过 {{ batch.skippedCount }} 份。{{ batch.note }}
        </MidlongNotice>
        <el-table :data="batch.results" border size="small" max-height="360">
          <el-table-column label="行号" width="80"><template #default="{ row }">{{ row.location.rowNumber }}</template></el-table-column>
          <el-table-column label="结果" width="110"><template #default="{ row }">{{ row.op === 'CREATED' ? '已登记（待核对）' : '跳过（已存在）' }}</template></el-table-column>
          <el-table-column prop="externalObligationId" label="外部编号" min-width="160" />
          <el-table-column label="合同" width="120"><template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="ml-link" @click="close">打开 #{{ row.contractId }}</router-link></template></el-table-column>
        </el-table>
      </template>
    </div>
    <template #footer>
      <el-button @click="close">{{ step === 'done' ? '关闭' : '取消' }}</el-button>
      <el-button v-if="step === 'preview'" @click="step = 'select'">返回修改</el-button>
      <el-button v-if="step === 'select'" type="primary" :loading="busy" :disabled="!ready" @click="runPreview">生成预览</el-button>
      <el-button v-if="step === 'preview'" type="primary" :loading="busy" :disabled="!preview?.summary.canCommit" @click="runCommit">提交导入（登记为待核对）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml-import { display: flex; flex-direction: column; gap: 12px; }
.ml-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ml-files { display: flex; gap: 16px; flex-wrap: wrap; }
.ml-file { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px; }
.ml-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; }
.ml-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.ml-field :deep(.el-select) { width: 100%; }
.tile-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.ml-columns { font-size: var(--font-sm); color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; }
.ml-col { padding: 1px 6px; border-radius: 4px; background: var(--surface-hover); color: var(--text-soft); }
.ml-expand { display: flex; flex-direction: column; gap: 4px; padding: 4px 12px; font-size: var(--font-md); }
.ml-expand .bad { color: var(--danger); }
.ml-expand .warn { color: var(--warning); }
.ml-muted { color: var(--muted); font-size: var(--font-sm); }
.ml-link { color: var(--accent); margin-right: 8px; }
@media (max-width: 900px) { .tile-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
