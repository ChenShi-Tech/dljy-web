import { describe, expect, it } from 'vitest'
import { commandNodesFromResponse, commandWeatherItems, mergeCommandNodeResults, trustedMarketMetrics } from './spatialCommand'
import {
  mappingMatchesScope,
  mergeSourceTruthMetas,
  resolveGridSpatialPriceRegion,
  resolveGridSpatialWeatherSource,
  resolveScopedOutputSources,
} from './marketSpatialScope'
import type { GridGeoNode, GridGeoNodeListResponse, GridGeoPlantIntegrations, GridGeoWeatherSnapshot } from './types'

function node(overrides: Partial<GridGeoNode> = {}): GridGeoNode {
  return {
    assetId: 'node:one', assetType: 'node', nodeId: 'node:one', standardName: '节点一', nodeName: '节点一', aliases: [],
    nodeKind: 'pricing', voltageLevelKv: null, status: 'active', locationStatus: 'located',
    location: {
      longitude: 102, latitude: 25, coordinateSystem: 'WGS84', locationLabel: '核验位置', accuracyLevel: 'site',
      confidence: 'verified', uncertaintyMeters: 0, displayPolicy: 'exact-marker', coordinateSource: null, evidence: [],
    },
    marketRefs: {}, regionId: 'yunnan', ownerCompanyId: 'company-one', version: 1, gridOperator: 'csg', visibility: 'company', sourceRef: 'test',
    dataMeta: { sourceType: 'MANUAL', mock: false, productionWrite: false, visibility: 'company', contractVersion: '1', verifiedAt: null, note: '' },
    overrideState: { hasOverrides: false, count: 0, fieldPaths: [], latestVersion: null, updatedAt: null },
    storageMeta: { sourceType: 'DB', mock: false, productionWrite: false, schemaVersion: '1', updatedAt: '2026-07-11' },
    ...overrides,
  }
}

function nodeResponse(items: GridGeoNode[]): GridGeoNodeListResponse {
  return {
    code: 200,
    data: {
      items,
      summary: { visibleCount: items.length, locatedCount: items.length, approximateCount: 0, unresolvedCount: 0, overriddenCount: 0 },
      pagination: { page: 1, pageSize: 500, total: items.length, totalPages: 1 },
      dataAvailability: { status: items.length ? 'available' : 'missing', fallback: false },
    },
    total: items.length, sourceType: 'DB', mock: false, productionWrite: false,
  }
}

function weather(overrides: Partial<GridGeoWeatherSnapshot> = {}): GridGeoWeatherSnapshot {
  return {
    plantId: 'plant-one', validAt: '2026-07-11T00:00:00Z', intervalSeconds: 3600, weatherCode: 0, weatherLabel: '晴', weatherCategory: 'clear',
    temperatureC: 24, relativeHumidityPercent: 50, precipitationMm: 0, cloudCoverPercent: 20, windSpeedMs: 5, windDirectionDeg: 90, shortwaveRadiationWm2: 600,
    sampledLocation: { longitude: 102, latitude: 25, elevationM: 1800, timezone: 'Asia/Shanghai' },
    ...overrides,
  }
}

describe('spatial command truth filters', () => {
  it('只保留具有合法 WGS84 坐标的节点', () => {
    const unresolved = node({ assetId: 'node:unresolved', nodeId: 'node:unresolved', locationStatus: 'unresolved', location: null })
    const invalid = node({ assetId: 'node:invalid', nodeId: 'node:invalid', location: { ...node().location!, longitude: 999 } })
    const result = commandNodesFromResponse(nodeResponse([node(), unresolved, invalid]))
    expect(result.nodes.map((item) => item.nodeId)).toEqual(['node:one'])
    expect(result.excludedInvalidCoordinates).toBe(2)
    expect(result.truncatedByPage).toBe(false)
  })

  it('located 与 approximate 两档合并入图，截断与剔除计数叠加', () => {
    const approximate = node({
      assetId: 'node:approx', nodeId: 'node:approx', locationStatus: 'approximate',
      location: {
        ...node().location!, accuracyLevel: 'village', confidence: 'unverified',
        uncertaintyMeters: 2220, displayPolicy: 'uncertainty-halo', locationLabel: '某村（范围级参考点）',
      },
    })
    const locatedResult = commandNodesFromResponse(nodeResponse([node()]))
    const approximateResult = commandNodesFromResponse(nodeResponse([approximate]))
    const merged = mergeCommandNodeResults(locatedResult, approximateResult)
    expect(merged.nodes.map((item) => item.nodeId)).toEqual(['node:one', 'node:approx'])
    expect(merged.total).toBe(2)
    expect(merged.truncatedByPage).toBe(false)
    expect(merged.excludedInvalidCoordinates).toBe(0)
    expect(merged.mock).toBe(false)
  })

  it('任一档为 Mock 时合并结果整体拒绝', () => {
    const realResult = commandNodesFromResponse(nodeResponse([node()]))
    const mockResult = { ...commandNodesFromResponse(nodeResponse([node()])), mock: true }
    expect(mergeCommandNodeResults(realResult, mockResult).mock).toBe(true)
  })

  it('天气缺测不被补成零值图形', () => {
    const missingWind = weather({ plantId: 'missing', windSpeedMs: null })
    expect(commandWeatherItems([weather(), missingWind], 'wind').map((item) => item.plantId)).toEqual(['plant-one'])
  })

  it('任一市场来源为 Mock 时不向地图输出指标', () => {
    const snapshot = {
      metrics: [{ plantId: 'plant-one' }],
      sources: { nodePrice: { mock: true }, output: { mock: false } },
    } as unknown as Parameters<typeof trustedMarketMetrics>[0]
    expect(trustedMarketMetrics(snapshot)).toEqual([])
  })

  it('仅允许读取 owner registry 与所选公司一致的出力族', () => {
    const mapping = {
      asset: { plantId: 'plant-one', version: 1, regionId: 'yunnan', ownerCompanyId: 'comp-cgn-yunnan' },
      domains: { output: { status: 'configured', family: 'yn_plant_output', dataset: 'yn_plant_output' } },
    } as unknown as GridGeoPlantIntegrations
    expect(resolveScopedOutputSources([mapping], 'comp-cgn-yunnan', 'yunnan')).toEqual([
      { family: 'yn_plant_output', dataset: 'yn_plant_output', region: 'yunnan' },
    ])
    expect(resolveScopedOutputSources([mapping], 'another-company', 'yunnan')).toEqual([])
    expect(mappingMatchesScope(mapping, 'comp-cgn-yunnan', 'guangdong')).toBe(false)
  })

  it('市场与气象数据源按地区精确解析且不回退云南', () => {
    expect(resolveGridSpatialPriceRegion('yunnan')).toBe('云南')
    expect(resolveGridSpatialPriceRegion('shanxi')).toBe('山西')
    expect(resolveGridSpatialPriceRegion('unknown-region')).toBeNull()
    expect(resolveGridSpatialWeatherSource('yunnan')).toMatchObject({
      region: 'yunnan',
      meteo: { family: 'yn_meteo', dataset: 'yn_meteo_hourly' },
    })
    expect(resolveGridSpatialWeatherSource('guangdong')).toBeNull()
  })

  it('DA/RT 与气象双源的 Mock 真相按 OR 聚合', () => {
    const sources = mergeSourceTruthMetas([
      { sourceType: 'CAPTURE', mock: false, productionWrite: false, updatedAt: '2026-07-10T00:00:00Z' },
      { sourceType: 'MOCK', mock: true, productionWrite: false, updatedAt: '2026-07-11T00:00:00Z' },
    ])
    expect(sources).toEqual({
      sourceType: 'CAPTURE+MOCK', mock: true, productionWrite: false, updatedAt: '2026-07-11T00:00:00Z',
    })
  })
})
