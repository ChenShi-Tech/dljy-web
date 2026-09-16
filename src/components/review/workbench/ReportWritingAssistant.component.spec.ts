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
  it('局部采纳：删改候选文字、只保留勾选的待核实事项，来源随改后的文字走', async () => {
    suggest.mockResolvedValue({ text: '晚高峰偏差集中【材料1】。可能与出力预测偏高有关【材料2】。', evidenceRefs: [1, 2], uncertainties: ['核对晚高峰缺测', '核对预测版本'] })
    const wrapper = mount(ReportWritingAssistant, { props: { input: { ...input, evidence: ['晚高峰偏差材料', '预测版本材料'] }, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    await wrapper.get('textarea[aria-label="编辑候选文字"]').setValue('晚高峰偏差集中【材料1】，原因由交易员另行核实。')
    await wrapper.get('input[aria-label="保留待核实事项2"]').setValue(false)
    await wrapper.get('input[aria-label="核对建议"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '采用到当前段落')!.trigger('click')
    const adopted = wrapper.emitted('adopt')![0][0] as string
    expect(adopted).toContain('原因由交易员另行核实')
    expect(adopted).not.toContain('出力预测偏高')
    expect(adopted).toContain('核对晚高峰缺测')
    expect(adopted).not.toContain('核对预测版本')
    expect(adopted).toContain('【材料1】晚高峰偏差材料')
    expect(adopted).not.toContain('预测版本材料')
    // 恢复候选原文后回到完整建议
    await wrapper.findAll('button').find(button => button.text() === '恢复候选原文')!.trigger('click')
    expect((wrapper.get('textarea[aria-label="编辑候选文字"]').element as HTMLTextAreaElement).value).toContain('出力预测偏高')
  })
  it('改后文字引用了未选用的材料或被清空时不能采纳', async () => {
    const wrapper = mount(ReportWritingAssistant, { props: { input, companyId: 'a', region: 'yunnan' } })
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    await wrapper.get('input[aria-label="核对建议"]').setValue(true)
    const adopt = () => wrapper.findAll('button').find(button => button.text() === '采用到当前段落')!
    await wrapper.get('textarea[aria-label="编辑候选文字"]').setValue('另见【材料3】')
    expect(wrapper.text()).toContain('引用了本次没有选用的材料编号')
    expect(adopt().attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[aria-label="编辑候选文字"]').setValue('   ')
    expect(wrapper.text()).toContain('候选文字已清空')
    await adopt().trigger('click')
    expect(wrapper.emitted('adopt')).toBeUndefined()
  })
  it('可以请助手起草本段草稿', async () => {
    const wrapper = mount(ReportWritingAssistant, { props: { input, companyId: 'a', region: 'yunnan' } })
    await wrapper.get('select[aria-label="写作辅助方式"]').setValue('draft')
    await wrapper.findAll('button').find(button => button.text() === '生成候选文字')!.trigger('click'); await flushPromises()
    expect(suggest).toHaveBeenCalledWith(expect.any(Object), 'draft', expect.any(Object), expect.any(AbortSignal))
  })
})
