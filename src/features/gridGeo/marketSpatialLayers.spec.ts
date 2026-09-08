import { describe, expect, it } from 'vitest'

import {
  GRID_MARKET_LAYER_OPTIONS,
  gridMarketLayerOption,
  gridMarketTone,
  gridMarketValue,
  gridMarketValueText,
  rankGridMarketMetrics,
} from './marketSpatialLayers'
import type { GridMarketMetric } from './types'

function metric(overrides: Partial<GridMarketMetric> & { plantId: string }): GridMarketMetric {
  return {
    nodeName: null,
    priceSpread: null,
    daAverage: null,
    rtAverage: null,
    outputDeviationMw: null,
    outputDeviationPercent: null,
    riskScore: null,
    outputPointCount: 0,
    anomalyCount: 0,
    ...overrides,
  }
}

describe('图层口径注册表', () => {
  it('三档图层都有单位与含义说明', () => {
    expect(GRID_MARKET_LAYER_OPTIONS.map((option) => option.value)).toEqual(['priceSpread', 'outputDeviation', 'risk'])
    for (const option of GRID_MARKET_LAYER_OPTIONS) {
      expect(option.suffix).not.toBe('')
      expect(option.description.length).toBeGreaterThan(6)
    }
  })

  it("'none' 不是可展示图层，取不到口径", () => {
    expect(gridMarketLayerOption('none')).toBeNull()
  })
})

describe('gridMarketValue', () => {
  it('按图层取对应字段', () => {
    const sample = metric({ plantId: 'p1', priceSpread: 12.3, outputDeviationPercent: -4.5, riskScore: 66 })
    expect(gridMarketValue(sample, 'priceSpread')).toBe(12.3)
    expect(gridMarketValue(sample, 'outputDeviation')).toBe(-4.5)
    expect(gridMarketValue(sample, 'risk')).toBe(66)
    expect(gridMarketValue(sample, 'none')).toBeNull()
  })
})

describe('gridMarketValueText', () => {
  it('价差带正号与空格单位，出力偏差的 % 紧贴数字', () => {
    const sample = metric({ plantId: 'p1', priceSpread: 12.34, outputDeviationPercent: 5.67 })
    expect(gridMarketValueText(sample, 'priceSpread')).toBe('+12.3 元/MWh')
    expect(gridMarketValueText(sample, 'outputDeviation')).toBe('+5.7%')
  })

  it('负值不加正号', () => {
    expect(gridMarketValueText(metric({ plantId: 'p1', priceSpread: -8.2 }), 'priceSpread')).toBe('-8.2 元/MWh')
  })

  it('关注分是无量纲指数，不留小数位', () => {
    expect(gridMarketValueText(metric({ plantId: 'p1', riskScore: 72.6 }), 'risk')).toBe('73 分')
  })

  it('缺测与空指标都显示「缺测」而不是 0 或 NaN', () => {
    expect(gridMarketValueText(metric({ plantId: 'p1' }), 'priceSpread')).toBe('缺测')
    expect(gridMarketValueText(null, 'risk')).toBe('缺测')
  })
})

describe('gridMarketTone', () => {
  /**
   * 分档阈值原先在「电力市场空间态势」页和驾驶舱各写了一份。这里钉住边界值，
   * 是为了让「同一个电厂在两个页面一红一绿」这种漂移在改动时立刻现形。
   */
  it('关注分以 70 / 40 为界', () => {
    expect(gridMarketTone(metric({ plantId: 'p', riskScore: 70 }), 'risk')).toBe('hot')
    expect(gridMarketTone(metric({ plantId: 'p', riskScore: 69.9 }), 'risk')).toBe('warm')
    expect(gridMarketTone(metric({ plantId: 'p', riskScore: 40 }), 'risk')).toBe('warm')
    expect(gridMarketTone(metric({ plantId: 'p', riskScore: 39.9 }), 'risk')).toBe('cool')
  })

  it('价差以绝对幅度 80 / 20 为界，负向同样计入', () => {
    expect(gridMarketTone(metric({ plantId: 'p', priceSpread: 80 }), 'priceSpread')).toBe('hot')
    expect(gridMarketTone(metric({ plantId: 'p', priceSpread: -80 }), 'priceSpread')).toBe('hot')
    expect(gridMarketTone(metric({ plantId: 'p', priceSpread: -20 }), 'priceSpread')).toBe('warm')
    expect(gridMarketTone(metric({ plantId: 'p', priceSpread: 19.9 }), 'priceSpread')).toBe('cool')
  })

  it('出力偏差以绝对幅度 15 / 5 为界', () => {
    expect(gridMarketTone(metric({ plantId: 'p', outputDeviationPercent: -15 }), 'outputDeviation')).toBe('hot')
    expect(gridMarketTone(metric({ plantId: 'p', outputDeviationPercent: 5 }), 'outputDeviation')).toBe('warm')
    expect(gridMarketTone(metric({ plantId: 'p', outputDeviationPercent: 4.9 }), 'outputDeviation')).toBe('cool')
  })

  it('缺测单独一档，不会被当成 0 归到 cool', () => {
    expect(gridMarketTone(metric({ plantId: 'p' }), 'risk')).toBe('missing')
  })
})

describe('rankGridMarketMetrics', () => {
  const metrics = [
    metric({ plantId: 'a', priceSpread: 10 }),
    metric({ plantId: 'b', priceSpread: -90 }),
    metric({ plantId: 'c', priceSpread: 45 }),
    metric({ plantId: 'd', priceSpread: null }),
  ]

  it('按绝对幅度降序，负向大值排在正向小值之前', () => {
    expect(rankGridMarketMetrics(metrics, 'priceSpread').map((item) => item.plantId)).toEqual(['b', 'c', 'a'])
  })

  it('缺测项被剔除，不占榜位也不显示成 0', () => {
    expect(rankGridMarketMetrics(metrics, 'priceSpread').some((item) => item.plantId === 'd')).toBe(false)
  })

  it('下钻到地市州时按电厂集合收窄', () => {
    expect(rankGridMarketMetrics(metrics, 'priceSpread', ['a', 'd']).map((item) => item.plantId)).toEqual(['a'])
  })

  it('不传范围表示全省，且不修改入参数组', () => {
    const before = metrics.map((item) => item.plantId)
    rankGridMarketMetrics(metrics, 'priceSpread', null)
    expect(metrics.map((item) => item.plantId)).toEqual(before)
  })
})
