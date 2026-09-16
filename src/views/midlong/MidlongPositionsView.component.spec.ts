// 中长期售电月度持仓页的渲染不变量（dljy#2939，MP-01/02/03/06）。
// 守什么：缺月度分解的月份不显示成 0 持仓、未分解电量在未分解池只列一次；价格口径不可比时不给统一均价；
// 名义金额不完整时明示；历史认知时点视图有说明；服务失败显示错误而不是示意数值。
// 坏掉的症状：全年 12000 MWh 无分解的合同被画成每月 0 或每月 1000；含税与未核对绿电价被揉成一个均价。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongPositionReport, MidlongPriceSummary } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchPositions: vi.fn(), fetchCapabilities: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/composables/useTheme', () => ({ cssVar: () => '' }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchPositions: hoisted.fetchPositions,
  fetchSubjects: vi.fn(async () => []),
  exportPositions: vi.fn(),
  midlongFailureOf: (e: unknown) => ({ status: (e as { status?: number }).status ?? 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))

import MidlongPositionsView from './MidlongPositionsView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, ChartCard: { template: '<div class="stub-chart" />' }, 'router-link': { template: '<a><slot /></a>' } }
const caps: MidlongCapabilities = {
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false },
  canWrite: false, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
}
const price = (o: Partial<MidlongPriceSummary> = {}): MidlongPriceSummary => ({
  groups: [], comparable: true, averagePrice: null, knownPriceQuantity: '0', unknownPriceQuantity: '0', coverageRatio: null,
  knownNotionalAmount: null, notionalAmountComplete: false, environmentValue: null, ...o,
})

function report(o: Partial<MidlongPositionReport> = {}): MidlongPositionReport {
  return {
    asOf: '2026-09-16T00:00:00.000Z', fromMonth: '2027-01', toMonth: '2027-02', view: 'CURRENT', status: 'partial', regionId: 'yunnan',
    companyIds: ['comp-a'], generatedAt: '2026-09-16T00:00:00.000Z', filters: {},
    months: [
      { month: '2027-01', formalQuantity: '800', contractCount: 1, incomplete: true, affectedContractIds: [1], price: price() },
      { month: '2027-02', formalQuantity: '0', contractCount: 1, incomplete: true, affectedContractIds: [1], price: price() },
    ],
    totals: { contractCount: 1, contractTotalQuantity: '12000', formalQuantityInRange: '800', unallocatedPoolQuantity: '11200', unallocatedContractCount: 1, price: price() },
    unallocatedPool: [{ contractId: 1, externalContractNo: 'Y-1', contractName: '年度合同', revisionNo: 1, deliveryStart: '2027-01-01', deliveryEnd: '2027-12-31', totalQuantity: '12000', formalAllocatedQuantity: '800', unallocatedQuantity: '11200', reason: 'MONTHLY_ALLOCATION_INCOMPLETE', overlappingMonths: ['2027-01', '2027-02'] }],
    contributions: [{ month: '2027-01', contractId: 1, externalContractNo: 'Y-1', contractName: '年度合同', subjectId: 1, stationId: null, revisionNo: 1, allocationId: 9, quantity: '800', price: null, priceSource: null, derivation: 'SOURCE_ROW' }],
    revisionsUsed: [{ contractId: 1, revisionNo: 1, confirmedAt: '2026-09-01T00:00:00.000Z' }],
    excluded: { draftCount: 2, pendingVerificationCount: 3, frameworkCount: 1, voidedCount: 0, estimatedQuantity: '0', note: '' },
    ...o,
  }
}

afterEach(() => vi.clearAllMocks())

describe('中长期售电月度持仓', () => {
  it('缺分解月份不显示成 0 持仓；未分解池只列一次合同', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report())
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('未分解（非零持仓）')
    expect(text).toContain('800（另有未分解）')
    expect(text).not.toContain('1,000')
    expect(text).toContain('持仓与金额不完整')
    const poolRows = w.findAll('.el-table__body').at(-1)!.findAll('tr')
    expect(poolRows).toHaveLength(1)
    expect(text).toContain('草稿 2 · 待核对 3 · 框架协议 1')
  })

  it('价格口径不可比时分组展示、不给统一均价', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    const groups = [
      { currency: 'CNY' as const, taxBasis: 'TAX_INCLUDED' as const, priceComponent: 'ENERGY_ONLY' as const, knownQuantity: '100', notionalAmount: '30000', averagePrice: '300' },
      { currency: 'CNY' as const, taxBasis: 'UNKNOWN' as const, priceComponent: 'UNVERIFIED' as const, knownQuantity: '100', notionalAmount: '33000', averagePrice: '330' },
    ]
    const p = price({ comparable: false, groups, knownPriceQuantity: '200', coverageRatio: '1' })
    hoisted.fetchPositions.mockResolvedValue(report({ totals: { ...report().totals, price: p } }))
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('价格口径不可合并')
    expect(w.text()).toContain('口径不可比（见分组）')
    expect(w.text()).not.toContain('315')
  })

  it('历史认知时点视图给出说明', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report({ view: 'AS_OF' }))
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('历史认知时点视图')
  })

  it('服务失败显示错误，不渲染任何持仓数值', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockRejectedValue(Object.assign(new Error('合同存储暂不可用'), { status: 503 }))
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('持仓加载失败')
    expect(w.find('.stub-chart').exists()).toBe(false)
    expect(w.text()).not.toContain('区间正式分解电量')
  })
})
