// 侧边栏解读角色复位不变量（dljy-web#118 codex 审查 P1）。
//
// 守什么：页面发起的提问用该页的解读角色建会话；会话被清空重置（/clear、新建）后，下一次自由提问
// 新建的会话必须回到通用对话角色，不能沿用上一页的解读角色。
// 坏掉的症状：在驾驶舱清空对话后随手问一句，服务端按「分时行情解读」的角色回答，页面背景却是驾驶舱。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

type KernelRec = { props: Record<string, unknown>; asks: string[]; unmounted: boolean; emit: (e: string, ...a: unknown[]) => void }
const g = globalThis as unknown as { __resetKernels: KernelRec[] }
g.__resetKernels = []

vi.mock('@/components/agent/AgentChatPanel.vue', async () => {
  const { defineComponent, h, onUnmounted } = await import('vue')
  return {
    default: defineComponent({
      name: 'AgentChatPanelStub',
      props: {
        scenario: String, promptKey: String, resumeSessionId: { type: String, default: null },
        restoreLastSession: { type: Boolean, default: true }, messageActions: { type: Boolean, default: false },
        contextPayloadFor: Function, historyKey: String, payload: Object
      },
      emits: ['sessionReady', 'streamingChange', 'sessionBusy', 'conversationReset', 'done', 'historyChanged'],
      setup(props, { emit, expose, slots }) {
        const rec: KernelRec = { props: props as Record<string, unknown>, asks: [], unmounted: false, emit: emit as KernelRec['emit'] }
        ;(globalThis as unknown as { __resetKernels: KernelRec[] }).__resetKernels.push(rec)
        onUnmounted(() => { rec.unmounted = true })
        expose({ ask: (q: string) => { rec.asks.push(q); return true }, newConversation: () => emit('conversationReset') })
        return () => h('div', { class: 'kernel-stub' }, slots['composer-top']?.())
      }
    })
  }
})
vi.mock('@/components/agent/AgentHistorySidebar.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ name: 'HistoryStub', setup: (_p, { expose }) => { expose({ reload: async () => {} }); return () => h('div') } }) }
})
vi.mock('@/services/agent/agentClient', () => ({ listRuns: vi.fn(async () => []), stopAgentRun: vi.fn(async () => true) }))
vi.mock('@/services/governance', () => ({ canAccessPath: vi.fn(() => true) }))
vi.mock('@/services/auth', () => ({ getCurrentUser: vi.fn(() => ({ roleCode: 'TRADER' })) }))
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
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { activatePage, activeAiPage, deactivatePage } from './pageRegistry'
import { resetAiSidebarForTest, useAiSidebar } from './useAiSidebar'

const mounted: Array<{ unmount: () => void }> = []
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

describe('AiSidebar · 解读角色在会话重置后复位', () => {
  beforeEach(() => {
    g.__resetKernels = []
    window.localStorage.clear()
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
  })

  it('页面解读用页面角色；清空重置后，新会话的角色回到通用对话', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/sjfx/fshq', component: { template: '<div />' }, meta: { title: '分时行情' } },
        { path: '/dashboard', component: { template: '<div />' }, meta: { title: '现货交易驾驶舱' } }
      ]
    })
    await router.push('/sjfx/fshq')
    activatePage({ label: '分时行情', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: () => ({ d: 1 }) } })
    const w = mount(AiSidebar, { global: { plugins: [router] } })
    mounted.push(w)
    useAiSidebar().interpret()
    await flushPromises(); await nextTick(); await nextTick(); await flushPromises()
    const live = () => g.__resetKernels.filter((k) => !k.unmounted)
    expect(live()[0].props.promptKey).toBe(PAGE_PROMPT_KEYS.marketDataAnalysis)

    await router.push('/dashboard')
    live()[0].emit('conversationReset')
    await flushPromises(); await nextTick(); await nextTick(); await flushPromises()
    expect(live()[0].props.promptKey).toBe(PAGE_PROMPT_KEYS.workbench)
  })
})
