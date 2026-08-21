// 复盘中心标签栏（Epic #2033 · #2038 外壳）：七标签有序、圆点跟信号、角标条件、点击语义。
import { describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import ReviewDimTabs from './ReviewDimTabs.vue'

describe('ReviewDimTabs', () => {
  it('六维 + 主体按固定顺序渲染，当前项 aria-selected', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'market', signals: {} } })
    const tabs = w.findAll('[role="tab"]')
    expect(tabs.map((t) => t.attributes('data-dim'))).toEqual([
      'deviation', 'result', 'market', 'strategy', 'risk', 'decision', 'subject'
    ])
    expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual([
      'false', 'false', 'true', 'false', 'false', 'false', 'false'
    ])
  })

  it('圆点类名跟随信号，缺省 pending', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: { deviation: 'live', risk: 'gap' } } })
    const dot = (dim: string) => w.get(`[data-dim="${dim}"] .dot`).classes()
    expect(dot('deviation')).toContain('live')
    expect(dot('risk')).toContain('gap')
    expect(dot('strategy')).toContain('pending')
    expect(dot('subject')).toContain('pending')
  })

  it('角标仅在数量 > 0 时渲染', () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: {}, badges: { decision: 2, risk: 0 } } })
    expect(w.get('[data-dim="decision"] .badge').text()).toBe('2')
    expect(w.find('[data-dim="risk"] .badge').exists()).toBe(false)
  })

  it('点击其它标签 emit update:active；点当前项不 emit', async () => {
    const w = mount(ReviewDimTabs, { props: { active: 'deviation', signals: {} } })
    await w.get('[data-dim="deviation"]').trigger('click')
    expect(w.emitted('update:active')).toBeUndefined()
    await w.get('[data-dim="subject"]').trigger('click')
    expect(w.emitted('update:active')![0]).toEqual(['subject'])
  })
})
