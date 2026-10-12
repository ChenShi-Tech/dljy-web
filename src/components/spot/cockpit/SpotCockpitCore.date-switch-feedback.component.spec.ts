// 切日期加载反馈回归（spec: cockpit-load-feedback）：
// 用户切日期/市场后取数+渲染耗时，但此前面板无任何加载反馈，loading 只体现在
// 「重新加载」按钮上——用户以为没切换成功；且 date 是 v-model 选中即变，面板标题
// 先于数据跳到新月份，构成「假切换」。本 spec 用可控时序 mock 锁住：
//   加载中 → 遮罩在、控件禁用、KPI 仍显示旧落地数据；
//   落地后 → 遮罩消失、控件恢复、KPI 换成新窗口数据、面板标题进入新月份。
// 「已落地」判据用实现损益 KPI（绑定 data 聚合值）而非日期输入框/面板标题（v-model 先行）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const LOSS_ROWS = vi.hoisted(() => [
  {
    date: '2026-05-26', plant: 'A厂', area: 'yn',
    totalGenerationMwh: 1000, strategyLossTotal: 200000, strategyLossPerMwh: null,
    forecastLossTotal: 300000, forecastLossPerMwh: null, gridLossTotal: 100000,
    gridLossPerMwh: null, originalValueTotal: 5000000
  }
])
const SETTLE_ROWS = vi.hoisted(() => [
  {
    date: '2026-05-26', plant: 'A厂', area: 'yn',
    ltmEnergy: 400, ltmPrice: 400, daClearedEnergy: null, daDevEnergy: 10, daPrice: null,
    daDevFee: 1000, rtDevEnergy: 20, rtPrice: null, rtDevFee: 15000000,
    actualOnGridEnergy: null, totalEnergy: 500, avgPrice: null, totalFee: 48000000
  }
])

// 取数闸门：arm() 后 fetchDailySummary 挂起，release() 放行——模拟「切日期后加载慢」窗口。
const gate = vi.hoisted(() => {
  let pending: Promise<void> | null = null
  let releaseFn: (() => void) | null = null
  return {
    arm() {
      pending = new Promise<void>((r) => (releaseFn = r))
    },
    release() {
      releaseFn?.()
      pending = null
      releaseFn = null
    },
    wait() {
      return pending ?? Promise.resolve()
    }
  }
})

// 落地取数参数记录：市场切换测试用（KPI 值与市场无关，改用「最后一次日聚合取数的
// market 入参」断言已落地重载确实带上了 RT）。
const spotCalls = vi.hoisted(() => ({ list: [] as Array<{ date: string; market: string }> }))

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
  fetchDailySummary: vi.fn(async (date: string, market: string) => {
    spotCalls.list.push({ date, market })
    await gate.wait()
    return { items: [] }
  }),
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

function maskVisible(wrapper: { element: Element }) {
  const mask = wrapper.element.querySelector('.el-loading-mask') as HTMLElement | null
  return Boolean(mask && mask.style.display !== 'none')
}
// 已落地数据判据：实现损益 KPI（聚合自结算 totalFee，mock 5 月单行 → 4,800.0 万）。
// June 窗口过滤后为空 → 「—万元」。
function landedKpi(wrapper: { element: Element }) {
  return wrapper.element.querySelector('.kpi .val.pos')?.textContent?.replace(/\s+/g, '') ?? ''
}
function pnlTitle(wrapper: { element: Element }) {
  return wrapper.element.querySelectorAll('.row2')[1]?.querySelectorAll('.panel')[0]?.querySelector('.meta')?.textContent?.trim() ?? ''
}
function segButtons(wrapper: { element: Element }) {
  return Array.from(wrapper.element.querySelectorAll<HTMLButtonElement>('.ctrls .seg button'))
}
function segDisabled(wrapper: { element: Element }) {
  const btns = segButtons(wrapper)
  return btns.length > 0 && btns.every((b) => b.disabled)
}
// loadCockpit 是两阶段长链路，固定次数 flushPromises 不稳；轮询等条件就位。
async function until(cond: () => boolean, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await flushPromises()
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('until: 条件等待超时')
}

describe('现货 cockpit · 切日期加载反馈', () => {
  beforeEach(() => {
    vi.resetModules()
    spotCalls.list.length = 0
  })

  it('加载中遮罩+禁用+KPI保持旧落地数据，落地后 KPI/面板进入新窗口', { timeout: 20000 }, async () => {
    const wrapper = await mountCockpit()
    // 初始落地：KPI 显示已加载的 5 月结算合计，无遮罩
    await until(() => landedKpi(wrapper).includes('4,800'))
    expect(maskVisible(wrapper)).toBe(false)

    // 切到 2026-06-03，取数挂起（模拟加载慢）
    gate.arm()
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    picker.vm.$emit('update:modelValue', '2026-06-03')
    picker.vm.$emit('change', '2026-06-03')

    // 加载中：遮罩在、日期框与 DA/RT 禁用、KPI 仍是旧落地数据（不提前假切换）
    await until(() => maskVisible(wrapper))
    expect(picker.props('disabled')).toBe(true)
    expect(segDisabled(wrapper)).toBe(true)
    expect(landedKpi(wrapper)).toContain('4,800')

    // 数据落地：遮罩消失、控件恢复、KPI 进入 6 月窗口（mock 无 6 月数据 → 诚实空态）
    gate.release()
    await until(() => landedKpi(wrapper).includes('—'))
    expect(maskVisible(wrapper)).toBe(false)
    expect(segDisabled(wrapper)).toBe(false)
    expect(pnlTitle(wrapper)).toContain('2026-06 区间')

    wrapper.unmount()
  })

  it('切市场（日前 DA → 实时 RT）同样给出加载反馈', { timeout: 20000 }, async () => {
    const wrapper = await mountCockpit()
    await until(() => landedKpi(wrapper).includes('4,800'))

    gate.arm()
    const rtBtn = segButtons(wrapper).find((b) => b.textContent?.includes('实时'))!
    rtBtn.click()

    await until(() => maskVisible(wrapper))
    expect(segDisabled(wrapper)).toBe(true)

    gate.release()
    // 落地重载确实带上了 RT（最后一次日聚合取数的 market 入参）：
    // 先等 RT 取数发起，再等遮罩消失，避免把「刚发起还没落地」误判成完成。
    await until(() => spotCalls.list.at(-1)?.market === 'rt')
    await until(() => !maskVisible(wrapper))
    expect(spotCalls.list.at(-1)?.market).toBe('rt')

    wrapper.unmount()
  })
})
