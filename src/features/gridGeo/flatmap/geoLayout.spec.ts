import { describe, expect, it } from 'vitest'

import { GEO_INSET, mercatorAspect, pickGeoBoxLayout } from './geoLayout'
import { projectMercator } from './webMercator'

/** 云南省 bbox，与实机 `provinceBBox` 一致。 */
const YUNNAN_BBOX = [97.53, 21.14, 106.2, 29.25]

describe('mercatorAspect', () => {
  it('云南投影后是竖高的（≈0.97 < 1），而按经纬度直接算会得到 1.07 > 1', () => {
    const projected = mercatorAspect(YUNNAN_BBOX, projectMercator)
    expect(projected).toBeCloseTo(0.966, 3)
    // 关键不是数值本身而是它跨在 1 的哪一侧：naive 值 > 1（横长），投影后 < 1（竖高），
    // 用错就会把钉边方向选反。两者数值只差 10%，靠眼睛比不出来。
    expect(projected).toBeLessThan(1)
    const naive = (YUNNAN_BBOX[2] - YUNNAN_BBOX[0]) / (YUNNAN_BBOX[3] - YUNNAN_BBOX[1])
    expect(naive).toBeGreaterThan(1)
  })

  it('退化 bbox（南北为零）返回 NaN，交给调用方兜底', () => {
    expect(mercatorAspect([100, 25, 105, 25], projectMercator)).toBeNaN()
  })
})

describe('pickGeoBoxLayout', () => {
  /**
   * 这条守的是「地图被横向拉伸」那个缺陷。四边 top/left/right/bottom 全给会让
   * ECharts 的 aspect 换算失效并非等比铺满容器；只钉瓶颈方向的两条边，另一边留空，
   * aspect 才会生效。所以断言的实质是「另一个方向必须留空」。
   */
  it('宽容器 + 竖高地图 → 钉上下、水平居中，左右留给 aspect', () => {
    const layout = pickGeoBoxLayout(0.85, 1631, 892)
    expect(layout).toEqual({ top: GEO_INSET, bottom: GEO_INSET, left: 'center' })
    expect(layout.right).toBeUndefined()
  })

  it('窄容器 + 竖高地图 → 改钉左右、垂直居中，上下留给 aspect', () => {
    const layout = pickGeoBoxLayout(0.85, 600, 1200)
    expect(layout).toEqual({ left: GEO_INSET, right: GEO_INSET, top: 'middle' })
    expect(layout.bottom).toBeUndefined()
  })

  it('扁地图塞进宽容器时也按宽度受限走（下钻到东西向的州）', () => {
    // 容器 1631×892 可用比 1.86；地图比 2.4 更扁 → 宽度先到顶
    expect(pickGeoBoxLayout(2.4, 1631, 892)).toEqual({ left: GEO_INSET, right: GEO_INSET, top: 'middle' })
  })

  it('两个方向永远不会同时钉死——那正是拉伸变形的成因', () => {
    for (const [aspect, w, h] of [[0.85, 1631, 892], [0.85, 600, 1200], [2.4, 1631, 892], [1, 800, 800]] as const) {
      const layout = pickGeoBoxLayout(aspect, w, h)
      const pinnedHorizontally = layout.left === GEO_INSET && layout.right === GEO_INSET
      const pinnedVertically = layout.top === GEO_INSET && layout.bottom === GEO_INSET
      expect(pinnedHorizontally && pinnedVertically).toBe(false)
    }
  })

  it('地图比例不可用时回落到高度受限（驾驶舱容器恒为宽屏）', () => {
    expect(pickGeoBoxLayout(Number.NaN, 1631, 892)).toEqual({ top: GEO_INSET, bottom: GEO_INSET, left: 'center' })
    expect(pickGeoBoxLayout(0, 1631, 892)).toEqual({ top: GEO_INSET, bottom: GEO_INSET, left: 'center' })
  })

  it('容器尺寸为 0 时不除零，仍给出合法布局', () => {
    expect(pickGeoBoxLayout(0.85, 0, 0)).toEqual({ top: GEO_INSET, bottom: GEO_INSET, left: 'center' })
  })
})
