<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  calculateWindSolarInvestment,
  getWindSolarDefaultForm,
  runWindSolarSensitivityAnalysis,
  type WindSolarCalcMode,
  type WindSolarForm,
  type WindSolarProjectType,
  type WindSolarResult,
  type WindSolarSensitivityResult
} from '@/services/forecast/windSolar'

type NumericField = {
  [K in keyof WindSolarForm]: WindSolarForm[K] extends number ? K : never
}[keyof WindSolarForm]

type FieldConfig = {
  key: NumericField
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}

const form = reactive<WindSolarForm>(getWindSolarDefaultForm('solar'))
const mode = ref<WindSolarCalcMode>('irr_to_lcoe')
const result = ref<WindSolarResult | null>(null)
const sensitivity = ref<WindSolarSensitivityResult | null>(null)
const loading = ref(false)
const sensitivityLoading = ref(false)
const cashFlowChartRef = ref<HTMLDivElement | null>(null)
const sensitivityChartRef = ref<HTMLDivElement | null>(null)
// 统一 ECharts 生命周期:容器自适应、主题切换重建后自动回调 render 恢复内容
const cashFlowChart = useEChart(cashFlowChartRef, { render: renderCashFlowChart })
const sensitivityChart = useEChart(sensitivityChartRef, { render: renderSensitivityChart })

const fields: Array<{ title: string; items: FieldConfig[] }> = [
  {
    title: '技术出力',
    items: [
      { key: 'capacity_mw', label: '装机容量', unit: 'MW', min: 1, max: 10000, step: 10 },
      { key: 'hours_per_year', label: '等效满发小时', unit: 'h', min: 1000, max: 5000, step: 50 },
      { key: 'curtailment_rate', label: '弃风弃光率', unit: '%', min: 0, max: 50, step: 0.5 },
      { key: 'first_year_degradation', label: '首年衰减', unit: '%', min: 0, max: 10, step: 0.1 },
      { key: 'degradation_rate', label: '年衰减率', unit: '%/年', min: 0, max: 5, step: 0.05 }
    ]
  },
  {
    title: '投资成本',
    items: [
      { key: 'investment_per_mw', label: '单位投资', unit: '万元/MW', min: 0, step: 10 },
      { key: 'om_cost_per_mw', label: '运维成本', unit: '万元/MW/年', min: 0, step: 0.5 },
      { key: 'om_growth_rate', label: '运维增长率', unit: '%', min: 0, max: 10, step: 0.5 },
      { key: 'project_life', label: '项目寿命', unit: '年', min: 10, max: 30 },
      { key: 'salvage_rate', label: '残值率', unit: '%', min: 0, max: 50 },
      { key: 'depreciation_years', label: '折旧年限', unit: '年', min: 5, max: 30 }
    ]
  },
  {
    title: '融资税费',
    items: [
      { key: 'loan_ratio', label: '贷款比例', unit: '%', min: 0, max: 90, step: 5 },
      { key: 'loan_interest_rate', label: '贷款利率', unit: '%', min: 0, max: 15, step: 0.25 },
      { key: 'loan_term', label: '贷款年限', unit: '年', min: 1, max: 30 },
      { key: 'discount_rate', label: '折现率', unit: '%', min: 0, max: 20, step: 0.5 },
      { key: 'tax_rate', label: '所得税率', unit: '%', min: 0, max: 50, step: 5 },
      { key: 'vat_rate', label: '增值税率', unit: '%', min: 0, max: 20 },
      { key: 'vat_refund_rate', label: '即征即退', unit: '%', min: 0, max: 100, step: 5 }
    ]
  },
  {
    title: '收益目标',
    items: [
      { key: 'target_equity_irr', label: '目标IRR', unit: '%', min: 0, max: 50, step: 0.5 },
      { key: 'lcoe', label: '指定LCOE', unit: '元/kWh', min: 0, max: 2, step: 0.01 }
    ]
  }
]

const projectLabel = computed(() => form.project_type === 'wind' ? '风电' : '光伏')
const sensitivityRows = computed(() => {
  if (!sensitivity.value) return []
  return Object.entries(sensitivity.value.sensitivity_results).map(([name, item]) => {
    // values 中 null 表示该扰动点无解（图表断点），统计极值时剔除
    const finiteValues = item.values.filter((value): value is number => Number.isFinite(value))
    return {
      name,
      base: item.base_value,
      min: finiteValues.length ? Math.min(...finiteValues) : null,
      max: finiteValues.length ? Math.max(...finiteValues) : null,
      sensitivity: item.sensitivity
    }
  })
})
// 无解语义展示（E5）：LCOE 未收敛 →「未收敛」、IRR 无解 →「无解」、项目期内未回本 →「未回收」
const lcoeText = computed(() => {
  if (!result.value) return '0'
  return result.value.lcoe_converged ? String(result.value.lcoe) : '未收敛'
})
const irrText = computed(() => {
  if (!result.value) return '0'
  return Number.isFinite(result.value.actual_equity_irr) ? String(result.value.actual_equity_irr) : '无解'
})
const paybackText = computed(() => {
  if (!result.value) return '0 年'
  return result.value.payback_reached ? `${result.value.payback_period} 年` : '未回收'
})

function numericValue(key: NumericField) {
  return Number(form[key]) || 0
}

function setNumber(key: NumericField, value: number | undefined) {
  ;(form as unknown as Record<NumericField, number>)[key] = Number(value ?? 0)
}

function switchProjectType(type: WindSolarProjectType) {
  Object.assign(form, getWindSolarDefaultForm(type))
  runCalculation()
  ElMessage.success(`${type === 'wind' ? '风电' : '光伏'}默认参数已加载`)
}

// C5/C7 边界校验：折旧年限、贷款年限不得超过项目寿命，超出时提示并 clamp
function clampLifeBoundaries() {
  if (form.depreciation_years > form.project_life) {
    ElMessage.warning(`折旧年限不能超过项目寿命，已调整为 ${form.project_life} 年`)
    form.depreciation_years = form.project_life
  }
  if (form.loan_term > form.project_life) {
    ElMessage.warning(`贷款年限不能超过项目寿命，已调整为 ${form.project_life} 年`)
    form.loan_term = form.project_life
  }
}

function runCalculation() {
  loading.value = true
  try {
    clampLifeBoundaries()
    result.value = calculateWindSolarInvestment({ ...form }, mode.value)
    // LCOE 未收敛时为 NaN，不回填表单
    if (mode.value === 'irr_to_lcoe' && Number.isFinite(result.value.lcoe) && result.value.lcoe > 0) form.lcoe = result.value.lcoe
    nextTick(renderCharts)
  } finally {
    loading.value = false
  }
}

function runSensitivity() {
  sensitivityLoading.value = true
  try {
    sensitivity.value = runWindSolarSensitivityAnalysis({ ...form }, mode.value)
    nextTick(renderSensitivityChart)
    ElMessage.success('敏感性分析完成')
  } finally {
    sensitivityLoading.value = false
  }
}

function renderCharts() {
  renderCashFlowChart()
  renderSensitivityChart()
}

function renderCashFlowChart() {
  if (!result.value) return
  const rows = result.value.cash_flow_schedule
  cashFlowChart.setOption({
    grid: { left: 48, right: 24, top: 28, bottom: 38 },
    tooltip: axisTooltip({ unit: '万元' }),
    legend: { top: 0 },
    toolbox: chartToolbox('现金流曲线'),
    xAxis: { type: 'category', data: rows.map((row) => `第${row.year}年`) },
    yAxis: { type: 'value', name: '万元', splitLine: { lineStyle: { color: '#e6edf3' } } },
    series: [
      { name: '净现金流', type: 'bar', data: rows.map((row) => row.net_cash_flow), itemStyle: { color: '#0f766e' } },
      { name: '累计现金流', type: 'line', smooth: false, data: rows.map((row) => row.cumulative_cash_flow), lineStyle: { color: '#2563eb', width: 3 } }
    ]
  })
}

function renderSensitivityChart() {
  if (!sensitivity.value) return
  const entries = Object.entries(sensitivity.value.sensitivity_results)
  sensitivityChart.setOption({
    grid: { left: 48, right: 20, top: 28, bottom: 70 },
    // 目标指标为 IRR 时单位 %,为 LCOE 时单位 元/kWh
    tooltip: axisTooltip({ unit: sensitivity.value.target_param === 'IRR' ? '%' : '元/kWh', digits: 4 }),
    legend: { bottom: 0, type: 'scroll' },
    toolbox: chartToolbox('敏感性分析'),
    xAxis: { type: 'category', data: entries[0]?.[1].changes.map((change) => `${change}%`) ?? [] },
    yAxis: { type: 'value', name: sensitivity.value.target_param },
    series: entries.map(([name, item]) => ({ name, type: 'line', smooth: false, data: item.values }))
  })
}

// 现金流明细一键导出 CSV
function exportCashFlow() {
  const rows = result.value?.cash_flow_schedule ?? []
  if (!rows.length) { ElMessage.warning('暂无现金流数据'); return }
  exportCsv(
    `${projectLabel.value}投资现金流`,
    ['年份', '收入', '运维', '折旧', '还本', '利息', '所得税', '净现金流', '累计现金流'],
    rows.map((row) => [row.year, row.revenue, row.om_cost, row.depreciation, row.loan_principal, row.loan_interest, row.income_tax, row.net_cash_flow, row.cumulative_cash_flow])
  )
}

onMounted(runCalculation)
</script>

<template>
  <div class="page-stack windsolar-workbench">
    <section class="metric-grid">
      <article class="metric-card">
        <span>{{ projectLabel }}总投资</span>
        <strong>{{ result?.total_investment ?? 0 }} <small>万元</small></strong>
        <em class="blue">资本金 {{ result?.equity_investment ?? 0 }} 万元</em>
      </article>
      <article class="metric-card">
        <span>LCOE</span>
        <strong>{{ lcoeText }} <small v-if="result?.lcoe_converged !== false">元/kWh</small></strong>
        <em class="green">{{ mode === 'irr_to_lcoe' ? '由目标IRR反算' : '用户给定' }}</em>
      </article>
      <article class="metric-card">
        <span>资本金IRR</span>
        <strong>{{ irrText }} <small v-if="result && Number.isFinite(result.actual_equity_irr)">%</small></strong>
        <em class="orange">目标 {{ form.target_equity_irr }}%</em>
      </article>
      <article class="metric-card">
        <span>年发电量</span>
        <strong>{{ result?.annual_generation ?? 0 }} <small>万kWh</small></strong>
        <em class="green">年收入 {{ result && Number.isFinite(result.annual_revenue) ? `${result.annual_revenue} 万元` : '无解' }}</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>新能源资产测算</h2>
        <span>风电/光伏 LCOE、IRR、融资、折旧、税费、现金流迁移版</span>
      </div>
      <div class="toolbar windsolar-toolbar">
        <el-radio-group :model-value="form.project_type" @update:model-value="switchProjectType($event as WindSolarProjectType)">
          <el-radio-button value="solar">光伏</el-radio-button>
          <el-radio-button value="wind">风电</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="mode">
          <el-radio-button value="irr_to_lcoe">目标IRR算LCOE</el-radio-button>
          <el-radio-button value="lcoe_to_irr">指定LCOE算IRR</el-radio-button>
        </el-radio-group>
        <el-checkbox v-model="form.is_three_free_half">三免三减半</el-checkbox>
        <el-button type="primary" :loading="loading" @click="runCalculation">重新计算</el-button>
        <el-button :loading="sensitivityLoading" @click="runSensitivity">敏感性分析</el-button>
        <span class="toolbar-note">回收期 {{ paybackText }}</span>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>项目参数</h2>
          <span>{{ projectLabel }}</span>
        </div>
        <div class="windsolar-section" v-for="section in fields" :key="section.title">
          <h3>{{ section.title }}</h3>
          <div class="windsolar-form-grid">
            <label v-for="field in section.items" :key="field.key">
              <span>{{ field.label }}<small>{{ field.unit }}</small></span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>现金流曲线</h2>
          <span>NPV {{ result && Number.isFinite(result.npv_value) ? `${result.npv_value} 万元` : '无解' }}</span>
        </div>
        <div ref="cashFlowChartRef" class="chart windsolar-chart chart-host"></div>
        <div class="asset-strip">
          <article>
            <span>单位投资</span>
            <strong>{{ form.investment_per_mw }} 万元/MW</strong>
          </article>
          <article>
            <span>利用小时</span>
            <strong>{{ form.hours_per_year }} h</strong>
          </article>
          <article>
            <span>弃电率</span>
            <strong>{{ form.curtailment_rate }}%</strong>
          </article>
        </div>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>现金流明细</h2>
          <span>{{ form.project_life }} 年</span>
          <el-button size="small" @click="exportCashFlow">导出CSV</el-button>
        </div>
        <el-table :data="result?.cash_flow_schedule ?? []" border height="430">
          <el-table-column prop="year" label="年份" width="80" fixed="left" sortable />
          <el-table-column prop="revenue" label="收入" width="100" sortable />
          <el-table-column prop="om_cost" label="运维" width="90" sortable />
          <el-table-column prop="depreciation" label="折旧" width="90" sortable />
          <el-table-column prop="loan_principal" label="还本" width="90" sortable />
          <el-table-column prop="loan_interest" label="利息" width="90" sortable />
          <el-table-column prop="income_tax" label="所得税" width="100" sortable />
          <el-table-column prop="net_cash_flow" label="净现金流" width="120" sortable />
          <el-table-column prop="cumulative_cash_flow" label="累计现金流" min-width="130" sortable />
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>敏感性分析</h2>
          <span>{{ sensitivity?.target_param ?? 'LCOE' }}</span>
        </div>
        <div ref="sensitivityChartRef" class="chart windsolar-chart chart-host"></div>
        <el-table :data="sensitivityRows" border>
          <el-table-column prop="name" label="参数" min-width="110" />
          <el-table-column prop="base" label="基准值" width="100" sortable />
          <el-table-column prop="min" label="低位" width="95" sortable />
          <el-table-column prop="max" label="高位" width="95" sortable />
          <el-table-column prop="sensitivity" label="敏感度" width="100" sortable />
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.windsolar-toolbar .el-radio-group {
  flex: 0 0 auto;
}

.windsolar-section + .windsolar-section {
  margin-top: 14px;
}

.windsolar-section h3 {
  margin: 0 0 10px;
  font-size: var(--font-lg);
}

.windsolar-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.windsolar-form-grid label {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.windsolar-form-grid span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-body);
  font-size: var(--font-sm);
}

.windsolar-form-grid small {
  color: var(--muted);
  font-size: var(--font-sm);
}

.windsolar-form-grid :deep(.el-input-number) {
  width: 100%;
}

.windsolar-chart {
  height: 360px;
}

.asset-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.asset-strip article {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.asset-strip span {
  display: block;
  color: var(--muted);
  font-size: var(--font-sm);
}

.asset-strip strong {
  display: block;
  margin-top: 6px;
  font-size: var(--font-18);
  overflow-wrap: anywhere;
}

@media (max-width: 1024px) {
  .windsolar-form-grid,
  .asset-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .windsolar-toolbar .el-radio-group,
  .windsolar-toolbar :deep(.el-radio-button),
  .windsolar-toolbar :deep(.el-radio-button__inner) {
    width: 100%;
  }

  .windsolar-form-grid,
  .asset-strip {
    grid-template-columns: 1fr;
  }

  .windsolar-chart {
    height: 280px;
  }
}

@media (max-width: 480px) {
  .windsolar-form-grid { grid-template-columns: 1fr; }
}
</style>
