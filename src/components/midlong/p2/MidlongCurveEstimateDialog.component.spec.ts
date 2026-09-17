// 分时估算对话框的交互不变量（dljy#2971，MP-04）。
// 守什么：点覆盖月份的清除按钮（Element Plus 回传 null）不报错，按「未选覆盖月份」提示且不能提交。
// 坏掉的症状：清除月份后对话框渲染报错、按钮与提示失效。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({ createCurveEstimate: vi.fn() }))

vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure }))
vi.mock('@/services/midlong/midlongP2Api', () => ({ createCurveEstimate: hoisted.createCurveEstimate }))

import MidlongCurveEstimateDialog from './MidlongCurveEstimateDialog.vue'

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('分时估算对话框', () => {
  it('点覆盖月份的清除按钮（值变为 null）：不报错，提示请选择覆盖月份且不能提交', async () => {
    const w = mount(MidlongCurveEstimateDialog, { props: { modelValue: false, contractId: 7, revisionNo: 1, deliveryStart: '2027-05-01' }, global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } } })
    await w.setProps({ modelValue: true })
    await nextTick()
    const vm = w.vm as unknown as { form: { coverage: unknown; note: string } }
    expect(vm.form.coverage).toEqual(['2027-05', '2027-05'])
    vm.form.note = '【测试】均分参考'
    const range = w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'monthrange')!
    range.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(vm.form.coverage).toEqual([])
    expect(w.text()).toContain('请选择覆盖月份')
    expect(w.findAll('button').find((b) => b.text() === '生成估算草稿')!.attributes('disabled')).toBeDefined()
    expect(hoisted.createCurveEstimate).not.toHaveBeenCalled()
  })
})
