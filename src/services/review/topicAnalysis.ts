import { apiPost } from '@/services/api'
import type { ReviewEvidenceSnapshot } from './reviewEvidence'

export type ComparisonBasis = 'forecast_actual' | 'declared_cleared' | 'declared_actual'
export const comparisonLabels: Record<ComparisonBasis, [string, string]> = {
  forecast_actual: ['留存预测', '实际电量'], declared_cleared: ['申报电量', '出清电量'], declared_actual: ['申报电量', '实际电量'],
}
export type AnalysisPoint = {
  start: string; end: string; durationMinutes: number; baselineMwh: number | null; actualMwh: number | null
  differenceMwh: number | null; daPrice: number | null; rtPrice: number | null
}
export type TopicAnalysisResult = {
  intervals: AnalysisPoint[]; anomalies: AnalysisPoint[]
  coverage: { expectedMinutes: number; observedMinutes: number; comparableMinutes: number; ratio: number | null }
  energy: { baselineMwh: number | null; actualMwh: number | null; netDeviationMwh: number | null; absoluteDeviationMwh: number | null; absoluteDeviationPct: number | null }
  prices: { daAverage: number | null; rtAverage: number | null; comparableMinutes: number }
  notice: string; methodology: string; simulated: boolean | null
}

/** 仅投影已读取副本，不拼接其他对象或在浏览器重新计算经营指标。 */
export function topicAnalysisRequest(snapshot: ReviewEvidenceSnapshot, basis: ComparisonBasis, selections?: string[], thresholds: { absoluteMwh?: number } = {}) {
  const scope = { companyId: snapshot.scope.company, region: snapshot.scope.region, objectId: snapshot.scope.objectKey || 'company-overview' }
  const rows = snapshot.intervals.map(point => {
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(point.time)) throw new Error('当前资料的时间粒度不明确，请先核实')
    const start = `${snapshot.scope.day}T${point.time}:00+08:00`
    return {
      ...scope, start, end: new Date(Date.parse(start) + 15 * 60000).toISOString(), unit: 'MWh',
      baseline: basis === 'forecast_actual' ? point.forecast : point.declared,
      actual: basis === 'declared_cleared' ? point.cleared : point.actual,
      daPrice: point.daPrice, rtPrice: point.rtPrice,
      sourceLabel: '当前复盘资料副本', sourceVersion: snapshot.capturedAt, simulated: snapshot.simulated,
    }
  })
  return { scope, period: { date: snapshot.scope.day, cadence: 'day', asOf: snapshot.scope.day }, rows, selections, thresholds }
}

export async function previewTopicAnalysis(snapshot: ReviewEvidenceSnapshot, basis: ComparisonBasis, selections?: string[], thresholds?: { absoluteMwh?: number }, signal?: AbortSignal): Promise<TopicAnalysisResult> {
  const payload = topicAnalysisRequest(snapshot, basis, selections, thresholds)
  const response = await apiPost<TopicAnalysisResult>('/api/v1/review/analysis/preview', payload, {
    signal, headers: { 'x-company-id': snapshot.scope.company, 'x-tenant-id': snapshot.scope.company },
  })
  return response.data ?? response
}
