// 对话内核「挂载即续接」的两条宿主契约（统一 AI 侧边栏，dljy-web#119 审查 P2）。
//
// 守什么：宿主同时给会话 id 与 run id 时，挂载就附着到这个 run；只给会话 id 时先回放历史、再附着在途 run。
// 两条路径在历史回放拿不到时（live-token-only 会话不在 Node 历史库）都按 live 会话信息降级续看；
// pi 也不认识这个会话时不附着、不留下半个会话。会话就绪事件带上会话标题，宿主据此显示头部标题。
// 坏掉的症状：从「运行中」点开、或「在工作台打开」正在跑的会话是一片空白，run 在后台继续却看不见；
// 侧边栏标题恒为「历史对话」。
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
    createAgentSession: vi.fn(async () => ({ id: 's_new', scenario: 'chat', title: '新问题', status: 'idle' })),
    sendAgentMessage: vi.fn(() => new Promise(() => {})),
    pingAgentService: vi.fn(async () => true),
    probeAgentService: vi.fn(async () => 'online')
  }
})

import AgentChatPanel from './AgentChatPanel.vue'
import { attachRunStream, fetchHistoryTranscript, getActiveRun, getAgentSession, sendAgentMessage } from '@/services/agent/agentClient'

const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()) })
beforeEach(() => {
  vi.mocked(attachRunStream).mockClear()
  vi.mocked(sendAgentMessage).mockClear()
  vi.mocked(fetchHistoryTranscript).mockReset()
  vi.mocked(getAgentSession).mockReset().mockResolvedValue(null)
  vi.mocked(getActiveRun).mockReset().mockResolvedValue(null)
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

  it('只给会话 id（工作台 ?session=、刷新恢复）：历史回放拿不到时同样降级，并附着该会话在途的 run', async () => {
    vi.mocked(fetchHistoryTranscript).mockRejectedValue(new Error('404'))
    vi.mocked(getAgentSession).mockResolvedValue({ id: 's_live', scenario: 'chat', title: '在跑的会话', status: 'running' })
    vi.mocked(getActiveRun).mockResolvedValue({ run_id: 'r_active', status: 'running' } as Awaited<ReturnType<typeof getActiveRun>>)
    await mountPanel({ resumeSessionId: 's_live' })
    expect(attachRunStream).toHaveBeenCalledTimes(1)
    expect(vi.mocked(attachRunStream).mock.calls[0].slice(0, 2)).toEqual(['s_live', 'r_active'])
  })

  it('历史回放拿不到、pi 也不认识这个会话：不附着，面板保持空白新对话', async () => {
    vi.mocked(fetchHistoryTranscript).mockRejectedValue(new Error('404'))
    await mountPanel({ resumeSessionId: 's_gone' })
    expect(getActiveRun).not.toHaveBeenCalled()
    expect(attachRunStream).not.toHaveBeenCalled()
  })

  it('降级等待 live 会话信息期间用户已发新消息：迟到的结果不覆盖新会话与消息', async () => {
    vi.mocked(fetchHistoryTranscript).mockRejectedValue(new Error('404'))
    let resolveLive: (v: Awaited<ReturnType<typeof getAgentSession>>) => void = () => {}
    vi.mocked(getAgentSession).mockImplementation(() => new Promise((r) => { resolveLive = r }))
    const w = mount(AgentChatPanel, { props: { historyKey: 'test_resume_run', restoreLastSession: false, resumeSessionId: 's_live' } })
    wrappers.push(w)
    await flushPromises()
    expect(getAgentSession).toHaveBeenCalledTimes(1)
    ;(w.vm as unknown as { ask: (q: string) => boolean }).ask('新问题')
    await flushPromises()
    expect(sendAgentMessage).toHaveBeenCalledTimes(1)
    resolveLive({ id: 's_live', scenario: 'chat', title: '在跑的会话', status: 'running' })
    await flushPromises()
    expect(w.text()).toContain('新问题')
    expect(getActiveRun).not.toHaveBeenCalled()
    expect(vi.mocked(sendAgentMessage).mock.calls[0][0]).toBe('s_new')
  })

  it('历史回放在途时用户已发新消息：回放随后失败也不再降级，不覆盖新会话与消息（dljy-web#121 审查 P1）', async () => {
    let rejectHistory: (e: Error) => void = () => {}
    vi.mocked(fetchHistoryTranscript).mockImplementation(() => new Promise((_r, reject) => { rejectHistory = reject }))
    vi.mocked(getAgentSession).mockResolvedValue({ id: 's_live', scenario: 'chat', title: '在跑的会话', status: 'running' })
    const w = mount(AgentChatPanel, { props: { historyKey: 'test_resume_run', restoreLastSession: false, resumeSessionId: 's_live' } })
    wrappers.push(w)
    await flushPromises()
    expect(fetchHistoryTranscript).toHaveBeenCalledTimes(1)
    ;(w.vm as unknown as { ask: (q: string) => boolean }).ask('新问题')
    await flushPromises()
    expect(sendAgentMessage).toHaveBeenCalledTimes(1)
    rejectHistory(new Error('404'))
    await flushPromises()
    expect(getAgentSession).not.toHaveBeenCalled()
    expect(getActiveRun).not.toHaveBeenCalled()
    expect(w.text()).toContain('新问题')
    expect(vi.mocked(sendAgentMessage).mock.calls[0][0]).toBe('s_new')
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
