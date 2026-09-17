// 外部提交登记表单的时刻输入（dljy#2973，MT-02）。
// 守什么：外部提交时间只选日期时不能登记（不把未知时刻默认成 00:00）；日期与时:分都填才提交；登记结果不称平台已受理。
// 坏掉的症状：只记得提交日期的操作被登记成当天 00:00 提交。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { ElDatePicker, ElTimePicker } from 'element-plus'
import { mount } from '@/test/mount'
import type { TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ registerSubmission: vi.fn(), addReceipt: vi.fn() }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ registerSubmission: hoisted.registerSubmission, addReceipt: hoisted.addReceipt }))

import SubmissionDialog from './SubmissionDialog.vue'

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

const proposal = { id: 42, rowVersion: 3 } as TradeProposalDetail

// 整个 el-dialog 表单含多组日期/时刻选择器，全量并发跑时挂载较慢；单例放宽超时，不改断言。
const FORM_TIMEOUT = 20000

describe('外部提交登记：提交时间', () => {
  it('只选日期不能登记；补上时:分后按北京时间提交，结果提示依据待补且不称受理', async () => {
    hoisted.registerSubmission.mockResolvedValue({ proposalId: 42, submissionId: 1, status: 'SUBMITTED', rowVersion: 4, receiptCompleteness: 'NONE', receiptMissing: ['externalReference', 'receiptAt', 'attachment'], platformAcceptance: 'NOT_ASSERTED', notice: '' })
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'submission', proposal, submission: null }, attachTo: document.body })
    await flushPromises()
    // 对话框挂到 body（append-to-body），按组件树取输入：第一个日期/时刻输入是外部提交时间，操作人按表单项标签找。
    const dialog = () => document.body
    const operator = w.findAllComponents({ name: 'ElFormItem' }).find((item) => item.props('label') === '外部操作人')!
    operator.findComponent({ name: 'ElInput' }).vm.$emit('update:modelValue', '测试交易员')
    w.findAllComponents(ElDatePicker)[0].vm.$emit('update:modelValue', '2026-09-01')
    await flushPromises()
    const button = () => [...dialog().querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '登记') as HTMLButtonElement
    expect(dialog().querySelector('[data-test="incomplete-time"]')).not.toBeNull()
    expect(button().disabled).toBe(true)
    w.findAllComponents(ElTimePicker)[0].vm.$emit('update:modelValue', '10:30')
    await flushPromises()
    expect(button().disabled).toBe(false)
    button().click()
    await flushPromises()
    expect(hoisted.registerSubmission).toHaveBeenCalledWith(42, expect.objectContaining({ submittedAt: '2026-09-01 10:30', submittedByName: '测试交易员' }))
    expect(dialog().textContent).toContain('无回执（仅登记提交事实）')
    expect(dialog().textContent).not.toMatch(/平台已受理(?!，也不形成持仓)/)
  }, FORM_TIMEOUT)
})
