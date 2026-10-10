import { describe, expect, it } from 'vitest'
import { Color } from 'cesium'

import {
  marketMetricValue,
  nodeColor,
  plantColor,
  temperatureColor,
  validNodeLocation,
  weatherColor,
  weatherLabel,
  windEndpoint,
} from './mapPlantStyles'
import type { GridGeoNode, GridGeoPlant, GridGeoWeatherSnapshot, GridMarketMetric } from '../types'

type Loc = GridGeoPlant['location']

function location(overrides: Partial<Loc> = {}): Loc {
  return {
    longitude: 101,
    latitude: 25,
    coordinateSystem: 'WGS84',
    locationLabel: '楚雄州双柏县',
    accuracyLevel: 'site',
    confidence: 'verified',
    uncertaintyMeters: 0,
    displayPolicy: 'exact-marker',
    coordinateSource: null,
    evidence: [],
    ...overrides,
  } as Loc
}

function plant(overrides: Partial<GridGeoPlant> = {}): GridGeoPlant {
  return {
    plantId: 'p1',
    standardName: '测试风电场',
    aliases: [],
    plantType: 'wind',
    capacityMw: 100,
    nodeRefs: [],
    status: 'operating',
    location: location(),
    ...overrides,
  } as GridGeoPlant
}

function node(overrides: Partial<GridGeoNode> = {}): GridGeoNode {
  return {
    assetId: 'n1',
    assetType: 'node',
    nodeId: 'n1',
    standardName: '220kV测试变',
    nodeName: '220kV测试变',
    aliases: [],
    nodeKind: 'substation',
    voltageLevelKv: 220,
    status: 'operating',
    locationStatus: 'exact',
    location: location(),
    marketRefs: {},
    ...overrides,
  } as GridGeoNode
}

function metric(overrides: Partial<GridMarketMetric> = {}): GridMarketMetric {
  return { plantId: 'p1', priceSpread: 0, outputDeviationPercent: 0, riskScore: 0, ...overrides } as GridMarketMetric
}

function weather(overrides: Partial<GridGeoWeatherSnapshot> = {}): GridGeoWeatherSnapshot {
  return {
    plantId: 'p1',
    validAt: '2026-09-27T00:00:00Z',
    intervalSeconds: 3600,
    weatherCode: 0,
    weatherLabel: '晴',
    weatherCategory: 'clear',
    temperatureC: 20,
    relativeHumidityPercent: null,
    precipitationMm: null,
    cloudCoverPercent: 40,
    windSpeedMs: 6.24,
    windDirectionDeg: 225,
    shortwaveRadiationWm2: 500,
    sampledLocation: { longitude: 101, latitude: 25, elevationM: 1800 },
    ...overrides,
  } as GridGeoWeatherSnapshot
}

function css(color: Color) {
  return color.toCssColorString()
}

/** toCssColorString 输出 rgb() 形式；用同源往返把十六进制期望值转成同一形式。 */
const hex = (value: string) => Color.fromCssColorString(value).toCssColorString()

describe('marketMetricValue', () => {
  it('按图层语义取对应数值，图层未开返回 null', () => {
    const item = metric({ priceSpread: 12.5, outputDeviationPercent: -3, riskScore: 66 })
    expect(marketMetricValue(item, 'priceSpread')).toBe(12.5)
    expect(marketMetricValue(item, 'outputDeviation')).toBe(-3)
    expect(marketMetricValue(item, 'risk')).toBe(66)
    expect(marketMetricValue(item, undefined)).toBeNull()
    expect(marketMetricValue(item, 'none')).toBeNull()
  })
})

describe('plantColor', () => {
  it('价差图层按 ±80/±20 分档（边界值归高档）', () => {
    const layers = ['priceSpread'] as const
    const colorOf = (priceSpread: number) =>
      css(plantColor(plant(), layers[0], [metric({ priceSpread })]))
    expect(colorOf(100)).toBe(hex('#ff5f8f'))
    expect(colorOf(80)).toBe(hex('#ff5f8f'))
    expect(colorOf(79.9)).toBe(hex('#ffb454'))
    expect(colorOf(-80)).toBe(hex('#6f7cff'))
    expect(colorOf(-30)).toBe(hex('#51b8ff'))
    expect(colorOf(0)).toBe(hex('#72e6bc'))
  })

  it('出力偏差按 ±15 分档，关注层按 40/70 分档', () => {
    expect(css(plantColor(plant(), 'outputDeviation', [metric({ outputDeviationPercent: 20 })]))).toBe(hex('#52ddff'))
    expect(css(plantColor(plant(), 'outputDeviation', [metric({ outputDeviationPercent: -20 })]))).toBe(hex('#ff6f73'))
    expect(css(plantColor(plant(), 'risk', [metric({ riskScore: 80 })]))).toBe(hex('#ff5f68'))
    expect(css(plantColor(plant(), 'risk', [metric({ riskScore: 50 })]))).toBe(hex('#ffc45c'))
    expect(css(plantColor(plant(), 'risk', [metric({ riskScore: 10 })]))).toBe(hex('#65e5b8'))
  })

  it('指标缺数值给中性灰蓝，指标/图层缺失时按能源类型', () => {
    // 指标列表里没有该厂站 → 回落能源类型色（拆分前行为）。
    expect(css(plantColor(plant(), 'priceSpread', []))).toBe(hex('#31d9ff'))
    // 指标存在但数值缺失（null）→ 无值灰蓝。
    expect(css(plantColor(plant(), 'priceSpread', [metric({ priceSpread: null })]))).toBe(hex('#607989'))
    expect(css(plantColor(plant({ plantType: 'wind' }), undefined, undefined))).toBe(hex('#31d9ff'))
    expect(css(plantColor(plant({ plantType: 'solar' }), undefined, undefined))).toBe(hex('#a88cff'))
    expect(css(plantColor(plant({ plantType: 'hydro' }), undefined, undefined))).toBe(hex('#72f1b8'))
  })
})

describe('validNodeLocation', () => {
  it('WGS84 且数值有效才可上 globe', () => {
    expect(validNodeLocation(node())).toBe(true)
    expect(validNodeLocation(node({ locationStatus: 'unresolved', location: null }))).toBe(false)
    expect(validNodeLocation(node({ location: location({ coordinateSystem: 'GCJ02' } as unknown as Partial<Loc>) }))).toBe(false)
    expect(validNodeLocation(node({ location: location({ longitude: 200 }) }))).toBe(false)
    expect(validNodeLocation(node({ location: location({ latitude: Number.NaN }) }))).toBe(false)
  })
})

describe('nodeColor', () => {
  it('选中金、近似定位橙、精确绿', () => {
    expect(css(nodeColor(node(), true))).toBe(hex('#ffe58a'))
    expect(css(nodeColor(node({ locationStatus: 'approximate' }), false))).toBe(hex('#f6c96b'))
    expect(css(nodeColor(node({ locationStatus: 'located' }), false))).toBe(hex('#69e4c2'))
  })
})

describe('temperatureColor', () => {
  it('按 5/15/25/32 分档，缺失给灰', () => {
    expect(css(temperatureColor(null))).toBe(hex('#8ba8b7'))
    expect(css(temperatureColor(0))).toBe(hex('#6e8cff'))
    expect(css(temperatureColor(10))).toBe(hex('#43c7ff'))
    expect(css(temperatureColor(25))).toBe(hex('#54e3b5'))
    expect(css(temperatureColor(33))).toBe(hex('#ff6b65'))
  })
})

describe('weatherColor / weatherLabel', () => {
  it('按图层语义取色', () => {
    const item = weather()
    expect(css(weatherColor(item, 'temperature'))).toBe(hex('#54e3b5'))
    expect(css(weatherColor(item, 'precipitation'))).toBe(hex('#4c9cff'))
    expect(css(weatherColor(item, 'irradiance'))).toBe(hex('#ffd45b'))
    expect(css(weatherColor(item, 'cloud'))).toBe(hex('#c5d8e5'))
    expect(css(weatherColor(item, 'wind'))).toBe(hex('#62e8ff'))
  })

  it('按图层语义生成数值标签，缺失返回 null', () => {
    const item = weather()
    expect(weatherLabel(item, 'wind')).toBe('6.2 m/s')
    expect(weatherLabel(item, 'temperature')).toBe('20.0 °C')
    expect(weatherLabel(item, 'precipitation')).toBeNull()
    expect(weatherLabel(item, 'irradiance')).toBe('500 W/m²')
    expect(weatherLabel(item, 'cloud')).toBe('40% 云量')
    expect(weatherLabel(weather({ windSpeedMs: null }), 'wind')).toBeNull()
  })
})

describe('windEndpoint', () => {
  it('从厂站位置沿风的去向延伸，北风箭头指向南', () => {
    const from = plant({ location: location({ longitude: 102, latitude: 25 }) })
    const [endLon, endLat] = windEndpoint(from, weather({ windDirectionDeg: 0, windSpeedMs: 10 }))
    expect(endLon).toBeCloseTo(102, 5)
    expect(endLat).toBeLessThan(25)
  })

  it('风向缺失按 0 度处理，风速越大箭头越长', () => {
    const from = plant({ location: location({ longitude: 102, latitude: 25 }) })
    const [, calmLat] = windEndpoint(from, weather({ windDirectionDeg: null, windSpeedMs: 1 }))
    const [, strongLat] = windEndpoint(from, weather({ windDirectionDeg: null, windSpeedMs: 20 }))
    expect(25 - strongLat).toBeGreaterThan(25 - calmLat)
  })
})
