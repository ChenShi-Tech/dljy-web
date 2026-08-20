/**
 * 报表中心预置模板与区块定义（全主体通用 P0 批次）。
 *
 * 模板 = 一组区块（blockIds） + 参数 schema + 适用主体/地区。区块的实际取数与口径计算
 * 由 reportBlocks.ts 的 BlockBuilder 实现（注册到 reportEngine）。这里只声明「报表长什么样」。
 *
 * 数据可信度：当前所有区块基于合成 / 采集回放数据（明确标注 mock），口径公式来自
 * 受控结算能力（真实、可验证）。真实生产取数在后续阶段按 endpoint 替换。
 */
import type { ReportTemplate, ReportBlock } from '@/services/reports/types'

/** 区块字典（被模板按 blockId 引用；同时供报表中心“区块配置”页展示）。 */
export const reportBlocks: ReportBlock[] = [
  { blockId: 'RB-SPOT-PRICE-CHART', blockName: '日前/实时价格走势', blockType: 'CHART', sourceModules: ['market'], metrics: ['日前价', '实时价', '日前-实时价差'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-ANALYSIS-PRICE-DURATION', blockName: '日前价持续曲线（契约图表）', blockType: 'CHART', sourceModules: ['market'], metrics: ['日前价持续曲线'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-PRICE-STATS', blockName: '价格统计指标', blockType: 'METRIC', sourceModules: ['market'], metrics: ['均价', '峰谷价差', 'P5/P50/P95', '负电价时段'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-CLEARING-TABLE', blockName: '出清电量电价（96点）', blockType: 'TABLE', sourceModules: ['market'], metrics: ['出清电量', '出清电价', '统一结算点价'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-BID-COMPARE', blockName: '申报vs出清中标率', blockType: 'TABLE', sourceModules: ['trading', 'market'], metrics: ['申报电量', '中标电量', '中标率'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-SETTLEMENT-THREE-PART', blockName: '三部制结算单', blockType: 'SETTLEMENT', sourceModules: ['settlement'], metrics: ['中长期电费', '日前偏差电费', '实时偏差电费', '综合结算电价'], refreshMode: '审核前重算', dataLayer: 'audit', status: '已启用' },
  { blockId: 'RB-DEVIATION-ASSESS', blockName: '偏差考核明细', blockType: 'TABLE', sourceModules: ['settlement', 'forecast'], metrics: ['偏差电量', '偏差率', '免考核带', '考核费用'], refreshMode: '审核前重算', dataLayer: 'audit', status: '已启用' },
  { blockId: 'RB-REVENUE-DECOMP', blockName: '收益三段分解', blockType: 'CHART', sourceModules: ['settlement'], metrics: ['中长期收益', '日前偏差收益', '实时偏差收益'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-REVENUE-ATTRIBUTION', blockName: '收益归因', blockType: 'TABLE', sourceModules: ['settlement'], metrics: ['分项金额', '占比', '合计'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-HEDGE-EXPOSURE', blockName: '持仓覆盖与敞口', blockType: 'METRIC', sourceModules: ['trading', 'forecast'], metrics: ['持仓覆盖率', '未对冲敞口'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-RETAIL-SPREAD', blockName: '售电批零价差', blockType: 'METRIC', sourceModules: ['retail', 'settlement'], metrics: ['批零价差', '购电成本', '度电毛利'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-UNIT-COST', blockName: '发电度电成本', blockType: 'METRIC', sourceModules: ['settlement'], metrics: ['度电边际成本', '度电收入', '度电毛利'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-AI-SUMMARY', blockName: 'AI 经营解读', blockType: 'AI_TEXT', sourceModules: ['market', 'settlement'], metrics: ['关键结论', '风险提示', '建议动作'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '待业务复核' },
  { blockId: 'RB-STORAGE-ARBITRAGE', blockName: '储能峰谷套利', blockType: 'METRIC', sourceModules: ['trading', 'settlement'], metrics: ['峰谷价差', '度电套利', '循环次数', '日均收益'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-CONTRACT-PROGRESS', blockName: '合同执行跟踪', blockType: 'TABLE', sourceModules: ['trading'], metrics: ['合同电量', '已执行', '执行率', '到期预警'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-GREEN-TRADE', blockName: '绿电交易与环境价值', blockType: 'METRIC', sourceModules: ['trading', 'settlement'], metrics: ['绿电电量', '绿证', '环境溢价', '环境价值'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  // issue #455 现货日报新增区块（结算三价 / 出力完成率 / 出力预测 MAPE）
  { blockId: 'RB-SETTLEMENT-PRICES', blockName: '结算三价', blockType: 'METRIC', sourceModules: ['market', 'settlement'], metrics: ['日前出清均价', '实时出清均价', '中长期合约均价', '价格口径'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-OUTPUT-COMPLETION', blockName: '出力完成率', blockType: 'METRIC', sourceModules: ['forecast', 'settlement'], metrics: ['日前计划出力', '实际出力', '完成率', '偏差电量'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' },
  { blockId: 'RB-FORECAST-MAPE', blockName: '出力预测 MAPE', blockType: 'METRIC', sourceModules: ['forecast'], metrics: ['MAPE', '评估点数', '总偏差电量', '口径'], refreshMode: '生成时刷新', dataLayer: 'mart', status: '已启用' }
]

const now = '2026-06-15T09:00:00+08:00'

/** 预置 P0 报表模板（全主体通用，按 subjectType 切换口径）。 */
export const reportTemplates: ReportTemplate[] = [
  {
    templateId: 'RPT-DAILY-SPOT',
    templateName: '现货交易日报',
    reportType: 'DAILY',
    version: 'v202606',
    ownerRole: '交易负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-PRICE-STATS', 'RB-SPOT-PRICE-CHART', 'RB-ANALYSIS-PRICE-DURATION', 'RB-CLEARING-TABLE', 'RB-BID-COMPARE', 'RB-SETTLEMENT-PRICES', 'RB-OUTPUT-COMPLETION', 'RB-FORECAST-MAPE', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L3',
    status: '已启用',
    updatedAt: now,
    domain: 'F-行情/B-出清',
    priority: 'P0',
    subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'],
    paramSchema: { time: { granularity: 'POINT_96', mode: 'date' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'], market: ['日前', '实时'] }
  },
  {
    templateId: 'RPT-MONTHLY-SETTLEMENT',
    templateName: '结算月报（三部制结算单）',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '结算专员',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-SETTLEMENT-THREE-PART', 'RB-DEVIATION-ASSESS', 'RB-REVENUE-ATTRIBUTION', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L4',
    status: '已启用',
    updatedAt: now,
    domain: 'C-结算',
    priority: 'P0',
    subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'], market: ['中长期', '日前', '实时'] }
  },
  {
    templateId: 'RPT-REVENUE-ANALYSIS',
    templateName: '收益分析报表',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '交易负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-REVENUE-DECOMP', 'RB-REVENUE-ATTRIBUTION', 'RB-UNIT-COST', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L4',
    status: '已启用',
    updatedAt: now,
    domain: 'D-收益',
    priority: 'P0',
    subjectTypes: ['GENERATOR', 'RETAILER'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER'], market: ['中长期', '日前', '实时'] }
  },
  {
    templateId: 'RPT-DEVIATION-ASSESSMENT',
    templateName: '偏差与考核报表',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '风控负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-DEVIATION-ASSESS', 'RB-HEDGE-EXPOSURE', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L4',
    status: '已启用',
    updatedAt: now,
    domain: 'E-偏差/考核',
    priority: 'P0',
    subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER', 'LOAD'], market: ['日前', '实时'] }
  },
  {
    templateId: 'RPT-OPERATIONS',
    templateName: '经营运营报表',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '老板',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-RETAIL-SPREAD', 'RB-UNIT-COST', 'RB-PRICE-STATS', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L5',
    status: '已启用',
    updatedAt: now,
    domain: 'H-经营',
    priority: 'P0',
    subjectTypes: ['GENERATOR', 'RETAILER'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER'] }
  },
  {
    templateId: 'RPT-STORAGE-ARBITRAGE',
    templateName: '储能套利日报',
    reportType: 'DAILY',
    version: 'v202606',
    ownerRole: '交易负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-STORAGE-ARBITRAGE', 'RB-PRICE-STATS', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L3',
    status: '已启用',
    updatedAt: now,
    domain: 'F-储能',
    priority: 'P1',
    subjectTypes: ['STORAGE'],
    paramSchema: { time: { granularity: 'POINT_96', mode: 'date' }, region: true, subjectTypes: ['STORAGE'], market: ['日前', '实时'] }
  },
  {
    templateId: 'RPT-CONTRACT-EXEC',
    templateName: '合同执行跟踪月报',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '交易负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-CONTRACT-PROGRESS', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L4',
    status: '已启用',
    updatedAt: now,
    domain: 'B-合同',
    priority: 'P1',
    subjectTypes: ['GENERATOR', 'RETAILER'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER'] }
  },
  {
    templateId: 'RPT-GREEN-POWER',
    templateName: '绿电交易月报',
    reportType: 'MONTHLY',
    version: 'v202606',
    ownerRole: '交易负责人',
    dataScopePreset: 'area:current + subject:current',
    blockIds: ['RB-GREEN-TRADE', 'RB-AI-SUMMARY'],
    exportFormats: ['CSV', 'Excel'],
    approvalGate: 'L4',
    status: '已启用',
    updatedAt: now,
    domain: 'G-绿电',
    priority: 'P1',
    subjectTypes: ['GENERATOR', 'RETAILER'],
    paramSchema: { time: { mode: 'month' }, region: true, subjectTypes: ['GENERATOR', 'RETAILER'] }
  }
]

export function getTemplateById(templateId: string): ReportTemplate | undefined {
  return reportTemplates.find((t) => t.templateId === templateId)
}

export function getBlockById(blockId: string): ReportBlock | undefined {
  return reportBlocks.find((b) => b.blockId === blockId)
}
