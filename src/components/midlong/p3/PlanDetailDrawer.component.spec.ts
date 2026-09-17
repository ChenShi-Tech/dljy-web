// 售电目标详情的可追溯性（dljy#2973，MS-01/MS-04）。
// 守什么：版本历史保留旧目标、更改原因与确认人；被取代的版本可以按其最后有效时刻查看当时完成情况；
//        占用记录列出未释放与已释放（原因、时间），不因释放而消失。
// 坏掉的症状：改目标后旧目标与原因不可见；已撤销方案的占用从记录里消失，说不清余额为何变化。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import { PLANNING_NOTICES, type SalesPlanDetail, type SalesPlanRevision } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ fetchPlan: vi.fn() }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ fetchPlan: hoisted.fetchPlan }))

import PlanDetailDrawer from './PlanDetailDrawer.vue'

const revision = (o: Partial<SalesPlanRevision>): SalesPlanRevision => ({
  id: 1, planId: 9, revisionNo: 1, status: 'CONFIRMED', supersedesRevisionNo: null, targetQuantity: '1000', targetPriceLow: null, targetPriceHigh: null, priceTaxBasis: 'TAX_INCLUDED',
  basisNote: '【测试数据】经营会', ownerName: '测试负责人', changeReason: null, recordedAt: '2031-01-01T00:00:00.000Z', recordedBy: 'cgn-admin', updatedAt: '',
  confirmedAt: '2031-01-02T00:00:00.000Z', confirmedBy: 'cgn-admin', supersededAt: null, historyAsOf: null, ...o,
})

const plan: SalesPlanDetail = {
  id: 9, companyId: 'comp-a', regionId: 'yunnan', subjectId: 1, subjectName: '测试交易单元', subjectKey: 'TEST-1', periodType: 'MONTH', periodKey: '2031-05', currentRevisionNo: 2,
  confirmedRevisionNo: 2, rowVersion: 5, createdAt: '', createdBy: null, updatedAt: '', targetNature: 'BUSINESS_ARRANGEMENT', targetNatureNotice: PLANNING_NOTICES.targetNature,
  revisions: [
    revision({ supersededAt: '2031-02-01T00:00:00.000Z', historyAsOf: '2031-01-31T23:59:59.999Z' }),
    revision({ id: 2, revisionNo: 2, targetQuantity: '1200', changeReason: '【测试数据】新增售电任务', confirmedBy: 'boss-user', confirmedAt: '2031-02-01T00:00:00.000Z' }),
  ],
  events: [],
  occupations: [
    { id: 1, proposalId: 30, subjectId: 1, deliveryMonth: '2031-05', quantity: '600', open: true, occupiedAt: '2031-01-10T00:00:00.000Z', occupiedBy: 'cgn-admin', releasedAt: null, releasedBy: null, releaseReason: null, balanceSnapshot: {}, proposalStatus: 'EXECUTABLE' },
    { id: 2, proposalId: 31, subjectId: 1, deliveryMonth: '2031-05', quantity: '80', open: false, occupiedAt: '2031-01-11T00:00:00.000Z', occupiedBy: 'cgn-admin', releasedAt: '2031-01-12T02:00:00.000Z', releasedBy: 'cgn-admin', releaseReason: 'CANCELLED', balanceSnapshot: {}, proposalStatus: 'CANCELLED' },
  ],
}

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

describe('售电目标详情', () => {
  it('版本历史保留旧目标、更改原因与确认人；被取代版本可查看当时完成情况', async () => {
    hoisted.fetchPlan.mockResolvedValue(plan)
    const w = mount(PlanDetailDrawer, { props: { modelValue: true, planId: 9 } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('1,000')
    expect(text).toContain('1,200')
    expect(text).toContain('【测试数据】新增售电任务')
    expect(text).toContain('boss-user')
    expect(text).toContain(PLANNING_NOTICES.targetNature)
    const historyButtons = w.findAll('button').filter((b) => b.text() === '查看当时完成情况')
    expect(historyButtons).toHaveLength(1)
    await historyButtons[0].trigger('click')
    expect(w.emitted('history')?.[0]).toEqual([{ planId: 9, asOf: '2031-01-31T23:59:59.999Z', revisionNo: 1 }])
  })

  it('占用记录：未释放与已释放都保留，已释放显示原因与时间', async () => {
    hoisted.fetchPlan.mockResolvedValue(plan)
    const w = mount(PlanDetailDrawer, { props: { modelValue: true, planId: 9 } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('未释放（未完成占用）')
    expect(text).toContain('方案撤销 · 2031-01-12 10:00')
    expect(text).toContain('#31')
  })
})
