// slim-spot-page-explainers：电厂出力面板 hero 一行化与摄取提示降层（spec
// spot-page-hint-density「云南分析面板 hero 一行化与口径收纳」+ spot-degradation-honesty
// 「摄取指引提示的呈现层级」）。mock plantOutputClient 三态：
// 空 rows（非 mock）→ ingestHint 一行状态行；meta.mock → Mock 标识保持 el-alert
// 显著形态（红线），仅摄取命令降层为展开明细。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import { mount } from '@/test/mount'

vi.mock('@/services/market/plantOutputClient', () => ({
  ALL_PLANTS: '__all__',
  ALL_UNITS: '__all__',
  PLANT_OUTPUT_FAMILY: 'yn_plant_output',
  PLANT_OUTPUT_PRIVATE_FAMILIES: ['yn_plant_output'],
  availableForecastTypes: () => [],
  buildPlantOutputSeries: () => [],
  detectPlantOutputAnomalies: () => [],
  loadPlantOutputPayload: vi.fn(),
  summarizePlantOutput: () => ({ pointCount: 0 })
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

import { loadPlantOutputPayload } from '@/services/market/plantOutputClient'
import PlantOutputPanel from './PlantOutputPanel.vue'

const GLOBAL = { stubs: { ChartCard: true, DynamicTable: true } }

const EMPTY_META = { hasRealData: false, mock: false, sourceType: '', updatedAt: null }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(loadPlantOutputPayload).mockReset()
})

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await nextTick()
}

describe('PlantOutputPanel hero 一行化与摄取提示降层', () => {
  it('hero 无常驻说明段，口径经 ⓘ 可达', async () => {
    vi.mocked(loadPlantOutputPayload).mockResolvedValue({ rows: [], plants: [], meta: EMPTY_META } as never)
    const wrapper = mount(PlantOutputPanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.po-hero p').exists()).toBe(false)
    const hint = wrapper.findComponent(InfoHint)
    expect(hint.exists()).toBe(true)
    expect(hint.props('text')).toContain('实际出力、计划/预测出力、完成率')
  })

  it('未摄取空态压一行：summary 显事实，完整摄取命令收展开明细', async () => {
    vi.mocked(loadPlantOutputPayload).mockResolvedValue({ rows: [], plants: [], meta: EMPTY_META } as never)
    const wrapper = mount(PlantOutputPanel, { global: GLOBAL })
    await settle()

    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => (w.props('summary') as string)?.includes('后端暂无 yn_plant_output'))
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items[0].text).toContain('import:spot-export --write')
    expect(items[0].text).toContain('plant_integrated_power_forecast_actual.csv')
  })

  it('Mock 标识保持显著 el-alert（红线），摄取命令降层为展开明细', async () => {
    vi.mocked(loadPlantOutputPayload).mockResolvedValue({
      rows: [],
      plants: [],
      meta: { hasRealData: false, mock: true, sourceType: 'MOCK', updatedAt: null }
    } as never)
    const wrapper = mount(PlantOutputPanel, { global: GLOBAL })
    await settle()

    const alert = wrapper.find('.po-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('检测到模拟回放，已禁止上屏')
    // 摄取指引默认收起（details 未展开时命令不在可见文本里），summary 行可见
    const detail = alert.find('details.po-ingest-detail')
    expect(detail.exists()).toBe(true)
    expect((detail.element as HTMLDetailsElement).open).toBe(false)
    expect(detail.find('summary').text()).toContain('摄取指引')
  })
})
