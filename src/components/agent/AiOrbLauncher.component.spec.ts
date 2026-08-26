// 悬浮球 = 本页解读入口的不变量。
//
// 为什么要锁：它曾被改成「不分页面一律跳 /ai-agent」（#38），把一个跟页面走的入口降级成了
// 到处一样的链接——在没有解读能力的页面上，用户点它得到的是一次莫名其妙的跳转。
// 下面三条断言把「跟页面能力走」钉死。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AiOrbLauncher from './AiOrbLauncher.vue'
import { usePageInsight } from '@/composables/usePageInsight'
import { useAiPanel } from '@/composables/useAiPanel'

vi.mock('@/components/orb/LiquidGlassOrb.vue', () => ({
  default: defineComponent({ name: 'LiquidGlassOrb', render: () => h('span') })
}))

/** 挂一个「注册了本页解读」的宿主页，模拟真实业务页 */
function mountHostWithInsight(run: () => void, label = '测试页') {
  const Host = defineComponent({
    setup() {
      const { registerPageInsight } = usePageInsight('market_data_analysis')
      registerPageInsight(run, label)
      return () => h('div')
    }
  })
  return mount(Host)
}

describe('AiOrbLauncher · 本页解读入口', () => {
  beforeEach(() => {
    // 面板复位，避免用例间串味（open 时球本就退场避让）
    useAiPanel().close()
  })

  it('没有页面注册解读能力时不显示——入口在但点了没用，比没有入口更糟', async () => {
    const orb = mount(AiOrbLauncher)
    await nextTick()
    expect(orb.find('.ai-orb-launcher').attributes('style')).toContain('display: none')
    orb.unmount()
  })

  it('页面注册后显示，且点击触发的是该页自己的解读（不是跳转）', async () => {
    const run = vi.fn()
    const host = mountHostWithInsight(run, '分时行情')
    const orb = mount(AiOrbLauncher)
    await nextTick()

    const btn = orb.find('.ai-orb-launcher')
    expect(btn.attributes('style') ?? '').not.toContain('display: none')
    expect(btn.attributes('title')).toBe('解读本页：分时行情')

    await btn.trigger('click')
    expect(run).toHaveBeenCalledTimes(1)

    orb.unmount()
    host.unmount()
  })

  it('页面卸载后回到不显示——注册随页面生命周期，不残留到下一页', async () => {
    const host = mountHostWithInsight(vi.fn())
    const orb = mount(AiOrbLauncher)
    await nextTick()
    expect(orb.find('.ai-orb-launcher').attributes('style') ?? '').not.toContain('display: none')

    host.unmount()
    await nextTick()
    expect(orb.find('.ai-orb-launcher').attributes('style')).toContain('display: none')
    orb.unmount()
  })
})
