import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReviewCenterView from './ReviewCenterView.vue'

const workbenchLifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }))
vi.mock('./review/ReviewWorkbenchView.vue', async () => {
  const { onMounted, onUnmounted } = await import('vue')
  return {
    __esModule: true,
    default: {
      props: ['standaloneTopics'],
      setup() {
        onMounted(workbenchLifecycle.mounted)
        onUnmounted(workbenchLifecycle.unmounted)
      },
      template: '<div>{{ standaloneTopics ? "独立专题页面" : "决策复盘工作台" }}</div>'
    }
  }
})
vi.mock('./ReviewClassicView.vue', () => ({ __esModule: true, default: { template: '<div>历史专题内容</div>' } }))

describe('复盘中心默认入口', () => {
  it('被全局 KeepAlive 缓存后切走再返回仍渲染工作台', async () => {
    workbenchLifecycle.mounted.mockClear()
    workbenchLifecycle.unmounted.mockClear()
    const otherPage = { template: '<div data-testid="other-page">其他页面</div>' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/xhjy/review', component: ReviewCenterView },
        { path: '/other', component: otherPage }
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
    const runtimeErrors: unknown[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await router.push('/xhjy/review')
    await router.isReady()
    const wrapper = mount(host, {
      global: {
        plugins: [router],
        config: { errorHandler: error => runtimeErrors.push(error) }
      }
    })
    await flushPromises()
    expect(wrapper.text()).toContain('决策复盘工作台')
    expect(wrapper.find('.review-center-route').exists()).toBe(true)
    expect(workbenchLifecycle.mounted).toHaveBeenCalledTimes(1)

    for (let round = 0; round < 2; round += 1) {
      await router.push('/other')
      await flushPromises()
      expect(wrapper.find('[data-testid="other-page"]').exists()).toBe(true)
      expect(workbenchLifecycle.unmounted).not.toHaveBeenCalled()

      await router.push('/xhjy/review')
      await flushPromises()
      expect(wrapper.text()).toContain('决策复盘工作台')
      expect(wrapper.find('[data-testid="other-page"]').exists()).toBe(false)
      expect(workbenchLifecycle.mounted).toHaveBeenCalledTimes(1)
    }

    expect(runtimeErrors).toEqual([])
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/insertBefore|subTree|Cannot read properties of null/)
    wrapper.unmount()
    consoleError.mockRestore()
  })

  it.each(['/xhjy/review/analysis', '/xhjy/review/analysis/'])('独立路径实际渲染专题模式，旧版参数不会把它变回模板页：%s', async path => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review/analysis', component: ReviewCenterView }] })
    await router.push(`${path}?layout=classic`)
    const wrapper = mount(ReviewCenterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('独立专题页面')
    expect(wrapper.text()).not.toContain('历史专题内容')
    wrapper.unmount()
  })
  it('带尾斜杠返回普通复盘页时仍更新查询模式', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review', component: ReviewCenterView }] })
    await router.push('/xhjy/review')
    const wrapper = mount(ReviewCenterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('决策复盘工作台')

    await router.push('/xhjy/review/?layout=classic')
    await flushPromises()
    expect(wrapper.text()).toContain('历史专题内容')
    wrapper.unmount()
  })
  it.each(['', '?layout=decisions', '?layout=unknown'])('普通地址与兼容链接进入新版 %s', async query => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review', component: ReviewCenterView }] })
    await router.push(`/xhjy/review${query}`)
    const wrapper = mount(ReviewCenterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('决策复盘工作台')
    expect(wrapper.text()).not.toContain('历史专题内容')
    wrapper.unmount()
  })
  it('历史专题仅显式打开，返回保留日期与申报对象', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review', component: ReviewCenterView }] })
    await router.push('/xhjy/review?layout=classic&date=2026-05-31&declarationId=a&dim=market&report=old&run=old')
    const wrapper = mount(ReviewCenterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('历史专题内容')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('决策复盘工作台')
    expect(router.currentRoute.value.query).toEqual({ date: '2026-05-31', declarationId: 'a' })
    wrapper.unmount()
  })
})
