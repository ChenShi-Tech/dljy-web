import { describe, expect, it } from 'vitest'

import {
  MERCATOR_MAX_LATITUDE,
  clampLatitude,
  latitudeToTileY,
  longitudeToTileX,
  pickTileZoom,
  projectMercator,
  tileCount,
  tileXToLongitude,
  tileYToLatitude,
  unprojectMercator,
} from './webMercator'

describe('webMercator 投影', () => {
  it('本初子午线与赤道投到原点', () => {
    const [x, y] = projectMercator([0, 0])
    expect(x).toBeCloseTo(0, 12)
    expect(y).toBeCloseTo(0, 12)
  })

  it('屏幕语义：纬度越大 y 越小（北在上）', () => {
    // 这条是整层贴图能对齐的前提。若哪天 ECharts 改了 project 结果的处理方向，
    // 这里会先红——而不是等到实机上看见底图上下颠倒。
    const north = projectMercator([102, 30])[1]
    const south = projectMercator([102, 20])[1]
    expect(north).toBeLessThan(south)
  })

  it('经度线性、与纬度无关', () => {
    expect(projectMercator([90, 0])[0]).toBeCloseTo(Math.PI / 2, 12)
    expect(projectMercator([102, 25])[0]).toBeCloseTo(projectMercator([102, -40])[0], 12)
  })

  it('unproject 是 project 的逆（云南范围内往返无损）', () => {
    for (const point of [[97.5, 21.1], [102.15, 24.85], [106.2, 29.2], [-180, -85], [179.9, 85]]) {
      const back = unprojectMercator(projectMercator(point))
      expect(back[0]).toBeCloseTo(point[0], 9)
      expect(back[1]).toBeCloseTo(clampLatitude(point[1]), 9)
    }
  })

  it('极区纬度裁剪到 Mercator 边界，不产生 Infinity', () => {
    expect(clampLatitude(90)).toBe(MERCATOR_MAX_LATITUDE)
    expect(clampLatitude(-90)).toBe(-MERCATOR_MAX_LATITUDE)
    expect(Number.isFinite(projectMercator([0, 90])[1])).toBe(true)
    expect(Number.isFinite(projectMercator([0, -90])[1])).toBe(true)
  })

  it('非法输入返回 NaN 而不是抛错（geo 未就绪时会传进脏值）', () => {
    expect(projectMercator([Number.NaN, 25]).every(Number.isNaN)).toBe(true)
    expect(unprojectMercator([undefined as unknown as number, 0]).every(Number.isNaN)).toBe(true)
  })
})

describe('瓦片索引换算', () => {
  it('z=0 全球一张；经纬度落在 [0,1)', () => {
    expect(longitudeToTileX(-180, 0)).toBeCloseTo(0, 12)
    expect(longitudeToTileX(180, 0)).toBeCloseTo(1, 12)
    expect(latitudeToTileY(MERCATOR_MAX_LATITUDE, 0)).toBeCloseTo(0, 6)
    expect(latitudeToTileY(-MERCATOR_MAX_LATITUDE, 0)).toBeCloseTo(1, 6)
  })

  it('tileX/tileY 与其逆函数往返一致', () => {
    for (const z of [1, 6, 10, 14]) {
      const x = longitudeToTileX(102.15, z)
      const y = latitudeToTileY(24.85, z)
      expect(tileXToLongitude(x, z)).toBeCloseTo(102.15, 9)
      expect(tileYToLatitude(y, z)).toBeCloseTo(24.85, 9)
    }
  })

  it('瓦片行列随层级翻倍', () => {
    expect(tileCount(0)).toBe(1)
    expect(tileCount(8)).toBe(256)
    expect(Math.floor(longitudeToTileX(0, 8))).toBe(128)
  })

  it('pickTileZoom：视口越窄层级越高', () => {
    const wide = pickTileZoom(60, 1200)
    const narrow = pickTileZoom(1, 1200)
    expect(narrow).toBeGreaterThan(wide)
    // 云南全省约 9° 经度跨度、1200px 宽 → 目视应落在 z7 附近
    expect(pickTileZoom(9, 1200)).toBeGreaterThanOrEqual(6)
    expect(pickTileZoom(9, 1200)).toBeLessThanOrEqual(8)
  })

  it('pickTileZoom：非法输入与越界都收敛到区间内', () => {
    expect(pickTileZoom(0, 1200)).toBe(1)
    expect(pickTileZoom(9, 0)).toBe(1)
    expect(pickTileZoom(1e-9, 4000)).toBeLessThanOrEqual(18)
    expect(pickTileZoom(360, 100, { min: 3 })).toBeGreaterThanOrEqual(3)
  })
})
