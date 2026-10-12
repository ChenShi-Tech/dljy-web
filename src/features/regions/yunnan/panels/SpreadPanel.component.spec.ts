// slim-spot-page-explainers：日前-实时价差面板 hero 一行化与口径收纳（spec
// spot-page-hint-density；与 ElasticityPanel.component.spec 同构）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'
import InfoHint from '@/components/common/InfoHint.vue'
import { mount } from '@/test/mount'

vi.mock('@/services/market/spotClient', () => ({
  fetchSpotRegions: vi.fn().mockResolvedValue({ regions: ['云南'] })
}))

vi.mock('@/services/market/spreadClient', () => ({
  fetchSpread: vi.fn()
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

import { fetchSpread } from '@/services/market/spreadClient'
import SpreadPanel from './SpreadPanel.vue'

const GLOBAL = { stubs: { ChartCard: true } }

const AVAILABLE_RESULT = {
  available: true,
  notes: ['口径一：价差=DA−RT 系统均价', '口径二：套利收益=回放参考']
}

beforeEach(() => {
  vi.mocked(fetchSpread).mockReset()
})

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('SpreadPanel hero 一行化与口径收纳', () => {
  it('hero 无常驻方法学段落，口径全文经 ⓘ 可达，诚实徽章保持可见', async () => {
    vi.mocked(fetchSpread).mockResolvedValue(AVAILABLE_RESULT as never)
    const wrapper = mount(SpreadPanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.sp-hero p').exists()).toBe(false)
    expect(wrapper.find('.sp-notes').exists()).toBe(false)
    const hint = wrapper.findComponent(InfoHint)
    expect(hint.exists()).toBe(true)
    expect(hint.props('text')).toContain('价差 = 日前出清价 − 实时出清价')
    expect(wrapper.text()).toContain('决策支持参考 · 非结算依据')
    expect(wrapper.text()).toContain('套利收益=回放参考·非真实成交')
  })

  it('后端 notes 收进「口径与数据说明」状态行', async () => {
    vi.mocked(fetchSpread).mockResolvedValue(AVAILABLE_RESULT as never)
    const wrapper = mount(SpreadPanel, { global: GLOBAL })
    await settle()

    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => w.props('label') === '口径与数据说明')
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items.map((i) => i.text)).toEqual(AVAILABLE_RESULT.notes)
  })

  it('引擎空态压一行：summary 显事实、明细含完整口径', async () => {
    vi.mocked(fetchSpread).mockResolvedValue({ available: false, notes: [] } as never)
    const wrapper = mount(SpreadPanel, { global: GLOBAL })
    await settle()

    expect(wrapper.find('.sp-alert').exists()).toBe(false)
    const dsl = wrapper
      .findAllComponents(DataStatusLine)
      .find((w) => (w.props('summary') as string)?.includes('暂无足够真实 DA/RT 价差数据'))
    expect(dsl).toBeDefined()
    const items = dsl!.props('items') as { text: string }[]
    expect(items[0].text).toContain('价差引擎仅云南有真实日前/实时系统价')
  })
})
