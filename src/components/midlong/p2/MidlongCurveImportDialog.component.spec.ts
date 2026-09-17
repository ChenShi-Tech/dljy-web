// 分时曲线导入对话框的交互不变量（dljy#2971，MP-04）。
// 守什么：原始时区、单位、粒度必须显式选择，未选时不能提交（不默认北京时间）；模板容差与尾差规则公示；
// 保存草稿后逐月给出曲线合计与正式月度分解，不守恒标「不缩放」，并明确草稿不计入分时持仓。
// 坏掉的症状：未声明时区就按本地时间入库；不守恒的曲线被自动缩放；用户以为保存即生效。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'

const hoisted = vi.hoisted(() => ({ createCurveDraft: vi.fn(), fileToBase64: vi.fn(async () => 'Zg=='), warning: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure }))
vi.mock('@/services/midlong/midlongP2Api', () => ({ createCurveDraft: hoisted.createCurveDraft, fetchCurveTemplate: vi.fn() }))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: hoisted.fileToBase64 }))

import MidlongCurveImportDialog from './MidlongCurveImportDialog.vue'
import { STALE_DIALOG_WRITE_MESSAGE } from '@/services/midlong/midlongP2Session'

const STUBS = { 'router-link': { props: ['to'], template: '<a :data-to="to"><slot /></a>' } }

async function open() {
  const w = mount(MidlongCurveImportDialog, { props: { modelValue: false, contractId: 7, revisionNo: 2, deliveryStart: '2027-02-01', deliveryEnd: '2027-03-31', evidence: [] }, global: { stubs: STUBS } })
  await w.setProps({ modelValue: true })
  await nextTick()
  return w
}

type DialogVm = { files: Record<string, File | null>; form: { granularityMinutes: number | null; unit: string; sourceTimezone: string; coverage: string[] } }

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('分时曲线导入', () => {
  it('读取曲线文件期间关闭，或关闭后重开到另一份合同：读完不发写请求并提示放弃；新会话照常写到新合同', async () => {
    const w = await open()
    const vm = w.vm as unknown as DialogVm
    const fill = async () => {
      vm.files.workbook = new File(['x'], 'TEST-曲线.xlsx')
      Object.assign(vm.form, { granularityMinutes: 60, unit: 'MWh', sourceTimezone: 'Asia/Shanghai' })
      await nextTick()
    }
    const pendingRead = () => {
      let resolveRead: (v: string) => void = () => {}
      hoisted.fileToBase64.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve }))
      return (v: string) => resolveRead(v)
    }
    const submit = () => w.findAll('button').find((b) => b.text() === '保存草稿并校验')!.trigger('click')

    await fill()
    let finishRead = pendingRead()
    await submit()
    await w.setProps({ modelValue: false })
    finishRead('Zg==')
    await flushPromises()
    expect(hoisted.createCurveDraft).not.toHaveBeenCalled()

    await w.setProps({ modelValue: true })
    await nextTick()
    await fill()
    finishRead = pendingRead()
    await submit()
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, contractId: 8, revisionNo: 5 })
    await nextTick()
    finishRead('Zg==')
    await flushPromises()
    expect(hoisted.createCurveDraft).not.toHaveBeenCalled()
    expect(hoisted.warning).toHaveBeenCalledWith(STALE_DIALOG_WRITE_MESSAGE)
    expect(hoisted.warning).toHaveBeenCalledTimes(2)

    hoisted.createCurveDraft.mockResolvedValue({ curveSetId: 40, setNo: 1, status: 'DRAFT', revisionNo: 5, validation: { blocking: false, blockingCount: 0, warningCount: 0, completeness: 'COMPLETE', summary: [], months: [] } })
    await fill()
    await submit()
    await flushPromises()
    expect(hoisted.createCurveDraft).toHaveBeenCalledTimes(1)
    expect(hoisted.createCurveDraft).toHaveBeenCalledWith(8, expect.objectContaining({ expectedRevisionNo: 5 }))
  })

  it('点覆盖月份的清除按钮（值变为 null）：不报错，提示补充覆盖月份且不能提交', async () => {
    const w = await open()
    const range = w.findAllComponents({ name: 'ElDatePicker' }).find((c) => c.props('type') === 'monthrange')!
    range.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect((w.vm as unknown as DialogVm).form.coverage).toEqual([])
    expect(w.text()).toContain('覆盖月份')
    expect(w.findAll('button').find((b) => b.text() === '保存草稿并校验')!.attributes('disabled')).toBeDefined()
  })

  it('未声明原始时区、单位、粒度时不能提交；模板容差与尾差规则公示', async () => {
    const w = await open()
    expect(w.text()).toContain('守恒容差 0 MWh')
    expect(w.text()).toContain('不做任何舍入')
    const submit = () => w.findAll('button').find((b) => b.text() === '保存草稿并校验')!
    expect(submit().attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('请补充：曲线文件、原始粒度、单位、原始时区')
    const vm = w.vm as unknown as DialogVm
    vm.files.workbook = new File(['x'], 'TEST-曲线.xlsx')
    vm.form.granularityMinutes = 60
    vm.form.unit = 'MWh'
    await nextTick()
    expect(submit().attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('请补充：原始时区')
    vm.form.sourceTimezone = 'Asia/Shanghai'
    await nextTick()
    expect(submit().attributes('disabled')).toBeUndefined()
  })

  it('保存草稿后逐月给出守恒结论，不守恒标「不缩放」，并提示草稿不计入分时持仓', async () => {
    hoisted.createCurveDraft.mockResolvedValue({
      curveSetId: 31, setNo: 3, status: 'DRAFT', revisionNo: 2,
      validation: {
        blocking: true, blockingCount: 1, warningCount: 0, completeness: 'COMPLETE',
        summary: [{ code: 'MONTH_NOT_CONSERVED', severity: 'blocking', label: '月合计与正式月度分解不一致', count: 1 }],
        months: [
          { month: '2027-02', curveQuantity: '672', formalQuantity: '720', difference: '-48', status: 'NOT_CONSERVED', intervalCount: 672, expectedIntervalCount: 672, missingIntervalCount: 0, zeroIntervalCount: 0 },
          { month: '2027-03', curveQuantity: '744', formalQuantity: '744', difference: '0', status: 'CONSERVED', intervalCount: 744, expectedIntervalCount: 744, missingIntervalCount: 0, zeroIntervalCount: 0 },
        ],
      },
    })
    const w = await open()
    const vm = w.vm as unknown as DialogVm
    vm.files.workbook = new File(['x'], 'TEST-曲线.xlsx')
    Object.assign(vm.form, { granularityMinutes: 60, unit: 'MWh', sourceTimezone: 'Asia/Shanghai', coverage: ['2027-02', '2027-03'] })
    await nextTick()
    await w.findAll('button').find((b) => b.text() === '保存草稿并校验')!.trigger('click')
    await flushPromises()
    expect(hoisted.createCurveDraft).toHaveBeenCalledWith(7, expect.objectContaining({
      expectedRevisionNo: 2, evidenceBasis: 'FORMAL', coverageFromMonth: '2027-02', coverageToMonth: '2027-03', granularityMinutes: 60, unit: 'MWh', sourceTimezone: 'Asia/Shanghai',
      files: [{ role: 'workbook', fileName: 'TEST-曲线.xlsx', contentBase64: 'Zg==' }],
    }))
    const text = w.text()
    expect(text).toContain('有 1 个阻断问题，不能确认')
    expect(text).toContain('不守恒（不缩放）')
    expect(text).toContain('草稿不计入分时持仓')
    expect(w.findAll('a').map((a) => a.attributes('data-to'))).toContain('/zcqjy/curves/31')
  })
})
