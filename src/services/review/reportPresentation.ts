import type { EChartsOption } from 'echarts'
import type { Publication, ReportEvidence } from './workpapers'
import type { AnalysisPoint } from './topicAnalysis'
import { formatValue } from './decisionWorkbench'

/** 网页和导出共用冻结材料，任何一端都不重新计算交易指标。 */
export function reportChartOption(evidence: ReportEvidence): EChartsOption {
  if (evidence.content.topic === 'settlement') {
    const rows = evidence.content.result.current.daily
    return { animation: false, tooltip: { trigger: 'axis' }, legend: { data: ['结算电量', '结算电费'] }, grid: { left: 75, right: 80, top: 50, bottom: 55 },
      xAxis: { type: 'category', data: rows.map(row => row.date) }, yAxis: [{ type: 'value', name: 'MWh' }, { type: 'value', name: '元' }],
      series: [{ name: '结算电量', type: 'bar', data: rows.map(row => row.energyMwh) }, { name: '结算电费', type: 'line', yAxisIndex: 1, connectNulls: false, data: rows.map(row => row.feeYuan) }],
    }
  }
  const { labels, result, topic } = evidence.content, price = topic === 'price'
  const rows = displayAnalysisIntervals(result.intervals)
  return {
    animation: false,
    tooltip: { trigger: 'axis' }, legend: { data: labels },
    grid: { left: 75, right: 25, top: 45, bottom: 55 },
    xAxis: { type: 'category', data: rows.map(row => row ? new Date(row.start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时段间隔') },
    yAxis: { type: 'value', name: price ? '元/MWh' : 'MWh' },
    series: [
      { name: labels[0], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row ? (price ? row.daPrice : row.baselineMwh) : null) },
      { name: labels[1], type: 'line', step: 'end', connectNulls: false, data: rows.map(row => row ? (price ? row.rtPrice : row.actualMwh) : null) },
    ],
  }
}
export function reportEvidenceCaption(evidence: ReportEvidence): string {
  if (evidence.content.topic === 'settlement') {
    const { current, comparison } = evidence.content.result
    return `结算电量 ${formatValue(current.energyMwh)} MWh；结算电费 ${formatValue(current.feeYuan)} 元；有效 ${current.coverage.records}/${current.expectedPlantDays} 厂站日。共同覆盖 ${comparison.matchedPlantDays} 厂站日：本期电费 ${formatValue(comparison.currentFeeYuan)} 元，参考期 ${formatValue(comparison.referenceFeeYuan)} 元。${evidence.content.sourceNotice}`
  }
  const { result, topic, sourceNotice } = evidence.content
  const metrics = topic === 'price'
    ? `同口径日前减实时 ${formatValue(result.prices.spreadAverage)} 元/MWh；可比较 ${result.prices.comparableMinutes} 分钟`
    : `净差异 ${formatValue(result.energy.netDeviationMwh)} MWh；绝对差异 ${formatValue(result.energy.absoluteDeviationMwh)} MWh；可比较 ${result.coverage.comparableMinutes} 分钟`
  const history = topic === 'price' && result.comparison ? `历史共同覆盖比较：日前均价变化 ${formatValue(result.comparison.changes.daPrice)} 元/MWh，实时均价变化 ${formatValue(result.comparison.changes.rtPrice)} 元/MWh，价差可比 ${result.comparison.coverage.priceMinutes} 分钟。` : ''
  return `${result.simulated ? '模拟演练。' : ''}${metrics}。${history}${sourceNotice}`
}
export type ReportPart = { kind: 'title' | 'heading' | 'paragraph'; text: string } | { kind: 'chart'; evidence: ReportEvidence }
export function reportParts(publication: Publication, brief = false): ReportPart[] {
  const content = publication.content
  const parts: ReportPart[] = [
    { kind: 'title', text: content.title },
    { kind: 'paragraph', text: `${content.scope.objectLabel} · ${content.scope.startDate}—${content.scope.endDate} · 主笔 ${content.authorId} · 第 ${publication.revision} 版` },
    { kind: 'paragraph', text: content.notice },
    { kind: 'heading', text: '管理层摘要' },
    { kind: 'paragraph', text: content.summary || '本版本未单独撰写摘要，请查看正文。' },
  ]
  if (brief) {
    // 摘要也必须保留资料性质，不能把模拟或未认证的依据变成无条件事实。
    for (const evidence of content.evidence) parts.push({ kind: 'paragraph', text: reportEvidenceCaption(evidence) })
    return parts
  }
  for (const block of content.blocks) {
    parts.push({ kind: 'heading', text: block.title })
    if (block.evidenceId) {
      const evidence = content.evidence.find(item => item.id === block.evidenceId)
      if (!evidence) throw new Error('发布版本的材料不完整，不能导出')
      parts.push({ kind: 'paragraph', text: block.evidenceRole === 'comparison' ? '比较依据' : '本次依据' }, { kind: 'chart', evidence }, { kind: 'paragraph', text: reportEvidenceCaption(evidence) })
    }
    parts.push({ kind: 'paragraph', text: block.text })
    if (block.kind === 'reason') parts.push(
      { kind: 'paragraph', text: block.state === 'confirmed' ? '交易员已核实' : '待核实的可能原因' },
      { kind: 'paragraph', text: `支持证据：${block.supports || '未记录'}` },
      { kind: 'paragraph', text: `反对证据：${block.refutes || '未记录'}` },
    )
  }
  return parts
}

/** 选区与缺测造成的不连续时间不能在报告中被连线掩盖。null 只用于断线，不参与统计。 */
export function displayAnalysisIntervals(rows: AnalysisPoint[]): Array<AnalysisPoint | null> {
  const display: Array<AnalysisPoint | null> = []
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i - 1].end !== rows[i].start) display.push(null)
    display.push(rows[i])
  }
  return display
}
