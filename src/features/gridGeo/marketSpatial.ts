import { fetchNodePriceDailyContract } from '@/services/data/contracts/nodePriceClient'
import type { NodePriceContract, NodePriceDailyAggregate } from '@/services/data/contracts/nodePrice'
import {
  buildPlantOutputSeries,
  detectPlantOutputAnomalies,
  loadPlantOutputSourcePayload,
  summarizePlantOutput,
  type CapturedEnvelopeMeta,
  type PlantOutputRow,
} from '@/services/market/plantOutputClient'
import { fetchGridGeoPlantIntegrations } from './client'
import { mappingMatchesScope, resolveScopedOutputSources } from './marketSpatialScope'
import { gridMarketRiskScore } from './marketSpatialMath'
import type { GridGeoPlant, GridMarketMetric } from './types'

export type GridMarketSpatialSnapshot = {
  date: string
  metrics: GridMarketMetric[]
  summary: {
    mappedPlants: number
    pricedPlants: number
    outputPlants: number
    riskPlants: number
    highRiskPlants: number
    averageAbsPriceSpread: number | null
  }
  sources: {
    mapping: { sourceType: 'CONFIG'; mock: false; productionWrite: false }
    nodePrice: { status: 'available' | 'empty' | 'error'; sourceType: string; mock: boolean; productionWrite: boolean; error?: string }
    output: CapturedEnvelopeMeta & { status: 'available' | 'empty' | 'error' | 'not-configured'; reason?: string }
  }
  formula: {
    priceContribution: string
    outputContribution: string
    riskScore: string
    causality: false
  }
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function exactOutputRows(rows: PlantOutputRow[], names: string[]) {
  const candidates = new Set(names)
  return rows.filter((row) => candidates.has(row.standardPlant ?? '') || candidates.has(row.plant))
}

function signedOutputDeviation(series: ReturnType<typeof buildPlantOutputSeries>) {
  const pairs = series.actual.flatMap((actual, index) => {
    const target = series.target[index]
    return actual === null || target === null ? [] : [{ actual, target }]
  })
  if (!pairs.length) return { mw: null, percent: null }
  const actual = average(pairs.map((pair) => pair.actual))
  const target = average(pairs.map((pair) => pair.target))
  if (actual === null || target === null) return { mw: null, percent: null }
  return {
    mw: actual - target,
    percent: Math.abs(target) < 1e-9 ? null : (actual - target) / target * 100,
  }
}

// 契约可信可用（mock 数据不进指标计算，授权拒绝不进指标计算），与 spatialCommand
// trustedMarketMetrics 同口径：合成数据绝不向地图输出指标。
function usableDaily(contract: NodePriceContract): NodePriceDailyAggregate[] {
  if (contract.mock || contract.access.accessDenied) return []
  return contract.daily
}

function priceByNode(rows: NodePriceDailyAggregate[]) {
  return new Map(rows.map((row) => [row.node.nodeName, row]))
}

function mergeOutputPayloads(results: PromiseSettledResult<Awaited<ReturnType<typeof loadPlantOutputSourcePayload>>>[]) {
  const fulfilled = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const errors = [
    ...fulfilled.map((item) => item.meta.error).filter((item): item is string => Boolean(item)),
    ...results.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []),
  ]
  const sourceTypes = [...new Set(fulfilled.map((item) => item.meta.sourceType).filter(Boolean))]
  return {
    rows: fulfilled.flatMap((item) => item.rows),
    meta: {
      hasRealData: fulfilled.some((item) => item.meta.hasRealData),
      mock: fulfilled.some((item) => item.meta.mock),
      sourceType: sourceTypes.join('+'),
      updatedAt: fulfilled.map((item) => item.meta.updatedAt).filter((item): item is string => Boolean(item)).sort().at(-1) ?? null,
      ...(errors.length ? { error: errors.join('；') } : {}),
    } satisfies CapturedEnvelopeMeta,
  }
}

export async function loadGridMarketSpatialSnapshot(
  plants: GridGeoPlant[],
  date: string,
  scope: { companyId: string; regionId: string },
): Promise<GridMarketSpatialSnapshot> {
  if (!scope.companyId || !scope.regionId) throw new Error('当前公司或地区上下文缺失，已停止市场空间取数')
  const mappingResults = await Promise.allSettled(plants.map((plant) => fetchGridGeoPlantIntegrations(plant.plantId)))
  const mappings = new Map(mappingResults.flatMap((result) => result.status === 'fulfilled'
    && mappingMatchesScope(result.value, scope.companyId, scope.regionId)
    ? [[result.value.asset.plantId, result.value] as const]
    : []))
  const outputSources = resolveScopedOutputSources([...mappings.values()], scope.companyId, scope.regionId)

  // 节点电价经统一契约客户端：serving-route-registry 门控（未配置路由的地区拿到诚实空态
  // 契约，不发请求、不回落他省）+ ModuleContractMeta 可信度元信息。
  const [[settledDa, settledRt], outputResults] = await Promise.all([
    Promise.allSettled([
      fetchNodePriceDailyContract({ regionId: scope.regionId, date, market: 'da' }),
      fetchNodePriceDailyContract({ regionId: scope.regionId, date, market: 'rt' }),
    ]),
    Promise.allSettled(outputSources.map((source) => loadPlantOutputSourcePayload(source, { date }))),
  ])
  const outputPayload = outputSources.length ? mergeOutputPayloads(outputResults) : null
  const daByNode = priceByNode(settledDa.status === 'fulfilled' ? usableDaily(settledDa.value) : [])
  const rtByNode = priceByNode(settledRt.status === 'fulfilled' ? usableDaily(settledRt.value) : [])

  const metrics = plants.map((plant): GridMarketMetric => {
    const mapping = mappings.get(plant.plantId)
    const nodeName = mapping?.identity.nodeName ?? null
    const da = nodeName ? daByNode.get(nodeName) : undefined
    const rt = nodeName ? rtByNode.get(nodeName) : undefined
    const priceSpread = da?.avg !== null && da?.avg !== undefined && rt?.avg !== null && rt?.avg !== undefined ? rt.avg - da.avg : null
    const rows = mapping && outputPayload ? exactOutputRows(outputPayload.rows, mapping.identity.plantNames) : []
    const series = buildPlantOutputSeries(rows)
    const deviations = signedOutputDeviation(series)
    const anomalies = detectPlantOutputAnomalies(series, { deviationPct: 10, deviationMw: 5 }, plant.standardName)
    const output = summarizePlantOutput(series, anomalies)
    return {
      plantId: plant.plantId,
      nodeName,
      priceSpread,
      daAverage: da?.avg ?? null,
      rtAverage: rt?.avg ?? null,
      outputDeviationMw: deviations.mw,
      outputDeviationPercent: deviations.percent,
      riskScore: gridMarketRiskScore(priceSpread, deviations.percent),
      outputPointCount: output.pointCount,
      anomalyCount: anomalies.length,
    }
  })

  const priced = metrics.filter((metric) => metric.priceSpread !== null)
  const output = metrics.filter((metric) => metric.outputDeviationPercent !== null)
  const risks = metrics.filter((metric) => metric.riskScore !== null)
  const priceError = [settledDa, settledRt].find((result) => result.status === 'rejected')
  const priceContracts = [settledDa, settledRt].flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const priceMeta = {
    sourceType: [...new Set(priceContracts.map((contract) => contract.sourceType).filter(Boolean))].join('+'),
    mock: priceContracts.some((contract) => contract.mock),
    productionWrite: priceContracts.some((contract) => contract.productionWrite),
  }
  // 未配置路由/授权拒绝等空态原因（契约 data_availability note），surfacing 给面板解释「为什么空」。
  const priceEmptyNote = priceContracts
    .flatMap((contract) => contract.data_availability)
    .find((entry) => entry.status === 'missing' && entry.note)?.note
  const outputMeta = outputPayload?.meta ?? { hasRealData: false, mock: false, sourceType: '', updatedAt: null }
  return {
    date,
    metrics,
    summary: {
      mappedPlants: mappings.size,
      pricedPlants: priced.length,
      outputPlants: output.length,
      riskPlants: risks.length,
      highRiskPlants: risks.filter((metric) => Number(metric.riskScore) >= 70).length,
      averageAbsPriceSpread: average(priced.map((metric) => Math.abs(Number(metric.priceSpread)))),
    },
    sources: {
      mapping: { sourceType: 'CONFIG', mock: false, productionWrite: false },
      nodePrice: {
        status: priceError ? 'error' : priced.length ? 'available' : 'empty',
        sourceType: priceMeta.sourceType || 'UNKNOWN',
        mock: priceMeta.mock,
        productionWrite: priceMeta.productionWrite,
        ...(priceError?.status === 'rejected'
          ? { error: priceError.reason instanceof Error ? priceError.reason.message : String(priceError.reason) }
          : !priced.length && priceEmptyNote
            ? { error: priceEmptyNote }
            : {}),
      },
      output: {
        ...outputMeta,
        status: !outputSources.length ? 'not-configured' : outputMeta.error ? 'error' : output.length ? 'available' : 'empty',
        ...(!outputSources.length ? { reason: '所选公司没有通过归属登记核验的出力数据族' } : {}),
      },
    },
    formula: {
      priceContribution: 'min(50, abs(实时均价-日前均价) / 2)',
      outputContribution: 'min(50, abs((实际均值-目标均值)/目标均值×100%) × 2)',
      riskScore: '价格贡献 + 出力贡献（0–100，仅两域均可用时计算）',
      causality: false,
    },
  }
}
