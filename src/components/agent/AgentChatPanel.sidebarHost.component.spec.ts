// 对话内核在侧边栏宿主下的不变量（统一 AI 侧边栏 EC-02/EC-04，design D8/D10）。
//
// 守什么：①commandHost=sidebar 时跨场景技能不跳转工作台，而是发 openScenario 由侧边栏就地新开会话；
// 工作台（agent 宿主）行为不变。②审批卡上的「本会话内自动执行」只在宿主开启 + 申报体检会话 + L1 卡片时出现；
// L2（对外提交）、缺 level 字段的旧卡片、其他会话、宿主未开启一律不出现；切换调用会话级授权接口。
// 坏掉的症状：侧边栏里敲 /复盘报告 被带离当前页；对外提交审批卡出现自动执行选项。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/composables/useCurrentModel', async () => {
  const { ref } = await import('vue')
  return { useCurrentModel: () => ({ currentModel: ref(null) }) }
})
vi.mock('@/composables/useAgentHealth', async () => {
  const { ref, computed } = await import('vue')
  return {
    useAgentHealth: () => ({
      status: ref('online'), offline: computed(() => false), online: computed(() => true),
      check: vi.fn(async () => 'online'), recheck: vi.fn(async () => 'online'), stop: vi.fn()
    })
  }
})
vi.mock('@/services/agent/piPocClient', () => ({ setSessionAutoApprove: vi.fn(async (_id: string, enabled: boolean) => enabled) }))
vi.mock('@/services/agent/agentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agent/agentClient')>()
  const g = globalThis as unknown as { __approvalPayload: Record<string, unknown>; __sessionScenario: string }
  return {
    ...actual,
    fetchAgentSkills: vi.fn(async () => []),
    fetchHistoryTranscript: vi.fn(async () => null),
    listHistorySessions: vi.fn(async () => []),
    getActiveRun: vi.fn(async () => null),
    getAgentSession: vi.fn(async () => null),
    probeAgentService: vi.fn(async () => 'online'),
    pingAgentService: vi.fn(async () => true),
    createAgentSession: vi.fn(async () => ({ id: 's_chk', scenario: g.__sessionScenario, title: '', status: 'idle' })),
    sendAgentMessage: vi.fn(async (_id: string, _content: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'approval_request', payload: g.__approvalPayload })
    }),
    sendAgentApproval: vi.fn(async (_id: string, _action: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'done', status: 'completed' })
    })
  }
})

import AgentChatPanel from './AgentChatPanel.vue'
import { setSessionAutoApprove } from '@/services/agent/piPocClient'

const g = globalThis as unknown as { __approvalPayload: Record<string, unknown>; __sessionScenario: string }
const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()) })
beforeEach(() => {
  push.mockClear()
  vi.mocked(setSessionAutoApprove).mockClear()
  window.localStorage.clear()
})

async function mountKernel(props: Record<string, unknown>) {
  const w = mount(AgentChatPanel, { props: { historyKey: 'test_sidebar_host', restoreLastSession: false, ...props } })
  wrappers.push(w)
  await flushPromises()
  return w
}
async function typeAndEnter(w: Awaited<ReturnType<typeof mountKernel>>, text: string) {
  const ta = w.find('textarea')
  await ta.setValue(text)
  await flushPromises()
  await ta.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

describe('AgentChatPanel · commandHost', () => {
  it('sidebar 宿主：跨场景技能 /复盘报告 发 openScenario（复盘场景 + 日期），不跳转工作台', async () => {
    const w = await mountKernel({ commandHost: 'sidebar' })
    await typeAndEnter(w, '/复盘报告 2026-09-15')
    expect(push).not.toHaveBeenCalled()
    expect(w.emitted('openScenario')).toEqual([['2026-09-15', 'daily_review']])
  })

  it('agent 宿主（工作台）：同一命令照旧跳转工作台对应场景', async () => {
    const w = await mountKernel({})
    await typeAndEnter(w, '/复盘报告 2026-09-15')
    expect(push).toHaveBeenCalledWith({ path: '/ai-agent', query: { scenario: 'daily_review', q: '2026-09-15' } })
    expect(w.emitted('openScenario')).toBeUndefined()
  })

  it('补全菜单：可见的注入命令出现，隐藏命令（无权限）不出现', async () => {
    const shown = await mountKernel({ commandHost: 'sidebar', extraCommands: [{ name: '晨报', description: '交易晨报', source: 'builtin', hosts: ['sidebar'], run: vi.fn() }] })
    await shown.find('textarea').setValue('/晨')
    await flushPromises()
    expect(shown.findAll('.slash-menu .sm-title').map((t) => t.text()).join(' ')).toContain('/晨报')

    const hidden = await mountKernel({ commandHost: 'sidebar', extraCommands: [{ name: '晨报', description: '交易晨报', source: 'builtin', hosts: ['sidebar'], hidden: true, run: vi.fn() }] })
    await hidden.find('textarea').setValue('/晨')
    await flushPromises()
    expect(hidden.findAll('.slash-menu .sm-title').map((t) => t.text()).join(' ')).not.toContain('/晨报')
  })

  it('宿主注入的专家命令可以执行', async () => {
    const run = vi.fn()
    const w = await mountKernel({ commandHost: 'sidebar', extraCommands: [{ name: '晨报', description: 'x', source: 'builtin', hosts: ['sidebar'], run }] })
    await typeAndEnter(w, '/晨报 2026-09-17')
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: '2026-09-17', host: 'sidebar' }))
  })
})

describe('AgentChatPanel · 审批卡自动执行开关', () => {
  const L1 = { type: 'declaration_approval', target_date: '2026-09-17', draft: { points: 96, strategy_note: '草稿' }, tool: 'save_declaration_draft', level: 'L1' }

  async function withApproval(payload: Record<string, unknown>, scenario: string, approvalAutoApprove: boolean) {
    g.__approvalPayload = payload
    g.__sessionScenario = scenario
    const w = await mountKernel({ scenario, approvalAutoApprove })
    await typeAndEnter(w, '帮我落库草稿')
    expect(w.find('.approval-card').exists()).toBe(true)
    return w
  }

  it('申报体检会话 + L1 卡片 + 宿主开启：显示开关，勾选即开启本会话授权', async () => {
    const w = await withApproval(L1, 'declaration_checkup', true)
    const toggle = w.find('[data-testid="approval-auto-approve"] input')
    expect(toggle.exists()).toBe(true)
    await toggle.setValue(true)
    await flushPromises()
    expect(setSessionAutoApprove).toHaveBeenCalledWith('s_chk', true)
  })

  it('开启后批准审批卡：卡片收起，输入框上方仍有「已开启」提示可随时关闭；卸载时主动撤销（dljy-web#121 审查 P1）', async () => {
    const w = await withApproval(L1, 'declaration_checkup', true)
    await w.find('[data-testid="approval-auto-approve"] input').setValue(true)
    await flushPromises()
    expect(w.find('[data-testid="auto-approve-active"]').exists()).toBe(true)

    await w.find('.approval-card .btn.approve').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="approval-auto-approve"]').exists()).toBe(false) // 卡片已处理
    const bar = w.find('[data-testid="auto-approve-active"]')
    expect(bar.exists()).toBe(true)
    await bar.find('button').trigger('click')
    await flushPromises()
    expect(setSessionAutoApprove).toHaveBeenLastCalledWith('s_chk', false)
    expect(w.find('[data-testid="auto-approve-active"]').exists()).toBe(false)

    // 开启后新建对话（切走会话、内核不卸载）：旧会话的服务端授权随之撤销
    vi.mocked(setSessionAutoApprove).mockClear()
    const switching = await withApproval(L1, 'declaration_checkup', true)
    await switching.find('[data-testid="approval-auto-approve"] input').setValue(true)
    await flushPromises()
    ;(switching.vm as unknown as { newConversation: () => void }).newConversation()
    await flushPromises()
    expect(setSessionAutoApprove).toHaveBeenLastCalledWith('s_chk', false)
    expect(switching.find('[data-testid="auto-approve-active"]').exists()).toBe(false)

    // 再开启一次，然后直接离开（卸载）：服务端授权随之撤销
    vi.mocked(setSessionAutoApprove).mockClear()
    const again = await withApproval(L1, 'declaration_checkup', true)
    await again.find('[data-testid="approval-auto-approve"] input').setValue(true)
    await flushPromises()
    again.unmount()
    await flushPromises()
    expect(setSessionAutoApprove).toHaveBeenLastCalledWith('s_chk', false)
  })

  it('对外提交（L2）卡片不显示开关；按风险级别判断，不只认工具名', async () => {
    const w = await withApproval({ ...L1, tool: 'submit_declaration', level: 'L2' }, 'declaration_checkup', true)
    expect(w.find('[data-testid="approval-auto-approve"]').exists()).toBe(false)
    // 日后新增的其它 L2 工具同样不显示：开关只给 L1
    const otherL2 = await withApproval({ ...L1, tool: 'withdraw_declaration', level: 'L2' }, 'declaration_checkup', true)
    expect(otherL2.find('[data-testid="approval-auto-approve"]').exists()).toBe(false)
  })

  it('缺 level 字段的旧卡片不显示（fail-closed）', async () => {
    const { level: _drop, ...legacy } = L1
    const w = await withApproval(legacy, 'declaration_checkup', true)
    expect(w.find('[data-testid="approval-auto-approve"]').exists()).toBe(false)
  })

  it('非申报体检会话、或宿主未开启：不显示', async () => {
    const chat = await withApproval(L1, 'chat', true)
    expect(chat.find('[data-testid="approval-auto-approve"]').exists()).toBe(false)
    const workbench = await withApproval(L1, 'declaration_checkup', false)
    expect(workbench.find('[data-testid="approval-auto-approve"]').exists()).toBe(false)
  })
})
