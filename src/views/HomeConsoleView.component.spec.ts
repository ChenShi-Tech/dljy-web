// @vitest-environment happy-dom
// 首页 console（嵌入市场洞察驾驶舱概览区）组件行为（slim-and-fix-market-insight-pages R1）：
// 1. 日均价后台刷新与主 load 同代次守卫——切地区后晚归的旧地区日均价不得写回新地区页面；
// 2. /real-list 文件清单请求携带当前地区参数（与同页 fetchCaptured 口径一致）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const fetchCapturedMock = vi.fn()
vi.mock('@/services/captured', () => ({
  fetchCaptured: (...args: unknown[]) => fetchCapturedMock(...args)
}))
const apiGetMock = vi.fn()
vi.mock('@/services/api', () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args)
}))
vi.mock('@/services/weather', () => ({
  fetchCurrentWeather: vi.fn(async () => ({ now: {} })),
  // oneCity15d 期望逐城市 15 天数组；返回 [] 避免 buildGrid 对 undefined 取 .length 的未处理 rejection
  fetchDaily15: vi.fn(async () => []),
  searchCityByQweather: vi.fn(async () => []),
  lookupCityByCoords: vi.fn(async () => null)
}))
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'ADMIN' }) }))
vi.mock('@/services/governance', () => ({
  firstAccessiblePath: () => '/dashboard',
  roleLabels: {},
  subjectTypeLabels: {}
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/composables/useQuerySync', () => ({ useQuerySync: () => {} }))
vi.mock('@/composables/useEChart', () => ({
  // 日均价 IIFE 首行就调 showLoading（try 外），stub 必须带齐四个方法，否则整段静默死掉
  useEChart: () => ({
    setOption: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(),
    instance: () => null, resize: vi.fn(), dispose: vi.fn()
  })
}))
// 地区：reactive 状态（普通对象字段变更不触发 computed），用例内切换驱动 onRegionChange。
const regionRef = vi.hoisted(() => ({ state: null as { id: string; name: string } | null }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed, reactive } = await import('vue')
  regionRef.state = reactive({ id: 'shanxi', name: '山西' })
  return { ...actual, currentRegion: computed(() => regionRef.state) }
})
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
import HomeConsoleView from './HomeConsoleView.vue'

const stubs = {
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-select': { template: '<div class="stub-select"><slot /></div>' },
  'el-option': { template: '<span><slot /></span>' },
  'el-date-picker': { template: '<input class="stub-date" />' },
  RegionDataBanner: { template: '<div class="stub-banner" />' }
}

function capturedRes(dataset: string) {
  if (dataset === 'getCorpNewEnergyChart') {
    return { data: { dateList: ['2026-05-01'] } }
  }
  if (dataset === 'getAveragePriceChart') {
    return { data: { dayTime: '2026-06-01', diffPriceTotal: 111 } }
  }
  return { data: {} }
}

async function mountView() {
  const wrapper = mount(HomeConsoleView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchCapturedMock.mockReset()
  apiGetMock.mockReset()
  regionRef.state!.id = 'shanxi'
  regionRef.state!.name = '山西'
  apiGetMock.mockResolvedValue({ data: [] })
  fetchCapturedMock.mockImplementation(async (_family: string, dataset: string) => capturedRes(dataset))
})

describe('首页 console：日均价地区竞态与清单地区参数', () => {
  it('/real-list 文件清单请求携带当前地区', async () => {
    await mountView()
    expect(apiGetMock).toHaveBeenCalledWith('/real-list', { family: 'sdpt_console', region: 'shanxi' })
  })

  it('切地区后晚归的旧地区日均价不写回新地区页面', async () => {
    // 首次 load 的日均价首图挂起（模拟慢请求）；切地区触发第二次 load（其日均价请求永不返回）；
    // 旧请求随后晚归——代次守卫应丢弃，面板不显示旧地区日期。
    let resolveOld!: (v: { data: { dayTime: string; diffPriceTotal: number } }) => void
    const slowOld = new Promise((r) => { resolveOld = r })
    let avgCall = 0
    fetchCapturedMock.mockImplementation(async (_family: string, dataset: string) => {
      if (dataset === 'getAveragePriceChart') {
        avgCall += 1
        if (avgCall === 1) return slowOld as never
        return new Promise(() => {}) // 新地区的日均价在途
      }
      return capturedRes(dataset)
    })
    const wrapper = await mountView()

    regionRef.state!.id = 'yunnan'
    await flushPromises()
    resolveOld({ data: { dayTime: '2026-06-01', diffPriceTotal: 111 } })
    await flushPromises()

    expect(wrapper.find('.panel-avg .ptitle').text()).not.toContain('2026-06-01')
  })

  it('未切地区时日均价照常写入（守卫不误伤正常路径）', async () => {
    const wrapper = await mountView()
    // 默认 mock 的 getAveragePriceChart 同步 resolve，flushPromises 后应已写入
    expect(wrapper.find('.panel-avg .ptitle').text()).toContain('2026-06-01')
  })
})
