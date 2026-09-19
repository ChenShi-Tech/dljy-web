// 确认单登记表单（dljy#3014，MT-03..06 / MS-04）。
// 守什么：预成交登记成功只提示「保留记录、不入正式持仓」，不出现「平台已受理」；确认成交必附依据文件；
//        同一确认单重复处理（导入后再确认 / 回执超时重试）与关联既有合同都提示「同一义务只计一次」并给合同跳转；
//        来源不支持的产品登记后停在待核对并展示原文；SUBJECT_MISMATCH 错误提示归属核对而非笼统失败。
// 坏掉的症状：预成交被当成已入账；重复确认后持仓翻倍；待核对产品被悄悄映射成默认品种。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ registerConfirmation: vi.fn(), reviseConfirmation: vi.fn(), fileToBase64: vi.fn(async (): Promise<string> => 'Zg==') }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({ registerConfirmation: hoisted.registerConfirmation, reviseConfirmation: hoisted.reviseConfirmation }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import ConfirmationFormDialog from './ConfirmationFormDialog.vue'
import { EXECUTION_NOTICES } from '@/services/midlong/midlongP4Types'

const subjects = [{ id: 3, subjectKey: 'YN-CGN-01', displayName: '云南中广核一号', unitCode: null } as unknown as MidlongSubject]

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

const FORM_TIMEOUT = 20000
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
/** el-input 的 data-test 会落到内部原生 input 上：直接定位并以 input 事件回填（v-model 才会更新）。 */
function setNativeInput(name: string, value: string) {
  const el = document.body.querySelector(`input[data-test="${name}"]`) as HTMLInputElement | null
  if (!el) throw new Error(`未找到输入 ${name}`)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function chooseFile(name: string, file: File) {
  const input = document.body.querySelector(`input[data-test="${name}"]`) as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
}

async function openDialog() {
  const w = mount(ConfirmationFormDialog, {
    props: { modelValue: true, subjects, proposals: [] },
    attachTo: document.body,
    global: { stubs: { 'router-link': { props: ['to'], template: '<a :data-to="String(to)"><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

/** 填齐登记必填项：主体、来源、编号、交割段；结果状态与依据文件由用例控制。 */
async function fillBasics(w: Awaited<ReturnType<typeof openDialog>>, resultStatus: 'PRE_CLEARED' | 'CLEARED', withFile: boolean) {
  w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'subject')!.vm.$emit('update:modelValue', '3')
  setNativeInput('source-namespace', '昆明交易中心')
  setNativeInput('confirmation-no', 'C-2026-001')
  w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'month')!.vm.$emit('update:modelValue', '2026-10')
  setNativeInput('segment-quantity-0', '150')
  setNativeInput('segment-price-0', '300')
  w.findAllComponents({ name: 'ElRadioGroup' }).find((c) => c.attributes('data-test') === 'result-status')!.vm.$emit('update:modelValue', resultStatus)
  await flushPromises()
  // 文件输入的 data-test（required/optional）随结果状态重渲染，切换后先等一拍再选文件。
  if (withFile) chooseFile(`file-input-${resultStatus === 'CLEARED' ? 'required' : 'optional'}`, new File(['确认单'], '确认单.pdf', { type: 'application/pdf' }))
  await flushPromises()
}

const registerResult = (overrides: Record<string, unknown> = {}) => ({
  confirmationId: 21, revisionNo: 1, resultStatus: 'PRE_CLEARED', businessKeyReplay: false, pendingReview: null,
  contractId: null, linkKind: null, proposalId: null, proposalStatus: null,
  conversion: { months: [], totalDelta: '0', totalUnconverted: '0', lateResult: false },
  deviation: { rows: [], notices: [] }, notices: [],
  ...overrides,
})

describe('确认单登记：结果事实与不双计', () => {
  it('预成交登记成功：只提示保留记录、不入正式持仓；不出现「平台已受理」', async () => {
    hoisted.registerConfirmation.mockResolvedValue(registerResult({ notices: [EXECUTION_NOTICES.preClearedNotFormal] }))
    const w = await openDialog()
    await fillBasics(w, 'PRE_CLEARED', false)
    expect(footerButton('登记').disabled).toBe(false)
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.registerConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      subjectId: 3, sourceNamespace: '昆明交易中心', confirmationNo: 'C-2026-001', resultStatus: 'PRE_CLEARED',
      segments: [{ deliveryMonth: '2026-10', quantity: '150', price: '300' }], file: null,
    }))
    const text = document.body.textContent ?? ''
    expect(text).toContain('只保留记录')
    expect(text).toContain(EXECUTION_NOTICES.preClearedNotFormal)
    // 「平台已受理」只允许出现在否定语境（不等于平台已受理），不能作为宣称出现。
    expect(text).toContain('不等于平台已受理')
    expect(text).not.toMatch(/(?<!不等于)平台已受理/)
  }, FORM_TIMEOUT)

  it('确认成交缺依据文件：登记按钮不可用；附文件后可提交', async () => {
    hoisted.registerConfirmation.mockResolvedValue(registerResult({ resultStatus: 'CLEARED', contractId: 5, linkKind: 'OBLIGATION_CREATED' }))
    const w = await openDialog()
    await fillBasics(w, 'CLEARED', false)
    expect(footerButton('登记').disabled).toBe(true)
    chooseFile('file-input-required', new File(['x'], '确认单.pdf', { type: 'application/pdf' }))
    await flushPromises()
    expect(footerButton('登记').disabled).toBe(false)
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.registerConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      resultStatus: 'CLEARED',
      file: { fileName: '确认单.pdf', contentBase64: 'Zg==', mediaType: 'application/pdf' },
    }))
  }, FORM_TIMEOUT)

  it('同一确认单重复处理（导入后再确认 / 回执超时重试）：链接既有记录、持仓与占用转换只发生一次', async () => {
    hoisted.registerConfirmation.mockResolvedValue(registerResult({
      resultStatus: 'CLEARED', businessKeyReplay: true, contractId: 5, linkKind: 'EXISTING_LINKED',
      proposalId: 8, proposalStatus: 'CLEARED', notices: [EXECUTION_NOTICES.duplicateReplay],
    }))
    const w = await openDialog()
    await fillBasics(w, 'CLEARED', true)
    footerButton('登记').click()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain(EXECUTION_NOTICES.duplicateReplay)
    expect(text).toContain(EXECUTION_NOTICES.linkNoDoubleCount)
    const link = document.body.querySelector('[data-test="register-result"] a')
    expect(link?.getAttribute('data-to')).toBe('/zcqjy/contracts/5')
  }, FORM_TIMEOUT)

  it('来源不支持的产品：填原文登记后停在待核对并展示原文；不提交 productKind', async () => {
    hoisted.registerConfirmation.mockResolvedValue(registerResult({
      resultStatus: 'CLEARED', pendingReview: { reason: 'UNSUPPORTED_PRODUCT', raw: '月内合约转让-X99' }, notices: [EXECUTION_NOTICES.unsupportedProduct],
    }))
    const w = await openDialog()
    await fillBasics(w, 'CLEARED', true)
    w.findAllComponents({ name: 'ElRadioGroup' }).find((c) => c.attributes('data-test') === 'product-mode')!.vm.$emit('update:modelValue', 'UNSUPPORTED')
    await flushPromises()
    setNativeInput('unsupported-product', '月内合约转让-X99')
    // ElInput 的原生 input 事件处理是异步的：设置后等一拍再提交，值才进入表单。
    await flushPromises()
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.registerConfirmation).toHaveBeenCalledTimes(1)
    expect(hoisted.registerConfirmation.mock.calls[0][0]).toMatchObject({ productKind: null, unsupportedProduct: '月内合约转让-X99' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('待核对（来源产品原文：月内合约转让-X99）')
    expect(text).toContain(EXECUTION_NOTICES.unsupportedProduct)
  }, FORM_TIMEOUT)

  it('候选合同主体不一致（SUBJECT_MISMATCH）：提示归属核对、不同主体不共享成交，提交被拒后表单保留', async () => {
    hoisted.registerConfirmation.mockRejectedValue({ failure: { status: 409, errorCode: 'SUBJECT_MISMATCH', message: '合同 7 与确认单的交易主体不一致', details: { reason: 'SUBJECT_MISMATCH', contractIds: [7] } } })
    const w = await openDialog()
    await fillBasics(w, 'CLEARED', true)
    setNativeInput('link-contract', '7')
    await flushPromises()
    footerButton('登记').click()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('拒绝自动关联')
    expect(text).toContain('不共享成交或持仓')
    expect(hoisted.registerConfirmation).toHaveBeenCalledTimes(1)
  }, FORM_TIMEOUT)

  it('占用转换与计划偏差随结果展示：迟到结果照常入账义务、占用保持 0 并提示偏差', async () => {
    hoisted.registerConfirmation.mockResolvedValue(registerResult({
      resultStatus: 'CLEARED', contractId: 6, linkKind: 'OBLIGATION_CREATED',
      conversion: {
        months: [{ deliveryMonth: '2026-10', targetQuantity: '150', previousConvertedQuantity: '0', delta: '0', remainingBefore: null, remainingAfter: null, reason: 'OCCUPATION_NOT_OPEN' }],
        totalDelta: '0', totalUnconverted: '150', lateResult: true,
      },
      deviation: {
        rows: [{ planId: 1, periodType: 'MONTH', periodKey: '2026-10', targetQuantity: '700', soldQuantityBefore: '700', soldComplete: true, confirmedQuantityInPeriod: '150', knownSoldQuantityAfter: '850', remainingPlanQuantityAfter: '-150', completionRateAfter: '1.214286', overPlan: true, verificationStatus: 'VERIFIED' }],
        notices: [],
      },
      // 服务端把偏差与迟到结果的提示合并进响应 notices（_noticesOf）。
      notices: [EXECUTION_NOTICES.lateResult, EXECUTION_NOTICES.overPlan],
    }))
    const w = await openDialog()
    await fillBasics(w, 'CLEARED', true)
    footerButton('登记').click()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('无开放占用（照常入账义务）')
    expect(text).toContain(EXECUTION_NOTICES.lateResult)
    expect(text).toContain('剩余计划待售量')
    expect(text).toContain('-150')
    expect(text).toContain('超计划')
  }, FORM_TIMEOUT)
})

describe('确认单修订：预填与必填原因', () => {
  it('修订模式预填当前版本内容，来源与编号不可改，缺修订原因不能提交', async () => {
    hoisted.reviseConfirmation.mockResolvedValue(registerResult({ confirmationId: 21, revisionNo: 2, resultStatus: 'CLEARED', contractId: 5, linkKind: 'EXISTING_LINKED' }))
    const confirmation = {
      id: 21, rowVersion: 4, subjectId: 3, sourceNamespace: '昆明交易中心', confirmationNo: 'C-2026-001', proposalId: null,
      resultStatus: 'PRE_CLEARED', pendingReview: false, revisions: [{
        id: 1, revisionNo: 1, productKind: 'MONTHLY', tradeMethod: 'BILATERAL', unsupportedProduct: null,
        priceTaxBasis: 'UNKNOWN', priceComponent: 'UNVERIFIED', note: null, segments: [{ id: 1, deliveryMonth: '2026-10', quantity: '150', price: '300' }],
      }],
    } as never
    const w = mount(ConfirmationFormDialog, { props: { modelValue: true, subjects, proposals: [], confirmation }, attachTo: document.body, global: { stubs: { 'router-link': { template: '<a />' } } } })
    await flushPromises()
    expect(document.body.textContent).toContain('修订确认单 #21')
    expect((document.body.querySelector('input[data-test="confirmation-no"]') as HTMLInputElement).disabled).toBe(true)
    expect(footerButton('生成修订版本').disabled).toBe(true)
    setNativeInput('change-reason', '预成交转确认成交')
    w.findAllComponents({ name: 'ElRadioGroup' }).find((c) => c.attributes('data-test') === 'result-status')!.vm.$emit('update:modelValue', 'CLEARED')
    await flushPromises()
    chooseFile('file-input-required', new File(['x'], '正式结果.pdf'))
    await flushPromises()
    expect(footerButton('生成修订版本').disabled).toBe(false)
    footerButton('生成修订版本').click()
    await flushPromises()
    expect(hoisted.reviseConfirmation).toHaveBeenCalledWith(21, expect.objectContaining({ expectedRowVersion: 4, changeReason: '预成交转确认成交', segments: [{ deliveryMonth: '2026-10', quantity: '150', price: '300' }] }))
  }, FORM_TIMEOUT)
})
