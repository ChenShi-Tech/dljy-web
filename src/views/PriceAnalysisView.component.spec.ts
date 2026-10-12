// @vitest-environment happy-dom
// 价格分析组件行为（slim-and-fix-market-insight-pages R3）：
// 3D 电价图价格轴不写死下限（山西/云南均有负价，min:0 会把负价段截出轴外），
// 且与右上时点切面的自适应值域口径一致。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

const fetchContract = vi.fn()
vi.mock('@/services/data/contracts', () => ({
  fetchMarketInsightPriceAnalysisContract: (...a: unknown[]) => fetchContract(...a),
  normalizeContractBasis: (b?: string) => (b === 'real' || b === 'captured' ? 'captured' : 'synthetic')
}))
const regionRef = vi.hoisted(() => ({ state: null as { id: string; name: string } | null }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed, reactive } = await import('vue')
  regionRef.state = reactive({ id: 'shanxi', name: '山西' })
  return { ...actual, currentRegion: computed(() => regionRef.state) }
})
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('@/features/aiSidebar', () => ({ defineAiPage: () => {}, useAiSidebar: () => ({ interpret: vi.fn() }) }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
// echarts-gl 只提供副作用注册；3D 图经 echarts.init 手动管理 → 捕获其 setOption
const d3State = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('echarts', () => ({
  init: () => ({
    setOption: (...args: unknown[]) => { d3State.calls.push(args) },
    isDisposed: () => false,
    clear: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn()
  })
}))
vi.mock('echarts-gl', () => ({}))
const sliceCharts = vi.hoisted(() => ({ calls: { t: [] as unknown[][], d: [] as unknown[][] }, n: 0 }))
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => {
    const key = sliceCharts.n++ === 0 ? 't' : 'd'
    return {
      setOption: (...args: unknown[]) => { sliceCharts.calls[key].push(args) },
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      instance: () => null,
      resize: vi.fn(),
      dispose: vi.fn()
    }
  }
}))
import PriceAnalysisView from './PriceAnalysisView.vue'

// 96 点曲线含负价段（凌晨负出清）；market 维度日前/实时各一天
const negPoints = Array.from({ length: 96 }, (_, i) => (i >= 2 && i <= 5 ? -35.5 : 200 + i))
const posPoints = Array.from({ length: 96 }, (_, i) => 250 + i)

const CONTRACT = {
  blocks: {
    price_analysis: {
      dates: ['2026-05-01', '2026-05-02'],
      averageCurves: [{ market: 'rq', points: posPoints }],
      dailyStats: [
        { date: '2026-05-01', max: 300, min: -35.5, avg: 180 },
        { date: '2026-05-02', max: 350, min: 250, avg: 300 }
      ],
      dayCurves: [
        { date: '2026-05-01', market: 'rq', points: negPoints },
        { date: '2026-05-02', market: 'rq', points: posPoints }
      ]
    }
  }
}

beforeEach(() => {
  fetchContract.mockReset()
  d3State.calls.length = 0
  sliceCharts.calls.t.length = 0
  sliceCharts.calls.d.length = 0
  sliceCharts.n = 0
  fetchContract.mockResolvedValue(CONTRACT)
})

describe('价格分析：3D 价格轴不裁剪负价', () => {
  it('数据含负价时 z 轴无写死下限，与切面图自适应口径一致', async () => {
    mount(PriceAnalysisView)
    await flushPromises()
    await flushPromises()

    const full = d3State.calls.map((c) => c[0] as { zAxis3D?: { min?: number } }).filter((o) => o.zAxis3D)
    expect(full.length).toBeGreaterThanOrEqual(1)
    for (const option of full) {
      expect(option.zAxis3D!.min).toBeUndefined()
    }
    // 时点切面保持既有自适应（scale），与 3D 口径一致
    const tOptions = sliceCharts.calls.t.map((c) => c[0] as { yAxis?: { scale?: boolean; min?: number } }).filter((o) => o.yAxis)
    expect(tOptions.length).toBeGreaterThanOrEqual(1)
    for (const option of tOptions) {
      expect(option.yAxis!.min).toBeUndefined()
    }
  })
})
