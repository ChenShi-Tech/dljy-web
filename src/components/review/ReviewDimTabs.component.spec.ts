// 复盘中心标签栏（Epic #2033 · #2038 外壳）：可见标签有序（风险/决策/主体暂隐藏，
// 藏而不删，见 reviewDashboard HIDDEN_TABS）、圆点跟信号、角标条件、点击语义。
import { describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import ReviewDimTabs from './ReviewDimTabs.vue'

describe('ReviewDimTabs', () => {
  it('可见标签按固定顺序渲染，当前项 aria-selected；隐藏标签不渲染', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'market', signals: {} } })
    const tabs = w.findAll('[role="tab"]')
    expect(tabs.map((t) => t.attributes('data-dim'))).toEqual([
      'deviation', 'result', 'market', 'strategy'
    ])
    expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual([
      'false', 'false', 'true', 'false'
    ])
    // 藏而不删：风险/决策/主体不进 tab 栏（按钮整颗不渲染，而非不可见样式）
    for (const hidden of ['risk', 'decision', 'subject']) {
      expect(w.find(`[data-dim="${hidden}"]`).exists()).toBe(false)
    }
  })

  it('圆点类名跟随信号，缺省 pending', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: { deviation: 'live', result: 'gap' } } })
    const dot = (dim: string) => w.get(`[data-dim="${dim}"] .dot`).classes()
    expect(dot('deviation')).toContain('live')
    expect(dot('result')).toContain('gap')
    expect(dot('strategy')).toContain('pending')
  })

  it('角标仅在数量 > 0 时渲染', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: {}, badges: { market: 2, result: 0 } } })
    expect(w.get('[data-dim="market"] .badge').text()).toBe('2')
    expect(w.find('[data-dim="result"] .badge').exists()).toBe(false)
  })

  it('点击其它可见标签 emit update:active；点当前项不 emit；隐藏标签无从点击', async () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: {} } })
    await w.get('[data-dim="deviation"]').trigger('click')
    expect(w.emitted('update:active')).toBeUndefined()
    await w.get('[data-dim="strategy"]').trigger('click')
    expect(w.emitted('update:active')![0]).toEqual(['strategy'])
    expect(w.find('[data-dim="subject"]').exists()).toBe(false)
  })
})
