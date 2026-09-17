// 交易方案草稿表单的保存会话（dljy#2973，dljy-web#128）。
// 守什么：本表单发写请求前没有等待，目标在点保存时同步读取；写请求返回前关掉并对另一个方案打开时，
//        旧结果不关闭新表单、旧方案的失败信息不显示在新表单上，新表单也不被「保存中」卡住；正常保存成功即关闭。
// 坏掉的症状：修改方案 A 的请求刚返回，正在编辑的方案 B 表单被自动关掉，或出现 A 的版本冲突提示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'
import type { TradeProposalDetail } from '@/services/midlong/midlongP3Types'

const hoisted = vi.hoisted(() => ({ createProposal: vi.fn(), updateProposalDraft: vi.fn(), warning: vi.fn() }))
vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: hoisted.warning } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ message: (e as Error).message }) }))
vi.mock('@/services/midlong/midlongP3Api', () => ({ createProposal: hoisted.createProposal, updateProposalDraft: hoisted.updateProposalDraft }))

import ProposalFormDialog from './ProposalFormDialog.vue'

afterEach(() => vi.clearAllMocks())
enableAutoUnmount(afterEach)

const subjects = [{ id: 1, displayName: '测试交易单元', subjectKey: 'TEST-1' }] as MidlongSubject[]
const proposalOf = (id: number) => ({
  id, rowVersion: 3, subjectId: 1, windowId: null, windowRevisionNo: null, productKind: null, tradeMethod: null, proposedPrice: null, priceTaxBasis: 'UNKNOWN',
  priceComponent: 'UNVERIFIED', ownerName: null, rationale: `【测试数据】方案 ${id}`, segments: [{ deliveryMonth: '2031-05', quantity: '100' }],
}) as unknown as TradeProposalDetail
const save = (w: ReturnType<typeof mount>) => w.findAll('.el-dialog__footer button').find((b) => b.text().startsWith('保存'))!

describe('交易方案草稿表单：保存会话', () => {
  it('写请求返回前关闭并对另一个方案打开：旧结果不关闭新表单，旧方案的失败不显示在新表单；正常保存成功即关闭', async () => {
    hoisted.updateProposalDraft.mockResolvedValueOnce({ proposalId: 1, status: 'DRAFT', rowVersion: 4 })
    const ok = mount(ProposalFormDialog, { props: { modelValue: true, proposal: proposalOf(1), subjects, windows: [] } })
    await flushPromises()
    await save(ok).trigger('click')
    await flushPromises()
    expect(hoisted.updateProposalDraft).toHaveBeenCalledWith(1, expect.objectContaining({ expectedRowVersion: 3, rationale: '【测试数据】方案 1' }))
    expect(ok.emitted('saved')).toEqual([[{ proposalId: 1, status: 'DRAFT', rowVersion: 4 }]])
    expect(ok.emitted('update:modelValue')).toEqual([[false]])
    ok.unmount()

    let rejectWrite: (e: Error) => void = () => {}
    hoisted.updateProposalDraft.mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject }))
    const w = mount(ProposalFormDialog, { props: { modelValue: true, proposal: proposalOf(1), subjects, windows: [] } })
    await flushPromises()
    await save(w).trigger('click')
    await flushPromises()
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, proposal: proposalOf(2) })
    rejectWrite(new Error('【测试数据】方案 1 版本已变化'))
    await flushPromises()
    expect(w.text()).not.toContain('【测试数据】方案 1 版本已变化')
    expect(hoisted.warning).toHaveBeenCalledWith(expect.stringContaining('【测试数据】方案 1 版本已变化'))
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(save(w).classes()).not.toContain('is-loading')
  })
})
