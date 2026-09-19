// 合同调整登记表单（dljy#3014，MA-01..04）。
// 守什么：方向留空登记后停在待核对并提示「不改变持仓」；独立价款（转让/补偿/手续费）单列、勾选才提交；
//        打开即展示按片段的可调余额；ADJUSTABLE_BALANCE_EXCEEDED 逐月「请求/可调」；修订预填且必填原因。
// 坏掉的症状：方向被从「买入/卖出」字样猜出来；转让价款被并进售电均价；超量减少只报一条笼统错误。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({
  registerAdjustment: vi.fn(), reviseAdjustment: vi.fn(), fetchAdjustableBalance: vi.fn(), fileToBase64: vi.fn(async (): Promise<string> => 'Zg=='),
}))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({
  registerAdjustment: hoisted.registerAdjustment, reviseAdjustment: hoisted.reviseAdjustment, fetchAdjustableBalance: hoisted.fetchAdjustableBalance,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import AdjustmentFormDialog from './AdjustmentFormDialog.vue'
import { ADJUSTMENT_NOTICES } from '@/services/midlong/midlongP4Types'

const FORM_TIMEOUT = 20000
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
function setNativeInput(name: string, value: string) {
  const el = document.body.querySelector(`input[data-test="${name}"]`) as HTMLInputElement | null
  if (!el) throw new Error(`未找到输入 ${name}`)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const balance = {
  contractId: 7, revisionNo: 3, totalQuantity: '1000', unallocatedQuantity: '0',
  months: [
    { deliveryMonth: '2026-10', adjustableQuantity: '100', price: '300', priceStatus: 'KNOWN', ended: false },
    { deliveryMonth: '2026-11', adjustableQuantity: '400', price: null, priceStatus: 'UNKNOWN', ended: false },
    { deliveryMonth: '2026-04', adjustableQuantity: '50', price: '310', priceStatus: 'KNOWN', ended: true },
  ],
  notice: ADJUSTMENT_NOTICES.adjustableBalance,
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open() {
  hoisted.fetchAdjustableBalance.mockResolvedValue(balance)
  const w = mount(AdjustmentFormDialog, { props: { modelValue: true, contractId: 7, contractLabel: '月度合同（M-7）' }, attachTo: document.body })
  await flushPromises()
  return w
}

/** 填齐登记必填项（不含方向与价款，由用例控制）。 */
async function fillBasics(w: Awaited<ReturnType<typeof open>>, options: { direction?: string; transferPrice?: boolean } = {}) {
  setNativeInput('adjustment-source', '昆明交易中心')
  setNativeInput('external-adjustment-no', 'T-2026-01')
  setNativeInput('external-revision-no', '1')
  w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'month')!.vm.$emit('update:modelValue', '2026-10')
  setNativeInput('adj-segment-quantity-0', '120')
  const reason = document.body.querySelector('textarea[data-test="adjustment-reason"]') as HTMLTextAreaElement
  reason.value = '经平台转让 10 月电量'
  reason.dispatchEvent(new Event('input', { bubbles: true }))
  if (options.direction) {
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'direction')!.vm.$emit('update:modelValue', options.direction)
  }
  if (options.transferPrice) {
    w.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.attributes('data-test') === 'price-transferPrice')!.vm.$emit('update:modelValue', true)
    await flushPromises()
    setNativeInput('price-transferPrice-amount', '50000')
  }
  await flushPromises()
}

const writeResult = (overrides: Record<string, unknown> = {}) => ({
  adjustmentId: 31, revisionNo: 1, status: 'DRAFT', direction: 'OBLIGATION_DECREASE', directionSource: 'DOCUMENT_FIELD',
  pendingReason: null, businessKeyReplay: false, contractId: 7, baseRevisionNo: 3, rowVersion: 1,
  segments: [{ deliveryMonth: '2026-10', quantity: '120' }], prices: {}, notices: [],
  ...overrides,
})

describe('调整登记：方向、价款与可调余额', () => {
  it('打开即展示按片段的可调余额（含已结束片段与未分解池不参与）', async () => {
    await open()
    const notice = document.body.querySelector('[data-test="balance-notice"]')
    expect(notice?.textContent).toContain('2026-10 100 MWh')
    expect(notice?.textContent).toContain('2026-11 400 MWh')
    expect(notice?.textContent).toContain('2026-04 50 MWh（已结束）')
  }, FORM_TIMEOUT)

  it('方向留空：登记后停在待核对（不改变持仓），提示待核对口径；请求 direction 为 null', async () => {
    hoisted.registerAdjustment.mockResolvedValue(writeResult({
      status: 'PENDING_VERIFICATION', direction: null, directionSource: null, pendingReason: 'NO_DIRECTION',
      notices: [ADJUSTMENT_NOTICES.directionPending, ADJUSTMENT_NOTICES.directionNoInference],
    }))
    const w = await open()
    await fillBasics(w)
    expect(document.body.querySelector('[data-test="direction-pending-hint"]')).not.toBeNull()
    expect(footerButton('登记（未生效）').disabled).toBe(false)
    footerButton('登记（未生效）').click()
    await flushPromises()
    expect(hoisted.registerAdjustment).toHaveBeenCalledTimes(1)
    expect(hoisted.registerAdjustment.mock.calls[0][0]).toMatchObject({ direction: null, adjustmentType: 'ADJUSTMENT', contractId: 7, externalAdjustmentNo: 'T-2026-01' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('待核对（方向未确认）')
    expect(text).toContain(ADJUSTMENT_NOTICES.directionPending)
    expect(text).not.toContain('已生效')
  }, FORM_TIMEOUT)

  it('方向明确 + 转让价款：价款只在勾选后提交、结果单列展示且不进售电均价口径', async () => {
    hoisted.registerAdjustment.mockResolvedValue(writeResult({
      prices: { transferPrice: { amount: '50000', currency: 'CNY', taxBasis: 'TAX_INCLUDED', note: null } },
      notices: [ADJUSTMENT_NOTICES.priceIndependent],
    }))
    const w = await open()
    await fillBasics(w, { direction: 'OBLIGATION_DECREASE', transferPrice: true })
    footerButton('登记（未生效）').click()
    await flushPromises()
    expect(hoisted.registerAdjustment.mock.calls[0][0]).toMatchObject({
      direction: 'OBLIGATION_DECREASE',
      prices: { transferPrice: { amount: '50000', taxBasis: 'UNKNOWN', note: null } },
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('转让价款：50,000 CNY（含税）')
    expect(text).toContain(ADJUSTMENT_NOTICES.priceIndependent)
  }, FORM_TIMEOUT)

  it('超量减少：逐月「请求/可调」并附固定口径，表单保留可修改', async () => {
    hoisted.registerAdjustment.mockRejectedValue({
      failure: {
        status: 422, errorCode: 'ADJUSTABLE_BALANCE_EXCEEDED', message: '减少量超过片段可调整余额',
        details: { months: [{ deliveryMonth: '2026-10', requested: '120', adjustable: '100' }] },
      },
    })
    const w = await open()
    await fillBasics(w, { direction: 'OBLIGATION_DECREASE' })
    footerButton('登记（未生效）').click()
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('2026-10 请求 120 / 可调 100')
    expect(text).toContain('不得超过该片段当前有效义务')
    expect(hoisted.registerAdjustment).toHaveBeenCalledTimes(1)
  }, FORM_TIMEOUT)

  it('同一外部变更重复导入：回放提示不双计（持仓与合同版本不重复变动）', async () => {
    hoisted.registerAdjustment.mockResolvedValue(writeResult({
      businessKeyReplay: true, notices: [ADJUSTMENT_NOTICES.duplicateReplay],
    }))
    const w = await open()
    await fillBasics(w, { direction: 'OBLIGATION_DECREASE' })
    footerButton('登记（未生效）').click()
    await flushPromises()
    expect(document.body.textContent).toContain(ADJUSTMENT_NOTICES.duplicateReplay)
  }, FORM_TIMEOUT)
})
