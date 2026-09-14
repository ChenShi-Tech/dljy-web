import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReviewCenterView from './ReviewCenterView.vue'

vi.mock('./review/ReviewWorkbenchView.vue', () => ({ __esModule: true, default: { props: ['standaloneTopics'], template: '<div>{{ standaloneTopics ? "独立专题页面" : "决策复盘工作台" }}</div>' } }))
vi.mock('./ReviewClassicView.vue', () => ({ __esModule: true, default: { template: '<div>历史专题内容</div>' } }))

describe('复盘中心默认入口', () => {
  it('独立路径实际渲染专题模式，旧版参数不会把它变回模板页', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review/analysis', component: ReviewCenterView }] })
    await router.push('/xhjy/review/analysis?layout=classic')
    const wrapper = mount(ReviewCenterView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('独立专题页面')
    expect(wrapper.text()).not.toContain('历史专题内容')
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
