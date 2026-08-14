<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  exportAnalysisSeries,
  getAnalysisSeries,
  runAnalysisExecution,
  type AnalysisExecutionResponse,
  type AnalysisExportResponse,
  type AnalysisMetric,
  type AnalysisTarget,
  type RuntimeContract
} from '@/services/analysis/analysisData'

const route = useRoute()
const chartRef = ref<HTMLElement | null>(null)
const hours = ref<string[]>([])
const values = ref<number[]>([])
const metrics = ref<AnalysisMetric[]>([])
const runtimeContracts = ref<RuntimeContract[]>([])
const sourceApi = ref('/sdpt/zsjfx/data')
const operationFamily = ref('/sdpt/zsjfx')
const area = ref('山西')
const date = ref('2026-05-26')
const loading = ref(false)
const exportLoading = ref(false)
const actionLoading = ref(false)
const exportResult = ref<AnalysisExportResponse | null>(null)
const executionResult = ref<AnalysisExecutionResponse | null>(null)
// 统一 ECharts 生命周期:容器级自适应、主题切换自动重建并重绘
const seriesChart = useEChart(chartRef, { render: renderChart })

// 分析日期/区域 ⇄ 路由 query:刷新或分享链接后筛选状态可还原
useQuerySync({ date, area })

const pageName = computed(() => {
  if (route.path.includes('price')) return '价格分析'
  if (route.path.includes('risk')) return '风险监测'
  return '负荷分析'
})

const pageDescription = computed(() => {
  if (target.value === 'price') return '复原价格曲线、导出合同和尖峰价差研判逻辑'
  if (target.value === 'risk') return '复原综合风险曲线、动作建议和决策支持联动逻辑'
  return '复原负荷曲线、导出合同和峰谷波动复核逻辑'
})

const target = computed<AnalysisTarget>(() => {
  if (route.path.includes('/analysis/risk')) return 'risk'
  if (route.path.includes('/analysis/price')) return 'price'
  return 'load'
})

const maxValue = computed(() => values.value.length ? Math.max(...values.value) : 0)
const minValue = computed(() => values.value.length ? Math.min(...values.value) : 0)
const primaryUnit = computed(() => (target.value === 'price' ? '元/MWh' : target.value === 'risk' ? '分' : 'MWh'))
const riskMetric = computed(() => metrics.value.find((metric) => metric.level !== 'low') ?? metrics.value[0])
const chartColor = computed(() => (target.value === 'price' ? '#2563eb' : target.value === 'risk' ? '#dc2626' : '#0f9f8f'))

async function fetchSeries() {
  loading.value = true
  seriesChart.showLoading()
  try {
    exportResult.value = null
    executionResult.value = null
    const response = await getAnalysisSeries({
      target: target.value,
      area: area.value,
      date: date.value
    })
    hours.value = response.hours
    values.value = response.values
    metrics.value = response.metrics
    runtimeContracts.value = response.runtimeContracts ?? []
    sourceApi.value = response.sourceApi ?? '/sdpt/zsjfx/data'
    operationFamily.value = response.operationFamily ?? '/sdpt/zsjfx'
    await nextTick()
    renderChart()
  } catch (e) {
    // 加载失败要让用户可感知,避免静默空图
    ElMessage.warning(e instanceof Error ? e.message : '分析序列加载失败')
  } finally {
    loading.value = false
    seriesChart.hideLoading()
  }
}

function renderChart() {
  if (!chartRef.value) return
  seriesChart.setOption({
    ...emptyOverlay(!values.value.length),
    grid: { left: 42, right: 18, top: 28, bottom: 36 },
    tooltip: axisTooltip({ unit: primaryUnit.value }),
    toolbox: chartToolbox(pageName.value),
    // 96 点及以上序列默认开启滚轮/双指缩放
    ...(hours.value.length >= 96 ? { dataZoom: insideZoom() } : {}),
    xAxis: { type: 'category', data: hours.value },
    yAxis: { type: 'value' },
    series: [
      {
        name: pageName.value,
        type: 'line',
        // 价格分析页为分时电价(按时段恒定)→阶梯线；负荷/风险等→直线
        ...(target.value === 'price' ? { step: 'start' as const } : {}),
        // 超长序列降采样,保证拖动缩放不掉帧
        ...(values.value.length > 500 ? { sampling: 'lttb' as const } : {}),
        areaStyle: { opacity: 0.12 },
        data: values.value,
        color: chartColor.value
      }
    ]
  }, { notMerge: true })
}

async function runExport() {
  exportLoading.value = true
  try {
    exportResult.value = await exportAnalysisSeries({
      target: target.value,
      area: area.value,
      date: date.value
    })
  } finally {
    exportLoading.value = false
  }
}

async function runReview() {
  actionLoading.value = true
  try {
    executionResult.value = await runAnalysisExecution({
      target: target.value,
      area: area.value,
      date: date.value
    })
  } finally {
    actionLoading.value = false
  }
}

// 导出预览行一键存为本地 CSV
function exportPreviewCsv() {
  const rows = exportResult.value?.preview.rows ?? []
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  exportCsv(
    exportResult.value?.file.fileName ?? `${pageName.value}_导出预览`,
    headers,
    rows.map((row) => headers.map((key) => (row as Record<string, string | number | null | undefined>)[key]))
  )
}

onMounted(fetchSeries)

watch(() => route.path, fetchSeries)
</script>

<template>
  <div class="page-stack">
    <section class="panel">
      <div class="panel-title">
        <h2>{{ pageName }}</h2>
        <span>{{ pageDescription }}</span>
      </div>
      <div class="toolbar">
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" placeholder="分析日期" />
        <el-select v-model="area" placeholder="区域">
          <el-option label="华北" value="华北" />
          <el-option label="山西" value="山西" />
          <el-option label="蒙西" value="蒙西" />
        </el-select>
        <el-button type="primary" :loading="loading" @click="fetchSeries">查询</el-button>
        <el-button :loading="actionLoading" @click="runReview">研判</el-button>
        <el-button :loading="exportLoading" @click="runExport">导出</el-button>
      </div>
      <div ref="chartRef" class="chart chart-host"></div>
    </section>

    <section class="content-grid four-columns">
      <div class="panel compact">
        <span>最大值</span>
        <strong>{{ maxValue.toLocaleString() }} {{ primaryUnit }}</strong>
      </div>
      <div class="panel compact">
        <span>最小值</span>
        <strong>{{ minValue.toLocaleString() }} {{ primaryUnit }}</strong>
      </div>
      <div class="panel compact">
        <span>{{ riskMetric?.label ?? '风险状态' }}</span>
        <strong>{{ riskMetric?.value ?? 0 }} {{ riskMetric?.unit ?? '' }}</strong>
      </div>
      <div class="panel compact">
        <span>来源接口</span>
        <strong>{{ sourceApi }}</strong>
        <em>{{ operationFamily }}</em>
      </div>
    </section>

    <section v-if="runtimeContracts.length" class="panel">
      <div class="panel-title">
        <h2>运行时导出契约</h2>
        <span>已确认生产请求路径和字段名，文件响应头仍待补齐</span>
      </div>
      <el-table :data="runtimeContracts" border>
        <el-table-column prop="productionRoute" label="生产页面" min-width="150" show-overflow-tooltip />
        <el-table-column prop="action" label="动作" width="90" />
        <el-table-column prop="path" label="接口" min-width="170" show-overflow-tooltip />
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column prop="requestContentType" label="请求类型" min-width="190" show-overflow-tooltip />
        <el-table-column label="字段名" min-width="270" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bodyKeys.join(', ') || row.queryKeys.join(', ') || '-' }}</template>
        </el-table-column>
        <el-table-column prop="responseContentType" label="响应类型" min-width="120" />
        <el-table-column label="缺失元数据" min-width="170">
          <template #default="{ row }">{{ row.missingMetadataFields.join(', ') || '-' }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section v-if="executionResult" class="panel">
      <div class="panel-title">
        <h2>本地研判结果</h2>
        <span>{{ pageName }} · {{ executionResult.runtimeStatus }}</span>
      </div>
      <div class="review-summary-grid" v-loading="actionLoading">
        <article>
          <span>来源文档</span>
          <strong>{{ executionResult.sourceDocumentLabel }}</strong>
        </article>
        <article>
          <span>执行状态</span>
          <strong>{{ executionResult.executionSummary.status }}</strong>
        </article>
        <article>
          <span>业务族</span>
          <strong>{{ executionResult.operationFamily }}</strong>
        </article>
        <article>
          <span>本地接口</span>
          <strong>{{ executionResult.request.localApi }}</strong>
        </article>
      </div>

      <div class="restore-notes">
        <p>{{ executionResult.executionSummary.message }}</p>
        <p>{{ executionResult.gitPolicy }}</p>
      </div>

      <el-table :data="[executionResult.summary]" border>
        <el-table-column prop="peakHour" label="峰值时点" width="110" />
        <el-table-column prop="peakValue" label="峰值" width="120" />
        <el-table-column prop="valleyHour" label="谷值时点" width="110" />
        <el-table-column prop="valleyValue" label="谷值" width="120" />
        <el-table-column prop="averageValue" label="均值" width="120" />
        <el-table-column prop="volatility" label="波动幅度" width="120" />
        <el-table-column prop="topMetricLabel" label="主风险指标" min-width="180" show-overflow-tooltip />
        <el-table-column prop="topMetricLevel" label="指标级别" width="100" />
        <el-table-column prop="suggestedAction" label="建议动作" min-width="260" show-overflow-tooltip />
        <el-table-column prop="nextRoute" label="下游页面" min-width="180" />
      </el-table>

      <el-table :data="executionResult.validationChecks" border>
        <el-table-column prop="label" label="校验项" min-width="180" />
        <el-table-column prop="result" label="结果" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.result === 'pass' ? 'success' : row.result === 'warn' ? 'warning' : 'danger'">
              {{ row.result }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="260" show-overflow-tooltip />
      </el-table>

      <div class="restore-notes">
        <p>下游建议：{{ executionResult.downstreamSuggestions.join('；') }}</p>
      </div>
    </section>

    <section v-if="exportResult" class="panel">
      <div class="panel-title">
        <h2>本地导出结果</h2>
        <span>{{ exportResult.runtimeStatus }}</span>
        <el-button class="export-btn" size="small" :disabled="!exportResult.preview.rows.length" @click="exportPreviewCsv">导出CSV</el-button>
      </div>
      <div class="review-summary-grid" v-loading="exportLoading">
        <article>
          <span>生产接口</span>
          <strong>{{ exportResult.request.method }} {{ exportResult.request.path }}</strong>
        </article>
        <article>
          <span>文件名</span>
          <strong>{{ exportResult.file.fileName }}</strong>
        </article>
        <article>
          <span>命名规则</span>
          <strong>{{ exportResult.file.exportFileNameRule }}</strong>
        </article>
        <article>
          <span>预览行数</span>
          <strong>{{ exportResult.preview.rowCount }}</strong>
        </article>
      </div>
      <div class="restore-notes">
        <p>{{ exportResult.gitPolicy }}</p>
      </div>
      <el-table :data="exportResult.preview.rows" border>
        <el-table-column v-for="(value, key) in exportResult.preview.rows[0] ?? {}" :key="key" :prop="key" :label="key" min-width="140" />
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.export-btn {
  margin-left: auto;
}

/* 移动端筛选条纵排（断点对齐 responsive.css 规约） */
@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
