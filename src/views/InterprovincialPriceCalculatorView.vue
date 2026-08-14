<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useEChart } from '../composables/useEChart'
import { useQuerySync } from '../composables/useQuerySync'
import { axisTooltip, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  calculateToEndUser,
  calculateToSource,
  getDefaultInterprovincialForm,
  type InterprovincialMode,
  type InterprovincialPriceForm,
  type InterprovincialPriceResult
} from '@/services/market/interprovincialPrice'

type NumericField = {
  [K in keyof InterprovincialPriceForm]: InterprovincialPriceForm[K] extends number ? K : never
}[keyof InterprovincialPriceForm]

type FieldConfig = {
  key: NumericField
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}

const form = reactive<InterprovincialPriceForm>(getDefaultInterprovincialForm())
const mode = ref<InterprovincialMode>('toEndUser')
// 计算方向 ⇄ 路由 query:刷新/分享后停留在同一计算模式(字符串联合类型按 string 同步后校验)
useQuerySync({ mode: mode as unknown as Ref<string> })
if (mode.value !== 'toEndUser' && mode.value !== 'toSource') mode.value = 'toEndUser'
const result = ref<InterprovincialPriceResult | null>(null)
const loading = ref(false)
const breakdownChartRef = ref<HTMLDivElement | null>(null)
const annualChartRef = ref<HTMLDivElement | null>(null)
// 统一 ECharts 生命周期:容器自适应、主题切换重建后自动回调 render 恢复内容
const breakdownChart = useEChart(breakdownChartRef, { render: renderBreakdownChart })
const annualChart = useEChart(annualChartRef, { render: renderAnnualChart })

const fields: Array<{ title: string; items: FieldConfig[] }> = [
  {
    title: '交易价格',
    items: [
      { key: 'grid_price', label: '送端上网价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'landing_price', label: '目标落地价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'annual_energy', label: '年电量', unit: '万kWh', min: 0, step: 1000 },
      // 量纲口径：年利用小时 = 年电量(万kWh) / 输电容量(万kW)
      { key: 'transmission_capacity', label: '输电容量', unit: '万kW', min: 0, step: 10 }
    ]
  },
  {
    title: '通道电价',
    items: [
      { key: 'source_province_td_price', label: '送端输配', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'region_energy_price', label: '区域电网', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'special_project_price', label: '专项工程1', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'special_project_price2', label: '专项工程2', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'target_region_energy_price', label: '受端区域', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'target_province_td_price', label: '受端输配', unit: '元/kWh', min: 0, step: 0.001 }
    ]
  },
  {
    title: '线损费用',
    items: [
      { key: 'source_loss_rate', label: '送端线损', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'project_loss_rate', label: '专项1线损', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'project_loss_rate2', label: '专项2线损', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'target_loss_rate', label: '受端线损', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'system_fee', label: '系统运行费', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'government_fee', label: '政府基金', unit: '元/kWh', min: 0, step: 0.001 }
    ]
  }
]

const annualRows = computed(() => result.value?.annual_detail ?? [])

function numberValue(key: NumericField) {
  return Number(form[key]) || 0
}

function setNumber(key: NumericField, value: number | undefined) {
  ;(form as unknown as Record<NumericField, number>)[key] = Number(value ?? 0)
}

function runCalculation() {
  loading.value = true
  try {
    result.value = mode.value === 'toEndUser' ? calculateToEndUser({ ...form }) : calculateToSource({ ...form })
    // 入口校验失败/反推无解时服务层返回显式 error（不静默钳位），此时不回填表单
    if (result.value.error) {
      ElMessage.error(result.value.error)
      return
    }
    if (result.value.warning) ElMessage.warning(result.value.warning)
    if (mode.value === 'toSource' && result.value.grid_price > 0) form.grid_price = result.value.grid_price
    if (mode.value === 'toEndUser' && result.value.landing_price > 0) form.landing_price = result.value.landing_price
    nextTick(renderCharts)
  } finally {
    loading.value = false
  }
}

function renderCharts() {
  renderBreakdownChart()
  renderAnnualChart()
}

function renderBreakdownChart() {
  if (!breakdownChartRef.value || !result.value) return
  breakdownChart.setOption({
    grid: { left: 46, right: 18, top: 24, bottom: 72 },
    tooltip: axisTooltip({ unit: '元/kWh', digits: 4 }),
    toolbox: chartToolbox('跨省跨区价格路径'),
    legend: { top: 0, right: 100 },
    ...emptyOverlay(!result.value.breakdown.length),
    xAxis: { type: 'category', data: result.value.breakdown.map((row) => row.item), axisLabel: { rotate: 35, interval: 0 } },
    yAxis: { type: 'value', name: '元/kWh' },
    series: [
      { name: '本步单价', type: 'bar', data: result.value.breakdown.map((row) => row.unit_price), itemStyle: { color: '#0f766e' } },
      { name: '累计价', type: 'line', data: result.value.breakdown.map((row) => row.accumulated), lineStyle: { color: '#2563eb', width: 3 } }
    ]
  })
}

function renderAnnualChart() {
  if (!annualChartRef.value || !result.value) return
  annualChart.setOption({
    grid: { left: 54, right: 18, top: 24, bottom: 68 },
    tooltip: axisTooltip({ unit: '万元', pointer: 'shadow' }),
    toolbox: chartToolbox('年度费用分布'),
    ...emptyOverlay(!annualRows.value.length),
    xAxis: { type: 'category', data: annualRows.value.map((row) => row.item), axisLabel: { rotate: 35, interval: 0 } },
    yAxis: { type: 'value', name: '万元' },
    series: [{ name: '年度金额', type: 'bar', data: annualRows.value.map((row) => row.amount), itemStyle: { color: '#d97706' } }]
  })
}

function exportBreakdown() {
  if (!result.value) return
  exportCsv(
    `跨省跨区电价路径-${form.source_province}到${form.target_province}-${new Date().toISOString().slice(0, 10)}`,
    ['步', '项目', '说明', '本步单价(元/kWh)', '累计价(元/kWh)'],
    result.value.breakdown.map((row) => [row.step, row.item, row.description, row.unit_price, row.accumulated])
  )
}

onMounted(() => {
  runCalculation()
})
</script>

<template>
  <div class="page-stack interprovincial-price-workbench">
    <el-alert v-if="result?.error" type="error" :closable="false" show-icon :title="result.error" />
    <el-alert v-else-if="result?.warning" type="warning" :closable="false" show-icon :title="result.warning" />
    <section class="metric-grid">
      <article class="metric-card">
        <span>送端上网价</span>
        <strong>{{ result?.grid_price ?? 0 }} <small>元/kWh</small></strong>
        <em class="blue">{{ form.source_province }} {{ form.power_type }}</em>
      </article>
      <article class="metric-card">
        <span>落地电价</span>
        <strong>{{ result?.landing_price ?? 0 }} <small>元/kWh</small></strong>
        <em class="green">{{ form.target_province }}</em>
      </article>
      <article class="metric-card">
        <span>年费用</span>
        <strong>{{ result?.annual_fee ?? 0 }} <small>万元</small></strong>
        <em class="orange">{{ form.annual_energy }} 万kWh</em>
      </article>
      <article class="metric-card">
        <span>综合线损</span>
        <strong>{{ result?.total_loss_rate ?? 0 }} <small>%</small></strong>
        <em class="green">利用小时 {{ result?.annual_hours ?? 0 }}</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>跨省跨区电价测算</h2>
        <span>上网价到落地价、落地价反推上网价迁移版</span>
      </div>
      <div class="toolbar interprovincial-toolbar">
        <el-radio-group v-model="mode" @change="runCalculation">
          <el-radio-button value="toEndUser">上网价算落地价</el-radio-button>
          <el-radio-button value="toSource">落地价反推上网价</el-radio-button>
        </el-radio-group>
        <el-input v-model="form.source_province" placeholder="送端省份" />
        <el-input v-model="form.target_province" placeholder="受端省份" />
        <el-input v-model="form.power_type" placeholder="电源类型" />
        <el-button type="primary" :loading="loading" @click="runCalculation">重新计算</el-button>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>参数</h2>
          <span>{{ mode === 'toEndUser' ? '正向计算' : '反向计算' }}</span>
        </div>
        <div class="interprovincial-section" v-for="section in fields" :key="section.title">
          <h3>{{ section.title }}</h3>
          <div class="interprovincial-form-grid">
            <label v-for="field in section.items" :key="field.key">
              <span>{{ field.label }}<small>{{ field.unit }}</small></span>
              <el-input-number
                :model-value="numberValue(field.key)"
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

      <div class="status-stack">
        <div class="panel">
          <div class="panel-title">
            <h2>价格路径</h2>
            <span>累计到落地价</span>
          </div>
          <div ref="breakdownChartRef" class="chart interprovincial-chart chart-host"></div>
        </div>
        <div class="panel">
          <div class="panel-title">
            <h2>年度费用分布</h2>
            <span>万元</span>
          </div>
          <div ref="annualChartRef" class="chart interprovincial-chart chart-host"></div>
        </div>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>路径明细</h2>
          <span>
            {{ result?.breakdown.length ?? 0 }} 步
            <el-button size="small" text type="primary" @click="exportBreakdown">导出CSV</el-button>
          </span>
        </div>
        <el-table :data="result?.breakdown ?? []" border empty-text="先填写参数并计算">
          <el-table-column prop="step" label="步" width="56" />
          <el-table-column prop="item" label="项目" min-width="150" />
          <el-table-column prop="description" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column prop="unit_price" label="本步单价" width="110" sortable />
          <el-table-column prop="accumulated" label="累计价" width="110" sortable />
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>年度明细</h2>
          <span>{{ form.annual_energy }} 万kWh</span>
        </div>
        <el-table :data="annualRows" border empty-text="先填写参数并计算">
          <el-table-column prop="item" label="项目" min-width="150" />
          <el-table-column prop="amount" label="金额(万元)" width="130" sortable />
          <el-table-column label="占比" width="100">
            <template #default="{ row }">{{ (row.ratio * 100).toFixed(2) }}%</template>
          </el-table-column>
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.interprovincial-toolbar .el-radio-group {
  flex: 0 0 auto;
}

.interprovincial-toolbar .el-input {
  max-width: 150px;
}

.interprovincial-section + .interprovincial-section {
  margin-top: 14px;
}

.interprovincial-section h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.interprovincial-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.interprovincial-form-grid label {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.interprovincial-form-grid span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-body);
  font-size: 12px;
}

.interprovincial-form-grid small {
  color: var(--muted);
  font-size: 12px;
}

.interprovincial-form-grid :deep(.el-input-number) {
  width: 100%;
}

.interprovincial-chart {
  height: 310px;
}

@media (max-width: 1080px) {
  .interprovincial-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .interprovincial-toolbar .el-radio-group,
  .interprovincial-toolbar :deep(.el-radio-button),
  .interprovincial-toolbar :deep(.el-radio-button__inner),
  .interprovincial-toolbar .el-input {
    width: 100%;
    max-width: none;
  }

  .interprovincial-form-grid {
    grid-template-columns: 1fr;
  }

  .interprovincial-chart {
    height: 260px;
  }
}
</style>
