// 顶栏盯盘告警中心的静默降级守卫（fix-spot-degradation-honesty）：
// listAlerts 失败已改为抛错（告警链路不可用不得冒充「无告警」），顶栏角标是
// 想静默的消费方——失败时保留上一次已显示的告警值、不向用户抛错，同时不得把
// 失败渲染成「暂无未处理告警」的假空态。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listAlertsMock = vi.fn()

vi.mock('@/services/alertClient', () => ({
  listAlerts: (...args: unknown[]) => listAlertsMock(...args),
  scanAlerts: vi.fn(async () => ({ ok: true, created: 0 })),
  dismissAlert: vi.fn(async () => true),
  clearAllAlerts: vi.fn(async () => true),
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

const { ElMessage } = await import('element-plus')
const AlertCenter = (await import('./AlertCenter.vue')).default

const ALERT = {
  id: 'a-1', ts: 1, kind: 'spread', severity: 'high', region_id: 'yunnan',
  region_name: '云南', title: '价差异动', detail: '示例', basis: 'captured', status: 'open',
}

function mountCenter() {
  return mount(AlertCenter)
}

async function openPanel(wrapper: ReturnType<typeof mountCenter>) {
  await wrapper.get('.ac-bell').trigger('click')
  await flushPromises()
}

describe('告警后端离线时顶栏保持静默', () => {
  it('失败抛错时保留旧告警值，不向用户报错、不显示假空态', async () => {
    listAlertsMock.mockResolvedValueOnce({ alerts: [ALERT], open_count: 1 })
    const wrapper = mountCenter()
    await openPanel(wrapper)
    expect(wrapper.get('.ac-badge').text()).toBe('1')

    // 后端转为不可用（listAlerts 抛错）：重新打开面板触发刷新
    listAlertsMock.mockRejectedValue(new Error('告警列表请求失败: HTTP 500'))
    await wrapper.get('.ac-bell').trigger('click') // 关闭（清轮询）
    await wrapper.get('.ac-bell').trigger('click') // 再打开 → refresh
    await flushPromises()

    expect(wrapper.get('.ac-badge').text()).toBe('1')
    expect(wrapper.find('.ac-empty').exists()).toBe(false)
    expect(ElMessage.error).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('成功路径：打开面板拉取并显示告警数', async () => {
    listAlertsMock.mockResolvedValue({ alerts: [ALERT], open_count: 1 })
    const wrapper = mountCenter()
    await openPanel(wrapper)
    expect(wrapper.get('.ac-badge').text()).toBe('1')
    expect(wrapper.findAll('.ac-item')).toHaveLength(1)
    wrapper.unmount()
  })
})
