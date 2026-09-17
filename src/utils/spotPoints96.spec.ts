// 回归锚：五份历史副本的口径逐字保真（末日 24:00 不回绕 00:00、两位补零、p1…p96 与点序一致）。
import { describe, expect, it } from 'vitest'
import { POINTS_96, PTS_96, pointLabel } from '@/utils/spotPoints96'

describe('spotPoints96 96 点时刻标签单一来源', () => {
  it('共 96 点，首点 00:15、末点 24:00（段末口径，不回绕成 00:00）', () => {
    expect(POINTS_96).toHaveLength(96)
    expect(POINTS_96[0]).toBe('00:15')
    expect(POINTS_96[95]).toBe('24:00')
  })

  it('两位补零与逐点推进：第 4 点（第 60 分钟）为 01:00', () => {
    expect(pointLabel(3)).toBe('01:00')
    expect(pointLabel(4)).toBe('01:15')
  })

  it('标签严格递增（字符串序与时间序一致，可作 x 轴类目）', () => {
    for (let i = 1; i < POINTS_96.length; i++) {
      expect(POINTS_96[i] > POINTS_96[i - 1]).toBe(true)
    }
  })

  it('PTS_96 字段名 p1…p96 与点序一致', () => {
    expect(PTS_96).toHaveLength(96)
    expect(PTS_96[0]).toBe('p1')
    expect(PTS_96[95]).toBe('p96')
  })
})
