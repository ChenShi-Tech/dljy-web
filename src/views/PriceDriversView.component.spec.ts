// @vitest-environment happy-dom
// 价格驱动分析（dljy#3390）组件行为：驱动切换重查、点选小时联动单小时散点、
// 另一驱动取数失败静默降级（整页不报错、对比柱隐藏）、默认运行日取覆盖区间
// （山西 clamp 静态表 / 云南 fetchCaptureCoverage 实时区间）、无权限驱动预选回落。
// useEChart 被拦截：按 setup 顺序捕获 [热力图, 敏感度, 散点] 三只句柄与 click handler。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  MarketInsightRelationKind,
  MarketInsightRelationScatterContract,
  RelationScatterDataset
} from '@/services/data/contracts'
import type { RelationScatterRow } from '@/services/data/contracts/relationScatterAdapter'

const fetchContract = vi.fn()
vi.mock('@/services/data/contracts', () => ({
  fetchMarketInsightRelationScatterContract: (...args: unknown[]) => fetchContract(...args),
  normalizeContractBasis: (b?: string) => (b === 'real' || b === 'captured' ? 'captured' : 'synthetic')
}))
// 地区：可变状态 + computed，供云南用例在 mount 前切换。
const regionState = vi.hoisted(() => ({ id: 'shanxi', name: '山西' }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed } = await import('vue')
  return { ...actual, currentRegion: computed(() => regionState) }
})
// 权限入口可变：驱动分段按旧路径权限判定可选。
const canAccess = vi.fn((_path?: string) => true)
vi.mock('@/services/governance', () => ({
  canAccessPath: (path: string) => canAccess(path),
  // 与真实实现同口径：驱动因素按各自旧路径判定（governance.priceDriverAccessPaths）。
  canAccessPriceDriver: (kind: string) => canAccess(kind === 'renewable' ? '/sjfx/zrxgx' : '/sjfx/zrxgx2')
}))
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'ADMIN' }) }))
// 保留 clampToCoverage 静态表（山西默认日断言用真值），只替换实时覆盖接口。
const fetchCoverage = vi.fn()
vi.mock('@/services/market/captureCoverage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/market/captureCoverage')>()
  return { ...actual, fetchCaptureCoverage: (...args: unknown[]) => fetchCoverage(...args), fetchCaptureCoverageWithFallback: (...args: unknown[]) => fetchCoverage(...args) }
})
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('@/composables/useQuerySync', () => ({ useQuerySync: () => {} }))
// 捕获 defineAiPage 配置：用例可调 interpret.context() 断言 AI 切片的 basis 口径
const aiPage = vi.hoisted(() => ({ config: null as { interpret?: { context: () => Record<string, unknown> } } | null }))
vi.mock('@/features/aiSidebar', () => ({
  defineAiPage: (config: unknown) => { aiPage.config = config as never },
  useAiSidebar: () => ({ interpret: vi.fn() })
}))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
// echarts 拦截：句柄按 setup 调用顺序入列（0=热力图 1=敏感度 2=散点），click handler 可手动触发。
const charts = vi.hoisted(() => [] as Array<{
  setOption: ReturnType<typeof vi.fn>
  clickHandlers: Array<(p: { dataIndex?: number; value?: unknown }) => void>
}>)
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => {
    const clickHandlers: Array<(p: { dataIndex?: number; value?: unknown }) => void> = []
    const inst = {
      // bindClick 每次渲染先 off 清空再 on：off 清数组、on 压栈，触发时只取最后一个。
      on: (_ev: string, fn: (p: { dataIndex?: number; value?: unknown }) => void) => { clickHandlers.push(fn) },
      off: () => { clickHandlers.length = 0 }
    }
    const setOption = vi.fn()
    charts.push({ setOption, clickHandlers })
    return { setOption, instance: () => inst, resize: vi.fn(), dispose: vi.fn() }
  }
}))
import PriceDriversView from './PriceDriversView.vue'

const STUBS = {
  'el-alert': { props: ['title'], template: '<div class="stub-alert">{{ title }}</div>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  'el-date-picker': { template: '<input class="stub-date" />' },
  'el-input-number': { template: '<input class="stub-days" />' },
  'el-radio-group': {
    name: 'StubRadioGroup',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="stub-radio-group"><slot /></div>'
  },
  'el-radio-button': { props: ['value'], template: '<span><slot /></span>' },
  'el-tooltip': { template: '<span class="stub-tooltip"><slot /></span>' }
}

/** 4 天 × 24 小时完全线性散点（price = 800 - k·driver，默认 k=0.02）：每小时 r=-1，strongestHour=1。 */
function makeDataset(k = 0.02): RelationScatterDataset {
  const xd = Array.from({ length: 4 }, (_, d) => {
    const row: RelationScatterRow = { date: `2026-05-0${d + 1}` }
    for (let h = 1; h <= 24; h += 1) {
      const driver = 3000 + d * 40 + h * 10
      row[`p${h}`] = [driver, 800 - driver * k]
    }
    return row
  })
  return { xd, xnyzd: [{ p6: 3400 }], xnyg: [{ p6: 3300 }], xnygd: [{ p6: 100 }] }
}

function relationContract(
  kind: MarketInsightRelationKind,
  k = 0.02,
  basis: 'captured' | 'synthetic' = 'captured'
): MarketInsightRelationScatterContract {
  return {
    basis,
    blocks: {
      relation_scatter: {
        key: kind === 'renewable' ? 'price_renewable_relation' : 'price_load_relation',
        dataset: makeDataset(k)
      }
    }
  } as unknown as MarketInsightRelationScatterContract
}

async function mountView() {
  charts.length = 0
  const wrapper = mount(PriceDriversView, {
    global: { stubs: STUBS, directives: { loading: {} } }
  })
  await flushPromises()
  return wrapper
}

function clickChart(index: number, p: { dataIndex?: number; value?: unknown }) {
  const handlers = charts[index]?.clickHandlers ?? []
  handlers.at(-1)?.(p)
}

beforeEach(() => {
  fetchContract.mockReset().mockResolvedValue(relationContract('renewable'))
  fetchCoverage.mockReset().mockResolvedValue(null)
  canAccess.mockReset().mockReturnValue(true)
  regionState.id = 'shanxi'
  regionState.name = '山西'
})

describe('价格驱动分析（dljy#3390）', () => {
  it('挂载即查当前驱动 + 另一驱动对比，山西默认运行日钳到静态覆盖区间末日', async () => {
    const wrapper = await mountView()

    // 主请求（renewable）+ 对比请求（load）各一次
    const kinds = fetchContract.mock.calls.map((c) => (c[0] as { kind: string }).kind)
    expect(kinds).toContain('renewable')
    expect(kinds).toContain('load')
    // 山西 price 静态表 end=2026-06-02（今天在区间外 → 钳到末日）
    expect((fetchContract.mock.calls[0][0] as { runDate: string }).runDate).toBe('2026-06-02')
    // 三只图表句柄均完成渲染
    expect(charts).toHaveLength(3)
    charts.forEach((c) => expect(c.setOption).toHaveBeenCalled())
    // 默认选中小时 = 最敏感时段（构造数据下所有小时 |r| 相等，取第一个 → 1:00）
    const titles = wrapper.findAll('.card-title').map((t) => t.text())
    expect(titles.some((t) => t.includes('1:00 散点与拟合'))).toBe(true)
    expect(wrapper.find('.stub-alert').exists()).toBe(false)
  })

  it('切驱动分段 → 按新 kind 重查（含另一驱动对比）', async () => {
    fetchContract.mockImplementation(({ kind }: { kind: MarketInsightRelationKind }) =>
      Promise.resolve(relationContract(kind)))
    const wrapper = await mountView()
    fetchContract.mockClear()

    const radio = wrapper.findComponent({ name: 'StubRadioGroup' })
    await radio.vm.$emit('update:modelValue', 'load')
    await flushPromises()

    const kinds = fetchContract.mock.calls.map((c) => (c[0] as { kind: string }).kind).sort()
    expect(kinds).toEqual(['load', 'renewable']) // 主请求 load + 对比请求 renewable 各一次
    // loadData 先发对比请求再发主请求：load 是本轮主驱动，只出现一次
    expect(kinds.filter((k) => k === 'load')).toHaveLength(1)
  })

  it('AI 解读上下文消费契约口径：synthetic 契约不称真实采集（R4）', async () => {
    fetchContract.mockImplementation(({ kind }: { kind: MarketInsightRelationKind }) =>
      Promise.resolve(relationContract(kind, 0.02, 'synthetic')))
    await mountView()
    expect(aiPage.config?.interpret?.context().basis).toBe('synthetic')
  })

  it('AI 解读上下文消费契约口径：captured 契约行为不变（R4）', async () => {
    fetchContract.mockImplementation(({ kind }: { kind: MarketInsightRelationKind }) =>
      Promise.resolve(relationContract(kind, 0.02, 'captured')))
    await mountView()
    expect(aiPage.config?.interpret?.context().basis).toBe('captured')
  })

  it('单小时散点电价轴自适应：不写死 min:0/max:1500，负价不被裁出轴外', async () => {
    // slim-and-fix-market-insight-pages R3：负价时段的驱动-价格关系恰是本页最关心的场景
    await mountView()
    const scatterOptions = charts[2].setOption.mock.calls
      .map((c) => c[0] as { yAxis?: { min?: number; max?: number; scale?: boolean } })
      .filter((o) => o.yAxis)
    expect(scatterOptions.length).toBeGreaterThanOrEqual(1)
    for (const option of scatterOptions) {
      expect(option.yAxis!.min).toBeUndefined()
      expect(option.yAxis!.max).toBeUndefined()
      expect(option.yAxis!.scale).toBe(true)
    }
    // 联动切换小时后仍然自适应
    clickChart(1, { dataIndex: 11 })
    await flushPromises()
    const after = charts[2].setOption.mock.calls.at(-1)?.[0] as { yAxis?: { min?: number } }
    expect(after?.yAxis?.min).toBeUndefined()
  })

  it('点热力图小时列 / 敏感度柱 → 单小时散点联动切换', async () => {
    const wrapper = await mountView()

    // 热力图 click：value[0] 为小时索引（xHours[5] = 6）
    clickChart(0, { value: [5, 2, 300] })
    await flushPromises()
    let titles = wrapper.findAll('.card-title').map((t) => t.text())
    expect(titles.some((t) => t.includes('6:00 散点与拟合'))).toBe(true)

    // 敏感度柱 click：dataIndex 直接映射 RELATION_HOURS（dataIndex 11 → 12:00）
    clickChart(1, { dataIndex: 11 })
    await flushPromises()
    titles = wrapper.findAll('.card-title').map((t) => t.text())
    expect(titles.some((t) => t.includes('12:00 散点与拟合'))).toBe(true)
    expect(titles.some((t) => t.includes('6:00 散点与拟合'))).toBe(false)
  })

  it('另一驱动取数失败 → 静默降级：整页不报错、对比系列不画', async () => {
    fetchContract.mockImplementation(({ kind }: { kind: MarketInsightRelationKind }) =>
      kind === 'load'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(relationContract('renewable')))
    const wrapper = await mountView()

    expect(wrapper.find('.stub-alert').exists()).toBe(false)
    // 敏感度图（charts[1]）最后一次渲染只含当前驱动一个系列
    const lastOption = charts[1].setOption.mock.calls.at(-1)?.[0] as { series: unknown[] }
    expect(lastOption.series).toHaveLength(1)
    expect((lastOption.series[0] as { name: string }).name).toContain('新能源出力')
  })

  it('云南默认运行日取 fetchCaptureCoverage 实时区间末日并重查', async () => {
    regionState.id = 'yunnan'
    regionState.name = '云南'
    fetchCoverage.mockResolvedValue({ start: '2026-09-01', end: '2026-09-25' })
    await mountView()

    const runDates = fetchContract.mock.calls.map((c) => (c[0] as { runDate: string }).runDate)
    // 初始按今天发一次，覆盖区间回来后 runDate 校正为 end 并重查
    expect(runDates).toContain('2026-09-25')
    expect(fetchCoverage).toHaveBeenCalledWith('yunnan', 'price')
  })

  it('对比请求迟到：上一轮的另一驱动结果不得写回新一轮（代次在等待之后判定）', async () => {
    // 第一轮的对比请求（load）挂起；第二轮（点「查询」）对比请求立即返回斜率 -0.01 的数据；
    // 之后再放行第一轮（斜率 -0.05）。敏感度图重绘时对比系列必须仍是第二轮的 -10，而不是 -50。
    let releaseStale: (value: unknown) => void = () => {}
    let loadRound = 0
    fetchContract.mockImplementation(({ kind }: { kind: MarketInsightRelationKind }) => {
      if (kind === 'renewable') return Promise.resolve(relationContract('renewable'))
      loadRound += 1
      if (loadRound === 1) return new Promise((resolve) => { releaseStale = resolve })
      return Promise.resolve(relationContract('load', 0.01))
    })
    const wrapper = await mountView()

    const query = wrapper.findAll('button').find((b) => b.text() === '查询')
    expect(query).toBeTruthy()
    await query!.trigger('click')
    await flushPromises()
    releaseStale(relationContract('load', 0.05))
    await flushPromises()

    clickChart(1, { dataIndex: 3 }) // 触发敏感度图重绘，读当前 otherData
    await flushPromises()
    const lastOption = charts[1].setOption.mock.calls.at(-1)?.[0] as { series: Array<{ data: Array<{ value: number }> }> }
    expect(lastOption.series).toHaveLength(2)
    expect(lastOption.series[1].data[0].value).toBeCloseTo(-10)
  })

  it('预选驱动无权限 → 回落到第一个可用驱动，不发无权限请求', async () => {
    // 旧 zrxgx（renewable）无权限、zrxgx2（load）可用
    canAccess.mockImplementation((path?: string) => path !== '/sjfx/zrxgx')
    await mountView()

    const kinds = fetchContract.mock.calls.map((c) => (c[0] as { kind: string }).kind)
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.every((k) => k === 'load')).toBe(true)
  })
})
