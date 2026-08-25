// 情绪化识别规则 + 会议纪要纯逻辑测试（#2049）
import { describe, expect, it } from 'vitest'
import {
  detectEmotionPatterns,
  EMOTION_NOTE,
  type EmotionEntryLike
} from './emotionRules'
import { archiveDeadline, CASE_LIBRARY_NOTE } from './meetingMinutes'

const e = (over: Partial<EmotionEntryLike> = {}): EmotionEntryLike => ({
  seq: 1, targetDate: '2026-08-14', decisionPoint: '晚高峰申报量',
  p10: 90, p50: 100, p90: 110, actual: 105, ...over
})

/** 24 小时价格数组构造：未给小时为 null（缺价）。 */
function hourPrices(spots: Record<number, number>): Array<number | null> {
  return Array.from({ length: 24 }, (_, h) => (h in spots ? spots[h] : null))
}

describe('detectEmotionPatterns（先规则后模型 · 宁缺勿滥）', () => {
  it('过度自信候选：区间过窄（<中位 10%）且实际出区间', () => {
    const out = detectEmotionPatterns([
      e({ seq: 1, p10: 99, p50: 100, p90: 101, actual: 120 }), // 命中
      e({ seq: 2, p10: 90, p50: 100, p90: 110, actual: 120 }), // 区间宽 → 不命中（虽出区间）
      e({ seq: 3, p10: 99, p50: 100, p90: 101, actual: 100 }) // 区间窄但未出 → 不命中
    ])
    const oc = out.patterns.find((p) => p.kind === 'overconfidence')
    expect(oc).toBeTruthy()
    expect(oc!.seqs).toEqual([1])
    expect(oc!.evidence).toContain('#1')
  })

  it('犹豫候选：同标的日同决策点 ≥2 条（改判迹象）', () => {
    const out = detectEmotionPatterns([
      e({ seq: 1, decisionPoint: '晚高峰申报量' }),
      e({ seq: 2, decisionPoint: '晚高峰申报量' }),
      e({ seq: 3, decisionPoint: '早高峰申报量' })
    ])
    const hes = out.patterns.find((p) => p.kind === 'hesitation')
    expect(hes).toBeTruthy()
    expect(hes!.seqs).toHaveLength(2)
  })

  it('追涨/杀跌：上下文缺席不打标（价格联动未接入，宁缺勿滥），覆盖说明如实呈现', () => {
    const out = detectEmotionPatterns([e({ decisionTime: '2026-08-14T10:00:00Z', judgement: '看涨追价' })])
    expect(out.patterns.some((p) => p.kind === 'chase_up' || p.kind === 'panic_sell')).toBe(false)
    expect(out.coverageNote).toContain('价格波动上下文')
    expect(out.coverageNote).toContain('宁缺勿滥')
  })

  it('R3 追涨：决策时点小时价较前一小时涨 ≥15% 且判断同向看涨 → 打标', () => {
    const out = detectEmotionPatterns(
      [e({ seq: 7, decisionTime: '2026-08-14T10:30:00Z', judgement: '看涨，追价申报' })],
      { hourlyPrices: { '2026-08-14': hourPrices({ 9: 100, 10: 120 }) } }
    )
    const chase = out.patterns.find((p) => p.kind === 'chase_up')
    expect(chase).toBeTruthy()
    expect(chase!.seqs).toEqual([7])
    expect(out.patterns.some((p) => p.kind === 'panic_sell')).toBe(false)
  })

  it('R4 杀跌：决策时点小时价较前一小时跌 ≥15% 且判断同向看跌 → 打标', () => {
    const out = detectEmotionPatterns(
      [e({ seq: 8, decisionTime: '2026-08-14T15:00:00Z', judgement: '看跌，卖出回避' })],
      { hourlyPrices: { '2026-08-14': hourPrices({ 14: 100, 15: 80 }) } }
    )
    const panic = out.patterns.find((p) => p.kind === 'panic_sell')
    expect(panic).toBeTruthy()
    expect(panic!.seqs).toEqual([8])
  })

  it('R3/R4 三重前置缺一不打标：decisionTime 缺失 / 该小时缺价 / 方向不明 / 波动不足', () => {
    const prices = { '2026-08-14': hourPrices({ 9: 100, 10: 120, 15: 95 }) }
    const out = detectEmotionPatterns(
      [
        e({ seq: 1, judgement: '看涨追价' }), // 缺 decisionTime
        e({ seq: 2, decisionTime: '2026-08-14T11:00:00Z', judgement: '看涨追价' }), // 11 时缺价
        e({ seq: 3, decisionTime: '2026-08-14T10:00:00Z', judgement: '维持原样' }), // 方向不明
        e({ seq: 4, decisionTime: '2026-08-14T15:00:00Z', judgement: '看涨追价' }) // 15 时价格跌但判断看涨（不同向）
      ],
      { hourlyPrices: prices }
    )
    expect(out.patterns.some((p) => p.kind === 'chase_up' || p.kind === 'panic_sell')).toBe(false)
    expect(out.coverageNote).toContain('宁缺勿滥')
  })

  it('文化红线文案：学习辅导非考核、不做排名', () => {
    expect(EMOTION_NOTE).toContain('非考核依据')
    expect(EMOTION_NOTE).toContain('不做排名')
  })
})

describe('archiveDeadline（会后 1 个工作日归档提醒）', () => {
  it('工作日 +1；周五开会 → 下周一归档', () => {
    expect(archiveDeadline('2026-08-11')).toBe('2026-08-12') // 周二 → 周三
    expect(archiveDeadline('2026-08-14')).toBe('2026-08-17') // 周五 → 下周一
    expect(archiveDeadline('2026-08-15')).toBe('2026-08-17') // 周六 → 周一
  })

  it('非法日期返回 null 不抛', () => {
    expect(archiveDeadline('not-a-date')).toBeNull()
  })
})

describe('案例库检索强化占位', () => {
  it('visibility 默认不公开语义 + 不展示假案例', () => {
    expect(CASE_LIBRARY_NOTE).toContain('默认不公开')
    expect(CASE_LIBRARY_NOTE).toContain('不展示假案例')
  })
})
