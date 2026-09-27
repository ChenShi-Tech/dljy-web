import { describe, expect, it, vi } from 'vitest'
import { Math as CesiumMath } from 'cesium'

// regionContext 顶层读 window.localStorage，node 测试环境没有；本文件只测纯几何与守卫，
// stub 掉地区上下文，并把 geoJsonLoader（拖着 echarts/auth 一条长链）mock 成固定边界。
vi.mock('@/services/region/regionContext', () => ({
  selectedRegionId: { value: 'yunnan' },
}))
vi.mock('../flatmap/geoJsonLoader', () => ({
  loadBoundaryByAdcode: vi.fn(async () => YUNNAN_BOUNDARY),
}))

import { computeBoundaryRectangle, useRegionBoundary } from './useRegionBoundary'

const YUNNAN_BOUNDARY = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[100, 21], [106, 21], [106, 29], [100, 29], [100, 21]]],
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[98.5, 24], [99.5, 24], [99.5, 27], [98.5, 27], [98.5, 24]]]],
      },
    },
  ],
}

describe('computeBoundaryRectangle', () => {
  it('跨 Polygon 与 MultiPolygon 求经纬包围盒', () => {
    const rectangle = computeBoundaryRectangle(YUNNAN_BOUNDARY as never)
    expect(rectangle).not.toBeNull()
    expect(CesiumMath.toDegrees(rectangle!.west)).toBeCloseTo(98.5, 5)
    expect(CesiumMath.toDegrees(rectangle!.east)).toBeCloseTo(106, 5)
    expect(CesiumMath.toDegrees(rectangle!.south)).toBeCloseTo(21, 5)
    expect(CesiumMath.toDegrees(rectangle!.north)).toBeCloseTo(29, 5)
  })

  it('跳过非法坐标，全部非法时不给包围盒', () => {
    const invalid = {
      features: [{
        geometry: { coordinates: [[[Number.NaN, 25], [99, Number.NaN]]] },
      }],
    }
    expect(computeBoundaryRectangle(invalid as never)).toBeNull()
  })

  it('空要素集返回 null', () => {
    expect(computeBoundaryRectangle({ features: [] })).toBeNull()
    expect(computeBoundaryRectangle({} as never)).toBeNull()
  })
})

describe('useRegionBoundary', () => {
  it('初始无包围盒，dispose 归位引用', () => {
    const boundary = useRegionBoundary({ getViewer: () => null })
    expect(boundary.getBoundaryRectangle()).toBeNull()
    boundary.dispose()
    expect(boundary.getBoundaryRectangle()).toBeNull()
  })

  it('viewer 未就绪时同步省界安全返回', async () => {
    const boundary = useRegionBoundary({ getViewer: () => null })
    await expect(boundary.syncRegionBoundary()).resolves.toBeUndefined()
    expect(boundary.getBoundaryRectangle()).toBeNull()
  })
})
