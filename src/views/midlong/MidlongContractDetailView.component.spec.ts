// 中长期售电合同详情页的交互不变量（dljy#2939，MC-04/MC-06/MA-01）。
// 守什么：已确认合同只给「录入更正/作废」、不给「修改草稿」；两个窗口基于同一版本更正时，后提交的一方看到
// 「已被他人更新」并能刷新，内容不静默覆盖；待核对合同缺依据时明确提示核验前需补齐。
// 坏掉的症状：已确认合同还能直接改；并发更正时后提交者以为保存成功；缺依据时点核验才发现不行。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongContractDetail, MidlongRevision } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchContract: vi.fn(), correctContract: vi.fn(), addEvidence: vi.fn(), fileToBase64: vi.fn(async () => 'Zg==') }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '7' }, query: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: vi.fn(async () => ({ enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1', modules: {}, canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null })),
  fetchContract: hoisted.fetchContract,
  fetchSubjects: vi.fn(async () => []),
  correctContract: hoisted.correctContract,
  verifyContract: vi.fn(), voidContract: vi.fn(), addEvidence: hoisted.addEvidence, linkAlias: vi.fn(), fetchEvidenceContent: vi.fn(),
  midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure,
}))

vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))

import MidlongContractDetailView from './MidlongContractDetailView.vue'

const STUBS = { CompanyScopeBar: { template: '<div />' }, MidlongContractFormDialog: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' } }

const revision: MidlongRevision = {
  id: 1, revisionNo: 1, revisionKind: 'INITIAL', status: 'CONFIRMED', supersedesRevisionNo: null, totalQuantity: '1100', sourceQuantity: '1100 MWh',
  priceType: 'FIXED', sellerPrice: '300', priceStatus: 'KNOWN', sourcePrice: '300 元/MWh', environmentPrice: null, currency: 'CNY', taxBasis: 'TAX_INCLUDED',
  priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationDeclaredComplete: false, allocationCompleteness: 'COMPLETE',
  businessEffectiveAt: null, recordedAt: '2026-09-01T00:00:00.000Z', recordedBy: 'u', confirmedAt: '2026-09-01T00:00:00.000Z', confirmedBy: 'u',
  changeReason: null, affectedMonths: [], evidenceIds: [3], provenance: {},
  allocations: [{ id: 1, revisionId: 1, deliveryMonth: '2027-05', quantity: '1100', sourceQuantity: '1100 MWh', price: null, priceStatus: 'UNKNOWN', sourcePrice: null, evidenceBasis: 'FORMAL', derivation: 'SINGLE_MONTH_TERMS' }],
}

function detail(o: Partial<MidlongContractDetail> = {}): MidlongContractDetail {
  return {
    contractId: 7, companyId: 'comp-a', regionId: 'yunnan', documentKind: 'OBLIGATION', tradingSide: 'SELL', productKind: 'MONTHLY', deliveryCycle: 'MONTH',
    tradeMethod: 'BILATERAL', marketScope: 'PROVINCIAL', energyAttribute: 'CONVENTIONAL', contractName: '月度合同', externalContractNo: 'M-7', sourceNamespace: 'MANUAL',
    counterpartyName: null, signedDate: null, frameworkContractId: null, subjectId: 1, subjectKey: 'S', subjectName: '主体', subjectUnitCode: null, stationId: null,
    stationName: null, stationType: null, confirmationStatus: 'CONFIRMED', deliveryProgress: 'NOT_STARTED', qualityFlags: [], currentRevisionNo: 1, rowVersion: 3,
    origin: 'MANUAL', importBatchId: null, remarks: null, firstConfirmedAt: '2026-09-01T00:00:00.000Z', firstConfirmedBy: 'u', voidedAt: null, voidedBy: null, voidReason: null,
    createdAt: '', updatedAt: '',
    current: { revisionNo: 1, status: 'CONFIRMED', totalQuantity: '1100', sellerPrice: '300', priceStatus: 'KNOWN', priceType: 'FIXED', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationCompleteness: 'COMPLETE', businessEffectiveAt: null, confirmedAt: '2026-09-01T00:00:00.000Z' },
    originalQuantity: '1100', currentRevision: revision, revisions: [revision],
    evidence: [{ id: 3, contractId: 7, importBatchId: null, documentType: 'ELECTRONIC_CONFIRMATION', sha256: 'a'.repeat(64), byteSize: 10, originalFileName: '确认单.pdf', mediaType: null, source: 'UPLOAD', note: null, uploadedAt: '2026-09-01T00:00:00.000Z', uploadedBy: 'u' }],
    events: [], aliases: [], linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' },
    ...o,
  }
}

afterEach(() => vi.clearAllMocks())

describe('中长期售电合同详情', () => {
  it('已确认合同只能更正或作废，不能直接修改草稿', async () => {
    hoisted.fetchContract.mockResolvedValue(detail())
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    const labels = w.findAll('.ml-actions button').map((b) => b.text())
    expect(labels).toContain('录入更正')
    expect(labels).toContain('整笔纠错作废')
    expect(labels).not.toContain('修改草稿')
    expect(labels).not.toContain('删除')
  })

  it('并发更正：后提交者看到已被他人更新，内容不被当成已保存', async () => {
    hoisted.fetchContract.mockResolvedValue(detail())
    hoisted.correctContract.mockRejectedValue({ failure: { status: 409, errorCode: 'VERSION_CONFLICT', message: '合同已被更新', details: { currentRowVersion: 4, currentRevisionNo: 2 } } })
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-actions button').find((b) => b.text() === '录入更正')!.trigger('click')
    await flushPromises()
    const dialog = w.findAll('.el-dialog').find((d) => d.text().includes('录入更正（生成新版本）'))!
    await dialog.find('input[placeholder^="如：原确认单"]').setValue('测试：误录更正')
    await dialog.find('.el-checkbox-group .el-checkbox input').setValue(true)
    await flushPromises()
    await dialog.findAll('.el-dialog__footer button').find((b) => b.text() === '生成更正版本')!.trigger('click')
    await flushPromises()
    expect(hoisted.correctContract).toHaveBeenCalledWith(7, expect.objectContaining({ expectedRowVersion: 3, changeType: 'CORRECTION' }))
    expect(w.text()).toContain('合同已被他人更新')
    expect(w.text()).toContain('经济版本 2')
  })

  it('补充资料超过 20 MB：选择后立即提示，不读入内存也不上传', async () => {
    hoisted.fetchContract.mockResolvedValue(detail({ confirmationStatus: 'PENDING_VERIFICATION' }))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-actions button').find((b) => b.text() === '补充资料')!.trigger('click')
    await flushPromises()
    const input = w.find('input[data-testid="ml-evidence-file"]')
    const huge = new File(['x'], '大文件.zip')
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 })
    Object.defineProperty(input.element, 'files', { value: [huge], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('超过 20 MB 上限，未读取也未上传')
    const upload = w.findAll('.el-dialog__footer button').find((b) => b.text() === '上传')!
    expect(upload.attributes('disabled')).toBeDefined()
    await upload.trigger('click')
    await flushPromises()
    expect(hoisted.fileToBase64).not.toHaveBeenCalled()
    expect(hoisted.addEvidence).not.toHaveBeenCalled()
  })

  it('待核对合同缺依据：核验前明确提示需补齐', async () => {
    hoisted.fetchContract.mockResolvedValue(detail({ confirmationStatus: 'PENDING_VERIFICATION', qualityFlags: ['MISSING_EVIDENCE', 'MISSING_PRICE'], evidence: [] }))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('核验确认前需补齐')
    expect(w.text()).toContain('缺核验依据')
    expect(w.text()).toContain('质量提示（不阻止确认')
    expect(w.findAll('.ml-actions button').map((b) => b.text())).toContain('核验确认')
  })
})
