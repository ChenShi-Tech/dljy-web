// 「计划与交易执行」步骤定义的结构守卫（ChenShi-Tech/dljy#3406）。
// 守什么：对话框/抽屉步骤都声明 resumeTo 且指回更早的页面级步骤；「登记后不关闭」的对话框
// 以推进信号为完成判定；示例值/完成判定在边界输入上的行为（时间字段完整性、按交割月片段、
// 确认成交必须带文件等）。
import { afterEach, describe, expect, it } from 'vitest'
import { resetGuideBridge, useGuideState } from '../bridge'
import { STATE } from './anchors'
import { planExecutionGuide } from './planExecution'

describe('计划与交易执行步骤定义', () => {
  const steps = planExecutionGuide.steps
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

  it('讲解型步骤用手动推进（默认值本身就满足条件时不会被表单条件跳过）', () => {
    for (const id of ['2-4', '3-6', '4-0', '4-5', '5-7', '6-1']) {
      expect(planExecutionGuide.steps.find((step) => step.id === id)?.advance.kind, id).toBe('manual')
    }
  })

  it('「登记后不关闭」的对话框完成判定都挂了推进信号（不以弹窗关闭为准）', () => {
    const byId = (id: string) => planExecutionGuide.steps.find((step) => step.id === id)!
    for (const id of ['1-4', '2-3', '3-4', '4-4', '5-6']) {
      const advance = byId(id).advance
      const hasSignal = advance.kind === 'signal' || (advance.kind === 'any' && advance.of.some((sub) => sub.kind === 'signal'))
      expect(hasSignal, `${id} 应以 signal 为完成判定之一`).toBe(true)
    }
  })
})

describe('章 1：售电目标', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => planExecutionGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09302300', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('交割期认会话固定的目标月，且必须是合法月份键', () => {
    const artifacts = { executionMonths: ['2026-10', '2026-11', '2026-12'] }
    expect(doneOf('1-2', { periodType: 'MONTH', periodKey: '2026-11' }, artifacts)).toBe(false)
    expect(doneOf('1-2', { periodType: 'MONTH', periodKey: '2026-10' }, artifacts)).toBe(true)
    expect(doneOf('1-2', { periodType: 'MONTH', periodKey: '2026-13' }, artifacts)).toBe(false)
  })

  it('目标电量与依据、负责人一起推进', () => {
    expect(doneOf('1-3', { targetQuantity: '600', basisNote: '', ownerName: '' })).toBe(false)
    expect(doneOf('1-3', { targetQuantity: '600', basisNote: '示例', ownerName: '演示' })).toBe(true)
  })

  it('保存信号只认本导引目标月的计划', () => {
    const advance = byId('1-4').advance
    if (advance.kind !== 'signal') throw new Error('1-4 应是 signal 条件')
    const ctx = ctxWith({ executionMonths: ['2026-10', '2026-11', '2026-12'] })
    expect(advance.match?.({ periodKey: '2026-11' }, ctx)).toBe(false)
    expect(advance.match?.({ periodKey: '2026-10' }, ctx)).toBe(true)
  })
})

describe('章 2-4：公告 / 方案 / 提交', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => planExecutionGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09302300', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('申报截止必须是完整北京时间（只填日期不算完成）', () => {
    expect(doneOf('2-2', { declarationClosesAt: '2026-12-31' })).toBe(false)
    expect(doneOf('2-2', { declarationClosesAt: '2026-12-31 10:00' })).toBe(true)
    expect(doneOf('2-2', { declarationClosesAt: '' })).toBe(false)
  })

  it('交割片段三行逐月对齐会话月份、电量非空', () => {
    const artifacts = { executionMonths: ['2026-10', '2026-11', '2026-12'] }
    expect(doneOf('3-3', { segments: [{ deliveryMonth: '2026-10', quantity: '200' }] }, artifacts)).toBe(false)
    expect(doneOf('3-3', { segments: [{ deliveryMonth: '2026-10', quantity: '200' }, { deliveryMonth: '2026-11', quantity: '' }, { deliveryMonth: '2026-12', quantity: '200' }] }, artifacts)).toBe(false)
    expect(doneOf('3-3', { segments: ['2026-10', '2026-11', '2026-12'].map((m) => ({ deliveryMonth: m, quantity: '200' })) }, artifacts)).toBe(true)
  })

  it('外部提交时间完整 + 操作人非空才推进', () => {
    expect(doneOf('4-2', { submittedAt: '2026-09-30' })).toBe(false)
    expect(doneOf('4-2', { submittedAt: '2026-09-30 14:00' })).toBe(true)
    expect(doneOf('4-3', { submittedByName: '' })).toBe(false)
    expect(doneOf('4-3', { submittedByName: '演示' })).toBe(true)
  })

  it('提交信号只认本导引的方案', () => {
    const advance = byId('4-4').advance
    if (advance.kind !== 'signal') throw new Error('4-4 应是 signal 条件')
    const ctx = ctxWith({ proposalId: 7 })
    expect(advance.match?.({ proposalId: 8, submissionId: 1 }, ctx)).toBe(false)
    expect(advance.match?.({ proposalId: 7, submissionId: 1 }, ctx)).toBe(true)
  })

  it('「帮我填」的片段示例按会话月份生成三行', () => {
    useGuideState(STATE.plans, () => null)
    const assist = byId('3-3').assist
    if (assist?.kind !== 'fill') throw new Error('3-3 应是 fill 兜底')
    const values = assist.values(ctxWith({ executionMonths: ['2026-10', '2026-11', '2026-12'] }), {}) as { segments: Array<{ deliveryMonth: string; quantity: string }> }
    expect(values.segments.map((s) => s.deliveryMonth)).toEqual(['2026-10', '2026-11', '2026-12'])
    expect(values.segments.every((s) => s.quantity === '200')).toBe(true)
  })
})

describe('章 5：成交确认单', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => planExecutionGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09302300', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('主体、来源、编号一起推进（来源必须是练习命名空间由文案与示例值保证，判定只查非空）', () => {
    expect(doneOf('5-1', { subjectId: '', sourceNamespace: 'TEST-GUIDE', confirmationNo: 'X' })).toBe(false)
    expect(doneOf('5-1', { subjectId: '5', sourceNamespace: '', confirmationNo: 'X' })).toBe(false)
    expect(doneOf('5-1', { subjectId: '5', sourceNamespace: 'TEST-GUIDE', confirmationNo: 'GUIDE-09302300-C1' })).toBe(true)
  })

  it('确认成交状态：PRE_CLEARED 不算完成', () => {
    expect(doneOf('5-2', { resultStatus: 'PRE_CLEARED' })).toBe(false)
    expect(doneOf('5-2', { resultStatus: 'CLEARED' })).toBe(true)
  })

  it('交割段逐月对齐会话月份、电量大于 0', () => {
    const artifacts = { executionMonths: ['2026-10', '2026-11', '2026-12'] }
    expect(doneOf('5-3', { segments: [{ deliveryMonth: '2026-10', quantity: '200', price: '280' }, { deliveryMonth: '2026-11', quantity: '200', price: '280' }, { deliveryMonth: '2026-12', quantity: '0', price: '280' }] }, artifacts)).toBe(false)
    expect(doneOf('5-3', { segments: ['2026-10', '2026-11', '2026-12'].map((m) => ({ deliveryMonth: m, quantity: '200', price: '280' })) }, artifacts)).toBe(true)
  })

  it('确认成交必须有依据文件（帮我填生成教学示例文件）', () => {
    const assist = byId('5-4').assist
    if (assist?.kind !== 'fill') throw new Error('5-4 应是 fill 兜底')
    const values = assist.values(ctxWith({}), {}) as { file: File }
    expect(values.file).toBeInstanceOf(File)
    expect(doneOf('5-4', { hasFile: false })).toBe(false)
    expect(doneOf('5-4', { hasFile: true })).toBe(true)
  })

  it('恢复：练习公司已有公告/方案可执行/确认单即分别视为章 2/3/5 已完成', () => {
    useGuideState(STATE.execution, () => ({ windows: [{ id: 1, name: 'w' }], proposals: [{ id: 7, status: 'EXECUTABLE' }], confirmations: [{ id: 3, resultStatus: 'CLEARED' }] }))
    const ctx = ctxWith({ proposalId: 7 })
    expect(byId('2-0').recover?.(ctx)).toBe(true)
    expect(byId('3-5').recover?.(ctx)).toBe(true)
    expect(byId('5-0').recover?.(ctx)).toBe(true)
    // 章 4 认方案已提交/待结果，可执行不算完成。
    expect(byId('4-0').recover?.(ctx)).toBe(false)
  })
})
