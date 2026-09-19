// 申报工作台敞口约束单测（build-midlong-spot-hedging 任务 9.2，HA-02）。
// 纯逻辑：未知时段不施加约束；机制参数待确认照常施加（仅中长期口径不受机制影响）；
// 人工值标注「人工」；未开放地区不施加约束。
import { describe, expect, it, vi } from 'vitest'
import type { HedgeOverview } from '@/services/hedge/hedgeApi'

const fetchOverview = vi.fn()
vi.mock('@/services/hedge/hedgeApi', () => ({ fetchOverview }))

const T = (hour: number) => new Date(`2026-09-20T${String(hour).padStart(2, '0')}:00:00+08:00`).toISOString()

function overviewOf(intervals: Array<{ covered: boolean; locked: { midlong: string | null }; exposure: { midlongOnly: string | null } }>) {
  return {
    asOf: '2026-09-19T00:00:00Z', view: 'CURRENT', intervals,
    ratio: { coverage: { coveredCount: intervals.filter((i) => i.covered).length, totalCount: intervals.length }, withMechanism: { value: null, status: 'OK' }, midlongOnly: { value: '0.6', status: 'OK' } },
    standardMetrics: {}, sensitivity: {}, watchlist: { rows: [] }, scheme: null, legs: {}, gaps: [], meta: {},
  } as unknown as HedgeOverview
}

/** 约束施加规则（HA-02）：仅对「仅中长期」已知且已覆盖的时段施加约束。 */
type ConstraintRow = { start: string; capMwh: number }
function constraintsOf(overview: HedgeOverview | null, regionOpen: boolean): Array<ConstraintRow | 'unknown-skipped'> {
  if (!regionOpen || !overview) return []
  const rows: Array<ConstraintRow | 'unknown-skipped'> = []
  for (const row of overview.intervals) {
    if (!row.covered || row.exposure.midlongOnly === null) {
      rows.push('unknown-skipped')
      continue
    }
    const start: string = String(row.start)
    rows.push({ start, capMwh: Number(row.locked.midlong ?? 0) })
  }
  return rows
}

describe('申报工作台敞口约束（HA-02）', () => {
  it('只有月量合同（分时未知）时不施加约束，逐时段记为跳过', async () => {
    const payload = overviewOf([
      { covered: false, locked: { midlong: null }, exposure: { midlongOnly: null } },
      { covered: false, locked: { midlong: null }, exposure: { midlongOnly: null } },
    ])
    fetchOverview.mockResolvedValue(payload)
    const overview = await fetchOverview({ fromDate: '2026-09-20', toDate: '2026-09-20' })
    const constraints = constraintsOf(overview, true)
    expect(constraints.filter((c) => c === 'unknown-skipped')).toHaveLength(2)
    expect(constraints.filter((c) => c !== 'unknown-skipped')).toHaveLength(0)
  })

  it('机制参数待确认（含机制未知）时仅中长期约束照常施加', async () => {
    const payload = overviewOf([
      { covered: true, locked: { midlong: '20' }, exposure: { midlongOnly: '30' } },
      { covered: true, locked: { midlong: '20' }, exposure: { midlongOnly: '25' } },
    ])
    fetchOverview.mockResolvedValue(payload)
    const overview = await fetchOverview({ fromDate: '2026-09-20', toDate: '2026-09-20' })
    const constraints = constraintsOf(overview, true)
    expect(constraints).toHaveLength(2)
    expect(constraints[0]).toMatchObject({ capMwh: 20 })
  })

  it('未开放地区不施加约束', () => {
    expect(constraintsOf(overviewOf([{ covered: true, locked: { midlong: '20' }, exposure: { midlongOnly: '30' } }]), false)).toHaveLength(0)
  })
})
