// 24 时段展示聚合测试（2026-08-13 拍板：底层 96 点、24 时段仅展示聚合）
import { describe, expect, it } from 'vitest'
import { aggregate96to24, hourOfPointIndex, segmentLabelsOf, SEGMENT_UNPARAMETERIZED_NOTE } from './slots24'
import type { SettlementRuleSpec } from '@/rules/types'

const spec = (timeSegmentFactors: SettlementRuleSpec['timeSegmentFactors']): SettlementRuleSpec =>
  ({
    regionId: 'test',
    version: 'v0',
    effectiveness: 'trial',
    deviationTolerancePct: 3,
    assessmentPriceBasis: 'da',
    assessmentPriceFloor: 0,
    timeSegmentFactors,
    recycleSubjects: [],
    notes: [],
    references: []
  }) as SettlementRuleSpec

describe('aggregate96to24（96 点 → 24 时段）', () => {
  it('每 4 点求和成 24 个时段；任一原始点缺失 → 该时段整体 null、相邻不受影响', () => {
    const full: (number | null)[] = Array.from({ length: 96 }, () => 2)
    expect(aggregate96to24(full)).toEqual(Array.from({ length: 24 }, () => 8))
    full[10] = null // 属于第 2 个时段（8–11 点位）
    const slots = aggregate96to24(full)
    expect(slots[2]).toBeNull()
    expect(slots[1]).toBe(8)
    expect(slots[3]).toBe(8)
  })

  it('空曲线返回空数组；非 96 长度按 4 点一组容错不抛', () => {
    expect(aggregate96to24([])).toEqual([])
    expect(aggregate96to24([1, 2, 3, 4, 5])).toEqual([10, 5])
  })
})

describe('hourOfPointIndex', () => {
  it('点位 → 小时（0–95 → 0–23），越界 null', () => {
    expect(hourOfPointIndex(0)).toBe(0)
    expect(hourOfPointIndex(95)).toBe(23)
    expect(hourOfPointIndex(-1)).toBeNull()
    expect(hourOfPointIndex(96)).toBeNull()
    expect(hourOfPointIndex(1.5)).toBeNull()
  })
})

describe('segmentLabelsOf（峰谷标识读 SettlementRuleSpec）', () => {
  it('按 hours[] 归属时段名；未命中小时标「平」（系数缺省 1 的同款兜底）', () => {
    const out = segmentLabelsOf(
      spec([
        { segment: '峰', hours: [10, 11, 12], factor: 1.2 },
        { segment: '谷', hours: [0, 1, 2], factor: 0.4 }
      ])
    )
    expect(out.parameterized).toBe(true)
    if (out.parameterized) {
      expect(out.labels).toHaveLength(24)
      expect(out.labels[11]).toBe('峰')
      expect(out.labels[1]).toBe('谷')
      expect(out.labels[15]).toBe('平')
    }
  })

  it('未参数化省份 → parameterized:false + 显式提示，不借用他省', () => {
    const out = segmentLabelsOf(null)
    expect(out.parameterized).toBe(false)
    if (!out.parameterized) {
      expect(out.labels).toBeNull()
      expect(out.note).toBe(SEGMENT_UNPARAMETERIZED_NOTE)
    }
    expect(segmentLabelsOf(spec([])).parameterized).toBe(false)
  })
})
