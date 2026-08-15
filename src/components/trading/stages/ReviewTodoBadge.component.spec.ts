// 复盘待办徽标组件测试（Epic #2033 · M1 · #2040）
// 验收：真数两态 + 引擎未上线诚实态 + 权限态；点击都跳待办箱。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/services/review/templateInstanceClient', () => ({
  fetchTemplateInstanceFeed: vi.fn()
}))

import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import ReviewTodoBadge from './ReviewTodoBadge.vue'
import { mount } from '@/test/mount'

beforeEach(() => {
  vi.mocked(fetchTemplateInstanceFeed).mockReset()
  push.mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  await nextTick()
  await nextTick()
  await nextTick()
  return wrapper
}

describe('ReviewTodoBadge（复盘待办徽标）', () => {
  it('引擎在线有待办 → 「今天应填 N 张」', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({
      available: true,
      instances: [
        { id: 'a', templateId: 'T01', periodKey: '2026-08-14', status: 'pending', dueAt: null, updatedAt: null },
        { id: 'b', templateId: 'T05', periodKey: '2026-W33', status: 'draft', dueAt: null, updatedAt: null }
      ]
    })
    const wrapper = await settle(mount(ReviewTodoBadge))
    expect(wrapper.text()).toContain('今天应填 2 张复盘单')
    await wrapper.find('.rtb').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/xhjy/review', query: { todo: '1' } })
  })

  it('引擎在线无待办 → 「今日复盘待办已清」', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: true, instances: [] })
    const wrapper = await settle(mount(ReviewTodoBadge))
    expect(wrapper.text()).toContain('今日复盘待办已清')
  })

  it('触发引擎未上线（当前常态）→ 诚实态不拿假分母', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
    const wrapper = await settle(mount(ReviewTodoBadge))
    expect(wrapper.text()).toContain('触发引擎未上线')
  })

  it('无权限态与不可达态区分呈现', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'unauthorized' })
    let wrapper = await settle(mount(ReviewTodoBadge))
    expect(wrapper.text()).toContain('无权限查看')

    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'unreachable' })
    wrapper = await settle(mount(ReviewTodoBadge))
    expect(wrapper.text()).toContain('暂时不可达')
  })
})
