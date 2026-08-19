<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useEChart } from '../composables/useEChart'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'
import { exportCsv } from '../utils/exportCsv'
import {
  calculateTruckChargingInvestment,
  getDefaultTruckChargingForm,
  runTruckChargingSensitivityAnalysis,
  type TruckChargingForm,
  type TruckChargingOperationMode,
  type TruckChargingProjectType,
  type TruckChargingResult,
  type TruckChargingRouteMode,
  type TruckChargingSensitivityResult
} from '@/services/truckCharging'

type NumericField = {
  [K in keyof TruckChargingForm]: TruckChargingForm[K] extends number ? K : never
}[keyof TruckChargingForm]

type FieldConfig = {
  key: NumericField
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}

const form = reactive<TruckChargingForm>(getDefaultTruckChargingForm())
const result = ref<TruckChargingResult | null>(null)
const sensitivity = ref<TruckChargingSensitivityResult | null>(null)
const activeTab = ref('project')
const loading = ref(false)
const sensitivityLoading = ref(false)

const revenueChartRef = ref<HTMLDivElement | null>(null)
const cashFlowChartRef = ref<HTMLDivElement | null>(null)
const sensitivityChartRef = ref<HTMLDivElement | null>(null)
// 统一 ECharts 生命周期:容器自适应、主题切换重建后自动回调 render 恢复内容
const revenueChart = useEChart(revenueChartRef, { render: renderRevenueChart })
const cashFlowChart = useEChart(cashFlowChartRef, { render: renderCashFlowChart })
const sensitivityChart = useEChart(sensitivityChartRef, { render: renderSensitivityChart })

const projectLabels: Record<TruckChargingProjectType, string> = {
  truck: '重卡运输',
  charging: '充电站',
  integrated: '一体化'
}

const operationLabels: Record<TruckChargingOperationMode, string> = {
  owned: '自有车辆',
  affiliated: '挂靠模式',
  outsourced: '外委模式',
  mixed: '混合模式'
}

const routeLabels: Record<TruckChargingRouteMode, string> = {
  simple: '简单线路',
  multi_segment: '多段线路'
}

const projectFields: FieldConfig[] = [
  { key: 'truck_count', label: '重卡数量', unit: '辆', min: 1, max: 1000, step: 1 },
  { key: 'truck_capacity', label: '单车载重', unit: '吨', min: 10, max: 100, step: 1 },
  { key: 'charging_station_count', label: '充电站数量', unit: '座', min: 1, max: 100, step: 1 },
  { key: 'operating_days', label: '年运营天数', unit: '天', min: 200, max: 365, step: 1 },
  { key: 'annual_transport_volume', label: '年运输量', unit: '万吨', min: 0, step: 5 },
  { key: 'daily_transport_volume', label: '日运输量', unit: '吨/天', min: 0, step: 100 }
]

const transportFields: FieldConfig[] = [
  { key: 'avg_transport_distance', label: '平均运距', unit: 'km', min: 1, max: 5000, step: 10 },
  { key: 'daily_mileage', label: '日均里程', unit: 'km/天', min: 1, max: 2000, step: 10 },
  { key: 'freight_rate', label: '运输运价', unit: '元/吨公里', min: 0, max: 5, step: 0.01 },
  { key: 'target_irr', label: '目标IRR', unit: '%', min: 1, max: 50, step: 0.5 },
  { key: 'load_factor', label: '去程实载率', unit: '%', min: 0, max: 120, step: 1 },
  // 回程带货率独立参数（C3）：回程实际载货量占单程载量的比例，用于按运量反推车辆数
  { key: 'return_load_factor', label: '回程带货率', unit: '%', min: 0, max: 100, step: 5 },
  { key: 'return_factor', label: '回程系数', unit: '', min: 0, max: 1, step: 0.05 },
  { key: 'forward_energy_consumption', label: '去程能耗', unit: 'kWh/km', min: 0.1, max: 10, step: 0.1 },
  { key: 'return_energy_consumption', label: '返程能耗', unit: 'kWh/km', min: 0.1, max: 10, step: 0.1 },
  { key: 'daily_highway_toll', label: '单车过路费', unit: '元/天', min: 0, step: 50 }
]

const operationFields: FieldConfig[] = [
  { key: 'affiliated_fee_per_truck', label: '挂靠费', unit: '万元/车年', min: 0, step: 0.5 },
  { key: 'management_fee_rate', label: '管理费比例', unit: '%', min: 0, max: 100, step: 1 },
  { key: 'outsourced_rate', label: '外委运价', unit: '元/吨公里', min: 0, max: 5, step: 0.01 },
  { key: 'owned_truck_ratio', label: '自有车比例', unit: '%', min: 0, max: 100, step: 5 }
]

const chargingFields: FieldConfig[] = [
  { key: 'service_fee', label: '充电服务费', unit: '元/kWh', min: 0, max: 5, step: 0.01 },
  { key: 'electricity_price', label: '购电价格', unit: '元/kWh', min: 0, max: 3, step: 0.01 },
  { key: 'daily_charging', label: '单站日充电量', unit: 'kWh/天', min: 0, step: 100 },
  { key: 'station_cost_per_kw', label: '单千瓦投资', unit: '元/kW', min: 0, step: 50 },
  { key: 'station_om_cost', label: '单站运维', unit: '万元/年', min: 0, step: 1 },
  { key: 'labor_cost', label: '站端人工', unit: '万元/年', min: 0, step: 5 },
  // 两部制基本电费（C1）：按充电站总功率计入年固定成本，0 表示不启用
  { key: 'demand_charge', label: '基本电费', unit: '元/kW·月', min: 0, step: 1 }
]

const costFields: FieldConfig[] = [
  { key: 'truck_price', label: '重卡单价', unit: '万元/辆', min: 0, step: 5 },
  { key: 'land_cost', label: '土地费用', unit: '万元', min: 0, step: 10 },
  { key: 'other_construction', label: '其他建设', unit: '万元', min: 0, step: 10 },
  { key: 'driver_salary', label: '司机工资', unit: '万元/车年', min: 0, step: 1 },
  // 能耗成本改为电耗单源派生（C2）：公里电费 = 综合电耗 × (电价+服务费)，见 derived.energy_cost_per_km
  { key: 'maintenance_cost', label: '维修保养', unit: '万元/车年', min: 0, step: 0.5 },
  { key: 'insurance_cost', label: '保险费用', unit: '万元/车年', min: 0, step: 0.5 },
  // 电池更换资本性支出（G1）：更换年份为 0 表示不更换
  { key: 'battery_replacement_year', label: '电池更换年份', unit: '年', min: 0, max: 30, step: 1 },
  { key: 'battery_replacement_cost', label: '电池更换成本', unit: '万元/车', min: 0, step: 1 }
]

const financeFields: FieldConfig[] = [
  { key: 'project_life', label: '项目寿命', unit: '年', min: 1, max: 30, step: 1 },
  { key: 'depreciation_years', label: '折旧年限', unit: '年', min: 1, max: 30, step: 1 },
  { key: 'salvage_rate', label: '残值率', unit: '%', min: 0, max: 50, step: 1 },
  { key: 'loan_ratio', label: '贷款比例', unit: '%', min: 0, max: 90, step: 5 },
  { key: 'loan_interest_rate', label: '贷款利率', unit: '%', min: 0, max: 20, step: 0.1 },
  { key: 'loan_term', label: '贷款年限', unit: '年', min: 1, max: 30, step: 1 },
  { key: 'tax_rate', label: '所得税率', unit: '%', min: 0, max: 50, step: 1 },
  { key: 'vat_rate', label: '增值税率', unit: '%', min: 0, max: 20, step: 1 },
  { key: 'discount_rate', label: '折现率', unit: '%', min: 0, max: 20, step: 0.5 }
]

const revenueRows = computed(() => result.value?.revenue_breakdown ?? [])
const costRows = computed(() => result.value?.cost_breakdown ?? [])
const cashFlowRows = computed(() => result.value?.cash_flow ?? [])
const driverRows = computed(() => result.value?.affiliated_driver_cost_breakdown ?? [])

function numericValue(key: NumericField) {
  return Number(form[key]) || 0
}

// 指标格式化：NaN（资本金为 0 / 项目期内未回收等无定义场景）显示「—」而非伪数值（D2）
function fmtMetric(value: number | undefined, digits = 2) {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return String(Number(value.toFixed(digits)))
}

function setNumber(key: NumericField, value: number | undefined) {
  ;(form as unknown as Record<NumericField, number>)[key] = Number(value ?? 0)
}

function resetDefault() {
  Object.assign(form, getDefaultTruckChargingForm())
  runCalculation()
  ElMessage.success('默认参数已加载')
}

function runCalculation() {
  loading.value = true
  try {
    result.value = calculateTruckChargingInvestment({
      ...form,
      route_segments: form.route_segments.map((seg) => ({ ...seg }))
    })
    nextTick(renderCharts)
  } finally {
    loading.value = false
  }
}

function runSensitivity() {
  sensitivityLoading.value = true
  try {
    sensitivity.value = runTruckChargingSensitivityAnalysis({
      ...form,
      route_segments: form.route_segments.map((seg) => ({ ...seg }))
    })
    nextTick(renderSensitivityChart)
    ElMessage.success('敏感性分析完成')
  } finally {
    sensitivityLoading.value = false
  }
}

function renderCharts() {
  renderRevenueChart()
  renderCashFlowChart()
  renderSensitivityChart()
}

function renderRevenueChart() {
  if (!result.value) return
  revenueChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 万元 ({d}%)' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '收入构成',
        type: 'pie',
        radius: ['42%', '70%'],
        center: ['50%', '45%'],
        data: result.value.revenue_breakdown.map((row) => ({ name: row.item, value: row.amount })),
        itemStyle: { borderColor: '#fff', borderWidth: 2 }
      }
    ]
  })
}

function renderCashFlowChart() {
  if (!result.value) return
  cashFlowChart.setOption({
    grid: { left: 52, right: 24, top: 28, bottom: 42 },
    tooltip: axisTooltip({ unit: '万元' }),
    legend: { top: 0 },
    toolbox: chartToolbox('资本金现金流'),
    xAxis: { type: 'category', data: result.value.cash_flow.map((row) => `第${row.year}年`) },
    yAxis: { type: 'value', name: '万元', splitLine: { lineStyle: { color: '#e6edf3' } } },
    series: [
      { name: '净现金流', type: 'bar', data: result.value.cash_flow.map((row) => row.net_cash_flow), itemStyle: { color: '#0f766e' } },
      { name: '累计现金流', type: 'line', smooth: false, data: result.value.cash_flow.map((row) => row.cumulative_cash_flow), lineStyle: { color: '#2563eb', width: 3 } }
    ]
  })
}

function renderSensitivityChart() {
  if (!sensitivity.value) return
  const entries = Object.entries(sensitivity.value.sensitivity_results)
  sensitivityChart.setOption({
    grid: { left: 52, right: 24, top: 28, bottom: 72 },
    tooltip: axisTooltip({ unit: '万元' }),
    legend: { bottom: 0, type: 'scroll' },
    toolbox: chartToolbox('重卡充换电敏感性'),
    xAxis: { type: 'category', data: entries[0]?.[1].changes.map((change) => `${change}%`) ?? [] },
    yAxis: { type: 'value', name: 'NPV(万元)', splitLine: { lineStyle: { color: '#e6edf3' } } },
    series: entries.map(([name, item]) => ({ name, type: 'line', smooth: false, data: item.values }))
  })
}

// 现金流明细一键导出 CSV（逐年表：利息/本金/折旧/残值全列）
function exportCashFlow() {
  const rows = cashFlowRows.value
  if (!rows.length) { ElMessage.warning('暂无现金流数据'); return }
  exportCsv(
    '重卡充换电现金流',
    ['年份', '收入', '付现成本', '贷款利息', '偿还本金', '折旧', '税金', '残值回收', '净现金流', '累计现金流'],
    rows.map((row) => [row.year, row.revenue, row.cost, row.interest, row.principal, row.depreciation, row.tax, row.salvage, row.net_cash_flow, row.cumulative_cash_flow])
  )
}

watch(
  () => form.project_type,
  (projectType) => {
    form.enable_charging_params = projectType === 'integrated'
  }
)

watch(
  () => form.forward_energy_consumption,
  (value) => {
    form.return_energy_consumption = Math.round(value * 0.65 * 100) / 100
  }
)

onMounted(runCalculation)
</script>

<template>
  <div class="page-stack truck-workbench">
    <section class="metric-grid truck-metrics">
      <article class="metric-card">
        <span>总投资</span>
        <strong>{{ result?.total_investment ?? 0 }} <small>万元</small></strong>
        <em class="blue">{{ projectLabels[form.project_type] }} / {{ operationLabels[form.operation_mode] }}</em>
      </article>
      <article class="metric-card">
        <span>年均收入</span>
        <strong>{{ result?.annual_revenue ?? 0 }} <small>万元</small></strong>
        <em class="green">年利润 {{ result?.annual_profit ?? 0 }} 万元</em>
      </article>
      <article class="metric-card">
        <span>资本金IRR</span>
        <strong>{{ fmtMetric(result?.equity_irr) }} <small>%</small></strong>
        <em class="orange">目标 {{ form.target_irr }}%</em>
      </article>
      <article class="metric-card">
        <span>投资回收期</span>
        <strong>{{ fmtMetric(result?.payback_period) }} <small>年</small></strong>
        <em class="blue">NPV {{ fmtMetric(result?.npv) }} 万元</em>
      </article>
    </section>

    <el-alert
      v-for="warning in result?.warnings ?? []"
      :key="warning"
      :title="warning"
      type="warning"
      show-icon
      :closable="false"
    />

    <section class="panel">
      <div class="panel-title">
        <h2>重卡充换电测算</h2>
        <span>重卡运输、充电站、一体化投资口径迁移版</span>
      </div>

      <div class="toolbar truck-toolbar">
        <el-radio-group v-model="form.project_type">
          <el-radio-button value="integrated">一体化</el-radio-button>
          <el-radio-button value="truck">重卡运输</el-radio-button>
          <el-radio-button value="charging">充电站</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="form.operation_mode">
          <el-radio-button value="owned">自有</el-radio-button>
          <el-radio-button value="affiliated">挂靠</el-radio-button>
          <el-radio-button value="outsourced">外委</el-radio-button>
          <el-radio-button value="mixed">混合</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="form.route_mode">
          <el-radio-button value="simple">简单</el-radio-button>
          <el-radio-button value="multi_segment">多段</el-radio-button>
        </el-radio-group>
        <el-button type="primary" :loading="loading" @click="runCalculation">计算</el-button>
        <el-button :loading="sensitivityLoading" @click="runSensitivity">敏感性</el-button>
        <el-button @click="resetDefault">默认值</el-button>
      </div>

      <div class="derived-strip">
        <span>车辆 {{ result?.actual_truck_count ?? 0 }} 辆</span>
        <span>自有 {{ result?.owned_truck_count ?? 0 }}</span>
        <span>挂靠 {{ result?.affiliated_truck_count ?? 0 }}</span>
        <span>外委 {{ result?.outsourced_truck_count ?? 0 }}</span>
        <span>{{ routeLabels[form.route_mode] }}</span>
        <span>日充电 {{ result?.derived.daily_total_charging ?? 0 }} kWh</span>
        <span>总功率 {{ result?.derived.total_charging_power ?? 0 }} kW</span>
        <span>枪数 {{ result?.derived.charging_gun_count ?? 0 }}</span>
        <span>电耗成本 {{ result?.derived.energy_cost_per_km ?? 0 }} 元/km</span>
      </div>
    </section>

    <section class="panel">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="项目" name="project">
          <div class="form-grid">
            <label v-for="field in projectFields" :key="field.key" class="field-cell">
              <span>{{ field.label }}</span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
              <em>{{ field.unit }}</em>
            </label>
          </div>
          <div class="mode-row">
            <span>车辆口径</span>
            <el-radio-group v-model="form.calc_mode">
              <el-radio-button value="by_truck">已知车辆数</el-radio-button>
              <el-radio-button value="by_volume">已知运输量</el-radio-button>
            </el-radio-group>
            <span>运价口径</span>
            <el-radio-group v-model="form.profit_mode">
              <el-radio-button value="by_price">已知运价</el-radio-button>
              <el-radio-button value="by_rate">目标IRR反算</el-radio-button>
            </el-radio-group>
          </div>
        </el-tab-pane>

        <el-tab-pane label="运输" name="transport">
          <div class="form-grid">
            <label v-for="field in transportFields" :key="field.key" class="field-cell">
              <span>{{ field.label }}</span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
              <em>{{ field.unit }}</em>
            </label>
          </div>
          <div v-if="form.route_mode === 'multi_segment'" class="segment-table">
            <el-table :data="form.route_segments" size="small">
              <el-table-column label="启用" width="72">
                <template #default="{ row }">
                  <el-checkbox v-model="row.enabled" />
                </template>
              </el-table-column>
              <el-table-column label="起点" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.start" />
                </template>
              </el-table-column>
              <el-table-column label="终点" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.end" />
                </template>
              </el-table-column>
              <el-table-column label="运距" min-width="118">
                <template #default="{ row }">
                  <el-input-number v-model="row.distance" :min="0" :step="10" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="日运量" min-width="128">
                <template #default="{ row }">
                  <el-input-number v-model="row.dailyVolume" :min="0" :step="100" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="运价" min-width="118">
                <template #default="{ row }">
                  <el-input-number v-model="row.rate" :min="0" :step="1" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="外委价" min-width="118">
                <template #default="{ row }">
                  <el-input-number v-model="row.outsourced_price" :min="0" :step="1" controls-position="right" />
                </template>
              </el-table-column>
              <el-table-column label="能耗" min-width="118">
                <template #default="{ row }">
                  <el-input-number v-model="row.energyConsumption" :min="0" :step="0.1" controls-position="right" />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="运营" name="operation">
          <div class="form-grid">
            <label v-for="field in operationFields" :key="field.key" class="field-cell">
              <span>{{ field.label }}</span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
              <em>{{ field.unit }}</em>
            </label>
          </div>
        </el-tab-pane>

        <el-tab-pane label="充电" name="charging">
          <div class="form-grid">
            <label v-for="field in chargingFields" :key="field.key" class="field-cell">
              <span>{{ field.label }}</span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
              <em>{{ field.unit }}</em>
            </label>
          </div>
        </el-tab-pane>

        <el-tab-pane label="成本财务" name="finance">
          <div class="form-grid">
            <label v-for="field in [...costFields, ...financeFields]" :key="field.key" class="field-cell">
              <span>{{ field.label }}</span>
              <el-input-number
                :model-value="numericValue(field.key)"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                controls-position="right"
                @update:model-value="setNumber(field.key, $event)"
              />
              <em>{{ field.unit }}</em>
            </label>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="chart-grid">
      <article class="panel">
        <div class="panel-title compact">
          <h2>收入构成</h2>
          <span>万元/年</span>
        </div>
        <div ref="revenueChartRef" class="chart chart-host"></div>
      </article>
      <article class="panel">
        <div class="panel-title compact">
          <h2>资本金现金流</h2>
          <span>万元</span>
        </div>
        <div ref="cashFlowChartRef" class="chart chart-host"></div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-title compact">
        <h2>明细</h2>
        <span>收入、成本、司机侧与现金流</span>
      </div>
      <el-tabs>
        <el-tab-pane label="收入">
          <el-table :data="revenueRows" size="small">
            <el-table-column prop="item" label="项目" min-width="180" />
            <el-table-column prop="amount" label="金额(万元)" width="140" align="right" sortable />
            <el-table-column label="占比" width="110" align="right">
              <template #default="{ row }">{{ (row.ratio * 100).toFixed(1) }}%</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="成本">
          <el-table :data="costRows" size="small">
            <el-table-column prop="item" label="项目" min-width="180" />
            <el-table-column prop="amount" label="金额(万元)" width="140" align="right" sortable />
            <el-table-column label="占比" width="110" align="right">
              <template #default="{ row }">{{ (row.ratio * 100).toFixed(1) }}%</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="司机侧">
          <div class="driver-summary">
            <span>单车年收入 {{ result?.affiliated_driver_avg_income ?? 0 }} 万元</span>
            <span>单车年成本 {{ result?.affiliated_driver_cost ?? 0 }} 万元</span>
            <span>单车净收益 {{ result?.affiliated_driver_net_income ?? 0 }} 万元</span>
          </div>
          <el-table :data="driverRows" size="small">
            <el-table-column prop="item" label="项目" min-width="180" />
            <el-table-column prop="amount" label="金额(万元/车年)" width="170" align="right" />
            <el-table-column label="占比" width="110" align="right">
              <template #default="{ row }">{{ (row.ratio * 100).toFixed(1) }}%</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="现金流">
          <div class="export-row">
            <el-button size="small" @click="exportCashFlow">导出CSV</el-button>
          </div>
          <el-table :data="cashFlowRows" size="small">
            <el-table-column prop="year" label="年份" width="80" sortable />
            <el-table-column prop="revenue" label="收入" width="110" align="right" sortable />
            <el-table-column prop="cost" label="付现成本" width="110" align="right" sortable />
            <el-table-column prop="interest" label="贷款利息" width="105" align="right" />
            <el-table-column prop="principal" label="偿还本金" width="105" align="right" />
            <el-table-column prop="depreciation" label="折旧" width="100" align="right" />
            <el-table-column prop="tax" label="税金" width="105" align="right" sortable />
            <el-table-column prop="salvage" label="残值回收" width="105" align="right" />
            <el-table-column prop="net_cash_flow" label="净现金流" width="120" align="right" sortable />
            <el-table-column prop="cumulative_cash_flow" label="累计现金流" width="130" align="right" sortable />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="panel">
      <div class="panel-title compact">
        <h2>敏感性</h2>
        <span>NPV 对关键参数变化</span>
      </div>
      <div ref="sensitivityChartRef" class="chart sensitivity-chart chart-host"></div>
    </section>
  </div>
</template>

<style scoped>
.truck-workbench {
  gap: 18px;
}

.truck-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.truck-toolbar {
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.derived-strip,
.driver-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.derived-strip span,
.driver-summary span {
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font-size: var(--font-md);
  padding: 6px 10px;
}

.form-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding-top: 8px;
}

.field-cell {
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  display: grid;
  gap: 8px;
  grid-template-columns: 92px minmax(0, 1fr) 84px;
  padding: 10px;
}

.field-cell span {
  color: var(--text);
  font-size: var(--font-md);
}

.field-cell em {
  color: var(--muted);
  font-size: var(--font-sm);
  font-style: normal;
}

.field-cell :deep(.el-input-number) {
  width: 100%;
}

.mode-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.mode-row span {
  color: var(--text);
  font-size: var(--font-md);
  font-weight: 600;
}

.segment-table {
  margin-top: 16px;
}

.export-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.segment-table :deep(.el-input-number) {
  width: 100%;
}

.chart-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chart {
  height: 320px;
  width: 100%;
}

.sensitivity-chart {
  height: 360px;
}

.panel-title.compact {
  margin-bottom: 12px;
}

@media (max-width: 1140px) {
  .truck-metrics,
  .chart-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .truck-metrics,
  .chart-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .field-cell {
    grid-template-columns: 86px minmax(0, 1fr) 72px;
  }

  .truck-toolbar :deep(.el-radio-group) {
    max-width: 100%;
    overflow-x: auto;
  }
}

@media (max-width: 480px) {
  .truck-metrics { grid-template-columns: 1fr; }
}
</style>
