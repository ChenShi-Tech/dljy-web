// 月度数据窗口回归（spec: spot-cockpit-data-window「切回有采集数据的月份后恢复展示」）：
// 锁住「损益/结算窗口由所选日期所在日历月派生」的修复——曾因窗口写死 2026-05，
// 切到 6 月再切回 5 月后实现损益/偏差体检/损益归因永远停在 5 月或空态。
// 用 mock 结算/损益全量载荷驱动日期 2026-05 → 2026-06 → 2026-05，断言面板数据「有 → 空 → 恢复」。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

// 2026-05 全量家族载荷（fetchCaptured 不带日期过滤，窗口过滤在 loadCockpit 内做——
// 正是本回归要锁的口径：6 月窗口对全量载荷过滤后为诚实空态，5 月窗口恢复）。
const LOSS_ROWS = vi.hoisted(() => [
  {
    date: '2026-05-26', plant: 'A厂', area: 'yn',
    totalGenerationMwh: 1000, strategyLossTotal: 200000, strategyLossPerMwh: null,
    forecastLossTotal: 300000, forecastLossPerMwh: null, gridLossTotal: 100000,
    gridLossPerMwh: null, originalValueTotal: 5000000
  },
  {
    date: '2026-05-27', plant: 'A厂', area: 'yn',
    totalGenerationMwh: 1100, strategyLossTotal: 210000, strategyLossPerMwh: null,
    forecastLossTotal: 310000, forecastLossPerMwh: null, gridLossTotal: 110000,
    gridLossPerMwh: null, originalValueTotal: 5100000
  }
])
const SETTLE_ROWS = vi.hoisted(() => [
  {
    date: '2026-05-26', plant: 'A厂', area: 'yn',
    ltmEnergy: 400, ltmPrice: 400, daClearedEnergy: null, daDevEnergy: 10, daPrice: null,
    daDevFee: 1000, rtDevEnergy: 20, rtPrice: null, rtDevFee: 15000000,
    actualOnGridEnergy: null, totalEnergy: 500, avgPrice: null, totalFee: 48000000
  },
  {
    date: '2026-05-27', plant: 'A厂', area: 'yn',
    ltmEnergy: 410, ltmPrice: 400, daClearedEnergy: null, daDevEnergy: 12, daPrice: null,
    daDevFee: 1200, rtDevEnergy: 24, rtPrice: null, rtDevFee: 19780000,
    actualOnGridEnergy: null, totalEnergy: 510, avgPrice: null, totalFee: 48285000
  }
])

vi.mock('@/composables/useEChart', () => ({
  // happy-dom 无 canvas：图表只验数据驱动（DOM 文案），setOption 本身不验
  useEChart: () => ({
    setOption: vi.fn(), resize: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), dispose: vi.fn()
  })
}))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div />' }
}))
vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  hasCgnYunnanPriceEntitlement: () => false
}))
vi.mock('@/services/market/captureCoverage', () => ({
  // 覆盖不可得 → 初始日期回退 props.initialDate（2026-05-01），测试确定性
  fetchCaptureCoverage: vi.fn(async () => null),
  fetchCaptureCoverageWithFallback: vi.fn(async () => null)
}))
vi.mock('@/services/market/spotClient', () => ({
  fetchDailySummary: vi.fn(async () => ({ items: [] })),
  fetchHeatmap: vi.fn(async () => ({ nodes: [], time_points: [], matrix: [] })),
  fetchNodePriceSeries: vi.fn(async () => ({ series: [] }))
}))
vi.mock('@/services/market/settlementClient', () => ({
  SETTLEMENT_PRIVATE_FAMILIES: [],
  loadSettlementPrices: vi.fn(async () => ({ points: [], hasData: false }))
}))
vi.mock('@/services/market/plantOutputClient', () => ({
  PLANT_OUTPUT_PRIVATE_FAMILIES: [],
  loadPlantOutputPayload: vi.fn(async () => ({ rows: [] }))
}))
vi.mock('@/services/market/plantForecastArena', () => ({
  buildPlantForecastArena: vi.fn(() => ({
    hasData: false, date: '', sourceCount: 0, actualSource: null, sources: [],
    trends: {}, trend: { source: null, times: [], actual: [], forecast: [] }
  }))
}))
vi.mock('@/services/captured', () => ({
  fetchCaptured: vi.fn(async (family: string) => {
    if (family === 'yn_loss_attribution') return { code: 200, data: LOSS_ROWS }
    if (family === 'yn_spot_settlement') return { code: 200, data: SETTLE_ROWS }
    return { code: 200, data: [] }
  })
}))

async function mountCockpit() {
  const { mount } = await import('@/test/mount')
  const { default: Cockpit } = await import('./SpotCockpitCore.vue')
  return mount(Cockpit, {
    props: { regionName: '云南', regionId: 'yunnan', initialDate: '2026-05-01' },
    global: { stubs: { ChartCard: true, DynamicTable: true } }
  })
}

function readPanels(wrapper: { element: Element }) {
  const el = wrapper.element
  const pnl = el.querySelectorAll('.row2')[1]?.querySelectorAll('.panel')[0]
  const dev = el.querySelectorAll('.row2')[1]?.querySelectorAll('.panel')[1]
  return {
    pnlTitle: pnl?.querySelector('.meta')?.textContent?.trim() ?? null,
    pnlInsight: pnl?.querySelector('.insight')?.textContent?.trim() ?? null,
    devWorst: dev?.querySelector('.chip')?.textContent?.trim() ?? null,
    kpiRevenue: el.querySelector('.kpi .val.pos')?.textContent?.trim() ?? null
  }
}

// 驱动 el-date-picker 的 v-model 与 change（与真实选日期同一条 onDateChange 路径）
async function pickDate(wrapper: Awaited<ReturnType<typeof mountCockpit>>, value: string) {
  const picker = wrapper.findComponent({ name: 'ElDatePicker' })
  expect(picker.exists()).toBe(true)
  picker.vm.$emit('update:modelValue', value)
  await flushPromises()
  picker.vm.$emit('change', value)
  await flushPromises()
  await flushPromises()
}

describe('现货 cockpit · 月度数据窗口（2026-05 → 06 → 05）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it(
    '5 月有数据 → 6 月诚实空态 → 切回 5 月恢复（不残留空态）',
    { timeout: 20000 },
    async () => {
      const wrapper = await mountCockpit()
      await flushPromises()

      const may = readPanels(wrapper)
      expect(may.pnlTitle).toContain('2026-05 区间')
      expect(may.devWorst).toContain('05-27 预警')
      expect(may.kpiRevenue).toBe('9,628.5万元')
      expect(may.pnlInsight).toContain('预测损失')

      await pickDate(wrapper, '2026-06-15')
      const june = readPanels(wrapper)
      expect(june.pnlTitle).toContain('2026-06 区间')
      expect(june.devWorst).toBeNull()
      expect(june.kpiRevenue).toBe('—万元')
      expect(june.pnlInsight).toBeNull()

      await pickDate(wrapper, '2026-05-27')
      const restored = readPanels(wrapper)
      expect(restored.pnlTitle).toContain('2026-05 区间')
      expect(restored.devWorst).toContain('05-27 预警')
      expect(restored.kpiRevenue).toBe('9,628.5万元')
      expect(restored.pnlInsight).toContain('预测损失')

      wrapper.unmount()
    }
  )
})
