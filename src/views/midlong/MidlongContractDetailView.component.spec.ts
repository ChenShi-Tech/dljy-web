// 中长期售电合同详情页的交互不变量（dljy#2939，MC-04/MC-06/MA-01）。
// 守什么：已确认合同只给「录入更正/作废」、不给「修改草稿」；两个窗口基于同一版本更正时，后提交的一方看到
// 「已被他人更新」并能刷新，内容不静默覆盖；待核对合同缺依据时明确提示核验前需补齐。
// 坏掉的症状：已确认合同还能直接改；并发更正时后提交者以为保存成功；缺依据时点核验才发现不行。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongContractDetail, MidlongRevision } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchContract: vi.fn(), correctContract: vi.fn(), addEvidence: vi.fn(), fileToBase64: vi.fn(async () => 'Zg=='), routeQuery: {} as Record<string, string> }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '7' }, query: hoisted.routeQuery }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
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

const STUBS = { CompanyScopeBar: { template: '<div />' }, MidlongContractFormDialog: { template: '<div />' }, 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

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
    events: [], aliases: [], framework: null, linkedContracts: [], linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' },
    ...o,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  hoisted.routeQuery = {}
})

// 每个用例结束卸载组件：否则遗留实例会响应后续用例的公司/地区切换继续取数，既拖慢全量运行，也可能让「最后一次请求」断言取到别的实例。
enableAutoUnmount(afterEach)

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

  it('从旧深链或筛选列表进入：返回列表时带回交割期等筛选', async () => {
    hoisted.routeQuery = { deliveryFrom: '2027-01', deliveryTo: '2027-12' }
    hoisted.fetchContract.mockResolvedValue(detail())
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    const back = w.findAll('a').find((a) => a.text().includes('← 售电合同'))!
    expect(JSON.parse(back.attributes('data-to')!)).toEqual({ path: '/zcqjy/contracts', query: { deliveryFrom: '2027-01', deliveryTo: '2027-12' } })
  })

  it('录入更正：生效时间不能选未来；填入未来时刻时本地拦截，不发更正请求（#2961）', async () => {
    hoisted.fetchContract.mockResolvedValue(detail())
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-actions button').find((b) => b.text() === '录入更正')!.trigger('click')
    await flushPromises()
    const picker = w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'datetime')!
    const disabledDate = picker.props('disabledDate') as (d: Date) => boolean
    expect(disabledDate(new Date(Date.now() + 24 * 3600 * 1000))).toBe(true)
    expect(disabledDate(new Date(Date.now() - 24 * 3600 * 1000))).toBe(false)
    picker.vm.$emit('update:modelValue', '2099-01-01T00:00:00+08:00')
    const dialog = w.findAll('.el-dialog').find((d) => d.text().includes('录入更正（生成新版本）'))!
    await dialog.find('input[placeholder^="如：原确认单"]').setValue('测试：未来生效')
    await dialog.find('.el-checkbox-group .el-checkbox input').setValue(true)
    await flushPromises()
    await dialog.findAll('.el-dialog__footer button').find((b) => b.text() === '生成更正版本')!.trigger('click')
    await flushPromises()
    expect(hoisted.correctContract).not.toHaveBeenCalled()
    expect(w.text()).toContain('业务生效时间不能晚于当前时间')
  })

  it('框架协议：电量合同显示所属框架协议，框架协议列出框架下的合同（#2961）', async () => {
    const framework = { contractId: 5, contractName: '年度框架协议', externalContractNo: 'FW-5', documentKind: 'FRAMEWORK' as const, confirmationStatus: 'CONFIRMED' as const, totalQuantity: null, deliveryStart: '2027-01-01', deliveryEnd: '2027-12-31' }
    hoisted.fetchContract.mockResolvedValue(detail({ frameworkContractId: 5, framework }))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    const link = w.findAll('a').find((a) => a.text().includes('年度框架协议（FW-5）'))!
    expect(JSON.parse(link.attributes('data-to')!)).toBe('/zcqjy/contracts/5')
    expect(w.text()).not.toContain('框架协议已作废')

    hoisted.fetchContract.mockResolvedValue(detail({ frameworkContractId: 5, framework: { ...framework, confirmationStatus: 'VOIDED' } }))
    const v = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(v.text()).toContain('框架协议已作废（保留历史关联）')

    hoisted.fetchContract.mockResolvedValue(detail({ contractId: 5, documentKind: 'FRAMEWORK', contractName: '年度框架协议', linkedContracts: [{ contractId: 7, contractName: '月度合同', externalContractNo: 'M-7', documentKind: 'OBLIGATION', confirmationStatus: 'CONFIRMED', totalQuantity: '1100', deliveryStart: '2027-05-01', deliveryEnd: '2027-05-31' }] }))
    const f = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(f.text()).toContain('框架下的合同（1）')
    expect(f.text()).toContain('月度合同')
    const listLink = f.findAll('a').find((a) => a.text().includes('在合同列表中查看'))!
    expect(JSON.parse(listLink.attributes('data-to')!)).toEqual({ path: '/zcqjy/contracts', query: { frameworkContractId: '5' } })
  })

  it('已作废合同：外部编号标明已随作废释放，并提示可以重新登记（#2961）', async () => {
    hoisted.fetchContract.mockResolvedValue(detail({
      confirmationStatus: 'VOIDED', voidReason: '交易方式录错', voidedAt: '2026-09-17T01:00:00.000Z', voidedBy: 'u',
      aliases: [{ id: 1, sourceNamespace: 'MANUAL', externalObligationId: 'M-7', aliasKind: 'PRIMARY', subjectId: 1, verificationNote: null, createdAt: '', createdBy: 'u', releasedAt: '2026-09-17T01:00:00.000Z', releasedReason: '交易方式录错' }],
    }))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('外部编号 M-7 已随作废释放，可以按正确内容重新登记')
    expect(w.text()).toContain('已随作废释放')
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
