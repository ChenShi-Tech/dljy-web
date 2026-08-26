<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  getMarketAnalysis,
  loadMarketAnalysis,
  type CategoryRow,
  type MarketAnalysisDataset,
  type MarketAnalysisTab,
  type MarketMetric
} from '@/services/market/marketAnalysis'
import type { DataBasis } from '@/services/dataBasis'
import DataBasisBadge from '@/components/DataBasisBadge.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { usePageInsight } from '../composables/usePageInsight'
import { PAGE_PROMPT_KEYS } from '@/prompts'

const selectedYear = ref(2026)
const activeTab = ref<MarketAnalysisTab>('overview')
const dataset = ref<MarketAnalysisDataset>(getMarketAnalysis(selectedYear.value))
const basis = ref<DataBasis | null>(null)
const hasRealData = ref(false)
const publicDataReal = ref(false)
// #669：售电套餐为 company 私有族，非归属公司会被授权闸门拒绝→单独跟踪真实性/拒绝态。
const retailPackagesReal = ref(false)
const retailPackagesPartialReal = ref(false)
const retailPackageDetailsReal = ref(false)
const retailPackageMetricsReal = ref(false)
const retailPackagesAccessDenied = ref(false)
// 无真实数据时恒显 synthetic 徽章（Mock 标注纪律：占位示例必须可见标注），有真实才显真实 basis。
// 套餐 tab 单独判定：两键均真实=captured，一真一缺=illustrative，均无=synthetic。
const visibleBasis = computed<DataBasis | null>(() => {
  if (activeTab.value === 'packages') {
    if (retailPackagesReal.value) return basis.value
    return retailPackagesPartialReal.value ? 'illustrative' : 'synthetic'
  }
  return publicDataReal.value ? basis.value : 'synthetic'
})
// 套餐 tab 占位/授权态提示（可见「模拟数据」纪律 + 不泄漏他司经营数据）。
const packagesNotice = computed<string>(() => {
  if (activeTab.value !== 'packages' || retailPackagesReal.value) return ''
  if (retailPackagesAccessDenied.value) {
    return '售电套餐为售电公司私有经营口径，当前账号无查看权限，下方为占位示例（模拟数据），不含真实经营数据。'
  }
  if (retailPackagesPartialReal.value) {
    const realPart = retailPackageDetailsReal.value ? '套餐明细' : (retailPackageMetricsReal.value ? '套餐 KPI' : '部分数据')
    return `${realPart}已真实落盘，另一数据集仍为占位示例；当前为真实与示例混合展示，不可用于实盘决策。`
  }
  return '未检测到售电套餐真实落盘，下方为占位示例（模拟数据）。'
})
const loading = ref(false)
const errorMsg = ref('')
const categoryChartRef = ref<HTMLDivElement | null>(null)
const trendChartRef = ref<HTMLDivElement | null>(null)
// 统一 ECharts 生命周期:容器级自适应、主题切换自动重建并重绘
const categoryChart = useEChart(categoryChartRef, { render: renderCategoryChart })
const trendChart = useEChart(trendChartRef, { render: renderTrendChart })

// 年份/页签 ⇄ 路由 query:刷新或分享链接后筛选状态可还原
useQuerySync({ year: selectedYear, tab: activeTab })

const tabs: Array<{ label: string; value: MarketAnalysisTab }> = [
  { label: '市场概览', value: 'overview' },
  { label: '发电侧', value: 'generation' },
  { label: '售电公司', value: 'sales' },
  { label: '独立储能', value: 'storage' },
  { label: '套餐', value: 'packages' },
  { label: '价格趋势', value: 'price' }
]

const metrics = computed<MarketMetric[]>(() => {
  if (activeTab.value === 'generation') return dataset.value.generationMetrics
  if (activeTab.value === 'sales') return dataset.value.salesMetrics
  if (activeTab.value === 'storage') return dataset.value.storageMetrics
  if (activeTab.value === 'packages') return dataset.value.packageMetrics
  if (activeTab.value === 'price') {
    const prices = dataset.value.priceTrend
    const avgSpot = prices.reduce((sum, row) => sum + row.spotPrice, 0) / prices.length
    const avgMid = prices.reduce((sum, row) => sum + row.mediumLongPrice, 0) / prices.length
    return [
      { label: '现货均价', value: Number(avgSpot.toFixed(4)), unit: '元/kWh', tone: 'orange' },
      { label: '中长期均价', value: Number(avgMid.toFixed(4)), unit: '元/kWh', tone: 'blue' },
      { label: '平均价差', value: Number((avgSpot - avgMid).toFixed(4)), unit: '元/kWh', tone: 'green' },
      { label: '零售均价', value: Number((prices.reduce((sum, row) => sum + row.retailPrice, 0) / prices.length).toFixed(4)), unit: '元/kWh', tone: 'purple' }
    ]
  }
  return dataset.value.overviewMetrics
})

const categoryRows = computed<CategoryRow[]>(() => {
  if (activeTab.value === 'overview') {
    return dataset.value.tradeSummary.map((row) => ({
      name: row.tradeType,
      quantity: row.quantity,
      avgPrice: row.avgPrice,
      count: row.tradeCount,
      percentage: row.percentage
    }))
  }
  if (activeTab.value === 'generation') return dataset.value.powerTypes
  if (activeTab.value === 'sales') return dataset.value.salesCompanies
  if (activeTab.value === 'storage') return dataset.value.storageProjects
  if (activeTab.value === 'packages') {
    return dataset.value.retailPackages.map((row) => ({
      name: row.companyName,
      quantity: row.volume,
      avgPrice: row.flatPrice,
      count: 1,
      percentage: 0
    }))
  }
  return dataset.value.priceTrend.map((row) => ({
    name: row.month,
    quantity: row.deviation,
    avgPrice: row.spotPrice,
    count: 1,
    percentage: 0
  }))
})

// 异步取数：fetchCaptured 真实回放（链路 A）；无真实数据不展示 synthetic 口径，只给用户提示。
async function refreshData() {
  loading.value = true
  errorMsg.value = ''
  try {
    const result = await loadMarketAnalysis(selectedYear.value)
    dataset.value = result.dataset
    basis.value = result.basis
    hasRealData.value = result.hasRealData
    publicDataReal.value = result.publicDataReal
    retailPackagesReal.value = result.retailPackagesReal
    retailPackagesPartialReal.value = result.retailPackagesPartialReal
    retailPackageDetailsReal.value = result.retailPackageDetailsReal
    retailPackageMetricsReal.value = result.retailPackageMetricsReal
    retailPackagesAccessDenied.value = result.retailPackagesAccessDenied
    if (!result.hasRealData) {
      errorMsg.value = '未检测到 market-analysis 真实落盘，当前仅显示占位示例'
    }
  } catch (e) {
    errorMsg.value = `${e instanceof Error ? e.message : '加载失败'}（已回退占位示例，非真实数据）`
    dataset.value = getMarketAnalysis(selectedYear.value)
    basis.value = null
    hasRealData.value = false
    publicDataReal.value = false
    retailPackagesReal.value = false
    retailPackagesPartialReal.value = false
    retailPackageDetailsReal.value = false
    retailPackageMetricsReal.value = false
    retailPackagesAccessDenied.value = false
  } finally {
    loading.value = false
    nextTick(renderCharts)
  }
}

function renderCategoryChart() {
  if (!categoryChartRef.value) return
  categoryChart.setOption({
    ...emptyOverlay(!categoryRows.value.length),
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '构成',
        type: 'pie',
        radius: ['42%', '70%'],
        center: ['50%', '45%'],
        data: categoryRows.value.map((row) => ({ name: row.name, value: Math.abs(row.quantity) })),
        itemStyle: { borderColor: '#fff', borderWidth: 2 }
      }
    ]
  }, { notMerge: true })
}

function renderTrendChart() {
  if (!trendChartRef.value) return

  if (activeTab.value === 'price') {
    const rows = dataset.value.priceTrend
    trendChart.setOption({
      ...emptyOverlay(!rows.length),
      grid: { left: 52, right: 26, top: 48, bottom: 42 },
      tooltip: axisTooltip({ unit: '元/kWh', digits: 4 }),
      toolbox: { ...chartToolbox('价格曲线'), top: 26 },
      legend: { top: 0, left: 12, right: 100, type: 'scroll' },
      xAxis: { type: 'category', data: rows.map((row) => row.month) },
      yAxis: { type: 'value', name: '元/kWh', splitLine: { lineStyle: { color: '#e6edf3' } } },
      series: [
        { name: '中长期', type: 'line', smooth: false, data: rows.map((row) => row.mediumLongPrice) },
        { name: '现货', type: 'line', smooth: false, data: rows.map((row) => row.spotPrice) },
        { name: '零售', type: 'line', smooth: false, data: rows.map((row) => row.retailPrice) }
      ]
    }, { notMerge: true })
    return
  }

  const rows = dataset.value.monthlyTrend
  trendChart.setOption({
    ...emptyOverlay(!rows.length),
    // 底部布局:图例顶部居中 + 工具栏底部右下角,top/bottom 56 各让一行
    grid: { left: 52, right: 26, top: 56, bottom: 56 },
    tooltip: axisTooltip({
      units: { 中长期: '亿kWh', 现货: '亿kWh', 辅助服务: '亿kWh', 均价: '元/kWh' },
      pointer: 'shadow'
    }),
    toolbox: bottomToolbox('月度趋势', 26),
    legend: bottomLayoutLegend(),
    xAxis: { type: 'category', data: rows.map((row) => row.month) },
    yAxis: [
      { type: 'value', name: '亿kWh', splitLine: { lineStyle: { color: '#e6edf3' } } },
      { type: 'value', name: '元/kWh' }
    ],
    series: [
      { name: '中长期', type: 'bar', stack: 'volume', data: rows.map((row) => row.mediumLong), itemStyle: { color: '#2563eb' } },
      { name: '现货', type: 'bar', stack: 'volume', data: rows.map((row) => row.spot), itemStyle: { color: '#0f766e' } },
      { name: '辅助服务', type: 'bar', stack: 'volume', data: rows.map((row) => row.ancillary), itemStyle: { color: '#ea580c' } },
      { name: '均价', type: 'line', yAxisIndex: 1, smooth: false, data: rows.map((row) => row.avgPrice), lineStyle: { color: '#7c3aed', width: 3 } }
    ]
  }, { notMerge: true })
}

function renderCharts() {
  renderCategoryChart()
  renderTrendChart()
}

// 当前页签明细一键导出 CSV
function exportDetail() {
  const label = tabs.find((tab) => tab.value === activeTab.value)?.label ?? '明细'
  const name = `市场经营分析_${label}_${selectedYear.value}`
  if (activeTab.value === 'packages') {
    exportCsv(name, ['售电公司', '用户', '套餐', '状态', '平段价', '峰段价', '谷段价', '电量(亿kWh)'],
      dataset.value.retailPackages.map((row) => [row.companyName, row.userName, row.packageType, row.status, row.flatPrice, row.peakPrice, row.valleyPrice, row.volume]))
    return
  }
  if (activeTab.value === 'price') {
    exportCsv(name, ['月份', '中长期价', '现货价', '零售价', '现货-中长期'],
      dataset.value.priceTrend.map((row) => [row.month, row.mediumLongPrice, row.spotPrice, row.retailPrice, row.deviation]))
    return
  }
  exportCsv(name, ['对象', '交易电量(亿kWh)', '均价(元/kWh)', '笔数/主体', '占比(%)'],
    categoryRows.value.map((row) => [row.name, row.quantity, row.avgPrice, row.count, row.percentage]))
}

// 年份变 → 重新取数；页签变 → 仅重绘（数据已含全部 tab）。
watch(selectedYear, refreshData)
watch(activeTab, () => nextTick(renderCharts))

const { askPage, registerPageInsight } = usePageInsight(PAGE_PROMPT_KEYS.marketOperations)
function askInsight() {
  const tabLabel = tabs.find((t) => t.value === activeTab.value)?.label ?? activeTab.value
  // #669：套餐 tab 用 visibleBasis（套餐真实性单独判定），其余 tab 用页面级 basis。
  const displayedBasis = visibleBasis.value ?? 'synthetic'
  askPage('市场经营分析', {
    page: '市场经营分析 (market-ops)',
    year: selectedYear.value,
    active_tab: tabLabel,
    metrics: metrics.value.map((m) => ({ label: m.label, value: m.value, unit: m.unit })),
    top_categories: categoryRows.value.slice(0, 10).map((r) => ({ name: r.name, quantity: r.quantity, avgPrice: r.avgPrice, percentage: r.percentage })),
    basis: displayedBasis,
    caliber_note: displayedBasis === 'captured' ? '真实回放数据' : '当前为占位示例，仅供页面形态'
  }, `请基于本页「市场经营分析·${tabLabel}」做经营结构与趋势解读（数据已在上下文，注意 basis=${displayedBasis} 口径，勿臆造未取项）`)
}

// 右下角悬浮球 = 本页解读入口：与上面「✨ 解读本页」按钮同一条链路、同一份切片。
registerPageInsight(askInsight, '市场经营分析')

onMounted(refreshData)
</script>

<template>
  <div class="page-stack market-ops">
    <RegionDataBanner />
    <section class="metric-grid">
      <article v-for="metric in metrics" :key="metric.label" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ metric.value }} <small>{{ metric.unit }}</small></strong>
        <em :class="metric.tone">{{ selectedYear }}</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>市场经营分析</h2>
        <span>市场概览、发电侧、售电侧、储能、套餐和价格趋势迁移版</span>
      </div>
      <div class="toolbar market-toolbar">
        <el-select v-model="selectedYear" style="width: 140px">
          <el-option label="2026年" :value="2026" />
          <el-option label="2027年" :value="2027" />
          <el-option label="2028年" :value="2028" />
        </el-select>
        <el-radio-group v-model="activeTab">
          <el-radio-button v-for="tab in tabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}
          </el-radio-button>
        </el-radio-group>
        <DataBasisBadge v-if="visibleBasis" :basis="visibleBasis" :prefix="loading ? '加载中' : undefined" />
        <el-button size="small" type="success" plain @click="askInsight">✨ 解读本页</el-button>
      </div>
    </section>

  <p v-if="errorMsg" class="load-error">⚠ {{ errorMsg }}</p>

    <section class="chart-grid">
      <article class="panel">
        <div class="panel-title compact">
          <h2>结构分布</h2>
          <span>电量口径</span>
        </div>
        <div ref="categoryChartRef" class="chart chart-host"></div>
      </article>
      <article class="panel">
        <div class="panel-title compact">
          <h2>{{ activeTab === 'price' ? '价格曲线' : '月度趋势' }}</h2>
          <span>{{ activeTab === 'price' ? '元/kWh' : '亿kWh / 元/kWh' }}</span>
        </div>
        <div ref="trendChartRef" class="chart chart-host"></div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title compact detail-title">
        <h2>明细</h2>
        <span>{{ tabs.find((tab) => tab.value === activeTab)?.label }}</span>
        <el-button class="export-btn" size="small" @click="exportDetail">导出CSV</el-button>
      </div>

      <p v-if="packagesNotice" class="packages-notice">🔒 {{ packagesNotice }}</p>

      <el-table v-if="activeTab !== 'packages' && activeTab !== 'price'" :data="categoryRows" size="small" v-loading="loading">
        <el-table-column prop="name" label="对象" min-width="180" />
        <el-table-column prop="quantity" label="交易电量(亿kWh)" width="160" align="right" sortable />
        <el-table-column prop="avgPrice" label="均价(元/kWh)" width="140" align="right" sortable />
        <el-table-column prop="count" label="笔数/主体" width="120" align="right" sortable />
        <el-table-column prop="percentage" label="占比(%)" width="110" align="right" sortable />
      </el-table>

      <el-table v-else-if="activeTab === 'packages'" :data="dataset.retailPackages" size="small" v-loading="loading">
        <el-table-column prop="companyName" label="售电公司" min-width="140" />
        <el-table-column prop="userName" label="用户" min-width="140" />
        <el-table-column prop="packageType" label="套餐" min-width="140" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="flatPrice" label="平段价" width="110" align="right" sortable />
        <el-table-column prop="peakPrice" label="峰段价" width="110" align="right" sortable />
        <el-table-column prop="valleyPrice" label="谷段价" width="110" align="right" sortable />
        <el-table-column prop="volume" label="电量(亿kWh)" width="130" align="right" sortable />
      </el-table>

      <el-table v-else :data="dataset.priceTrend" size="small" v-loading="loading">
        <el-table-column prop="month" label="月份" width="90" sortable />
        <el-table-column prop="mediumLongPrice" label="中长期价" width="130" align="right" sortable />
        <el-table-column prop="spotPrice" label="现货价" width="120" align="right" sortable />
        <el-table-column prop="retailPrice" label="零售价" width="120" align="right" sortable />
        <el-table-column prop="deviation" label="现货-中长期" width="150" align="right" sortable />
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.market-ops {
  gap: 18px;
}

.market-toolbar {
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.chart-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chart {
  height: 340px;
  width: 100%;
}

.panel-title.compact {
  margin-bottom: 12px;
}

.detail-title .export-btn {
  margin-left: auto;
}

.load-error {
  margin: 0;
  padding: 8px 12px;
  color: #b91c1c;
  background: #fef2f2;
  border-radius: 6px;
  font-size: var(--font-md);
}

.packages-notice {
  margin: 0 0 12px;
  padding: 8px 12px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  font-size: var(--font-md);
}

/* 断点对齐 responsive.css 规约（1024 桌面紧凑 / 768 移动端纵排） */
@media (max-width: 1024px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }

  .market-toolbar :deep(.el-radio-group) {
    max-width: 100%;
    overflow-x: auto;
  }
}

@media (max-width: 768px) {
  .market-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
