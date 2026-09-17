// 中长期售电合同草稿表单的框架协议关联与重新登记提示（dljy#2961，MC-01/MC-06）。
// 守什么：修改草稿时带回原有的框架协议关联（不因表单没改这一项就清空）；框架协议自身不挂到框架协议下；
// 重新登记曾作废的外部编号时给出提示。
// 坏掉的症状：打开草稿改个备注，原来关联的框架协议就没了；录入与作废合同同号的合同时毫无提示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongContractDetail, MidlongContractSummary, MidlongRevision } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchContracts: vi.fn(), createDraft: vi.fn(), updateDraft: vi.fn(), warning: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  fetchContracts: hoisted.fetchContracts,
  createDraft: hoisted.createDraft,
  updateDraft: hoisted.updateDraft,
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: String(e), details: null }),
}))

import MidlongContractFormDialog from './MidlongContractFormDialog.vue'

const STUBS = { 'router-link': { template: '<a><slot /></a>' } }

const revision: MidlongRevision = {
  id: 1, revisionNo: 1, revisionKind: 'INITIAL', status: 'DRAFT', supersedesRevisionNo: null, totalQuantity: '1000', sourceQuantity: '1000 MWh',
  priceType: 'FIXED', sellerPrice: '300', priceStatus: 'KNOWN', sourcePrice: '300 元/MWh', environmentPrice: null, currency: 'CNY', taxBasis: 'TAX_INCLUDED',
  priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationDeclaredComplete: false, allocationCompleteness: 'NONE',
  businessEffectiveAt: null, recordedAt: '2026-09-01T00:00:00.000Z', recordedBy: 'u', confirmedAt: null, confirmedBy: null,
  changeReason: null, affectedMonths: [], evidenceIds: [], provenance: {}, allocations: [],
}

const framework = { contractId: 5, contractName: '年度框架协议', externalContractNo: 'FW-5', documentKind: 'FRAMEWORK' as const, confirmationStatus: 'CONFIRMED' as const, totalQuantity: null, deliveryStart: '2027-01-01', deliveryEnd: '2027-12-31' }

function detail(o: Partial<MidlongContractDetail> = {}): MidlongContractDetail {
  return {
    contractId: 7, companyId: 'comp-a', regionId: 'yunnan', documentKind: 'OBLIGATION', tradingSide: 'SELL', productKind: 'MONTHLY', deliveryCycle: 'MONTH',
    tradeMethod: 'BILATERAL', marketScope: 'PROVINCIAL', energyAttribute: 'CONVENTIONAL', contractName: '月度合同', externalContractNo: 'M-7', sourceNamespace: 'MANUAL',
    counterpartyName: null, signedDate: null, frameworkContractId: 5, subjectId: null, subjectKey: null, subjectName: null, subjectUnitCode: null, stationId: null,
    stationName: null, stationType: null, confirmationStatus: 'DRAFT', deliveryProgress: 'NOT_STARTED', qualityFlags: [], currentRevisionNo: 1, rowVersion: 3,
    origin: 'MANUAL', importBatchId: null, remarks: null, firstConfirmedAt: null, firstConfirmedBy: null, voidedAt: null, voidedBy: null, voidReason: null,
    createdAt: '', updatedAt: '',
    current: { revisionNo: 1, status: 'DRAFT', totalQuantity: '1000', sellerPrice: '300', priceStatus: 'KNOWN', priceType: 'FIXED', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31', allocationCompleteness: 'NONE', businessEffectiveAt: null, confirmedAt: null },
    originalQuantity: '1000', currentRevision: revision, revisions: [revision], evidence: [], events: [], aliases: [],
    framework, linkedContracts: [], linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' },
    ...o,
  }
}

const frameworkRow = { contractId: 5, contractName: '年度框架协议', externalContractNo: 'FW-5', documentKind: 'FRAMEWORK', confirmationStatus: 'CONFIRMED' } as MidlongContractSummary

async function open(props: Record<string, unknown>) {
  const w = mount(MidlongContractFormDialog, { props: { modelValue: false, subjects: [], stations: [], ...props }, global: { stubs: STUBS } })
  await w.setProps({ modelValue: true })
  await flushPromises()
  return { w, save: () => w.findAll('.el-dialog__footer button').find((b) => /保存/.test(b.text()))!.trigger('click') }
}

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

describe('中长期合同草稿表单', () => {
  it('修改草稿时带回原有框架协议关联，保存请求里不会把它清空', async () => {
    hoisted.fetchContracts.mockResolvedValue({ rows: [frameworkRow], page: 1, pageSize: 200, total: 1, stats: {} })
    hoisted.updateDraft.mockResolvedValue({ contractId: 7, warnings: [] })
    const { w, save } = await open({ detail: detail() })
    expect(hoisted.fetchContracts).toHaveBeenCalledWith(expect.objectContaining({ documentKind: 'FRAMEWORK' }))
    expect(w.find('[data-testid="ml-framework-select"]').exists()).toBe(true)
    await save()
    await flushPromises()
    expect(hoisted.updateDraft).toHaveBeenCalledWith(7, expect.objectContaining({ frameworkContractId: 5, expectedRowVersion: 3 }))
  })

  it('框架协议自身保存时不带框架关联（显式 null）', async () => {
    hoisted.fetchContracts.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0, stats: {} })
    hoisted.updateDraft.mockResolvedValue({ contractId: 7, warnings: [] })
    const { w, save } = await open({ detail: detail({ documentKind: 'FRAMEWORK', frameworkContractId: null, framework: null }) })
    expect(w.find('[data-testid="ml-framework-select"]').exists()).toBe(false)
    await save()
    await flushPromises()
    expect(hoisted.updateDraft).toHaveBeenCalledWith(7, expect.objectContaining({ frameworkContractId: null }))
  })

  it('重新登记曾作废的外部编号：保存成功后给出提示', async () => {
    hoisted.fetchContracts.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0, stats: {} })
    hoisted.updateDraft.mockResolvedValue({ contractId: 7, warnings: [{ code: 'PREVIOUSLY_VOIDED', message: '外部合同编号「M-7」曾登记为合同 3（作废原因：录错）', contractIds: [3] }] })
    const { save } = await open({ detail: detail({ frameworkContractId: null, framework: null }) })
    await save()
    await flushPromises()
    expect(hoisted.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('曾登记为合同 3') }))
  })
})
