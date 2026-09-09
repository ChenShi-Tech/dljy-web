import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import ImprovementWorkbench from './ImprovementWorkbench.vue'
import { createImprovementAction, fetchImprovementActions, patchImprovementAction } from '@/services/review/reviewStoreClient'
vi.mock('@/services/review/reviewStoreClient', () => ({ createImprovementAction: vi.fn(), fetchImprovementActions: vi.fn(), patchImprovementAction: vi.fn() }))
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchImprovementActions).mockResolvedValue({ available: true, actions: [] }) })
afterEach(() => wrappers.splice(0).forEach(w => w.unmount()))
async function open() { const wrapper = mount(ImprovementWorkbench, { props: { context: '2026-05-31 申报记录', focus: '18:15' } }); wrappers.push(wrapper); await flushPromises(); return wrapper }
async function fill(w: ReturnType<typeof mount>) {
  await w.findAll('textarea')[0].setValue('晚峰增加一次预测区间核验')
  await w.find('input[placeholder="填写实际负责人"]').setValue('测试负责人')
  await w.find('input[type="date"]').setValue('2026-06-05')
  await w.findAll('textarea')[1].setValue('比较后续五个交易日的同口径执行差异')
}
describe('改进记录持久化交互', () => {
  it('带入来源和时段，写成功才出现保存反馈与记录', async () => {
    vi.mocked(createImprovementAction).mockImplementation(async input => ({ id: 'a', ...input, owner: input.owner ?? null, dueDate: input.dueDate ?? null, status: 'open', updatedAt: null }))
    const w = await open(); await fill(w); await w.find('form').trigger('submit'); await flushPromises()
    expect(createImprovementAction).toHaveBeenCalledWith(expect.objectContaining({ action: expect.stringContaining('18:15'), dueDate: '2026-06-05', owner: '测试负责人' }))
    expect(w.text()).toContain('改进措施已保存'); expect(w.text()).toContain('待落实')
    expect(patchImprovementAction).not.toHaveBeenCalled()
  })
  it('接口失败不伪成功，保留输入，隐藏技术错误', async () => {
    vi.mocked(createImprovementAction).mockRejectedValue(new Error('review.improvement_actions.owner denied'))
    const w = await open(); await fill(w); await w.find('form').trigger('submit'); await flushPromises()
    expect(w.text()).toContain('保存结果暂未确认')
    expect((w.findAll('textarea')[0].element as HTMLTextAreaElement).value).toContain('晚峰增加')
    expect(w.text()).not.toContain('review.improvement_actions')
    expect(w.text()).not.toContain('改进措施已保存')
  })
  it('服务不可用不显示已清空或零待办', async () => {
    vi.mocked(fetchImprovementActions).mockResolvedValue({ available: false, reason: 'unreachable' })
    const w = await open()
    expect(w.text()).toContain('不能确认待办数量')
    expect(w.text()).not.toContain('没有改进记录')
  })
  it('完成操作必须补充实际验证记录，状态不声称因果有效', async () => {
    const action = { id: 'a', action: '复核晚峰申报范围', owner: '测试负责人', dueDate: '2026-06-05', status: 'open' as const, updatedAt: null }
    vi.mocked(fetchImprovementActions).mockResolvedValue({ available: true, actions: [action] })
    vi.mocked(patchImprovementAction).mockResolvedValue({ ...action, action: `${action.action}\n验证记录：核对了后续五个交易日，资料仍不足以判断效果`, status: 'carried_over' })
    const w = await open()
    await w.findAll('button').find(b => b.text() === '补充验证记录')!.trigger('click'); await flushPromises()
    const button = w.findAll('button').find(b => b.text() === '保存验证记录')!
    expect(button.attributes('disabled')).toBeDefined()
    await w.find('textarea[placeholder^="例如：复核"]').setValue('核对了后续五个交易日，资料仍不足以判断效果')
    await button.trigger('click'); await flushPromises()
    expect(patchImprovementAction).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'carried_over', action: expect.stringContaining('验证记录：') }))
    expect(w.text()).toContain('证据不足，措施继续跟进')
  })
})
