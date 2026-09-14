import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportWritingAssistant from './ReportWritingAssistant.vue'
const suggest = vi.hoisted(() => vi.fn())
vi.mock('@/services/review/reviewWriting', () => ({ suggestReviewWriting: suggest }))
const input = { scope: '当前公司五月', title: '解释', text: '原来的文字', evidence: ['有值覆盖一半，不能视为完整月'] }
const candidate = { text: '可能原因【材料1】', evidenceRefs: [1], uncertainties: ['核对缺失时段'] }
beforeEach(() => { vi.resetAllMocks(); suggest.mockResolvedValue(candidate) })
describe('人工控制的复盘写作辅助', () => {
  it('没有原文和材料时不请求模型生成无依据内容', async () => {
    const wrapper = mount(ReportWritingAssistant, { props: { input: { ...input, text: '', evidence: [] }, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click')
    expect(suggest).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先填写原文')
  })
  it('只发送选中材料，采纳时引用仍对应本次所选来源', async () => {
    const wrapper = mount(ReportWritingAssistant, { props: { input: { ...input, evidence: ['未选的材料', '选中的来源'] }, companyId: 'a', region: 'yunnan' } })
    await wrapper.get('input[aria-label="选用第1项材料"]').setValue(false)
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ evidence: ['选中的来源'] }), expect.any(String), expect.any(Object), expect.any(AbortSignal))
    await wrapper.get('input[aria-label="核对建议"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '追加到当前段落')!.trigger('click')
    expect(wrapper.emitted('adopt')![0][0]).toContain('【材料1】选中的来源')
    expect(wrapper.emitted('adopt')![0][0]).not.toContain('未选的材料')
  })
  it('生成不覆盖原文，核对后采纳保留引用与待核实事项', async () => {
    const wrapper = mount(ReportWritingAssistant, { props: { input, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('原来的文字')
    expect(wrapper.emitted('adopt')).toBeUndefined()
    const adopt = wrapper.findAll('button').find(button => button.text() === '采用到当前段落')!
    expect(adopt.attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="核对建议"]').setValue(true); await adopt.trigger('click')
    expect(wrapper.emitted('adopt')![0][0]).toContain('待核实事项')
    expect(wrapper.emitted('adopt')![0][0]).toContain('有值覆盖一半')
  })
  it('生成期间修改原文，迟到结果失效', async () => {
    let resolve!: (value: typeof candidate) => void
    suggest.mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = mount(ReportWritingAssistant, { props: { input, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click')
    await wrapper.setProps({ input: { ...input, text: '新编辑' } }); resolve(candidate); await flushPromises()
    expect(wrapper.text()).not.toContain(candidate.text)
    expect(wrapper.emitted('adopt')).toBeUndefined()
  })
  it('模型离线只显示业务提示，不伪造分析结果', async () => {
    suggest.mockRejectedValue(new Error('provider-token raw diagnostic'))
    const wrapper = mount(ReportWritingAssistant, { props: { input, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('可以继续人工编辑、保存和发布')
    expect(wrapper.text()).not.toContain('provider-token')
  })
})
