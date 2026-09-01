// 来源标注必须跟着实际取数路径走（#1791）。
//
// 背景：`spotClient` 只在「云南 + 账号属中广核云南」时把节点价请求改写到厂侧专属端点，
// 其余账号静默落到公共节点价端点（刻意设计，避免向专属端点制造 403）。此前页面把
// 「来源为中广核云南厂侧私有 PostgreSQL」写死在模板里，于是非中广核账号读着公共数据、
// 页面却宣称是某家公司的私有经营数据。
//
// 为什么写成挂载测试而不是源码 grep：grep 只能证明「模板里有这句话」，证明不了「在什么
// 条件下渲染出来」，而这里的缺陷恰恰是条件缺失，不是文案缺失。本 spec 两种身份各挂一次，
// 断言正反两侧（该出现时出现、不该出现时不出现）。只断言正例会让「两句都渲染」蒙混过关。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const entitled = vi.hoisted(() => ({ value: false }))

vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  hasCgnYunnanPriceEntitlement: () => entitled.value,
}))

// 面板挂载即取数；本 spec 只关心标注渲染，把网络层整体替身掉，避免真实请求与时序噪声。
vi.mock('@/services/market/spotClient', () => ({
  searchSpotNodes: vi.fn(async () => []),
  fetchNodePriceSeries: vi.fn(async () => []),
  fetchDailySummary: vi.fn(async () => []),
  fetchHeatmap: vi.fn(async () => ({ nodes: [], times: [], values: [] })),
}))

vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div />' },
}))

const PRIVATE_CLAIM = '中广核云南厂侧私有 PostgreSQL'
const PUBLIC_CLAIM = '平台已入库的公共节点电价行情'

async function mountPanel() {
  const { mount } = await import('@/test/mount')
  const { default: Panel } = await import('./YunnanNodePricePanel.vue')
  return mount(Panel, {
    global: { stubs: { ChartCard: true, DynamicTable: true } },
  })
}

describe('节点电价分析页 · 来源标注', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // 整组件挂载较重：全量套件并发跑时冷启动可超默认 5s（单跑 ~2s 即过），显式放宽避免抖动
  it('中广核云南账号：标注厂侧私有来源，且不出现公共来源说法', { timeout: 20000 }, async () => {
    entitled.value = true
    const wrapper = await mountPanel()
    const text = wrapper.text()
    expect(text).toContain(PRIVATE_CLAIM)
    expect(text).toContain('非电网官方接口')
    expect(text).not.toContain(PUBLIC_CLAIM)
  })

  it('非中广核账号：如实标注公共来源，**绝不能**再宣称厂侧私有', { timeout: 20000 }, async () => {
    entitled.value = false
    const wrapper = await mountPanel()
    const text = wrapper.text()
    expect(text).toContain(PUBLIC_CLAIM)
    // 这一条是本 spec 的核心：缺陷的表现就是它在无授权时仍然出现。
    expect(text).not.toContain(PRIVATE_CLAIM)
  })
})
