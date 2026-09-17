// 公告登记表单的时刻输入（dljy#2973，MT-01）。
// 守什么：Element Plus 的 datetime 选择器只点日期会自动补 00:00（组件测试实测），把「只知道日期」伪装成确切时刻；
//        表单改为日期与时:分分开填写——只填日期不能提交并给出提示，日期与时:分都填才按「YYYY-MM-DD HH:mm」（北京时间）提交，
//        都不填则按未知提交（后端显示待补）。
//        读取附件期间点取消、或关掉后对另一条公告（或同一条公告重新）打开：转换完成后不再写入；写请求返回前关掉重开，旧结果不关新表单、不显示到新表单。
// 坏掉的症状：公告只写了截止日期，登记后日历里出现一个 00:00 的截止提醒；为公告 A 采集的输入被更正到公告 B，或点了取消仍然登记。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { ElDatePicker, ElTimePicker } from 'element-plus'
import { mount } from '@/test/mount'
import type { TradingWindowDetail } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ registerWindow: vi.fn(), correctWindow: vi.fn(), fileToBase64: vi.fn(), warning: vi.fn(), companyRef: null as null | { value: string } }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ registerWindow: hoisted.registerWindow, correctWindow: hoisted.correctWindow }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))
vi.mock('@/services/company/companyContext', async () => {
  const selectedCompanyId = (await import('vue')).ref('comp-a')
  hoisted.companyRef = selectedCompanyId
  return { selectedCompanyId }
})
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import WindowFormDialog from './WindowFormDialog.vue'

afterEach(() => {
  vi.clearAllMocks()
  if (hoisted.companyRef) hoisted.companyRef.value = 'comp-a'
})
enableAutoUnmount(afterEach)

async function openForm() {
  const w = mount(WindowFormDialog, { props: { modelValue: true, window: null, subjects: [] } })
  await flushPromises()
  await w.find('.el-form-item input').setValue('【测试数据】只知道截止日期的公告')
  const closes = w.find('[data-test="declarationClosesAt"]')
  const submit = () => w.findAll('.el-dialog__footer button').find((b) => b.text() === '登记')!
  return { w, closes, submit }
}

/** 待更正的公告（只含表单回填用到的字段）。 */
const windowOf = (id: number, name: string): TradingWindowDetail => ({
  id, rowVersion: 2, currentRevisionNo: 1, companyId: 'comp-a', regionId: 'yunnan', createdAt: '', createdBy: null, proposals: [], events: [], notice: '',
  revisions: [{
    id, revisionNo: 1, announcementName: name, sourceName: null, sourceReference: null, publishedDate: null, announcementVersion: null, effectiveFrom: null, effectiveTo: null,
    applicableScope: null, applicableSubjectIds: [], tradeMethod: null, productKind: null, deliveryStartMonth: null, deliveryEndMonth: null,
    declarationOpensAt: null, declarationClosesAt: null, confirmationAt: null, unsupportedParams: {},
  }],
}) as unknown as TradingWindowDetail

/** 选一个附件并让读取挂起，返回放行函数。 */
async function attachPendingFile(w: ReturnType<typeof mount>) {
  let resolveFile: (v: string) => void = () => {}
  hoisted.fileToBase64.mockImplementation(() => new Promise((resolve) => { resolveFile = resolve }))
  const input = w.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['公告原文'], '公告.pdf', { type: 'application/pdf' })], configurable: true })
  await input.trigger('change')
  return (content = 'Y29udGVudA==') => resolveFile(content)
}
const footerButton = (w: ReturnType<typeof mount>, label: string) => w.findAll('.el-dialog__footer button').find((b) => b.text() === label)!
async function fillChangeReason(w: ReturnType<typeof mount>, reason: string) {
  w.findAllComponents({ name: 'ElFormItem' }).find((item) => item.props('label') === '更正原因')!.findComponent({ name: 'ElInput' }).vm.$emit('update:modelValue', reason)
  await flushPromises()
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

  it('手输日历上不存在的日期（2031-02-30、非闰年 02-29）：即使填了时:分也不能提交，不会被滚成下个月', async () => {
    const { w, closes, submit } = await openForm()
    for (const date of ['2031-02-30', '2031-04-31', '2031-02-29']) {
      closes.findComponent(ElDatePicker).vm.$emit('update:modelValue', date)
      closes.findComponent(ElTimePicker).vm.$emit('update:modelValue', '10:00')
      await flushPromises()
      expect(w.find('[data-test="incomplete-time"]').exists(), date).toBe(true)
      expect(submit().attributes('disabled'), date).toBeDefined()
    }
    closes.findComponent(ElDatePicker).vm.$emit('update:modelValue', '2032-02-29')
    await flushPromises()
    expect(w.find('[data-test="incomplete-time"]').exists(), '2032 闰日合法').toBe(false)
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
  it('带附件登记时读取文件期间切换公司：放弃保存并提示，不发写请求（不会用新公司提交旧公司的公告）', async () => {
    let resolveFile: (v: string) => void = () => {}
    hoisted.fileToBase64.mockImplementation(() => new Promise((resolve) => { resolveFile = resolve }))
    const { w, submit } = await openForm()
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['公告原文'], '公告.pdf', { type: 'application/pdf' })] })
    await input.trigger('change')
    await submit().trigger('click')
    expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
    hoisted.companyRef!.value = 'comp-b'
    resolveFile('Y29udGVudA==')
    await flushPromises()
    expect(hoisted.registerWindow).not.toHaveBeenCalled()
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
    expect(w.text()).toContain('公司或地区已切换，已放弃本次提交')
  }, FORM_TIMEOUT)
})

describe('公告登记表单：关闭或换对象时进行中的保存作废', () => {
  it('读取附件期间点取消：放弃保存，不发写请求', async () => {
    const { w, submit } = await openForm()
    const release = await attachPendingFile(w)
    await submit().trigger('click')
    expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
    await footerButton(w, '取消').trigger('click')
    await w.setProps({ modelValue: false })
    release()
    await flushPromises()
    expect(hoisted.registerWindow).not.toHaveBeenCalled()
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
    expect(hoisted.warning).toHaveBeenCalledWith(expect.stringContaining('已放弃本次保存'))
  }, FORM_TIMEOUT)

  it('读取附件期间关闭并对另一条公告打开更正：不更正到新公告，也不更正到原公告', async () => {
    const w = mount(WindowFormDialog, { props: { modelValue: true, window: windowOf(1, '【测试数据】公告甲'), subjects: [] } })
    await flushPromises()
    await fillChangeReason(w, '【测试数据】更正甲的截止时间')
    const release = await attachPendingFile(w)
    await footerButton(w, '登记更正版本').trigger('click')
    expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, window: windowOf(2, '【测试数据】公告乙') })
    release()
    await flushPromises()
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
    expect(hoisted.registerWindow).not.toHaveBeenCalled()
    expect(w.find('.el-form-item input').element).toHaveProperty('value', '【测试数据】公告乙')
    expect(w.text()).not.toContain('已放弃本次保存')
  }, FORM_TIMEOUT)

  it('读取附件期间关闭后又打开同一条公告：表单已重置，旧的保存同样作废', async () => {
    const window = windowOf(1, '【测试数据】公告甲')
    const w = mount(WindowFormDialog, { props: { modelValue: true, window, subjects: [] } })
    await flushPromises()
    await fillChangeReason(w, '【测试数据】旧的更正原因')
    const release = await attachPendingFile(w)
    await footerButton(w, '登记更正版本').trigger('click')
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true })
    release()
    await flushPromises()
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
  }, FORM_TIMEOUT)

  it('写请求返回前关闭并重开：旧的成功不关闭新表单、不结束新表单的保存中，旧的失败不显示在新表单；正常保存成功即关闭', async () => {
    hoisted.registerWindow.mockResolvedValueOnce({ windowId: 1, revisionNo: 1 })
    const first = await openForm()
    await first.submit().trigger('click')
    await flushPromises()
    expect(first.w.emitted('update:modelValue')).toEqual([[false]])
    first.w.unmount()

    const pending: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = []
    hoisted.correctWindow.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
    const w = mount(WindowFormDialog, { props: { modelValue: true, window: windowOf(1, '【测试数据】公告甲'), subjects: [] } })
    await flushPromises()
    const saveCorrection = async (reason: string) => {
      await fillChangeReason(w, reason)
      await footerButton(w, '登记更正版本').trigger('click')
      await flushPromises()
    }
    const reopen = async (id: number, name: string) => {
      await w.setProps({ modelValue: false })
      await w.setProps({ modelValue: true, window: windowOf(id, name) })
    }
    await saveCorrection('【测试数据】更正甲')
    expect(hoisted.correctWindow).toHaveBeenLastCalledWith(1, expect.objectContaining({ changeReason: '【测试数据】更正甲', expectedRowVersion: 2 }))
    await reopen(2, '【测试数据】公告乙')
    await saveCorrection('【测试数据】更正乙')
    expect(hoisted.correctWindow).toHaveBeenLastCalledWith(2, expect.objectContaining({ changeReason: '【测试数据】更正乙' }))

    pending[0].resolve({ windowId: 1, revisionNo: 2, affectedProposals: [] })
    await flushPromises()
    expect(w.emitted('saved')).toHaveLength(1)
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(footerButton(w, '登记更正版本').classes()).toContain('is-loading')

    await reopen(3, '【测试数据】公告丙')
    pending[1].reject(new Error('【测试数据】公告乙版本冲突'))
    await flushPromises()
    expect(w.text()).not.toContain('【测试数据】公告乙版本冲突')
    expect(hoisted.warning).toHaveBeenCalledWith(expect.stringContaining('【测试数据】公告乙版本冲突'))
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(footerButton(w, '登记更正版本').classes()).not.toContain('is-loading')
  }, FORM_TIMEOUT)

  it('打开期间写入对象被换掉（未重新打开）：点保存与读取附件之后都核对对象，放弃保存', async () => {
    const w = mount(WindowFormDialog, { props: { modelValue: true, window: windowOf(1, '【测试数据】公告甲'), subjects: [] } })
    await flushPromises()
    await fillChangeReason(w, '【测试数据】更正甲')
    const release = await attachPendingFile(w)
    await footerButton(w, '登记更正版本').trigger('click')
    await w.setProps({ window: windowOf(2, '【测试数据】公告乙') })
    release()
    await flushPromises()
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
    expect(w.text()).toContain('已放弃本次保存')

    hoisted.fileToBase64.mockResolvedValue('Y29udGVudA==')
    await footerButton(w, '登记更正版本').trigger('click')
    await flushPromises()
    expect(hoisted.fileToBase64).toHaveBeenCalledTimes(1)
    expect(hoisted.correctWindow).not.toHaveBeenCalled()
  }, FORM_TIMEOUT)
})
