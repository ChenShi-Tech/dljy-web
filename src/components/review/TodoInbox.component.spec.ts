// 复盘待办箱组件测试（Epic #2033 · M1 · #2038 验收：组件测试覆盖待办箱主路径）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/templateInstanceClient', () => ({
  fetchTemplateInstanceFeed: vi.fn()
}))

import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import TodoInbox from './TodoInbox.vue'
import { mount } from '@/test/mount'

beforeEach(() => {
  vi.mocked(fetchTemplateInstanceFeed).mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  await nextTick(); await nextTick(); await nextTick()
  return wrapper
}

describe('TodoInbox（复盘待办箱）', () => {
  it('引擎在线：待办按时限排序、逾期标红、点击发出 open-instance', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({
      available: true,
      instances: [
        { id: 'b', templateId: 'T05', periodKey: '2026-W33', status: 'pending', dueAt: '2099-01-01T00:00:00Z', updatedAt: null },
        { id: 'a', templateId: 'T01', periodKey: '2026-08-14', status: 'pending', dueAt: '2000-01-01T00:00:00Z', updatedAt: null }
      ]
    })
    const wrapper = await settle(mount(TodoInbox))
    const text = wrapper.text()
    expect(text).toContain('2 项待办')
    expect(text).toContain('决策复盘单')     // T01 模板名（注册表挂接）
    expect(text).toContain('执行偏差分析表') // T05
    expect(text).toContain('已逾期')
    // 逾期行在前
    const rows = wrapper.findAll('.ti-row')
    expect(rows[0].text()).toContain('决策复盘单')
    await rows[0].trigger('click')
    expect(wrapper.emitted('open-instance')).toBeTruthy()
    const payload = wrapper.emitted('open-instance')![0][0] as { id: string; overdue: boolean }
    expect(payload.id).toBe('a')
    expect(payload.overdue).toBe(true)
  })

  it('引擎在线无待办 → 「今日待办已清」', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: true, instances: [] })
    const wrapper = await settle(mount(TodoInbox))
    expect(wrapper.text()).toContain('今日待办已清')
  })

  it('触发引擎未上线 → 就绪度台账替代视图（不拿假分母）', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
    const wrapper = await settle(mount(TodoInbox))
    const text = wrapper.text()
    expect(text).toContain('触发引擎（#2039）未上线')
    expect(text).toContain('31 项模板')
    expect(text).toContain('就绪度台账')
  })

  it('不可达 → 重试按钮；无权限 → 权限提示', async () => {
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'unreachable' })
    let wrapper = await settle(mount(TodoInbox))
    expect(wrapper.text()).toContain('暂时不可达')
    expect(wrapper.find('.ti-retry').exists()).toBe(true)

    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'unauthorized' })
    wrapper = await settle(mount(TodoInbox))
    expect(wrapper.text()).toContain('无权限')
  })
})
