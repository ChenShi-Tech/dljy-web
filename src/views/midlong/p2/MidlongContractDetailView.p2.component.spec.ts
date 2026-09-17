// 合同详情页 P2 区块的开关不变量（dljy#2971）。
// 守什么：分时分解与场站分配区只在能力开通且是电量合同时出现；未开通时不出现空壳区块，也不调用 P2 接口。
// 坏掉的症状：能力未交付时详情页出现「导入曲线」按钮；框架协议详情里出现场站分配。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongContractDetail, MidlongRevision } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchCapabilities: vi.fn(), fetchContract: vi.fn(), correctContract: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '7' }, query: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities, fetchContract: hoisted.fetchContract, fetchSubjects: vi.fn(async () => []),
  correctContract: hoisted.correctContract, verifyContract: vi.fn(), voidContract: vi.fn(), addEvidence: vi.fn(), linkAlias: vi.fn(), fetchEvidenceContent: vi.fn(),
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'UNKNOWN', message: String(e), details: null }),
}))

import MidlongContractDetailView from '../MidlongContractDetailView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' }, MidlongContractFormDialog: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' },
  MidlongContractCurvesPanel: { props: ['contractId', 'rowVersion'], template: '<div class="stub-curves" :data-row-version="rowVersion" />' },
  MidlongContractStationsPanel: { props: ['contractId', 'rowVersion'], template: '<div class="stub-stations" :data-row-version="rowVersion" />' },
}
const caps = (modules: Record<string, boolean>): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, ...modules } as MidlongCapabilities['modules'],
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
})
const detail = (documentKind: 'OBLIGATION' | 'FRAMEWORK') => ({
  contractId: 7, documentKind, confirmationStatus: 'CONFIRMED', deliveryProgress: 'NOT_STARTED', qualityFlags: [], revisions: [], evidence: [], events: [], aliases: [],
  linkedContracts: [], framework: null, linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' }, currentRevision: null, current: {}, sourceNamespace: 'TEST', rowVersion: 1,
} as unknown as MidlongContractDetail)

const revision: MidlongRevision = {
  id: 1, revisionNo: 1, revisionKind: 'INITIAL', status: 'CONFIRMED', supersedesRevisionNo: null, totalQuantity: '1100', sourceQuantity: '1100 MWh',
  priceType: 'FIXED', sellerPrice: '300', priceStatus: 'KNOWN', sourcePrice: '300 元/MWh', environmentPrice: null, currency: 'CNY', taxBasis: 'TAX_INCLUDED',
  priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationDeclaredComplete: false, allocationCompleteness: 'COMPLETE',
  businessEffectiveAt: null, recordedAt: '2026-09-01T00:00:00.000Z', recordedBy: 'u', confirmedAt: '2026-09-01T00:00:00.000Z', confirmedBy: 'u',
  changeReason: null, affectedMonths: [], evidenceIds: [3], provenance: {},
  allocations: [{ id: 1, revisionId: 1, deliveryMonth: '2027-05', quantity: '1100', sourceQuantity: '1100 MWh', price: null, priceStatus: 'UNKNOWN', sourcePrice: null, evidenceBasis: 'FORMAL', derivation: 'SINGLE_MONTH_TERMS' }],
}
/** 已确认的电量合同（可录入更正），测试数据。 */
function confirmedDetail(o: Partial<MidlongContractDetail> = {}): MidlongContractDetail {
  return {
    contractId: 7, companyId: 'comp-a', regionId: 'yunnan', documentKind: 'OBLIGATION', tradingSide: 'SELL', productKind: 'MONTHLY', deliveryCycle: 'MONTH',
    tradeMethod: 'BILATERAL', marketScope: 'PROVINCIAL', energyAttribute: 'CONVENTIONAL', contractName: '【测试数据】月度合同', externalContractNo: 'TEST-7', sourceNamespace: 'TEST-FIXTURE',
    counterpartyName: null, signedDate: null, frameworkContractId: null, subjectId: 1, subjectKey: 'S', subjectName: '主体', subjectUnitCode: null, stationId: null,
    stationName: null, stationType: null, confirmationStatus: 'CONFIRMED', deliveryProgress: 'NOT_STARTED', qualityFlags: [], currentRevisionNo: 1, rowVersion: 3,
    origin: 'MANUAL', importBatchId: null, remarks: null, firstConfirmedAt: '2026-09-01T00:00:00.000Z', firstConfirmedBy: 'u', voidedAt: null, voidedBy: null, voidReason: null,
    createdAt: '', updatedAt: '',
    current: { revisionNo: 1, status: 'CONFIRMED', totalQuantity: '1100', sellerPrice: '300', priceStatus: 'KNOWN', priceType: 'FIXED', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationCompleteness: 'COMPLETE', businessEffectiveAt: null, confirmedAt: '2026-09-01T00:00:00.000Z' },
    originalQuantity: '1100', currentRevision: revision, revisions: [revision],
    evidence: [{ id: 3, contractId: 7, importBatchId: null, documentType: 'ELECTRONIC_CONFIRMATION', sha256: 'a'.repeat(64), byteSize: 10, originalFileName: '确认单.pdf', mediaType: null, source: 'UPLOAD', note: null, uploadedAt: '2026-09-01T00:00:00.000Z', uploadedBy: 'u' }],
    events: [], aliases: [], framework: null, linkedContracts: [], linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' },
    ...o,
  }
}

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('合同详情的 P2 区块开关', () => {
  it('能力开通且是电量合同：显示分时分解与场站分配区', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ curves: true, stationAllocations: true }))
    hoisted.fetchContract.mockResolvedValue(detail('OBLIGATION'))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.find('.stub-curves').exists()).toBe(true)
    expect(w.find('.stub-stations').exists()).toBe(true)
  })

  it('录入更正成功后详情重新加载：分时与场站面板收到前进后的 rowVersion（面板据此重新取概览）', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ curves: true, stationAllocations: true }))
    hoisted.fetchContract.mockResolvedValueOnce(confirmedDetail()).mockResolvedValue(confirmedDetail({ rowVersion: 4, currentRevisionNo: 2 }))
    hoisted.correctContract.mockResolvedValue({ contractId: 7, revisionNo: 2, affectedMonths: ['2027-05'], diffs: [], warnings: [] })
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    const versions = () => [w.find('.stub-curves').attributes('data-row-version'), w.find('.stub-stations').attributes('data-row-version')]
    expect(versions()).toEqual(['3', '3'])
    await w.findAll('.ml-actions button').find((b) => b.text() === '录入更正')!.trigger('click')
    await flushPromises()
    const dialog = w.findAll('.el-dialog').find((d) => d.text().includes('录入更正（生成新版本）'))!
    await dialog.find('input[placeholder^="如：原确认单"]').setValue('【测试】五月电量录错')
    await dialog.find('.el-checkbox-group .el-checkbox input').setValue(true)
    await flushPromises()
    await dialog.findAll('.el-dialog__footer button').find((b) => b.text() === '生成更正版本')!.trigger('click')
    await flushPromises()
    expect(hoisted.correctContract).toHaveBeenCalledWith(7, expect.objectContaining({ expectedRowVersion: 3 }))
    expect(hoisted.fetchContract).toHaveBeenCalledTimes(2)
    expect(versions()).toEqual(['4', '4'])
  })

  it('能力未开通或是框架协议：不出现 P2 区块', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({}))
    hoisted.fetchContract.mockResolvedValue(detail('OBLIGATION'))
    const off = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(off.find('.stub-curves').exists()).toBe(false)
    expect(off.find('.stub-stations').exists()).toBe(false)
    off.unmount()
    hoisted.fetchCapabilities.mockResolvedValue(caps({ curves: true, stationAllocations: true }))
    hoisted.fetchContract.mockResolvedValue(detail('FRAMEWORK'))
    const framework = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(framework.find('.stub-curves').exists()).toBe(false)
    expect(framework.find('.stub-stations').exists()).toBe(false)
  })
})
