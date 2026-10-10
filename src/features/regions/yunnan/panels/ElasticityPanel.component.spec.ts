// slim-spot-page-explainers：价格弹性面板 hero 一行化与口径收纳（spec spot-page-hint-density
// 「云南分析面板 hero 一行化与口径收纳」）。走组件真实渲染路径，仅 mock 取数：
// ① hero 不再常驻公式段、口径全文经 InfoHint 可达；② 后端 notes 收进 DataStatusLine
// （默认收起一行）；③ 引擎空态压一行（summary 显事实、明细展开可达），error 态保持
// 直接可见的 el-alert（诚实边界不动）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import { mount } from '@/test/mount'

vi.mock('@/services/market/spotClient', () => ({
  fetchSpotRegions: vi.fn().mockResolvedValue({ regions: ['云南'] })
}))

vi.mock('@/services/market/elasticityClient', () => ({
  fetchElasticity: vi.fn()
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

import { fetchElasticity } from '@/services/market/elasticityClient'
import ElasticityPanel from './ElasticityPanel.vue'

const GLOBAL = { stubs: { ChartCard: true } }

const AVAILABLE_RESULT = {
  available: true,
  notes: ['口径一：出清价=节点电价系统均价', '口径二：外送缺披露按 0 计'],
  mae_model: 30.1,
  mae_naive: 35.2,
  mae_improvement_pct: 14.5,
  steep_share_pct: 25,
  train_days: 21,
  train_points: 2016,
  naive_prev_day: '2026-05-19',
  prediction_method: '弹性调整持续性'
}

beforeEach(() => {
  vi.mocked(fetchElasticity).mockReset()
})

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('ElasticityPanel hero 一行化与口径收纳', () => {
  it('hero 无常驻公式段，口径全文经 ⓘ 可达，诚实徽章保持可见', async () => {
    vi.mocked(fetchElasticity).mockResolvedValue(AVAILABLE_RESULT as never)
    const wrapper = mount(ElasticityPanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.el-hero p').exists()).toBe(false)
    expect(wrapper.find('.el-notes').exists()).toBe(false)
    const hint = wrapper.findComponent(InfoHint)
    expect(hint.exists()).toBe(true)
    expect(hint.props('text')).toContain('竞价空间 = 统调负荷 + 外送电量 − 新能源出力')
    expect(hint.props('text')).toContain('MAE 口径（非 MAPE）')
    // 诚实徽章不因收纳降级
    expect(wrapper.text()).toContain('分析参考 · 非结算依据')
    expect(wrapper.text()).toContain('真实数据：系统供需 + 节点电价')
  })

  it('后端 notes 收进「口径与数据说明」状态行（DataStatusLine，默认收起）', async () => {
    vi.mocked(fetchElasticity).mockResolvedValue(AVAILABLE_RESULT as never)
    const wrapper = mount(ElasticityPanel, { global: GLOBAL })
    await settle()

    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => w.props('label') === '口径与数据说明')
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items.map((i) => i.text)).toEqual(AVAILABLE_RESULT.notes)
  })

  it('引擎空态压一行：summary 显事实、明细含完整口径，不再双行 el-alert', async () => {
    vi.mocked(fetchElasticity).mockResolvedValue({ available: false, notes: [] } as never)
    const wrapper = mount(ElasticityPanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.el-alert').exists()).toBe(false)
    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => (w.props('summary') as string)?.includes('暂无足够真实数据'))
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items[0].text).toContain('价格弹性引擎仅云南有真实系统供需与节点电价')
    expect(items[0].text).toContain('请更换为数据覆盖范围内')
  })

  it('取数失败仍走直接可见的 el-alert（诚实边界不动）', async () => {
    vi.mocked(fetchElasticity).mockRejectedValue(new Error('HTTP 500'))
    const wrapper = mount(ElasticityPanel, { global: GLOBAL })
    await settle()

    const alert = wrapper.find('.el-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('HTTP 500')
  })
})
