<script setup lang="ts">
// 报表中心：模板库 → 参数化 → 生成（reportEngine）→ 区块渲染 → 导出。
// 数据：区块基于合成场景（明确标注 mock），口径公式来自 settlementFormula（真实可验证）。
// 后端生成队列/导出归档从 /api/v1/reports 取，未就绪时优雅降级为占位。
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { regionProfiles } from '@/data/regions'
import { selectedRegionId, currentRegion } from '@/services/region/regionContext'
import { getRegionSettlementRule, getMaturityLabel } from '@/services/region/regionSettlementRules'
import { reportTemplates } from '@/features/reports/templates'
import { registerReportBlocks } from '@/features/reports/reportBlocks'
import {
  listSubscriptions, createSubscription, toggleSubscription, removeSubscription,
  FREQUENCY_LABELS, CHANNEL_LABELS,
  type ReportSubscription, type SubscriptionFrequency, type SubscriptionChannel
} from '@/features/reports/subscriptions'
import { runTemplate, fetchReportsClosedLoop, type ReportInstance, type ReportParams } from '@/services/reportEngine'
import type { ReportTemplate, ReportsClosedLoop, ReportGenerationJob, ReportExportArtifact } from '@/services/reports/types'
import { apiPost } from '@/services/api'
import { exportCsv } from '@/utils/exportCsv'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import ReportBlockRenderer from '@/components/reports/ReportBlockRenderer.vue'

const SUBJECT_LABELS: Record<string, string> = {
  GENERATOR: '发电企业', RETAILER: '售电公司', LOAD: '电力大用户', STORAGE: '独立储能', GROUP: '集团', TRADER: '交易组合'
}

const activeTab = ref('generate')
const templates = reportTemplates
const selectedId = ref(templates[0].templateId)
const selectedTemplate = computed<ReportTemplate>(() => templates.find((t) => t.templateId === selectedId.value) ?? templates[0])

const regionId = ref(selectedRegionId.value)
const tradeDate = ref('2026-06-04')
const month = ref('2026-05')
const subjectType = ref('GENERATOR')
const market = ref<string[]>([])

const timeMode = computed(() => selectedTemplate.value.paramSchema?.time?.mode ?? 'date')
const subjectOptions = computed(() => selectedTemplate.value.paramSchema?.subjectTypes ?? ['GENERATOR', 'RETAILER', 'LOAD'])
const marketOptions = computed(() => selectedTemplate.value.paramSchema?.market ?? [])
const settlementRule = computed(() => getRegionSettlementRule(regionId.value))

// 模板库搜索/筛选
const tplKeyword = ref('')
const tplDomain = ref('')
const domainOptions = computed(() => Array.from(new Set(templates.map((t) => (t.domain ?? '').split(/[-/]/)[0]).filter(Boolean))))
const filteredTemplates = computed(() => templates.filter((t) => {
  const kw = tplKeyword.value.trim()
  const matchKw = !kw || t.templateName.includes(kw) || (t.domain ?? '').includes(kw)
  const matchDomain = !tplDomain.value || (t.domain ?? '').includes(tplDomain.value)
  return matchKw && matchDomain
}))

// 报表头部汇总
const regionLabel = computed(() => regionProfiles.find((r) => r.id === regionId.value)?.shortName ?? regionId.value)
function formatTime(iso: string): string { return iso.replace('T', ' ').slice(0, 19) }
function printReport() { window.print() }

const instance = ref<ReportInstance | null>(null)
const generating = ref(false)

watch(selectedId, () => {
  if (!subjectOptions.value.includes(subjectType.value)) subjectType.value = subjectOptions.value[0]
  instance.value = null
})

async function generate() {
  registerReportBlocks()
  generating.value = true
  try {
    const params: ReportParams = {
      regionId: regionId.value,
      subjectType: subjectType.value,
      market: market.value.join(','),
      ...(timeMode.value === 'month' ? { month: month.value } : { tradeDate: tradeDate.value })
    }
    instance.value = await runTemplate(selectedTemplate.value, params)
    ElMessage.success('报表已生成（模拟数据）')
    // 写回生成队列：后端登记异步任务 + 审计 traceId（闭环展示为本会话本地态 + 后端种子合并）
    void postGenerationJob(params)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '生成失败')
  } finally {
    generating.value = false
  }
}

type ExportSheet = { name: string; rows: (string | number)[][] }

function normalizeCell(v: unknown): string | number {
  return typeof v === 'number' ? v : String(v ?? '')
}

// 把当前报表实例的表格/指标类区块整理为多 sheet 数据，CSV 与 Excel 共用。
function buildExportSheets(): ExportSheet[] {
  if (!instance.value) return []
  const sheets: ExportSheet[] = []
  for (const b of instance.value.blocks) {
    const d = b.data as { columns?: { key: string; label: string }[]; rows?: Record<string, unknown>[]; kpis?: { label: string; value: unknown; unit?: string }[] } | null
    if ((b.blockType === 'TABLE' || b.blockType === 'SETTLEMENT') && d?.columns) {
      const rows: (string | number)[][] = [d.columns.map((c) => c.label)]
      for (const r of d.rows ?? []) rows.push(d.columns.map((c) => normalizeCell(r[c.key])))
      sheets.push({ name: b.title, rows })
    }
    if ((b.blockType === 'METRIC' || b.blockType === 'SETTLEMENT') && d?.kpis) {
      const rows: (string | number)[][] = [['指标', '数值', '单位']]
      for (const k of d.kpis) rows.push([k.label, normalizeCell(k.value), k.unit ?? ''])
      sheets.push({ name: `${b.title} 指标`, rows })
    }
  }
  return sheets
}

const exportFileBase = () => `${selectedTemplate.value.templateName}_${timeMode.value === 'month' ? month.value : tradeDate.value}`

function exportInstanceCsv() {
  const sheets = buildExportSheets()
  if (!sheets.length) { ElMessage.info('当前报表无可导出的表格/指标'); return }
  const lines: (string | number)[][] = []
  for (const s of sheets) { lines.push([s.name]); lines.push(...s.rows); lines.push([]) }
  const maxCols = Math.max(...lines.map((l) => l.length), 1)
  const headers = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`)
  const rows = lines.map((l) => { const row = [...l]; while (row.length < maxCols) row.push(''); return row })
  exportCsv(exportFileBase(), headers, rows)
  ElMessage.success('已导出 CSV')
  void postExportArtifact('CSV')
}

// Excel：每个区块一个 sheet。动态 import 懒加载 xlsx（仅点击时加载，不进主 bundle）。
async function exportInstanceExcel() {
  const sheets = buildExportSheets()
  if (!sheets.length) { ElMessage.info('当前报表无可导出的表格/指标'); return }
  try {
    const { exportWorkbook } = await import('@/utils/exportExcel')
    exportWorkbook(exportFileBase(), sheets)
    ElMessage.success('已导出 Excel')
    void postExportArtifact('Excel')
  } catch (e) {
    ElMessage.error('Excel 导出失败：' + (e instanceof Error ? e.message : '未知错误'))
  }
}

const closedLoop = ref<ReportsClosedLoop | null>(null)
const backendError = ref('')
async function loadClosedLoop() {
  try {
    closedLoop.value = await fetchReportsClosedLoop()
  } catch {
    backendError.value = '后端报表服务未就绪，以下为占位；本地生成不受影响。'
    closedLoop.value = null
  }
}

// 报表订阅（演示：定时推送为 Mock）
const subscriptions = ref<ReportSubscription[]>([])
const subDialogVisible = ref(false)
const subForm = ref<{ templateId: string; frequency: SubscriptionFrequency; channel: SubscriptionChannel; recipients: string }>({
  templateId: templates[0].templateId, frequency: 'daily', channel: 'email', recipients: ''
})
function loadSubs() { subscriptions.value = listSubscriptions() }
function openSubDialog() {
  subForm.value = { templateId: selectedId.value, frequency: 'daily', channel: 'email', recipients: '' }
  subDialogVisible.value = true
}
function submitSub() {
  const tpl = templates.find((t) => t.templateId === subForm.value.templateId) ?? templates[0]
  createSubscription({
    templateId: tpl.templateId, templateName: tpl.templateName,
    frequency: subForm.value.frequency, regionId: regionId.value, subjectType: subjectType.value,
    recipients: subForm.value.recipients, channel: subForm.value.channel
  })
  subDialogVisible.value = false
  loadSubs()
  ElMessage.success('订阅已创建（演示：定时推送为模拟，不会实际发送）')
}
function onToggleSub(id: string) { toggleSubscription(id); loadSubs() }
function onRemoveSub(id: string) { removeSubscription(id); loadSubs() }

// 生成队列 / 导出归档：生成与导出动作写回后端异步任务（含审计 traceId）
// 闭环 tab 展示 = 本会话本地态（可流转）+ 后端种子；状态流转为前端演示态（后端 transition 端点待后续）。
const localJobs = ref<ReportGenerationJob[]>([])
const localArtifacts = ref<ReportExportArtifact[]>([])
const currentJobId = ref<string | null>(null)

const JOB_STATUS_TAG: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  生成中: 'primary', 待审核: 'warning', 已发布: 'success', 驳回: 'danger', 已归档: 'info'
}
function statusTagType(s: string) { return JOB_STATUS_TAG[s] || ('info' as const) }
function isLocalJob(jobId: string) { return localJobs.value.some((j) => j.jobId === jobId) }
function transitionJob(jobId: string, next: string) {
  localJobs.value = localJobs.value.map((j) => (j.jobId === jobId ? { ...j, status: next } : j))
  ElMessage.success(`已流转至「${next}」（演示态）`)
}
const displayJobs = computed<ReportGenerationJob[]>(() => [...localJobs.value, ...(closedLoop.value?.generationJobs ?? [])])
const displayArtifacts = computed<ReportExportArtifact[]>(() => [...localArtifacts.value, ...(closedLoop.value?.exportArtifacts ?? [])])

async function postGenerationJob(params: ReportParams) {
  const tpl = selectedTemplate.value
  const period = timeMode.value === 'month' ? (params.month ?? month.value) : (params.tradeDate ?? tradeDate.value)
  try {
    const res = await apiPost<{ job?: { jobId: string; status: string; progress: number; traceId: string } }>('/v1/reports/generation-jobs', {
      templateId: tpl.templateId, period, idempotencyKey: `IDEMP-RPT-${tpl.templateId}-${period}`, format: 'Excel'
    })
    const job = res.job
    if (job) {
      currentJobId.value = job.jobId
      localJobs.value = [{
        jobId: job.jobId, templateId: tpl.templateId, templateName: tpl.templateName, period,
        dataScope: `${regionLabel.value} · ${SUBJECT_LABELS[subjectType.value] || subjectType.value}`,
        triggeredBy: '本人', triggerMode: '页面生成', progress: job.progress ?? 100, durationMs: 0,
        status: '待审核', reviewer: '', generatedAt: new Date().toISOString(), traceId: job.traceId
      }, ...localJobs.value]
    }
  } catch { /* 后端未就绪时不阻塞本地生成体验 */ }
}

async function postExportArtifact(format: string) {
  try {
    const res = await apiPost<{ export?: { artifactId: string; fileName: string; format: string; status: string } }>('/v1/reports/exports', {
      jobId: currentJobId.value ?? `LOCAL-${selectedTemplate.value.templateId}`, format,
      idempotencyKey: `IDEMP-RPT-EXP-${selectedTemplate.value.templateId}-${Date.now()}`
    })
    const ex = res.export
    if (ex) {
      localArtifacts.value = [{
        artifactId: ex.artifactId, jobId: currentJobId.value ?? '', fileName: ex.fileName, format: ex.format,
        fileSizeKb: 0, checksum: '', downloadScope: '本人', status: ex.status || '已生成'
      }, ...localArtifacts.value]
    }
  } catch { /* 后端未就绪时忽略 */ }
}

onMounted(() => { registerReportBlocks(); loadClosedLoop(); loadSubs() })
</script>

<template>
  <div class="report-center">
    <div class="page-banner">
      <div>
        <h2>报表中心</h2>
        <p class="sub">电力现货交易报表 · 模板化生成 · 参数化 · 口径可解释 · 多格式导出</p>
      </div>
      <div class="banner-tags">
        <DataBasisBadge basis="synthetic" prefix="数据口径" />
        <el-tag size="small" type="info">当前地区：{{ currentRegion.shortName }}</el-tag>
        <el-tag size="small" :type="settlementRule.maturity === 'active' ? 'success' : 'warning'">结算口径：{{ getMaturityLabel(settlementRule.maturity) }}</el-tag>
      </div>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="模拟数据：报表区块基于合成场景演算；结算/偏差/收益口径公式真实且经 verify:report-formulas 校验，真实生产取数按各区块端点后续替换。"
      class="mock-alert"
    />

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="报告三引擎分工 · 本页 = 确定性结算报表（模板 + 真实结算公式，口径可验证）。需 AI 叙事 / 洞察报告 → 「报告工坊」；需定时自动生成并归档 → 「定时任务 · 结果中心」。"
      class="mock-alert"
    />

    <el-tabs v-model="activeTab">
      <el-tab-pane label="报表生成" name="generate">
        <el-row :gutter="16">
          <el-col :xs="24" :md="7">
            <el-card shadow="never" class="tpl-list">
              <template #header><span class="card-title">报表模板库（{{ filteredTemplates.length }}/{{ templates.length }}）</span></template>
              <div class="tpl-filter">
                <el-input v-model="tplKeyword" placeholder="搜索报表名 / 业务域" clearable size="small" />
                <el-select v-model="tplDomain" placeholder="按业务域筛选" clearable size="small" style="margin-top: 8px; width: 100%">
                  <el-option v-for="d in domainOptions" :key="d" :label="d" :value="d" />
                </el-select>
              </div>
              <div
                v-for="t in filteredTemplates"
                :key="t.templateId"
                class="tpl-item"
                :class="{ active: t.templateId === selectedId }"
                @click="selectedId = t.templateId"
              >
                <div class="tpl-name">{{ t.templateName }}</div>
                <div class="tpl-meta">
                  <el-tag size="small" effect="plain">{{ t.domain }}</el-tag>
                  <el-tag size="small" effect="plain" type="success">{{ t.priority }}</el-tag>
                </div>
                <div class="tpl-subj">{{ (t.subjectTypes || []).map((s) => SUBJECT_LABELS[s] || s).join(' / ') }}</div>
              </div>
            </el-card>
          </el-col>

          <el-col :xs="24" :md="17">
            <el-card shadow="never" class="param-card">
              <template #header><span class="card-title">{{ selectedTemplate.templateName }} · 参数</span></template>
              <el-form :inline="true">
                <el-form-item label="地区">
                  <el-select v-model="regionId" filterable style="width: 160px">
                    <el-option v-for="r in regionProfiles" :key="r.id" :label="r.shortName" :value="r.id" />
                  </el-select>
                </el-form-item>
                <el-form-item :label="timeMode === 'month' ? '结算月' : '交易日'">
                  <el-date-picker v-if="timeMode === 'month'" v-model="month" type="month" value-format="YYYY-MM" />
                  <el-date-picker v-else v-model="tradeDate" type="date" value-format="YYYY-MM-DD" />
                </el-form-item>
                <el-form-item label="主体类型">
                  <el-select v-model="subjectType" style="width: 140px">
                    <el-option v-for="s in subjectOptions" :key="s" :label="SUBJECT_LABELS[s] || s" :value="s" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="marketOptions.length" label="市场">
                  <el-select v-model="market" multiple collapse-tags style="width: 200px">
                    <el-option v-for="m in marketOptions" :key="m" :label="m" :value="m" />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="generating" @click="generate">生成报表</el-button>
                  <el-button type="success" :disabled="!instance" @click="exportInstanceExcel">导出 Excel</el-button>
                  <el-button :disabled="!instance" @click="exportInstanceCsv">导出 CSV</el-button>
                  <el-button :disabled="!instance" @click="printReport">打印</el-button>
                </el-form-item>
              </el-form>
            </el-card>

            <div v-if="instance" class="preview" id="report-print-area">
              <el-card shadow="never" class="summary-card">
                <div class="summary-grid">
                  <div class="sm-item"><span class="sm-label">报表</span><span class="sm-val">{{ instance.templateName }}</span></div>
                  <div class="sm-item"><span class="sm-label">主体</span><span class="sm-val">{{ SUBJECT_LABELS[subjectType] || subjectType }}</span></div>
                  <div class="sm-item"><span class="sm-label">期间</span><span class="sm-val">{{ timeMode === 'month' ? month : tradeDate }}</span></div>
                  <div class="sm-item"><span class="sm-label">地区</span><span class="sm-val">{{ regionLabel }}</span></div>
                  <div class="sm-item"><span class="sm-label">结算口径</span><span class="sm-val">{{ getMaturityLabel(settlementRule.maturity) }}</span></div>
                  <div class="sm-item"><span class="sm-label">生成时间</span><span class="sm-val">{{ formatTime(instance.generatedAt) }}</span></div>
                  <div class="sm-item"><span class="sm-label">数据口径</span><DataBasisBadge basis="synthetic" /></div>
                </div>
              </el-card>
              <ReportBlockRenderer v-for="b in instance.blocks" :key="b.blockId" :block="b" />
            </div>
            <el-empty v-else description="选择模板并设置参数后点击「生成报表」" />
          </el-col>
        </el-row>
      </el-tab-pane>

      <el-tab-pane label="生成队列" name="jobs">
        <el-alert v-if="backendError" type="info" :closable="false" :title="backendError" class="mock-alert" />
        <el-alert type="info" :closable="false" show-icon class="mock-alert" title="生成/导出动作已写回后端异步任务（含审计 traceId）；本会话生成的报表可流转状态（演示态，后端 transition 端点待后续）。" />
        <el-table :data="displayJobs" border size="small">
          <el-table-column prop="templateName" label="报表" min-width="160" />
          <el-table-column prop="period" label="周期" width="110" />
          <el-table-column prop="triggeredBy" label="触发人" width="100" />
          <el-table-column label="状态" width="100"><template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template></el-table-column>
          <el-table-column label="操作" width="200"><template #default="{ row }">
            <template v-if="isLocalJob(row.jobId)">
              <el-button v-if="row.status === '待审核'" link size="small" type="success" @click="transitionJob(row.jobId, '已发布')">通过</el-button>
              <el-button v-if="row.status === '待审核'" link size="small" type="danger" @click="transitionJob(row.jobId, '驳回')">驳回</el-button>
              <el-button v-if="row.status === '已发布'" link size="small" @click="transitionJob(row.jobId, '已归档')">归档</el-button>
              <el-button v-if="row.status === '驳回'" link size="small" type="warning" @click="transitionJob(row.jobId, '待审核')">重审</el-button>
            </template>
            <span v-else class="row-muted">历史记录</span>
          </template></el-table-column>
          <el-table-column prop="generatedAt" label="生成时间" width="170" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="导出归档" name="exports">
        <el-alert v-if="backendError" type="info" :closable="false" :title="backendError" class="mock-alert" />
        <el-table :data="displayArtifacts" border size="small">
          <el-table-column prop="fileName" label="文件" min-width="220" />
          <el-table-column prop="format" label="格式" width="90" />
          <el-table-column prop="fileSizeKb" label="大小(KB)" width="110" />
          <el-table-column prop="downloadScope" label="下载范围" min-width="140" />
          <el-table-column label="状态" width="100"><template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="订阅" name="subs">
        <el-alert type="info" :closable="false" show-icon class="mock-alert" title="演示功能：定时调度与推送为模拟，不会实际触发生成或发送；真实落地需后端 cron 调度 + 邮件/Webhook 网关。" />
        <div style="margin-bottom: 12px"><el-button type="primary" @click="openSubDialog">新建订阅</el-button></div>
        <el-table v-if="subscriptions.length" :data="subscriptions" border size="small">
          <el-table-column prop="templateName" label="报表" min-width="160" />
          <el-table-column label="频率" width="80"><template #default="{ row }">{{ FREQUENCY_LABELS[row.frequency as SubscriptionFrequency] }}</template></el-table-column>
          <el-table-column prop="regionId" label="地区" width="100" />
          <el-table-column label="主体" width="110"><template #default="{ row }">{{ SUBJECT_LABELS[row.subjectType] || row.subjectType }}</template></el-table-column>
          <el-table-column label="渠道" width="90"><template #default="{ row }">{{ CHANNEL_LABELS[row.channel as SubscriptionChannel] }}</template></el-table-column>
          <el-table-column prop="recipients" label="接收方" min-width="160" />
          <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="140"><template #default="{ row }">
            <el-button link size="small" @click="onToggleSub(row.id)">{{ row.enabled ? '停用' : '启用' }}</el-button>
            <el-button link size="small" type="danger" @click="onRemoveSub(row.id)">删除</el-button>
          </template></el-table-column>
        </el-table>
        <el-empty v-else description="暂无订阅，点击「新建订阅」创建" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="subDialogVisible" title="新建报表订阅" width="480px">
      <el-form label-width="90px">
        <el-form-item label="报表模板">
          <el-select v-model="subForm.templateId" style="width: 100%">
            <el-option v-for="t in templates" :key="t.templateId" :label="t.templateName" :value="t.templateId" />
          </el-select>
        </el-form-item>
        <el-form-item label="频率">
          <el-select v-model="subForm.frequency" style="width: 100%">
            <el-option label="每日" value="daily" />
            <el-option label="每周" value="weekly" />
            <el-option label="每月" value="monthly" />
          </el-select>
        </el-form-item>
        <el-form-item label="推送渠道">
          <el-select v-model="subForm.channel" style="width: 100%">
            <el-option label="邮件" value="email" />
            <el-option label="Webhook" value="webhook" />
          </el-select>
        </el-form-item>
        <el-form-item label="接收方">
          <el-input v-model="subForm.recipients" placeholder="邮箱或 Webhook URL（演示，不实际发送）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitSub">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.report-center { padding: 16px; }
.page-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.page-banner h2 { margin: 0; font-size: 20px; }
.page-banner .sub { margin: 4px 0 0; color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.banner-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mock-alert { margin-bottom: 12px; }
.card-title { font-weight: 600; }
.tpl-list { max-height: 72vh; overflow: auto; }
.tpl-item { border: 1px solid var(--el-border-color-light, #ebeef5); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; cursor: pointer; transition: all .15s; }
.tpl-item:hover { border-color: var(--el-color-primary, #409eff); }
.tpl-item.active { border-color: var(--el-color-primary, #409eff); background: var(--el-color-primary-light-9, #ecf5ff); }
.tpl-name { font-weight: 600; margin-bottom: 6px; }
.tpl-meta { display: flex; gap: 6px; margin-bottom: 6px; }
.tpl-subj { font-size: 12px; color: var(--el-text-color-secondary, #909399); }
.preview { margin-top: 4px; }
.tpl-filter { margin-bottom: 12px; }
.summary-card { margin-bottom: 16px; }
.summary-grid { display: flex; flex-wrap: wrap; gap: 12px 28px; }
.sm-item { display: flex; align-items: center; gap: 8px; }
.sm-label { font-size: 12px; color: var(--el-text-color-secondary, #909399); }
.sm-val { font-weight: 600; }
@media print {
  .page-banner, .mock-alert, .tpl-filter, .param-card, .tpl-list { display: none !important; }
  :deep(.el-tabs__header) { display: none !important; }
  .report-center { padding: 0; }
  .summary-card, .block-card { break-inside: avoid; }
}
.row-muted { font-size: 12px; color: var(--el-text-color-secondary, #909399); }
</style>
