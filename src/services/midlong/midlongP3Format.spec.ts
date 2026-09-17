// 中长期售电 P3 展示口径（dljy#2973，MS-02/MS-04、MT-01/MT-02）。
// 守什么：剩余计划待售量与完成率在未核验/目标未确认时不显示 0、目标为零不算完成率、超计划显示负数与超过 100%；
//        公告时间未知显示「待补」、日历按北京时间分日；回执完整度不宣称受理；余额冲突提示带最新可安排量；页面用语无禁用口径。
// 坏掉的症状：未分解合同的月份显示「剩余 1000、完成率 0%」；超计划被显示成 0 或 100%；UTC 16:30 的截止被放到前一天。
import { describe, expect, it } from 'vitest'
import {
  arrangeableLabel, beijingDateTime, completionLabel, confirmFailureText, expectedPlanRevisionsOf, groupEventsByBeijingDate, receiptTag, remainingLabel,
  verificationTag,
} from './midlongP3Format'
import { FORBIDDEN_PLANNING_TERMS, RECEIPT_COMPLETENESS_LABELS, type PlanProgress, type ProposalComparison } from './midlongP3Types'

function progress(o: Partial<PlanProgress> = {}): PlanProgress {
  return {
    targetQuantity: '1000', knownSoldQuantity: '700', soldComplete: true, remainingPlanQuantity: '300', completionRate: '0.7', openOccupationQuantity: '200',
    arrangeableQuantity: '100', overPlan: false, verificationStatus: 'VERIFIED', notices: [], incompleteContracts: [], positionsAsOf: '2031-01-01T00:00:00.000Z', ...o,
  }
}

describe('完成情况展示', () => {
  it('已核验：剩余 300 MWh、完成率 70%、可安排 100 MWh', () => {
    const p = progress()
    expect([remainingLabel(p), completionLabel(p), arrangeableLabel(p)]).toEqual(['300 MWh', '70%', '100 MWh'])
    expect(verificationTag(p)).toEqual({ label: '已核验', type: 'success' })
  })

  it('超计划：剩余 -100 MWh、完成率 110%，不截断', () => {
    const p = progress({ knownSoldQuantity: '1100', remainingPlanQuantity: '-100', completionRate: '1.1', arrangeableQuantity: '-300', overPlan: true })
    expect(remainingLabel(p)).toBe('-100 MWh')
    expect(completionLabel(p)).toBe('110%')
    expect(arrangeableLabel(p)).toBe('-300 MWh')
  })

  it('已售未完成核验、目标未确认：显示待核验/目标未确认，不显示 0', () => {
    const unverified = progress({ soldComplete: false, remainingPlanQuantity: null, completionRate: null, arrangeableQuantity: null, verificationStatus: 'UNVERIFIED' })
    expect([remainingLabel(unverified), completionLabel(unverified), arrangeableLabel(unverified)]).toEqual(['待核验（不按零计）', '待核验（不按零计）', '待核验（不按零计）'])
    expect(verificationTag(unverified).label).toBe('结果未完成核验')
    const unknown = progress({ targetQuantity: null, remainingPlanQuantity: null, completionRate: null, arrangeableQuantity: null, verificationStatus: 'TARGET_UNKNOWN' })
    expect([remainingLabel(unknown), completionLabel(unknown)]).toEqual(['目标未确认', '目标未确认'])
    for (const text of [remainingLabel(unverified), completionLabel(unknown), arrangeableLabel(unknown)]) expect(text).not.toMatch(/^0/)
  })

  it('目标为零：完成率不计算，剩余照常显示', () => {
    const zero = progress({ targetQuantity: '0', knownSoldQuantity: '0', remainingPlanQuantity: '0', completionRate: null, arrangeableQuantity: '0' })
    expect(completionLabel(zero)).toBe('目标为零，不计算')
    expect(remainingLabel(zero)).toBe('0 MWh')
  })
})

describe('公告时间与日历', () => {
  it('时间未知显示待补，不补默认时刻；按北京时间显示', () => {
    expect(beijingDateTime(null)).toBe('待补')
    expect(beijingDateTime(undefined)).toBe('待补')
    expect(beijingDateTime('2031-04-20T09:00:00.000Z')).toBe('2031-04-20 17:00')
  })

  it('日历按北京时间分日：UTC 前一天 16:30 属于北京时间次日', () => {
    const groups = groupEventsByBeijingDate([
      { at: '2031-04-19T16:30:00.000Z', kind: 'DECLARATION_OPENS' },
      { at: '2031-04-20T09:00:00.000Z', kind: 'DECLARATION_CLOSES' },
      { at: '2031-04-21T09:00:00.000Z', kind: 'CONFIRMATION' },
    ])
    expect(groups.map((g) => [g.date, g.events.length])).toEqual([['2031-04-20', 2], ['2031-04-21', 1]])
  })
})

describe('提交登记与确认', () => {
  it('回执完整度：无回执为警示，齐全也只是中性信息，任何一档都不称受理', () => {
    expect(receiptTag('NONE').type).toBe('danger')
    expect(receiptTag('COMPLETE').type).toBe('info')
    for (const label of Object.values(RECEIPT_COMPLETENESS_LABELS)) expect(label).not.toMatch(/受理|成交/)
  })

  it('余额冲突提示列出最新可安排计划量；公告更正、目标换版、已售未核验分别说明', () => {
    const text = confirmFailureText('VERSION_CONFLICT', '冲突', { reason: 'ARRANGEABLE_BALANCE_EXCEEDED', conflicts: [{ periodKey: '2031-07', arrangeableQuantity: '20', requestedQuantity: '80' }] })
    expect(text).toContain('2031-07 剩余可安排 20 MWh，本方案需要 80 MWh')
    expect(confirmFailureText('VERSION_CONFLICT', 'x', { reason: 'WINDOW_REVISED' })).toContain('公告已有更正版本')
    expect(confirmFailureText('VERSION_CONFLICT', 'x', { reason: 'PLAN_REVISION_CHANGED' })).toContain('已换版')
    expect(confirmFailureText('INCOMPLETE_BASIS', 'x', { reason: 'SOLD_UNVERIFIED' })).toContain('方案保留为草稿')
    expect(confirmFailureText('INCOMPLETE_BASIS', 'x', { missing: ['负责人', '方案理由'] })).toBe('确认可执行前请补齐：负责人、方案理由')
  })

  it('确认时带上的目标版本只取当前已确认的目标', () => {
    const comparison = { plans: [{ planId: 1, currentRevisionNo: 2 }, { planId: 2, currentRevisionNo: null }] } as unknown as ProposalComparison
    expect(expectedPlanRevisionsOf(comparison)).toEqual([{ planId: 1, revisionNo: 2 }])
  })

  it('展示文案不出现套保率、现货敞口、预计利润', () => {
    const texts = [
      remainingLabel(progress()), completionLabel(progress({ completionRate: null, verificationStatus: 'UNVERIFIED' })),
      ...Object.values(RECEIPT_COMPLETENESS_LABELS), confirmFailureText('VERSION_CONFLICT', '', { reason: 'SOLD_UNVERIFIED' }),
    ]
    for (const text of texts) for (const term of FORBIDDEN_PLANNING_TERMS) expect(text).not.toContain(term)
  })
})
