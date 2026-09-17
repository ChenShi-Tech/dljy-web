// 中长期售电场站维度持仓页的渲染不变量（dljy#2971，MP-05）。
// 守什么：主体合计 1000 拆成场站 400 + 500 + 未分配 100，页面不出现相加的 1900；内部经营分配视图有区别说明；
// 按合同总量分配、拆不到月份的电量单独列示；更正后沿用旧版本分配时有说明；能力未开通时不取数；切换公司后旧请求迟到不污染新公司。
// 坏掉的症状：把主体合计与场站份额相加；内部经营分配被当成正式交易分解展示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import type { StationPositionReport } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({
  fetchCapabilities: vi.fn(), fetchStationPositions: vi.fn(), exportStationPositions: vi.fn(), downloadCsv: vi.fn(), companyRef: null as null | { value: string },
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), downloadCsv: hoisted.downloadCsv }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchSubjects: vi.fn(async () => []),
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))
vi.mock('@/services/midlong/midlongP2Api', async (orig) => ({
  p2ModuleOn: (await orig<typeof import('@/services/midlong/midlongP2Api')>()).p2ModuleOn,
  fetchStationPositions: hoisted.fetchStationPositions,
  exportStationPositions: hoisted.exportStationPositions,
}))

import MidlongStationPositionsView from './MidlongStationPositionsView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' } }
const caps = (modules: Record<string, boolean> = { stationAllocations: true }): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, ...modules } as MidlongCapabilities['modules'],
  canWrite: false, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
})

function report(o: Partial<StationPositionReport> = {}): StationPositionReport {
  return {
    asOf: '2026-09-17T00:00:00.000Z', view: 'CURRENT', fromMonth: '2027-06', toMonth: '2027-07', allocationKind: 'FORMAL_TRADING', status: 'complete',
    regionId: 'yunnan', companyIds: ['comp-a'], generatedAt: '2026-09-17T00:00:00.000Z', filters: {},
    months: [
      { month: '2027-06', subjectTotalQuantity: '1000', stations: [{ stationId: 1, stationName: '测试风电场A', quantity: '400' }, { stationId: 2, stationName: '测试风电场B', quantity: '500' }],
        stationAllocatedQuantity: '900', unallocatedQuantity: '100', stationMonthUnknownQuantity: '0', incomplete: false, affectedContractIds: [] },
      { month: '2027-07', subjectTotalQuantity: '120', stations: [], stationAllocatedQuantity: '0', unallocatedQuantity: '20', stationMonthUnknownQuantity: '100', incomplete: false, affectedContractIds: [] },
    ],
    stations: [{ stationId: 1, stationName: '测试风电场A', quantity: '400' }, { stationId: 2, stationName: '测试风电场B', quantity: '500' }],
    totals: { subjectTotalQuantity: '1120', stationAllocatedQuantity: '900', unallocatedQuantity: '120', stationMonthUnknownQuantity: '100', unallocatedPoolQuantity: '0' },
    unallocatedPool: [], contributions: [], allocationSetsUsed: [], revisionsUsed: [], excluded: { note: '只采用正式交易分解' },
    ...o,
  }
}

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('中长期售电场站维度持仓', () => {
  it('主体合计 1000 = 场站 400 + 500 + 未分配 100，不出现相加的 1900；拆不到月份的电量单列', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchStationPositions.mockResolvedValue(report())
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('主体合计 1,000 = 场站份额 900 + 未分配 100')
    expect(text).toContain('主体合计 120 = 场站份额 0 + 未分配 20 + 月份未分到场站 100')
    expect(text).not.toContain('1,900')
    expect(text).not.toContain('2,020')
    expect(hoisted.fetchStationPositions.mock.calls[0][0]).toMatchObject({ allocationKind: 'FORMAL_TRADING' })
  })

  it('内部经营分配视图有区别说明，不当作正式交易分解', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchStationPositions.mockResolvedValue(report({ allocationKind: 'INTERNAL_OPERATING', excluded: { note: '按内部经营分配展示' } }))
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('当前为内部经营分配视图')
    expect(w.text()).toContain('不是正式交易分解')
  })

  it('更正后沿用旧版本分配：有说明，合同贡献标「沿用 v1」', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchStationPositions.mockResolvedValue(report({
      contributions: [{ month: '2027-06', contractId: 7, externalContractNo: 'TEST-7', contractName: '测试7', revisionNo: 2, stationId: 1, quantity: '400', derivation: 'ALLOCATION', allocationSetId: 5, allocationSetNo: 1, inheritedFromRevisionNo: 1 }],
      allocationSetsUsed: [{ contractId: 7, allocationSetId: 5, setNo: 1, inheritedFromRevisionNo: 1 }],
    }))
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('部分分配沿用更正前的版本')
    await w.findAll('.el-table__body').at(0)!.findAll('tr')[0].trigger('click')
    await nextTick()
    expect(w.text()).toContain('（分配集 #1 · 沿用 v1）')
  })

  it('切换公司：旧公司迟到的响应被丢弃，不显示在新公司下', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    let resolveOld: (v: StationPositionReport) => void = () => {}
    hoisted.fetchStationPositions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise(() => {}))
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    hoisted.companyRef!.value = 'comp-b'
    await nextTick()
    await flushPromises()
    expect(hoisted.fetchStationPositions).toHaveBeenCalledTimes(2)
    resolveOld(report())
    await flushPromises()
    expect(w.text()).not.toContain('测试风电场A')
    expect(w.text()).not.toContain('主体合计 1,000')
    hoisted.companyRef!.value = 'comp-a'
  })

  it('导出用页面当前结果的查询（含服务端采用的月份）：改了筛选但没点「查询」时，导出参数仍是上一次查询的', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchStationPositions.mockResolvedValue(report())
    hoisted.exportStationPositions.mockResolvedValue({ fileName: 'TEST.csv', contentType: 'text/csv', content: 'x', status: 'complete' })
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchStationPositions.mock.calls[0][0]).toEqual({ allocationKind: 'FORMAL_TRADING' })
    const filters = (w.vm as unknown as { filters: { monthRange: string[]; allocationKind: string; subjectId: string } }).filters
    filters.monthRange = ['2028-01', '2028-03']
    filters.allocationKind = 'INTERNAL_OPERATING'
    filters.subjectId = '99'
    await w.findAll('button').find((b) => b.text() === '导出')!.trigger('click')
    await flushPromises()
    expect(hoisted.exportStationPositions).toHaveBeenCalledTimes(1)
    expect(hoisted.exportStationPositions.mock.calls[0][0]).toEqual({ allocationKind: 'FORMAL_TRADING', fromMonth: '2027-06', toMonth: '2027-07' })
    expect(hoisted.downloadCsv).toHaveBeenCalledWith('TEST.csv', 'x')
  })

  it('能力未开通时不取数', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({}))
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchStationPositions).not.toHaveBeenCalled()
    expect(w.text()).toContain('场站分配尚未开通')
  })
})
