// 售电目标表单（dljy#2973，MS-01）。
// 守什么：同主体同交割期已有目标时，服务端返回 BUSINESS_KEY_CONFLICT，表单明确提示「不能重复新建、请在原目标上发起更改」并给出已有目标编号；
//        发起更改必须填写原因才能提交。
//        写请求返回前关掉并对另一个目标打开：旧结果不关闭新表单，旧目标的失败信息不显示在新表单上。
// 坏掉的症状：重复新建只显示笼统的「资料校验未通过」，用户不知道应在原目标上改；旧目标的版本冲突出现在另一个目标的表单里。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { ElDatePicker } from 'element-plus'
import { mount } from '@/test/mount'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'
import type { SalesPlanListRow } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ createPlan: vi.fn(), updatePlanDraft: vi.fn(), createPlanRevision: vi.fn(), warning: vi.fn() }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ createPlan: hoisted.createPlan, updatePlanDraft: hoisted.updatePlanDraft, createPlanRevision: hoisted.createPlanRevision }))

import PlanFormDialog from './PlanFormDialog.vue'

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

const subjects = [{ id: 1, displayName: '测试交易单元', subjectKey: 'TEST-1' }] as MidlongSubject[]

describe('售电目标表单', () => {
  it('重复新建同主体同交割期目标：提示不能重复新建、应在已有目标上发起更改', async () => {
    hoisted.createPlan.mockRejectedValue({ failure: { status: 409, errorCode: 'BUSINESS_KEY_CONFLICT', message: '该交易主体在该交割期已有售电目标', details: { reason: 'PLAN_SCOPE_EXISTS', existingPlanId: 77 } } })
    const w = mount(PlanFormDialog, { props: { modelValue: true, mode: 'create', plan: null, subjects } })
    await flushPromises()
    w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 1)
    w.findComponent(ElDatePicker).vm.$emit('update:modelValue', '2031-05')
    await flushPromises()
    await w.findAll('.el-dialog__footer button').find((b) => b.text().startsWith('保存'))!.trigger('click')
    await flushPromises()
    expect(hoisted.createPlan).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 1, periodType: 'MONTH', periodKey: '2031-05' }))
    expect(w.text()).toContain('不能重复新建')
    expect(w.text()).toContain('目标 #77')
    expect(w.text()).toContain('发起更改')
  })

  it('写请求返回前关闭并对另一个目标打开：旧结果不关闭新表单，旧目标的失败不显示在新表单；正常保存成功即关闭', async () => {
    const planOf = (id: number) => ({
      id, rowVersion: 3, subjectId: 1, periodType: 'MONTH', periodKey: `2031-0${id}`, currentRevisionNo: 1, confirmedRevision: null,
      draftRevision: { revisionNo: 1, targetQuantity: '100', targetPriceLow: null, targetPriceHigh: null, priceTaxBasis: 'UNKNOWN', basisNote: null, ownerName: null, changeReason: null },
    }) as unknown as SalesPlanListRow
    const save = (w: ReturnType<typeof mount>) => w.findAll('.el-dialog__footer button').find((b) => b.text().startsWith('保存'))!.trigger('click')

    hoisted.updatePlanDraft.mockResolvedValueOnce({ planId: 1, revisionNo: 1, status: 'DRAFT' })
    const ok = mount(PlanFormDialog, { props: { modelValue: true, mode: 'edit', plan: planOf(1), subjects } })
    await flushPromises()
    await save(ok)
    await flushPromises()
    expect(ok.emitted('update:modelValue')).toEqual([[false]])
    ok.unmount()

    let rejectWrite: (e: unknown) => void = () => {}
    hoisted.updatePlanDraft.mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject }))
    const w = mount(PlanFormDialog, { props: { modelValue: true, mode: 'edit', plan: planOf(1), subjects } })
    await flushPromises()
    await save(w)
    await flushPromises()
    expect(hoisted.updatePlanDraft).toHaveBeenLastCalledWith(1, expect.objectContaining({ expectedRowVersion: 3 }))
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, plan: planOf(2) })
    rejectWrite({ failure: { status: 409, errorCode: 'VERSION_CONFLICT', message: '【测试数据】目标 1 版本已变化', details: null } })
    await flushPromises()
    expect(w.text()).not.toContain('【测试数据】目标 1 版本已变化')
    expect(hoisted.warning).toHaveBeenCalledWith(expect.stringContaining('【测试数据】目标 1 版本已变化'))
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(w.findAll('.el-dialog__footer button').find((b) => b.text().startsWith('保存'))!.classes()).not.toContain('is-loading')
  })
})
