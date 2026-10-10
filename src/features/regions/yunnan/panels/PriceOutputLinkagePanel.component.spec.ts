// slim-spot-page-explainers：电价×出力联动面板 hero 一行化与摄取提示降层（spec
// spot-page-hint-density + spot-degradation-honesty「摄取指引提示的呈现层级」）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import { mount } from '@/test/mount'

vi.mock('@/services/market/plantOutputClient', () => ({
  ALL_PLANTS: '__all__',
  ALL_UNITS: '__all__',
  PLANT_OUTPUT_PRIVATE_FAMILIES: ['yn_plant_output'],
  loadPlantOutputRangePayload: vi.fn(),
  pointToTime: (i: number) => i
}))

vi.mock('@/services/market/spotClient', () => ({
  fetchNodePriceSeries: vi.fn().mockResolvedValue([])
}))

vi.mock('@/services/captured', () => ({
  regionDataStatus: { value: { accessDenied: null, deniedCaptureFamilies: new Set() } }
}))

vi.mock('@/services/api', () => ({
  deniedCaptureFamilies: { value: new Set() }
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan' } }
}))

import { loadPlantOutputRangePayload } from '@/services/market/plantOutputClient'
import PriceOutputLinkagePanel from './PriceOutputLinkagePanel.vue'

// ChartCard stub 需带 instance(): null —— bindChartClickHandlers 会经 ref 调
// instance() 取 ECharts 实例，缺了会抛未处理 rejection。
const GLOBAL = {
  stubs: { ChartCard: { template: '<div />', methods: { instance: () => null } }, DynamicTable: true }
}

const EMPTY_META = { hasRealData: false, mock: false, sourceType: '', updatedAt: null }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(loadPlantOutputRangePayload).mockReset()
})

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await nextTick()
}

describe('PriceOutputLinkagePanel hero 一行化与摄取提示降层', () => {
  it('hero 无常驻说明段，口径经 ⓘ 可达', async () => {
    vi.mocked(loadPlantOutputRangePayload).mockResolvedValue({ rows: [], plants: [], nodes: [], meta: EMPTY_META } as never)
    const wrapper = mount(PriceOutputLinkagePanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.pol-hero p').exists()).toBe(false)
    const hint = wrapper.findComponent(InfoHint)
    expect(hint.exists()).toBe(true)
    expect(hint.props('text')).toContain('同一时间轴对齐节点现货出清价')
  })

  it('未摄取空态压一行：summary 显事实，完整摄取命令收展开明细', async () => {
    vi.mocked(loadPlantOutputRangePayload).mockResolvedValue({ rows: [], plants: [], nodes: [], meta: EMPTY_META } as never)
    const wrapper = mount(PriceOutputLinkagePanel, { global: GLOBAL })
    await settle()

    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => (w.props('summary') as string)?.includes('后端暂无 yn_plant_output 电厂出力数据'))
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items[0].text).toContain('import:spot-export --write')
  })
})
