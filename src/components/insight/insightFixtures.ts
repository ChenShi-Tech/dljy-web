// 市场洞察公共件测试夹具（dljy#2996）
// ----------------------------------------------------------------------------
// 构造能通过 shared 契约 assertInsightResult 校验的最小合法结果，供各 spec 复用。
// 来源选用真实登记项：yn.price.node.public.day-ahead（公开节点日前价，yuan/MWh，
// 对象维度 nodeName，15 分钟）与 yn.system.load.actual（统调负荷，MW，无对象维度）——
// 两类单位正好覆盖「价格与功率不共轴 / 超两单位拆图」的分组断言。

import type { InsightBlockResult, InsightSeriesMeta } from '@/services/insight/insightClient'

export const RESULT_VERSION = `rv1:${'a'.repeat(64)}`
export const READ_SET_REF = `rs1:${'b'.repeat(64)}`

/** 公开节点日前价序列（15 分钟，对象维度 nodeName）。 */
export function nodePriceSeries(overrides: Partial<InsightSeriesMeta> = {}): InsightSeriesMeta {
  return {
    seriesId: 'ser-node-1',
    sourceId: 'yn.price.node.public.day-ahead',
    fieldId: 'price',
    unit: 'yuan/MWh',
    measureKind: 'price',
    dimensions: { nodeName: 'YN.KM.01' },
    businessScope: 'node',
    resolutionMinutes: 15,
    nativeResolutionMinutes: 15,
    priceObject: 'public-node',
    marketPhase: 'day-ahead',
    variant: null,
    ...overrides,
  }
}

/** 统调负荷序列（15 分钟，无对象维度，单位 MW）。 */
export function loadSeries(overrides: Partial<InsightSeriesMeta> = {}): InsightSeriesMeta {
  return nodePriceSeries({
    seriesId: 'ser-load-1',
    sourceId: 'yn.system.load.actual',
    fieldId: 'totalEnergy',
    unit: 'MW',
    measureKind: 'power',
    dimensions: {},
    businessScope: 'yunnan',
    priceObject: null,
    marketPhase: null,
    variant: 'actual',
    ...overrides,
  })
}

/** 一条长表行；interval 为北京时间 ISO。 */
export function row(seriesId: string, intervalStart: string, intervalEnd: string, value: string): Record<string, string> {
  return { seriesId, intervalStart, intervalEnd, value }
}

/** 合法完整结果（assertInsightResult 可通过）；overrides 浅覆盖顶层。 */
export function insightResult(overrides: Record<string, unknown> = {}): InsightBlockResult {
  return {
    schemaVersion: 'insight/v1',
    queryId: 'q-test-1',
    contextVersion: 3,
    analysisId: 'test.analysis',
    analysisVersion: '1.0.0',
    resolvedScope: { regionId: 'yunnan', companyId: 'c1' },
    businessWindow: { start: '2026-09-10', end: '2026-09-10' },
    mode: 'ex-post',
    runtime: {
      access: 'granted',
      availability: { state: 'complete' },
      freshness: { state: 'fresh' },
      comparability: { status: 'compatible', reasons: [] },
    },
    basis: 'captured',
    derivation: 'source',
    sourceRefs: [{ sourceId: 'yn.price.node.public.day-ahead', accessScope: 'public' }],
    coverage: {},
    quality: {},
    resultVersion: RESULT_VERSION,
    readSetRef: READ_SET_REF,
    generatedAt: '2026-09-17T20:00:00+08:00',
    expiresAt: '2026-09-18T20:00:00+08:00',
    page: { scope: 'all', totalRows: 0 },
    mock: false,
    productionWrite: false,
    ...overrides,
  } as InsightBlockResult
}

/** 带一条节点价序列与逐 15 分钟行的结果（2026-09-10 当日，格点自 00:00 起）。
 *  values 里的 null 表示该格点缺测——后端对缺测时段不下发行，断线由前端插 null。 */
export function nodePriceResult(
  values: Array<string | null>,
  overrides: Record<string, unknown> = {}
): InsightBlockResult {
  const series = nodePriceSeries()
  const rows = values
    .map((value, index) => (value === null ? null : { value, index }))
    .filter((item): item is { value: string; index: number } => item !== null)
    .map(({ value, index }) => {
      const start = index * 15
      const hh = String(Math.floor(start / 60)).padStart(2, '0')
      const mm = String(start % 60).padStart(2, '0')
      const end = start + 15
      const eh = String(Math.floor(end / 60)).padStart(2, '0')
      const em = String(end % 60).padStart(2, '0')
      return row(series.seriesId, `2026-09-10T${hh}:${mm}:00+08:00`, `2026-09-10T${eh}:${em}:00+08:00`, value)
    })
  return insightResult({
    page: { scope: 'all', totalRows: rows.length },
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'by-series' }],
      rows,
      series: [series],
    },
    ...overrides,
  })
}
