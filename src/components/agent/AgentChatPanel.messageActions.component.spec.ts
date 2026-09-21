// 对话内核消息级操作的界面不变量（统一 AI 侧边栏 SH-05，design D12）。
//
// 守什么：开启 messageActions 的宿主（侧边栏）在已完成回复下看到「复制 / 重新提问」；复制拿到整条正文，
// 重新提问在当前会话重发对应的用户问题；生成中所有「重新提问」禁用、正在生成的那条不显示操作；
// 未开启的宿主（工作台等）界面不变。
// 坏掉的症状：生成中重复提问被服务端 409 拒绝；工作台突然多出按钮；复制只拿到半截。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/composables/useCurrentModel', async () => {
  const { ref } = await import('vue')
  return { useCurrentModel: () => ({ currentModel: ref(null) }) }
})
vi.mock('@/composables/useAgentHealth', async () => {
  const { ref, computed } = await import('vue')
  const status = ref('online')
  return {
    useAgentHealth: () => ({
      status, offline: computed(() => false), online: computed(() => true),
      check: vi.fn(async () => 'online'), recheck: vi.fn(async () => 'online'), stop: vi.fn()
    })
  }
})
vi.mock('@/services/agent/agentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agent/agentClient')>()
  return {
    ...actual,
    fetchHistoryTranscript: vi.fn(async (id: string) => ({
      session_id: id, scenario: 'chat', title: '历史', archived: false,
      messages: [
        { seq: 1, role: 'user', text: '今天日前均价多少', segs: [] },
        { seq: 2, role: 'assistant', text: '', segs: [{ kind: 'text', chunks: ['日前均价 149 元/MWh，', '峰谷价差较大'] }] }
      ]
    })),
    getActiveRun: vi.fn(async () => null),
    getAgentSession: vi.fn(async () => null),
    pingAgentService: vi.fn(async () => true),
    probeAgentService: vi.fn(async () => 'online'),
    sendAgentMessage: vi.fn(() => new Promise(() => {})) // 永不结束：保持「生成中」
  }
})

import AgentChatPanel from './AgentChatPanel.vue'
import { sendAgentMessage } from '@/services/agent/agentClient'

const writeText = vi.fn(async () => {})
beforeEach(() => {
  vi.mocked(sendAgentMessage).mockClear()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()) })

async function mountPanel(messageActions?: boolean) {
  const w = mount(AgentChatPanel, {
    props: { resumeSessionId: 's_hist', historyKey: 'test_message_actions', restoreLastSession: false, ...(messageActions === undefined ? {} : { messageActions }) }
  })
  wrappers.push(w)
  await flushPromises()
  await flushPromises()
  return w
}

describe('AgentChatPanel · 消息级操作', () => {
  it('开启后：已完成回复下有「复制」，复制内容为整条正文', async () => {
    const w = await mountPanel(true)
    const actions = w.findAll('.msg-actions')
    expect(actions).toHaveLength(1)
    await actions[0].findAll('button')[0].trigger('click')
    expect(writeText).toHaveBeenCalledWith('日前均价 149 元/MWh，峰谷价差较大')
  })

  it('重新提问发出对应的用户问题；生成中禁用重新提问、正在生成的那条不显示操作', async () => {
    const w = await mountPanel(true)
    const regen = w.findAll('.msg-actions')[0].findAll('button')[1]
    expect(regen.attributes('disabled')).toBeUndefined()
    await regen.trigger('click')
    await flushPromises()
    expect(vi.mocked(sendAgentMessage)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendAgentMessage).mock.calls[0][1]).toBe('今天日前均价多少')

    // 生成中：旧回复的「重新提问」禁用；新一条（正在生成）没有操作行
    const rows = w.findAll('.msg-actions')
    expect(rows).toHaveLength(1)
    expect(rows[0].findAll('button')[1].attributes('disabled')).toBeDefined()
  })

  it('默认不开启（工作台等宿主）：不渲染任何消息级操作', async () => {
    const w = await mountPanel()
    expect(w.find('.msg-actions').exists()).toBe(false)
  })
})
