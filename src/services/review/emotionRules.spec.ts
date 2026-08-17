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

  it('追涨/杀跌 v1 不打标（价格联动未接入，宁缺勿滥），覆盖说明如实呈现', () => {
    const out = detectEmotionPatterns([e()])
    expect(out.patterns.some((p) => p.kind === 'chase_up' || p.kind === 'panic_sell')).toBe(false)
    expect(out.coverageNote).toContain('价格波动上下文')
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
