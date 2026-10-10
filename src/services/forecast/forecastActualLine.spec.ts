// 目标日真值与基线曲线的透传与降采样（#2371）。
//
// 后端本就用真值算 metrics，此前不返回，图上只有一条孤立的预测曲线，无从判断准不准。
// 这里守两件事：① 真值/基线确实透传到统一结果；② 24 点粒度下它们跟着降采样——
// 漏掉降采样会让真值仍是 96 点、与横轴逐点错位，画出来是一条"看着像但对不上"的线。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runForecastPredict = vi.fn()

const CATALOG = {
  target: 'price',
  models: [{
    modelId: 'random_forest', name: 'RandomForest', target: 'price', regionId: 'yunnan',
    namespace: 'base', tier: 'ml', available: true, supportedTargets: ['price'],
    capabilities: { horizon: 96 },
    provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
  }],
}

vi.mock('@/services/forecast/mlForecastClient', () => ({
  runForecastPredict,
  fetchForecastModels: vi.fn(() => Promise.resolve(CATALOG)),
  normalizeForecastModelCatalog: (raw: unknown) => raw,
}))
vi.mock('@/services/captured', () => ({ fetchCaptured: vi.fn() }))
vi.mock('@/services/region/regionContext', async () => {
  const { computed, ref } = await import('vue')
  const id = ref('yunnan')
  return { currentRegion: computed(() => ({ id: id.value, name: id.value })), selectedRegionId: id, selectRegion: vi.fn() }
})
vi.mock('@/services/region/regionModules', () => ({ getRegionModuleCapabilities: () => [] }))

const ramp = (base: number) => Array.from({ length: 96 }, (_, i) => base + i)

function backendResult() {
  return {
    task: {}, points: ramp(100), lower: [], upper: [],
    basis: 'captured', mock: false, source_type: 'CAPTURED', model_version: 'random_forest',
    metrics: { mae: 1 }, baseline_metrics: { naive_mae: 2, knn_mae: 3 },
    unit: '元/MWh', warnings: [],
    actual: ramp(200),
    baseline_curves: { naive: ramp(300), knn: ramp(400) },
    evaluation_mode: 'backtest',
  }
}

async function runLightgbm(granularity: 24 | 96) {
  const { getProvider, ensureForecastCatalog } = await import('./forecastProviders')
  await ensureForecastCatalog(true)   // provider 由 catalog 驱动，必须先载入目录
  const p = getProvider('random_forest')
  expect(p, 'random_forest provider 应存在').toBeTruthy()
  return p!.run(
    { regionId: 'yunnan', target: 'price', targetDate: '2026-06-04', granularity, historyDays: 180 },
    {},
  )
}

describe('目标日真值与基线曲线（#2371）', () => {
  beforeEach(() => {
    vi.resetModules()
    runForecastPredict.mockReset()
    runForecastPredict.mockResolvedValue(backendResult())
  })

  it('96 点粒度下真值与两条基线原样透传', async () => {
    const r = await runLightgbm(96)
    expect(r.actual).toHaveLength(96)
    expect(r.actual![0]).toBe(200)
    expect(r.baselines?.naive?.[0]).toBe(300)
    expect(r.baselines?.knn?.[0]).toBe(400)
    expect(r.evaluationMode).toBe('backtest')
  })

  it('24 点粒度下真值与基线一起降采样，长度与预测曲线一致', async () => {
    const r = await runLightgbm(24)
    expect(r.points).toHaveLength(24)
    // 关键断言：漏掉降采样时 actual 仍是 96，与横轴错位
    expect(r.actual).toHaveLength(24)
    expect(r.baselines?.naive).toHaveLength(24)
    expect(r.baselines?.knn).toHaveLength(24)
    expect(r.actual!.length).toBe(r.points.length)
  })

  it('后端不返回这些字段时留空而非空数组——消费方要能区分「没有真值」与「真值全 0」', async () => {
    const { actual, baseline_curves, evaluation_mode, ...withoutActual } = backendResult()
    void actual; void baseline_curves; void evaluation_mode
    runForecastPredict.mockResolvedValue(withoutActual)

    const r = await runLightgbm(96)
    expect(r.actual).toBeUndefined()
    expect(r.baselines).toBeUndefined()
    expect(r.evaluationMode).toBeUndefined()
  })
})
