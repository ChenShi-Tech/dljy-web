import { describe, expect, it } from 'vitest'
import { buildMarketDigest } from '@/services/trading/marketDigest'

const volume = Array.from({ length: 96 }, (_, i) => 10 + (i % 4)) // 每小时均值 10+1.5=11.5
const price = Array.from({ length: 96 }, (_, i) => 100 + Math.floor(i / 4) * 10) // 每小时 +10

describe('buildMarketDigest：S7 市场概况（本单口径）', () => {
  it('出清已登记 → 口径用出清；开/收/高/低/加权均价齐备', () => {
    const d = buildMarketDigest(volume, volume.map((v) => v * 2), price)
    expect(d).not.toBeNull()
    expect(d!.sourceBasis).toBe('cleared')
    expect(d!.totalVolumeMwh).toBeCloseTo((10 + 1.5) * 96, 0)
    expect(d!.openYuanPerMwh).toBe(100)
    expect(d!.closeYuanPerMwh).toBe(330)
    expect(d!.highYuanPerMwh).toBe(330)
    expect(d!.lowYuanPerMwh).toBe(100)
    expect(d!.highHour).toBe(23)
    expect(d!.lowHour).toBe(0)
    expect(d!.weightedAvgYuanPerMwh).toBeGreaterThan(100)
    expect(d!.hourly).toHaveLength(24)
    expect(d!.hourly[5]!.volumeMwh).toBeCloseTo(11.5, 1)
  })

  it('无出清 → 回落本单申报口径并如实标注', () => {
    const d = buildMarketDigest(null, volume, price)
    expect(d!.sourceBasis).toBe('declared')
  })

  it('价格缺失 → 只给量侧，价格统计为 null 不用 0 冒充', () => {
    const d = buildMarketDigest(volume, null, null)
    expect(d!.totalVolumeMwh).toBeGreaterThan(0)
    expect(d!.openYuanPerMwh).toBeNull()
    expect(d!.highYuanPerMwh).toBeNull()
    expect(d!.weightedAvgYuanPerMwh).toBeNull()
  })

  it('量价曲线都没有 → null（无对象可统计）', () => {
    expect(buildMarketDigest(null, null, price)).toBeNull()
    expect(buildMarketDigest(null, [1, 2, 3], price)).toBeNull()
  })
})
