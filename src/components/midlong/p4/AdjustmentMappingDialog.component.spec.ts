// 外部产品映射登记（dljy#3014，MA-02 / 11.1 工程部分）。
// 守什么：来源+产品代码+类型+方向+依据缺一不可；既有映射列表可见（同键按新依据修正、键不可改）；
//        保存的是「方向的合法来源」，不是从字样推断。
// 坏掉的症状：无依据的映射被保存；操作者看不到已有映射、重复登记相互覆盖而无痕。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({ registerMapping: vi.fn(), fetchMappings: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({ registerMapping: hoisted.registerMapping, fetchMappings: hoisted.fetchMappings }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import AdjustmentMappingDialog from './AdjustmentMappingDialog.vue'
import { ADJUSTMENT_NOTICES } from '@/services/midlong/midlongP4Types'

const TIMEOUT = 20000
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
function setNativeInput(name: string, value: string) {
  const el = document.body.querySelector(`input[data-test="${name}"]`) as HTMLInputElement | null
  if (!el) throw new Error(`未找到输入 ${name}`)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

describe('映射登记', () => {
  it('既有映射可见；来源/代码/方向/依据不全不能保存；补齐后按核验单据方向保存', async () => {
    hoisted.fetchMappings.mockResolvedValue({
      rows: [{ id: 1, sourceNamespace: '昆明交易中心', externalProductCode: '年度转让', adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE', basisNote: '交易细则附则二；核对人：业务一组', rowVersion: 1, createdAt: '', createdBy: 'u', updatedAt: '', updatedBy: null }],
      notice: ADJUSTMENT_NOTICES.directionNoInference,
    })
    hoisted.registerMapping.mockResolvedValue({ mappingId: 2, updated: false, rowVersion: 1, notice: ADJUSTMENT_NOTICES.directionNoInference })
    const w = mount(AdjustmentMappingDialog, { props: { modelValue: true }, attachTo: document.body })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('昆明交易中心 / 年度转让')
    expect(text).toContain('我方义务减少')
    expect(text).toContain('交易细则附则二')
    expect(footerButton('保存映射').disabled).toBe(true)

    setNativeInput('mapping-source', '昆明交易中心')
    setNativeInput('mapping-product-code', '月内合约转让-X99')
    const basis = document.body.querySelector('textarea[data-test="mapping-basis"]') as HTMLTextAreaElement
    basis.value = '《月内交易细则》第 5 条：受让后我方义务减少（附件转让细则 v3）'
    basis.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    // 只差方向仍不可保存。
    expect(footerButton('保存映射').disabled).toBe(true)
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'mapping-direction')!.vm.$emit('update:modelValue', 'OBLIGATION_DECREASE')
    w.findAllComponents({ name: 'ElSelect' }).find((c) => c.attributes('data-test') === 'mapping-type')!.vm.$emit('update:modelValue', 'TRANSFER')
    await flushPromises()
    expect(footerButton('保存映射').disabled).toBe(false)
    footerButton('保存映射').click()
    await flushPromises()
    expect(hoisted.registerMapping).toHaveBeenCalledWith(expect.objectContaining({
      sourceNamespace: '昆明交易中心', externalProductCode: '月内合约转让-X99',
      adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE',
      basisNote: '《月内交易细则》第 5 条：受让后我方义务减少（附件转让细则 v3）',
    }))
  }, TIMEOUT)
})
