// 守报告内回查：只列本周期到期且仍在跟进的措施；结论由人选，写回改进记录并进报告；失败保留已写内容。dljy#2877。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { fetchAllImprovementActions, patchImprovementAction } from '@/services/review/reviewStoreClient'
import ImprovementLookbackPanel from './ImprovementLookbackPanel.vue'
import type { Workpaper } from '@/services/review/workpapers'

vi.mock('@/services/review/reviewStoreClient', () => ({ fetchAllImprovementActions: vi.fn(), patchImprovementAction: vi.fn() }))
const draft: Workpaper = { id: 'draft-1', title: '晴川周复盘', scope: { region: 'yunnan', view: 'generator', objectId: 'a', objectLabel: '晴川风电场', startDate: '2026-05-25', endDate: '2026-05-31' }, authorId: '主笔', revision: 1, blocks: [], summary: '', updatedAt: '', canEdit: true }
const action = (id: string, status: 'open' | 'carried_over' | 'done' | 'dropped', dueDate: string | null, text = `晚高峰前复核预测区间 ${id}`) => ({ id, action: text, owner: '张三', dueDate, status, updatedAt: null })
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchAllImprovementActions).mockResolvedValue({ available: true, actions: [action('1', 'open', '2026-05-30'), action('2', 'carried_over', '2026-05-31'), action('3', 'open', '2026-06-05'), action('4', 'done', '2026-05-20'), action('5', 'open', null)] })
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
async function openPanel() {
  const wrapper = mount(ImprovementLookbackPanel, { props: { draft } })
  wrappers.push(wrapper)
  wrapper.find('details').element.open = true
  await wrapper.find('details').trigger('toggle'); await flushPromises()
  return wrapper
}
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(node => node.text().startsWith(text))!

describe('报告内回查改进措施', () => {
  it('只列回查日期在本周期结束前、仍在跟进的措施', async () => {
    const wrapper = await openPanel()
    const titles = wrapper.findAll('article b').map(node => node.text())
    expect(titles).toEqual(['晚高峰前复核预测区间 1', '晚高峰前复核预测区间 2'])
  })
  it('交易员选定结论后写回改进记录并把这次回查加入报告', async () => {
    vi.mocked(patchImprovementAction).mockImplementation(async (id, patch) => ({ ...action(id, patch.status as 'done', '2026-05-30'), action: patch.action! }))
    const wrapper = await openPanel()
    await button(wrapper, '在本报告中回查').trigger('click')
    await wrapper.get('textarea').setValue('对照本周偏差图，晚高峰绝对偏差较上周下降')
    await wrapper.get('select').setValue('met')
    await button(wrapper, '保存回查并加入报告').trigger('click'); await flushPromises()
    const [id, patch] = vi.mocked(patchImprovementAction).mock.calls[0]
    expect(id).toBe('1')
    expect(patch.status).toBe('done')
    expect(patch.action).toContain('回查报告：晴川周复盘（2026-05-25—2026-05-31）')
    expect(patch.action).toContain('验证结论：达到预期，结束回查')
    const [block] = wrapper.emitted('record')![0] as [{ kind: string; text: string }]
    expect(block.kind).toBe('action')
    expect(block.text).toContain('验证记录：对照本周偏差图')
  })
  it('证据不足时措施继续跟进，不被关闭', async () => {
    vi.mocked(patchImprovementAction).mockImplementation(async (id, patch) => ({ ...action(id, patch.status as 'carried_over', '2026-05-30'), action: patch.action! }))
    const wrapper = await openPanel()
    await button(wrapper, '在本报告中回查').trigger('click')
    await wrapper.get('textarea').setValue('本周资料不全，暂不能判断效果')
    await button(wrapper, '保存回查并加入报告').trigger('click'); await flushPromises()
    expect(vi.mocked(patchImprovementAction).mock.calls[0][1].status).toBe('carried_over')
  })
  it('保存失败时保留已写的验证记录，读不到记录时不说成「没有待回查」', async () => {
    vi.mocked(patchImprovementAction).mockRejectedValue(new Error('网络中断'))
    const wrapper = await openPanel()
    await button(wrapper, '在本报告中回查').trigger('click')
    await wrapper.get('textarea').setValue('对照本周偏差图，晚高峰绝对偏差较上周下降')
    await button(wrapper, '保存回查并加入报告').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('已写的验证记录仍保留')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('对照本周偏差图，晚高峰绝对偏差较上周下降')
    expect(wrapper.emitted('record')).toBeUndefined()
    expect(wrapper.emitted('dirty')!.at(-1)).toEqual([true])
    vi.mocked(fetchAllImprovementActions).mockResolvedValue({ available: false, reason: 'unreachable' })
    const failed = await openPanel()
    expect(failed.text()).toContain('不能据此判断本期没有待回查的措施')
    expect(failed.text()).not.toContain('没有到期待回查')
  })
})
