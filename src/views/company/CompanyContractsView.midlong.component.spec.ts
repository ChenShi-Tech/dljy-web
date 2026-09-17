// 旧「公司管理 › 合同管理」对已纳管中长期合同的分流（dljy#2939，MW-02/MW-05）。
// 守什么：旧深链 ?contractId= 指向已纳管合同时跳到新页面的同一合同并带上年份筛选；未纳管合同仍在本页打开；
// 已纳管合同在旧列表不给编辑/删除；到期/逾期预警不再按日期给已纳管合同判逾期。
// 坏掉的症状：收藏的旧链接打开的是旧抽屉、还能在旧页改掉已确认合同；已结束的中长期合同在旧页被标「已逾期」。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({ replace: vi.fn(), query: {} as Record<string, string>, fetchContracts: vi.fn(), fetchContractDetails: vi.fn(async () => []), exportCsv: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.query }), useRouter: () => ({ replace: hoisted.replace, push: vi.fn() }) }))
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'BOSS', companyId: 'comp-cgn-yunnan' }) }))
vi.mock('@/services/governance', () => ({ hasCompanyAdmin: () => true }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-cgn-yunnan') }))
vi.mock('@/services/company/companyApi', async (orig) => ({
  ...(await orig<typeof import('@/services/company/companyApi')>()),
  fetchContracts: hoisted.fetchContracts,
  fetchStations: vi.fn(async () => []),
  fetchTrades: vi.fn(async () => []),
  fetchContractDetails: hoisted.fetchContractDetails,
}))

vi.mock('../../utils/exportCsv', () => ({ exportCsv: hoisted.exportCsv }))

import CompanyContractsView from './CompanyContractsView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, SparkBar: { template: '<span />' }, 'router-link': { props: ['to'], template: '<a :data-to="to"><slot /></a>' } }
const managed = { managed: true, confirmationStatus: 'CONFIRMED', currentRevisionNo: 2, rowVersion: 5, documentKind: 'OBLIGATION', regionId: 'yunnan', detailPath: '/zcqjy/contracts/7' }
const contract = (o: Record<string, unknown>) => ({
  id: 1, companyId: 'comp-cgn-yunnan', stationId: null, contractNo: 'L-1', contractName: '旧合同', marketType: 'annual_bilateral', tradeMode: 'bilateral',
  startDate: '2025-01-01', endDate: '2025-12-31', totalQuantity: 100, buyerName: '', sellerName: '', buyerPrice: null, sellerPrice: null, totalFee: null,
  status: 'active', remarks: '', source: 'MANUAL', ownerDomain: 'market-trading', executedVolume: 0, tradeCount: 0, ...o,
})

afterEach(() => { vi.clearAllMocks(); hoisted.query = {} })

// 每个用例结束卸载组件：否则遗留实例会响应后续用例的公司/地区切换继续取数，既拖慢全量运行，也可能让「最后一次请求」断言取到别的实例。
enableAutoUnmount(afterEach)

describe('旧合同管理页的中长期分流', () => {
  it('旧深链指向已纳管合同：跳到新详情页并把年份筛选换成交割期筛选', async () => {
    hoisted.query = { contractId: '7', year: '2027' }
    hoisted.fetchContracts.mockResolvedValue([contract({ id: 7, contractNo: 'M-7', midlong: managed })])
    mount(CompanyContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.replace).toHaveBeenCalledWith({ path: '/zcqjy/contracts/7', query: { deliveryFrom: '2027-01', deliveryTo: '2027-12' } })
  })

  it('旧深链指向未纳管合同：留在本页打开详情，不跳转', async () => {
    hoisted.query = { contractId: '1' }
    hoisted.fetchContracts.mockResolvedValue([contract({ id: 1 })])
    mount(CompanyContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.replace).not.toHaveBeenCalled()
    expect(hoisted.fetchContractDetails).toHaveBeenCalledWith(1)
  })

  it('已纳管合同在旧列表只读并指向新页，且不按日期判逾期', async () => {
    hoisted.fetchContracts.mockResolvedValue([contract({ id: 7, contractNo: 'M-7', endDate: '2025-01-31', midlong: managed }), contract({ id: 1, contractNo: 'L-1' })])
    const w = mount(CompanyContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('中长期售电合同已迁至「中长期交易 › 售电合同」')
    const rows = w.findAll('.el-table__body tr')
    const managedRow = rows.find((r) => r.text().includes('M-7'))!
    expect(managedRow.text()).toContain('前往中长期合同')
    expect(managedRow.text()).not.toContain('编辑')
    expect(managedRow.text()).not.toContain('删除')
    expect(managedRow.text()).not.toContain('已逾期')
    expect(managedRow.text()).toContain('中长期·已确认')
  })

  it('已纳管合同不计入旧口径「执行中」；导出状态与表格同口径（中长期确认状态）', async () => {
    hoisted.fetchContracts.mockResolvedValue([
      contract({ id: 7, contractNo: 'M-7', endDate: '2025-01-31', midlong: managed }),
      contract({ id: 8, contractNo: 'M-8', status: 'draft', midlong: { ...managed, confirmationStatus: 'PENDING_VERIFICATION', detailPath: '/zcqjy/contracts/8' } }),
      contract({ id: 1, contractNo: 'L-1', endDate: '2099-12-31' }),
    ])
    const w = mount(CompanyContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    const activeTile = w.findAll('.stat-card').find((c) => c.find('.stat-label').text() === '执行中')!
    expect(activeTile.find('.stat-value').text()).toBe('1')
    await w.findAll('button').find((b) => b.text() === '导出CSV')!.trigger('click')
    const body = hoisted.exportCsv.mock.calls[0][2] as string[][]
    const statusOf = (no: string) => body.find((r) => r[0] === no)!.at(-2)
    expect(statusOf('M-7')).toBe('中长期·已确认')
    expect(statusOf('M-8')).toBe('中长期·待核对')
    expect(statusOf('L-1')).toBe('执行中')
  })
})
