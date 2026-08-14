<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  applyTouRatios,
  applyVoltagePrices,
  calculateCommercialPrice,
  calculateStateGridPrice,
  calculateWeightedPurchasePrice,
  calculateYearRatios,
  getDefaultCommercialPriceForm,
  getDefaultStateGridForm,
  inferTouPricesFromWeightedPrice,
  voltageOptions,
  type CommercialPriceForm,
  type CommercialPriceResult,
  type PricingType,
  type StateGridForm,
  type StateGridResult,
  type VoltageLevel
} from '@/services/market/retailPrice'

type CommercialNumericField = {
  [K in keyof CommercialPriceForm]: CommercialPriceForm[K] extends number ? K : never
}[keyof CommercialPriceForm]

type StateGridNumericField = {
  [K in keyof StateGridForm]: StateGridForm[K] extends number ? K : never
}[keyof StateGridForm]

type FieldConfig<T extends string> = {
  key: T
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}

const activeMode = ref<'commercial' | 'state-grid'>('commercial')
const commercialForm = reactive<CommercialPriceForm>(getDefaultCommercialPriceForm())
const stateGridForm = reactive<StateGridForm>(getDefaultStateGridForm())
const commercialResult = ref<CommercialPriceResult | null>(null)
const stateGridResult = ref<StateGridResult | null>(null)
const loading = ref(false)
const activeSection = ref('基础电价')

const breakdownChartRef = ref<HTMLDivElement | null>(null)
const periodChartRef = ref<HTMLDivElement | null>(null)
// 统一 ECharts 生命周期:容器自适应、主题切换重建后自动回调 render 恢复内容
const breakdownChart = useEChart(breakdownChartRef, { render: renderBreakdownChart })
const periodChart = useEChart(periodChartRef, { render: renderPeriodChart })

const commercialSections: Array<{ title: string; fields: Array<FieldConfig<CommercialNumericField>> }> = [
  {
    title: '基础电价',
    fields: [
      { key: 'electricity_amount', label: '用电量', unit: 'kWh', min: 0, step: 1000 },
      { key: 'grid_price', label: '上网电价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'loss_rate', label: '线损率', unit: '%', min: 0, max: 30, step: 0.01 },
      { key: 'td_price', label: '输配电价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'system_fee', label: '系统运行费', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'government_fee', label: '政府基金', unit: '元/kWh', min: 0, step: 0.001 }
    ]
  },
  {
    title: '基本电费',
    fields: [
      { key: 'transformer_capacity', label: '变压器容量', unit: 'kVA', min: 0, step: 100 },
      { key: 'max_demand', label: '最大需量', unit: 'kW', min: 0, step: 100 },
      { key: 'capacity_price', label: '容量电价', unit: '元/kVA·月', min: 0, step: 0.1 },
      { key: 'demand_price', label: '需量电价', unit: '元/kW·月', min: 0, step: 0.1 }
    ]
  },
  {
    title: '分时电价',
    fields: [
      { key: 'selected_month', label: '统计月份', unit: '0为全年', min: 0, max: 12, step: 1 },
      { key: 'weighted_avg_price', label: '加权交易价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'sharp_peak_price', label: '尖峰价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'peak_price', label: '高峰价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'flat_price', label: '平段价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'valley_price', label: '低谷价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'deep_valley_price', label: '深谷价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'sharp_peak_ratio', label: '尖峰占比', unit: '%', min: 0, max: 100, step: 0.01 },
      { key: 'peak_ratio', label: '高峰占比', unit: '%', min: 0, max: 100, step: 0.01 },
      { key: 'flat_ratio', label: '平段占比', unit: '%', min: 0, max: 100, step: 0.01 },
      { key: 'valley_ratio', label: '低谷占比', unit: '%', min: 0, max: 100, step: 0.01 },
      { key: 'deep_valley_ratio', label: '深谷占比', unit: '%', min: 0, max: 100, step: 0.01 }
    ]
  },
  {
    title: '售电套餐',
    fields: [
      { key: 'service_fee', label: '服务费', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'reference_price', label: '参考电价', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'price_down_amount', label: '降价金额', unit: '元/kWh', min: 0, step: 0.001 },
      { key: 'company_share_ratio', label: '分成比例', unit: '%', min: 0, max: 100, step: 1 },
      { key: 'sharp_peak_sale_ratio', label: '尖峰系数', unit: '倍', min: 0, step: 0.01 },
      { key: 'peak_sale_ratio', label: '高峰系数', unit: '倍', min: 0, step: 0.01 },
      { key: 'flat_sale_ratio', label: '平段系数', unit: '倍', min: 0, step: 0.01 },
      { key: 'valley_sale_ratio', label: '低谷系数', unit: '倍', min: 0, step: 0.01 },
      { key: 'deep_valley_sale_ratio', label: '深谷系数', unit: '倍', min: 0, step: 0.01 }
    ]
  }
]

const stateGridFields: Array<FieldConfig<StateGridNumericField>> = [
  { key: 'electricity_amount', label: '用电量', unit: 'kWh', min: 0, step: 1000 },
  { key: 'agency_price', label: '代理购电价', unit: '元/kWh', min: 0, step: 0.001 },
  { key: 'loss_rate', label: '上网环节线损率', unit: '%', min: 0, max: 30, step: 0.1 },
  { key: 'td_price', label: '输配电价', unit: '元/kWh', min: 0, step: 0.001 },
  { key: 'system_fee', label: '系统运行费', unit: '元/kWh', min: 0, step: 0.001 },
  { key: 'government_fee', label: '政府基金', unit: '元/kWh', min: 0, step: 0.001 }
]

const currentResult = computed(() => activeMode.value === 'commercial' ? commercialResult.value : stateGridResult.value)
const breakdownRows = computed(() => currentResult.value?.breakdown ?? [])
const periodRows = computed(() => commercialResult.value?.periods ?? [])
const weightedPurchasePrice = computed(() => calculateWeightedPurchasePrice(commercialForm))
const availableVoltageOptions = computed(() => voltageOptions.filter((option) => option.pricing.includes(commercialForm.pricing_type)))

function commercialNumber(key: CommercialNumericField) {
  return Number(commercialForm[key]) || 0
}

function setCommercialNumber(key: CommercialNumericField, value: number | undefined) {
  ;(commercialForm as unknown as Record<CommercialNumericField, number>)[key] = Number(value ?? 0)
}

function stateGridNumber(key: StateGridNumericField) {
  return Number(stateGridForm[key]) || 0
}

function setStateGridNumber(key: StateGridNumericField, value: number | undefined) {
  ;(stateGridForm as unknown as Record<StateGridNumericField, number>)[key] = Number(value ?? 0)
}

function onPricingTypeChange(type: PricingType) {
  commercialForm.pricing_type = type
  if (type === 'two-part' && commercialForm.voltage_level === 'below_1kv') commercialForm.voltage_level = '1_10kv'
  if (type === 'single' && (commercialForm.voltage_level === '110kv' || commercialForm.voltage_level === '220kv_plus')) commercialForm.voltage_level = '35kv'
  applyVoltagePrices(commercialForm)
  runCalculation()
}

function onVoltageChange(value: VoltageLevel) {
  commercialForm.voltage_level = value
  applyVoltagePrices(commercialForm)
  runCalculation()
}

function applyYearRatios() {
  commercialForm.tou_type = 'sharp_deep'
  commercialForm.selected_month = 0
  applyTouRatios(commercialForm, calculateYearRatios())
  ElMessage.success('全年分时占比已应用')
}

function inferWeightedPrice() {
  commercialForm.known_weighted_price = true
  inferTouPricesFromWeightedPrice(commercialForm)
  ElMessage.success('已由加权交易价反推分时价格')
}

function runCalculation() {
  loading.value = true
  try {
    if (activeMode.value === 'commercial') {
      commercialResult.value = calculateCommercialPrice(commercialForm)
    } else {
      stateGridResult.value = calculateStateGridPrice(stateGridForm)
    }
    nextTick(renderCharts)
  } finally {
    loading.value = false
  }
}

function renderCharts() {
  renderBreakdownChart()
  renderPeriodChart()
}

function renderBreakdownChart() {
  if (!breakdownChartRef.value || !currentResult.value) return
  breakdownChart.setOption({
    grid: { left: 48, right: 20, top: 24, bottom: 64 },
    tooltip: axisTooltip({ unit: '元', pointer: 'shadow' }),
    toolbox: chartToolbox('费用构成'),
    ...emptyOverlay(!breakdownRows.value.length),
    xAxis: { type: 'category', data: breakdownRows.value.map((row) => row.item), axisLabel: { interval: 0, rotate: 30 } },
    yAxis: { type: 'value', name: '元' },
    series: [{ name: '费用', type: 'bar', data: breakdownRows.value.map((row) => row.amount), itemStyle: { color: '#0f766e' } }]
  })
}

function renderPeriodChart() {
  if (!periodChartRef.value || !commercialResult.value || !periodRows.value.length) return
  periodChart.setOption({
    grid: { left: 48, right: 20, top: 28, bottom: 42 },
    tooltip: axisTooltip({ units: { 电量: 'kWh', 单价: '元/kWh' }, digits: 3 }),
    toolbox: chartToolbox('分时电量与单价'),
    legend: { top: 0, right: 100 },
    xAxis: { type: 'category', data: periodRows.value.map((row) => row.period) },
    yAxis: [{ type: 'value', name: 'kWh' }, { type: 'value', name: '元/kWh' }],
    series: [
      { name: '电量', type: 'bar', data: periodRows.value.map((row) => row.amount), itemStyle: { color: '#2563eb' } },
      { name: '单价', type: 'line', yAxisIndex: 1, data: periodRows.value.map((row) => row.unit_price), lineStyle: { color: '#d97706', width: 3 } }
    ]
  })
}

function exportBreakdown() {
  exportCsv(
    `售电电价构成-${activeMode.value === 'commercial' ? '工商业' : '国网代购'}-${new Date().toISOString().slice(0, 10)}`,
    ['项目', '单价', '金额', '占比(%)'],
    // 备注行（如售电公司利润）不参与占比
    breakdownRows.value.map((row) => [row.item, row.unit_price, row.amount, row.note ? '备注' : (row.ratio * 100).toFixed(2)])
  )
}

onMounted(() => {
  runCalculation()
})
</script>

<template>
  <div class="page-stack retail-price-workbench">
    <section class="metric-grid">
      <article class="metric-card">
        <span>到户综合价</span>
        <strong>{{ currentResult?.unit_price ?? 0 }} <small>元/kWh</small></strong>
        <em class="blue">{{ activeMode === 'commercial' ? '工商业' : '国网代购' }}</em>
      </article>
      <article class="metric-card">
        <span>总电费</span>
        <strong>{{ currentResult?.total_fee ?? 0 }} <small>元</small></strong>
        <em class="green">{{ commercialForm.electricity_amount }} kWh</em>
      </article>
      <article class="metric-card">
        <span>售电利润</span>
        <strong>{{ commercialResult?.sales_profit ?? 0 }} <small>元</small></strong>
        <em class="orange">{{ commercialForm.sales_package_type }}</em>
      </article>
      <article class="metric-card">
        <span>加权购电价</span>
        <strong>{{ weightedPurchasePrice.toFixed(4) }} <small>元/kWh</small></strong>
        <em class="green">分时购电成本口径</em>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>售电电价测算</h2>
        <span>省内电价、分时、售电套餐、国网代购逻辑迁移版</span>
      </div>
      <div class="toolbar retail-toolbar">
        <el-radio-group v-model="activeMode" @change="runCalculation">
          <el-radio-button value="commercial">工商业到户价</el-radio-button>
          <el-radio-button value="state-grid">国网代购价</el-radio-button>
        </el-radio-group>
        <template v-if="activeMode === 'commercial'">
          <el-radio-group :model-value="commercialForm.pricing_type" @update:model-value="onPricingTypeChange($event as PricingType)">
            <el-radio-button value="single">单一制</el-radio-button>
            <el-radio-button value="two-part">两部制</el-radio-button>
          </el-radio-group>
          <el-select :model-value="commercialForm.voltage_level" @update:model-value="onVoltageChange($event as VoltageLevel)">
            <el-option v-for="option in availableVoltageOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-checkbox v-model="commercialForm.enable_tou">分时</el-checkbox>
          <el-checkbox v-model="commercialForm.enable_sales_analysis">售电套餐</el-checkbox>
          <el-checkbox v-model="commercialForm.known_weighted_price">已知加权价</el-checkbox>
        </template>
        <el-button type="primary" :loading="loading" @click="runCalculation">重新计算</el-button>
        <el-button v-if="activeMode === 'commercial'" @click="applyYearRatios">全年占比</el-button>
        <el-button v-if="activeMode === 'commercial'" @click="inferWeightedPrice">反推分时价</el-button>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>参数</h2>
          <span>{{ activeMode === 'commercial' ? activeSection : '国网代购' }}</span>
        </div>

        <template v-if="activeMode === 'commercial'">
          <el-tabs v-model="activeSection" class="retail-tabs">
            <el-tab-pane v-for="section in commercialSections" :key="section.title" :label="section.title" :name="section.title">
              <div v-if="section.title === '基础电价'" class="select-grid">
                <label>
                  <span>用电类型</span>
                  <el-select v-model="commercialForm.usage_type">
                    <el-option label="一般工商业" value="general" />
                    <el-option label="电采暖用户" value="electric_heating" />
                  </el-select>
                </label>
                <label>
                  <span>基本电费</span>
                  <el-select v-model="commercialForm.capacity_charge_type">
                    <el-option label="按容量" value="capacity" />
                    <el-option label="按需量" value="demand" />
                  </el-select>
                </label>
              </div>
              <div v-if="section.title === '分时电价'" class="select-grid">
                <label>
                  <span>分时类型</span>
                  <el-select v-model="commercialForm.tou_type">
                    <el-option label="标准峰平谷" value="standard" />
                    <el-option label="尖峰/深谷" value="sharp_deep" />
                  </el-select>
                </label>
                <label>
                  <span>电量模式</span>
                  <el-select v-model="commercialForm.ratio_mode">
                    <el-option label="按占比" value="ratio" />
                    <el-option label="按电量" value="amount" />
                  </el-select>
                </label>
              </div>
              <div v-if="section.title === '售电套餐'" class="select-grid">
                <label>
                  <span>套餐类型</span>
                  <el-select v-model="commercialForm.sales_package_type">
                    <el-option label="固定服务费" value="fixed" />
                    <el-option label="分成套餐" value="ratio_share" />
                    <el-option label="降价套餐" value="price_down" />
                    <el-option label="降价分成" value="price_down_ratio" />
                  </el-select>
                </label>
              </div>
              <div class="retail-form-grid">
                <label v-for="field in section.fields" :key="field.key">
                  <span>{{ field.label }}<small>{{ field.unit }}</small></span>
                  <el-input-number
                    :model-value="commercialNumber(field.key)"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step ?? 1"
                    controls-position="right"
                    @update:model-value="setCommercialNumber(field.key, $event)"
                  />
                </label>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>

        <div v-else class="retail-form-grid">
          <label v-for="field in stateGridFields" :key="field.key">
            <span>{{ field.label }}<small>{{ field.unit }}</small></span>
            <el-input-number
              :model-value="stateGridNumber(field.key)"
              :min="field.min"
              :max="field.max"
              :step="field.step ?? 1"
              controls-position="right"
              @update:model-value="setStateGridNumber(field.key, $event)"
            />
          </label>
        </div>
      </div>

      <div class="status-stack">
        <div class="panel">
          <div class="panel-title">
            <h2>电价构成</h2>
            <span>金额</span>
          </div>
          <div ref="breakdownChartRef" class="chart retail-chart chart-host"></div>
        </div>

        <div class="panel" v-if="activeMode === 'commercial'">
          <div class="panel-title">
            <h2>分时电量电价</h2>
            <span>{{ commercialForm.tou_type === 'sharp_deep' ? '五时段' : '三时段' }}</span>
          </div>
          <div ref="periodChartRef" class="chart retail-chart chart-host"></div>
        </div>
      </div>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>构成明细</h2>
          <span>
            {{ breakdownRows.length }} 项
            <el-button size="small" text type="primary" @click="exportBreakdown">导出CSV</el-button>
          </span>
        </div>
        <el-table :data="breakdownRows" border empty-text="先填写参数并测算">
          <el-table-column prop="item" label="项目" min-width="140" />
          <el-table-column prop="unit_price" label="单价" width="110" sortable />
          <el-table-column prop="amount" label="金额" width="120" sortable />
          <el-table-column label="占比" width="100">
            <!-- 备注行（售电公司利润已含在时段电价内）不计占比，其余行合计 100% -->
            <template #default="{ row }">{{ row.note ? '—' : `${(row.ratio * 100).toFixed(2)}%` }}</template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>分时明细</h2>
          <span>电量和电度电费</span>
        </div>
        <el-table :data="periodRows" border>
          <el-table-column prop="period" label="时段" width="80" />
          <el-table-column prop="unit_price" label="电价" width="110" />
          <el-table-column prop="amount" label="电量(kWh)" width="120" />
          <el-table-column prop="fee" label="电度电费" min-width="120" />
        </el-table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.retail-toolbar .el-radio-group {
  flex: 0 0 auto;
}

.retail-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.select-grid,
.retail-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.select-grid {
  margin-bottom: 12px;
}

.select-grid label,
.retail-form-grid label {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.select-grid span,
.retail-form-grid span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-body);
  font-size: 12px;
}

.retail-form-grid small {
  color: var(--muted);
  font-size: 12px;
}

.select-grid :deep(.el-select),
.retail-form-grid :deep(.el-input-number) {
  width: 100%;
}

.retail-chart {
  height: 310px;
}

@media (max-width: 1080px) {
  .select-grid,
  .retail-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .retail-toolbar .el-radio-group,
  .retail-toolbar :deep(.el-radio-button),
  .retail-toolbar :deep(.el-radio-button__inner),
  .retail-toolbar .el-select {
    width: 100%;
  }

  .select-grid,
  .retail-form-grid {
    grid-template-columns: 1fr;
  }

  .retail-chart {
    height: 260px;
  }
}
</style>
