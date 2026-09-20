// 确认单详情抽屉（dljy#3014，MT-03..06）。
// 守什么：版本链旧版本保留（多版本可见）、冲正记录不删除旧成交、占用转换与计划偏差在版本内可见；
//        补纸质合同只新增关联——成功后文案写明持仓不变并给出合同跳转；撤销冲正带 expectedRowVersion（他人先改不覆盖）；
//        来源不支持的产品在待核对态展示原文。
// 坏掉的症状：修订后旧版本消失；补纸质合同后持仓翻倍还看不出提示；并发修订/冲正用旧行版本静默覆盖。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { ExecutionConfirmationDetailDto } from '@/services/midlong/midlongP4Types'

const hoisted = vi.hoisted(() => ({ fetchConfirmation: vi.fn(), linkConfirmationContract: vi.fn(), revokeConfirmation: vi.fn(), info: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: hoisted.info } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({
  fetchConfirmation: hoisted.fetchConfirmation, linkConfirmationContract: hoisted.linkConfirmationContract, revokeConfirmation: hoisted.revokeConfirmation,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: vi.fn(async () => 'Zg==') }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import ConfirmationDetailDrawer from './ConfirmationDetailDrawer.vue'
import { EXECUTION_NOTICES } from '@/services/midlong/midlongP4Types'

const DRAWER_TIMEOUT = 20000

function detail(overrides: Record<string, unknown> = {}): ExecutionConfirmationDetailDto {
  return {
    id: 21, companyId: 'comp-a', regionId: 'yunnan', subjectId: 3, subjectName: '云南中广核一号',
    sourceNamespace: '昆明交易中心', confirmationNo: 'C-2026-001', proposalId: 8, proposalStatus: 'CLEARED',
    currentRevisionNo: 2, rowVersion: 5, resultStatus: 'CLEARED', pendingReview: false, totalQuantity: '850',
    priceKnown: true, reversed: false, convertedQuantity: '150',
    linkedContracts: [{ contractId: 7, linkKind: 'OBLIGATION_CREATED' }],
    createdAt: '', createdBy: null, updatedAt: '',
    revisions: [
      {
        id: 1, confirmationId: 21, revisionNo: 1, supersedesRevisionNo: null, resultStatus: 'PRE_CLEARED', productKind: 'MONTHLY',
        tradeMethod: 'BILATERAL', unsupportedProduct: null, pendingReview: false, priceTaxBasis: 'UNKNOWN', priceComponent: 'UNVERIFIED',
        externalConfirmedAt: null, sourceName: null, note: null, changeReason: null, attachmentId: null,
        conversion: { months: [], totalDelta: '0', totalUnconverted: '0', lateResult: false }, recordedAt: '', recordedBy: null,
        segments: [{ id: 1, deliveryMonth: '2026-10', quantity: '150', price: '300' }],
      },
      {
        id: 2, confirmationId: 21, revisionNo: 2, supersedesRevisionNo: 1, resultStatus: 'CLEARED', productKind: 'MONTHLY',
        tradeMethod: 'BILATERAL', unsupportedProduct: null, pendingReview: false, priceTaxBasis: 'UNKNOWN', priceComponent: 'UNVERIFIED',
        externalConfirmedAt: null, sourceName: null, note: null, changeReason: '预成交转确认成交，正式结果 850', attachmentId: null,
        conversion: {
          months: [{ deliveryMonth: '2026-10', targetQuantity: '850', previousConvertedQuantity: '0', delta: '150', remainingBefore: '200', remainingAfter: '50', reason: 'PARTIAL' }],
          totalDelta: '150', totalUnconverted: '700', lateResult: false,
          deviation: { rows: [{ planId: 1, periodType: 'MONTH', periodKey: '2026-10', targetQuantity: '1000', soldQuantityBefore: '700', soldComplete: true, confirmedQuantityInPeriod: '150', knownSoldQuantityAfter: '850', remainingPlanQuantityAfter: '150', completionRateAfter: '0.85', overPlan: false, verificationStatus: 'VERIFIED' }], notices: [] },
        },
        recordedAt: '', recordedBy: null,
        segments: [{ id: 2, deliveryMonth: '2026-10', quantity: '850', price: '300' }],
      },
    ],
    contractLinks: [{ contractId: 7, linkKind: 'OBLIGATION_CREATED', note: '确认成交创建的合同义务', createdAt: '', createdBy: null }],
    reversals: [], conversions: [], events: [], notices: [],
    ...overrides,
  } as ExecutionConfirmationDetailDto
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open(confirmationId = 21) {
  const w = mount(ConfirmationDetailDrawer, {
    props: { modelValue: true, confirmationId, canWrite: true },
    attachTo: document.body,
    global: { stubs: { 'router-link': { props: ['to'], template: '<a :data-to="String(to)"><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

/** 抽屉 append-to-body：内容在 document.body 下，断言与交互都走 body。 */
const bodyText = () => document.body.textContent ?? ''
const bodyHas = (selector: string) => Boolean(document.body.querySelector(selector))

describe('确认单详情抽屉', () => {
  it('版本链旧版本保留：v1 预成交与 v2 确认成交同屏，修订版本含占用转换与计划偏差', async () => {
    hoisted.fetchConfirmation.mockResolvedValue(detail())
    await open()
    const text = bodyText()
    expect(text).toContain('修订原因：预成交转确认成交，正式结果 850')
    expect(text).toContain('v1')
    expect(text).toContain('部分转换（占用不足）')
    expect(text).toContain('本次成交 150 MWh')
    expect(text).toContain('剩余计划待售量 150 MWh')
    expect(text).toContain('占用转换：')
    // 创建的合同义务可跳转详情。
    expect([...document.body.querySelectorAll('a[data-to]')].some((a) => a.getAttribute('data-to') === '/zcqjy/contracts/7')).toBe(true)
  }, DRAWER_TIMEOUT)

  it('已冲正的确认单：冲正记录与固定提示可见，不再提供修订/撤销入口', async () => {
    hoisted.fetchConfirmation.mockResolvedValue(detail({
      resultStatus: 'WITHDRAWN', reversed: true, convertedQuantity: '150',
      reversals: [{ id: 1, baseRevisionNo: 2, reason: '平台撤销：结算单位纠错', externalRevokedAt: '2026-09-10T02:00:00.000Z', attachmentId: null, contractId: 7, contractRevisionNo: 3, createdAt: '', createdBy: null }],
    }))
    await open()
    const text = bodyText()
    expect(text).toContain('冲正记录（旧成交保留）')
    expect(text).toContain('平台撤销：结算单位纠错')
    expect(text).toContain(EXECUTION_NOTICES.revokeReversal)
    expect(bodyHas('[data-test="revise-button"]')).toBe(false)
    expect(bodyHas('[data-test="revoke-button"]')).toBe(false)
  }, DRAWER_TIMEOUT)

  it('待核对（来源产品不支持）：展示原文并支持修订补齐', async () => {
    hoisted.fetchConfirmation.mockResolvedValue(detail({
      resultStatus: 'PRE_CLEARED', pendingReview: true, linkedContracts: [], contractLinks: [],
      revisions: [{
        id: 1, confirmationId: 21, revisionNo: 1, supersedesRevisionNo: null, resultStatus: 'PRE_CLEARED', productKind: null,
        tradeMethod: null, unsupportedProduct: '月内合约转让-X99', pendingReview: true, priceTaxBasis: 'UNKNOWN', priceComponent: 'UNVERIFIED',
        externalConfirmedAt: null, sourceName: null, note: null, changeReason: null, attachmentId: null,
        conversion: { months: [], totalDelta: '0', totalUnconverted: '0', lateResult: false }, recordedAt: '', recordedBy: null,
        segments: [{ id: 1, deliveryMonth: '2026-10', quantity: '150', price: null }],
      }],
    }))
    await open()
    expect((document.body.querySelector('[data-test="pending-review-raw"]') as HTMLElement).textContent).toContain('月内合约转让-X99')
    expect(bodyHas('[data-test="revise-button"]')).toBe(true)
  }, DRAWER_TIMEOUT)

  it('补纸质合同：只新增关联、持仓不增——成功后给出固定文案，并按说明必填校验', async () => {
    // 打开时未关联；关联成功后重载，详情带上关联行。
    hoisted.fetchConfirmation
      .mockResolvedValueOnce(detail({ linkedContracts: [], contractLinks: [], resultStatus: 'PRE_CLEARED' }))
      .mockResolvedValue(detail({
        linkedContracts: [{ contractId: 9, linkKind: 'EXISTING_LINKED' }],
        contractLinks: [{ contractId: 9, linkKind: 'EXISTING_LINKED', note: '纸质合同与确认单为同一义务', createdAt: '', createdBy: null }],
      }))
    hoisted.linkConfirmationContract.mockResolvedValue({ confirmationId: 21, contractId: 9, linkKind: 'EXISTING_LINKED', notice: EXECUTION_NOTICES.linkNoDoubleCount, pendingReview: false })
    await open()
    ;(document.body.querySelector('[data-test="link-button"]') as HTMLButtonElement).click()
    await flushPromises()
    const link = () => [...document.body.querySelectorAll('.el-dialog')].find((d) => d.textContent?.includes('关联既有合同（补纸质合同）'))!
    // 说明没填：按钮不可用。
    const submit = () => [...link().querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '关联（持仓不变）') as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    const note = link().querySelector('textarea') as HTMLTextAreaElement
    note.value = '纸质合同与确认单为同一义务'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    const contractInput = [...link().querySelectorAll('input')].find((i) => i.placeholder === '如：7') as HTMLInputElement
    contractInput.value = '9'
    contractInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(submit().disabled).toBe(false)
    submit().click()
    await flushPromises()
    expect(hoisted.linkConfirmationContract).toHaveBeenCalledWith(21, { contractId: 9, note: '纸质合同与确认单为同一义务' })
    expect(hoisted.info).toHaveBeenCalledWith(EXECUTION_NOTICES.linkNoDoubleCount)
    // 关联成功后重载详情：关联行给出「关联既有合同义务」的跳转。
    expect([...document.body.querySelectorAll('a[data-to]')].some((a) => a.getAttribute('data-to') === '/zcqjy/contracts/9')).toBe(true)
  }, DRAWER_TIMEOUT)

  it('外部撤销冲正：原因必填并带 expectedRowVersion，不物理删旧成交', async () => {
    hoisted.fetchConfirmation.mockResolvedValue(detail())
    hoisted.revokeConfirmation.mockResolvedValue({ confirmationId: 21, revisionNo: 3, resultStatus: 'WITHDRAWN', businessKeyReplay: false, pendingReview: null, contractId: 7, linkKind: 'OBLIGATION_CREATED', proposalId: 8, proposalStatus: 'WITHDRAWN', reversalId: 1, contractRevisionNo: 3, conversion: { months: [], totalDelta: '0', totalUnconverted: '0', lateResult: false }, deviation: { rows: [], notices: [] }, notices: [] })
    await open()
    ;(document.body.querySelector('[data-test="revoke-button"]') as HTMLButtonElement).click()
    await flushPromises()
    const dialog = () => [...document.body.querySelectorAll('.el-dialog')].find((d) => d.textContent?.includes('外部撤销冲正'))!
    const submit = () => [...dialog().querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '确认冲正') as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    const reason = dialog().querySelector('textarea') as HTMLTextAreaElement
    reason.value = '交易中心撤销该笔成交'
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    submit().click()
    await flushPromises()
    expect(hoisted.revokeConfirmation).toHaveBeenCalledWith(21, expect.objectContaining({ expectedRowVersion: 5, reason: '交易中心撤销该笔成交' }))
    expect(dialog().textContent).toContain(EXECUTION_NOTICES.revokeReversal)
  }, DRAWER_TIMEOUT)
})
