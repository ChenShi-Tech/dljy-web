// 「分解与场站」步骤定义的结构守卫（ChenShi-Tech/dljy#3405）。
// 守什么：对话框内步骤都声明 resumeTo 且指回更早的页面级步骤；关键推进条件在边界输入上的
// 行为（手动讲解步不被自动跳过、覆盖月份认合同自己的交割月、非守恒草稿不推进、示例 CSV 守恒）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetGuideBridge, useGuideState } from '../bridge'
import { STATE } from './anchors'
import { allocationStationsGuide } from './allocationStations'

describe('分解与场站步骤定义', () => {
  const steps = allocationStationsGuide.steps
  const indexOf = (id: string) => steps.findIndex((step) => step.id === id)

  it('对话框内的步骤都声明 resumeTo，且指回更早的页面级步骤', () => {
    const dialogSteps = steps.filter((step) => step.within === 'dialog' || step.within === 'drawer')
    expect(dialogSteps.length).toBeGreaterThan(0)
    for (const step of dialogSteps) {
      expect(step.resumeTo, `步骤 ${step.id} 缺少 resumeTo`).toBeTruthy()
      const back = indexOf(step.resumeTo!)
      expect(back, `步骤 ${step.id} 的 resumeTo=${step.resumeTo} 不存在`).toBeGreaterThanOrEqual(0)
      expect(back, `步骤 ${step.id} 的 resumeTo 必须在它之前`).toBeLessThan(indexOf(step.id))
      const target = steps[back]
      expect(target.within === 'dialog' || target.within === 'drawer', `步骤 ${step.id} 的 resumeTo 不能也在对话框里`).toBe(false)
    }
  })

  it('步骤 id 不重复', () => {
    const ids = steps.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('第 1 章：曲线导入', () => {
  afterEach(() => {
    resetGuideBridge()
    vi.useRealTimers()
  })
  const byId = (id: string) => allocationStationsGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09301200', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('讲解型步骤用手动推进（默认值本身就满足条件，表单条件会在用户看到前跳过）', () => {
    for (const id of ['4-1', '4-4', '2-2', '3-1']) {
      expect(allocationStationsGuide.steps.find((step) => step.id === id)?.advance.kind, id).toBe('manual')
    }
  })

  it('文件、粒度、单位、时区、覆盖月份逐步推进（边界值不通过）', () => {
    const file = new File(['x'], 'a.csv', { type: 'text/plain' })
    expect(doneOf('1-2', { file: null })).toBe(false)
    expect(doneOf('1-2', { file })).toBe(true)
    expect(doneOf('1-3', { granularityMinutes: 15 })).toBe(false)
    expect(doneOf('1-3', { granularityMinutes: 60 })).toBe(true)
    expect(doneOf('1-4', { unit: 'MW' })).toBe(false)
    expect(doneOf('1-4', { unit: 'MWh' })).toBe(true)
    expect(doneOf('1-5', { sourceTimezone: 'UTC' })).toBe(false)
    expect(doneOf('1-5', { sourceTimezone: 'Asia/Shanghai' })).toBe(true)
  })

  it('覆盖月份认会话记录的合同交割月，不按日历现算', () => {
    useGuideState(STATE.curves, () => null)
    const artifacts = { coverageMonths: ['2026-10', '2026-11', '2026-12'] }
    expect(doneOf('1-6', { coverage: ['2026-11', '2027-01'] }, artifacts)).toBe(false)
    expect(doneOf('1-6', { coverage: ['2026-10', '2026-12'] }, artifacts)).toBe(true)
  })

  it('「帮我填」的示例文件逐月守恒（用注入的正式月度分解）', async () => {
    useGuideState(STATE.curves, () => ({
      contractId: 1,
      months: [
        { month: '2026-11', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '400', formalCurveSetId: null },
        { month: '2026-12', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
        { month: '2027-01', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
      ],
      sets: [],
    }))
    const assist = byId('1-2').assist
    if (assist?.kind !== 'fill') throw new Error('1-2 应是 fill 兜底')
    const values = assist.values(ctxWith({}), { format: 'xlsx' })
    expect(values.format).toBe('csv')
    const file = values.file as File
    expect(file).toBeInstanceOf(File)
    const lines = (await file.text()).replace(/^\u{FEFF}/u, '').trim().split('\n')
    const totals = new Map<string, number>()
    for (const line of lines.slice(1)) {
      const [date, , value] = line.split(',')
      const micro = Number(value.replace('.', '').padEnd(7, '0'))
      totals.set(date.slice(0, 7), (totals.get(date.slice(0, 7)) ?? 0) + micro)
    }
    expect(totals.get('2026-11')).toBe(400_000000)
    expect(totals.get('2026-12')).toBe(300_000000)
    expect(totals.get('2027-01')).toBe(300_000000)
  })

  it('保存草稿一步不认阻断草稿（信号 match 拦下 blocking=true）', () => {
    const advance = byId('1-8').advance
    if (advance.kind !== 'any') throw new Error('1-8 应是 any 条件')
    const signal = advance.of.find((sub) => sub.kind === 'signal')
    if (!signal || signal.kind !== 'signal') throw new Error('1-8 应含信号条件')
    expect(signal.match?.({ blocking: true }, ctxWith({}))).toBe(false)
    expect(signal.match?.({ blocking: false }, ctxWith({}))).toBe(true)
  })
})

describe('第 4 章：场站分配', () => {
  const byId = (id: string) => allocationStationsGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09301200', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })
  const doneOf = (id: string, values: Record<string, unknown>, artifacts: Record<string, unknown> = {}) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    return advance.done(values, ctxWith(artifacts))
  }

  it('分配行：两条齐全、月份/电量非零、无超额才推进', () => {
    const rows = [
      { stationId: 11, segmentMonth: '2026-10', quantity: '500' },
      { stationId: 12, segmentMonth: '2026-10', quantity: '500' },
    ]
    expect(doneOf('4-2', { rows: rows.slice(0, 1), blocking: false })).toBe(false)
    expect(doneOf('4-2', { rows, blocking: true })).toBe(false)
    expect(doneOf('4-2', { rows: [...rows, { stationId: null, segmentMonth: '', quantity: '' }], blocking: false })).toBe(false)
    expect(doneOf('4-2', { rows: [{ ...rows[0], segmentMonth: '' }, rows[1]], blocking: false })).toBe(false)
    expect(doneOf('4-2', { rows, blocking: false })).toBe(true)
  })

  it('依据资料：至少选一份', () => {
    expect(doneOf('4-3', { evidenceIds: [] })).toBe(false)
    expect(doneOf('4-3', { evidenceIds: [7] })).toBe(true)
  })

  it('「帮我填」按每个月的正式月度电量对半分（合同月分解不均等时也不能超额）', () => {
    useGuideState(STATE.contractStations, () => ({ contractId: 1, totalQuantity: '999.99' }))
    useGuideState(STATE.curves, () => ({
      contractId: 1,
      months: [
        { month: '2026-10', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '400', formalCurveSetId: null },
        { month: '2026-11', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
        { month: '2026-12', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
      ],
      sets: [],
    }))
    const assist = byId('4-2').assist
    if (assist?.kind !== 'fill') throw new Error('4-2 应是 fill 兜底')
    const values = assist.values(ctxWith({ practiceStationIds: [11, 12] }), {}) as { segmentMode: string; rows: Array<{ stationId: number | null; segmentMonth: string; quantity: string }> }
    expect(values.segmentMode).toBe('MONTHLY')
    expect(values.rows).toHaveLength(6)
    const sum = values.rows.reduce((total, row) => total + Number(row.quantity), 0)
    expect(Math.abs(sum - 1000)).toBeLessThan(1e-9)
    // 每月的分配合计不得超过该月正式月度分解。
    for (const [month, formal] of [['2026-10', 400], ['2026-11', 300], ['2026-12', 300]] as const) {
      const monthRows = values.rows.filter((row) => row.segmentMonth === month)
      expect(monthRows).toHaveLength(2)
      expect(monthRows.map((row) => row.stationId)).toEqual([11, 12])
      const monthSum = monthRows.reduce((total, row) => total + Number(row.quantity), 0)
      expect(monthSum).toBeLessThanOrEqual(formal)
    }
    expect(values.rows[0].quantity).toBe('200')
    expect(values.rows[1].quantity).toBe('200')
    expect(values.rows[2].quantity).toBe('150')
  })
})

describe('刷新恢复（recover 按服务端真实状态找回）', () => {
  afterEach(() => resetGuideBridge())
  const byId = (id: string) => allocationStationsGuide.steps.find((step) => step.id === id)!
  const ctxWith = (artifacts: Record<string, unknown>) => ({ runTag: 'GUIDE-09301200', regionId: 'yunnan', practiceCompanyId: 'p', artifacts, go: () => {} })

  it('第 1 章认「已确认覆盖全部月份」或「可通过校验的草稿」，不重复建数据', () => {
    useGuideState(STATE.curves, () => ({
      contractId: 1,
      months: [
        { month: '2026-11', timeStatus: 'CURVE', monthlyFormalQuantity: '400', formalCurveSetId: 51 },
        { month: '2026-12', timeStatus: 'CURVE', monthlyFormalQuantity: '300', formalCurveSetId: 51 },
        { month: '2027-01', timeStatus: 'CURVE', monthlyFormalQuantity: '300', formalCurveSetId: 51 },
      ],
      sets: [{ id: 51, setNo: 1, status: 'CONFIRMED', isCurrentRevision: true, blockingIssueCount: 0 }],
    }))
    const ctx = ctxWith({ guideObligationId: 1 })
    expect(byId('1-1').recover?.(ctx)).toBe(true)
    expect(byId('1-8').recover?.(ctx)).toBe(true)
    // 只确认了一个月不算完成。
    useGuideState(STATE.curves, () => ({
      contractId: 1,
      months: [
        { month: '2026-11', timeStatus: 'CURVE', monthlyFormalQuantity: '400', formalCurveSetId: 51 },
        { month: '2026-12', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
        { month: '2027-01', timeStatus: 'MONTH_UNKNOWN', monthlyFormalQuantity: '300', formalCurveSetId: null },
      ],
      sets: [{ id: 51, setNo: 1, status: 'CONFIRMED', isCurrentRevision: true, blockingIssueCount: 0 }],
    }))
    expect(byId('1-1').recover?.(ctxWith({ guideObligationId: 1 }))).toBe(false)
  })

  it('KeepAlive 残留另一份合同的快照时不认（只认起点合同）', () => {
    useGuideState(STATE.curves, () => ({
      contractId: 99,
      months: [{ month: '2026-11', timeStatus: 'CURVE', monthlyFormalQuantity: '400', formalCurveSetId: 51 }],
      sets: [{ id: 51, setNo: 1, status: 'CONFIRMED', isCurrentRevision: true, blockingIssueCount: 0 }],
    }))
    expect(byId('1-1').recover?.(ctxWith({ guideObligationId: 1 }))).toBe(false)
  })

  it('第 4 章认「正式交易分配已确认或草稿可通过」', () => {
    useGuideState(STATE.contractStations, () => ({ contractId: 1, effectiveSetNos: { FORMAL_TRADING: 9, INTERNAL_OPERATING: null }, drafts: [] }))
    expect(byId('4-0').recover?.(ctxWith({ guideObligationId: 1 }))).toBe(true)
    useGuideState(STATE.contractStations, () => ({ contractId: 1, effectiveSetNos: { FORMAL_TRADING: null, INTERNAL_OPERATING: null }, drafts: [{ id: 3, allocationKind: 'FORMAL_TRADING', blocking: false }] }))
    expect(byId('4-0').recover?.(ctxWith({ guideObligationId: 1 }))).toBe(true)
    useGuideState(STATE.contractStations, () => ({ contractId: 1, effectiveSetNos: { FORMAL_TRADING: null, INTERNAL_OPERATING: null }, drafts: [{ id: 3, allocationKind: 'INTERNAL_OPERATING', blocking: false }] }))
    expect(byId('4-0').recover?.(ctxWith({ guideObligationId: 1 }))).toBe(false)
  })

  it('起点合同：已确认、场站未分配的电量合同才算（场站已绑定的不算）', () => {
    useGuideState(STATE.contracts, () => ({
      contracts: [
        { id: 1, documentKind: 'OBLIGATION', externalContractNo: 'A', confirmationStatus: 'CONFIRMED', stationId: null },
        { id: 2, documentKind: 'OBLIGATION', externalContractNo: 'B', confirmationStatus: 'CONFIRMED', stationId: 5 },
        { id: 3, documentKind: 'OBLIGATION', externalContractNo: 'C', confirmationStatus: 'DRAFT', stationId: null },
      ],
    }))
    const ctx = ctxWith({})
    const step = byId('1-0')
    expect(step.recover?.(ctx)).toBe(true)
    expect(ctx.artifacts.guideObligationId).toBe(1)
  })
})
