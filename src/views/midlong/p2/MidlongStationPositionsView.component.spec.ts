// 中长期售电场站维度持仓页的渲染不变量（dljy#2971，MP-05）。
// 守什么：主体合计 1000 拆成场站 400 + 500 + 未分配 100，页面不出现相加的 1900；内部经营分配视图有区别说明；
// 按合同总量分配、拆不到月份的电量单独列示；能力未开通时不取数。
// 坏掉的症状：把主体合计与场站份额相加；内部经营分配被当成正式交易分解展示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import type { StationPositionReport } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({ fetchCapabilities: vi.fn(), fetchStationPositions: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
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
  exportStationPositions: vi.fn(),
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

  it('能力未开通时不取数', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({}))
    const w = mount(MidlongStationPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchStationPositions).not.toHaveBeenCalled()
    expect(w.text()).toContain('场站分配尚未开通')
  })
})
