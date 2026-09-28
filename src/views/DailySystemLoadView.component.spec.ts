// @vitest-environment happy-dom
// 逐日系统负荷（#3379）：系统负荷有数而错位负荷为空壳（云南无该口径）时，页面给出口径说明、
// 错位负荷列空态文案改为「当前地区无错位负荷口径」；两列都有数（山西）时不出说明、不改文案。
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
vi.mock('../components/CapabilitySupportBadge.vue', () => ({
  default: { name: 'CapabilitySupportBadge', template: '<div class="stub-badge" />' }
}))
vi.mock('../components/common/LoadPanelChart.vue', () => ({
  default: {
    name: 'LoadPanelChart',
    props: ['source', 'metricKey', 'colName', 'metricName', 'height', 'resizable', 'emptyText'],
    template: '<div class="stub-panel" :data-col="colName" :data-empty="emptyText ?? \'\'" />'
  }
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

function misplaceEmptyTexts(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.findAll('.stub-panel')
    .filter((p) => p.attributes('data-col') === '错位负荷实际值')
    .map((p) => p.attributes('data-empty'))
}

beforeEach(() => {
  fetchContract.mockReset()
})

describe('逐日系统负荷·错位负荷口径说明（#3379）', () => {
  it('错位负荷为空壳（云南）：出口径说明，错位列空态文案改为无口径', async () => {
    fetchContract.mockResolvedValue(contract([]))
    const wrapper = await mountView()

    const callout = wrapper.find('.callout-box')
    expect(callout.exists()).toBe(true)
    expect(callout.text()).toContain('山西交易平台特有的统计口径')
    expect(callout.text()).toContain('MW')

    const texts = misplaceEmptyTexts(wrapper)
    expect(texts).toHaveLength(6) // 三个指标页 + 「全部」页三行
    expect(texts.every((t) => t === '当前地区无错位负荷口径')).toBe(true)
    // 系统负荷列不受影响：不传空态文案
    const systemTexts = wrapper.findAll('.stub-panel')
      .filter((p) => p.attributes('data-col') === '系统负荷实际值')
      .map((p) => p.attributes('data-empty'))
    expect(systemTexts.every((t) => t === '')).toBe(true)
  })

  it('两列都有数（山西）：不出说明，错位列保持默认空态文案', async () => {
    fetchContract.mockResolvedValue(contract(['2025年', '2026年']))
    const wrapper = await mountView()

    expect(wrapper.find('.callout-box').exists()).toBe(false)
    const texts = misplaceEmptyTexts(wrapper)
    expect(texts).toHaveLength(6)
    expect(texts.every((t) => t === '')).toBe(true)
  })
})
