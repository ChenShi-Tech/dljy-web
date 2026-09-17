// 公告登记表单的时刻输入（dljy#2973，MT-01）。
// 守什么：Element Plus 的 datetime 选择器只点日期会自动补 00:00（组件测试实测），把「只知道日期」伪装成确切时刻；
//        表单改为日期与时:分分开填写——只填日期不能提交并给出提示，日期与时:分都填才按「YYYY-MM-DD HH:mm」（北京时间）提交，
//        都不填则按未知提交（后端显示待补）。
// 坏掉的症状：公告只写了截止日期，登记后日历里出现一个 00:00 的截止提醒。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { ElDatePicker, ElTimePicker } from 'element-plus'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({ registerWindow: vi.fn(), correctWindow: vi.fn() }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ registerWindow: hoisted.registerWindow, correctWindow: hoisted.correctWindow }))

import WindowFormDialog from './WindowFormDialog.vue'

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

async function openForm() {
  const w = mount(WindowFormDialog, { props: { modelValue: true, window: null, subjects: [] } })
  await flushPromises()
  await w.find('.el-form-item input').setValue('【测试数据】只知道截止日期的公告')
  const closes = w.find('[data-test="declarationClosesAt"]')
  const submit = () => w.findAll('.el-dialog__footer button').find((b) => b.text() === '登记')!
  return { w, closes, submit }
}

// 整个 el-dialog 表单含多组日期/时刻选择器，全量并发跑时挂载较慢；单例放宽超时，不改断言。
const FORM_TIMEOUT = 20000

describe('公告登记表单：申报、确认时间', () => {
  it('只选日期：不能提交并提示须填写时:分，不会以 00:00 提交', async () => {
    const { w, closes, submit } = await openForm()
    closes.findComponent(ElDatePicker).vm.$emit('update:modelValue', '2031-04-20')
    await flushPromises()
    expect(w.find('[data-test="incomplete-time"]').exists()).toBe(true)
    expect(submit().attributes('disabled')).toBeDefined()
    await submit().trigger('click')
    await flushPromises()
    expect(hoisted.registerWindow).not.toHaveBeenCalled()
  }, FORM_TIMEOUT)

  it('日期与时:分都填：按北京时间「YYYY-MM-DD HH:mm」提交；未填的时间按未知提交', async () => {
    hoisted.registerWindow.mockResolvedValue({ windowId: 1, revisionNo: 1 })
    const { w, closes, submit } = await openForm()
    closes.findComponent(ElDatePicker).vm.$emit('update:modelValue', '2031-04-20')
    closes.findComponent(ElTimePicker).vm.$emit('update:modelValue', '17:00')
    await flushPromises()
    expect(w.find('[data-test="incomplete-time"]').exists()).toBe(false)
    await submit().trigger('click')
    await flushPromises()
    expect(hoisted.registerWindow).toHaveBeenCalledWith(expect.objectContaining({ declarationClosesAt: '2031-04-20 17:00', declarationOpensAt: null, confirmationAt: null }))
  }, FORM_TIMEOUT)
})
