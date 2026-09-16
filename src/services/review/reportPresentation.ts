import type { EChartsOption } from 'echarts'
import type { DecisionReference, Publication, ReportEvidence } from './workpapers'
import type { AnalysisPoint } from './topicAnalysis'
import { formatValue } from './decisionWorkbench'

/** 网页和导出共用冻结材料，任何一端都不重新计算交易指标。 */
export function reportChartOption(evidence: ReportEvidence): EChartsOption {
  if (evidence.content.topic === 'daily_energy') {
    const { daily, labels } = evidence.content.result
    return { animation: false, tooltip: { trigger: 'axis' }, legend: { data: labels }, grid: { left: 75, right: 25, top: 45, bottom: 55 }, xAxis: { type: 'category', data: daily.map(row => row.date) }, yAxis: { type: 'value', name: 'MWh' }, series: [{ name: labels[0], type: 'line', connectNulls: false, data: daily.map(row => row.baselineMwh) }, { name: labels[1], type: 'line', connectNulls: false, data: daily.map(row => row.actualMwh) }] }
  }
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
  if (evidence.content.topic === 'daily_energy') {
    const { current, comparison, periods, labels, selectedDays } = evidence.content.result
    return `${labels.join('与')}。净偏差 ${formatValue(current.netDeviationMwh)} MWh；逐厂站日绝对偏差 ${formatValue(current.absoluteDeviationMwh)} MWh；有效 ${current.coverage.paired} 厂站日。${selectedDays ? `所选日期：${selectedDays.join('、')}；图表保留完整周期供定位。` : ''}参考期 ${periods.reference.start}—${periods.reference.end}，共同 ${comparison.matchedPlantDays} 厂站日。${evidence.content.sourceNotice}`
  }
  if (evidence.content.topic === 'settlement') {
    const { current, comparison } = evidence.content.result
    return `结算电量 ${formatValue(current.energyMwh)} MWh；结算电费 ${formatValue(current.feeYuan)} 元；有效 ${current.coverage.records}/${current.expectedPlantDays} 厂站日。共同覆盖 ${comparison.matchedPlantDays} 厂站日：本期电费 ${formatValue(comparison.currentFeeYuan)} 元，参考期 ${formatValue(comparison.referenceFeeYuan)} 元。${evidence.content.sourceNotice}`
  }
  const { result, topic, sourceNotice } = evidence.content
  const metrics = topic === 'price'
    ? `同口径日前减实时 ${formatValue(result.prices.spreadAverage)} 元/MWh；可比较 ${result.prices.comparableMinutes} 分钟`
    : `净差异 ${formatValue(result.energy.netDeviationMwh)} MWh；绝对差异 ${formatValue(result.energy.absoluteDeviationMwh)} MWh；可比较 ${result.coverage.comparableMinutes} 分钟`
  const history = topic === 'price' && result.comparison ? `历史共同覆盖比较：日前均价变化 ${formatValue(result.comparison.changes.daPrice)} 元/MWh，实时均价变化 ${formatValue(result.comparison.changes.rtPrice)} 元/MWh，价差可比 ${result.comparison.coverage.priceMinutes} 分钟。` : result.comparison?.coverage.energyMinutes !== undefined ? `历史共同覆盖 ${result.comparison.coverage.energyMinutes} 分钟：净差异变化 ${formatValue(result.comparison.changes.netDeviationMwh)} MWh，绝对差异变化 ${formatValue(result.comparison.changes.absoluteDeviationMwh)} MWh。` : ''
  return `${result.simulated ? '模拟演练。' : ''}${metrics}。${history}${sourceNotice}`
}
/**
 * 网页、Word 与打印共用的关联决策说明。读的是关联当时冻结的申报副本，源申报后续修改
 * 不会改写它；关联是交易员明确建立的关系，不作因果认定。
 */
export function decisionReferenceCaption(reference: DecisionReference): string {
  const order = reference.snapshot, curve = order?.energyCurveMwh96
  // 缺点位或含非有限值时不给合计：半条曲线加出来的数会被当成申报总量。
  const energy = Array.isArray(curve) && curve.length === 96 && curve.every(value => Number.isFinite(value)) ? `全天申报电量 ${formatValue(curve.reduce((sum, value) => sum + value, 0))} MWh；` : ''
  const capacity = Number.isFinite(order?.capacityMw) ? `申报容量 ${formatValue(order.capacityMw)} MW；` : ''
  return `${reference.targetDate} 交易日申报（${reference.simulated ? '历史模拟' : '真实申报'}）。${capacity}${energy}报价依据：${order?.quoteRationale || '未留存，需回到原申报核实'}。${reference.notice}`
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
    // 关联申报同理：摘要保留了其他依据的说明，唯独丢掉关联依据，会让申报相关的结论在
    // 管理层版本里失去出处，连「不代表因果关系」那句提示也一并消失。
    // 残缺的关联块与详版一样拒绝导出——静默跳过会产出一份「成功但没有依据」的摘要。
    for (const block of content.blocks) {
      if (block.kind !== 'decision') continue
      if (!block.reference) throw new Error('发布版本的关联申报不完整，不能导出')
      parts.push({ kind: 'paragraph', text: decisionReferenceCaption(block.reference) })
    }
    return parts
  }
  for (const block of content.blocks) {
    parts.push({ kind: 'heading', text: block.title })
    if (block.evidenceId) {
      const evidence = content.evidence.find(item => item.id === block.evidenceId)
      if (!evidence) throw new Error('发布版本的材料不完整，不能导出')
      parts.push({ kind: 'paragraph', text: block.evidenceRole === 'comparison' ? '比较依据' : '本次依据' }, { kind: 'chart', evidence }, { kind: 'paragraph', text: reportEvidenceCaption(evidence) })
    }
    // 关联决策必须随报告一起交付：只导出交易员写的理由，读者看不出依据的是哪一笔申报。
    if (block.kind === 'decision') {
      if (!block.reference) throw new Error('发布版本的关联申报不完整，不能导出')
      parts.push({ kind: 'paragraph', text: decisionReferenceCaption(block.reference) })
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
