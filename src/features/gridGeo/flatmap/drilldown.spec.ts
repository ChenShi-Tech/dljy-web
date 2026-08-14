import { describe, expect, it } from 'vitest'
import {
  boundaryBBox,
  boundsParam,
  collectionBBox,
  focusViewport,
  pointInBoundary,
  topologyFeatureInBoundary,
  type BBox,
} from './drilldown'
import type { BoundaryFeature } from './geoJsonLoader'
import type { GridTopologyFeature } from '../types'

/** DataV 口径的地州要素（properties 字段与真实数据一致，坐标简化为可手算的方形）。 */
function square(adcode: number, name: string, west: number, south: number, size: number): BoundaryFeature {
  return {
    type: 'Feature',
    properties: { adcode, name, level: 'city', center: [west + size / 2, south + size / 2], acroutes: [100000, 530000] },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [west + size, south],
        [west + size, south + size],
        [west, south + size],
        [west, south],
      ]],
    },
  }
}

/** 带洞的地州：外框 0..10，洞 4..6（插花地场景）。 */
const withHole: BoundaryFeature = {
  type: 'Feature',
  properties: { adcode: 530100, name: '昆明市' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  },
}

/** 飞地：两块互不相连的方形。 */
const multiPolygon: BoundaryFeature = {
  type: 'Feature',
  properties: { adcode: 532500, name: '红河哈尼族彝族自治州' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[8, 8], [10, 8], [10, 10], [8, 10], [8, 8]]],
    ],
  },
}

function topologyFeature(geometry: GridTopologyFeature['geometry'], kind: GridTopologyFeature['kind'] = 'section'): GridTopologyFeature {
  return {
    featureId: 'f-1',
    kind,
    name: '测试要素',
    status: 'active',
    topologyVersion: 'v1',
    sourceRef: 'test',
    classification: 'restricted',
    ownerCompanyId: 'c-1',
    regionId: 'yunnan',
    gridOperator: 'csg',
    geometry,
  }
}

describe('boundaryBBox', () => {
  it('computes the bbox of a polygon', () => {
    expect(boundaryBBox(square(530300, '曲靖市', 100, 24, 2))).toEqual([100, 24, 102, 26])
  })

  it('spans every part of a multipolygon', () => {
    expect(boundaryBBox(multiPolygon)).toEqual([0, 0, 10, 10])
  })

  it('returns null for geometry that is not a polygon', () => {
    const broken = { ...square(530100, '昆明市', 0, 0, 1), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
    expect(boundaryBBox(broken as BoundaryFeature)).toBeNull()
  })

  it('returns null instead of guessing when coordinates are malformed', () => {
    const broken = { ...square(530100, '昆明市', 0, 0, 1), geometry: { type: 'Polygon', coordinates: [[['a', 'b']]] } }
    expect(boundaryBBox(broken as unknown as BoundaryFeature)).toBeNull()
  })
})

describe('collectionBBox', () => {
  it('unions all subdivision bboxes', () => {
    const features = [square(530100, '昆明市', 102, 24, 1), square(532900, '大理白族自治州', 99, 25, 2)]
    expect(collectionBBox(features)).toEqual([99, 24, 103, 27])
  })

  it('skips unparsable features rather than failing whole province', () => {
    const broken = { ...square(530100, '昆明市', 0, 0, 1), geometry: { type: 'Point', coordinates: [1, 1] } } as BoundaryFeature
    expect(collectionBBox([broken, square(530300, '曲靖市', 5, 5, 1)])).toEqual([5, 5, 6, 6])
  })

  it('returns null for an empty collection', () => {
    expect(collectionBBox([])).toBeNull()
  })
})

describe('pointInBoundary', () => {
  const box = square(530100, '昆明市', 0, 0, 10)

  it('accepts an interior point and rejects an exterior one', () => {
    expect(pointInBoundary(box, 5, 5)).toBe(true)
    expect(pointInBoundary(box, 15, 5)).toBe(false)
    expect(pointInBoundary(box, 5, -1)).toBe(false)
  })

  it('excludes points inside a hole', () => {
    expect(pointInBoundary(withHole, 1, 1)).toBe(true)
    expect(pointInBoundary(withHole, 5, 5)).toBe(false)
  })

  it('accepts points in either part of a multipolygon and rejects the gap between them', () => {
    expect(pointInBoundary(multiPolygon, 1, 1)).toBe(true)
    expect(pointInBoundary(multiPolygon, 9, 9)).toBe(true)
    expect(pointInBoundary(multiPolygon, 5, 5)).toBe(false)
  })

  it('rejects invalid coordinates instead of throwing', () => {
    expect(pointInBoundary(box, Number.NaN, 5)).toBe(false)
    expect(pointInBoundary(box, 5, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('topologyFeatureInBoundary', () => {
  const box = square(530100, '昆明市', 0, 0, 10)

  it('matches a substation point inside the subdivision', () => {
    expect(topologyFeatureInBoundary(topologyFeature({ type: 'Point', coordinates: [5, 5] }, 'substation'), box)).toBe(true)
    expect(topologyFeatureInBoundary(topologyFeature({ type: 'Point', coordinates: [50, 5] }, 'substation'), box)).toBe(false)
  })

  it('keeps a cross-subdivision section when only one end is inside', () => {
    // 送出断面天生跨地州：要求「全部顶点在内」会把下钻最该看的要素全滤掉。
    const section = topologyFeature({ type: 'LineString', coordinates: [[5, 5], [40, 40]] })
    expect(topologyFeatureInBoundary(section, box)).toBe(true)
  })

  it('drops a section that lies entirely outside', () => {
    const section = topologyFeature({ type: 'LineString', coordinates: [[40, 40], [45, 45]] })
    expect(topologyFeatureInBoundary(section, box)).toBe(false)
  })

  it('walks every line of a multilinestring', () => {
    const intertie = topologyFeature({ type: 'MultiLineString', coordinates: [[[40, 40], [45, 45]], [[46, 46], [5, 5]]] }, 'intertie')
    expect(topologyFeatureInBoundary(intertie, box)).toBe(true)
  })

  it('treats malformed coordinates as unrelated', () => {
    const broken = topologyFeature({ type: 'LineString', coordinates: [] })
    expect(topologyFeatureInBoundary(broken, box)).toBe(false)
  })
})

describe('focusViewport', () => {
  const province: BBox = [97, 21, 106, 29]

  it('zooms by the tighter of the two span ratios', () => {
    // 地州跨度 3×2，省域 9×8 → min(3, 4) = 3
    const { center, zoom } = focusViewport([100, 24, 103, 26], province)
    expect(zoom).toBeCloseTo(3, 6)
    expect(center).toEqual([101.5, 25])
  })

  it('prefers the DataV label centre when provided', () => {
    const { center } = focusViewport([100, 24, 103, 26], province, [102.7, 25.05])
    expect(center).toEqual([102.7, 25.05])
  })

  it('caps zoom at 8 for tiny subdivisions', () => {
    expect(focusViewport([102, 25, 102.1, 25.1], province).zoom).toBe(8)
  })

  it('never zooms out below the province view', () => {
    expect(focusViewport([90, 10, 130, 50], province).zoom).toBe(1)
  })

  it('falls back to zoom 1 on degenerate boxes', () => {
    expect(focusViewport([102, 25, 102, 25], province).zoom).toBe(1)
  })
})

describe('boundsParam', () => {
  it('serialises west,south,east,north with padding', () => {
    expect(boundsParam([100, 24, 110, 26], 0.1)).toBe('99.000000,23.800000,111.000000,26.200000')
  })

  it('applies a minimum padding so degenerate boxes stay queryable', () => {
    expect(boundsParam([100, 24, 100, 24])).toBe('99.990000,23.990000,100.010000,24.010000')
  })
})
