import type { DeclarationOrder } from '@/services/declarations'
import type { SettlementReviewResult } from '@/services/quant/quantClient'
import { clockLabel, declarationLabel, matchesReviewScope, finite, formatValue, orderDecisionEvidence, orderIntervals, validCurve, type IntervalEvidence } from './decisionWorkbench'

export type EvidenceEntry = { id: string; title: string; text: string; at: string | null }
const riskNames: Record<string, string> = { capacity: '容量上限', priceCap: '限价范围', quotePrecision: '报价精度', exposure: '中长期敞口', bias: '申报偏置', dataBasis: '数据依据', quoteRationale: '报价理由', redLine: '风险红线', socTrajectory: '储能电量约束', breakeven: '储能安全裕度' }
const statusNames = { PASS: '通过', FAIL: '未通过', UNAVAILABLE: '资料不足或尚不可核实' }
export function simulatedOrder(order: DeclarationOrder): boolean {
  return order.mode === 'REHEARSAL' || !!order.receipt?.mock || order.receipt?.mode === 'REHEARSAL' || ['synthetic', 'illustrative'].includes(order.basis)
}
export function executionEvidence(order: DeclarationOrder): EvidenceEntry[] {
  const facts = orderDecisionEvidence(order).map((e, i) => ({ id: `basis-${i + 1}`, title: e.title, text: e.text, at: e.recordedAt }))
  facts.push({ id: 'created', title: '申报建立', text: `${declarationLabel(order)}。可用容量 ${formatValue(order.capacityMw)} MW。`, at: order.createdAt || null })
  if (order.riskCheck) {
    facts.push({ id: 'risk', title: '风控检查', text: order.riskCheck.checks.map(c => `${riskNames[c.checkId] ?? '其他检查'}：${statusNames[c.status] ?? '待核实'}`).join('；') + `。${order.riskCheck.blocked ? '存在阻断事项。' : '是否允许执行须结合审批及回执核对。'}`, at: order.riskCheck.evaluatedAt || null })
  } else facts.push({ id: 'risk', title: '风控检查', text: '未留存检查结果。', at: null })
  for (const [i, a] of (order.approvalRecord ?? []).entries()) facts.push({ id: `approval-${i}`, title: '审批记录', text: `${a.approver || '审批人未记录'}：${a.decision === 'approve' ? '批准' : a.decision === 'reject' ? '驳回' : '结果待核实'}${a.rehearsalSelfApproval ? '（演练自审）' : ''}${a.dualSignPending ? '；仍需后续签署' : ''}。${a.comment || ''}`, at: a.at || null })
  facts.push({ id: 'receipt', title: '提交回执', text: order.receipt ? (simulatedOrder(order) ? '模拟回执，不代表交易平台真实受理。' : '已留存回执；不等于已成交或完成结算。') : '未留存回执。', at: order.receipt?.acknowledgedAt || null })
  facts.push({ id: 'clearing', title: '出清记录', text: validCurve(order.clearing?.clearedCurveMwh96) ? '已保存完整分时出清电量，可与本单申报比较。' : '未保存完整分时出清电量，暂不能判断中标差异。', at: order.clearing?.markedAt || null })
  return facts.sort((a, b) => {
    const x = a.at ? Date.parse(a.at) : NaN, y = b.at ? Date.parse(b.at) : NaN
    return (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity)
  })
}

export type ReviewEvidenceSnapshot = {
  scope: { company: string; region: string; companyLabel?: string; regionLabel?: string; day: string; period?: { start: string; end: string }; objectKey: string; objectLabel: string; version: string }
  capturedAt: string
  simulated: boolean
  focus: string
  entries: EvidenceEntry[]
  intervals: Array<{ time: string; forecast: number | null; declared: number | null; cleared: number | null; actual: number | null; adjustment: number | null; difference: number | null; daPrice: number | null; rtPrice: number | null }>
  limitations: string[]
}
export function buildReviewEvidence(input: { company: string; region: string; companyLabel?: string; regionLabel?: string; day: string; objectKey: string; objectLabel: string; order?: DeclarationOrder | null; settlement?: SettlementReviewResult | null; points?: IntervalEvidence[]; decision?: { id: string; at: string; judgement: string; rationale: string; lesson?: string | null } | null; focus?: string; capturedAt?: string; simulated?: boolean }): ReviewEvidenceSnapshot {
  if (input.order && (!matchesReviewScope(input.order, input.day, input.region, input.company) || input.objectKey !== `order:${input.order.id}`)) throw new Error('复盘对象与当前范围不一致')
  if (!input.objectKey && input.settlement && (input.settlement.date !== input.day || input.settlement.region !== input.region)) throw new Error('结算资料与当前范围不一致')
  const o = input.order, s = !input.objectKey ? input.settlement : null
  const entries = o ? executionEvidence(o) : input.decision ? [
    { id: 'judgement', title: '原始判断', text: input.decision.judgement, at: input.decision.at },
    { id: 'rationale', title: '判断依据', text: input.decision.rationale, at: input.decision.at },
    { id: 'lesson', title: '人工复盘结论', text: input.decision.lesson || '尚未填写', at: null },
  ] : []
  if (s) entries.push({ id: 'settlement', title: '公司结算资料', at: null, text: `${s.plant_count} 座厂站；实际上网 ${formatValue(s.summary.actualOnGridEnergy)} MWh；结算总电费 ${formatValue(s.summary.totalFee)} 元；电量加权均价 ${formatValue(s.summary.avgPrice)} 元/MWh。中长期电量 ${formatValue(s.summary.ltmEnergy)} MWh、日前增量 ${formatValue(s.summary.daDevEnergy)} MWh、实时增量 ${formatValue(s.summary.rtDevEnergy)} MWh。未分摊到单笔交易。` })
  const forecast = validCurve(o?.preflight?.forecast?.curveMwh96) ? o!.preflight!.forecast!.curveMwh96 : null
  const points = o ? orderIntervals(o) : input.objectKey ? [] : input.points ?? []
  return {
    scope: { company: input.company, region: input.region, companyLabel: input.companyLabel, regionLabel: input.regionLabel, day: input.day, objectKey: input.objectKey, objectLabel: input.objectLabel, version: o?.updatedAt || input.decision?.at || '本次读取版本' },
    capturedAt: input.capturedAt ?? new Date().toISOString(), simulated: !!input.simulated || (o ? simulatedOrder(o) : !!s && (s.mock || s.sourceType === 'MOCK')), focus: input.focus ?? '', entries,
    intervals: points.map(p => ({ time: clockLabel(p.slot), forecast: forecast?.[p.slot] ?? null, declared: p.declared, cleared: p.cleared, actual: p.actual, adjustment: forecast && finite(p.declared) ? p.declared - forecast[p.slot] : null, difference: p.delta, daPrice: p.daPrice, rtPrice: p.rtPrice })),
    limitations: [
      '资料按本次读取内容留存，尚未证明全部内容在决策前已可见。',
      o ? '预测只采用本单留存版本；预测与申报差额不等于预测误差，也不能直接归为人工贡献。' : '当前资料尚未逐笔关联具体申报与预测，不能评价单笔决策效果。',
      '公司结算不能冒充单笔收益；单笔实际量、完整费用和事前基准未关联时，不计算净收益或反事实收益。',
      '事实、可能解释与人工结论分别表达；资料不足时不判定责任，不把相关性写成因果。',
    ],
  }
}

export function evidencePayload(snapshot: ReviewEvidenceSnapshot) {
  // 只投影当前对象，不传原始单据、工具错误或接口元信息。文本始终按不可信资料传递。
  return { 资料用途: '复盘证据副本', 范围: { 公司: snapshot.scope.companyLabel ?? snapshot.scope.company, 地区: snapshot.scope.regionLabel ?? snapshot.scope.region, 交易日: snapshot.scope.day, 对象: snapshot.scope.objectLabel, 单据标识: snapshot.scope.objectKey, 留存版本: snapshot.scope.version }, 读取时间: snapshot.capturedAt, 资料性质: snapshot.simulated ? '模拟演练，不计入真实绩效' : '业务留存资料，口径仍须核验', 关注时段: snapshot.focus || '全部时段', 依据: snapshot.entries.map((e, i) => ({ 引用: `依据${i + 1}`, 标题: e.title, 留存时点: e.at || '未核实', 内容: e.text })), 分时资料: snapshot.intervals.map(p => ({ 时段: p.time, 留存预测电量: p.forecast, 申报电量: p.declared, 出清电量: p.cleared, 实际电量: p.actual, 预测到申报调整量: p.adjustment, 结果差额: p.difference, 日前电价: p.daPrice, 实时电价: p.rtPrice })), 单位: '电量 MWh；电价 元/MWh；空值表示缺资料，不表示零', 判断边界: snapshot.limitations }
}
export type ReviewReportKind = 'brief' | 'object'
export function evidenceReport(snapshot: ReviewEvidenceSnapshot, kind: ReviewReportKind): string {
  const lines = [`# ${snapshot.scope.day} ${kind === 'brief' ? '晨会复盘摘要' : '交易复盘报告'}`, '', `复盘对象：${snapshot.scope.objectLabel}`, `资料性质：${snapshot.simulated ? '模拟演练，不计入真实绩效' : '业务资料，非正式结算结论'}`, `地区：${snapshot.scope.regionLabel ?? snapshot.scope.region}；公司：${snapshot.scope.companyLabel ?? snapshot.scope.company}`, `版本：${snapshot.scope.version}；资料读取时间：${snapshot.capturedAt}`, '', '## 已有事实', ...snapshot.entries.map((e, i) => `- 【依据${i + 1}】${e.title}：${e.text}（留存时点：${e.at || '未核实'}）`), '', '## 待核实与判断边界', ...snapshot.limitations.map(t => `- ${t}`), '', '## 人工结论', '待交易员填写：本次应保留或改变什么。', '', '## 改进与回查', '待确认具体动作、负责人、回查日期及验证办法。']
  if (kind === 'object' && snapshot.intervals.length) lines.push('', '## 分时证据', '', '|时段|留存预测 MWh|申报 MWh|出清 MWh|实际 MWh|调整量 MWh|结果差额 MWh|', '|---|---:|---:|---:|---:|---:|---:|', ...snapshot.intervals.map(p => `|${p.time}|${formatValue(p.forecast)}|${formatValue(p.declared)}|${formatValue(p.cleared)}|${formatValue(p.actual)}|${formatValue(p.adjustment)}|${formatValue(p.difference)}|`))
  return lines.join('\n')
}
