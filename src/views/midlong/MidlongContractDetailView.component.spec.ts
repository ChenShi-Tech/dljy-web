// 中长期售电合同详情页的交互不变量（dljy#2939，MC-04/MC-06/MA-01）。
// 守什么：已确认合同只给「录入更正/作废」、不给「修改草稿」；两个窗口基于同一版本更正时，后提交的一方看到
// 「已被他人更新」并能刷新，内容不静默覆盖；待核对合同缺依据时明确提示核验前需补齐。
// 坏掉的症状：已确认合同还能直接改；并发更正时后提交者以为保存成功；缺依据时点核验才发现不行。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongContractDetail, MidlongRevision } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchContract: vi.fn(), correctContract: vi.fn(), addEvidence: vi.fn(), fileToBase64: vi.fn(async () => 'Zg=='), routeQuery: {} as Record<string, string>, fetchAdjustments: vi.fn(), fetchRevisionImpact: vi.fn(), capabilities: null as null | Record<string, unknown> }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '7' }, query: hoisted.routeQuery }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: vi.fn(async () => hoisted.capabilities ?? { enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1', modules: {}, canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null }),
  fetchContract: hoisted.fetchContract,
  fetchSubjects: vi.fn(async () => []),
  correctContract: hoisted.correctContract,
  verifyContract: vi.fn(), voidContract: vi.fn(), addEvidence: hoisted.addEvidence, linkAlias: vi.fn(), fetchEvidenceContent: vi.fn(),
  midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure,
}))

vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/midlong/midlongP4Api', () => ({
  fetchAdjustments: hoisted.fetchAdjustments, fetchRevisionImpact: hoisted.fetchRevisionImpact,
  p4ModuleOn: (caps: { enabled?: boolean; regionSupported?: boolean; modules?: Record<string, boolean> } | null | undefined, name: string) =>
    Boolean(caps?.enabled && caps.regionSupported && caps?.modules?.[name] === true),
}))

import { fillGuideForm, onGuideSignal, resetGuideBridge } from '@/features/guide/bridge'
import { FORM, SIGNAL } from '@/features/guide/midlong/anchors'
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
  hoisted.capabilities = null
  resetGuideBridge() // 详情页把表单挂进了真 bridge，用例间要清
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

  it('导引「帮我填」直接把示例 File 写进补充资料表单，上传成功发 evidenceAdded 信号（dljy#3404）', async () => {
    hoisted.fetchContract.mockResolvedValue(detail({ confirmationStatus: 'PENDING_VERIFICATION' }))
    hoisted.addEvidence.mockResolvedValue(undefined)
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-actions button').find((b) => b.text() === '补充资料')!.trigger('click')
    await flushPromises()

    // 原生 input[type=file] 无法程序赋值，导引兜底直接写表单 reactive 的 file 字段。
    const example = new File(['x'], '教学示例-电子交易确认单-M-7.txt', { type: 'text/plain' })
    expect(fillGuideForm(FORM.evidence, { note: '教学示例', file: example })).toBe(true)
    await flushPromises()
    expect(w.text()).toContain('已选择：教学示例-电子交易确认单-M-7.txt')

    const seen: unknown[] = []
    onGuideSignal(SIGNAL.evidenceAdded, (payload) => seen.push(payload))
    await w.find('[data-guide="ml-evidence-submit"]').trigger('click')
    await flushPromises()
    expect(hoisted.addEvidence).toHaveBeenCalledWith(7, expect.objectContaining({
      fileName: '教学示例-电子交易确认单-M-7.txt', documentType: 'ELECTRONIC_CONFIRMATION', note: '教学示例',
    }))
    expect(seen).toEqual([{ contractId: 7 }])
  })

  it('核验确认成功发 contractVerified 信号，载荷带合同号（dljy#3404）', async () => {
    hoisted.fetchContract.mockResolvedValue(detail({ confirmationStatus: 'PENDING_VERIFICATION' }))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    await w.findAll('.ml-actions button').find((b) => b.text() === '核验确认')!.trigger('click')
    await flushPromises()

    const seen: unknown[] = []
    onGuideSignal(SIGNAL.contractVerified, (payload) => seen.push(payload))
    await w.find('[data-guide="ml-verify-submit"]').trigger('click')
    await flushPromises()
    expect(seen).toEqual([{ contractId: 7 }])
  })
})

describe('合同详情：合同调整区块（P4）', () => {
  const capsP4 = (adjustments: boolean) => ({ enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1', modules: { adjustments }, canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null })

  it('adjustments 能力打开时展示该合同的调整列表与登记入口；关闭时区块与接口都不出现', async () => {
    hoisted.capabilities = capsP4(false)
    hoisted.fetchContract.mockResolvedValue(detail())
    hoisted.fetchAdjustments.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 100 })
    const closed = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(closed.text()).not.toContain('合同调整（')
    expect(hoisted.fetchAdjustments).not.toHaveBeenCalled()

    hoisted.capabilities = capsP4(true)
    hoisted.fetchAdjustments.mockResolvedValue({
      rows: [{
        id: 31, contractId: 7, contractNo: 'M-7', contractName: '月度合同', subjectId: 1, subjectName: '主体',
        sourceNamespace: '昆明交易中心', externalAdjustmentNo: 'T-2026-01', externalRevisionNo: 1, status: 'PENDING_VERIFICATION',
        currentRevisionNo: 1, rowVersion: 1, adjustmentType: 'TRANSFER', direction: null, directionSource: null,
        pendingReason: 'NO_DIRECTION', baseRevisionNo: 1, totalQuantity: '200', prices: {}, effective: null,
        companyId: 'comp-a', regionId: 'yunnan', createdAt: '', createdBy: null, updatedAt: '',
      }],
      total: 1, page: 1, pageSize: 100,
    })
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(hoisted.fetchAdjustments).toHaveBeenCalledWith(expect.objectContaining({ contractId: '7' }))
    expect(w.text()).toContain('合同调整（1）')
    expect(w.text()).toContain('待核对（方向未确认）')
    expect(w.text()).toContain('方向待核对')
    expect(w.text()).toContain('待核对，未生效')
    expect(w.findAll('button').some((b) => b.text() === '登记调整')).toBe(true)
  })

  it('更正与调整产生的版本在同一条时间线上：变更版本有「影响对比」并展示前后快照，初始版本没有', async () => {
    hoisted.capabilities = capsP4(true)
    const corrected: MidlongRevision = {
      ...revision, id: 2, revisionNo: 2, revisionKind: 'CORRECTION', supersedesRevisionNo: 1, totalQuantity: '1000',
      changeReason: '原确认单 1000，误录 1100', affectedMonths: ['2027-05'],
      allocations: revision.allocations.map((a) => ({ ...a, quantity: '1000' })),
    }
    hoisted.fetchContract.mockResolvedValue(detail({ revisions: [revision, corrected], currentRevisionNo: 2 }))
    hoisted.fetchAdjustments.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 100 })
    hoisted.fetchRevisionImpact.mockResolvedValue({
      contractId: 7, contractNo: 'M-7', contractName: '月度合同', revisionNo: 2, revisionKind: 'CORRECTION',
      changeReason: '原确认单 1000，误录 1100', recordedAt: '', confirmedAt: '', businessEffectiveAt: null, evidenceIds: [],
      adjustment: null,
      snapshot: { frozen: true, beforeRevisionNo: 1, afterRevisionNo: 2, beforeTotalQuantity: '1100', afterTotalQuantity: '1000', months: [{ deliveryMonth: '2027-05', before: '1100', after: '1000', delta: '-100' }] },
      months: ['2027-05'], affectedPlans: [], affectedProposals: [], asOfExplanation: 'asOf 说明', endedMonths: [], notices: [],
    })
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    // 初始版本（v1）没有影响对比；变更版本（v2 更正）有。
    expect(w.find('[data-test="revision-impact-1"]').exists()).toBe(false)
    const button = w.find('[data-test="revision-impact-2"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    await flushPromises()
    expect(hoisted.fetchRevisionImpact).toHaveBeenCalledWith(7, 2)
    const dialog = [...document.body.querySelectorAll('.el-dialog')].find((d) => d.textContent?.includes('合同版本变更影响')) as HTMLElement
    expect(dialog.textContent).toContain('2027-05：1,100 → 1,000（-100 MWh）')
    expect(dialog.textContent).toContain('快照 v1 → v2')
  })
})
