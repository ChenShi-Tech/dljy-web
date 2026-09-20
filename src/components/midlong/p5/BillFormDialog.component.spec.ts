// 外部账单登记 / 修订表单（dljy#3016，MR-03）。
// 守什么：UNITEMIZED 不提供分项输入且提交 lineItems 恒为空数组（服务端 422 双保险）；ITEMIZED 至少一条
//        且每行电量/金额至少一项；修订必填原因并带 expectedRowVersion；DUPLICATE_BILL_CONTENT 引导走修订。
// 坏掉的症状：综合账单带着猜的分项进中长期金额；同号更正被当成新账单重复累计两版金额。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { BillDetailDto } from '@/services/midlong/midlongP5Types'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({
  registerBill: vi.fn(), reviseBill: vi.fn(), fileToBase64: vi.fn(async (): Promise<string> => 'Zg=='),
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({ registerBill: hoisted.registerBill, reviseBill: hoisted.reviseBill }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import BillFormDialog from './BillFormDialog.vue'
import { SETTLEMENT_NOTICES } from '@/services/midlong/midlongP5Types'

const FORM_TIMEOUT = 20000
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
function setNativeInput(name: string, value: string) {
  const el = document.body.querySelector(`input[data-test="${name}"]`) as HTMLInputElement | null
  if (!el) throw new Error(`未找到输入 ${name}`)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const subjects: MidlongSubject[] = [
  { id: 3, companyId: 'comp-a', regionId: 'yunnan', subjectKey: 'YNGZ-1', displayName: '云南中广核一号', unitCode: null, unitCodeSource: null, verificationNote: null } as MidlongSubject,
]

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function openRegister() {
  const w = mount(BillFormDialog, { props: { modelValue: true, subjects }, attachTo: document.body })
  await flushPromises()
  return w
}

/** 填齐登记必填项（不含分项与形态，由用例控制）。 */
async function fillBasics(w: Awaited<ReturnType<typeof openRegister>>) {
  w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'bill-subject')!.vm.$emit('update:modelValue', 3)
  setNativeInput('bill-source', '昆明交易中心')
  setNativeInput('bill-no', 'B-2026-001')
  const pickers = w.findAllComponents({ name: 'ElDatePicker' }).filter((c) => c.props('placeholder') === 'YYYY-MM')
  expect(pickers.length).toBe(2)
  pickers[0]!.vm.$emit('update:modelValue', '2026-08')
  pickers[1]!.vm.$emit('update:modelValue', '2026-08')
  setNativeInput('bill-amount', '144000')
  await flushPromises()
}

describe('账单登记：分项边界与形态', () => {
  it('UNITEMIZED：不提供分项输入并展示未分项归档口径；提交 lineItems 恒为空数组', async () => {
    const w = await openRegister()
    await fillBasics(w)
    w.findAllComponents({ name: 'ElRadio' }).find((c) => c.props('value') === undefined || true) // radio value 不透传，改用点击
    const unitemizedRadio = [...document.body.querySelectorAll('.el-radio')].find((r) => r.textContent?.includes('综合账单')) as HTMLElement
    unitemizedRadio.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-test="unitemized-hint"]')?.textContent).toContain('不对综合总额做任何比例拆分或推算')
    expect(document.body.querySelector('input[data-test="bill-item-quantity-0"]')).toBeNull()
    expect(footerButton('登记').disabled).toBe(false)

    hoisted.registerBill.mockResolvedValue({ billId: 9, revisionNo: 1, businessKeyReplay: false, billKind: 'UNITEMIZED', amount: '500000', notices: [SETTLEMENT_NOTICES.unitemizedArchive] })
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.registerBill.mock.calls[0][0]).toMatchObject({ billKind: 'UNITEMIZED', lineItems: [], amount: '144000', currency: 'CNY' })
  }, FORM_TIMEOUT)

  it('ITEMIZED：每行电量/金额至少一项（空行阻止提交），交割月可空 = 期间合计行', async () => {
    const w = await openRegister()
    await fillBasics(w)
    setNativeInput('bill-item-quantity-0', '980')
    setNativeInput('bill-item-price-0', '300')
    // 添加一行空行：既无电量也无金额 → 提交不可用。
    ;([...document.body.querySelectorAll('[data-test="bill-add-item"]')][0] as HTMLElement).click()
    await flushPromises()
    expect(footerButton('登记').disabled).toBe(true)
    // 空行只填金额（交割月留空 = 期间合计行）→ 可提交，deliveryMonth 提交 null。
    setNativeInput('bill-item-amount-1', '1000')
    await flushPromises()
    expect(footerButton('登记').disabled).toBe(false)

    hoisted.registerBill.mockResolvedValue({ billId: 9, revisionNo: 1, businessKeyReplay: false, billKind: 'ITEMIZED', amount: '144000', notices: [] })
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.registerBill.mock.calls[0][0].lineItems).toEqual([
      { deliveryMonth: null, quantity: '980', price: '300', amount: null, note: null },
      { deliveryMonth: null, quantity: null, price: null, amount: '1000', note: null },
    ])
  }, FORM_TIMEOUT)

  it('登记重复：同号异内容 409 DUPLICATE_BILL_CONTENT 引导以修订版本提交', async () => {
    const w = await openRegister()
    await fillBasics(w)
    setNativeInput('bill-item-quantity-0', '980')
    await flushPromises()
    expect(footerButton('登记').disabled).toBe(false)
    hoisted.registerBill.mockRejectedValueOnce({
      failure: { status: 409, errorCode: 'DUPLICATE_BILL_CONTENT', message: '同一外部账单编号已登记不同内容', details: { billId: 9, currentRevisionNo: 2 } },
    })
    footerButton('登记').click()
    await flushPromises()
    const error = document.body.querySelector('[data-test="bill-form-error"]')
    expect(error?.textContent).toContain('请以修订版本提交')
    expect(error?.textContent).toContain('#9')
    expect(error?.textContent).toContain('v2')
  }, FORM_TIMEOUT)

  it('修订模式：业务键不可改、必填修订原因并带 expectedRowVersion；旧版保留与差异重核在结果中提示', async () => {
    const bill = {
      id: 9, subjectId: 3, subjectName: '云南中广核一号', sourceNamespace: '昆明交易中心', externalBillNo: 'B-2026-001',
      currentRevisionNo: 1, revisionCount: 1, rowVersion: 4, billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: null,
      periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'TAX_INCLUDED', amount: '144000',
      lineItemCount: 1, lineItemQuantity: '980', lineItemAmount: '294000', voucherCount: 0, voucherAmount: null,
      openDiscrepancyCount: 1, recheckDiscrepancyCount: 0, createdAt: '', updatedAt: '', companyId: 'comp-a', regionId: 'yunnan',
      revisions: [{
        id: 1, revisionNo: 1, supersedesRevisionNo: null, billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: null,
        periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'UNVERIFIED',
        amount: '144000', note: null, changeReason: null, attachmentId: null, lineItemQuantity: '980', lineItemAmount: '294000',
        lineItems: [{ id: 1, deliveryMonth: '2026-08', quantity: '980', price: '300', amount: '294000', note: null }],
        recordedAt: '', recordedBy: null,
      }],
      vouchers: [], discrepancies: [], events: [], notices: [],
    } as unknown as BillDetailDto
    mount(BillFormDialog, { props: { modelValue: true, subjects, bill }, attachTo: document.body })
    await flushPromises()
    // 预填当前版本；业务键与主体禁用。
    expect((document.body.querySelector('input[data-test="bill-no"]') as HTMLInputElement).disabled).toBe(true)
    expect((document.body.querySelector('input[data-test="bill-amount"]') as HTMLInputElement).value).toBe('144000')
    // 未填修订原因：不可提交。
    expect(footerButton('生成修订版本').disabled).toBe(true)
    setNativeInput('bill-change-reason', '收到更正版本 R2')
    setNativeInput('bill-item-quantity-0', '960')
    await flushPromises()
    expect(footerButton('生成修订版本').disabled).toBe(false)

    hoisted.reviseBill.mockResolvedValue({
      billId: 9, revisionNo: 2, businessKeyReplay: false,
      recheckedDiscrepancies: [{ discrepancyId: 5, deliveryMonth: '2026-08', wasResolved: false }],
      notices: [SETTLEMENT_NOTICES.billRevisionRecheck],
    })
    footerButton('生成修订版本').click()
    await flushPromises()
    expect(hoisted.reviseBill).toHaveBeenCalledWith(9, expect.objectContaining({ expectedRowVersion: 4, changeReason: '收到更正版本 R2' }))
    expect(hoisted.reviseBill.mock.calls[0][1].lineItems).toEqual([{ deliveryMonth: '2026-08', quantity: '960', price: '300', amount: '294000', note: null }])
    const result = document.body.querySelector('[data-test="bill-revise-result"]')
    expect(result?.textContent).toContain('旧版保留')
    expect(result?.textContent).toContain('#5')
    expect(result?.textContent).toContain('需重新核对')
  }, FORM_TIMEOUT)
})
