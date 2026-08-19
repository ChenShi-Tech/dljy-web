// 报表 AI 经营解读系统提示（统一前端 prompt 管理：报表层）。
//
// 用于报表「RB-AI-SUMMARY」区块：把已计算指标交给大模型生成三段式经营解读。
// ⚠️ 输出契约硬约束：必须只输出 {"sections":[{"title","body"}, ...]} JSON
// reportBlocks.ts 据此解析，失败才降级为规则模板，改 schema 会触发降级。
import type { ChatMessage } from '../services/llm'

/** 报表解读输入指标（由 reportBlocks 装配后传入）。 */
export type ReportInsightMetrics = {
  regionLabel: string
  maturity: string
  subjectType?: string
  tradeDate?: string
  month?: string
  mean: number
  peakValleySpread: number
  negativeCount: number
  settlementPrice: number
  totalFee: number
  mediumLongFee: number
  dayAheadDeviationFee: number
  realtimeDeviationFee: number
}

const wan = (v: number) => Math.round((v / 10000) * 100) / 100 // 元 → 万元，保留 2 位

export function buildReportInsightPrompt(m: ReportInsightMetrics): ChatMessage[] {
  const period = m.month ?? m.tradeDate ?? '本期'
  const subject = m.subjectType ?? '发电企业'
  const system =
    '你是资深电力现货交易分析师。请基于给定的报表指标生成简明经营解读，严格分三段：关键结论、风险提示、建议动作。' +
    '只能使用给定数据，不得编造未提供的数字或事实；数据不足以判断时简要说明。' +
    '解读要结合峰谷价差、负电价时段、中长期与现货偏差电费的结构，用电力交易术语，结论可落地。用中文，每段 2-4 句。' +
    '只输出 JSON：{"sections":[{"title":"关键结论","body":"..."},{"title":"风险提示","body":"..."},{"title":"建议动作","body":"..."}]}'
  const user =
    `报表期间：${period}；地区口径：${m.regionLabel}（成熟度：${m.maturity}）；主体类型：${subject}。\n` +
    `已计算指标：\n` +
    `- 日前均价 ${m.mean} 元/MWh，峰谷价差 ${m.peakValleySpread} 元/MWh，负电价时段 ${m.negativeCount} 个\n` +
    `- 综合结算电价 ${m.settlementPrice} 元/MWh，总电费 ${wan(m.totalFee)} 万元\n` +
    `- 中长期电费 ${wan(m.mediumLongFee)} 万元，日前偏差电费 ${wan(m.dayAheadDeviationFee)} 万元，实时偏差电费 ${wan(m.realtimeDeviationFee)} 万元\n` +
    `请据此输出三段式经营解读 JSON。`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}
