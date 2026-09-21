// 合同详情场站分配区的渲染不变量（dljy#2971，MP-05/MA-05）。
// 守什么：有生效分配集时只显示生效集，不同时出现「当前版本尚无已确认」的兜底提示；没有时才显示兜底提示；
// 沿用更正前版本的分配标「沿用 vN」；更正影响只列失效片段的核对结果。
// 坏掉的症状：同一类分配既显示「生效分配集 #1」又显示「尚无已确认…全部电量为未分配」，用户无法判断是否已分配。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { ContractStationAllocationsOverview, StationAllocationSet, StationSegment } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({ fetchContractStationAllocations: vi.fn(), confirmStationAllocationSet: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }) }))
vi.mock('@/services/midlong/midlongP2Api', () => ({
  fetchContractStationAllocations: hoisted.fetchContractStationAllocations, confirmStationAllocationSet: hoisted.confirmStationAllocationSet, discardStationAllocationSet: vi.fn(),
}))

import MidlongContractStationsPanel from './MidlongContractStationsPanel.vue'

const STUBS = { MidlongStationAllocationDialog: { props: ['overview'], template: '<div class="stub-dialog" :data-revision="overview.currentRevisionNo" />' } }
const segment = (month: string, o: Partial<StationSegment> = {}): StationSegment => ({
  segment: month, segmentQuantity: '700', allocatedQuantity: '700', unallocatedQuantity: '0', excessQuantity: '0', stationCount: 1, status: 'WITHIN', ...o,
})

function overview(o: Partial<ContractStationAllocationsOverview> = {}): ContractStationAllocationsOverview {
  return {
    contractId: 7, companyId: 'comp-a', regionId: 'yunnan', externalContractNo: 'TEST-7', contractName: '【测试数据】', confirmationStatus: 'CONFIRMED', currentRevisionNo: 1,
    deliveryStart: '2027-06-01', deliveryEnd: '2027-07-31', totalQuantity: '1500', monthlyFormal: { '2027-06': '700', '2027-07': '800' }, subjectId: 1, contractStation: null,
    subjectStations: [{ stationId: 1, stationName: '测试风电场A' }], canCreate: true, sets: [], impact: [],
    effective: {
      FORMAL_TRADING: {
        allocationSetId: 9, setNo: 1, segmentMode: 'MONTHLY', inheritedFromRevisionNo: null,
        segments: [segment('2027-06'), segment('2027-07', { segmentQuantity: '800', allocatedQuantity: '0', unallocatedQuantity: '800', stationCount: 0 })],
        rows: [{ id: 1, stationId: 1, stationName: '测试风电场A', segmentMonth: '2027-06', quantity: '700' }],
      },
      INTERNAL_OPERATING: null,
    },
    ...o,
  }
}

const draftSet = (id: number, o: Partial<StationAllocationSet> = {}) => ({
  id, contractId: 7, revisionId: 1, revisionNo: 1, setNo: id, basedOnSetNo: 1, status: 'DRAFT' as const, allocationKind: 'FORMAL_TRADING' as const, segmentMode: 'MONTHLY' as const,
  basisNote: null, evidenceIds: [5], blockingIssueCount: 0, recordedAt: '', recordedBy: null, confirmedAt: null, confirmedBy: null, discardedAt: null, discardedBy: null, discardReason: null,
  rows: [], isCurrentRevision: true, validation: { blocking: false, blockingCount: 0, warningCount: 0, summary: [], issues: [], truncated: false, segments: [] },
  ...o,
})

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('合同场站分配区', () => {
  it('当前版本有生效分配集时不出现「尚无已确认」；没有生效集的类型才显示兜底提示；没有分配行的月份整月显示为未分配', async () => {
    hoisted.fetchContractStationAllocations.mockResolvedValue(overview())
    const w = mount(MidlongContractStationsPanel, { props: { contractId: 7, rowVersion: 3, canWrite: true, evidence: [], stations: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const [formal, internal] = w.findAll('.ml-kind')
    expect(formal.text()).toContain('生效分配集 #1')
    expect(formal.text()).not.toContain('尚无已确认')
    expect(formal.text()).not.toContain('沿用')
    expect(formal.findAll('.el-table__body').at(0)!.findAll('tr')[1].findAll('td').map((td) => td.text())).toEqual(['2027-07 月', '800', '0', '800'])
    expect(internal.text()).toContain('当前版本尚无已确认的内部经营分配')
    expect(internal.text()).not.toContain('生效分配集')
  })

  it('合同核验、更正或作废后（rowVersion 前进）重新取场站分配概览，分配对话框改用新的版本号', async () => {
    hoisted.fetchContractStationAllocations.mockResolvedValue(overview({ currentRevisionNo: 1 }))
    const w = mount(MidlongContractStationsPanel, { props: { contractId: 7, rowVersion: 3, canWrite: true, evidence: [], stations: [] }, global: { stubs: STUBS } })
    await flushPromises()
    expect(w.find('.stub-dialog').attributes('data-revision')).toBe('1')
    hoisted.fetchContractStationAllocations.mockResolvedValue(overview({ currentRevisionNo: 2 }))
    await w.setProps({ rowVersion: 4 })
    await flushPromises()
    expect(hoisted.fetchContractStationAllocations).toHaveBeenCalledTimes(2)
    expect(w.find('.stub-dialog').attributes('data-revision')).toBe('2')
  })

  it('确认返回前关闭并对另一份草稿打开确认：旧确认不关闭新对话框、不把忙碌或报错带到新会话', async () => {
    hoisted.fetchContractStationAllocations.mockResolvedValue(overview({
      sets: [draftSet(2), draftSet(3, { allocationKind: 'INTERNAL_OPERATING', basisNote: '【测试】内部口径', evidenceIds: [] })] as ContractStationAllocationsOverview['sets'],
    }))
    const w = mount(MidlongContractStationsPanel, { props: { contractId: 7, rowVersion: 3, canWrite: true, evidence: [], stations: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const confirming = () => (w.vm as unknown as { confirming: { open: boolean; busy: boolean; set: { id: number } | null; error: unknown } }).confirming
    const draftConfirmButtons = () => w.findAll('.ml-draft button').filter((b) => b.text() === '确认')
    let rejectFirst: (e: unknown) => void = () => {}
    hoisted.confirmStationAllocationSet.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject }))
    await draftConfirmButtons()[0].trigger('click')
    await flushPromises()
    await w.findAll('.el-dialog__footer button').find((b) => b.text() === '确认')!.trigger('click')
    expect(confirming().busy).toBe(true)
    confirming().open = false
    await flushPromises()
    await draftConfirmButtons()[1].trigger('click')
    await flushPromises()
    rejectFirst(new Error('草稿创建后已有他人确认'))
    await flushPromises()
    expect([confirming().open, confirming().set?.id, confirming().busy, confirming().error]).toEqual([true, 3, false, null])
  })

  it('沿用更正前版本的分配标「沿用 v1」且不出现兜底提示；更正影响只列失效片段', async () => {
    const base = overview()
    hoisted.fetchContractStationAllocations.mockResolvedValue(overview({
      currentRevisionNo: 2,
      effective: { FORMAL_TRADING: { ...base.effective.FORMAL_TRADING!, inheritedFromRevisionNo: 1 }, INTERNAL_OPERATING: null },
      impact: [{
        allocationKind: 'FORMAL_TRADING', status: 'RECONFIRM_REQUIRED', previousRevisionNo: 1, previousAllocationSetId: 9, previousSetNo: 1, invalidSegments: ['2027-07'], canReuse: true,
        segmentsAgainstCurrent: [segment('2027-06'), segment('2027-07', { segmentQuantity: '900', allocatedQuantity: '600', unallocatedQuantity: '300' })],
      }],
    }))
    const w = mount(MidlongContractStationsPanel, { props: { contractId: 7, rowVersion: 3, canWrite: true, evidence: [], stations: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const formal = w.findAll('.ml-kind')[0]
    expect(formal.text()).toContain('沿用 v1（只含未受更正影响的片段）')
    expect(formal.text()).not.toContain('尚无已确认')
    const text = w.text()
    expect(text).toContain('失效片段：2027-07 月')
    expect(text).toContain('按当前版本核对： 2027-07 月 余额 300 MWh')
    expect(text).not.toContain('2027-06 月 余额')
  })
})
