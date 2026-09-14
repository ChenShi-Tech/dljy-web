<template>
  <div class="data-upload-view">
    <el-card shadow="never" class="header-card">
      <div class="header-row">
        <div>
          <p class="page-sub">
            模板下载 → 上传 → 预检 → 确认落库 → 回执；格式由「数据集契约」统一管理，重复内容幂等拦截、误传可按批次撤销。
          </p>
        </div>
        <el-steps :active="stepIndex" finish-status="success" simple class="steps">
          <el-step title="选择数据集" />
          <el-step title="上传文件" />
          <el-step title="预检报告" />
          <el-step title="确认落库" />
          <el-step title="回执" />
        </el-steps>
      </div>
    </el-card>

    <!-- ① 选择数据集 -->
    <el-card v-if="step === 'select'" shadow="never" class="step-card" v-loading="loadingContracts">
      <el-alert type="info" :closable="false" class="hint">
        每个数据集的格式要求（列名/类型/单位/主键）由契约声明；先下载模板再填报，可避免列名/格式不匹配。
      </el-alert>
      <el-table :data="contracts" border stripe>
        <el-table-column prop="title" label="数据集" min-width="180" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'capture-family' ? 'success' : 'info'">
              {{ row.kind === 'review-intervals' ? '版本留存' : row.kind === 'capture-family' ? '直落数据库' : '清单投递' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="地区" width="110">
          <template #default="{ row }">{{ row.regionPolicy === 'fixed' ? row.region : '上传时选择' }}</template>
        </el-table-column>
        <el-table-column label="节奏" width="90">
          <template #default="{ row }">{{ ({ daily: '日更', monthly: '月度', manual: '手动' } as Record<string, string>)[row.cadence] ?? row.cadence }}</template>
        </el-table-column>
        <el-table-column label="主键列" min-width="150">
          <template #default="{ row }">{{ row.key.join(' + ') }}</template>
        </el-table-column>
        <el-table-column label="最近导入" min-width="160">
          <template #default="{ row }">
            <span v-if="row.lastBatch">{{ row.lastBatch.createdAt.slice(0, 16).replace('T', ' ') }} · {{ row.lastBatch.rowsValid }} 行</span>
            <span v-else class="muted">从未导入</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="downloadTemplate(row)">下载模板</el-button>
            <el-button size="small" type="primary" @click="selectContract(row)">上传</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ② 上传 -->
    <el-card v-if="step === 'upload'" shadow="never" class="step-card">
      <template #header>
        <div class="card-header">
          <span>{{ activeContract?.title }} · 格式要求</span>
          <el-button size="small" @click="backToSelect">返回重选</el-button>
        </div>
      </template>
      <el-descriptions :column="3" border size="small" class="format-desc">
        <el-descriptions-item label="粒度">{{ activeContract?.granularity }}</el-descriptions-item>
        <el-descriptions-item label="重叠策略">{{ activeContract?.overlap === 'replace-batch' ? '覆盖写（本批次生效）' : '追加去重' }}</el-descriptions-item>
        <el-descriptions-item label="说明">{{ activeContract?.notes || '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="activeContract?.columns ?? []" border size="small" class="col-table">
        <el-table-column prop="name" label="列名（表头）" min-width="140" />
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column label="单位/格式" width="120">
          <template #default="{ row }">{{ row.unit || row.format || '—' }}</template>
        </el-table-column>
        <el-table-column label="必填" width="60">
          <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="可接受别名" min-width="160">
          <template #default="{ row }">{{ row.aliases.length ? row.aliases.join(' / ') : '—' }}</template>
        </el-table-column>
      </el-table>
      <ReviewImportFields v-if="activeContract?.kind === 'review-intervals'" :model-value="metadata" :disabled="prechecking || committing" @update:model-value="Object.assign(metadata, $event)" />
      <el-form label-width="90px" class="upload-form">
        <el-form-item v-if="activeContract?.regionPolicy === 'choose'" label="数据地区">
          <el-input v-model="regionInput" placeholder="地区 id（如 shanxi / yunnan）" style="max-width: 240px" />
        </el-form-item>
        <el-form-item label="选择文件">
          <input ref="fileInputRef" type="file" accept=".csv,.xlsx" @change="onFileChange" />
          <span v-if="pickedFile" class="picked">{{ pickedFile.name }}（{{ (pickedFile.size / 1024).toFixed(1) }} KB）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :disabled="!pickedFile" :loading="prechecking" @click="runPrecheck">开始预检（不落库）</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- ③ 预检报告 -->
    <el-card v-if="step === 'precheck' && report" shadow="never" class="step-card">
      <template #header><span>预检报告（只读，未落任何数据）</span></template><ul v-if="activeContract?.kind === 'review-intervals' && report.rowErrors?.length"><li v-for="(item,index) in report.rowErrors.slice(0,50)" :key="index">第 {{ item.row }} 行：{{ item.message }}</li></ul><p v-if="activeContract?.kind === 'review-intervals'">{{ report.notice }} 将更新已有时段 {{ report.overlap.count ?? 0 }} 条，确认导入表示同意本次更新，历史版本保留。</p>
      <el-result
        :icon="report.canCommit ? 'success' : 'error'"
        :title="report.canCommit ? '预检通过，可确认落库' : '预检未通过，请修正后重新上传'"
      />
      <el-row :gutter="12" class="report-row">
        <el-col :span="6"><el-statistic title="总行数" :value="report.rows.total" /></el-col>
        <el-col :span="6"><el-statistic title="有效行" :value="report.rows.valid" /></el-col>
        <el-col :span="6"><el-statistic title="无效行" :value="report.rows.invalid" /></el-col>
        <el-col :span="6"><el-statistic title="主键重复" :value="report.keyDupes.count" /></el-col>
      </el-row>
      <el-descriptions :column="2" border size="small" class="report-desc">
        <el-descriptions-item label="表头匹配">
          <span v-for="c in report.header.colMatch" :key="c.name" class="col-chip" :class="chipClass(c)">
            {{ c.name }}{{ c.via === 'alias' ? '（别名）' : c.via === 'name' ? '' : '（缺失）' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="覆盖检测">
          <span v-if="report.overlap.catalog">库内已有 {{ report.overlap.catalog.rowCount }} 行（{{ report.overlap.catalog.ingestedAt.slice(0, 10) }} 入库，{{ report.overlap.catalog.sourceType }}），本次按「{{ report.overlap.strategy === 'replace-batch' ? '覆盖写' : '追加去重' }}」生效</span>
          <span v-else-if="report.overlap.files?.length">
            {{ report.overlap.files.map((f) => f.exists ? `${f.path.split('/').pop()}（已有 ${f.existingRows ?? 0} 行）` : `${f.path.split('/').pop()}（新建）`).join('；') }}
            <template v-if="report.overlap.window">，本次窗口 {{ report.overlap.window.from }} ~ {{ report.overlap.window.to }}</template>
          </span>
          <span v-else>{{ report.overlap.note || '库内暂无该数据集数据，本次为首批导入' }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <el-table v-if="report.rows.errors.length" :data="report.rows.errors.map((e) => ({ error: e }))" border size="small" class="err-table">
        <el-table-column prop="error" label="逐行错误明细（前 50 条）" />
      </el-table>
      <div class="actions">
        <el-button @click="backToUpload">返回修改</el-button>
        <el-button type="primary" :disabled="!report.canCommit" :loading="committing" @click="runCommit">确认落库</el-button>
      </div>
    </el-card>

    <!-- ⑤ 回执 -->
    <el-card v-if="step === 'receipt' && receipt" shadow="never" class="step-card">
      <template #header><span>导入回执</span></template>
      <el-result :icon="receipt.code === 200 ? 'success' : 'error'" :title="receipt.msg || (receipt.code === 200 ? '导入成功' : '导入失败')" />
      <el-descriptions v-if="receipt.batch" :column="2" border size="small">
        <el-descriptions-item label="批次号">{{ receipt.batch.id }}</el-descriptions-item>
        <el-descriptions-item label="落库时间">{{ receipt.batch.created_at.slice(0, 19).replace('T', ' ') }}</el-descriptions-item>
        <el-descriptions-item label="有效行">{{ receipt.batch.rows_valid }}</el-descriptions-item>
        <el-descriptions-item label="跳过行">{{ receipt.batch.rows_invalid }}</el-descriptions-item>
        <el-descriptions-item label="落点" :span="2">{{ receipt.delivered?.paths?.map((p) => `${p.path}（${p.rows} 行）`).join('；') || '—' }}</el-descriptions-item>
        <el-descriptions-item label="生效提示" :span="2">{{ receipt.delivered?.hint || '—' }}</el-descriptions-item>
      </el-descriptions>
      <div class="actions">
        <el-button type="danger" plain :loading="reverting" @click="revertReceipt">撤销本批次</el-button>
        <el-button type="primary" @click="restart">继续上传</el-button>
      </div>
    </el-card>

    <!-- 批次台账（常驻） -->
    <el-card shadow="never" class="step-card batches-card">
      <template #header><span>批次台账（可按批次撤销）</span></template>
      <el-table :data="batches" border size="small" v-loading="loadingBatches">
        <el-table-column prop="id" label="批次号" min-width="180" />
        <el-table-column prop="dataset" label="数据集" min-width="150" />
        <el-table-column prop="region" label="地区" width="90" />
        <el-table-column prop="file_name" label="文件" min-width="150" />
        <el-table-column label="行数（有效/跳过）" width="130">
          <template #default="{ row }">{{ row.rows_valid }} / {{ row.rows_invalid }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'COMMITTED' ? 'success' : 'info'">{{ row.status === 'COMMITTED' ? '已提交' : '已撤销' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ row.created_at.slice(0, 16).replace('T', ' ') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'COMMITTED'" size="small" type="danger" plain @click="revertRow(row)">撤销</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
// 数据运维台·上传工作台（Epic #2169 P1 · #2173）：五步流 UI。
// 纯交互层，校验/落库/幂等/撤销全部服务端权威（server/data/upload-pipeline.mjs），
// 本组件只组织步骤与呈现预检报告/回执。
import ReviewImportFields from '@/components/review/workbench/ReviewImportFields.vue'
import type { ReviewImportMetadata } from '@/services/data/uploadClient'
import { selectedCompanyId } from '@/services/company/companyContext'
import { selectedRegionId } from '@/services/region/regionContext'
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  commitUpload,
  downloadTemplateFile,
  fetchUploadBatches,
  fetchUploadContracts,
  fetchUploadTemplate,
  precheckUpload,
  readLocalFile,
  revertUploadBatch,
  type UploadScope,
  type CommitResult,
  type PrecheckReport,
  type UploadContractSummary,
  type UploadBatchRow,
} from '@/services/data/uploadClient'

type Step = 'select' | 'upload' | 'precheck' | 'receipt'
const metadata = reactive<ReviewImportMetadata>({ view: 'generator', simulated: false, basisLabel: '', actualLabel: '', sourceLabel: '', sourceVersion: '' })
const step = ref<Step>('select')
const stepIndex = computed(() => ({ select: 0, upload: 1, precheck: 2, receipt: 4 }[step.value]))

const contracts = ref<UploadContractSummary[]>([])
const loadingContracts = ref(false)
const activeContract = ref<UploadContractSummary | null>(null)
const regionInput = ref(selectedRegionId.value)
const pickedFile = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const prechecking = ref(false)
const committing = ref(false)
const reverting = ref(false)
const report = ref<PrecheckReport | null>(null)
const receipt = ref<CommitResult | null>(null)
const batches = ref<UploadBatchRow[]>([])
const loadingBatches = ref(false)

let scopeGeneration = 0
const uploadScope = (): UploadScope => ({ companyId: selectedCompanyId.value, region: activeContract.value?.region ?? regionInput.value })
onBeforeUnmount(() => ++scopeGeneration)
watch([selectedCompanyId, selectedRegionId], () => { ++scopeGeneration; regionInput.value = selectedRegionId.value; activeContract.value = null; pickedFile.value = null; pickedPayload = null; report.value = null; receipt.value = null; batches.value = []; contracts.value = []; step.value = 'select'; void loadContracts(); void loadBatches() })
let pickedPayload: { content: string; isBinary: boolean; fileName: string } | null = null

async function loadContracts() {
  loadingContracts.value = true
  const ticket = scopeGeneration, scope = uploadScope()
  try {
    const result = await fetchUploadContracts(scope)
    if (ticket === scopeGeneration) contracts.value = result
  } catch (err) {
    ElMessage.error(`契约清单加载失败：${(err as Error).message}`)
  } finally {
    loadingContracts.value = false
  }
}

async function loadBatches() {
  loadingBatches.value = true
  const ticket = scopeGeneration, scope = uploadScope()
  try {
    const result = await fetchUploadBatches(undefined, scope)
    if (ticket === scopeGeneration) batches.value = result
  } catch {
    // 台账加载失败不阻塞主流程，表格留空并在下次操作后重试。
  } finally {
    loadingBatches.value = false
  }
}

onMounted(() => {
  void loadContracts()
  void loadBatches()
})

function selectContract(row: UploadContractSummary) {
  ++scopeGeneration
  activeContract.value = row
  regionInput.value = row.regionPolicy === 'fixed' ? (row.region ?? 'yunnan') : selectedRegionId.value
  pickedFile.value = null
  pickedPayload = null
  report.value = null
  step.value = 'upload'
}

function backToSelect() {
  ++scopeGeneration; report.value = null; pickedPayload = null
  step.value = 'select'
  activeContract.value = null
  void loadContracts()
}

function backToUpload() {
  ++scopeGeneration; report.value = null
  step.value = 'upload'
}

async function downloadTemplate(row: UploadContractSummary) {
  try {
    const tpl = await fetchUploadTemplate(row.dataset, 'xlsx', { companyId: selectedCompanyId.value, region: row.region ?? regionInput.value })
    downloadTemplateFile(tpl.fileName, tpl.contentBase64, tpl.content)
  } catch (err) {
    ElMessage.error(`模板下载失败：${(err as Error).message}`)
  }
}

async function onFileChange(event: Event) {
  const ticket = ++scopeGeneration
  pickedPayload = null; report.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  pickedFile.value = file
  try {
    const payload = await readLocalFile(file)
    if (ticket !== scopeGeneration) return
    pickedPayload = payload
  } catch (err) {
    if (ticket !== scopeGeneration) return
    ElMessage.error((err as Error).message)
    pickedFile.value = null
    pickedPayload = null
  }
}

async function runPrecheck() {
  if (!activeContract.value || !pickedPayload) return
  prechecking.value = true
  const ticket = scopeGeneration, scope = uploadScope()
  try {
    const result = await precheckUpload({
      dataset: activeContract.value.dataset,
      ...(activeContract.value.kind === 'review-intervals' ? { review: { ...metadata } } : {}),
      fileName: pickedPayload.fileName,
      content: pickedPayload.content,
      isBinary: pickedPayload.isBinary,
      region: activeContract.value.regionPolicy === 'choose' ? regionInput.value : undefined,
    }, scope)
    if (ticket !== scopeGeneration) return
    report.value = result
    step.value = 'precheck'
    void loadBatches()
  } catch (err) {
    ElMessage.error(`预检请求失败：${(err as Error).message}`)
  } finally {
    prechecking.value = false
  }
}

async function runCommit() {
  if (!activeContract.value || !pickedPayload) return
  if (!report.value?.canCommit) return
  committing.value = true
  const ticket = scopeGeneration, scope = uploadScope()
  try {
    const result = await commitUpload({
      ...(activeContract.value.kind === 'review-intervals' ? { expectedToken: report.value?.expectedToken, confirmed: true } : {}),
      dataset: activeContract.value.dataset,
      ...(activeContract.value.kind === 'review-intervals' ? { review: { ...metadata } } : {}),
      fileName: pickedPayload.fileName,
      content: pickedPayload.content,
      isBinary: pickedPayload.isBinary,
      region: activeContract.value.regionPolicy === 'choose' ? regionInput.value : undefined,
    }, scope)
    if (ticket !== scopeGeneration) return
    receipt.value = result
    step.value = 'receipt'
    void loadBatches()
  } catch (err) {
    ElMessage.error(`落库请求失败：${(err as Error).message}`)
  } finally {
    committing.value = false
  }
}

async function revertBatch(batchId: string, note: string) {
  reverting.value = true
  try {
    const res = await revertUploadBatch(batchId, note)
    if (res.code === 200) {
      ElMessage.success(res.msg ?? '已撤销')
    } else {
      ElMessage.error(res.msg ?? '撤销失败')
    }
    await loadBatches()
    if (receipt.value?.batch?.id === batchId && receipt.value.batch) {
      receipt.value.batch.status = 'REVERTED'
    }
  } catch (err) {
    ElMessage.error(`撤销请求失败：${(err as Error).message}`)
  } finally {
    reverting.value = false
  }
}

function revertReceipt() {
  if (!receipt.value?.batch) return
  void ElMessageBox.prompt('撤销将按批次备份恢复落点前状态，确认请填原因', '撤销批次', { inputPlaceholder: '撤销原因' })
    .then(({ value }) => revertBatch(receipt.value!.batch!.id, value || '页面撤销'))
    .catch(() => undefined)
}

function revertRow(row: UploadBatchRow) {
  void ElMessageBox.confirm(`确认撤销批次 ${row.id}？落点将按备份恢复到导入前状态。`, '撤销批次', { type: 'warning' })
    .then(() => revertBatch(row.id, '台账撤销'))
    .catch(() => undefined)
}

function restart() {
  receipt.value = null
  report.value = null
  pickedFile.value = null
  pickedPayload = null
  if (fileInputRef.value) fileInputRef.value.value = ''
  backToSelect()
}

function chipClass(col: { via: string | null }): string {
  if (col.via === 'name') return 'ok'
  if (col.via === 'alias') return 'warn'
  return 'bad'
}
</script>

<style scoped>
.data-upload-view { display: flex; flex-direction: column; gap: 12px; }
.header-card :deep(.el-card__body) { padding: 14px 18px; }
.header-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.page-sub { margin: 0; color: var(--el-text-color-secondary); font-size: var(--font-sm); }
.steps { max-width: 560px; }
.hint { margin-bottom: 10px; }
.format-desc { margin-bottom: 10px; }
.col-table { margin-bottom: 12px; }
.upload-form { max-width: 560px; }
.picked { margin-left: 10px; color: var(--el-text-color-secondary); }
.report-row { margin-bottom: 12px; }
.report-desc { margin-bottom: 10px; }
.col-chip { display: inline-block; margin: 0 6px 4px 0; padding: 1px 8px; border-radius: 10px; font-size: var(--font-sm); }
.col-chip.ok { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.col-chip.warn { background: var(--el-color-warning-light-9); color: var(--el-color-warning); }
.col-chip.bad { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.err-table { margin-bottom: 10px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.batches-card { margin-top: 4px; }
.muted { color: var(--el-text-color-secondary); }
</style>
