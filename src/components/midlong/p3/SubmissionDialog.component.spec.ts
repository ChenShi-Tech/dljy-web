// 外部提交登记表单的时刻输入（dljy#2973，MT-02）。
// 守什么：外部提交时间只选日期时不能登记（不把未知时刻默认成 00:00）；日期与时:分都填才提交；登记结果不称平台已受理。
//        读取回执文件期间点取消、或关掉后对另一条提交打开「补充回执」：转换完成后不再写入；写请求返回前关掉重开，旧结果不显示到新表单。
// 坏掉的症状：只记得提交日期的操作被登记成当天 00:00 提交；旧回执文件被挂到另一条提交上，或点了取消仍然补了回执。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { ElDatePicker, ElTimePicker } from 'element-plus'
import { mount } from '@/test/mount'
import type { TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ registerSubmission: vi.fn(), addReceipt: vi.fn(), fileToBase64: vi.fn(), warning: vi.fn(), companyRef: null as null | { value: string } }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ registerSubmission: hoisted.registerSubmission, addReceipt: hoisted.addReceipt }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import SubmissionDialog from './SubmissionDialog.vue'

afterEach(() => {
  vi.clearAllMocks()
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
  document.body.innerHTML = ''
})
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
  it('补回执时读取回执文件期间切换公司：放弃提交并提示，不发写请求（不会用新公司补旧公司的回执）', async () => {
    let resolveFile: (v: string) => void = () => {}
    hoisted.fileToBase64.mockImplementation(() => new Promise((resolve) => { resolveFile = resolve }))
    const submission = { id: 9, proposalId: 42 } as never
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'receipt', proposal, submission }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector('input[data-test="receipt-file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['回执'], '回执.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    const button = [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '登记') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await flushPromises()
    expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
    hoisted.companyRef!.value = 'comp-b'
    resolveFile('cmVjZWlwdA==')
    await flushPromises()
    expect(hoisted.addReceipt).not.toHaveBeenCalled()
    expect(hoisted.registerSubmission).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('公司或地区已切换，已放弃本次提交')
    w.unmount()
  }, FORM_TIMEOUT)
})

/** 补回执：选一个回执文件并让读取挂起，点「登记」，返回放行函数。 */
async function saveReceiptWithPendingFile() {
  let resolveFile: (v: string) => void = () => {}
  hoisted.fileToBase64.mockImplementation(() => new Promise((resolve) => { resolveFile = resolve }))
  const input = document.body.querySelector('input[data-test="receipt-file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File(['回执'], '回执.png', { type: 'image/png' })], configurable: true })
  input.dispatchEvent(new Event('change'))
  await flushPromises()
  footerButton('登记').click()
  await flushPromises()
  expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
  return () => resolveFile('cmVjZWlwdA==')
}
const footerButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
const submissionOf = (id: number) => ({ id, proposalId: 42 }) as never

describe('补充回执：关闭或换对象时进行中的保存作废', () => {
  it('读取回执文件期间点取消：放弃保存，不发写请求', async () => {
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'receipt', proposal, submission: submissionOf(9) }, attachTo: document.body })
    await flushPromises()
    const release = await saveReceiptWithPendingFile()
    footerButton('取消').click()
    await w.setProps({ modelValue: false })
    release()
    await flushPromises()
    expect(hoisted.addReceipt).not.toHaveBeenCalled()
    expect(hoisted.registerSubmission).not.toHaveBeenCalled()
    expect(w.emitted('saved')).toBeUndefined()
    expect(hoisted.warning).toHaveBeenCalledWith(expect.stringContaining('已放弃本次保存'))
    w.unmount()
  }, FORM_TIMEOUT)

  it('读取回执文件期间关闭并对另一条提交打开补充回执：不补到新提交，也不补到原提交', async () => {
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'receipt', proposal, submission: submissionOf(9) }, attachTo: document.body })
    await flushPromises()
    const release = await saveReceiptWithPendingFile()
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, submission: submissionOf(10) })
    release()
    await flushPromises()
    expect(hoisted.addReceipt).not.toHaveBeenCalled()
    expect(hoisted.registerSubmission).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('已放弃本次保存')
    w.unmount()
  }, FORM_TIMEOUT)

  it('读取回执文件期间关闭后在同一方案上改为登记外部提交：旧回执不会随提交登记写入', async () => {
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'receipt', proposal, submission: submissionOf(9) }, attachTo: document.body })
    await flushPromises()
    const release = await saveReceiptWithPendingFile()
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, mode: 'submission', submission: null })
    release()
    await flushPromises()
    expect(hoisted.registerSubmission).not.toHaveBeenCalled()
    expect(hoisted.addReceipt).not.toHaveBeenCalled()
    w.unmount()
  }, FORM_TIMEOUT)

  it('写请求返回前关闭并对另一条提交打开：旧结果不显示在新表单，新表单可以继续保存', async () => {
    let resolveWrite: (v: unknown) => void = () => {}
    hoisted.addReceipt.mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve }))
    hoisted.fileToBase64.mockResolvedValue('cmVjZWlwdA==')
    const w = mount(SubmissionDialog, { props: { modelValue: true, mode: 'receipt', proposal, submission: submissionOf(9) }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector('input[data-test="receipt-file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['回执'], '回执.png', { type: 'image/png' })], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    footerButton('登记').click()
    await flushPromises()
    expect(hoisted.addReceipt).toHaveBeenCalledWith(9, expect.objectContaining({ file: expect.objectContaining({ fileName: '回执.png' }) }))
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, submission: submissionOf(10) })
    resolveWrite({ submissionId: 9, receiptCompleteness: 'PARTIAL', receiptMissing: ['externalReference', 'receiptAt'] })
    await flushPromises()
    expect(w.emitted('saved')).toEqual([[42]])
    expect(document.body.textContent).not.toContain('登记完成')
    expect(footerButton('登记')).toBeDefined()
    expect(footerButton('登记').classList.contains('is-loading')).toBe(false)
    w.unmount()
  }, FORM_TIMEOUT)
})
