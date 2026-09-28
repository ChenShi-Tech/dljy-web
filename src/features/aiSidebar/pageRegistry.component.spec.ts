// 页面声明注册表的生命周期不变量（统一 AI 侧边栏 PI-01）。
//
// 守什么：当前生效声明永远是用户眼前那一页的；页面被 KeepAlive 缓存时切走即失效、切回即恢复。
// 坏掉的症状（2026-09-16 实机复现）：注册只挂 mounted/unmounted 时，分时行情 → 驾驶舱 → 价格分析，
// 三处悬浮球都显示「解读本页：分时行情」，在别的页面点解读得到的是分时行情的切片。
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { activeAiPage, activatePage, deactivatePage, defineAiPage, type AiPageDefinition } from './pageRegistry'

function page(label: string): Component {
  return defineComponent({
    name: `Page${label}`,
    setup() {
      defineAiPage({ label, promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis, interpret: { context: () => ({ label }) } })
      return () => h('div', label)
    }
  })
}
const Unregistered = defineComponent({ name: 'PageCockpit', setup: () => () => h('div', '驾驶舱') })

function mountRouterLike() {
  const views: Record<string, Component> = { A: page('分时行情'), B: page('价格分析'), C: Unregistered }
  const current = ref<'A' | 'B' | 'C'>('A')
  const wrapper = mount(
    defineComponent({ setup: () => () => h(KeepAlive, null, [h(views[current.value], { key: current.value })]) })
  )
  return { wrapper, current }
}

describe('defineAiPage · 生命周期跟随 KeepAlive', () => {
  beforeEach(() => {
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
  })

  it('A → C(未声明) → B → A：生效声明始终是当前页，缓存页切回后重新生效', async () => {
    const { wrapper, current } = mountRouterLike()
    await nextTick()
    expect(activeAiPage().value?.label).toBe('分时行情')

    current.value = 'C'
    await nextTick()
    expect(activeAiPage().value).toBeNull()

    current.value = 'B'
    await nextTick()
    expect(activeAiPage().value?.label).toBe('价格分析')

    current.value = 'A' // A 从缓存恢复：不会再触发 onMounted，必须靠 onActivated 重新生效
    await nextTick()
    expect(activeAiPage().value?.label).toBe('分时行情')

    wrapper.unmount()
    expect(activeAiPage().value).toBeNull()
  })

  it('新页先激活、旧页后失活时不会把新页的声明清掉（只清自己）', () => {
    const oldPage: AiPageDefinition = { label: '旧页', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis }
    const newPage: AiPageDefinition = { label: '新页', promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis }
    activatePage(oldPage)
    activatePage(newPage)
    deactivatePage(oldPage)
    expect(activeAiPage().value?.label).toBe('新页')
  })
})
