<script setup lang="ts">
// 储能投资收益统一工作台：本地公式即时预览，agent-backend 负责权威聚合、落库和智能体上下文。
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import CashflowCurve from '@/components/agent/dljy-ui/investment/CashflowCurve.vue'
import InvestmentDecisionCard from '@/components/agent/dljy-ui/investment/InvestmentDecisionCard.vue'
import ProjectFinanceSummary from '@/components/agent/dljy-ui/investment/ProjectFinanceSummary.vue'
import StorageAssumptionPanel from '@/components/agent/dljy-ui/storage/StorageAssumptionPanel.vue'
import StorageDispatchTape from '@/components/agent/dljy-ui/storage/StorageDispatchTape.vue'
import StorageRevenueWaterfall from '@/components/agent/dljy-ui/storage/StorageRevenueWaterfall.vue'
import StorageSensitivityMatrix from '@/components/agent/dljy-ui/storage/StorageSensitivityMatrix.vue'
import { useEChart } from '@/composables/useEChart'
import { onRegionChange } from '@/composables/useRegionReload'
import { axisTooltip, chartToolbox } from '@/services/chart/chartOptions'
import {
  getStorageDefaultForm,
  calculateStorageInvestment,
  runStorageSensitivityAnalysis,
  storageProvinceList,
  type StorageCalculationResult,
  type StorageCalculatorForm,
  type StorageSensitivityResult
} from '@/services/storage'
import { currentRegion, packageRegionSummary } from '@/services/region/regionContext'
import {
  deleteInvestmentRun,
  getInvestmentRun,
  listInvestmentRuns,
  parseInvestmentIntent,
  runInvestmentAssessment,
  type InvestmentAssessmentResult,
  type InvestmentRunListItem
} from '@/services/agent/investmentAssessmentClient'
import { exportCsv, type CsvCell } from '@/utils/exportCsv'
import { PAGE_PROMPT_KEYS } from '@/prompts'

function regionStorageProvince(): string {
  return storageProvinceList.includes(currentRegion.value.shortName) ? currentRegion.value.shortName : '新疆'
}

type NumericField = {
  [K in keyof StorageCalculatorForm]: StorageCalculatorForm[K] extends number ? K : never
}[keyof StorageCalculatorForm]

type BooleanField = {
  [K in keyof StorageCalculatorForm]: StorageCalculatorForm[K] extends boolean ? K : never
}[keyof StorageCalculatorForm]

type NumberFieldConfig = {
  key: NumericField
  label: string
  unit: string
  min?: number
  max?: number
  step?: number
}

type ToggleConfig = {
  key: BooleanField
  label: string
}

type FieldSection = {
  name: string
  fields: NumberFieldConfig[]
  toggles?: ToggleConfig[]
}

type StepId = 'formula' | 'pricing' | 'dispatch' | 'finance' | 'sensitivity' | 'agent'
type StepStatus = 'todo' | 'running' | 'done' | 'error'
type RunStep = { id: StepId; title: string; desc: string; status: StepStatus; detail: string }

const form = reactive<StorageCalculatorForm>(getStorageDefaultForm(regionStorageProvince()))
const projectName = ref('储能投资收益测算')
const result = ref<StorageCalculationResult | null>(null)
const sensitivity = ref<StorageSensitivityResult | null>(null)
const assessment = ref<InvestmentAssessmentResult | null>(null)
const activeSection = ref('系统建设')
const calcMode = ref<'cycles_to_irr' | 'irr_to_cycles'>('cycles_to_irr')
const calculating = ref(false)
const sensitivityLoading = ref(false)
const runningBackend = ref(false)
const error = ref('')
const intentText = ref('')
const intentLoading = ref(false)
const intentPatch = ref<Record<string, unknown> | null>(null)
const intentExplanation = ref('')
const history = ref<InvestmentRunListItem[]>([])
const historyLoading = ref(false)
const agentKey = ref(0)

const revenueChartRef = ref<HTMLDivElement | null>(null)
const retentionChartRef = ref<HTMLDivElement | null>(null)
const sensitivityChartRef = ref<HTMLDivElement | null>(null)
const revenueChart = useEChart(revenueChartRef, { render: renderRevenueChart })
const retentionChart = useEChart(retentionChartRef, { render: renderRetentionChart })
const sensitivityChart = useEChart(sensitivityChartRef, { render: renderSensitivityChart })

const promptKey = PAGE_PROMPT_KEYS.storageCopilot

const steps = reactive<RunStep[]>([
  { id: 'formula', title: '完整公式', desc: '投资、收入、融资、税费、现金流', status: 'todo', detail: '等待测算' },
  { id: 'pricing', title: '价格口径', desc: '地区价格曲线或示意曲线', status: 'todo', detail: '等待测算' },
  { id: 'dispatch', title: '充放调度', desc: '套利筛查与 MILP/兜底调度', status: 'todo', detail: '等待测算' },
  { id: 'finance', title: '财务结论', desc: 'IRR、NPV、LCOE、回收期', status: 'todo', detail: '等待测算' },
  { id: 'sensitivity', title: '敏感性', desc: '关键参数扰动扫描', status: 'todo', detail: '等待测算' },
  { id: 'agent', title: '智能解释', desc: '解释、追问、报告组织', status: 'todo', detail: '等待测算' },
])

const fieldSections: FieldSection[] = [
  {
    name: '系统建设',
    fields: [
      { key: 'system_power_mw', label: '系统功率', unit: 'MW', min: 1, max: 1000 },
      { key: 'battery_capacity_mwh', label: '电池容量', unit: 'MWh', min: 1, max: 5000 },
      { key: 'system_efficiency', label: '系统效率', unit: '%', min: 80, max: 100 },
      { key: 'dod', label: '放电深度', unit: '%', min: 80, max: 100 },
      { key: 'first_year_eol', label: '首年EOL', unit: '%', min: 80, max: 100 },
      { key: 'peak_load_hours', label: '高峰持续', unit: 'h', min: 1, max: 24 },
      { key: 'plant_consumption_rate', label: '厂用电率', unit: '%', min: 0, max: 10, step: 0.01 },
      { key: 'energy_annual_cycles', label: '年循环次数', unit: '次', min: 0, max: 700 }
    ]
  },
  {
    name: '投资成本',
    fields: [
      { key: 'epc_unit_price', label: 'EPC单价', unit: '元/Wh', min: 0.3, max: 2, step: 0.01 },
      { key: 'equipment_unit_price', label: '设备单价', unit: '元/Wh', min: 0.2, max: 1.5, step: 0.01 },
      { key: 'land_area_mu', label: '征地面积', unit: '亩', min: 0, max: 200 },
      { key: 'land_price_per_mu', label: '地价', unit: '万元/亩', min: 0, max: 100 },
      { key: 'feasibility_cost', label: '可研费用', unit: '万元', min: 0, max: 500 },
      { key: 'construction_period', label: '建设周期', unit: '年', min: 0.5, max: 2, step: 0.1 },
      { key: 'construction_interest_rate', label: '建设利率', unit: '%', min: 0, max: 10, step: 0.1 },
      { key: 'operation_years', label: '经营期限', unit: '年', min: 10, max: 80 }
    ]
  },
  {
    name: '经营融资',
    fields: [
      { key: 'om_percentage', label: '运维占比', unit: '%', min: 0, max: 5, step: 0.1 },
      { key: 'om_growth_rate', label: '运维增长', unit: '%/年', min: 0, max: 5, step: 0.1 },
      { key: 'insurance_rate', label: '保险费率', unit: '%', min: 0, max: 1, step: 0.01 },
      { key: 'land_rent_annual', label: '土地年租', unit: '万元/年', min: 0 },
      { key: 'other_cost_annual', label: '其他费用', unit: '万元/年', min: 0 },
      { key: 'loan_ratio', label: '融资比例', unit: '%', min: 0, max: 90 },
      { key: 'loan_interest_rate', label: '贷款利率', unit: '%', min: 0, max: 10, step: 0.1 },
      { key: 'loan_term', label: '贷款期限', unit: '年', min: 1, max: 20 },
      { key: 'replace_battery_year', label: '换电年份', unit: '第N年', min: 8, max: 20 },
      { key: 'replace_battery_unit_price', label: '换电单价', unit: '元/Wh', min: 0.1, max: 1, step: 0.01 },
      { key: 'salvage_rate', label: '残值率', unit: '%', min: 0, max: 20 },
      { key: 'discount_rate', label: '贴现率', unit: '%', min: 0, max: 15, step: 0.1 }
    ],
    toggles: [{ key: 'replace_battery', label: '更换电池' }]
  },
  {
    name: '容量收益',
    fields: [
      { key: 'lease_price_per_mw', label: '租赁单价', unit: '万元/MW/年', min: 0 },
      { key: 'lease_capacity_mw', label: '租赁容量', unit: 'MW', min: 0 },
      { key: 'lease_term_years', label: '租赁年限', unit: '年', min: 0, max: 25 },
      { key: 'lease_continue_amount', label: '到期延续', unit: '万元/年', min: 0 },
      { key: 'compensation_standard', label: '补偿标准', unit: '元/kW/年', min: 0 },
      { key: 'deduct_ratio', label: '容量扣减', unit: '%', min: 0, max: 100 },
      { key: 'supply_demand_coefficient', label: '供需系数', unit: '%', min: 0, max: 100, step: 0.01 },
      { key: 'subsidy_years', label: '容量补贴期', unit: '年', min: 0, max: 10 },
      { key: 'subsidy_continue_amount', label: '补贴延续', unit: '万元/年', min: 0 },
      { key: 'annual_change_rate', label: '容量年变化', unit: '%', step: 0.1 }
    ],
    toggles: [
      { key: 'lease_continue_after_term', label: '租赁到期延续' },
      { key: 'lease_correlates_eol', label: '租赁关联EOL' },
      { key: 'deduct_capacity', label: '容量扣减调频' },
      { key: 'capacity_correlates_eol', label: '容量补偿关联EOL' },
      { key: 'subsidy_continue', label: '补贴到期延续' }
    ]
  },
  {
    name: '电量补贴',
    fields: [
      { key: 'energy_charge_price', label: '充电电价', unit: '元/kWh', min: 0, max: 1, step: 0.01 },
      { key: 'energy_discharge_price', label: '放电电价', unit: '元/kWh', min: 0, max: 1, step: 0.01 },
      { key: 'energy_deduct_ratio', label: '电量扣减', unit: '%', min: 0, max: 100 },
      { key: 'energy_policy_years', label: '电量政策期', unit: '年', min: 0, max: 25 },
      { key: 'energy_annual_change_rate', label: '电量年变化', unit: '%', step: 0.1 },
      { key: 'subsidy_standard', label: '补贴标准', unit: '元/kWh', min: 0, step: 0.01 },
      { key: 'subsidy_execution_years', label: '补贴执行期', unit: '年', min: 0, max: 25 },
      { key: 'subsidy_decline_rate', label: '补贴退坡', unit: '%', step: 0.1 }
    ],
    toggles: [
      { key: 'energy_deduct_capacity', label: '电量扣减容量' },
      { key: 'energy_correlates_eol', label: '电量收益关联EOL' },
      { key: 'subsidy_correlates_eol', label: '补贴关联EOL' }
    ]
  },
  {
    name: '辅助服务',
    fields: [
      { key: 'primary_freq_capacity', label: '一次容量', unit: 'MW', min: 0 },
      { key: 'primary_freq_mileage', label: '一次里程', unit: 'MW/天', min: 0 },
      { key: 'primary_freq_clearing_price', label: '一次出清价', unit: '元/MW', min: 0, step: 0.1 },
      { key: 'primary_freq_k_value', label: '一次K值', unit: '', min: 0, max: 10, step: 0.1 },
      { key: 'primary_freq_days', label: '一次中标天数', unit: '天', min: 0, max: 365 },
      { key: 'secondary_freq_capacity', label: '二次容量', unit: 'MW', min: 0 },
      { key: 'secondary_freq_mileage', label: '二次里程', unit: 'MW/天', min: 0 },
      { key: 'secondary_freq_clearing_price', label: '二次出清价', unit: '元/MW', min: 0, step: 0.1 },
      { key: 'secondary_freq_k_value', label: '二次K值', unit: '', min: 0, max: 10, step: 0.1 },
      { key: 'secondary_freq_days', label: '二次中标天数', unit: '天', min: 0, max: 365 }
    ],
    toggles: [
      { key: 'primary_freq_regulation', label: '一次调频' },
      { key: 'primary_freq_correlates_eol', label: '一次调频关联EOL' },
      { key: 'secondary_freq_regulation', label: '二次调频' },
      { key: 'secondary_freq_correlates_eol', label: '二次调频关联EOL' }
    ]
  },
  {
    name: '税费目标',
    fields: [
      { key: 'vat_output_rate', label: '销项税率', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'tax_rate', label: '所得税率', unit: '%', min: 0, max: 50, step: 0.1 },
      { key: 'vat_input_rate1', label: '进项税率1', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'vat_input_rate2', label: '进项税率2', unit: '%', min: 0, max: 20, step: 0.1 },
      { key: 'target_equity_irr', label: '目标IRR', unit: '%', min: 0, max: 80, step: 0.1 },
      { key: 'lcoe', label: '等效电价', unit: '元/kWh', min: 0, max: 10, step: 0.01 }
    ],
    toggles: [{ key: 'is_three_free_half', label: '三免三减半' }]
  }
]

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function num(v: unknown, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fmt(v: unknown, digits = 2) {
  const n = num(v, NaN)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

function csvCell(v: unknown): CsvCell {
  if (typeof v === 'string' || typeof v === 'number' || v === null || v === undefined) return v
  return String(v)
}

const activeFinance = computed(() => assessment.value?.finance ?? {})
const activeBreakdown = computed(() => asRecord(activeFinance.value.revenue_breakdown ?? result.value?.revenue_breakdown))
const activeCashFlowRows = computed(() => {
  const backendRows = asArray(activeFinance.value.cash_flow_schedule).map(asRecord)
  return backendRows.length ? backendRows : (result.value?.cash_flow_schedule ?? [])
})
const activeRetention = computed(() => {
  const backend = asArray(activeFinance.value.capacity_retention_schedule)
  return backend.length ? backend.map((v) => num(v)) : (result.value?.capacity_retention_schedule ?? [])
})
const headlineMetrics = computed(() => [
  {
    label: '总投资',
    value: activeFinance.value.total_investment_wan ?? result.value?.total_investment ?? 0,
    unit: '万元',
    hint: `资本金 ${fmt(activeFinance.value.equity_investment_wan ?? result.value?.equity_investment ?? 0)} 万元`
  },
  {
    label: '资本金IRR',
    value: activeFinance.value.irr_pct ?? result.value?.actual_equity_irr ?? 0,
    unit: '%',
    hint: `目标 ${form.target_equity_irr}%`
  },
  {
    label: 'LCOE',
    value: activeFinance.value.lcoe_yuan_kwh ?? result.value?.lcoe ?? 0,
    unit: '元/kWh',
    hint: `年放电 ${fmt(activeFinance.value.annual_discharge_mwh ?? result.value?.annual_discharge ?? 0)} MWh`
  },
  {
    label: '投资回收期',
    value: activeFinance.value.payback_years ?? result.value?.payback_period ?? 0,
    unit: '年',
    hint: `NPV ${fmt(activeFinance.value.npv_wan ?? result.value?.npv_value ?? 0)} 万元`
  },
])
const revenueRows = computed(() => [
  { label: '容量租赁', value: num(activeBreakdown.value.lease_revenue) },
  { label: '容量电费', value: num(activeBreakdown.value.capacity_payment) },
  { label: '峰谷套利', value: num(activeBreakdown.value.peak_valley_arbitrage) },
  { label: '政策补贴', value: num(activeBreakdown.value.subsidy_revenue) },
  { label: '一次调频', value: num(activeBreakdown.value.primary_freq_revenue) },
  { label: '二次调频', value: num(activeBreakdown.value.secondary_freq_revenue) }
])
const sensitivityRows = computed(() => {
  const backend = asRecord(assessment.value?.sensitivity)
  const backendResults = asRecord(backend.results)
  if (Object.keys(backendResults).length) {
    return Object.entries(backendResults).map(([name, item]) => {
      const values = asArray(asRecord(item).irr_values).map((v) => num(v))
      const min = Math.min(...values)
      const max = Math.max(...values)
      return { name, base: asRecord(item).base_value, min, max, swing: Number.isFinite(max - min) ? Math.round((max - min) * 10000) / 10000 : 0 }
    })
  }
  if (!sensitivity.value) return []
  return Object.entries(sensitivity.value.sensitivity_results).map(([name, item]) => {
    // values 中 null 表示该扰动点 IRR 无解（图表断点），统计极值时剔除
    const finiteValues = item.values.filter((v): v is number => Number.isFinite(v))
    const min = finiteValues.length ? Math.min(...finiteValues) : 0
    const max = finiteValues.length ? Math.max(...finiteValues) : 0
    return { name, base: item.base_value, min, max, swing: Number.isFinite(max - min) ? Math.round((max - min) * 10000) / 10000 : 0 }
  })
})
const basisText = computed(() => {
  const b = assessment.value?.basis
  if (b === 'real') return '真实接口'
  if (b === 'captured') return '真实采集'
  if (b === 'synthetic') return '模拟数据'
  if (b === 'illustrative') return '示意测算'
  return '本地预览'
})
const agentQuestion = computed(() => {
  if (!assessment.value) return ''
  return [
    '请基于页面已完成的统一投资测算结果进行解释，不要重新心算关键数字。',
    `项目：${assessment.value.project_name}；地区：${assessment.value.region.name}；容量：${form.battery_capacity_mwh}MWh；功率：${form.system_power_mw}MW。`,
    `核心结果：IRR=${fmt(activeFinance.value.irr_pct)}%，NPV=${fmt(activeFinance.value.npv_wan)}万元，静态回收期=${fmt(activeFinance.value.payback_years, 1)}年。`,
    '请说明：是否进入下一步、收益来源、最敏感参数、需要补充的数据、哪些结论不能作为正式投资决策依据。',
    '如需富渲染，优先输出 dljy-ui 的 InvestmentDecisionCard、ProjectFinanceSummary、CashflowCurve 或储能组件。'
  ].join('\n')
})
const agentPayload = computed(() => ({
  ...packageRegionSummary(),
  investment_assessment: assessment.value,
  storage_form: { ...form, calc_mode: calcMode.value },
  local_formula_preview: result.value
}))
const fieldPatchEntries = computed(() => Object.entries(intentPatch.value ?? {}))

function numericValue(key: NumericField) {
  return Number(form[key]) || 0
}

function setNumber(key: NumericField, value: number | undefined) {
  ;(form as unknown as Record<NumericField, number>)[key] = Number(value ?? 0)
}

function boolValue(key: BooleanField) {
  return Boolean(form[key])
}

function setBoolean(key: BooleanField, value: boolean) {
  ;(form as unknown as Record<BooleanField, boolean>)[key] = value
}

function setStep(id: StepId, status: StepStatus, detail: string) {
  const step = steps.find((item) => item.id === id)
  if (!step) return
  step.status = status
  step.detail = detail
}

function resetSteps() {
  for (const step of steps) {
    step.status = 'todo'
    step.detail = '等待测算'
  }
}

function runLocalCalculation(options: { quiet?: boolean } = {}) {
  calculating.value = true
  try {
    const payload = { ...form }
    if (calcMode.value === 'irr_to_cycles') payload.energy_annual_cycles = 0
    const next = calculateStorageInvestment(payload)
    result.value = next
    if (calcMode.value === 'irr_to_cycles') {
      form.energy_annual_cycles = Number(next.summary.energy_annual_cycles) || form.energy_annual_cycles
    }
    nextTick(renderCharts)
    if (!options.quiet) ElMessage.success('本地公式预览已更新')
  } finally {
    calculating.value = false
  }
}

function runSensitivity() {
  sensitivityLoading.value = true
  try {
    sensitivity.value = runStorageSensitivityAnalysis({ ...form })
    nextTick(renderSensitivityChart)
    ElMessage.success('本地敏感性分析完成')
  } finally {
    sensitivityLoading.value = false
  }
}

async function runBackendAssessment() {
  error.value = ''
  runningBackend.value = true
  resetSteps()
  runLocalCalculation({ quiet: true })
  setStep('formula', 'running', '正在提交完整储能公式参数')
  try {
    const response = await runInvestmentAssessment({
      asset_type: 'storage',
      project_name: projectName.value,
      region_id: currentRegion.value.id,
      region_name: currentRegion.value.name,
      input: { ...form, calc_mode: calcMode.value },
      save: true,
      basis: 'illustrative'
    })
    assessment.value = response
    setStep('formula', 'done', response.formula_version)
    setStep('pricing', 'done', basisText.value)
    setStep('dispatch', 'done', String(response.dispatch?.meta?.solver ?? response.storage?.dispatch?.meta?.solver ?? '调度完成'))
    setStep('finance', 'done', `IRR ${fmt(response.finance.irr_pct)}% · NPV ${fmt(response.finance.npv_wan)} 万元`)
    setStep('sensitivity', 'done', '后端敏感性扫描完成')
    setStep('agent', 'running', '正在生成解释')
    if (response.persistence?.saved === false && response.persistence.error) {
      ElMessage.warning(response.persistence.error)
    }
    agentKey.value++
    nextTick(renderCharts)
    loadHistory()
  } catch (err) {
    const msg = err instanceof Error ? err.message : '投资测算失败'
    error.value = msg
    setStep('formula', 'error', msg)
  } finally {
    runningBackend.value = false
  }
}

async function parseIntent() {
  if (!intentText.value.trim()) {
    ElMessage.warning('请输入需要填入的项目意图')
    return
  }
  intentLoading.value = true
  try {
    const parsed = await parseInvestmentIntent({
      text: intentText.value,
      region_id: currentRegion.value.id,
      region_name: currentRegion.value.name,
      current_input: { ...form }
    })
    intentPatch.value = parsed.field_patch
    intentExplanation.value = `${parsed.explanation} 置信度 ${Math.round(parsed.confidence * 100)}%。`
    if (!Object.keys(parsed.field_patch).length) ElMessage.warning('没有识别到可自动填入的字段')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '解析失败')
  } finally {
    intentLoading.value = false
  }
}

function applyPatchToForm(patch: Record<string, unknown>) {
  const totalInvestment = num(patch.total_investment_wan, NaN)
  for (const [key, value] of Object.entries(patch)) {
    if (key in form) {
      ;(form as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (Number.isFinite(totalInvestment) && form.battery_capacity_mwh > 0 && !('epc_unit_price' in patch)) {
    form.epc_unit_price = Math.max(0.3, Math.min(2, totalInvestment * 10000 / (form.battery_capacity_mwh * 1_000_000)))
  }
  runLocalCalculation({ quiet: true })
}

function applyIntentPatch() {
  if (!intentPatch.value) return
  applyPatchToForm(intentPatch.value)
  ElMessage.success('已填入识别参数，请复核后再运行后端测算')
}

function loadProvinceDefaults() {
  Object.assign(form, getStorageDefaultForm(form.province))
  assessment.value = null
  runLocalCalculation({ quiet: true })
  ElMessage.success(`${form.province}参数已加载`)
}

async function loadHistory() {
  historyLoading.value = true
  try {
    history.value = await listInvestmentRuns('storage', 12)
  } catch {
    history.value = []
  } finally {
    historyLoading.value = false
  }
}

async function openHistory(item: InvestmentRunListItem) {
  try {
    const detail = await getInvestmentRun(item.run_id)
    assessment.value = detail
    projectName.value = detail.project_name
    applyPatchToForm(detail.input ?? {})
    agentKey.value++
    nextTick(renderCharts)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取历史失败')
  }
}

async function removeHistory(item: InvestmentRunListItem) {
  try {
    await deleteInvestmentRun(item.run_id)
    history.value = history.value.filter((run) => run.run_id !== item.run_id)
    ElMessage.success('历史运行已删除')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

function renderCharts() {
  renderRevenueChart()
  renderRetentionChart()
  renderSensitivityChart()
}

function renderRevenueChart() {
  if (!result.value && !assessment.value) return
  revenueChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 万元 ({d}%)' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '年度收益',
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '45%'],
        label: { formatter: '{b}' },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: revenueRows.value.map((row) => ({ name: row.label, value: Math.max(row.value, 0) }))
      }
    ]
  })
}

function renderRetentionChart() {
  const retention = activeRetention.value
  if (!retention.length) return
  const years = retention.map((_, index) => `第${index + 1}年`)
  retentionChart.setOption({
    grid: { left: 44, right: 18, top: 26, bottom: 36 },
    tooltip: axisTooltip({ unit: '%' }),
    toolbox: chartToolbox('容量衰减曲线'),
    xAxis: { type: 'category', data: years },
    yAxis: { type: 'value', name: '%', min: 60, max: 100, splitLine: { lineStyle: { color: '#e6edf3' } } },
    series: [
      {
        name: '容量保持率',
        type: 'line',
        smooth: false,
        symbolSize: 6,
        data: retention,
        lineStyle: { color: '#0f766e', width: 3 },
        itemStyle: { color: '#0f766e' },
        areaStyle: { opacity: 0.12 },
        markLine: { data: [{ yAxis: 80, name: '80%' }], lineStyle: { color: '#d97706', type: 'dashed' } }
      }
    ]
  })
}

function renderSensitivityChart() {
  const source = assessment.value
    ? Object.entries(asRecord(asRecord(assessment.value.sensitivity).results))
    : Object.entries(sensitivity.value?.sensitivity_results ?? {})
  if (!source.length) return
  sensitivityChart.setOption({
    grid: { left: 44, right: 20, top: 28, bottom: 70 },
    tooltip: axisTooltip({ unit: '%' }),
    legend: { bottom: 0, type: 'scroll' },
    toolbox: chartToolbox('储能敏感性分析'),
    xAxis: { type: 'category', data: asArray(asRecord(source[0][1]).changes).map((change) => `${change}%`) },
    yAxis: { type: 'value', name: 'IRR%' },
    series: source.map(([name, item]) => ({
      name,
      type: 'line',
      smooth: false,
      data: asArray(asRecord(item).irr_values ?? asRecord(item).values)
    }))
  })
}

function exportCashFlow() {
  const rows = activeCashFlowRows.value
  if (!rows.length) {
    ElMessage.warning('暂无现金流数据')
    return
  }
  exportCsv(
    '储能投资现金流',
    ['年份', '收入', '充电成本', '运维', '还本', '利息', '所得税', '换电池', '净现金流', '累计现金流', '容量保持%', '放电MWh'],
    rows.map((row) => [
      csvCell(row.year),
      csvCell(row.revenue),
      csvCell(row.charging_cost),
      csvCell(row.om_cost),
      csvCell(row.loan_principal),
      csvCell(row.loan_interest),
      csvCell(row.income_tax),
      csvCell(row.replacement_cost),
      csvCell(row.net_cash_flow),
      csvCell(row.cumulative_cash_flow),
      csvCell(row.capacity_retention),
      csvCell(row.annual_discharge)
    ])
  )
}

function onAgentDone() {
  if (assessment.value) setStep('agent', 'done', '解释已生成')
}

onMounted(() => {
  runLocalCalculation({ quiet: true })
  loadHistory()
})

onRegionChange(() => {
  Object.assign(form, getStorageDefaultForm(regionStorageProvince()))
  assessment.value = null
  runLocalCalculation({ quiet: true })
  loadHistory()
})
</script>

<template>
  <div class="storage-copilot page-stack">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="储能投资收益测算默认可使用示意价格；真实投资决策必须接入正式价格、合同、设备报价、融资和审批口径。"
    />

    <section class="metric-grid merged-metrics">
      <article v-for="metric in headlineMetrics" :key="metric.label" class="metric-card">
        <span>{{ metric.label }}</span>
        <strong>{{ fmt(metric.value, metric.label === 'LCOE' ? 4 : 2) }} <small>{{ metric.unit }}</small></strong>
        <em>{{ metric.hint }}</em>
      </article>
    </section>

    <section class="panel command-panel">
      <div class="panel-title">
        <h2>储能投资收益统一测算</h2>
        <span>{{ currentRegion.name }} · 完整公式 + 调度套利 + 智能填参 + 后端运行快照</span>
      </div>
      <div class="toolbar command-toolbar">
        <el-input v-model="projectName" placeholder="项目名称" />
        <el-select v-model="form.province" placeholder="省份" @change="loadProvinceDefaults">
          <el-option v-for="province in storageProvinceList" :key="province" :label="province" :value="province" />
        </el-select>
        <el-radio-group v-model="calcMode">
          <el-radio-button value="cycles_to_irr">循环次数算IRR</el-radio-button>
          <el-radio-button value="irr_to_cycles">目标IRR算循环</el-radio-button>
        </el-radio-group>
        <el-button :loading="calculating" @click="runLocalCalculation()">本地预览</el-button>
        <el-button :loading="sensitivityLoading" @click="runSensitivity">敏感性</el-button>
        <el-button type="primary" :loading="runningBackend" @click="runBackendAssessment">后端测算并解释</el-button>
        <span class="basis-pill">{{ basisText }}</span>
      </div>
      <div class="intent-row">
        <el-input
          v-model="intentText"
          type="textarea"
          :rows="2"
          placeholder="例如：云南 200MW/400MWh，投资 3 亿元，目标 IRR 10%，年循环 350 次，充电 0.15、放电 0.35。"
        />
        <div class="intent-actions">
          <el-button :loading="intentLoading" @click="parseIntent">识别填参</el-button>
          <el-button type="primary" plain :disabled="!intentPatch" @click="applyIntentPatch">应用补丁</el-button>
        </div>
      </div>
      <div v-if="intentPatch" class="intent-patch">
        <span v-for="[key, value] in fieldPatchEntries" :key="key">{{ key }} = {{ value }}</span>
        <em>{{ intentExplanation }}</em>
      </div>
    </section>

    <div class="workbench-layout">
      <main class="calc-workspace">
        <section class="panel params-panel">
          <div class="panel-title">
            <h2>测算参数</h2>
            <span>{{ activeSection }}</span>
          </div>
          <el-tabs v-model="activeSection" class="storage-tabs">
            <el-tab-pane v-for="section in fieldSections" :key="section.name" :label="section.name" :name="section.name">
              <div v-if="section.toggles?.length" class="toggle-grid">
                <el-checkbox
                  v-for="toggle in section.toggles"
                  :key="toggle.key"
                  :model-value="boolValue(toggle.key)"
                  @update:model-value="setBoolean(toggle.key, Boolean($event))"
                >
                  {{ toggle.label }}
                </el-checkbox>
              </div>
              <div v-if="section.name === '电量补贴'" class="select-grid">
                <label>
                  <span>补贴类型</span>
                  <el-select v-model="form.subsidy_type">
                    <el-option label="无" value="none" />
                    <el-option label="政策性补贴" value="policy" />
                  </el-select>
                </label>
                <label>
                  <span>补贴基数</span>
                  <el-select v-model="form.subsidy_base_type">
                    <el-option label="放电电量" value="放电电量" />
                    <el-option label="充电电量" value="充电电量" />
                  </el-select>
                </label>
              </div>
              <div class="storage-form-grid">
                <label v-for="field in section.fields" :key="field.key">
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
            </el-tab-pane>
          </el-tabs>
        </section>

        <section class="results-stack">
          <div class="section-heading">
            <h2>测算结果</h2>
            <span>{{ assessment ? '后端权威结果' : '本地公式预览' }}</span>
          </div>
          <div v-if="error" class="error-box">{{ error }}</div>
          <InvestmentDecisionCard v-if="assessment" :data="assessment" :basis="assessment.basis" />
          <ProjectFinanceSummary v-if="assessment" :data="assessment" :basis="assessment.basis" />
          <div class="run-steps panel">
            <ol>
              <li v-for="step in steps" :key="step.id" :class="step.status">
                <i />
                <div>
                  <strong>{{ step.title }}</strong>
                  <span>{{ step.desc }}</span>
                  <em>{{ step.detail }}</em>
                </div>
              </li>
            </ol>
          </div>
          <div class="result-grid">
            <StorageDispatchTape v-if="assessment" :data="assessment" :basis="assessment.basis" />
            <StorageRevenueWaterfall :data="assessment || { finance: { revenue_breakdown: activeBreakdown } }" :basis="assessment?.basis" />
            <StorageSensitivityMatrix v-if="assessment" :data="assessment" :basis="assessment.basis" />
            <StorageAssumptionPanel v-if="assessment" :data="assessment" :basis="assessment.basis" />
            <CashflowCurve v-if="assessment" :data="assessment" :basis="assessment.basis" />
          </div>

          <section class="panel chart-panel">
            <div class="panel-title">
              <h2>年度收益结构</h2>
              <span>万元</span>
            </div>
            <div ref="revenueChartRef" class="chart storage-chart chart-host" />
            <div class="revenue-strip">
              <article v-for="row in revenueRows" :key="row.label">
                <span>{{ row.label }}</span>
                <strong>{{ fmt(row.value) }}</strong>
              </article>
            </div>
          </section>

          <section class="panel chart-pair">
            <div>
              <div class="panel-title compact-title">
                <h2>容量衰减曲线</h2>
                <span>换电池策略已计入</span>
              </div>
              <div ref="retentionChartRef" class="chart storage-chart chart-host" />
            </div>
            <div>
              <div class="panel-title compact-title">
                <h2>敏感性分析</h2>
                <span>目标指标 IRR</span>
              </div>
              <div ref="sensitivityChartRef" class="chart storage-chart chart-host" />
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <h2>现金流明细</h2>
              <span>经营期 {{ form.operation_years }} 年</span>
              <el-button size="small" @click="exportCashFlow">导出CSV</el-button>
            </div>
            <div class="table-shell">
              <el-table :data="activeCashFlowRows" border height="360" empty-text="填写参数并计算后展示现金流明细">
                <el-table-column prop="year" label="年份" width="80" fixed="left" sortable />
                <el-table-column prop="revenue" label="收入" width="100" sortable />
                <el-table-column prop="charging_cost" label="充电成本" width="110" sortable />
                <el-table-column prop="om_cost" label="运维" width="90" sortable />
                <el-table-column prop="loan_principal" label="还本" width="90" sortable />
                <el-table-column prop="loan_interest" label="利息" width="90" sortable />
                <el-table-column prop="income_tax" label="所得税" width="100" sortable />
                <el-table-column prop="replacement_cost" label="换电池" width="100" sortable />
                <el-table-column prop="net_cash_flow" label="净现金流" width="120" sortable />
                <el-table-column prop="cumulative_cash_flow" label="累计现金流" width="130" sortable />
                <el-table-column prop="capacity_retention" label="容量保持%" width="120" sortable />
                <el-table-column prop="annual_discharge" label="放电MWh" min-width="120" sortable />
              </el-table>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <h2>敏感性排行</h2>
              <span>后端优先，本地兜底</span>
            </div>
            <div class="table-shell compact-table">
              <el-table :data="sensitivityRows" border empty-text="填写参数并计算后展示敏感性排行">
                <el-table-column prop="name" label="参数" min-width="110" />
                <el-table-column prop="base" label="基准值" width="100" sortable />
                <el-table-column prop="min" label="低位IRR" width="105" sortable />
                <el-table-column prop="max" label="高位IRR" width="105" sortable />
                <el-table-column prop="swing" label="摆动" width="95" sortable />
              </el-table>
            </div>
          </section>
        </section>
      </main>

      <aside class="agent-workspace">
        <div class="section-heading">
          <h2>Agent 辅助区</h2>
          <span>填参解释、历史运行和追问</span>
        </div>
        <section class="panel history-panel">
          <div class="panel-title">
            <h2>运行历史</h2>
            <span>{{ historyLoading ? '读取中' : `${history.length} 条` }}</span>
          </div>
          <div v-if="!history.length" class="empty-small">暂无后端运行快照。</div>
          <article v-for="item in history" :key="item.run_id" class="history-item">
            <button type="button" @click="openHistory(item)">
              <strong>{{ item.project_name }}</strong>
              <span>{{ item.region.name || item.region.id }} · IRR {{ fmt(item.finance.irr_pct) }}% · {{ new Date(item.created_at).toLocaleString('zh-CN') }}</span>
            </button>
            <el-button text size="small" @click="removeHistory(item)">删除</el-button>
          </article>
        </section>

        <section class="panel agent-panel">
          <div class="panel-title">
            <h2>智能体解释</h2>
            <span>结果上下文已注入</span>
          </div>
          <div class="chat-host">
            <div v-if="!assessment" class="empty-chat">完成后端测算后生成解释、追问和报告组织。</div>
            <AgentChatPanel
              v-else
              :key="agentKey"
              scenario="chat"
              :initial-question="agentQuestion"
              :payload="agentPayload"
              :prompt-key="promptKey"
              history-key="storage_copilot"
              @done="onAgentDone"
            />
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.storage-copilot {
  gap: 14px;
}

.merged-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.merged-metrics .metric-card {
  min-height: 118px;
}

.merged-metrics .metric-card em {
  color: var(--muted, #667085);
}

.command-panel {
  display: grid;
  gap: 12px;
}

.command-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(130px, 0.6fr) minmax(220px, auto) auto auto auto minmax(72px, auto);
  align-items: center;
  gap: 10px;
}

.basis-pill {
  justify-self: end;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.1);
  color: var(--primary, #0f766e);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.intent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
  align-items: stretch;
}

.intent-actions {
  display: grid;
  gap: 8px;
  align-content: start;
}

.intent-patch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel-sub, #f8fafc);
}

.intent-patch span {
  padding: 3px 7px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--line-soft, #e5e7eb);
  font-size: 12px;
  color: var(--text-body, #344054);
}

.intent-patch em {
  color: var(--muted, #667085);
  font-size: 12px;
  font-style: normal;
}

.workbench-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(460px, 560px);
  gap: 14px;
  align-items: start;
  width: 100%;
  min-width: 0;
}

.calc-workspace,
.results-stack,
.agent-workspace {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.results-stack {
  width: 100%;
  overflow: hidden;
}

.results-stack > *,
.chart-pair > div {
  min-width: 0;
  max-width: 100%;
}

.agent-workspace {
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 88px);
  grid-template-rows: auto minmax(132px, auto) minmax(0, 1fr);
  overflow: hidden;
}

.section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
}

.section-heading h2 {
  margin: 0;
  color: var(--text, #111827);
  font-size: 16px;
}

.section-heading span {
  color: var(--muted, #667085);
  font-size: 12px;
  text-align: right;
}

.params-panel {
  overflow: hidden;
}

.panel {
  min-width: 0;
}

.storage-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}

.storage-tabs :deep(.el-tabs__nav-wrap) {
  min-width: 0;
}

.toggle-grid,
.select-grid,
.storage-form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  gap: 10px;
}

.toggle-grid {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.select-grid {
  margin-bottom: 12px;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
}

.select-grid label,
.storage-form-grid label {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.select-grid span,
.storage-form-grid span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-body);
  font-size: 12px;
}

.select-grid small,
.storage-form-grid small {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.select-grid :deep(.el-select),
.storage-form-grid :deep(.el-input-number) {
  width: 100%;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.result-grid > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.run-steps {
  padding: 12px;
}

ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

li {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 8px;
  align-items: start;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel-sub, #f8fafc);
}

li i {
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 50%;
  background: #cbd5e1;
}

li.running i {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14);
}

li.done i {
  background: #16a34a;
}

li.error i {
  background: #dc2626;
}

li strong {
  display: block;
  font-size: 13px;
  color: var(--text, #111827);
}

li span,
li em {
  display: block;
  font-size: 12px;
  color: var(--muted, #667085);
  font-style: normal;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.chart-panel,
.chart-pair {
  min-width: 0;
}

.chart-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.storage-chart {
  width: 100%;
  min-width: 0;
  height: 280px;
}

:deep(.el-table) {
  width: 100% !important;
  max-width: 100%;
}

.table-shell {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
}

.table-shell :deep(.el-table) {
  min-width: 1250px;
}

.compact-table :deep(.el-table) {
  min-width: 560px;
}

.revenue-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.revenue-strip article {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
}

.revenue-strip span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.revenue-strip strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
  overflow-wrap: anywhere;
}

.compact-title {
  margin-bottom: 8px;
}

.history-panel {
  display: grid;
  gap: 8px;
  max-height: 180px;
  overflow: auto;
}

.history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  padding: 8px;
}

.history-item button {
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.history-item strong {
  display: block;
  color: var(--text, #111827);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.history-item span {
  display: block;
  margin-top: 3px;
  color: var(--muted, #667085);
  font-size: 12px;
  line-height: 1.45;
}

.agent-panel {
  min-height: clamp(540px, 58vh, 640px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-host {
  flex: 1;
  min-height: 0;
}

.empty-chat,
.empty-small,
.error-box {
  display: grid;
  place-items: center;
  min-height: 120px;
  padding: 18px;
  color: var(--muted, #667085);
  font-size: 13px;
  text-align: center;
  line-height: 1.6;
}

.error-box {
  border: 1px solid rgba(220, 38, 38, 0.22);
  border-radius: 8px;
  background: rgba(254, 226, 226, 0.45);
  color: #b91c1c;
}

@media (max-width: 1500px) {
  .command-toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .basis-pill {
    justify-self: start;
  }

  .workbench-layout {
    grid-template-columns: minmax(0, 1fr) minmax(440px, 500px);
  }

  .storage-form-grid,
  .toggle-grid {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  ol {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1280px) {
  .workbench-layout {
    grid-template-columns: minmax(0, 1fr) minmax(420px, 460px);
  }

  .storage-form-grid,
  .toggle-grid {
    grid-template-columns: repeat(2, minmax(140px, 1fr));
  }
}

@media (max-width: 1180px) {
  .workbench-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-workspace {
    position: static;
    max-height: none;
    grid-template-rows: auto;
    overflow: visible;
  }

  .agent-panel {
    min-height: 560px;
  }
}

@media (max-width: 860px) {
  .merged-metrics,
  .command-toolbar,
  .intent-row,
  .chart-pair,
  .result-grid,
  .revenue-strip,
  .storage-form-grid,
  .toggle-grid,
  .select-grid,
  ol {
    grid-template-columns: minmax(0, 1fr);
  }

  .intent-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .storage-chart {
    height: 250px;
  }
}
</style>
