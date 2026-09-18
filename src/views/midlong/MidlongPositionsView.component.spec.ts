// 中长期售电月度持仓页的渲染不变量（dljy#2939，MP-01/02/03/06）。
// 守什么：缺月度分解的月份不显示成 0 持仓、未分解电量在未分解池只列一次；价格口径不可比时不给统一均价；
// 名义金额不完整时明示；历史认知时点视图有说明；服务失败显示错误而不是示意数值。
// 坏掉的症状：全年 12000 MWh 无分解的合同被画成每月 0 或每月 1000；含税与未核对绿电价被揉成一个均价。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount, type DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongPositionReport, MidlongPriceSummary } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchPositions: vi.fn(), fetchCapabilities: vi.fn(), routeQuery: {} as Record<string, string>, replace: vi.fn(), companyRef: null as null | { value: string }, exportPositions: vi.fn(), downloadCsv: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace }) }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/composables/useTheme', () => ({ cssVar: () => '' }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchPositions: hoisted.fetchPositions,
  fetchSubjects: vi.fn(async () => []),
  exportPositions: hoisted.exportPositions,
  midlongFailureOf: (e: unknown) => ({ status: (e as { status?: number }).status ?? 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))

vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), downloadCsv: hoisted.downloadCsv }))

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

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
})

// 每个用例结束卸载组件：否则遗留实例会响应后续用例的公司/地区切换继续取数，既拖慢全量运行，也可能让「最后一次请求」断言取到别的实例。
enableAutoUnmount(afterEach)

// 打开一个 el-select 并点选指定文案的选项；下拉 teleport 到 body，经 document 查找（同 MidlongContractFormDialog spec 的写法）。
async function pickSelectOption(select: DOMWrapper<Element>, label: string) {
  await select.get('.el-select__wrapper').trigger('click')
  await flushPromises()
  const item = [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find((el) => el.textContent?.trim() === label)
  if (!item) throw new Error(`下拉里没有「${label}」选项`)
  item.click()
  await flushPromises()
}

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

  it('切换公司：清掉交易主体/场站筛选并同步地址栏，新公司不按旧编号取数', async () => {
    hoisted.routeQuery = { fromMonth: '2027-01', toMonth: '2027-02', subjectId: '5', stationId: '9', productKind: 'ANNUAL' }
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report())
    mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchPositions.mock.calls[0][0]).toMatchObject({ subjectId: '5', stationId: '9' })
    hoisted.companyRef!.value = hoisted.companyRef!.value === 'comp-a' ? 'comp-b' : 'comp-a'
    await nextTick()
    await flushPromises()
    const lastQuery = hoisted.fetchPositions.mock.calls.at(-1)![0]
    expect(lastQuery.subjectId).toBeUndefined()
    expect(lastQuery.stationId).toBeUndefined()
    expect(lastQuery.productKind).toBe('ANNUAL')
    const urlQuery = hoisted.replace.mock.calls.at(-1)![0].query
    expect(urlQuery).not.toHaveProperty('subjectId')
    expect(urlQuery).not.toHaveProperty('stationId')
  })

  it('切换公司：新数据返回前不再显示旧公司的持仓；导出返回前切换则丢弃文件', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValueOnce(report()).mockImplementationOnce(() => new Promise(() => {}))
    let resolveExport: (v: unknown) => void = () => {}
    hoisted.exportPositions.mockImplementationOnce(() => new Promise((resolve) => { resolveExport = resolve }))
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('区间正式分解电量')
    await w.findAll('button').find((b) => b.text() === '导出')!.trigger('click')
    hoisted.companyRef!.value = hoisted.companyRef!.value === 'comp-a' ? 'comp-b' : 'comp-a'
    await nextTick()
    await flushPromises()
    expect(w.text()).not.toContain('区间正式分解电量')
    resolveExport({ fileName: 'p.csv', content: 'x' })
    await flushPromises()
    expect(hoisted.downloadCsv).not.toHaveBeenCalled()
  })

  it('导出用加载当前结果时的查询快照：改筛选未点「查询」，导出仍是旧条件（#2983）', async () => {
    // 测试数据：初始按 A 条件（品种周期=年度）加载；把下拉改成「月度」但不点「查询」。
    hoisted.routeQuery = { productKind: 'ANNUAL' }
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report())
    hoisted.exportPositions.mockResolvedValue({ fileName: 'p.csv', content: 'x' })
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchPositions.mock.calls[0][0]).toMatchObject({ productKind: 'ANNUAL' })
    // 第 3 个 select 是「品种周期」（前两个是交易主体、场站）。
    await pickSelectOption(w.findAll('.ml-filters .el-select')[2]!, '月度')
    // 改筛选控件不触发查询：导出必须仍用 A（持仓当前结果对应的条件）加上服务端实际采用的月份边界（回填到筛选的 2027-01~2027-02）。
    expect(hoisted.fetchPositions).toHaveBeenCalledTimes(1)
    await w.findAll('button').find((b) => b.text() === '导出')!.trigger('click')
    await flushPromises()
    expect(hoisted.exportPositions).toHaveBeenCalledTimes(1)
    expect(hoisted.exportPositions.mock.calls[0][0]).toEqual({ fromMonth: '2027-01', toMonth: '2027-02', productKind: 'ANNUAL' })
  })

  it('初次访问不带月份：导出快照用服务端实际采用的月份范围，不让服务端再推算（#2983）', async () => {
    // 测试数据：初次访问地址栏没有 fromMonth/toMonth，服务端按当时默认窗口（2027-06~2027-07）推算并回显。
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report({ fromMonth: '2027-06', toMonth: '2027-07', months: [
      { month: '2027-06', formalQuantity: '800', contractCount: 1, incomplete: true, affectedContractIds: [1], price: price() },
      { month: '2027-07', formalQuantity: '0', contractCount: 1, incomplete: true, affectedContractIds: [1], price: price() },
    ] }))
    hoisted.exportPositions.mockResolvedValue({ fileName: 'p.csv', content: 'x' })
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    // 请求本身不带月份，页面月份范围由响应回填。
    expect(hoisted.fetchPositions.mock.calls[0][0]).not.toHaveProperty('fromMonth')
    expect(hoisted.exportPositions).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text() === '导出')!.trigger('click')
    await flushPromises()
    expect(hoisted.exportPositions).toHaveBeenCalledTimes(1)
    expect(hoisted.exportPositions.mock.calls[0][0]).toMatchObject({ fromMonth: '2027-06', toMonth: '2027-07' })
  })

  it('点「查询」按 B 条件成功加载后，导出改用 B 条件（#2983）', async () => {
    // 测试数据：初始 A 条件加载后，把品种周期改成「月度」并点「查询」，导出随新结果更新。
    hoisted.routeQuery = { productKind: 'ANNUAL' }
    hoisted.fetchCapabilities.mockResolvedValue(caps)
    hoisted.fetchPositions.mockResolvedValue(report())
    hoisted.exportPositions.mockResolvedValue({ fileName: 'p.csv', content: 'x' })
    const w = mount(MidlongPositionsView, { global: { stubs: STUBS } })
    await flushPromises()
    await pickSelectOption(w.findAll('.ml-filters .el-select')[2]!, '月度')
    await w.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(hoisted.fetchPositions.mock.calls.at(-1)![0]).toEqual({ fromMonth: '2027-01', toMonth: '2027-02', productKind: 'MONTHLY' })
    await w.findAll('button').find((b) => b.text() === '导出')!.trigger('click')
    await flushPromises()
    expect(hoisted.exportPositions).toHaveBeenCalledTimes(1)
    expect(hoisted.exportPositions.mock.calls[0][0]).toEqual({ fromMonth: '2027-01', toMonth: '2027-02', productKind: 'MONTHLY' })
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
