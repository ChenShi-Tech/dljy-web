// 套保工作台「结算复核」页签组件测试（build-midlong-spot-hedging 任务 10.5，HR-01..05、HW-06/08；ChenShi-Tech/dljy#3054）。
// 守的不变量：默认月份取最近一个有正式覆盖的月份（不写死当月）；未覆盖的场站日显示「未覆盖」、不按 0 进合计和套保率；
// 正式/暂结两套数值不混用；只展示数值、不判级；切公司清空并重取、旧响应晚到被丢弃；接口失败显示原因、不冒充空数据。
// 坏掉的症状：页面固定取当月一直「暂无」（#3054 重开原因）、缺失日被算成 0 拉低套保率、暂结数值挂在正式标记下、
// 切公司后残留上一家公司的数据、失败时显示成「暂无数据」。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { config, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useHedgeWorkbench } from '../useHedgeWorkbench'

const fetchSettlementCoverage = vi.fn()
const fetchSettlementReview = vi.fn()

vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: vi.fn() }) }))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

// 公司上下文桩：真实 ref，切换公司的清空、重取与旧响应丢弃（HW-06）才真正受测。
vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

vi.mock('@/services/hedge/hedgeApi', () => ({
  HedgeApiError: class HedgeApiError extends Error {
    status: number
    errorCode: string
    details: Record<string, unknown> | null
    constructor(status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) {
      super(message)
      this.status = status
      this.errorCode = errorCode
      this.details = details
    }
  },
}))

vi.mock('@/services/hedge/hedgeSettlementApi', () => ({
  fetchSettlementCoverage: (...args: unknown[]) => fetchSettlementCoverage(...(args as [])),
  fetchSettlementReview: (...args: unknown[]) => fetchSettlementReview(...(args as [])),
}))

import HedgeChart from './HedgeChart.vue'
import HedgeSettlementTab from './HedgeSettlementTab.vue'
import { selectedCompanyId } from '@/services/company/companyContext'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import type { SettlementCoverage, SettlementView } from '@/services/hedge/hedgeSettlementApi'
import { mountHedgeTab } from '@/test/hedgeWorkbench'
import { metricTile } from '@/test/metricTile'
import { coveragePayload, incompleteRow, ledgerPayload, provisionalNotReported, reviewPayload, reviewRow } from '@/test/hedgeSettlement'

// MetricTile 的 ⓘ 用 el-tooltip；本 spec 不装 Element Plus，桩成只渲染默认插槽。
config.global.stubs = {
  ...config.global.stubs,
  'el-tooltip': defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } }),
}

enableAutoUnmount(afterEach)

const EMPTY_PROVISIONAL = coveragePayload({ plants: [], covered: {}, view: 'PROVISIONAL' })

function mockCoverage(formal: SettlementCoverage, provisional: SettlementCoverage = EMPTY_PROVISIONAL) {
  fetchSettlementCoverage.mockImplementation(async (query: { view?: SettlementView }) => (query.view === 'PROVISIONAL' ? provisional : formal))
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}


const settle = async () => { await flushPromises(); await new Promise(resolve => setTimeout(resolve, 20)) }
function option(wrapper: VueWrapper, label: string) {
  return wrapper.findAllComponents(HedgeChart).find(chart => chart.props('label') === label)?.props('option') as { yAxis: { data: string[] }; series: Array<{ name: string; data: Array<number | null | number[]> }>; tooltip: { formatter: (p: unknown) => string } } | undefined
}
async function panel(wrapper: VueWrapper, key: string) { await wrapper.get(`[data-test="settlement-panel-${key}"]`).trigger('click') }
const formal = () => coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-15': ['甲风电场'] } })

describe('结算复核图表、口径与并发隔离', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T04:00:00Z'))
    selectedCompanyId.value = 'comp-a'
    mockCoverage(formal())
    fetchSettlementReview.mockResolvedValue(reviewPayload())
  })
  afterEach(() => { vi.useRealTimers(); fetchSettlementCoverage.mockReset(); fetchSettlementReview.mockReset() })

  it('默认选择最近正式月份，当前月份截止当天', async () => {
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(fetchSettlementReview).toHaveBeenCalled())
    expect(fetchSettlementReview).toHaveBeenLastCalledWith({ fromDate: '2026-05-01', toDate: '2026-05-31', granularity: 'DAY', view: 'FORMAL' })
    await wrapper.get('[data-test="settlement-month"]').setValue('2026-09')
    expect(fetchSettlementReview).toHaveBeenLastCalledWith({ fromDate: '2026-09-01', toDate: '2026-09-29', granularity: 'DAY', view: 'FORMAL' })
  })
  it('热力图三态及未覆盖日期保留，缺失不是零电量', async () => {
    mockCoverage(formal(), coveragePayload({ plants: ['甲风电场'], covered: { '2026-05-16': ['甲风电场'] }, view: 'PROVISIONAL' }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true))
    await panel(wrapper, 'coverage')
    const chart = option(wrapper, '场站日期覆盖热力图')!
    expect(chart.series[0].data[14]).toEqual([14, 0, 2])
    expect(chart.series[0].data[15]).toEqual([15, 0, 1])
    expect(chart.series[0].data[0]).toEqual([0, 0, 0])
    expect(chart.tooltip.formatter({ value: [15, 0, 1] })).toContain('暂结')
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('只计入核对通过的行，未覆盖场站图表为空而非零', async () => {
    mockCoverage(coveragePayload({ plants: ['甲风电场','乙光伏'], covered: { '2026-05-15': ['甲风电场','乙光伏'], '2026-05-16':['甲风电场'] } }))
    fetchSettlementReview.mockResolvedValue(reviewPayload({ rows: [reviewRow(), reviewRow({ balanced: false, residual: 35, actualOnGridEnergy: 150 }), incompleteRow({ plant: '乙光伏' })] }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(metricTile(wrapper, '已实现套保率')?.value).toBe('86.96%'))
    const chart = option(wrapper, '各场站已实现指标')!
    const missing = chart.yAxis.data.indexOf('乙光伏')
    expect(chart.series.every(series => series.data[missing] === null)).toBe(true)
    expect(metricTile(wrapper, '中长期')?.value).toBe('100')
    await panel(wrapper, 'quality')
    expect(wrapper.get('[data-test="dq-unbalanced"] b').text()).toBe('1')
    expect(wrapper.get('[data-test="dq-incomplete"] b').text()).toBe('1')
    expect(wrapper.get('[data-test="dq-missing"] b').text()).toBe('59')
    expect(wrapper.get('[data-test="data-quality"] .hedge-hint').attributes('aria-label')).toContain('异常记录')
  })
  it('指标内置页签切换套保率及敞口序列', async () => {
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(option(wrapper, '各场站已实现指标')).toBeTruthy())
    const buttons = wrapper.findAll('nav[aria-label="指标图表"] button')
    await buttons[1].trigger('click')
    expect(option(wrapper, '各场站已实现指标')!.series[0].name).toBe('已实现套保率')
    await buttons[2].trigger('click')
    expect(option(wrapper, '各场站已实现指标')!.series.map(series => series.name)).toEqual(['现货总敞口','净敞口'])
  })
  it('正式暂结切换先清空并丢弃晚到响应', async () => {
    const slow = deferred()
    fetchSettlementReview.mockImplementation((query: {view: SettlementView}) => query.view === 'PROVISIONAL' ? slow.promise : Promise.resolve(reviewPayload()))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(metricTile(wrapper,'已实现套保率')?.value).toBe('86.96%'))
    await wrapper.get('[data-test="view-provisional"]').trigger('click')
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    await wrapper.get('[data-test="view-formal"]').trigger('click')
    await settle()
    slow.resolve(reviewPayload({ view:'PROVISIONAL', rows:[reviewRow({ltmEnergy:999})] }))
    await settle()
    expect(metricTile(wrapper,'中长期')?.value).toBe('100')
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(false)
  })
  it('暂结使用独立值并标注，未入库不顶替正式数据', async () => {
    fetchSettlementReview.mockImplementation((query: {view: SettlementView}) => Promise.resolve(query.view === 'PROVISIONAL' ? provisionalNotReported() : reviewPayload()))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(metricTile(wrapper,'中长期')?.value).toBe('100'))
    await wrapper.get('[data-test="view-provisional"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-test="provisional-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="review-status"] .hedge-hint').attributes('aria-label')).toContain('暂结')
  })
  it('对账保留未映射的结算值，台账及差额不补零', async () => {
    fetchSettlementReview.mockResolvedValue(reviewPayload({ ledger: ledgerPayload({ stations:[{ stationId:1, plantName:'甲风电场', ledgerMwh:80, settlementMwh:100, unexplainedDiff:-20 }], unmapped:[{ plantName:'乙光伏', settlementMwh:45 }] }) }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true))
    await panel(wrapper,'ledger')
    const chart = option(wrapper,'台账与结算电量对照')!
    expect(chart.yAxis.data).toEqual(['甲风电场','乙光伏'])
    expect(chart.series[0].data).toEqual([80,null])
    expect(chart.series[2].data).toEqual([-20,null])
    expect(chart.series.map(series=>series.name)).toEqual(['台账锁价','结算中长期','未解释差异'])
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('费用拆分异常仅计入费用质量状态，解释在提示中', async () => {
    fetchSettlementReview.mockResolvedValue(reviewPayload({ rows:[reviewRow({feeSplit:{status:'UNSPLIT',spotIncrementFee:null,midlongFee:null,totalFee:34100,note:'不符'}})] }))
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true))
    await panel(wrapper,'quality')
    expect(wrapper.get('[data-test="dq-fee"] b').text()).toBe('1')
    expect(wrapper.get('[data-test="dq-fee"] .hedge-hint').attributes('aria-label')).toContain('暂不确认中长期费用拆分')
  })
  it('公司切换清空并重新取数', async () => {
    const { wrapper } = mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(() => expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toContain('甲风电场'))
    mockCoverage(coveragePayload({plants:['乙光伏'],covered:{'2026-05-15':['乙光伏']}}))
    fetchSettlementReview.mockResolvedValue(reviewPayload({rows:[reviewRow({plant:'乙光伏'})]}))
    selectedCompanyId.value='comp-b'
    await vi.waitFor(() => expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toEqual(['乙光伏']))
  })
  it('旧公司复核晚到不覆盖新图表', async () => {
    const old=deferred()
    fetchSettlementReview.mockReturnValueOnce(old.promise)
    const { wrapper }=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(fetchSettlementReview).toHaveBeenCalledTimes(1))
    mockCoverage(coveragePayload({plants:['乙光伏'],covered:{'2026-05-15':['乙光伏']}}))
    fetchSettlementReview.mockResolvedValue(reviewPayload({rows:[reviewRow({plant:'乙光伏'})]}))
    selectedCompanyId.value='comp-b'
    await vi.waitFor(()=>expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toEqual(['乙光伏']))
    old.resolve(reviewPayload());await settle()
    expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toEqual(['乙光伏'])
  })
  it('旧公司覆盖晚到不触发旧公司的复核', async () => {
    const old=deferred()
    fetchSettlementCoverage.mockReturnValue(old.promise)
    const {wrapper}=mountHedgeTab(HedgeSettlementTab)
    await settle()
    mockCoverage(coveragePayload({plants:['乙光伏'],covered:{'2026-05-15':['乙光伏']}}))
    fetchSettlementReview.mockResolvedValue(reviewPayload({rows:[reviewRow({plant:'乙光伏'})]}))
    selectedCompanyId.value='comp-b'
    await vi.waitFor(()=>expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toEqual(['乙光伏']))
    old.resolve(formal());await settle()
    expect(fetchSettlementReview).toHaveBeenCalledTimes(1)
    expect(option(wrapper,'各场站已实现指标')?.yAxis.data).toEqual(['乙光伏'])
  })
  it('覆盖读取失败显示原因，不画空覆盖图', async () => {
    fetchSettlementCoverage.mockRejectedValue(new HedgeApiError(403,'FORBIDDEN','无权限访问结算数据'))
    const {wrapper}=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(wrapper.find('[data-test="settlement-error"]').exists()).toBe(true))
    expect(wrapper.get('[data-test="settlement-error"]').text()).toContain('无权限')
    expect(wrapper.findAllComponents(HedgeChart)).toHaveLength(0)
  })
  it('复核失败可重试，不冒充无数据', async () => {
    fetchSettlementReview.mockRejectedValueOnce(new Error('失败')).mockResolvedValue(reviewPayload())
    const {wrapper}=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(wrapper.find('[data-test="review-error"]').exists()).toBe(true))
    expect(wrapper.find('[data-test="review-status"]').exists()).toBe(false)
    await wrapper.get('[data-test="review-error"] button').trigger('click')
    await vi.waitFor(()=>expect(metricTile(wrapper,'中长期')?.value).toBe('100'))
  })
  it('切认知时点作废在途请求并重取，不停在加载态', async () => {
    const old=deferred()
    fetchSettlementReview.mockReturnValueOnce(old.promise).mockResolvedValue(reviewPayload())
    const {wrapper,workbench}=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(fetchSettlementReview).toHaveBeenCalledTimes(1))
    workbench.asOfInput.value='2026-05-31T23:00:00+08:00'
    await vi.waitFor(()=>expect(metricTile(wrapper,'中长期')?.value).toBe('100'))
    old.resolve(reviewPayload({rows:[reviewRow({plant:'过期'})]}));await settle()
    expect(option(wrapper,'各场站已实现指标')?.yAxis.data).not.toContain('过期')
  })
  it('重新激活时不把新日历和旧复核指标拼接', async () => {
    const shown=ref(true)
    const Host=defineComponent({setup(){useHedgeWorkbench();return ()=>h(KeepAlive,null,{default:()=>shown.value?h(HedgeSettlementTab):null})}})
    const wrapper=mount(Host)
    await vi.waitFor(()=>expect(metricTile(wrapper,'中长期')?.value).toBe('100'))
    const cov=deferred(),rev=deferred()
    fetchSettlementCoverage.mockReturnValue(cov.promise)
    fetchSettlementReview.mockReturnValue(rev.promise)
    shown.value=false;await nextTick();shown.value=true;await settle()
    expect(wrapper.findAllComponents(HedgeChart)).toHaveLength(0)
    cov.resolve(formal());await settle()
    expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="review-loading"]').exists()).toBe(true)
    rev.resolve(reviewPayload({rows:[reviewRow({ltmEnergy:200})]}))
    await vi.waitFor(()=>expect(metricTile(wrapper,'中长期')?.value).toBe('200'))
  })
  it('电费图保留总费用和增量，未拆分中长期费用保持空值', async () => {
    fetchSettlementReview.mockResolvedValue(reviewPayload({rows:[reviewRow({feeSplit:{status:'UNSPLIT',spotIncrementFee:4100,midlongFee:null,totalFee:34100,note:'不符'}})]}))
    const {wrapper}=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(option(wrapper,'各场站已实现指标')).toBeTruthy())
    await wrapper.findAll('nav[aria-label="指标图表"] button')[3].trigger('click')
    const chart=option(wrapper,'各场站已实现指标')!
    expect(chart.series[0].data).toEqual([34100])
    expect(chart.series[3].data).toEqual([null])
  })

  it('费用核对不符与字段缺失分开统计，可拆分显示分母', async () => {
    fetchSettlementReview.mockResolvedValue(reviewPayload({rows:[
      reviewRow(),
      reviewRow({date:'2026-05-16',feeSplit:{status:'UNSPLIT',spotIncrementFee:4100,midlongFee:null,totalFee:34100,note:'总额不符'}}),
      reviewRow({date:'2026-05-17',feeSplit:{status:'UNKNOWN',spotIncrementFee:null,midlongFee:null,totalFee:null,note:'总电费缺失'}}),
    ]}))
    const {wrapper}=mountHedgeTab(HedgeSettlementTab)
    await vi.waitFor(()=>expect(wrapper.find('[data-test="realized-metrics"]').exists()).toBe(true))
    await panel(wrapper,'quality')
    expect(wrapper.get('[data-test="fee-summary"] b').text()).toBe('1 / 3')
    expect(wrapper.get('[data-test="dq-fee"] b').text()).toBe('1')
    expect(wrapper.get('[data-test="dq-fee-missing"] b').text()).toBe('1')
    expect(wrapper.get('[data-test="dq-fee"] .hedge-hint').attributes('aria-label')).toContain('不等同于结算账单错误')
    const chart=option(wrapper,'结算数据质量异常分布')!
    expect(chart.yAxis.data).toContain('费用核对不符')
    expect(chart.yAxis.data).toContain('费用字段缺失')
  })

})
