export type OpsTab = 'stations' | 'contracts' | 'settlements' | 'risks' | 'imports' | 'models' | 'agents'

export interface OpsMetric {
  label: string
  value: number
  unit: string
  tone: 'blue' | 'green' | 'orange' | 'purple'
}

export interface StationRow {
  name: string
  type: string
  capacity: number
  voltageLevel: string
  status: string
  province: string
}

export interface ContractRow {
  code: string
  counterparty: string
  type: string
  volume: number
  price: number
  status: string
}

export interface SettlementRow {
  month: string
  energy: number
  income: number
  deviation: number
  status: string
}

export interface RiskRow {
  name: string
  level: '低' | '中' | '高'
  exposure: number
  threshold: number
  owner: string
}

export interface ImportTaskRow {
  name: string
  source: string
  rows: number
  status: string
  lastRun: string
}

export interface ModelVersionRow {
  name: string
  type: string
  version: string
  accuracy: number
  status: string
}

export interface AgentRow {
  name: string
  role: string
  tasks: number
  successRate: number
  status: string
}

export interface OperationsDataset {
  metrics: Record<OpsTab, OpsMetric[]>
  stations: StationRow[]
  contracts: ContractRow[]
  settlements: SettlementRow[]
  risks: RiskRow[]
  imports: ImportTaskRow[]
  models: ModelVersionRow[]
  agents: AgentRow[]
}

export function getOperationsDataset(): OperationsDataset {
  const stations: StationRow[] = [
    { name: '华能火电厂', type: '火电', capacity: 1200, voltageLevel: '500kV', status: '运行', province: '山西' },
    { name: '晋北风电场', type: '风电', capacity: 300, voltageLevel: '220kV', status: '运行', province: '山西' },
    { name: '太行光伏站', type: '光伏', capacity: 180, voltageLevel: '110kV', status: '运行', province: '山西' },
    { name: '共享储能A站', type: '储能', capacity: 100, voltageLevel: '220kV', status: '试运行', province: '山西' }
  ]

  const contracts: ContractRow[] = [
    { code: 'ML-2026-001', counterparty: '国网售电', type: '中长期', volume: 128.6, price: 0.382, status: '执行中' },
    { code: 'SPOT-2026-041', counterparty: '现货市场', type: '日前现货', volume: 32.4, price: 0.486, status: '滚动执行' },
    { code: 'GREEN-2026-012', counterparty: '园区用户', type: '绿电套餐', volume: 18.8, price: 0.438, status: '执行中' },
    { code: 'AUX-2026-006', counterparty: '辅助服务市场', type: '调频', volume: 6.2, price: 0.65, status: '结算中' }
  ]

  const settlements: SettlementRow[] = [
    { month: '1月', energy: 82.5, income: 31680, deviation: 1.8, status: '已结算' },
    { month: '2月', energy: 79.3, income: 30390, deviation: -0.9, status: '已结算' },
    { month: '3月', energy: 91.6, income: 36210, deviation: 2.6, status: '已结算' },
    { month: '4月', energy: 88.2, income: 34920, deviation: -1.4, status: '复核中' }
  ]

  const risks: RiskRow[] = [
    { name: '日前价格偏离', level: '中', exposure: 1280, threshold: 2000, owner: '交易决策' },
    { name: '合同履约偏差', level: '低', exposure: 420, threshold: 1500, owner: '合同管理' },
    { name: '售电套餐倒挂', level: '高', exposure: 2680, threshold: 2200, owner: '零售经营' },
    { name: '预测误差放大', level: '中', exposure: 960, threshold: 1800, owner: '预测模型' }
  ]

  const imports: ImportTaskRow[] = [
    { name: '市场交易导入', source: 'market_trades.xlsx', rows: 12580, status: '可复用', lastRun: '2026-06-04' },
    { name: '零售结算导入', source: 'retail_settlement.xlsx', rows: 6890, status: '可复用', lastRun: '2026-06-03' },
    { name: '气象数据同步', source: 'weather_api', rows: 5280, status: '接入中', lastRun: '2026-06-04' },
    { name: '模型训练样本', source: 'prediction_dataset', rows: 96720, status: '可复用', lastRun: '2026-06-02' }
  ]

  const models: ModelVersionRow[] = [
    { name: '日前价格预测', type: 'price', version: 'stacking_20260512', accuracy: 86.4, status: '可迁移' },
    { name: '新能源出力预测', type: 'generation', version: 'xgboost_20260512', accuracy: 89.1, status: '可迁移' },
    { name: '负荷预测', type: 'load', version: 'ensemble_20260430', accuracy: 84.8, status: '待校验' },
    { name: '偏差风险评分', type: 'risk', version: 'bayesian_202604', accuracy: 82.7, status: '可迁移' }
  ]

  const agents: AgentRow[] = [
    { name: '市场分析智能体', role: '行情解释', tasks: 126, successRate: 94.2, status: '在线' },
    { name: '交易决策智能体', role: 'OODA策略', tasks: 88, successRate: 91.6, status: '在线' },
    { name: '风控智能体', role: '风险阈值', tasks: 73, successRate: 96.8, status: '在线' },
    { name: '结算复盘智能体', role: '偏差归因', tasks: 52, successRate: 89.4, status: '待融合' }
  ]

  return {
    metrics: {
      stations: [
        { label: '电站数量', value: stations.length, unit: '座', tone: 'green' },
        { label: '总装机', value: stations.reduce((sum, row) => sum + row.capacity, 0), unit: 'MW', tone: 'blue' },
        { label: '运行中', value: stations.filter((row) => row.status === '运行').length, unit: '座', tone: 'purple' },
        { label: '储能容量', value: stations.filter((row) => row.type === '储能').reduce((sum, row) => sum + row.capacity, 0), unit: 'MW', tone: 'orange' }
      ],
      contracts: [
        { label: '合同数量', value: contracts.length, unit: '份', tone: 'blue' },
        { label: '合同电量', value: Number(contracts.reduce((sum, row) => sum + row.volume, 0).toFixed(1)), unit: '亿kWh', tone: 'green' },
        { label: '均价', value: Number((contracts.reduce((sum, row) => sum + row.price * row.volume, 0) / contracts.reduce((sum, row) => sum + row.volume, 0)).toFixed(4)), unit: '元/kWh', tone: 'orange' },
        { label: '执行中', value: contracts.filter((row) => row.status.includes('执行')).length, unit: '份', tone: 'purple' }
      ],
      settlements: [
        { label: '结算月份', value: settlements.length, unit: '个', tone: 'blue' },
        { label: '结算电量', value: Number(settlements.reduce((sum, row) => sum + row.energy, 0).toFixed(1)), unit: '亿kWh', tone: 'green' },
        { label: '结算收入', value: settlements.reduce((sum, row) => sum + row.income, 0), unit: '万元', tone: 'purple' },
        { label: '平均偏差', value: Number((settlements.reduce((sum, row) => sum + Math.abs(row.deviation), 0) / settlements.length).toFixed(1)), unit: '%', tone: 'orange' }
      ],
      risks: [
        { label: '风险事项', value: risks.length, unit: '项', tone: 'orange' },
        { label: '高风险', value: risks.filter((row) => row.level === '高').length, unit: '项', tone: 'purple' },
        { label: '敞口合计', value: risks.reduce((sum, row) => sum + row.exposure, 0), unit: '万元', tone: 'blue' },
        { label: '超阈值', value: risks.filter((row) => row.exposure > row.threshold).length, unit: '项', tone: 'green' }
      ],
      imports: [
        { label: '导入任务', value: imports.length, unit: '个', tone: 'blue' },
        { label: '数据行数', value: imports.reduce((sum, row) => sum + row.rows, 0), unit: '行', tone: 'green' },
        { label: '可复用', value: imports.filter((row) => row.status === '可复用').length, unit: '个', tone: 'purple' },
        { label: '接入中', value: imports.filter((row) => row.status === '接入中').length, unit: '个', tone: 'orange' }
      ],
      models: [
        { label: '模型数量', value: models.length, unit: '个', tone: 'blue' },
        { label: '平均精度', value: Number((models.reduce((sum, row) => sum + row.accuracy, 0) / models.length).toFixed(1)), unit: '%', tone: 'green' },
        { label: '可迁移', value: models.filter((row) => row.status === '可迁移').length, unit: '个', tone: 'purple' },
        { label: '待校验', value: models.filter((row) => row.status === '待校验').length, unit: '个', tone: 'orange' }
      ],
      agents: [
        { label: '智能体', value: agents.length, unit: '个', tone: 'purple' },
        { label: '任务数', value: agents.reduce((sum, row) => sum + row.tasks, 0), unit: '次', tone: 'green' },
        { label: '平均成功率', value: Number((agents.reduce((sum, row) => sum + row.successRate, 0) / agents.length).toFixed(1)), unit: '%', tone: 'blue' },
        { label: '在线', value: agents.filter((row) => row.status === '在线').length, unit: '个', tone: 'orange' }
      ]
    },
    stations,
    contracts,
    settlements,
    risks,
    imports,
    models,
    agents
  }
}
