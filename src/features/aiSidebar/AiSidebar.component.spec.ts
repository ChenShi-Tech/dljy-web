// 统一 AI 侧边栏的会话与界面不变量（SH-02/03/04/06、SS-01~07）。
//
// 守什么：页面提问按规则续聊/新开（跨页解读不沿用上一页角色）；刷新恢复当前会话；存储不可用不崩；
// 运行中会话数量接口失败时隐藏而非显示 0；「在工作台打开」按工作台权限显示并带会话跳转；
// 历史/新建切换会话重挂内核；关闭侧边栏不卸载内核；服务端 409 时改在新会话重发一次。
// 坏掉的症状：解读答非所问（角色串了）、刷新丢对话、无权限角色看到工作台入口、运行中列表假装为空。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

type KernelRec = { props: Record<string, unknown>; asks: string[]; contexts: unknown[]; unmounted: boolean; emit: (e: string, ...a: unknown[]) => void }
const g = globalThis as unknown as { __kernels: KernelRec[]; __canWorkbench: boolean; __user: { roleCode: string; username: string } }
g.__kernels = []
g.__canWorkbench = true
g.__user = { roleCode: 'TRADER', username: 'trader' }

vi.mock('@/components/agent/AgentChatPanel.vue', async () => {
  const { defineComponent, h, onUnmounted } = await import('vue')
  return {
    default: defineComponent({
      name: 'AgentChatPanelStub',
      props: {
        scenario: String, promptKey: String, resumeSessionId: { type: String, default: null }, resumeRunId: { type: String, default: null },
        restoreLastSession: { type: Boolean, default: true }, messageActions: { type: Boolean, default: false },
        contextPayloadFor: Function, historyKey: String, payload: Object
      },
      emits: ['sessionReady', 'streamingChange', 'sessionBusy', 'done', 'historyChanged'],
      setup(props, { emit, expose, slots }) {
        const rec: KernelRec = { props: props as Record<string, unknown>, asks: [], contexts: [], unmounted: false, emit: emit as KernelRec['emit'] }
        ;(globalThis as unknown as { __kernels: KernelRec[] }).__kernels.push(rec)
        onUnmounted(() => { rec.unmounted = true })
        // 与真实内核一致：发送时按问题取本轮附带信息（会取走待发切片）
        expose({
          ask: (q: string) => {
            rec.asks.push(q)
            const f = (props as { contextPayloadFor?: (q: string) => unknown }).contextPayloadFor
            if (typeof f === 'function') rec.contexts.push(f(q))
            return true
          },
          newConversation: () => {}
        })
        return () => h('div', { class: 'kernel-stub' }, slots['composer-top']?.())
      }
    })
  }
})
vi.mock('@/components/agent/AgentHistorySidebar.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'AgentHistorySidebarStub',
      props: ['activeSessionId'],
      emits: ['select', 'newChat', 'update:collapsed'],
      setup(_p, { emit, expose }) {
        expose({ reload: async () => {} })
        return () => h('div', { class: 'history-stub' }, [
          h('button', { class: 'pick-brief', onClick: () => emit('select', 's_brief', 'morning_brief') }),
          h('button', { class: 'pick-new', onClick: () => emit('newChat') })
        ])
      }
    })
  }
})
vi.mock('@/services/agent/agentClient', () => ({ listRuns: vi.fn(async () => []), stopAgentRun: vi.fn(async () => true) }))
vi.mock('@/services/governance', () => ({ canAccessPath: vi.fn(() => (globalThis as unknown as { __canWorkbench: boolean }).__canWorkbench) }))
vi.mock('@/services/auth', () => ({ getCurrentUser: vi.fn(() => (globalThis as unknown as { __user: unknown }).__user) }))
vi.mock('@/services/region/regionContext', async () => {
  const { ref } = await import('vue')
  return { currentRegion: ref({ id: 'yunnan', name: '云南省' }) }
})
vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { currentCompany: ref({ companyId: 'c1', name: '中广核云南新能源' }) }
})
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import AiSidebar from './AiSidebar.vue'
import { listRuns } from '@/services/agent/agentClient'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { activatePage, activeAiPage, deactivatePage, type AiPageDefinition } from './pageRegistry'
import { resetAiSidebarForTest, switchSession, useAiSidebar } from './useAiSidebar'

const Empty = { template: '<div />' }
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/sjfx/fshq', component: Empty, meta: { title: '分时行情' } },
      { path: '/sjfx/zrsjg', component: Empty, meta: { title: '价格分析' } },
      { path: '/dashboard', component: Empty, meta: { title: '现货交易驾驶舱' } },
      { path: '/ai-agent', component: Empty }
    ]
  })
}
const FSHQ: AiPageDefinition = { label: '分时行情', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: () => ({ d: 1 }) } }
const PRICE: AiPageDefinition = { label: '价格分析', promptKey: PAGE_PROMPT_KEYS.marketOperations, interpret: { context: () => ({ d: 2 }) } }

// 侧边栏响应模块级单例状态：用例结束必须卸载，否则残留实例会跟着新用例的请求再建内核
const mounted: Array<{ unmount: () => void }> = []
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

async function setup(path = '/sjfx/fshq', page: AiPageDefinition | null = FSHQ) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const cur = activeAiPage().value
  if (cur) deactivatePage(cur)
  if (page) activatePage(page)
  const w = mount(AiSidebar, { global: { plugins: [router] } })
  mounted.push(w)
  await flushPromises()
  return { w, router }
}
const live = () => g.__kernels.filter((k) => !k.unmounted)
async function settle() {
  await flushPromises()
  await nextTick()
  await nextTick()
  await flushPromises()
}

describe('AiSidebar · 会话规则', () => {
  beforeEach(() => {
    g.__kernels = []
    g.__canWorkbench = true
    g.__user = { roleCode: 'TRADER', username: 'trader' }
    window.localStorage.clear()
    resetAiSidebarForTest()
    vi.mocked(listRuns).mockReset().mockResolvedValue([])
  })

  it('页面解读：挂载内核并以页面角色发出问题；同页再解读续聊同一内核', async () => {
    await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    expect(live()).toHaveLength(1)
    const first = live()[0]
    expect(first.props.promptKey).toBe(PAGE_PROMPT_KEYS.marketDataAnalysis)
    expect(first.props.scenario).toBe('chat')
    expect(first.props.restoreLastSession).toBe(false)
    expect(first.asks).toEqual([expect.stringContaining('请解读本页「分时行情」')])

    first.emit('sessionReady', 's_fshq')
    ai.interpret()
    await settle()
    expect(live()).toHaveLength(1)
    expect(live()[0]).toBe(first)
    expect(first.asks).toHaveLength(2)
  })

  it('跨页解读：新开会话（重挂内核、换成新页角色），旧内核卸载', async () => {
    const { router } = await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const first = live()[0]
    first.emit('sessionReady', 's_fshq')

    await router.push('/sjfx/zrsjg')
    deactivatePage(FSHQ)
    activatePage(PRICE)
    ai.interpret()
    await settle()
    expect(first.unmounted).toBe(true)
    expect(live()).toHaveLength(1)
    expect(live()[0].props.promptKey).toBe(PAGE_PROMPT_KEYS.marketOperations)
    expect(live()[0].asks).toEqual([expect.stringContaining('请解读本页「价格分析」')])
  })

  it('当前会话正在生成时，同页再提问改为新开会话', async () => {
    await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const first = live()[0]
    first.emit('sessionReady', 's_busy')
    first.emit('streamingChange', true)
    ai.ask('再看看峰谷价差')
    await settle()
    expect(first.unmounted).toBe(true)
    expect(live()[0].asks).toEqual(['再看看峰谷价差'])
  })

  it('服务端 409：改在新会话里重发一次（仍附带原数据切片），同一问题不无限重试', async () => {
    await setup()
    const ai = useAiSidebar()
    ai.ask('这条会撞 409', { context: { row: 7 } })
    await settle()
    const first = live()[0]
    expect((first.contexts[0] as { slice?: unknown }).slice).toEqual({ row: 7 })
    first.emit('sessionBusy', '这条会撞 409')
    await settle()
    const second = live()[0]
    expect(second).not.toBe(first)
    expect(second.asks).toEqual(['这条会撞 409'])
    expect((second.contexts[0] as { slice?: unknown }).slice).toEqual({ row: 7 })
    second.emit('sessionBusy', '这条会撞 409')
    await settle()
    expect(live()[0]).toBe(second)
  })

  it('刷新恢复：会话记录落存储，重新加载后以原场景续接该会话', async () => {
    const before = await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    live()[0].emit('sessionReady', 's_persist')
    await settle()

    // 模拟刷新：旧页面整体销毁、模块状态只能从存储读回
    before.w.unmount()
    g.__kernels = []
    resetAiSidebarForTest()
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    expect(w.find('.ai-title-text').text()).toBe('分时行情 · 解读')
    expect(live()[0].props.resumeSessionId).toBe('s_persist')
    expect(live()[0].props.scenario).toBe('chat')
  })

  it('存储不可用（隐私模式）时照常工作，不崩溃', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    expect(() => live()[0].emit('sessionReady', 's_nostore')).not.toThrow()
    expect(setItem).toHaveBeenCalled()
    expect(live()[0].asks).toHaveLength(1)
    setItem.mockRestore()
  })

  it('切换会话后、旧内核卸载前的窗口里，旧内核发出的事件被丢弃（dljy-web#119 审查 P1）', async () => {
    // Vue 3.5 会丢弃已卸载组件的 emit；真正的风险窗口是 switchSession 同步改了会话记录、
    // 而重挂内核的渲染刷新尚未发生——此时旧内核仍挂载，其在途建会话若恰好返回会发出 sessionReady。
    await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const stale = live()[0]

    switchSession({ sessionId: 's_brief', scenario: 'morning_brief', promptKey: '', sourceRoute: '', entryKey: 'morning_brief', title: '' })
    stale.emit('sessionReady', 's_stale')
    stale.emit('conversationReset')
    stale.emit('sessionBusy', '迟到的问题')
    await settle()

    expect(stale.unmounted).toBe(true)
    expect(useAiSidebar().state.session?.sessionId).toBe('s_brief')
    expect(live()).toHaveLength(1)
    expect(live()[0].props.resumeSessionId).toBe('s_brief')
    expect(live()[0].asks).toEqual([])
  })

  it('换账号登录不继承上一账号的会话；切回原账号仍能恢复自己的会话（dljy-web#119 审查 P2）', async () => {
    const first = await setup()
    useAiSidebar().interpret()
    await settle()
    live()[0].emit('sessionReady', 's_trader')
    await settle()
    first.w.unmount()

    g.__kernels = []
    g.__user = { roleCode: 'RISK', username: 'risk' }
    const other = await setup()
    useAiSidebar().open()
    await settle()
    expect(live()[0].props.resumeSessionId).toBeNull()
    expect(useAiSidebar().state.session).toBeNull()
    other.w.unmount()

    g.__kernels = []
    g.__user = { roleCode: 'TRADER', username: 'trader' }
    await setup()
    useAiSidebar().open()
    await settle()
    expect(live()[0].props.resumeSessionId).toBe('s_trader')
  })

  it('关闭侧边栏不卸载内核，再打开是同一个会话实例', async () => {
    await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const first = live()[0]
    ai.close()
    await settle()
    expect(first.unmounted).toBe(false)
    ai.open()
    await settle()
    expect(live()[0]).toBe(first)
  })
})

describe('AiSidebar · 头部与输入区', () => {
  beforeEach(() => {
    g.__kernels = []
    g.__canWorkbench = true
    window.localStorage.clear()
    resetAiSidebarForTest()
    vi.mocked(listRuns).mockReset().mockResolvedValue([])
  })

  it('运行中数量：有运行时显示数量；接口失败时隐藏，不显示 0', async () => {
    const run = (id: string) => ({ run_id: id, session_id: `s_${id}`, turn_seq: 0, status: 'running', created_at: 1, updated_at: 1, last_seq: 3, session_title: id, page_key: 'ai_center', scenario: 'chat' })
    vi.mocked(listRuns).mockResolvedValue([run('a'), run('b')])
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    expect(w.find('.ai-runs-badge').text()).toContain('2')

    vi.mocked(listRuns).mockRejectedValue(new Error('404'))
    useAiSidebar().close()
    await settle()
    useAiSidebar().open()
    await settle()
    expect(w.find('.ai-runs-badge').exists()).toBe(false)
    expect(w.text()).not.toMatch(/运行中\s*0/)
  })

  it('「在工作台打开」只对有工作台权限的角色显示，点击带入口与会话跳转', async () => {
    g.__canWorkbench = false
    const denied = await setup()
    useAiSidebar().open()
    await settle()
    expect(denied.w.find('button[title="在工作台打开"]').exists()).toBe(false)
    denied.w.unmount()

    g.__canWorkbench = true
    g.__kernels = []
    resetAiSidebarForTest()
    const { w, router } = await setup()
    const push = vi.spyOn(router, 'push')
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    live()[0].emit('sessionReady', 's_open')
    await w.find('button[title="在工作台打开"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ai-agent', query: { entry: 'workbench', session: 's_open' } })
    expect(useAiSidebar().state.open).toBe(false)
  })

  it('从「运行中」切过去：内核拿到会话与 run id；之后换到别的会话，run id 不再带过去（dljy-web#119 审查 P2）', async () => {
    vi.mocked(listRuns).mockResolvedValue([
      { run_id: 'r_live', session_id: 's_live', turn_seq: 0, status: 'running', created_at: 1, updated_at: 1, last_seq: 3, session_title: '在跑的会话', page_key: 'ai_center', scenario: 'chat' }
    ])
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    await w.find('.ai-runs-badge').trigger('click')
    await settle()
    await w.find('.run-main').trigger('click')
    await settle()
    expect(live()).toHaveLength(1)
    expect(live()[0].props.resumeSessionId).toBe('s_live')
    expect(live()[0].props.resumeRunId).toBe('r_live')

    await w.find('.ai-title').trigger('click')
    await w.find('.pick-brief').trigger('click')
    await settle()
    expect(live()[0].props.resumeSessionId).toBe('s_brief')
    expect(live()[0].props.resumeRunId).toBeNull()
  })

  it('会话标题：空白对话和从历史打开时采用内核回报的标题；页面请求自带的标题不被覆盖（dljy-web#119 审查 P2）', async () => {
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    expect(w.find('.ai-title-text').text()).toBe('新对话')
    live()[0].emit('sessionReady', 's_blank', '今天日前电价怎么样')
    await settle()
    expect(w.find('.ai-title-text').text()).toBe('今天日前电价怎么样')
    expect(useAiSidebar().state.session?.title).toBe('今天日前电价怎么样')

    await w.find('.ai-title').trigger('click')
    await w.find('.pick-brief').trigger('click')
    await settle()
    live()[0].emit('sessionReady', 's_brief', '09-16 晨报')
    await settle()
    expect(w.find('.ai-title-text').text()).toBe('09-16 晨报')

    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const pageTitle = useAiSidebar().state.session?.title
    expect(pageTitle).toBeTruthy()
    live()[0].emit('sessionReady', 's_page', '服务端按首问生成的标题')
    await settle()
    expect(useAiSidebar().state.session?.title).toBe(pageTitle)
  })

  it('从历史打开晨报会话：重挂内核续接该会话并按晨报场景；新建回到空白对话', async () => {
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    await w.find('.ai-title').trigger('click')
    await w.find('.pick-brief').trigger('click')
    await settle()
    expect(live()[0].props.resumeSessionId).toBe('s_brief')
    expect(live()[0].props.scenario).toBe('morning_brief')
    expect(useAiSidebar().state.session?.entryKey).toBe('morning_brief')

    await w.find('button[title="新建对话"]').trigger('click')
    await settle()
    expect(live()[0].props.resumeSessionId).toBeNull()
    expect(live()[0].props.promptKey).toBe(PAGE_PROMPT_KEYS.workbench)
  })

  it('页面背景条随页面更新；没有快捷问题时不渲染快捷问题区，有则点击即发送', async () => {
    const { w, router } = await setup('/dashboard', null)
    useAiSidebar().open()
    await settle()
    expect(w.find('[data-testid="ai-page-context"]').text()).toContain('现货交易驾驶舱')
    expect(w.find('[data-testid="ai-page-context"]').text()).toContain('云南省')
    expect(w.find('[data-testid="ai-presets"]').exists()).toBe(false)

    await router.push('/sjfx/fshq')
    activatePage({ ...FSHQ, presets: [{ label: '峰谷价差归因', question: '分析峰谷价差归因' }] })
    await settle()
    expect(w.find('[data-testid="ai-page-context"]').text()).toContain('分时行情')
    const preset = w.find('[data-testid="ai-presets"] button')
    expect(preset.text()).toBe('峰谷价差归因')
    await preset.trigger('click')
    await settle()
    expect(live()[0].asks).toContain('分析峰谷价差归因')
  })

  it('内核按侧边栏口径开启消息级操作', async () => {
    await setup()
    useAiSidebar().open()
    await settle()
    expect(live()[0].props.messageActions).toBe(true)
  })
})
