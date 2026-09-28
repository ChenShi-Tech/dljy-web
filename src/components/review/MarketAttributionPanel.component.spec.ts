// 月度市场归因面板组件测试（#2046 四行呈现 + #3392 改接平台真实数据后的回归护栏）
// 守的不变量：① 三行自动预填读 marketAttributionSource（不再 import loadMarketAnalysis），
// 显示月现货均价/近 12 个月均值偏离/「暂无公共来源」；② 价格来源 empty → 价格行诚实
// 「无真实数据」、供需/异常行不出伪结论；③ 取数失败整面板不出数不合成；④ 快速切月
// 时旧月慢返回不得覆盖新月结果（代次守卫）；⑤ 地区切换重新取数。
// 坏掉的症状：面板回落示例/合成数据、串读他省口径、切月竞态显示错月归因。
// issue：ChenShi-Tech/dljy#3392（原 #2046）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/marketAttributionSource', () => ({ fetchMarketAttributionSource: vi.fn() }))
vi.mock('@/services/region/regionContext', async () => {
  const { ref } = await import('vue')
  return { currentRegion: ref({ id: 'yunnan' }) }
})
vi.mock('@/services/review/reviewStoreClient', () => ({
  fetchImprovementActions: vi.fn(),
  fetchRiskEvents: vi.fn(),
  registerRiskEvent: vi.fn(),
  createImprovementAction: vi.fn(),
  patchImprovementAction: vi.fn()
}))

import { fetchMarketAttributionSource } from '@/services/review/marketAttributionSource'
import { currentRegion } from '@/services/region/regionContext'
import { fetchImprovementActions, fetchRiskEvents } from '@/services/review/reviewStoreClient'
import MarketAttributionPanel from './MarketAttributionPanel.vue'
import { mount } from '@/test/mount'
import type { MarketAttributionSource } from '@/services/review/marketAttributionSource'

const curMonth = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
})()
function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const prevMonth = prevMonthOf(curMonth)

/** 构造近 6 个月（含复盘月）的月度序列；未列出的月份落 null。 */
function makeSource(opts: {
  prices?: Array<[string, number | null]>
  loads?: Array<[string, number | null]>
  priceBasis?: 'captured' | 'empty'
  loadBasis?: 'captured' | 'empty'
}): MarketAttributionSource {
  const priceOf = (m: string) => opts.prices?.find(([mm]) => mm === m)?.[1] ?? null
  const loadOf = (m: string) => opts.loads?.find(([mm]) => mm === m)?.[1] ?? null
  const months: string[] = []
  {
    const [y, m] = curMonth.split('-').map(Number)
    for (let back = 11; back >= 0; back--) {
      let mm = m - back
      let yy = y
      while (mm <= 0) {
        mm += 12
        yy -= 1
      }
      months.push(`${yy}-${String(mm).padStart(2, '0')}`)
    }
  }
  return {
    points: months.map((m) => ({ month: m, spotPrice: priceOf(m), avgLoad: loadOf(m) })),
    priceSource: {
      family: 'yn_system_forecast·da_user_price',
      basis: opts.priceBasis ?? 'captured',
      label: '日前用户侧电价'
    },
    loadSource: { family: 'sdpt_actualLoad', basis: opts.loadBasis ?? 'captured', label: '系统负荷（逐日均值）' }
  }
}

const fullSource = (): MarketAttributionSource =>
  makeSource({
    prices: [
      [monthsBack(curMonth, 5), 300],
      [monthsBack(curMonth, 4), 310],
      [monthsBack(curMonth, 3), 305],
      [monthsBack(curMonth, 2), 308],
      [prevMonth, 302],
      [curMonth, 900]
    ],
    loads: [[prevMonth, 30000], [curMonth, 33000]]
  })

function monthsBack(ym: string, back: number): string {
  const [y, m] = ym.split('-').map(Number)
  let mm = m - back
  let yy = y
  while (mm <= 0) {
    mm += 12
    yy -= 1
  }
  return `${yy}-${String(mm).padStart(2, '0')}`
}

function deferred(): { promise: Promise<MarketAttributionSource>; resolve: (v: MarketAttributionSource) => void } {
  let resolve!: (v: MarketAttributionSource) => void
  const promise = new Promise<MarketAttributionSource>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 8; i++) await nextTick()
  return wrapper
}

beforeEach(() => {
  vi.mocked(fetchMarketAttributionSource).mockReset()
  vi.mocked(fetchImprovementActions).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
  vi.mocked(fetchRiskEvents).mockResolvedValue({ available: true, events: [] })
})

describe('MarketAttributionPanel（#3392 真实数据口径）', () => {
  it('主路径：月现货均价 + 近 12 个月均值偏离、中长期「暂无公共来源」、供需同升、异常月识别、口径说明带数据族名与覆盖月份', async () => {
    vi.mocked(fetchMarketAttributionSource).mockResolvedValue(fullSource())
    const wrapper = await settle(mount(MarketAttributionPanel))
    const text = wrapper.text()
    // 首次取数带当前地区与当前月
    expect(fetchMarketAttributionSource).toHaveBeenCalledWith({ region: 'yunnan', month: curMonth })
    expect(text).toContain('价格走势')
    expect(text).toContain('月现货均价 900.0 元/MWh')
    expect(text).toContain('暂无公共来源')
    expect(text).toContain('+122.7%') // (900−404.17)/404.17，手算对拍
    expect(text).toContain('负荷与价格同升')
    expect(text).toContain('+3000 MW')
    expect(text).toContain('政策变化')
    expect(text).toContain('不做自动因果')
    expect(text).toContain('异常价格事件')
    expect(text).toContain(curMonth) // 异常月被点名
    expect(text).toContain('偏离近 12 个月均值 +495.8')
    expect(text).toContain('yn_system_forecast·da_user_price')
    expect(text).toContain(`${monthsBack(curMonth, 5)} ~ ${curMonth}`) // 价格数据覆盖月份
    expect(text).toContain('登记入风险事件库') // 事件库接线保持（available 时按钮在）
  })

  it('价格来源 empty → 价格行「无真实数据」、供需/异常行不出结论（诚实空，不合成）', async () => {
    vi.mocked(fetchMarketAttributionSource).mockResolvedValue(
      makeSource({ loads: [[curMonth, 33000]], priceBasis: 'empty' })
    )
    const wrapper = await settle(mount(MarketAttributionPanel))
    const text = wrapper.text()
    expect(text).toContain('无真实数据')
    expect(text).toContain('数据不足')
    expect(text).toContain('统计不成立')
    expect(text).not.toContain('较近 12 个月均值') // 仅价格数值分支才显示
  })

  it('取数失败 → 四行不出数不合成', async () => {
    vi.mocked(fetchMarketAttributionSource).mockRejectedValue(new Error('502 bad gateway'))
    const wrapper = await settle(mount(MarketAttributionPanel))
    const text = wrapper.text()
    expect(text).toContain('取数失败')
    expect(text).toContain('不合成')
  })

  it('过期响应守卫：快速切月后，旧月慢返回不得覆盖新月结果', async () => {
    const slow = deferred()
    const oldSource = fullSource() // 旧月（curMonth）视角：900 是异常月
    const newSource = makeSource({
      prices: [[prevMonth, 777]],
      loads: [[curMonth, 31000]]
    })
    let call = 0
    vi.mocked(fetchMarketAttributionSource).mockImplementation(() => {
      call += 1
      return call === 1 ? slow.promise : Promise.resolve(newSource)
    })
    const wrapper = await settle(mount(MarketAttributionPanel))
    await wrapper.find('input[type="month"]').setValue(prevMonth)
    await settle(wrapper)
    expect(fetchMarketAttributionSource).toHaveBeenLastCalledWith({ region: 'yunnan', month: prevMonth })
    expect(wrapper.text()).toContain('777.0')
    // 旧月请求此刻才返回 → 不得覆盖
    slow.resolve(oldSource)
    await settle(wrapper)
    expect(wrapper.text()).toContain('777.0')
    expect(wrapper.text()).not.toContain('月现货均价 900.0')
  })

  it('地区切换重新取数（带新 region）', async () => {
    vi.mocked(fetchMarketAttributionSource).mockResolvedValue(fullSource())
    const wrapper = await settle(mount(MarketAttributionPanel))
    vi.mocked(fetchMarketAttributionSource).mockClear()
    ;(currentRegion as { value: { id: string } }).value = { id: 'shanxi' }
    await settle(wrapper)
    expect(fetchMarketAttributionSource).toHaveBeenCalledWith({ region: 'shanxi', month: curMonth })
  })
})
