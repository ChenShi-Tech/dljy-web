// @vitest-environment happy-dom
// 逐日系统负荷版面（dljy#3384）：错位负荷为空壳（云南没有这项统计）时整列不渲染、不留空图，
// 换成单源版面；两列都有数（山西）时保持「系统 vs 错位」双列。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ActualLoadSourceViewModel, MarketInsightActualLoadContract } from '@/services/data/contracts'

const fetchContract = vi.fn()
vi.mock('@/services/data/contracts', () => ({
  fetchMarketInsightActualLoadContract: (...args: unknown[]) => fetchContract(...args)
}))
vi.mock('../composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('../composables/useQuerySync', () => ({ useQuerySync: () => {} }))
vi.mock('@/features/aiSidebar', () => ({ defineAiPage: () => {}, useAiSidebar: () => ({ interpret: vi.fn() }) }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
vi.mock('../components/common/LoadPanelChart.vue', () => ({
  default: {
    name: 'LoadPanelChart',
    props: ['source', 'metricKey', 'colName', 'metricName', 'height', 'resizable'],
    template: '<div class="stub-panel" :data-col="colName" />'
  }
}))
vi.mock('../components/common/LoadRangeBoard.vue', () => ({
  default: { name: 'LoadRangeBoard', props: ['source'], template: '<div class="stub-range" :data-years="source.years.join()" />' }
}))
import DailySystemLoadView from './DailySystemLoadView.vue'

const STUBS = {
  'el-alert': { template: '<div class="stub-alert"><slot /></div>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-tabs': { template: '<div class="stub-tabs"><slot /></div>' },
  'el-tab-pane': { template: '<div class="stub-pane"><slot /></div>' }
}

function source(key: 'system' | 'misplace', years: string[]): ActualLoadSourceViewModel {
  const row = () => Array.from({ length: 366 }, () => 30000)
  return {
    key,
    label: key,
    nameList: years.length ? Array.from({ length: 366 }, (_, i) => `d${i}`) : [],
    years,
    metrics: { average: years.map(row), min: years.map(row), max: years.map(row) }
  }
}

function contract(misplaceYears: string[]): MarketInsightActualLoadContract {
  return {
    blocks: {
      actual_load: {
        key: 'actual_load',
        label: '逐日系统负荷实际值',
        status: 'available',
        source: 'sdpt_actualLoad/query__',
        sources: { system: source('system', ['2025年', '2026年']), misplace: source('misplace', misplaceYears) },
        notes: []
      }
    }
  } as unknown as MarketInsightActualLoadContract
}

async function mountView() {
  const wrapper = mount(DailySystemLoadView, {
    global: { stubs: STUBS, directives: { loading: {} } }
  })
  await flushPromises()
  return wrapper
}

const panelCols = (wrapper: Awaited<ReturnType<typeof mountView>>) =>
  wrapper.findAll('.stub-panel').map((p) => p.attributes('data-col'))

beforeEach(() => {
  fetchContract.mockReset()
})

describe('逐日系统负荷·按数据切换版面（dljy#3384）', () => {
  it('错位负荷为空壳（云南）：不渲染错位负荷列与分页，只出单源版面，也不出说明文字', async () => {
    fetchContract.mockResolvedValue(contract([]))
    const wrapper = await mountView()

    expect(wrapper.find('.stub-range').exists()).toBe(true)
    expect(wrapper.find('.stub-range').attributes('data-years')).toBe('2025年,2026年')
    expect(panelCols(wrapper)).toEqual([])
    expect(wrapper.find('.stub-tabs').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('错位负荷')
    expect(wrapper.find('.callout-box').exists()).toBe(false)
  })

  it('两列都有数（山西）：保持系统 vs 错位双列，不出单源版面', async () => {
    fetchContract.mockResolvedValue(contract(['2025年', '2026年']))
    const wrapper = await mountView()

    expect(wrapper.find('.stub-range').exists()).toBe(false)
    const cols = panelCols(wrapper)
    expect(cols.filter((c) => c === '错位负荷实际值')).toHaveLength(6)
    expect(cols.filter((c) => c === '系统负荷实际值')).toHaveLength(6)
  })

  it('数据未到时不渲染任何图（不先闪双列再切换）', async () => {
    fetchContract.mockReturnValue(new Promise(() => {}))
    const wrapper = mount(DailySystemLoadView, { global: { stubs: STUBS, directives: { loading: {} } } })
    await flushPromises()
    expect(wrapper.find('.stub-range').exists()).toBe(false)
    expect(panelCols(wrapper)).toEqual([])
  })
})
