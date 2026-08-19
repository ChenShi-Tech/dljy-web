import { describe, expect, it } from 'vitest'
import { aggregateMapPoints, clusterCellSizeDegrees } from './mapInteraction'

const POINTS = [
  { id: 'plant-a', longitude: 102.1, latitude: 24.1 },
  { id: 'plant-b', longitude: 102.3, latitude: 24.3 },
  { id: 'plant-c', longitude: 104.8, latitude: 26.2 },
]

describe('空间资产地图聚合', () => {
  it('只在远景镜头启用聚合', () => {
    expect(clusterCellSizeDegrees(1_600_000)).toBe(1.2)
    expect(clusterCellSizeDegrees(900_000)).toBe(0.62)
    expect(clusterCellSizeDegrees(300_000)).toBe(0)
  })

  it('远景将同一网格内的资产聚合，并保持稳定顺序与中心点', () => {
    const items = aggregateMapPoints(POINTS, 1_600_000)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: 'cluster',
      assetIds: ['plant-a', 'plant-b'],
    })
    expect(items[0].longitude).toBeCloseTo(102.2)
    expect(items[0].latitude).toBeCloseTo(24.2)
    expect(items[1]).toMatchObject({ kind: 'asset', id: 'plant-c' })
  })

  it('选中资产始终从聚合中拆出，避免选中态被遮蔽', () => {
    const items = aggregateMapPoints(POINTS, 1_600_000, 'plant-a')
    expect(items).toHaveLength(3)
    expect(items.find((item) => item.id === 'plant-a')).toMatchObject({ kind: 'asset' })
  })

  it('近景返回全部独立资产，且剔除非法坐标', () => {
    const items = aggregateMapPoints(
      [...POINTS, { id: 'invalid', longitude: Number.NaN, latitude: 0 }],
      300_000,
    )
    expect(items.map((item) => item.id)).toEqual(['plant-a', 'plant-b', 'plant-c'])
  })
})

// #1346 视觉/性能/可访问性门禁，聚合层系统性边界用例。
// mapInteraction.ts 的聚合只接 cameraHeightM（不接视口宽度）：
// 远/中/近景档对应不同缩放层级，390px 小视口本身的性能影响走组件层
// performanceProfile（requestRenderMode），浏览器级像素回归列为 follow-up。
describe('空间资产地图聚合边界（#1346 视觉门禁）', () => {
  it('空资产列表在任何视距下都返回空渲染项（不渲染幽灵图元）', () => {
    expect(aggregateMapPoints([], 1_600_000)).toEqual([])
    expect(aggregateMapPoints([], 300_000)).toEqual([])
    expect(aggregateMapPoints([], 720_000)).toEqual([])
  })

  it('单点资产：远景与近景都恒为单个 asset 项（绝不误判为 cluster）', () => {
    const single = [{ id: 'solo', longitude: 102.0, latitude: 24.0 }]
    const far = aggregateMapPoints(single, 1_600_000)
    expect(far).toHaveLength(1)
    expect(far[0]).toMatchObject({ kind: 'asset', id: 'solo' })
    expect(far[0].assetIds).toEqual(['solo'])
    const near = aggregateMapPoints(single, 300_000)
    expect(near).toHaveLength(1)
    expect(near[0].kind).toBe('asset')
  })

  it('大量实体聚合稳定且不丢资产（1000 个落同网格→全覆盖）', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      id: `plant-${String(i).padStart(4, '0')}`,
      longitude: 102.0 + (i % 10) * 0.001,
      latitude: 24.0 + Math.floor(i / 10) * 0.001,
    }))
    const far = aggregateMapPoints(many, 1_600_000)
    expect(far.length).toBeGreaterThanOrEqual(1)
    const covered = new Set(far.flatMap((item) => item.assetIds))
    expect(covered.size).toBe(1000)
    for (const plant of many) expect(covered.has(plant.id)).toBe(true)
  })

  it('cameraHeightM 非法/边界值一律按近景不聚合（cellSize=0，逐个 asset）', () => {
    const pts = [
      { id: 'a', longitude: 102.0, latitude: 24.0 },
      { id: 'b', longitude: 102.1, latitude: 24.1 },
    ]
    for (const bad of [Number.NaN, -1, 0, 719_999, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const items = aggregateMapPoints(pts, bad)
      expect(items).toHaveLength(2)
      expect(items.every((item) => item.kind === 'asset')).toBe(true)
    }
  })

  it('clusterCellSizeDegrees 各档边界（含阈值点与非法值）', () => {
    expect(clusterCellSizeDegrees(1_500_000)).toBe(1.2)
    expect(clusterCellSizeDegrees(1_499_999)).toBe(0.62)
    expect(clusterCellSizeDegrees(720_000)).toBe(0.62)
    expect(clusterCellSizeDegrees(719_999)).toBe(0)
    expect(clusterCellSizeDegrees(Number.NaN)).toBe(0)
    expect(clusterCellSizeDegrees(-100)).toBe(0)
  })

  it('选中态拆出后聚合主体仍覆盖其余资产（选中不丢、不被遮蔽）', () => {
    // p1/p2 同网格聚合，p3 单独；选中 p3 时 p1+p2 仍聚为 cluster，p3 拆出为 asset
    const pts = [
      { id: 'p1', longitude: 102.0, latitude: 24.0 },
      { id: 'p2', longitude: 102.1, latitude: 24.1 },
      { id: 'p3', longitude: 104.8, latitude: 26.2 },
    ]
    const items = aggregateMapPoints(pts, 1_600_000, 'p3')
    expect(items.find((item) => item.id === 'p3')?.kind).toBe('asset')
    expect(items.find((item) => item.kind === 'cluster')?.assetIds).toEqual(['p1', 'p2'])
  })

  it('选中列表中不存在的 id 安全降级为常规聚合（不破坏结果）', () => {
    const items = aggregateMapPoints(POINTS, 1_600_000, 'not-in-list')
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.kind === 'cluster')?.assetIds).toEqual(['plant-a', 'plant-b'])
  })

  it('完全相同坐标的多个资产在远景聚合为单一 cluster', () => {
    const same = [
      { id: 'x1', longitude: 100, latitude: 25 },
      { id: 'x2', longitude: 100, latitude: 25 },
      { id: 'x3', longitude: 100, latitude: 25 },
    ]
    const far = aggregateMapPoints(same, 1_600_000)
    expect(far).toHaveLength(1)
    expect(far[0].kind).toBe('cluster')
    expect(far[0].assetIds).toEqual(['x1', 'x2', 'x3'])
  })

  it('全部坐标非法的资产被全部剔除（不产生无效渲染项）', () => {
    const bad = [
      { id: 'nan-lon', longitude: Number.NaN, latitude: 24 },
      { id: 'nan-lat', longitude: 102, latitude: Number.NaN },
      { id: 'inf', longitude: Number.POSITIVE_INFINITY, latitude: 24 },
    ]
    expect(aggregateMapPoints(bad, 1_600_000)).toEqual([])
    expect(aggregateMapPoints(bad, 300_000)).toEqual([])
  })
})
