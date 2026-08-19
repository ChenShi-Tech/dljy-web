import { listExcelTemplateDeclarations } from 'shared/schema/source-registry.mjs'
import type { ExcelTemplateDeclaration } from '@/utils/importTemplate'

// #768：Excel 标准模板声明 facade，页面经此读声明，不越过 service 直读 shared/schema/**
// （verify:arch-boundaries 守卫2：views 不得直连 shared/schema）。type-only 引用 importTemplate
// 使 xlsx 仍只在下载时懒加载进 bundle。
export type { ExcelTemplateDeclaration }

export function listImportTemplateDeclarations(): ExcelTemplateDeclaration[] {
  return listExcelTemplateDeclarations() as ExcelTemplateDeclaration[]
}

export type ImportHubTab = 'electricity' | 'retail' | 'settlement' | 'retailSettlement' | 'trading' | 'customerLoad' | 'marketOps'

export interface ImportMetric {
  label: string
  value: number | string
  unit: string
  tone: 'blue' | 'green' | 'orange' | 'purple'
}

export interface ImportTaskRow {
  type: ImportHubTab
  label: string
  template: string
  endpoint: string
  requiredFields: string[]
  supportedFormats: string[]
  reusable: boolean
}

export interface ImportHistoryRow {
  id: number
  filename: string
  type: ImportHubTab
  status: '成功' | '失败' | '预览'
  rows: number
  validRows: number
  invalidRows: number
  date: string
}

export interface RetailSettlementRow {
  settlementUnitId: string
  settlementUnitName: string
  month: string
  timeSlot: number
  timeSlotName?: string
  contractSettlementFee: number
  balanceAccountIncome: number
  balanceAccountOutcome: number
  deviationRecoveryFee: number
  clearingFee?: number
  balanceAccountShare?: number
  spotDayAheadFee: number
  spotRealTimeFee: number
  spotImbalanceFee?: number
  retailElectricityFee: number
  revenueElectricityFee: number
  settlementQuantity: number
  revenuePerKwh: number
}

export interface ImportHubDataset {
  metrics: Record<ImportHubTab, ImportMetric[]>
  tasks: ImportTaskRow[]
  history: ImportHistoryRow[]
  retailSettlementPreview: RetailSettlementRow[]
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function getImportHubDataset(): ImportHubDataset {
  const tasks: ImportTaskRow[] = [
    {
      type: 'electricity',
      label: '电量数据导入',
      template: 'electricity_import_template.xlsx',
      endpoint: '/api/v1/power/import',
      requiredFields: ['电站ID', '日期', '时段', '实际上网电量', '预测电量'],
      supportedFormats: ['xlsx', 'xls', 'csv'],
      reusable: true
    },
    {
      // P3 零售套餐接入（链路 A）：复用 P2 投递型分支 /api/v1/market-analysis/import，
      // 固定 datasetKey=market_packages（与 MarketOps「套餐」tab 同源，避免两套数据）。
      // 前端 ImportHubView 对 retail 上传带 datasetKey=market_packages + region。
      // #669：服务端按 datasetKey 把 market_packages 落 company 私有族 market_retail_packages
      // （归属 comp-cgn-yunnan，会话 companyId 定 owner），非归属公司会话投递被拒，端点/datasetKey 不变，仅落库族与归属收紧。
      type: 'retail',
      label: '零售套餐导入',
      template: 'retail_package_template.csv',
      endpoint: '/api/v1/market-analysis/import',
      requiredFields: ['售电公司', '用户名称', '套餐类型', '状态', '平段价', '峰段价', '谷段价', '套餐电量'],
      supportedFormats: ['csv'],
      reusable: true
    },
    {
      type: 'settlement',
      label: '结算数据导入',
      template: 'settlement_template.xlsx',
      endpoint: '/api/v1/settlements/import',
      requiredFields: ['结算月份', '结算对象', '电量', '电费', '偏差费用'],
      supportedFormats: ['xlsx', 'xls', 'csv'],
      reusable: true
    },
    {
      // P4 售电结算接入（链路 A 例外）：走 agent-backend 已写好的
      // POST /api/v1/retail-settlement-import/upload（UploadFile+pandas，落 RetailSettlementDetail 实体）。
      // 前端 ImportHubView 对 retailSettlement 用 FormData + fetch /agent-api（不经 apiPost/apiPathFromEndpoint）。
      // 字段对齐 agent-backend column_mapping：结算单元id/名称/月份/时段 必需 + 费用可选。
      type: 'retailSettlement',
      label: '售电结算导入',
      template: 'retail_settlement_template.csv',
      endpoint: '/api/v1/retail-settlement-import/upload',
      requiredFields: ['结算单元ID', '结算单元名称', '月份', '时段', '合同结算电费', '零售侧电费', '收益电费', '结算电量'],
      supportedFormats: ['xlsx', 'xls', 'csv'],
      reusable: true
    },
    {
      type: 'trading',
      label: '市场交易导入',
      template: 'market_trades_template.xlsx',
      endpoint: '/api/v1/market/trades/import',
      requiredFields: ['交易日期', '交易类型', '交易电量', '交易电价', '交易对手'],
      supportedFormats: ['xlsx', 'xls', 'csv'],
      reusable: true
    },
    {
      // P3 分主体数据通道：售电公司客户分时负荷（公司负荷预测准确率的根基数据）
      type: 'customerLoad',
      label: '客户分时负荷导入',
      template: 'customer_load_template.csv',
      endpoint: '/api/v1/customer-load/import',
      requiredFields: ['客户编号', '日期', '时段', '用电量'],
      supportedFormats: ['csv'],
      reusable: true
    },
    {
      // P2 投递型：市场经营分析 6 tab 手录 → capture-raw + capture.sqlite（链路 A）。
      // 上传时前端带 datasetKey（9 选 1）+ region；后端 import-hub-api.mjs 投递分支归一化落库，
      // 前端 MarketOps 页面经 fetchCaptured 真实回放（DataBasis=captured）。
      type: 'marketOps',
      label: '市场经营分析导入',
      template: 'market_analysis_template.csv',
      endpoint: '/api/v1/market-analysis/import',
      requiredFields: ['按所选数据类型填写（交易汇总/月度趋势/发电/售电/储能/套餐/价格/指标）'],
      supportedFormats: ['csv'],
      reusable: true
    }
  ]

  const history: ImportHistoryRow[] = [
    { id: 1, filename: 'retail_settlement_2026_04.xlsx', type: 'retailSettlement', status: '成功', rows: 2304, validRows: 2298, invalidRows: 6, date: '2026-06-04' },
    { id: 2, filename: 'market_trades_2026_q1.xlsx', type: 'trading', status: '成功', rows: 12580, validRows: 12580, invalidRows: 0, date: '2026-06-03' },
    { id: 3, filename: 'retail_packages_2026.xlsx', type: 'retail', status: '预览', rows: 426, validRows: 420, invalidRows: 6, date: '2026-06-03' },
    { id: 4, filename: 'generation_actual_2026_04.csv', type: 'electricity', status: '成功', rows: 2880, validRows: 2880, invalidRows: 0, date: '2026-06-02' },
    { id: 5, filename: 'settlement_march.xlsx', type: 'settlement', status: '失败', rows: 730, validRows: 682, invalidRows: 48, date: '2026-06-01' }
  ]

  const retailSettlementPreview: RetailSettlementRow[] = Array.from({ length: 8 }, (_, index) => {
    const slot = index + 1
    const quantity = 520 + index * 18
    const retailFee = quantity * (0.43 + index * 0.002)
    const contractFee = quantity * (0.38 + index * 0.001)
    const spotDayAheadFee = quantity * (index % 3 === 0 ? 0.018 : -0.006)
    const spotRealTimeFee = quantity * (index % 4 === 0 ? -0.012 : 0.009)
    const revenue = retailFee - contractFee - spotDayAheadFee - spotRealTimeFee
    return {
      settlementUnitId: `SU-2026-${String(index + 1).padStart(3, '0')}`,
      settlementUnitName: `售电结算单元${index + 1}`,
      month: '2026-04',
      timeSlot: slot,
      contractSettlementFee: round(contractFee, 2),
      balanceAccountIncome: round(quantity * 0.006, 2),
      balanceAccountOutcome: round(quantity * 0.004, 2),
      deviationRecoveryFee: round(quantity * (index % 2 === 0 ? 0.003 : 0.008), 2),
      spotDayAheadFee: round(spotDayAheadFee, 2),
      spotRealTimeFee: round(spotRealTimeFee, 2),
      retailElectricityFee: round(retailFee, 2),
      revenueElectricityFee: round(revenue, 2),
      settlementQuantity: round(quantity, 2),
      revenuePerKwh: round(revenue / quantity, 4)
    }
  })

  const buildMetrics = (tab: ImportHubTab): ImportMetric[] => {
    const rows = history.filter((row) => row.type === tab)
    const preview = tab === 'retailSettlement' ? retailSettlementPreview : []
    return [
      { label: '导入任务', value: rows.length || 1, unit: '次', tone: 'blue' },
      { label: '有效行数', value: rows.reduce((sum, row) => sum + row.validRows, 0) || preview.length, unit: '行', tone: 'green' },
      { label: '异常行数', value: rows.reduce((sum, row) => sum + row.invalidRows, 0), unit: '行', tone: 'orange' },
      { label: '可复用模板', value: tasks.find((task) => task.type === tab)?.reusable ? '是' : '否', unit: '', tone: 'purple' }
    ]
  }

  return {
    metrics: {
      electricity: buildMetrics('electricity'),
      retail: buildMetrics('retail'),
      settlement: buildMetrics('settlement'),
      retailSettlement: buildMetrics('retailSettlement'),
      trading: buildMetrics('trading'),
      customerLoad: buildMetrics('customerLoad'),
      marketOps: buildMetrics('marketOps')
    },
    tasks,
    history,
    retailSettlementPreview
  }
}
