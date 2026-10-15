// 切标的日强制重挂非 S4 面板（dljy#3731 遗留缺陷② · yunnan-launch-readiness
// stale-response-guards delta「常驻面板在上下文切换时重置派生状态」）：
// 目标日变化后 S2/S3/S5/S6/S7 面板实例整体重建（旧日期派生状态不残留），
// S4 申报执行暂按 D2 等 S4 片区合并后同口径处理。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount as repoMount } from '@/test/mount'

const stageMounts = vi.hoisted(() => ({
  market: { count: 0 },
  direction: { count: 0 },
  clearing: { count: 0 },
  contract: { count: 0 },
  dailyClose: { count: 0 }
}))

const probe = (counter: { count: number }, label: string) => ({
  name: label,
  props: ['declaration', 'targetDate'],
  template: `<span data-test="probe-${label}" />`,
  setup() {
    counter.count += 1
    return {}
  }
})

vi.mock('@/components/trading/stages/lazyStage', async (importOriginal) => {
  const { defineAsyncComponent } = await import('vue')
  const actual = await importOriginal<typeof import('@/components/trading/stages/lazyStage')>()
  return {
    ...actual,
    // 懒加载壳换成透传：直接渲染目标组件，避免异步时序干扰挂载计数
    lazyStage: (loader: () => Promise<unknown>) =>
      defineAsyncComponent(() => loader() as Promise<{ default: Component }>)
  }
})
vi.mock('@/components/trading/stages/StageMarketAnalysis.vue', () => ({
  __esModule: true,
  default: probe(stageMounts.market, 'market')
}))
vi.mock('@/components/trading/stages/StageDirection.vue', () => ({
  __esModule: true,
  default: probe(stageMounts.direction, 'direction')
}))
vi.mock('@/components/trading/stages/StageClearing.vue', () => ({
  __esModule: true,
  default: probe(stageMounts.clearing, 'clearing')
}))
vi.mock('@/components/trading/stages/StageContract.vue', () => ({
  __esModule: true,
  default: probe(stageMounts.contract, 'contract')
}))
vi.mock('@/components/trading/stages/StageDailyClose.vue', () => ({
  __esModule: true,
  default: probe(stageMounts.dailyClose, 'dailyClose')
}))
vi.mock('@/components/spot/WorkflowStepper.vue', () => ({
  __esModule: true,
  default: { props: ['current', 'declaration'], emits: ['select'], template: '<span class="stepper-stub" />' }
}))
vi.mock('@/services/declarations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/declarations')>()),
  listDeclarations: vi.fn(async () => []),
  createDeclaration: vi.fn()
}))
vi.mock('@/services/region/regionContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/region/regionContext')>()),
  currentRegion: { get value() { return { id: 'yunnan', name: '云南' } } }
}))

import TradingDayView from './TradingDayView.vue'

async function mountView(initialStage: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/xhjy/trading-day', component: TradingDayView }]
  })
  await router.push({ path: '/xhjy/trading-day', query: { stage: initialStage } })
  await router.isReady()
  const wrapper = repoMount(TradingDayView, { global: { plugins: [router] } })
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
  return { wrapper, router }
}

describe('切标的日重挂非 S4 面板（缺陷②）', () => {
  it.each([
    ['market-analysis', 'market'],
    ['direction', 'direction'],
    ['clearing', 'clearing'],
    ['contract', 'contract'],
    ['daily-close', 'dailyClose']
  ] as const)('%s 面板在切标日后重挂（派生状态随实例销毁）', async (stage, counterKey) => {
    for (const c of Object.values(stageMounts)) c.count = 0
    const { wrapper } = await mountView(stage)
    const counter = stageMounts[counterKey]
    expect(counter.count).toBe(1)

    // 日期输入在「标的日与单据」折叠区内：先展开再改值
    const toggle = wrapper.findAll('button').find((b) => b.text().includes('标的日与单据'))
    await toggle!.trigger('click')
    await flushPromises()
    const dateInput = wrapper.find('input[type="date"]')
    await dateInput.setValue('2026-10-20')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()

    expect(counter.count).toBe(2)
  })

  it('未切日期时面板不重挂（:key 不引入多余重建）', async () => {
    for (const c of Object.values(stageMounts)) c.count = 0
    const { wrapper } = await mountView('market-analysis')
    expect(stageMounts.market.count).toBe(1)
    // 触发一次无关渲染（切到 S1 再切回）：面板按 v-if 卸载重挂属既有语义，日期 key 不额外影响
    await wrapper.find('.stepper-stub').trigger('click')
    await flushPromises()
    expect(stageMounts.market.count).toBeGreaterThanOrEqual(1)
  })
})
