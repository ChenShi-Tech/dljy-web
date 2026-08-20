// #1755 真修复校验：SpotPnLPanel 对数据层缺测 null 的诚实展示（不拉回假零 0）。
// spec 随组件走 LEGACY_DIRECT_FETCH 豁免（region-isolation 门禁），仅 mock 取数、非新裸取数路径。
// 走组件真实渲染路径：mock fetchCaptured 返回含 null 字段的行 → 断言聚合输出 null
// （表格 fmtNum 显示「-」、瀑布段不显示），与全数值数据的对照。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DynamicTable from '@/components/common/DynamicTable.vue'

// ChartCard 的显式 stub（shallow 模式下显式指定优先）：透传 actions 具名插槽，
// 让「合计 X 万元」这类投影可走 DOM 文本断言，而不必直取组件内部计算属性。
const global = {
  stubs: {
    ChartCard: { template: '<div><slot name="actions" /></div>' },
  },
}

vi.mock('@/services/captured', () => ({
  fetchCaptured: vi.fn(),
  regionDataStatus: { value: { accessDenied: null, deniedCaptureFamilies: new Set() } }
}))

vi.mock('@/services/api', () => ({
  deniedCaptureFamilies: { value: new Set() }
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan' } }
}))

import { fetchCaptured } from '@/services/captured'
import SpotPnLPanel from './SpotPnLPanel.vue'

const LOSS_ROWS_NULL = [
  // 2026-05 电网损失列全 null（部分导出确有空字段的场景）
  { id: 'L1', date: '2026-05-01', plant: '厂A', area: 'yn', totalGenerationMwh: 1200.5, strategyLossTotal: 45.2, strategyLossPerMwh: 0.0377, forecastLossTotal: 30.1, forecastLossPerMwh: 0.0251, gridLossTotal: null, gridLossPerMwh: null, originalValueTotal: 1500.0 },
  { id: 'L2', date: '2026-05-02', plant: '厂A', area: 'yn', totalGenerationMwh: 1100.0, strategyLossTotal: 40.0, strategyLossPerMwh: 0.0364, forecastLossTotal: 28.0, forecastLossPerMwh: 0.0255, gridLossTotal: null, gridLossPerMwh: null, originalValueTotal: 1450.0 }
]
const SETTLE_ROWS_NULL = [
  // 平均电价/总电费全 null（整段缺测）
  { id: 'S1', date: '2026-05-01', plant: '厂A', area: 'yn', ltmEnergy: 800, ltmPrice: 350.5, daClearedEnergy: 750, daDevEnergy: 12.5, daPrice: 400.2, daDevFee: 1500.5, rtDevEnergy: null, rtPrice: 390.8, rtDevFee: 80.2, actualOnGridEnergy: 1200, totalEnergy: 1200, avgPrice: null, totalFee: null },
  { id: 'S2', date: '2026-05-02', plant: '厂A', area: 'yn', ltmEnergy: 700, ltmPrice: 352.0, daClearedEnergy: 720, daDevEnergy: 10.0, daPrice: 395.0, daDevFee: 1200.0, rtDevEnergy: null, rtPrice: 385.0, rtDevFee: 60.0, actualOnGridEnergy: 1100, totalEnergy: 1100, avgPrice: null, totalFee: null }
]

beforeEach(() => {
  vi.mocked(fetchCaptured).mockReset()
})

describe('SpotPnLPanel 缺测 null 诚实展示（#1755）', () => {
  it('整段全 null 的指标聚合为 null（表格显示「-」而非 0）', async () => {
    vi.mocked(fetchCaptured)
      .mockResolvedValueOnce({ code: 200, data: LOSS_ROWS_NULL } as never)
      .mockResolvedValueOnce({ code: 200, data: SETTLE_ROWS_NULL } as never)

    const wrapper = shallowMount(SpotPnLPanel, { global })
    await nextTick()
    await nextTick()
    await nextTick()

    // 厂站 P&L 表行：电网损失列（全 null）应为「-」，总电费/平均电价应为「-」
    // 经 DynamicTable 的 rows props（组件对外契约）取数，不直取内部计算属性。
    const rows = wrapper.findComponent(DynamicTable).props('rows') as Record<string, string>[]
    const row = rows.find((r) => r.plant === '厂A')
    expect(row).toBeDefined()
    expect(row!.gridLossTotal).toBe('-')   // 全 null → 「-」，不是「0.00」
    expect(row!.totalFee).toBe('-')
    expect(row!.avgPrice).toBe('-')
    // 部分有值的列正常显示数值
    expect(row!.strategyLossTotal).toBe('0.01') // (45.2+40)/10000 = 0.00852 → 0.01 万
    expect(row!.totalGenerationMwh).toBe('2,300.5')  // fmtNum 千分位
  })

  it('全 null 损益段 → 瀑布空态（不渲染 0 柱）', async () => {
    // 三段全部 null（源 CSV 整段缺测）→ buildWaterfallOption 的 empty 应为 true
    const allNull = LOSS_ROWS_NULL.map((r) => ({ ...r, strategyLossTotal: null, forecastLossTotal: null, gridLossTotal: null, totalGenerationMwh: null, originalValueTotal: null }))
    vi.mocked(fetchCaptured)
      .mockResolvedValueOnce({ code: 200, data: allNull } as never)
      .mockResolvedValueOnce({ code: 200, data: [] } as never)
    const wrapper = shallowMount(SpotPnLPanel, { global })
    await nextTick(); await nextTick(); await nextTick()
    // 模板投影「合计 {{ fmtNum(...) }} 万元」：fmtNum(null) = '-'，全 null 时合计显示「-」而非 0。
    // （buildWaterfallOption 的空态判定依据同一 lossBreakdown.total，模板投影是其可见症状。）
    expect(wrapper.text()).toContain('合计 - 万元')
  })

  it('有值段正常聚合（对照：非 null 数据不受影响）', async () => {
    vi.mocked(fetchCaptured)
      .mockResolvedValueOnce({ code: 200, data: LOSS_ROWS_NULL.map((r) => ({ ...r, gridLossTotal: 12.3, gridLossPerMwh: 0.0102 })) } as never)
      .mockResolvedValueOnce({ code: 200, data: SETTLE_ROWS_NULL.map((r) => ({ ...r, avgPrice: 395.4, totalFee: 474480 })) } as never)

    const wrapper = shallowMount(SpotPnLPanel, { global })
    await nextTick()
    await nextTick()
    await nextTick()

    const rows = wrapper.findComponent(DynamicTable).props('rows') as Record<string, string>[]
    const row = rows.find((r) => r.plant === '厂A')
    expect(row).toBeDefined()
    expect(row!.gridLossTotal).toBe('0')   // 有值 → 数值（0.00246 万 → fmtNum 最小 0 位 → '0'）
    expect(row!.totalFee).toBe('94.9')        // 948960/10000 = 94.896 → 94.9 万
    expect(row!.avgPrice).toBe('412.59')  // 加权口径：948960/2300
  })
})
