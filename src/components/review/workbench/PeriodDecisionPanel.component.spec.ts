// 守卫周期切换及分页错误状态；旧响应不能冒充新周期的申报。#2875
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PeriodDecisionPanel from './PeriodDecisionPanel.vue'
import { loadPeriodDecisions } from '@/services/review/periodDecisions'
import type { DeclarationOrder } from '@/services/declarations'
vi.mock('@/services/review/periodDecisions', () => ({ loadPeriodDecisions: vi.fn() }))
const order = { id: 'one', status: 'CLEARED', mode: 'REHEARSAL', targetDate: '2026-05-31', quoteRationale: '晚峰保留调整空间' } as DeclarationOrder
const result = { rows: [order], omitted: 0, nextOffset: null }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadPeriodDecisions).mockResolvedValue(result) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
async function open() {
  const wrapper = mount(PeriodDecisionPanel, { props: { company: 'a', region: 'yunnan', period: { start: '2026-05-25', end: '2026-05-31' } } }); wrappers.push(wrapper)
  expect(loadPeriodDecisions).not.toHaveBeenCalled()
  wrapper.find('details').element.open = true
  await wrapper.find('details').trigger('toggle'); await flushPromises()
  return wrapper
}
describe('周期回查入口', () => {
  it('按需加载、保留模拟标识且只有主动点击才进入单笔', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('模拟演练')
    expect(wrapper.text()).toContain('同期出现不代表偏差原因')
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.findAll('button').find(b => b.text() === '复盘这笔申报')!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([order])
  })
  it('周期切换立即清掉旧记录并忽略迟到响应', async () => {
    let resolveOld!: (value: typeof result) => void
    vi.mocked(loadPeriodDecisions).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const wrapper = await open()
    await wrapper.setProps({ period: { start: '2026-06-01', end: '2026-06-07' } }); await flushPromises()
    resolveOld({ rows: [{ ...order, quoteRationale: '旧周期内容' }], omitted: 0, nextOffset: null }); await flushPromises()
    expect(wrapper.text()).not.toContain('旧周期内容')
    expect(loadPeriodDecisions).toHaveBeenLastCalledWith('a', 'yunnan', { start: '2026-06-01', end: '2026-06-07' }, 0, undefined)
  })
  it('失败不显示无记录，重试恢复；模式变化重新请求第一页', async () => {
    vi.mocked(loadPeriodDecisions).mockRejectedValueOnce(new Error('offline'))
    const wrapper = await open()
    expect(wrapper.find('[role="alert"]').text()).toContain('不能据此判断')
    await wrapper.find('button').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.find('select').setValue('LIVE'); await flushPromises()
    expect(loadPeriodDecisions).toHaveBeenLastCalledWith('a', 'yunnan', expect.any(Object), 0, 'LIVE')
  })
})
