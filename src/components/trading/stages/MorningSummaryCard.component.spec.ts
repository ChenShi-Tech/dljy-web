// 本日适用措施卡组件测试（trading-day-morning-summary-and-lazy-stages 任务 2.1）
// 验收：四态呈现（ok/empty/unauthorized/unavailable+重试）+ 过期置顶标黄 + 深链改进视图
// + scope 切换慢响应不回填（spec「快速切换不串上下文」）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan' } }
}))

const fetchCarryOverActions = vi.fn()
vi.mock('@/services/review/reviewStoreClient', () => ({
  fetchCarryOverActions: (...args: unknown[]) => fetchCarryOverActions(...args)
}))

import MorningSummaryCard from './MorningSummaryCard.vue'
import { mount } from '@/test/mount'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function action(overrides: Record<string, unknown>) {
  return {
    id: 'a1',
    action: '复核日前申报偏置档位',
    owner: '张三',
    dueDate: '2026-09-30',
    status: 'open',
    updatedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  fetchCarryOverActions.mockReset()
  push.mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>, rounds = 4) {
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

describe('MorningSummaryCard（本日适用措施）', () => {
  it('ok 态列出未闭环措施并带负责人/回查日，过期未验证置顶标黄', async () => {
    fetchCarryOverActions.mockResolvedValue({
      available: true,
      actions: [
        action({ id: 'fine', dueDate: '2099-01-01' }),
        action({ id: 'late', dueDate: '2020-01-01' })
      ]
    })
    const wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    const items = wrapper.findAll('.msc-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('已过期未验证')
    expect(items[0].classes()).toContain('msc-item-overdue')
    expect(wrapper.text()).toContain('负责人：张三')
    expect(wrapper.text()).toContain('回查日：2099-01-01')
    expect(wrapper.text()).toContain('2 条')
  })

  it('条目点击跳复盘中心改进验证视图', async () => {
    fetchCarryOverActions.mockResolvedValue({ available: true, actions: [action({})] })
    const wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    await wrapper.find('.msc-item').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/xhjy/review', query: { task: 'improvement' } })
  })

  it('empty / unauthorized / unavailable 三态诚实呈现，失败可重试', async () => {
    fetchCarryOverActions.mockResolvedValue({ available: true, actions: [] })
    let wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    expect(wrapper.text()).toContain('无未闭环措施')

    fetchCarryOverActions.mockResolvedValue({ available: false, reason: 'unauthorized' })
    wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    expect(wrapper.text()).toContain('无权限查看复盘措施')

    fetchCarryOverActions.mockResolvedValueOnce({ available: false, reason: 'unreachable' })
    fetchCarryOverActions.mockResolvedValueOnce({ available: true, actions: [action({})] })
    wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    expect(wrapper.text()).toContain('复盘措施读取失败')
    await wrapper.find('.msc-retry').trigger('click')
    await settle(wrapper)
    expect(wrapper.text()).toContain('本日适用措施')
    expect(wrapper.findAll('.msc-item')).toHaveLength(1)
  })

  it('scope 切换后旧慢响应不回填新上下文', async () => {
    const first = deferred<{ available: boolean; actions?: unknown[] }>()
    fetchCarryOverActions.mockReturnValueOnce(first.promise)
    // 新 scope 的响应先入队再触发切换：watch 在 setProps 后立即发第二次请求
    fetchCarryOverActions.mockResolvedValueOnce({ available: true, actions: [action({ id: 'stale', action: '旧上下文措施' })] })
    const wrapper = mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } })
    await settle(wrapper, 2)
    expect(wrapper.text()).toContain('查未闭环措施…')

    await wrapper.setProps({ targetDate: '2026-09-29' })
    await settle(wrapper)

    first.resolve({ available: true, actions: [action({ id: 'old', action: '昨日旧措施' })] })
    await settle(wrapper)
    expect(wrapper.text()).not.toContain('昨日旧措施')
    expect(wrapper.text()).toContain('旧上下文措施')
  })

  it('取数抛错归读取失败态，不白屏', async () => {
    fetchCarryOverActions.mockRejectedValue(new Error('boom'))
    const wrapper = await settle(mount(MorningSummaryCard, { props: { targetDate: '2026-09-28' } }))
    expect(wrapper.text()).toContain('复盘措施读取失败')
  })
})
