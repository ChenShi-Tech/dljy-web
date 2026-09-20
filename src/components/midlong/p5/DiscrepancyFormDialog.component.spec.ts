// 差异登记对话框（dljy#3016，MR-04）。
// 守什么：只提交比对目标与处理线索（主体/交割月/账单 + 原因/负责人/证据），两侧快照与差值由服务端计算；
//         选主体后按主体取账单候选（综合账单明确标注无可比基础）；结果如实展示量差（外部 − 台账，-20 就是 -20）。
// 坏掉的症状：前端自行算差值并显示；综合账单被当成可比账单提交后报晦涩错误。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ registerDiscrepancy: vi.fn(), fetchBills: vi.fn(), fileToBase64: vi.fn(async (): Promise<string> => 'Zg==') }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({ registerDiscrepancy: hoisted.registerDiscrepancy, fetchBills: hoisted.fetchBills }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import DiscrepancyFormDialog from './DiscrepancyFormDialog.vue'
import { SETTLEMENT_NOTICES } from '@/services/midlong/midlongP5Types'

const FORM_TIMEOUT = 20000
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement

const subjects: MidlongSubject[] = [
  { id: 3, companyId: 'comp-a', regionId: 'yunnan', subjectKey: 'YNGZ-1', displayName: '云南中广核一号', unitCode: null, unitCodeSource: null, verificationNote: null } as MidlongSubject,
]

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open(presetMonth?: string) {
  hoisted.fetchBills.mockResolvedValue({
    rows: [
      { id: 9, billKind: 'ITEMIZED', sourceNamespace: '昆明交易中心', externalBillNo: 'B-2026-001', currentRevisionNo: 1, periodStartMonth: '2026-08', periodEndMonth: '2026-08' },
      { id: 10, billKind: 'UNITEMIZED', sourceNamespace: '昆明交易中心', externalBillNo: 'B-2026-002', currentRevisionNo: 1, periodStartMonth: '2026-08', periodEndMonth: '2026-08' },
    ],
    total: 2, page: 1, pageSize: 100,
  })
  const w = mount(DiscrepancyFormDialog, {
    props: { modelValue: true, subjects, ...(presetMonth ? { presetMonth } : {}) },
    attachTo: document.body,
  })
  await flushPromises()
  return w
}

/** 选主体 → 取账单候选 → 选第一个 ITEMIZED 账单 → 选交割月。 */
async function fillTarget(w: Awaited<ReturnType<typeof open>>) {
  w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'discrepancy-subject')!.vm.$emit('update:modelValue', 3)
  await flushPromises()
  expect(hoisted.fetchBills).toHaveBeenCalledWith({ subjectId: 3, pageSize: 100 })
  w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'discrepancy-bill')!.vm.$emit('update:modelValue', 9)
  w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'month')!.vm.$emit('update:modelValue', '2026-08')
  await flushPromises()
}

describe('差异登记', () => {
  it('选主体后取该主体账单候选（综合账单在候选里标注无可比基础）', async () => {
    const w = await open()
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'discrepancy-subject')!.vm.$emit('update:modelValue', 3)
    await flushPromises()
    // 下拉选项懒渲染不在断言范围：候选按主体过滤 + 固定口径提示（对话框 append-to-body，从 body 读文本）。
    expect(hoisted.fetchBills).toHaveBeenCalledWith({ subjectId: 3, pageSize: 100 })
    const text = document.body.textContent ?? ''
    expect(text).toContain('服务端计算两侧快照')
    expect(text).toContain('综合账单未分项，无可比基础')
  })

  it('提交比对目标与处理线索（不携带任何前端计算的差值）；结果如实展示 -20 与口径', async () => {
    const w = await open()
    await fillTarget(w)
    const reason = document.body.querySelector('textarea[data-test="discrepancy-reason"]') as HTMLTextAreaElement
    reason.value = '计量周期差异待核对'
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(footerButton('登记（不自动改台账）').disabled).toBe(false)

    hoisted.registerDiscrepancy.mockResolvedValue({
      id: 5, quantityDelta: '-20', priceDelta: null, priceComparable: false,
      basis: '外部账单 − 中长期台账（同主体、同交割期、规范单位 MWh；价格须同币种与税口径）',
      comparableSides: ['电量按规范单位 MWh 可比', '含税口径不一致或未知'],
      notices: [SETTLEMENT_NOTICES.discrepancyNoAutoLedger],
    })
    footerButton('登记（不自动改台账）').click()
    await flushPromises()
    expect(hoisted.registerDiscrepancy).toHaveBeenCalledWith({ subjectId: 3, deliveryMonth: '2026-08', billId: 9, reason: '计量周期差异待核对', ownerName: null, evidence: null })
    const result = document.body.querySelector('[data-test="discrepancy-result"]')
    expect(result?.textContent).toContain('-20')
    expect(result?.textContent).toContain('价格不可比')
    expect(result?.textContent).toContain('外部账单 − 中长期台账')
  }, FORM_TIMEOUT)

  it('综合账单 INCOMPLETE_BASIS：提示未分项无可比基础，不误报为系统错误', async () => {
    const w = await open()
    await fillTarget(w)
    hoisted.registerDiscrepancy.mockRejectedValueOnce({
      failure: { status: 422, errorCode: 'INCOMPLETE_BASIS', message: '该账单为综合账单（未分项）', details: { billId: 9, billKind: 'UNITEMIZED' } },
    })
    footerButton('登记（不自动改台账）').click()
    await flushPromises()
    const error = document.body.querySelector('[data-test="discrepancy-form-error"]')
    expect(error?.textContent).toContain('综合账单（未分项）')
    expect(error?.textContent).toContain('无法计算量价差异')
  }, FORM_TIMEOUT)

  it('同一比对目标已有未解决差异 409：提示先处理既有差异（带差异号）', async () => {
    const w = await open()
    await fillTarget(w)
    hoisted.registerDiscrepancy.mockRejectedValueOnce({
      failure: { status: 409, errorCode: 'DISCREPANCY_ALREADY_OPEN', message: '已有未解决的差异', details: { discrepancyId: 5 } },
    })
    footerButton('登记（不自动改台账）').click()
    await flushPromises()
    const error = document.body.querySelector('[data-test="discrepancy-form-error"]')
    expect(error?.textContent).toContain('请先处理既有差异')
    expect(error?.textContent).toContain('#5')
  }, FORM_TIMEOUT)
})
