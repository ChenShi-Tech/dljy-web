// @vitest-environment happy-dom
// 云南结算价面板呈现契约（slim-and-fix-market-insight-pages R5）：
// hero 一行化（公式/端点全文进 ⓘ）、摄取指引降层为状态行（完整命令展开可达）、
// 「真实或空」诚实标注保持直接可见。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@/test/mount'

const loadSettlement = vi.fn()
vi.mock('@/services/market/settlementClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/market/settlementClient')>()
  return { ...actual, loadSettlementPrices: (...a: unknown[]) => loadSettlement(...a) }
})
const fetchDaily = vi.fn()
vi.mock('@/services/market/spotClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/market/spotClient')>()
  return { ...actual, fetchDailySummary: (...a: unknown[]) => fetchDaily(...a) }
})
const fetchWeighted = vi.fn()
vi.mock('@/services/market/yunnanSettlementAnalysis', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, fetchWeightedSettlementAvg: (...a: unknown[]) => fetchWeighted(...a) }
})
vi.mock('@/services/market/captureCoverage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/market/captureCoverage')>()
  return { ...actual, fetchSettlementCoverage: vi.fn(async () => null) }
})
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
// 图表/表格重组件占位：本用例只断言 hero/状态行呈现
vi.mock('../../../components/common/ChartCard.vue', () => ({
  default: { name: 'ChartCard', props: ['title'], template: '<div class="stub-chart">{{ title }}</div>' }
}))
vi.mock('../../../components/common/DynamicTable.vue', () => ({
  default: { name: 'DynamicTable', template: '<div class="stub-table" />' }
}))
import YunnanSettlementPricePanel from './YunnanSettlementPricePanel.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'

const EMPTY_RESULT = {
  points: [], plantOptions: [], basis: 'empty' as const, hasData: false,
  sourceType: 'REAL', mock: false, updatedAt: null, matchedPlant: null
}

function stubs() {
  return {
    SpotSkeleton: { template: '<div class="stub-skeleton" />' },
    SpotFilterBar: { template: '<div class="stub-filter"><slot /></div>' },
    DataQualityBadge: { template: '<div class="stub-quality" />' }
  }
}

async function mountPanel() {
  const wrapper = mount(YunnanSettlementPricePanel, { global: { stubs: stubs() } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  loadSettlement.mockReset()
  fetchDaily.mockReset()
  fetchWeighted.mockReset()
  loadSettlement.mockResolvedValue(EMPTY_RESULT)
  fetchDaily.mockResolvedValue({ items: [] })
  fetchWeighted.mockResolvedValue({ points: [], meta: { range: ['2026-05-01', '2026-05-31'] } })
})

describe('云南结算价：hero 一行化与摄取指引降层', () => {
  it('hero 一行：无成段文案，公式与端点全文经 ⓘ 可达，真实或空标注直接可见', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('.sp-hero p').exists()).toBe(false)
    const hint = wrapper.findComponent(InfoHint)
    expect(hint.exists()).toBe(true)
    const text = String(hint.props('text'))
    expect(text).toContain('Σ电费/Σ电量')
    expect(text).toContain('/v1/spot/node-price/daily')
    expect(text).toContain('不回退他省')
    // 诚实标注常驻可见（不被折叠进 ⓘ）
    expect(wrapper.find('.sp-hero .el-tag').text()).toContain('真实或空')
  })

  it('结算族未摄取：摄取指引以状态行呈现，完整 ETL 命令在展开项中可达', async () => {
    const wrapper = await mountPanel()

    const lines = wrapper.findAllComponents(DataStatusLine)
    const settleLine = lines.find((l) => String(l.props('summary')).includes('后端暂无云南结算数据'))
    expect(settleLine).toBeTruthy()
    const items = settleLine!.props('items') as Array<{ text: string }>
    expect(items[0].text).toContain('yn-fact-pnl.mjs')
    expect(items[0].text).toContain('capture-raw/yunnan/')
    // 不再以「警示标题 + 长描述」双行 el-alert 常驻
    const alerts = wrapper.findAll('.el-alert, .stub-alert')
    expect(alerts.filter((a) => a.text().includes('yn-fact-pnl')).length).toBe(0)
  })

  it('取数失败（R2）：呈现失败而非「未摄取」状态行', async () => {
    loadSettlement.mockRejectedValue(new Error('结算数据读取失败：503'))
    const wrapper = await mountPanel()

    const lines = wrapper.findAllComponents(DataStatusLine)
    expect(lines.filter((l) => String(l.props('summary')).includes('后端暂无云南结算数据')).length).toBe(0)
    expect(wrapper.text()).not.toContain('yn-fact-pnl.mjs')
  })
})
