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

type KernelRec = { props: Record<string, unknown>; asks: string[]; contexts: unknown[]; unmounted: boolean; emit: (e: string, ...a: unknown[]) => void; ready: () => void }
// __manualReady：内核挂载后不自动发 ready（模拟续接会话还没完成），由用例调用 rec.ready()
const g = globalThis as unknown as { __kernels: KernelRec[]; __canWorkbench: boolean; __user: { roleCode: string; username: string }; __manualReady: boolean }
g.__kernels = []
g.__manualReady = false
g.__canWorkbench = true
g.__user = { roleCode: 'TRADER', username: 'trader' }

vi.mock('@/components/agent/AgentChatPanel.vue', async () => {
  const { defineComponent, h, onMounted, onUnmounted } = await import('vue')
  return {
    default: defineComponent({
      name: 'AgentChatPanelStub',
      props: {
        scenario: String, promptKey: String, resumeSessionId: { type: String, default: null }, resumeRunId: { type: String, default: null },
        restoreLastSession: { type: Boolean, default: true }, messageActions: { type: Boolean, default: false },
        contextPayloadFor: Function, historyKey: String, payload: Object,
        commandHost: { type: String, default: 'agent' }, extraCommands: { type: Array, default: () => [] },
        approvalAutoApprove: { type: Boolean, default: false }
      },
      emits: ['ready', 'sessionReady', 'streamingChange', 'sessionBusy', 'conversationReset', 'openScenario', 'done', 'historyChanged'],
      setup(props, { emit, expose, slots }) {
        const rec: KernelRec = { props: props as Record<string, unknown>, asks: [], contexts: [], unmounted: false, emit: emit as KernelRec['emit'], ready: () => emit('ready') }
        const shared = globalThis as unknown as { __kernels: KernelRec[]; __manualReady: boolean }
        shared.__kernels.push(rec)
        // 与真实内核一致：挂载初始化完成后发 ready
        onMounted(() => { if (!shared.__manualReady) emit('ready') })
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
        return () => h('div', { class: 'kernel-stub' }, [slots['conversation-top']?.(), slots['composer-top']?.()])
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
          // 侧边栏里开的申报前体检会话：场景是 chat，来源是 ai_center
          h('button', { class: 'pick-pre-sidebar', onClick: () => emit('select', 's_pre', 'chat', 'ai_center') }),
          // 工作台里开的申报前体检会话：来源 key 就是入口 key
          h('button', { class: 'pick-pre-workbench', onClick: () => emit('select', 's_pre_wb', 'chat', 'pre_submit_check') }),
          h('button', { class: 'pick-new', onClick: () => emit('newChat') })
        ])
      }
    })
  }
})
vi.mock('@/services/agent/agentClient', () => ({ listRuns: vi.fn(async () => []), stopAgentRun: vi.fn(async () => true) }))
vi.mock('@/services/agent/piPocClient', () => ({ fetchPiSessionMeta: vi.fn(async () => null) }))
vi.mock('@/components/agent/workbench/MorningBriefRail.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MorningBriefRailStub',
      props: { date: String },
      setup(props, { expose }) {
        const g = globalThis as unknown as { __briefOrder: string[]; __briefGate: Promise<void> | null }
        // __briefGate：模拟预检取数很慢，用例放行后才完成
        expose({ ensureLoaded: async () => { g.__briefOrder.push(`ensureLoaded:${props.date}`); await g.__briefGate } })
        return () => h('div', { class: 'brief-stub' }, props.date)
      }
    })
  }
})
vi.mock('@/components/agent/workbench/StrategicQaGaps.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'GapsStub', setup: () => () => h('div', { class: 'gaps-stub' }) }) }
})
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
import { currentRegion } from '@/services/region/regionContext'
import { fetchPiSessionMeta } from '@/services/agent/piPocClient'
import { listRuns } from '@/services/agent/agentClient'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { activatePage, activeAiPage, deactivatePage, type AiPageDefinition } from './pageRegistry'
import { resetAiSidebarForTest, switchSession, useAiSidebar } from './useAiSidebar'
import { buildExpertLaunch } from './expertCommands'
import { findEntry } from '@/services/agent/workbenchEntries'

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
    g.__manualReady = false
    g.__canWorkbench = true
    g.__user = { roleCode: 'TRADER', username: 'trader' }
    window.localStorage.clear()
    resetAiSidebarForTest()
    vi.mocked(listRuns).mockReset().mockResolvedValue([])
    vi.mocked(fetchPiSessionMeta).mockReset().mockResolvedValue(null)
  })

  it('新挂的内核初始化完成（ready）之前不发问；等待期间又切换了会话，这条问题作废（实机：刷新后马上解读被吞）', async () => {
    g.__manualReady = true
    const { w } = await setup()
    const ai = useAiSidebar()
    ai.interpret()
    await settle()
    const first = live()[0]
    expect(first.asks).toEqual([])
    first.ready()
    await settle()
    expect(first.asks).toHaveLength(1)

    // 换角色提问 → 新开会话、新内核；它初始化完成前用户点了新建对话
    ai.ask('驾驶舱里的问题', { promptKey: PAGE_PROMPT_KEYS.workbench })
    await settle()
    const second = live()[0]
    expect(second).not.toBe(first)
    expect(second.asks).toEqual([])
    await w.find('button[title="新建对话"]').trigger('click')
    await settle()
    const third = live()[0]
    expect(third).not.toBe(second)
    second.ready()
    third.ready()
    await settle()
    expect(second.asks).toEqual([])
    expect(third.asks).toEqual([])
  })

  it('被替换的旧内核在卸载前发出的 ready 不算新内核就绪', async () => {
    g.__manualReady = true
    await setup()
    const ai = useAiSidebar()
    ai.open()
    await settle()
    const first = live()[0]
    switchSession({ sessionId: null, scenario: 'chat', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, sourceRoute: '/sjfx/fshq', entryKey: 'workbench', title: '' })
    first.ready() // 切换已生效、旧内核还没卸载
    ai.interpret() // 同页同角色：续聊这条记录，发给新内核
    await settle()
    const second = live()[0]
    expect(second).not.toBe(first)
    expect(second.asks).toEqual([])
    second.ready()
    await settle()
    expect(second.asks).toHaveLength(1)
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
    g.__manualReady = false
    g.__canWorkbench = true
    window.localStorage.clear()
    resetAiSidebarForTest()
    vi.mocked(listRuns).mockReset().mockResolvedValue([])
    vi.mocked(fetchPiSessionMeta).mockReset().mockResolvedValue(null)
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

  it('重新打开申报前体检会话：按 pi 记下的解读角色找回入口与合成数据水印（dljy-web#121 审查 P1）', async () => {
    vi.mocked(fetchPiSessionMeta).mockReset().mockImplementation(async (id: string) => (id === 's_pre' ? { promptKey: PAGE_PROMPT_KEYS.preSubmitCheck, autoApprove: false } : null))
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    await w.find('.ai-title').trigger('click')
    await w.find('.pick-pre-sidebar').trigger('click')
    await settle()
    expect(live()).toHaveLength(1)
    expect(live()[0].props.resumeSessionId).toBe('s_pre')
    expect(useAiSidebar().state.session?.entryKey).toBe('pre_submit_check')
    expect(live()[0].props.promptKey).toBe(PAGE_PROMPT_KEYS.preSubmitCheck)
    expect(w.find('[data-testid="ai-watermark"]').text()).toContain('advisory_only')

    // pi 已不认识该会话时：工作台开的会话按来源 key 找回入口
    await w.find('.ai-title').trigger('click')
    await w.find('.pick-pre-workbench').trigger('click')
    await settle()
    expect(live()[0].props.resumeSessionId).toBe('s_pre_wb')
    expect(useAiSidebar().state.session?.entryKey).toBe('pre_submit_check')
    expect(w.find('[data-testid="ai-watermark"]').exists()).toBe(true)
  })

  it('运行中列表的行自带解读角色：直接据此找回入口；需要查询时先切换、查回来只补全记录（dljy-web#121 审查 P1）', async () => {
    vi.mocked(fetchPiSessionMeta).mockReset().mockResolvedValue(null)
    vi.mocked(listRuns).mockResolvedValue([
      { run_id: 'r_pre', session_id: 's_pre_run', turn_seq: 1, status: 'running', created_at: 1, updated_at: 1, last_seq: 3, session_title: '申报前体检', page_key: 'ai_center', prompt_key: PAGE_PROMPT_KEYS.preSubmitCheck, scenario: 'chat' }
    ])
    const { w } = await setup()
    useAiSidebar().open()
    await settle()
    await w.find('.ai-runs-badge').trigger('click')
    await settle()
    expect(w.find('.run-meta').text()).toContain('第 1 轮') // pi 的 turn_seq 从 1 起算
    await w.find('.run-main').trigger('click')
    await settle()
    expect(fetchPiSessionMeta).not.toHaveBeenCalled()
    expect(useAiSidebar().state.session?.entryKey).toBe('pre_submit_check')
    expect(live()[0].props.resumeRunId).toBe('r_pre')

    // 查询很慢：切换立即发生（不被查询挡住），查回来只补全记录、不重挂内核——期间用户在这个会话里发的消息不受影响
    type Meta = Awaited<ReturnType<typeof fetchPiSessionMeta>>
    let resolveMeta: (v: Meta) => void = () => {}
    vi.mocked(fetchPiSessionMeta).mockImplementation(() => new Promise((r) => { resolveMeta = r }))
    await w.find('.ai-title').trigger('click')
    await w.find('.pick-pre-sidebar').trigger('click')
    await settle()
    const opened = live()[0]
    expect(opened.props.resumeSessionId).toBe('s_pre')
    expect(useAiSidebar().state.session?.entryKey).toBe('workbench')
    resolveMeta({ promptKey: PAGE_PROMPT_KEYS.preSubmitCheck, autoApprove: false })
    await settle()
    expect(live()[0]).toBe(opened)
    expect(useAiSidebar().state.session?.entryKey).toBe('pre_submit_check')
    expect(w.find('[data-testid="ai-watermark"]').exists()).toBe(true)

    // 查询期间点了新建对话：查回来的结果不改动新的空白对话
    vi.mocked(fetchPiSessionMeta).mockImplementation(() => new Promise((r) => { resolveMeta = r }))
    await w.find('.ai-title').trigger('click')
    await w.find('.pick-pre-sidebar').trigger('click')
    await settle()
    await w.find('button[title="新建对话"]').trigger('click')
    await settle()
    resolveMeta({ promptKey: PAGE_PROMPT_KEYS.preSubmitCheck, autoApprove: false })
    await settle()
    expect(useAiSidebar().state.session).toBeNull()
    expect(live()[0].props.resumeSessionId).toBeNull()
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

describe('AiSidebar · 专家命令（EC-01/02/03）', () => {
  beforeEach(() => {
    g.__kernels = []
    g.__manualReady = false
    g.__canWorkbench = true
    g.__user = { roleCode: 'TRADER', username: 'trader' }
    ;(globalThis as unknown as { __briefOrder: string[] }).__briefOrder = []
    ;(globalThis as unknown as { __briefGate: Promise<void> | null }).__briefGate = null
    ;(currentRegion as unknown as { value: { id: string; name: string } }).value = { id: 'yunnan', name: '云南省' }
    window.localStorage.clear()
    resetAiSidebarForTest()
    vi.mocked(listRuns).mockReset().mockResolvedValue([])
    vi.mocked(fetchPiSessionMeta).mockReset().mockResolvedValue(null)
  })

  it('/晨报：就地新开晨报会话（场景/角色/入口），先装配预检卡再发目标日，页面不跳转', async () => {
    const { w, router } = await setup()
    const push = vi.spyOn(router, 'push')
    const order = (globalThis as unknown as { __briefOrder: string[] }).__briefOrder
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('morning_brief')!, '2026-09-17', '云南省'))
    await settle()
    const k = live()[0]
    expect(k.props.scenario).toBe('morning_brief')
    expect(k.props.promptKey).toBe('morning_brief')
    expect(useAiSidebar().state.session?.entryKey).toBe('morning_brief')
    expect(w.find('[data-testid="ai-brief-card"]').text()).toContain('2026-09-17')
    expect(order).toEqual(['ensureLoaded:2026-09-17'])
    expect(k.asks).toEqual(['2026-09-17'])
    expect(w.find('.ai-title-text').text()).toBe('交易晨报 · 2026-09-17')
    expect(push).not.toHaveBeenCalled()
  })

  it('晨报预检取数期间用户又发起了别的会话：预检回来后不把晨报日期发进新会话（dljy-web#121 审查 P1）', async () => {
    let release: () => void = () => {}
    ;(globalThis as unknown as { __briefGate: Promise<void> | null }).__briefGate = new Promise((r) => { release = r })
    await setup()
    const ai = useAiSidebar()
    ai.startExpert(buildExpertLaunch(findEntry('morning_brief')!, '2026-09-17', '云南省'))
    await settle()
    const brief = live()[0]
    expect(brief.asks).toEqual([])
    ai.startExpert(buildExpertLaunch(findEntry('strategic_qa')!, '新能源渗透率上升对价差有什么影响', '云南省'))
    await settle()
    const next = live()[0]
    expect(next).not.toBe(brief)
    expect(next.asks).toEqual(['新能源渗透率上升对价差有什么影响'])
    release()
    await settle()
    expect(next.asks).toEqual(['新能源渗透率上升对价差有什么影响'])
    expect(brief.asks).toEqual([])
  })

  it('晨报预检取数期间切换了地区：不把新地区的日期配上旧地区的预检卡发出去（dljy-web#121 审查 P1）', async () => {
    let release: () => void = () => {}
    ;(globalThis as unknown as { __briefGate: Promise<void> | null }).__briefGate = new Promise((r) => { release = r })
    await setup()
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('morning_brief')!, '2026-09-17', '云南省'))
    await settle()
    const brief = live()[0]
    ;(currentRegion as unknown as { value: { id: string; name: string } }).value = { id: 'shanxi', name: '山西省' }
    release()
    await settle()
    expect(live()[0]).toBe(brief)
    expect(brief.asks).toEqual([])
  })

  it('晨报预检取数期间用户自己发过一轮：不再把目标日补发成第二轮（dljy-web#121 第四轮审查 P2）', async () => {
    let release: () => void = () => {}
    ;(globalThis as unknown as { __briefGate: Promise<void> | null }).__briefGate = new Promise((r) => { release = r })
    await setup()
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('morning_brief')!, '2026-09-17', '云南省'))
    await settle()
    const brief = live()[0]
    brief.emit('streamingChange', true) // 用户在预检完成前手动提问，并且这一轮已经答完
    brief.emit('streamingChange', false)
    release()
    await settle()
    expect(live()[0]).toBe(brief)
    expect(brief.asks).toEqual([])
  })

  it('晨报：内核就绪之前用户已手动发出一轮，就绪、预检都完成后也不补发目标日（dljy#2962）', async () => {
    g.__manualReady = true
    await setup()
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('morning_brief')!, '2026-09-17', '云南省'))
    await settle()
    const brief = live()[0]
    brief.emit('streamingChange', true) // 就绪前输入框已可用，用户先发了一轮
    brief.emit('streamingChange', false)
    brief.ready()
    await settle()
    expect(brief.asks).toEqual([])
  })

  it('/战略问答 不带问题：新开会话但不发问，对话内可查看数据缺口清单', async () => {
    const { w } = await setup()
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('strategic_qa')!, '', '云南省'))
    await settle()
    expect(live()[0].props.scenario).toBe('strategic_qa')
    expect(live()[0].asks).toEqual([])
    expect(w.find('[data-testid="ai-gaps-card"]').exists()).toBe(true)
  })

  it('/申报前体检：结论区带不可移除的合成数据水印', async () => {
    const { w } = await setup()
    useAiSidebar().startExpert(buildExpertLaunch(findEntry('pre_submit_check')!, '', '云南省'))
    await settle()
    const mark = w.find('[data-testid="ai-watermark"]')
    expect(mark.text()).toContain('advisory_only')
    expect(mark.find('button').exists()).toBe(false)
  })

  it('内核发出跨场景 openScenario（如复盘技能）：侧边栏就地新开该场景会话并发问', async () => {
    await setup()
    useAiSidebar().open()
    await settle()
    const first = live()[0]
    first.emit('openScenario', '2026-09-15', 'daily_review')
    await settle()
    expect(first.unmounted).toBe(true)
    expect(live()[0].props.scenario).toBe('daily_review')
    expect(live()[0].asks).toEqual(['2026-09-15'])
  })

  it('专家命令注入内核：有工作台权限可见；无权限全部隐藏', async () => {
    const allowed = await setup()
    useAiSidebar().open()
    await settle()
    const visible = (live()[0].props.extraCommands as Array<{ name: string; hidden?: boolean }>).filter((c) => !c.hidden).map((c) => c.name)
    expect(visible.sort()).toEqual(['战略问答', '晨报', '申报体检', '申报前体检'].sort())
    expect(live()[0].props.commandHost).toBe('sidebar')
    expect(live()[0].props.approvalAutoApprove).toBe(true)
    allowed.w.unmount()

    g.__kernels = []
    g.__canWorkbench = false
    resetAiSidebarForTest()
    await setup()
    useAiSidebar().open()
    await settle()
    expect((live()[0].props.extraCommands as Array<{ hidden?: boolean }>).every((c) => c.hidden)).toBe(true)
  })
})
