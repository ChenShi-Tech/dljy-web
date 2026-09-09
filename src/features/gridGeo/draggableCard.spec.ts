import { describe, expect, it } from 'vitest'

import { MIN_VISIBLE_PX, clampCardOffset, drawerAvoidanceShift } from './draggableCard'

const CARD = { width: 410, height: 220 }
const STAGE = { width: 1600, height: 860 }
const BASE_RIGHT = 382
const BASE_BOTTOM = 58

describe('clampCardOffset', () => {
  it('范围内的偏移原样返回', () => {
    expect(clampCardOffset({ x: 120, y: 60 }, CARD, STAGE, BASE_RIGHT, BASE_BOTTOM)).toEqual({ x: 120, y: 60 })
  })

  /**
   * 这两条是本模块存在的理由：卡片一旦被拖出舞台就再也抓不回来——指针已经不在它上面，
   * 而卡片没有别的复位入口。所以任何方向都必须留一截在舞台内。
   */
  it('向左拖不会越过舞台左边缘', () => {
    const clamped = clampCardOffset({ x: 99999, y: 0 }, CARD, STAGE, BASE_RIGHT, BASE_BOTTOM)
    expect(clamped.x).toBe(STAGE.width - CARD.width - BASE_RIGHT)
  })

  it('向右拖至少留 48px 在舞台内', () => {
    const clamped = clampCardOffset({ x: -99999, y: 0 }, CARD, STAGE, BASE_RIGHT, BASE_BOTTOM)
    expect(clamped.x).toBe(-(BASE_RIGHT + CARD.width - MIN_VISIBLE_PX))
  })

  it('上下同样被钳制', () => {
    expect(clampCardOffset({ x: 0, y: 99999 }, CARD, STAGE, BASE_RIGHT, BASE_BOTTOM).y)
      .toBe(STAGE.height - CARD.height - BASE_BOTTOM)
    expect(clampCardOffset({ x: 0, y: -99999 }, CARD, STAGE, BASE_RIGHT, BASE_BOTTOM).y)
      .toBe(-(BASE_BOTTOM + CARD.height - MIN_VISIBLE_PX))
  })

  it('舞台尺寸未知时归零，不把卡片甩到不可见处', () => {
    expect(clampCardOffset({ x: 300, y: 200 }, CARD, { width: 0, height: 0 }, BASE_RIGHT, BASE_BOTTOM))
      .toEqual({ x: 0, y: 0 })
  })
})

describe('drawerAvoidanceShift', () => {
  it('抽屉未打开时不位移', () => {
    expect(drawerAvoidanceShift(false, 580, BASE_RIGHT)).toBe(0)
  })

  it('抽屉会盖住卡片时，左移到刚好让开', () => {
    // 抽屉 580 + 间距 16 = 596，卡片本来只离右边 382 → 需要再让 214
    expect(drawerAvoidanceShift(true, 580, BASE_RIGHT)).toBe(214)
  })

  /**
   * 卡片本来就在抽屉左边时不该动。无条件左移会让它在宽屏上莫名其妙跑到画面中间，
   * 用户会以为卡片自己乱跳。
   */
  it('卡片本就在抽屉左边时不动', () => {
    expect(drawerAvoidanceShift(true, 580, 700)).toBe(0)
  })

  it('间距可调', () => {
    expect(drawerAvoidanceShift(true, 580, BASE_RIGHT, 0)).toBe(198)
  })
})
