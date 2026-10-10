// 悬浮球 = 全站 AI 侧边栏入口的不变量（统一 AI 侧边栏 SH-01 / PI-06）。
//
// 守什么：全站可见；声明了解读的页面点它直接解读本页，没声明的页面只打开侧边栏、绝不自动发问；
// 侧边栏打开期间退场避让。
// 坏掉的症状：#40 后只在 8 个注册页出现，其它页面「玻璃球都没有了」；反过来若对没有切片的页面
// 自动发「数据已在上下文」式解读，模型只能编造（#2210/#2222）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import AiOrbLauncher from './AiOrbLauncher.vue'
import { activeAiPage, deactivatePage, defineAiPage } from './pageRegistry'
import { resetAiSidebarForTest, takeSliceFor, useAiSidebar } from './useAiSidebar'

vi.mock('@/components/orb/LiquidGlassOrb.vue', () => ({
  default: defineComponent({ name: 'LiquidGlassOrb', render: () => h('span') })
}))

function mountHostWithInsight(label: string, context: () => Record<string, unknown>) {
  const Host = defineComponent({
    setup() {
      defineAiPage({ label, promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context } })
      return () => h('div')
    }
  })
  return mount(Host)
}

describe('AiOrbLauncher · 全站入口，行为跟着页面能力走', () => {
  beforeEach(() => {
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
  })

  it('未声明解读的页面：球可见、提示「打开 AI 助手」，点击只打开侧边栏不发问', async () => {
    const orb = mount(AiOrbLauncher)
    await nextTick()
    const btn = orb.find('.ai-orb-launcher')
    expect(btn.attributes('style') ?? '').not.toContain('display: none')
    expect(btn.attributes('title')).toBe('打开 AI 助手')

    await btn.trigger('click')
    const { state } = useAiSidebar()
    expect(state.open).toBe(true)
    expect(state.request).toBeNull()
    orb.unmount()
  })

  it('声明了解读的页面：提示「解读本页：<页面名>」，点击发出本页解读并带上点击时刻的切片', async () => {
    let date = '2026-09-15'
    const host = mountHostWithInsight('分时行情', () => ({ date }))
    const orb = mount(AiOrbLauncher)
    await nextTick()
    const btn = orb.find('.ai-orb-launcher')
    expect(btn.attributes('title')).toBe('解读本页：分时行情')

    date = '2026-09-16' // 切片在点击时刻求值
    await btn.trigger('click')
    const { state } = useAiSidebar()
    expect(state.open).toBe(true)
    expect(state.request?.promptKey).toBe(PAGE_PROMPT_KEYS.marketDataAnalysis)
    expect(state.request?.question).toContain('请解读本页「分时行情」')
    expect(takeSliceFor(state.request!.question)).toEqual({ date: '2026-09-16' })
    orb.unmount()
    host.unmount()
  })

  it('侧边栏打开期间退场避让，关闭后回来', async () => {
    const orb = mount(AiOrbLauncher)
    const sidebar = useAiSidebar()
    sidebar.open()
    await nextTick()
    expect(orb.find('.ai-orb-launcher').attributes('style')).toContain('display: none')
    sidebar.close()
    await nextTick()
    expect(orb.find('.ai-orb-launcher').attributes('style') ?? '').not.toContain('display: none')
    orb.unmount()
  })
})
