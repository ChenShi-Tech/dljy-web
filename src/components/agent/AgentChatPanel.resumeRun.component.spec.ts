// 对话内核「挂载即续接」的两条宿主契约（统一 AI 侧边栏，dljy-web#119 审查 P2）。
//
// 守什么：宿主同时给会话 id 与 run id 时，挂载就附着到这个 run——即便该会话的历史回放还拿不到
// （live-token-only 会话不在 Node 历史库），也按 live 会话信息降级续看；只给会话 id 时照旧先回放历史。
// 会话就绪事件带上会话标题，宿主据此显示头部标题。
// 坏掉的症状：从「运行中」点开正在跑的会话是一片空白、run 在后台继续却看不见；侧边栏标题恒为「历史对话」。
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
    fetchHistoryTranscript: vi.fn(),
    getActiveRun: vi.fn(async () => null),
    getAgentSession: vi.fn(async () => null),
    attachRunStream: vi.fn(() => new Promise(() => {})), // 永不结束：保持附着中
    pingAgentService: vi.fn(async () => true),
    probeAgentService: vi.fn(async () => 'online')
  }
})

import AgentChatPanel from './AgentChatPanel.vue'
import { attachRunStream, fetchHistoryTranscript, getAgentSession } from '@/services/agent/agentClient'

const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()) })
beforeEach(() => {
  vi.mocked(attachRunStream).mockClear()
  vi.mocked(fetchHistoryTranscript).mockReset()
  vi.mocked(getAgentSession).mockReset().mockResolvedValue(null)
})

async function mountPanel(props: Record<string, unknown>) {
  const w = mount(AgentChatPanel, {
    props: { historyKey: 'test_resume_run', restoreLastSession: false, ...props }
  })
  wrappers.push(w)
  await flushPromises()
  await flushPromises()
  return w
}

describe('AgentChatPanel · 挂载续接', () => {
  it('给了 run id：历史回放拿不到时按 live 会话信息降级，照样附着到这个 run', async () => {
    vi.mocked(fetchHistoryTranscript).mockRejectedValue(new Error('404'))
    vi.mocked(getAgentSession).mockResolvedValue({ id: 's_live', scenario: 'chat', title: '在跑的会话', status: 'running' })
    await mountPanel({ resumeSessionId: 's_live', resumeRunId: 'r_live' })
    expect(attachRunStream).toHaveBeenCalledTimes(1)
    expect(vi.mocked(attachRunStream).mock.calls[0].slice(0, 2)).toEqual(['s_live', 'r_live'])
  })

  it('只给会话 id：历史回放拿不到就不附着（保持原有续接行为）', async () => {
    vi.mocked(fetchHistoryTranscript).mockRejectedValue(new Error('404'))
    vi.mocked(getAgentSession).mockResolvedValue({ id: 's_live', scenario: 'chat', title: '在跑的会话', status: 'running' })
    await mountPanel({ resumeSessionId: 's_live' })
    expect(attachRunStream).not.toHaveBeenCalled()
  })

  it('会话就绪事件携带会话标题', async () => {
    vi.mocked(fetchHistoryTranscript).mockResolvedValue({
      session_id: 's_hist', scenario: 'chat', title: '09-16 晨报', archived: false,
      messages: [{ seq: 1, role: 'user', text: '今天晨报', segs: [] }]
    })
    const w = await mountPanel({ resumeSessionId: 's_hist' })
    expect(w.emitted('sessionReady')?.[0]).toEqual(['s_hist', '09-16 晨报'])
  })
})
