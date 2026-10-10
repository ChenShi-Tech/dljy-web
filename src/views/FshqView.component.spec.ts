// @vitest-environment happy-dom
// 分时行情组件行为（slim-and-fix-market-insight-pages R2）：
// 买卖盘请求失败与「该点确实无逐笔」可区分——失败显示「加载失败，可重试」，
// 不再伪装成「该点暂无买卖盘数据」；再次点击同点即重试。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

const fetchCapturedMock = vi.fn()
vi.mock('@/services/captured', () => ({
  fetchCaptured: (...a: unknown[]) => fetchCapturedMock(...a)
}))
// 地区：山西（fshq 可用，非降级）
const regionRef = vi.hoisted(() => ({ state: null as { id: string; name: string } | null }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed, reactive } = await import('vue')
  regionRef.state = reactive({ id: 'shanxi', name: '山西' })
  return { ...actual, currentRegion: computed(() => regionRef.state) }
})
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('@/features/aiSidebar', () => ({ defineAiPage: () => {}, useAiSidebar: () => ({ interpret: vi.fn() }) }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
vi.mock('@/components/CapabilityDegradedCard.vue', () => ({
  default: { name: 'CapabilityDegradedCard', template: '<div class="stub-degraded" />' }
}))
// echarts：主图 instance().on 捕获点击 handler（dataIndex 联动买卖盘）
const chartClick = vi.hoisted(() => ({ handler: null as ((p: { dataIndex?: number }) => void) | null }))
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({
    setOption: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    instance: () => ({ on: (_ev: string, fn: (p: { dataIndex?: number }) => void) => { chartClick.handler = fn }, off: () => {} }),
    resize: vi.fn(),
    dispose: vi.fn()
  })
}))
import FshqView from './FshqView.vue'

// 主图数据：两个点都有买卖盘 id；load 自动选实时价最高（data_1）
const MAIN = {
  data: {
    nameList: ['08:00', '09:00'],
    ssjcqList: [100, 200],
    rqjcqList: [90, 180],
    opData: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
    extendMap: { data_0: { id: '111', title: '08:00' }, data_1: { id: '222', title: '09:00' } }
  }
}
const DET = { data: { nameList: ['09:00:15'], title: '09:00', dataMap: { mrl1: [5], mrj1: [300], zxjg: [300] } } }

async function mountView() {
  const wrapper = mount(FshqView)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchCapturedMock.mockReset()
  chartClick.handler = null
  regionRef.state!.id = 'shanxi'
  fetchCapturedMock.mockImplementation(async (_family: string, dataset: string) => {
    if (dataset.startsWith('rqlx')) return MAIN
    if (dataset === 'dataDet__id222' || dataset === 'dataDet__id111') return DET
    throw new Error(`unexpected dataset ${dataset}`)
  })
})

describe('分时行情：买卖盘失败态与无逐笔可区分', () => {
  it('dataDet 失败显示「加载失败，可重试」，不显示「该点暂无买卖盘数据」', async () => {
    fetchCapturedMock.mockImplementation(async (_family: string, dataset: string) => {
      if (dataset.startsWith('rqlx')) return MAIN
      if (dataset.startsWith('dataDet')) throw new Error('503')
      throw new Error(`unexpected dataset ${dataset}`)
    })
    const wrapper = await mountView()

    const text = wrapper.text()
    expect(text).toContain('买卖盘加载失败')
    expect(text).not.toContain('该点暂无买卖盘数据')
  })

  it('失败后再次点击同点重试成功 → 恢复正常呈现', async () => {
    let detFails = true
    fetchCapturedMock.mockImplementation(async (_family: string, dataset: string) => {
      if (dataset.startsWith('rqlx')) return MAIN
      if (dataset.startsWith('dataDet')) {
        if (detFails) throw new Error('503')
        return DET
      }
      throw new Error(`unexpected dataset ${dataset}`)
    })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('买卖盘加载失败')

    detFails = false
    chartClick.handler?.({ dataIndex: 1 })
    await flushPromises()
    const text = wrapper.text()
    expect(text).not.toContain('买卖盘加载失败')
    expect(text).not.toContain('该点暂无买卖盘数据')
  })
})
