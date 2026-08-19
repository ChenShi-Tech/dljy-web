<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getImportHubDataset,
  listImportTemplateDeclarations,
  type ImportHubTab,
  type ExcelTemplateDeclaration
} from '@/services/importHub'
import { apiGet, apiPost, ApiError } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import { createAgentClient } from '@/services/agent/httpClient'

const activeTab = ref<ImportHubTab>('retailSettlement')
const dataset = getImportHubDataset()
// #2174 P2-2c-3：管理入口统一收口 data-service（/data-svc 代理 → :8190 转发 agent-backend）。
const retailSettlementImportClient = createAgentClient('/data-svc/api/v1/retail-settlement-import', {
  rawBase: true,
  rootBase: true,
  timeoutMs: 30_000
})

const tabs: Array<{ label: string; value: ImportHubTab }> = [
  { label: '电量', value: 'electricity' },
  { label: '客户负荷', value: 'customerLoad' },
  { label: '零售套餐', value: 'retail' },
  { label: '结算', value: 'settlement' },
  { label: '售电结算', value: 'retailSettlement' },
  { label: '市场交易', value: 'trading' },
  { label: '市场分析', value: 'marketOps' }
]

// 已实装真实后端（CSV 解析+校验+状态机+台账）：结算/市场交易（P2）+
// 电量（发电侧）/客户分时负荷（售电侧）（P3 分主体数据通道）+
// 市场经营分析（P2 投递型 → capture-raw + capture.sqlite，链路 A）；
// 其余仍为模板级演示，历史列表明确标注"演示"。
const IMPLEMENTED: ImportHubTab[] = ['settlement', 'trading', 'electricity', 'customerLoad', 'marketOps', 'retail', 'retailSettlement']
const isImplemented = computed(() => IMPLEMENTED.includes(activeTab.value))

// marketOps 投递型：9 个 datasetKey（7 公共 + 套餐明细/KPI 两个 company 私有）。
const marketDatasetKeys: Array<{ label: string; value: string }> = [
  { label: '交易汇总', value: 'market_trade_summary' },
  { label: '月度趋势', value: 'market_monthly_trend' },
  { label: '发电构成', value: 'market_generation' },
  { label: '售电公司', value: 'market_sales' },
  { label: '独立储能', value: 'market_storage' },
  { label: '零售套餐', value: 'market_packages' },
  { label: '价格趋势', value: 'market_price' },
  { label: '公共KPI指标', value: 'market_metrics' },
  { label: '套餐KPI指标（公司私有）', value: 'market_retail_package_metrics' }
]
// 各 datasetKey 的主要中文列名（前端字段提示 + 模板下载；权威字段映射在后端 yn-fact-market.mjs ALIASES）。
const marketFieldsByDataset: Record<string, string[]> = {
  market_trade_summary: ['交易类型', '电量', '均价', '笔数', '占比'],
  market_monthly_trend: ['月份', '电量', '均价', '中长期', '现货', '辅助服务'],
  market_generation: ['名称', '电量', '均价', '数量', '分类(powerType/detail)'],
  market_sales: ['售电公司', '电量', '均价', '用户数'],
  market_storage: ['储能项目', '电量', '均价', '数量'],
  market_packages: ['售电公司', '用户名称', '套餐类型', '平段价', '峰段价', '谷段价', '套餐电量'],
  market_price: ['月份', '中长期电价', '现货电价', '零售电价'],
  market_metrics: ['tab(overview/generation/sales/storage)', '指标', '值', '单位', '色调'],
  market_retail_package_metrics: ['tab(packages)', '指标', '值', '单位', '色调']
}
const selectedDatasetKey = ref('market_trade_summary')
// 投递型 tabs：marketOps（9 datasetKey 选）+ retail（固定 market_packages，与 MarketOps「套餐」tab 同源）。
const isDelivery = computed(() => activeTab.value === 'marketOps' || activeTab.value === 'retail')
const deliveryDatasetKey = computed(() => activeTab.value === 'retail' ? 'market_packages' : selectedDatasetKey.value)

type RealImportRecord = {
  id: string
  type: string
  datasetKey?: string
  region?: string
  fileName: string
  status: 'CREATED' | 'UPLOADED' | 'VALIDATED' | 'COMMITTED' | 'FAILED'
  totalRows: number
  validRows: number
  invalidRows: number
  errors: string[]
  createdAt: string
}

const realRecords = ref<RealImportRecord[]>([])
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const STATUS_TEXT: Record<RealImportRecord['status'], string> = {
  CREATED: '已创建',
  UPLOADED: '已上传',
  VALIDATED: '已校验',
  COMMITTED: '成功',
  FAILED: '失败'
}

// ── 逐行错误明细（#768 + #660 遗留 422 展示）：所有 tab / 模板上传共用一处回显 ──
// 上传失败或部分跳过时，把 envelope.data.errors 逐行原因（第 N 行 …）铺开展示，
// 而非笼统只读 error.message。
const uploadErrors = ref<string[]>([])
const uploadErrorTitle = ref('')

/** 统一处理上传异常：ApiError 时展示 payload.data.errors 逐行明细（全部 tab 受益）。 */
function applyUploadError(error: unknown, context: string) {
  uploadErrorTitle.value = context
  if (error instanceof ApiError) {
    const detail = (error.payload?.data as { errors?: string[] } | undefined)?.errors
    uploadErrors.value = Array.isArray(detail) ? detail : []
    ElMessage.error(error.payload?.msg ?? error.message ?? context)
    return
  }
  uploadErrors.value = []
  ElMessage.error(error instanceof Error ? error.message : context)
}

// ── T0/T1 标准数据模板（#768）：声明驱动下载 → 上传 → 逐行报错 → 台账即时见数 ──
type TemplateRecord = {
  id: string
  templateId: string
  tier?: string | null
  label?: string
  fileName: string
  status: RealImportRecord['status']
  totalRows: number
  validRows: number
  invalidRows: number
  errors: string[]
  ownerCompanyId?: string | null
  createdAt: string
  // #822：清单协议投递结果（后端 COMMITTED 后转写清单 CSV 落盘；覆盖写幂等）。
  deliveredPaths?: Array<{ path: string; rows: number }>
  deliveryHint?: string
  deliveryError?: string
}
// #822：最近一次模板上传的清单投递结果（成功展示文件列表+生效命令，失败黄色警示）。
type DeliveryResult = { paths: Array<{ path: string; rows: number }>; hint: string; error?: string }
const templateDeclarations: ExcelTemplateDeclaration[] = listImportTemplateDeclarations()
const selectedTemplateId = ref<string>(templateDeclarations[0]?.templateId ?? '')
const selectedTemplate = computed(() =>
  templateDeclarations.find((t) => t.templateId === selectedTemplateId.value) ?? templateDeclarations[0]
)
const isCompanyTemplate = computed(() => selectedTemplate.value?.ownership === 'company')
const templateUploading = ref(false)
const templateFileInput = ref<HTMLInputElement | null>(null)
const templateRecords = ref<TemplateRecord[]>([])
const lastDelivery = ref<DeliveryResult | null>(null)

async function loadTemplateRecords() {
  try {
    const res = await apiGet<{ data: { rows: TemplateRecord[] } }>(
      '/v1/import-templates/records',
      { templateId: selectedTemplateId.value }
    )
    templateRecords.value = ((res.data ?? res) as unknown as { rows?: TemplateRecord[] }).rows ?? []
  } catch {
    templateRecords.value = []
  }
}

async function downloadStandardTemplate() {
  const decl = selectedTemplate.value
  if (!decl) return
  // 懒加载：xlsx 只在点击下载时进 bundle（照抄 exportExcel 模式）。
  const { downloadTemplateWorkbook } = await import('@/utils/importTemplate')
  downloadTemplateWorkbook(decl)
}

function pickTemplateFile() {
  templateFileInput.value?.click()
}

async function onTemplateFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || templateUploading.value) return
  templateUploading.value = true
  uploadErrors.value = []
  lastDelivery.value = null
  try {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)
    const content = isExcel ? await fileToBase64(file) : await file.text()
    const res = await apiPost<{ data: TemplateRecord; msg?: string }>('/v1/import-templates/upload', {
      templateId: selectedTemplateId.value,
      fileName: file.name,
      content,
      isBinary: isExcel
    })
    // all-or-nothing：模板成功即全表入账，无「部分跳过」；失败(422)走 catch 铺开逐行明细。
    // #822：上传成功后展示清单协议投递结果（已投递文件 + 生效命令）；投递只落文件，
    // 须手动跑 ETL 才让分析页见数（诚实叙事，不暗示分析页已见数）。
    lastDelivery.value = {
      paths: res.data?.deliveredPaths ?? [],
      hint: res.data?.deliveryHint ?? '',
      error: res.data?.deliveryError
    }
    ElMessage.success(res.msg ?? '导入成功；已入导入台账并投递清单协议目录')
    await loadTemplateRecords()
  } catch (error) {
    applyUploadError(error, '模板导入失败')
    await loadTemplateRecords()
  } finally {
    templateUploading.value = false
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择命令文本复制')
  }
}

function apiPathFromEndpoint(endpoint: string): string {
  if (endpoint === '/api') return '/'
  if (endpoint.startsWith('/api/')) return endpoint.slice(4)
  if (endpoint.startsWith('/')) return endpoint
  throw new Error(`导入接口配置不是 API 路径：${endpoint}`)
}

async function loadRealRecords() {
  if (!isImplemented.value) return
  // 后端 records 尚未按登录会话 companyId 隔离；在完成公司归属收口前 fail-closed 不展示，
  // 避免把仅有管理令牌保护的全量售电结算记录接到公司业务页。
  if (activeTab.value === 'retailSettlement') { realRecords.value = []; return }
  try {
    // retail 走投递分支（record.type='marketOps'），查 type=marketOps 并按 datasetKey=market_packages 过滤。
    const queryType = activeTab.value === 'retail' ? 'marketOps' : activeTab.value
    const res = await apiGet<{ data: { rows: RealImportRecord[] } }>('/v1/import-hub/records', { type: queryType })
    let rows = ((res.data ?? res) as unknown as { rows?: RealImportRecord[] }).rows ?? []
    if (activeTab.value === 'retail') rows = rows.filter((r) => r.datasetKey === 'market_packages')
    realRecords.value = rows
  } catch {
    realRecords.value = []
  }
}

function pickFile() {
  fileInput.value?.click()
}

// P5：Excel 文件 → base64（供后端 XLSX.read 解码）；CSV 走 file.text() 不经此。
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      resolve(btoa(binary))
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value) return
  uploading.value = true
  uploadErrors.value = []
  try {
    if (activeTab.value === 'retailSettlement') {
      // P4：售电结算走 agent-backend（FormData + /agent-api → 8000），不经 apiPost/apiPathFromEndpoint。
      // 仿 agentSkills.importSkillZip：FormData append('file')，不设 content-type（浏览器加 multipart 边界）。
      const form = new FormData()
      form.append('file', file)
      const result = await retailSettlementImportClient.postForm<{
        success: boolean
        message?: string
        data?: { valid_count?: number; invalid_count?: number }
      }>('/upload?preview_only=false', form)
      if (!result.success) throw new Error(result.message || '导入失败')
      ElMessage.success(result.message || `售电结算导入：有效 ${result.data?.valid_count ?? 0} / 无效 ${result.data?.invalid_count ?? 0}`)
      return
    }
    // P5：Excel→base64（isBinary=true，后端 XLSX 解码）；CSV→text（isBinary=false）。
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)
    const content = isExcel ? await fileToBase64(file) : await file.text()
    const body: Record<string, unknown> = { fileName: file.name, content, isBinary: isExcel }
    // 投递型（marketOps 选 datasetKey / retail 固定 market_packages）：带 datasetKey + 当前 region。
    if (isDelivery.value) {
      body.datasetKey = deliveryDatasetKey.value
      body.region = currentRegion.value.id
    }
    const res = await apiPost<{ data: RealImportRecord; msg?: string }>(apiPathFromEndpoint(currentTask.value.endpoint), body)
    // 部分跳过：把逐行 reason 铺开展示（#660 遗留 422 展示的正向版本）。
    if (res.data?.errors?.length) {
      uploadErrorTitle.value = '本次导入的跳过行明细'
      uploadErrors.value = res.data.errors
    }
    ElMessage.success(res.msg ?? '导入成功')
    await loadRealRecords()
  } catch (error) {
    // #660 遗留闭合：ApiError 时展示 payload.data.errors 逐行明细，而非只读 error.message。
    applyUploadError(error, '导入失败')
    await loadRealRecords()
  } finally {
    uploading.value = false
  }
}

function downloadTemplate() {
  // 模板 = 必填列表头 CSV（实装类型直接可回传导入）；marketOps 按 selectedDatasetKey 取列名。
  const fields = activeTab.value === 'marketOps'
    ? (marketFieldsByDataset[selectedDatasetKey.value] ?? [])
    : currentTask.value.requiredFields
  const headers = fields.join(',')
  const blob = new Blob([`﻿${headers}\n`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = currentTask.value.template.replace(/\.xlsx$/, '.csv')
  a.click()
  URL.revokeObjectURL(a.href)
}

const currentTask = computed(() => dataset.tasks.find((task) => task.type === activeTab.value) ?? dataset.tasks[0])
const metrics = computed(() => dataset.metrics[activeTab.value])
const currentHistory = computed(() => dataset.history.filter((row) => row.type === activeTab.value))
// marketOps 字段提示随 datasetKey 变化；其他类型用 task.requiredFields。
const currentFields = computed(() => {
  if (activeTab.value === 'marketOps') return marketFieldsByDataset[selectedDatasetKey.value] ?? []
  if (activeTab.value === 'retail') return marketFieldsByDataset['market_packages'] ?? []
  return currentTask.value.requiredFields
})

watch(activeTab, () => {
  uploadErrors.value = []
  loadRealRecords()
})
watch(selectedTemplateId, () => {
  uploadErrors.value = []
  lastDelivery.value = null
  loadTemplateRecords()
})
onMounted(() => {
  loadRealRecords()
  loadTemplateRecords()
})
</script>

<template>
  <div class="page-stack import-hub">
    <section class="metric-grid">
      <article v-for="metric in metrics" :key="metric.label" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }} <small>{{ metric.unit }}</small></strong>
        <em :class="metric.tone">导入</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>数据导入融合台</h2>
        <span>电量、零售套餐、结算、售电结算、市场交易与市场经营分析导入迁移版</span>
      </div>
      <div class="toolbar import-toolbar">
        <el-radio-group v-model="activeTab">
          <el-radio-button v-for="tab in tabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}
          </el-radio-button>
        </el-radio-group>
        <el-select
          v-if="activeTab === 'marketOps'"
          v-model="selectedDatasetKey"
          size="small"
          style="width: 150px"
          placeholder="选择数据类型"
        >
          <el-option v-for="k in marketDatasetKeys" :key="k.value" :label="k.label" :value="k.value" />
        </el-select>
        <el-button type="primary" @click="downloadTemplate">下载模板（CSV）</el-button>
        <el-button v-if="isImplemented" type="success" :loading="uploading" @click="pickFile">选择文件导入</el-button>
        <el-tag v-if="isImplemented" type="success" size="small">
          {{ activeTab === 'retailSettlement' ? '上传已实装：历史待公司隔离' : '已实装：CSV 校验入库' }}
        </el-tag>
        <el-tag v-else type="info" size="small">模板级演示，后端待实装</el-tag>
        <input ref="fileInput" type="file" accept=".csv,.xlsx,.xls" style="display: none" @change="onFileChosen" />
      </div>
    </section>

    <section class="import-layout">
      <article class="panel">
        <div class="panel-title compact">
          <h2>{{ activeTab === 'marketOps' ? `${currentTask.label}·${marketDatasetKeys.find((k) => k.value === selectedDatasetKey)?.label ?? selectedDatasetKey}` : currentTask.label }}</h2>
          <span>{{ currentTask.endpoint }}</span>
        </div>
        <div class="drop-zone" :class="{ clickable: isImplemented }" @click="isImplemented && pickFile()">
          <strong>{{ currentTask.template.replace(/\.xlsx$/, '.csv') }}</strong>
          <span v-if="isImplemented">点击选择 CSV / Excel 文件上传</span>
          <span v-else>支持 {{ currentTask.supportedFormats.join(' / ') }}（待实装）</span>
        </div>
        <div class="field-list">
          <span v-for="field in currentFields" :key="field">{{ field }}</span>
        </div>
      </article>

      <article class="panel">
        <div class="panel-title compact">
          <h2>导入历史</h2>
          <span v-if="isImplemented && activeTab !== 'retailSettlement'">{{ realRecords.length }} 条（真实记录）</span>
          <span v-else-if="activeTab === 'retailSettlement'">暂不展示（公司隔离待收口）</span>
          <span v-else>{{ currentHistory.length }} 条（演示）</span>
        </div>
        <el-alert
          v-if="activeTab === 'retailSettlement'"
          type="warning"
          :closable="false"
          show-icon
          title="售电结算上传已可用；历史查询端点尚未按登录公司隔离，为防跨公司数据暴露暂不接入本页。"
        />
        <el-table v-else-if="isImplemented" :data="realRecords" size="small">
          <el-table-column prop="fileName" label="文件" min-width="180" />
          <el-table-column v-if="activeTab === 'marketOps'" label="数据类型" width="130">
            <template #default="{ row }">{{ marketDatasetKeys.find((k) => k.value === row.datasetKey)?.label ?? row.datasetKey ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'COMMITTED' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'" size="small">
                {{ STATUS_TEXT[row.status as keyof typeof STATUS_TEXT] ?? row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="totalRows" label="总行数" width="100" align="right" />
          <el-table-column prop="validRows" label="有效" width="90" align="right" />
          <el-table-column prop="invalidRows" label="异常" width="90" align="right" />
          <el-table-column label="错误明细" min-width="200">
            <template #default="{ row }">
              <span class="error-detail">{{ (row.errors ?? []).slice(0, 2).join('；') || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ String(row.createdAt).slice(0, 19).replace('T', ' ') }}</template>
          </el-table-column>
        </el-table>
        <el-table v-else :data="currentHistory" size="small">
          <el-table-column prop="filename" label="文件" min-width="180" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="rows" label="总行数" width="100" align="right" />
          <el-table-column prop="validRows" label="有效" width="90" align="right" />
          <el-table-column prop="invalidRows" label="异常" width="90" align="right" />
          <el-table-column prop="date" label="日期" width="120" />
        </el-table>
      </article>
    </section>

    <!-- 逐行错误明细（#768 + #660 遗留 422 展示）：所有 tab / 模板上传共用 -->
    <section v-if="uploadErrors.length" class="panel upload-errors">
      <div class="panel-title compact">
        <h2>{{ uploadErrorTitle || '逐行错误明细' }}</h2>
        <span>{{ uploadErrors.length }} 条（修正后可重新上传）</span>
      </div>
      <ul class="error-list">
        <li v-for="(err, i) in uploadErrors" :key="i">{{ err }}</li>
      </ul>
    </section>

    <!-- 标准数据模板（T0/T1）：声明驱动下载 → 上传 → 逐行报错 → 台账即时见数（#768） -->
    <section class="panel">
      <div class="panel-title">
        <h2>标准数据模板（T0/T1）</h2>
        <span>按模板声明生成 xlsx（列名/单位/格式/示例单一来源），逐行校验回显，投递即入台账</span>
      </div>
      <div class="toolbar import-toolbar">
        <el-select v-model="selectedTemplateId" size="small" style="width: 280px" placeholder="选择标准模板">
          <el-option
            v-for="t in templateDeclarations"
            :key="t.templateId"
            :label="`${t.tier} · ${t.label}`"
            :value="t.templateId"
          />
        </el-select>
        <el-tag size="small" :type="isCompanyTemplate ? 'warning' : 'info'">
          {{ isCompanyTemplate ? '公司私有 · 归属随登录会话' : '公共口径' }}
        </el-tag>
        <el-button type="primary" @click="downloadStandardTemplate">下载模板（xlsx）</el-button>
        <el-button type="success" :loading="templateUploading" @click="pickTemplateFile">上传填好的模板</el-button>
        <el-tag size="small" type="success">来源：手录投递 IMPORT（非采集）</el-tag>
        <input ref="templateFileInput" type="file" accept=".csv,.xlsx,.xls" style="display: none" @change="onTemplateFileChosen" />
      </div>
      <p v-if="isCompanyTemplate" class="template-note">
        公司私有模板不设「公司」列，数据归属由登录会话公司自动决定；非归属公司账号上传将被拒绝（422）。
      </p>
      <p class="template-note landing-note">
        投递数据落<strong>导入台账</strong>（下方「模板导入台账」即时可见，来源 IMPORT·非采集），
        并同步转写为<strong>清单协议 CSV</strong> 投递到对应清单目录（覆盖写幂等，#822）；
        投递只落文件，须手动跑下方「生效命令」（`spot:ingest` / `etl:forecast-yunnan`）才让分析页见数。
      </p>

      <!-- #822 投递结果区：上传成功后展示已投递文件 + 生效命令；失败黄色警示 -->
      <div v-if="lastDelivery" class="delivery-result">
        <div v-if="lastDelivery.error" class="delivery-error">
          ⚠ 清单投递失败：{{ lastDelivery.error }}（台账已落，修正落点目录权限/路径后重传可重试）
        </div>
        <template v-else>
          <div class="delivery-head">
            已投递 <strong>{{ lastDelivery.paths.length }}</strong> 个清单协议文件：
          </div>
          <ul class="delivery-files">
            <li v-for="(f, i) in lastDelivery.paths" :key="i">
              <code>{{ f.path }}</code> <small>{{ f.rows }} 行</small>
            </li>
          </ul>
          <div class="delivery-hint">
            <span>生效命令</span>（投递只落文件，运行后才让分析页见数）：
            <code>{{ lastDelivery.hint }}</code>
            <el-button link size="small" @click="copyText(lastDelivery.hint)">复制</el-button>
          </div>
        </template>
      </div>
      <div class="field-list">
        <span v-for="col in selectedTemplate?.columns ?? []" :key="col.name">
          {{ col.name }}<small v-if="col.unit"> ({{ col.unit }})</small><em v-if="col.required" class="req"> *</em>
        </span>
      </div>

      <div class="panel-title compact" style="margin-top: 16px">
        <h2>模板导入台账</h2>
        <span>{{ templateRecords.length }} 条（{{ selectedTemplate?.label ?? '' }}）</span>
      </div>
      <el-table :data="templateRecords" size="small">
        <el-table-column prop="fileName" label="文件" min-width="160" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'COMMITTED' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'" size="small">
              {{ STATUS_TEXT[row.status as keyof typeof STATUS_TEXT] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="totalRows" label="总行数" width="90" align="right" />
        <el-table-column prop="validRows" label="有效" width="80" align="right" />
        <el-table-column prop="invalidRows" label="跳过" width="80" align="right" />
        <el-table-column label="错误明细" min-width="220">
          <template #default="{ row }">
            <span class="error-detail">{{ (row.errors ?? []).slice(0, 3).join('；') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ String(row.createdAt).slice(0, 19).replace('T', ' ') }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-title compact">
        <h2>售电结算预览</h2>
        <span>合同、电能量、平衡账户、现货日前/实时与收益电费</span>
      </div>
      <el-table :data="dataset.retailSettlementPreview" size="small">
        <el-table-column prop="settlementUnitId" label="结算单元ID" min-width="150" />
        <el-table-column prop="settlementUnitName" label="结算单元名称" min-width="150" />
        <el-table-column prop="month" label="月份" width="100" />
        <el-table-column prop="timeSlot" label="时段" width="80" align="right" />
        <el-table-column prop="contractSettlementFee" label="合同结算电费" width="130" align="right" />
        <el-table-column prop="balanceAccountIncome" label="平衡账户入账" width="130" align="right" />
        <el-table-column prop="balanceAccountOutcome" label="平衡账户出账" width="130" align="right" />
        <el-table-column prop="deviationRecoveryFee" label="偏差回收" width="110" align="right" />
        <el-table-column prop="spotDayAheadFee" label="现货日前" width="110" align="right" />
        <el-table-column prop="spotRealTimeFee" label="现货实时" width="110" align="right" />
        <el-table-column prop="retailElectricityFee" label="零售侧电费" width="120" align="right" />
        <el-table-column prop="revenueElectricityFee" label="收益电费" width="110" align="right" />
        <el-table-column prop="settlementQuantity" label="结算电量" width="110" align="right" />
        <el-table-column prop="revenuePerKwh" label="度电收益" width="110" align="right" />
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.import-hub {
  gap: 18px;
}

.import-toolbar {
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.import-layout {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.2fr);
}

.drop-zone {
  align-items: center;
  border: 1px dashed var(--el-text-color-secondary);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  min-height: 150px;
}

.drop-zone.clickable {
  cursor: pointer;
}

.drop-zone.clickable:hover {
  border-color: #0f766e;
}

.error-detail {
  color: #b45309;
  font-size: var(--font-sm);
}

.upload-errors {
  border-left: 3px solid #d97706;
}

.error-list {
  color: #b45309;
  display: flex;
  flex-direction: column;
  font-size: var(--font-md);
  gap: 4px;
  list-style: disc inside;
  max-height: 220px;
  margin: 0;
  overflow-y: auto;
  padding: 4px 0;
}

.template-note {
  color: #b45309;
  font-size: var(--font-sm);
  margin: 8px 0 0;
}

.delivery-result {
  background: rgba(15, 118, 110, 0.05);
  border: 1px solid var(--line, #e2e8f0);
  border-radius: 8px;
  font-size: var(--font-md);
  margin: 12px 0 0;
  padding: 12px 14px;
}

.delivery-error {
  color: #b45309;
  font-weight: 500;
}

.delivery-head {
  color: #047857;
  margin-bottom: 6px;
}

.delivery-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.delivery-files li small {
  color: var(--muted);
  margin-left: 6px;
}

.delivery-hint span {
  color: var(--muted);
}

.delivery-result code {
  background: rgba(15, 118, 110, 0.1);
  border-radius: 4px;
  color: #0f766e;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-sm);
  padding: 2px 6px;
  word-break: break-all;
}

.landing-note {
  color: var(--muted);
}

.landing-note strong {
  color: var(--text);
}

.field-list span em.req {
  color: #dc2626;
  font-style: normal;
}

.drop-zone strong {
  color: var(--text);
  font-size: var(--font-16);
}

.drop-zone span {
  color: var(--muted);
  font-size: var(--font-md);
}

.field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.field-list span {
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font-size: var(--font-md);
  padding: 6px 10px;
}

.panel-title.compact {
  margin-bottom: 12px;
}

@media (max-width: 1000px) {
  .import-layout {
    grid-template-columns: 1fr;
  }

  .import-toolbar :deep(.el-radio-group) {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
