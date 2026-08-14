import { describe, expect, it } from 'vitest'
import {
  appendCorrection,
  appendEntry,
  backfillActual,
  coverageOf,
  hitRate,
  validateDraft,
  verifyChain,
  type DecisionLogDraft,
  type DecisionLogEntry
} from 'shared/trading-rules/decision-log.mjs'

function draft(overrides: Partial<DecisionLogDraft> = {}): DecisionLogDraft {
  return {
    at: '2026-08-09T08:20:00+08:00',
    targetDate: '2026-08-10',
    decisionPoint: '储能充放时段选择',
    judgement: '低谷 02-05 时充电、尖峰 19-20 时放电，单循环',
    rationale: '尖谷价差 340 元/MWh，要求价差 109 元/MWh，安全倍数 3.1',
    p10: 180,
    p50: 240,
    p90: 380,
    confidence: 75,
    author: 'trader',
    correctionOf: null,
    ...overrides
  }
}

function buildLog(n: number): DecisionLogEntry[] {
  const log: DecisionLogEntry[] = []
  for (let i = 0; i < n; i += 1) {
    log.push(appendEntry(log, draft({ decisionPoint: `决策点 ${i + 1}` })))
  }
  return log
}

describe('P10/P50/P90 必填且必须构成分布', () => {
  it('三点式缺任一项即拒写', () => {
    expect(validateDraft(draft({ p50: Number.NaN }))).toContainEqual(
      expect.objectContaining({ field: 'p50' })
    )
  })

  it('顺序颠倒即拒写——那不是分布，是在凑字段', () => {
    const issues = validateDraft(draft({ p10: 400, p50: 240, p90: 180 }))
    expect(issues.some((i) => i.message.includes('P10 ≤ P50 ≤ P90'))).toBe(true)
  })

  it('理由与决策人必填（决策人不可代签）', () => {
    expect(validateDraft(draft({ rationale: '   ' })).some((i) => i.field === 'rationale')).toBe(true)
    expect(validateDraft(draft({ author: '' })).some((i) => i.field === 'author')).toBe(true)
  })

  it('校验不过时 appendEntry 抛错，不写入半条', () => {
    const log: DecisionLogEntry[] = []
    expect(() => appendEntry(log, draft({ p10: 999 }))).toThrow(/校验未通过/)
    expect(log).toHaveLength(0)
  })

  it('合法草稿可写入，序号从 1 连续递增', () => {
    const log = buildLog(3)
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3])
  })
})

describe('哈希链：写后不可改', () => {
  it('新链完整', () => {
    expect(verifyChain(buildLog(4)).intact).toBe(true)
  })

  it('空链视为完整', () => {
    expect(verifyChain([]).intact).toBe(true)
  })

  it('改动已写入条目的判断结论 → 链断，并定位到该条', () => {
    const log = buildLog(4)
    log[1] = { ...log[1], judgement: '事后改成一个更好看的结论' }
    const v = verifyChain(log)
    expect(v.intact).toBe(false)
    expect(v.brokenAtSeq).toBe(2)
    expect(v.reason).toContain('被改过')
  })

  it('改动 P50 同样被检出（三点式属参与哈希字段）', () => {
    const log = buildLog(3)
    log[2] = { ...log[2], p50: 999 }
    expect(verifyChain(log).intact).toBe(false)
  })

  it('删掉中间一条 → 链断（前链哈希对不上）', () => {
    const log = buildLog(4)
    const tampered = [log[0], log[2], log[3]]
    const v = verifyChain(tampered)
    expect(v.intact).toBe(false)
    expect(v.reason).toMatch(/序号不连续|前链哈希不匹配/)
  })

  it('重排顺序 → 链断', () => {
    const log = buildLog(3)
    const v = verifyChain([log[1], log[0], log[2]])
    expect(v.intact).toBe(false)
  })
})

describe('T+2 回填不破坏链（可回填但不可篡改）', () => {
  it('回填 actual/lesson 后链仍完整', () => {
    const log = buildLog(3)
    log[1] = backfillActual(log[1], 260, '尖峰比预期低，下次把外送计划权重调高')
    const v = verifyChain(log)
    expect(v.intact).toBe(true)
    expect(log[1].actual).toBe(260)
  })

  it('但改判断字段仍然会断链——两者的差别正是「可回填」与「可篡改」的边界', () => {
    const log = buildLog(3)
    log[1] = backfillActual(log[1], 260)
    expect(verifyChain(log).intact).toBe(true)
    log[1] = { ...log[1], rationale: '换个说法' }
    expect(verifyChain(log).intact).toBe(false)
  })
})

describe('更正走追加，不走修改', () => {
  it('更正记录指向被更正条目，原条目原样保留', () => {
    const log = buildLog(2)
    const originalJudgement = log[0].judgement
    const correction = appendCorrection(log, log[0].id, draft({ judgement: '更正：应为双循环' }))
    log.push(correction)

    expect(log[0].judgement).toBe(originalJudgement)
    expect(correction.correctionOf).toBe(log[0].id)
    expect(verifyChain(log).intact).toBe(true)
  })

  it('更正不存在的条目会被拒', () => {
    const log = buildLog(1)
    expect(() => appendCorrection(log, 'DL-NOT-EXIST', draft())).toThrow(/不存在/)
  })
})

describe('填写率（一票否决）与事后校准', () => {
  it('填写率按当日非更正条目计——更正记录不该把覆盖率灌水', () => {
    const log = buildLog(2)
    log.push(appendCorrection(log, log[0].id, draft({ judgement: '更正' })))
    const cov = coverageOf(log, '2026-08-10', 3)
    expect(cov.recorded).toBe(2)
    expect(cov.meetsVeto).toBe(false)
  })

  it('记满即达成一票否决要求', () => {
    const cov = coverageOf(buildLog(3), '2026-08-10', 3)
    expect(cov.rate).toBe(1)
    expect(cov.meetsVeto).toBe(true)
    expect(cov.pendingBackfill).toBe(3)
  })

  it('命中率 = 实际值落在 P10–P90 的比例（未回填的不计入）', () => {
    const log = buildLog(3)
    log[0] = backfillActual(log[0], 200) // 在 [180,380] 内
    log[1] = backfillActual(log[1], 500) // 超出 P90
    const hr = hitRate(log)
    expect(hr.evaluated).toBe(2)
    expect(hr.hits).toBe(1)
    expect(hr.rate).toBeCloseTo(0.5, 4)
  })

  it('无回填数据时命中率为 null，而不是伪装成 0', () => {
    expect(hitRate(buildLog(2)).rate).toBeNull()
  })
})
