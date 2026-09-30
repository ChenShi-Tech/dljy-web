// 「调整与复盘账单」步骤定义的结构守卫（ChenShi-Tech/dljy#3407）。
import { afterEach, describe, expect, it } from 'vitest'
import { resetGuideBridge, useGuideState } from '../bridge'
import { STATE } from './anchors'
import { adjustReviewGuide } from './adjustReview'

describe('调整与复盘账单步骤定义', () => {
  const steps = adjustReviewGuide.steps
  const indexOf = (id: string) => steps.findIndex((step) => step.id === id)

  it('对话框/抽屉内的步骤都声明 resumeTo，且指回更早的页面级步骤', () => {
    const overlaySteps = steps.filter((step) => step.within === 'dialog' || step.within === 'drawer')
    expect(overlaySteps.length).toBeGreaterThan(0)
    for (const step of overlaySteps) {
      expect(step.resumeTo, `步骤 ${step.id} 缺少 resumeTo`).toBeTruthy()
      const back = indexOf(step.resumeTo!)
      expect(back, `步骤 ${step.id} 的 resumeTo=${step.resumeTo} 不存在`).toBeGreaterThanOrEqual(0)
      expect(back, `步骤 ${step.id} 的 resumeTo 必须在它之前`).toBeLessThan(indexOf(step.id))
      const target = steps[back]
      expect(target.within === 'dialog' || target.within === 'drawer', `步骤 ${step.id} 的 resumeTo 不能也在对话框/抽屉里`).toBe(false)
    }
  })

  it('步骤 id 不重复', () => {
    const ids = steps.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('「登记后不关闭」与状态迁移类步骤以信号为完成判定之一', () => {
    const byId = (id: string) => steps.find((step) => step.id === id)!
    for (const id of ['1-3', '1-4', '2-2', '3-2', '4-2', '5-2', '7-2']) {
      const advance = byId(id).advance
      const hasSignal = advance.kind === 'signal' || (advance.kind === 'any' && advance.of.some((sub) => sub.kind === 'signal'))
      expect(hasSignal, `${id} 应以 signal 为完成判定之一`).toBe(true)
    }
  })

  it('讲解型步骤用手动推进', () => {
    for (const id of ['1-5', '3-3', '4-3', '5-3', '6-1', '7-3']) {
      expect(steps.find((step) => step.id === id)?.advance.kind, id).toBe('manual')
    }
  })
})

describe('章 1：合同调整', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => adjustReviewGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-10010120', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('登记要素：来源/编号/原因/方向/单段一次齐备（方向必须是增向）', () => {
    const base = { sourceNamespace: 'TEST-GUIDE', externalAdjustmentNo: 'X', reason: 'r', direction: 'OBLIGATION_INCREASE', segments: [{ deliveryMonth: '2026-11', quantity: '100' }] }
    expect(doneOf('1-2', { ...base, direction: '' })).toBe(false)
    expect(doneOf('1-2', { ...base, segments: [{ deliveryMonth: '', quantity: '100' }] })).toBe(false)
    expect(doneOf('1-2', { ...base, reason: '' })).toBe(false)
    expect(doneOf('1-2', base)).toBe(true)
  })

  it('「帮我填」走增向示例（避免可调余额上限 422），段落对齐目标月', () => {
    const assist = byId('1-2').assist
    if (assist?.kind !== 'fill') throw new Error('1-2 应是 fill 兜底')
    const values = assist.values(ctxWith({ executionMonths: ['2026-10', '2026-11', '2026-12'] }), {}) as { direction: string; segments: Array<{ deliveryMonth: string; quantity: string }>; file: File }
    expect(values.direction).toBe('OBLIGATION_INCREASE')
    expect(values.segments).toEqual([{ deliveryMonth: '2026-10', quantity: '100' }])
    expect(values.file).toBeInstanceOf(File)
    expect(values.file.name).toContain('调整生效依据')
  })
})

describe('章 2-3：账单与凭证', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => adjustReviewGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-10010120', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('账单要素：主体/来源/编号/期间/金额/至少一条分项', () => {
    const base = { subjectId: 1, sourceNamespace: 'TEST-GUIDE', externalBillNo: 'X', periodStartMonth: '2026-11', periodEndMonth: '2026-11', amount: '84000', lineItems: [{ deliveryMonth: '2026-11', quantity: '300', amount: '84000' }] }
    expect(doneOf('2-1', { ...base, subjectId: null })).toBe(false)
    expect(doneOf('2-1', { ...base, amount: '' })).toBe(false)
    expect(doneOf('2-1', { ...base, lineItems: [{ deliveryMonth: '', quantity: '', amount: '' }] })).toBe(false)
    expect(doneOf('2-1', base)).toBe(true)
  })

  it('凭证要素：编号/金额/日期齐备', () => {
    expect(doneOf('3-1', { voucherNo: '', amount: '100', receivedAt: '2026-12-01' })).toBe(false)
    expect(doneOf('3-1', { voucherNo: 'V1', amount: '', receivedAt: '2026-12-01' })).toBe(false)
    expect(doneOf('3-1', { voucherNo: 'V1', amount: '84000', receivedAt: '2026-12-01' })).toBe(true)
  })

  it('「帮我填」账单示例落在目标月、量价与确认合同一致', () => {
    useGuideState(STATE.bills, () => null)
    const assist = byId('2-1').assist
    if (assist?.kind !== 'fill') throw new Error('2-1 应是 fill 兜底')
    const values = assist.values(ctxWith({ executionMonths: ['2026-10', '2026-11', '2026-12'] }), {}) as { periodStartMonth: string; externalBillNo: string; lineItems: Array<{ deliveryMonth: string; amount: string }> }
    expect(values.periodStartMonth).toBe('2026-10')
    expect(values.externalBillNo).toContain('GUIDE-10010120')
    expect(values.lineItems[0].deliveryMonth).toBe('2026-10')
  })
})

describe('章 4-5：差异登记与关闭', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => adjustReviewGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-10010120', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('差异比对目标：主体/交割月/账单齐备', () => {
    expect(doneOf('4-1', { subjectId: null, deliveryMonth: '2026-11', billId: 3 })).toBe(false)
    expect(doneOf('4-1', { subjectId: 1, deliveryMonth: '', billId: 3 })).toBe(false)
    expect(doneOf('4-1', { subjectId: 1, deliveryMonth: '2026-11', billId: null })).toBe(false)
    expect(doneOf('4-1', { subjectId: 1, deliveryMonth: '2026-11', billId: 3 })).toBe(true)
  })

  it('处理说明：非空即推进（关闭的必填留痕）', () => {
    expect(doneOf('5-1', { resolutionNote: '' })).toBe(false)
    expect(doneOf('5-1', { resolutionNote: '已核对' })).toBe(true)
  })

  it('恢复：章 1 认已生效调整、章 5 只认已关闭（OPEN 不算）', () => {
    useGuideState(STATE.adjustments, () => ({ rows: [{ id: 5, status: 'EFFECTIVE', direction: 'OBLIGATION_INCREASE', externalAdjustmentNo: 'X' }] }))
    useGuideState(STATE.discrepancies, () => ({ discrepancies: [{ id: 9, status: 'OPEN' }] }))
    const ctx = ctxWith({ adjustmentId: 5, discrepancyId: 9 })
    expect(byId('1-0').recover?.(ctx)).toBe(true)
    expect(byId('5-0').recover?.(ctx)).toBe(false)
    useGuideState(STATE.discrepancies, () => ({ discrepancies: [{ id: 9, status: 'RESOLVED' }] }))
    expect(byId('5-0').recover?.(ctx)).toBe(true)
  })
})
