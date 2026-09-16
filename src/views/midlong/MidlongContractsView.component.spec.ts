// 中长期售电合同列表页的渲染不变量（dljy#2939，MW-03/MW-04/MC-03）。
// 守什么：切换公司后旧请求迟到不污染新公司列表；未开通地区显示「未开通」而非空列表；
// 服务失败显示错误而非「没有合同」；交割期已结束不显示逾期；缺售电价显示待核对而不是 0。
// 坏掉的症状：切到 B 公司后闪现 A 公司合同；山西地区看到空列表误以为没有合同；接口 503 时页面说「没有合同」。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongContractListResult, MidlongContractSummary } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({
  company: { value: 'comp-a' },
  region: { value: { id: 'yunnan' } },
  fetchContracts: vi.fn(),
  fetchCapabilities: vi.fn(),
  routeQuery: {} as Record<string, string>,
  replace: vi.fn(),
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: hoisted.routeQuery }), useRouter: () => ({ replace: hoisted.replace, push: vi.fn() }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('@/services/company/companyContext', async () => {
  const { ref: vueRef } = await import('vue')
  const selectedCompanyId = vueRef('comp-a')
  ;(hoisted as { companyRef?: typeof selectedCompanyId }).companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => {
  const { ref: vueRef } = await import('vue')
  const currentRegion = vueRef({ id: 'yunnan' })
  ;(hoisted as { regionRef?: typeof currentRegion }).regionRef = currentRegion
  return { currentRegion }
})
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities,
  fetchContracts: hoisted.fetchContracts,
  fetchSubjects: vi.fn(async () => []),
  exportContracts: vi.fn(),
  midlongFailureOf: (e: unknown) => ({ status: (e as { status?: number }).status ?? 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }),
}))

import MidlongContractsView from './MidlongContractsView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' },
  MidlongContractFormDialog: { template: '<div />' },
  MidlongImportDialog: { template: '<div />' },
  MidlongSubjectDialog: { template: '<div />' },
  'router-link': { template: '<a><slot /></a>' },
}

const caps = (overrides: Partial<MidlongCapabilities> = {}): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false },
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null, ...overrides,
})

function row(overrides: Partial<MidlongContractSummary>): MidlongContractSummary {
  return {
    contractId: 1, companyId: 'comp-a', regionId: 'yunnan', documentKind: 'OBLIGATION', tradingSide: 'SELL', productKind: 'ANNUAL',
    deliveryCycle: 'YEAR', tradeMethod: 'BILATERAL', marketScope: 'PROVINCIAL', energyAttribute: 'CONVENTIONAL', contractName: '合同',
    externalContractNo: 'X-1', sourceNamespace: 'MANUAL', counterpartyName: null, signedDate: null, frameworkContractId: null,
    subjectId: 1, subjectKey: 'S', subjectName: '主体', subjectUnitCode: null, stationId: null, stationName: null, stationType: null,
    confirmationStatus: 'CONFIRMED', deliveryProgress: 'IN_DELIVERY', qualityFlags: [], currentRevisionNo: 1, rowVersion: 2, origin: 'MANUAL',
    importBatchId: null, remarks: null, firstConfirmedAt: null, firstConfirmedBy: null, voidedAt: null, voidedBy: null, voidReason: null,
    createdAt: '', updatedAt: '',
    current: { revisionNo: 1, status: 'CONFIRMED', totalQuantity: '1000', sellerPrice: null, priceStatus: 'UNKNOWN', priceType: null, taxBasis: 'UNKNOWN', priceComponent: 'ENERGY_ONLY', deliveryStart: '2026-01-01', deliveryEnd: '2026-06-30', allocationCompleteness: 'NONE', businessEffectiveAt: null, confirmedAt: null },
    ...overrides,
  }
}

function listOf(rows: MidlongContractSummary[]): MidlongContractListResult {
  return { rows, page: 1, pageSize: 20, total: rows.length, stats: { total: rows.length, byStatus: { DRAFT: 0, PENDING_VERIFICATION: 0, CONFIRMED: rows.length, VOIDED: 0 }, frameworkCount: 0, withQualityGaps: 0, confirmedObligationQuantity: '1000', unconfirmedObligationQuantity: '0' } }
}

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
})

describe('中长期售电合同列表', () => {
  it('切换公司 A→B 后，A 的迟到响应不覆盖 B 的列表', async () => {
    let resolveA: (v: MidlongContractListResult) => void = () => {}
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchContracts
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve }))
      .mockImplementationOnce(async () => listOf([row({ contractId: 2, externalContractNo: 'B-公司合同' })]))
    const w = mount(MidlongContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    const companyRef = (hoisted as unknown as { companyRef: { value: string } }).companyRef
    companyRef.value = 'comp-b'
    await nextTick()
    await flushPromises()
    resolveA(listOf([row({ contractId: 1, externalContractNo: 'A-公司合同' })]))
    await flushPromises()
    expect(w.text()).toContain('B-公司合同')
    expect(w.text()).not.toContain('A-公司合同')
  })

  it('切换公司：清掉属于原公司的交易主体/场站筛选并同步地址栏，其余筛选保留', async () => {
    hoisted.routeQuery = { subjectId: '5', stationId: '9', keyword: 'TEST' }
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchContracts.mockResolvedValue(listOf([]))
    mount(MidlongContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchContracts.mock.calls[0][0]).toMatchObject({ subjectId: '5', stationId: '9', keyword: 'TEST' })
    const companyRef = (hoisted as unknown as { companyRef: { value: string } }).companyRef
    companyRef.value = companyRef.value === 'comp-a' ? 'comp-b' : 'comp-a'
    await nextTick()
    await flushPromises()
    const lastQuery = hoisted.fetchContracts.mock.calls.at(-1)![0]
    expect(lastQuery.subjectId).toBeUndefined()
    expect(lastQuery.stationId).toBeUndefined()
    expect(lastQuery.keyword).toBe('TEST')
    const urlQuery = hoisted.replace.mock.calls.at(-1)![0].query
    expect(urlQuery).not.toHaveProperty('subjectId')
    expect(urlQuery).not.toHaveProperty('stationId')
    expect(urlQuery.keyword).toBe('TEST')
  })

  it('非试点地区显示「未开通」，不展示空列表', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ regionId: 'shanxi', regionSupported: false, reason: '地区 shanxi 尚未开通中长期售电模块' }))
    const w = mount(MidlongContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('当前地区未开通中长期售电模块')
    expect(w.text()).not.toContain('没有合同')
    expect(hoisted.fetchContracts).not.toHaveBeenCalled()
  })

  it('服务失败显示错误与重试，不显示「没有合同」', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchContracts.mockRejectedValue(Object.assign(new Error('合同存储暂不可用'), { status: 503 }))
    const w = mount(MidlongContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('合同数据加载失败')
    expect(w.text()).toContain('合同存储暂不可用')
    expect(w.text()).not.toContain('当前筛选下没有合同')
  })

  it('交割期已结束不显示逾期；缺售电价显示待核对而不是 0', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps())
    hoisted.fetchContracts.mockResolvedValue(listOf([row({ deliveryProgress: 'DELIVERY_ENDED', qualityFlags: ['MISSING_PRICE'] })]))
    const w = mount(MidlongContractsView, { global: { stubs: STUBS } })
    await flushPromises()
    const body = w.find('.el-table__body').text()
    expect(body).toContain('交割期已结束')
    expect(body).not.toMatch(/逾期|违约/)
    expect(body).toContain('待核对')
    expect(body).toContain('售电价格待核对')
    expect(body).not.toMatch(/售电价[^\n]*\b0\b/)
  })
})

