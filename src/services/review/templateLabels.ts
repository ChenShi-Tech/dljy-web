// 复盘模板注册表（shared/ 契约面，只读）里的来源代号与口径枚举是给代码和门禁用的，
// 说明文字里满是接口名、数据族与迁移编号。页面上一律换成交易员看得懂的业务名称。
import { roleLabels } from '@/services/governance'

/** 数据来源 → 业务名称。注册表每新增一个来源都必须在这里登记，由单测守住。 */
export const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  quant_review: '偏差考核测算',
  quant_settlement_review: '云南结算核对',
  quant_backtest: '申报回测',
  quant_risk_engine: '风险与报价测算（决策参考）',
  quant_storage_backtest: '储能峰谷套利回测',
  declaration_record: '申报单记录',
  declaration_preflight: '一日作业留痕',
  clearing_price: '出清价格',
  loss_attribution: '云南偏差三段归因',
  trading_memory: '历史交易胜率统计',
  settlement_rules: '分省结算规则',
  review_pg: '复盘台账',
  investment_runs: '储能投资测算记录',
  storage_dispatch_plan: '储能充放电测算',
  forecast_output: '预测结果',
  cgn_station_rt: '场站实际出力',
  market_disclosure: '市场披露数据',
  identity: '填表与审核人记录',
  manual_entry: '人工录入',
})

/** 未登记的来源不回显代号，只说明是系统来源。 */
export function sourceLabel(source: string | undefined): string {
  return (source && SOURCE_LABELS[source]) || '系统来源'
}

/** 口径枚举 → 业务说明。金额类字段是自算口径，必须让读者知道它不是正式结算。 */
export const CALIBER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'self-computed': '系统自算，非正式结算',
})

export function caliberLabel(caliber: string | undefined): string {
  return (caliber && CALIBER_LABELS[caliber]) || '口径待核实'
}

/** 复盘周期代码 → 业务说明。 */
export const CADENCE_LABELS: Readonly<Record<string, string>> = Object.freeze({ daily: '每日', weekly: '每周', monthly: '每月', quarterly: '每季', event: '事件触发', continuous: '持续记录' })
export function cadenceLabel(cadence: string): string { return CADENCE_LABELS[cadence] ?? '按需' }

/** 模板里的岗位代码 → 中文岗位名。优先用平台统一的角色名，模板专用岗位在此补齐。 */
export const TEMPLATE_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({ RENEWABLE_OPERATOR: '新能源运营', RETAIL: '售电人员', SYSTEM: '系统自动' })
export function roleLabel(role: string): string {
  return TEMPLATE_ROLE_LABELS[role] ?? (roleLabels as Record<string, string>)[role] ?? '指定岗位'
}

/** 依赖这些来源的模板，价格默认是演示值，页面必须明示为模拟数据。 */
export const MOCK_PRICE_SOURCES: ReadonlySet<string> = new Set(['storage_dispatch_plan'])
