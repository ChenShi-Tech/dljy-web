// 旧回放能力门控不得被在线模型入口绕开；入口只复用工作台权限并保持目标日（dljy-web#54）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
const state = vi.hoisted(() => ({
  benchAllowed: true, benchStatus: 'available', tabStatus: 'degraded', region: 'yunnan',
  route: { query: { tab: 'jgyc', date: '2026-06-25', mod: 'replay' }, meta: { kind: 'forecast' } }, replace: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route, useRouter: () => ({ replace: state.replace }) }))
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'TRADER' }) }))
vi.mock('@/services/governance', () => ({ canAccessPath: (path: string) => path !== '/ycsj/workbench' || state.benchAllowed }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).computed(() => ({ id: state.region, name: state.region })) }))
vi.mock('@/services/region/regionModules', () => ({
  getRegionCapabilityForPath: () => ({ status: state.benchStatus }),
  getRegionSubCapability: () => ({ status: state.tabStatus, capability: { note: '旧口径缺数据' } }),
}))
vi.mock('./ForecastMultiTypeCurve.vue', () => ({ default: { name: 'ForecastMultiTypeCurve', template: '<p>旧价格正文</p>' } }))
vi.mock('./ForecastDailyCurve.vue', () => ({ default: { name: 'ForecastDailyCurve', template: '<p>旧负荷正文</p>' } }))
vi.mock('../RollingPricePredictionView.vue', () => ({ default: { template: '<div/>' } }))
vi.mock('../CompanyWeatherPredictionView.vue', () => ({ default: { template: '<div/>' } }))
vi.mock('./RenewableABCurve.vue', () => ({ default: { template: '<div/>' } }))
vi.mock('@/components/forecast/YnDisclosureCurve.vue', () => ({ default: { template: '<div/>' } }))
import Hub from './ForecastHubView.vue'
const wrappers: VueWrapper[] = []
function render() {
  const wrapper = mount(Hub, { global: { stubs: {
    ElTabs: { template: '<div><slot/></div>' }, ElTabPane: { template: '<div><slot/></div>' },
    ElTag: { template: '<span><slot/></span>' }, ElEmpty: true, TrustBadge: true,
    CapabilityDegradedCard: { template: '<p>旧口径缺数据</p>' },
    ElButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
  } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => { Object.assign(state, { benchAllowed: true, benchStatus: 'available', tabStatus: 'degraded', region: 'yunnan' }); state.route.query.tab = 'jgyc'; state.replace.mockClear() })
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })
describe('旧回放与新模型入口的权限分离', () => {
  it('不挂载降级旧正文，日前/实时按钮切到正确工作台目标并保留日期', async () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('旧口径缺数据')
    expect(wrapper.text()).not.toContain('旧价格正文')
    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.findAll('button')[0].trigger('click')
    expect(state.replace).toHaveBeenLastCalledWith({ path: '/ycsj/center', query: { tab: 'jgyc', mod: 'bench', target: 'price_user_da_settlement', date: '2026-06-25' } })
    await wrapper.findAll('button')[1].trigger('click')
    expect(state.replace.mock.lastCall?.[0].query.target).toBe('price_user_rt_settlement')
  })
  it('区域负荷明确不等于厂站负荷', async () => {
    state.route.query.tab = 'gsfhyc'
    const wrapper = render()
    expect(wrapper.text()).not.toContain('旧负荷正文')
    expect(wrapper.text()).toContain('区域负荷预测（非厂站）')
    await wrapper.find('button').trigger('click')
    expect(state.replace.mock.lastCall?.[0].query.target).toBe('load')
  })
  it.each(['hidden', 'not-configured', 'degraded'])('工作台能力%s时不暴露入口', (status) => {
    state.benchStatus = status
    expect(render().findAll('button')).toHaveLength(0)
  })
  it('无工作台角色权限不暴露入口，未登记旧tab仍不挂正文', () => {
    state.benchAllowed = false; state.tabStatus = 'not-configured'
    const wrapper = render()
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('旧价格正文')
  })
  it('其他地区不套用云南新模型口径，正常旧能力仍可挂载', () => {
    state.region = 'shanxi'; state.tabStatus = 'available'
    const wrapper = render()
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).toContain('旧价格正文')
  })
})
