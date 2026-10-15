// ReviewClassic 缓存页路由状态隔离（dljy#3731 遗留缺陷⑥ · yunnan-launch-readiness
// stale-response-guards delta「缓存复用页的路由状态隔离」）：KeepAlive 失活后
// useRoute 仍跟随全局导航，未设防的深链 watcher 会把其他页面携带的 ?report=/ ?run=
// 当本页深链消费并 router.replace 改写那个页面的参数。守卫后：缓存期间不消费、
// 不改写其他路由的查询参数。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { mount as repoMount } from '@/test/mount'

const quant = vi.hoisted(() => ({
  fetchReview: vi.fn(async () => null),
  fetchSettlementReview: vi.fn(async () => null),
  fetchReports: vi.fn(async () => []),
  fetchReportContent: vi.fn(async () => '')
}))
vi.mock('@/services/quant/quantClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/quant/quantClient')>()),
  fetchReview: quant.fetchReview,
  fetchSettlementReview: quant.fetchSettlementReview,
  fetchReports: quant.fetchReports,
  fetchReportContent: quant.fetchReportContent
}))
vi.mock('@/services/declarations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/declarations')>()),
  getDeclaration: vi.fn(async () => null)
}))
vi.mock('@/services/review/templateInstanceClient', () => ({
  fetchTemplateInstanceFeed: vi.fn(async () => []),
  invalidateTemplateInstanceCache: vi.fn()
}))
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiGet: vi.fn(async () => ({ code: 200, data: { rows: [] } }))
}))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => () => {} }))

import ReviewCenterView from './ReviewCenterView.vue'
import ReviewClassicView from './ReviewClassicView.vue'

/** 等异步子组件（defineAsyncComponent + KeepAlive）落地：光冲微任务不够，穿插宏任务。 */
async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
  }
}

const HEAVY_STUBS = {
  RegionDataBanner: true,
  ReviewHeader: true,
  ReviewDimTabs: true,
  ReportsRail: true,
  ReportReaderModal: true,
  ReportGenerateDialog: true,
  TodoInbox: true,
  ReviewTemplateForm: true,
  DeviationDim: true,
  ResultDim: true,
  MarketDim: true,
  StrategyDim: true,
  RiskDim: true,
  DecisionDim: true,
  SubjectDim: true
}

async function setupHost(): Promise<{ wrapper: ReturnType<typeof repoMount>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/xhjy/review', component: ReviewCenterView },
      { path: '/other', component: { template: '<div data-testid="other-page">其他页面</div>' } }
    ]
  })
  const host = defineComponent({
    template: `
      <RouterView v-slot="{ Component }">
        <KeepAlive :max="20">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    `
  })
  await router.push('/xhjy/review?layout=classic')
  await router.isReady()
  const wrapper = repoMount(host, { global: { plugins: [router], stubs: HEAVY_STUBS } })
  await settle()
  return { wrapper, router }
}

describe('ReviewClassic 缓存页路由隔离（缺陷⑥）', () => {
  it('classic 布局渲染归档导航与经典视图本体（非空转）', async () => {
    const { wrapper } = await setupHost()
    expect(wrapper.text()).toContain('历史专题与报告')
    expect(wrapper.findComponent(ReviewClassicView).exists()).toBe(true)
  })

  it('缓存失活后其他页面带 ?report= 不被消费、URL 不被改写', async () => {
    const { router } = await setupHost()
    quant.fetchReports.mockClear()

    await router.push('/other?report=session-abc')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))

    expect(router.currentRoute.value.fullPath).toBe('/other?report=session-abc')
    expect(quant.fetchReports).not.toHaveBeenCalled()
  })

  it('缓存失活后其他页面带 ?run=1 不触发生成弹层状态、URL 不被改写', async () => {
    const { router } = await setupHost()
    await router.push('/other?run=1')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))

    expect(router.currentRoute.value.fullPath).toBe('/other?run=1')
  })

  it('返回复盘路由后深链恢复正常工作（?report= 用后即清）', async () => {
    const { router } = await setupHost()
    await router.push('/other')
    await settle()
    await router.push('/xhjy/review?layout=classic&report=session-xyz')
    await settle()

    // 深链被消费：参数被清（finally 的 router.replace 生效），不再反复弹层。
    expect(router.currentRoute.value.query.report).toBeUndefined()
    expect(router.currentRoute.value.query.layout).toBe('classic')
  })
})
