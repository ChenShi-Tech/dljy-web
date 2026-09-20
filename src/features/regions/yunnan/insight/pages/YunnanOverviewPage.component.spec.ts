// YunnanOverviewPage.component.spec.ts — 云南市场总览页回归（dljy#3009 任务 8.3/8.4）
// 守什么不变量（对照 specs yunnan-market-overview）：
//   ① 进页面自动加载当日事实：能力目录就绪后逐块查询，不需要任何预检点击；默认窗口是
//     北京时间当日，不自动改日（A02）；
//   ② 区块按 OVERVIEW_BLOCKS 独立查询、独立失败：单视图分析（电网/场站）不送 view 筛选，
//     多视图分析送 block.view；一个区块失败不影响其他区块渲染（OV02）；
//   ③ 重点事项：事项与规则评估原样展示（为什么没有这一条）；无满足条件不凑数（OV03）；
//     同进度比较 ok 给完整对比，参考期不完整只说明原因、不显示假环比（OV04）；
//   ④ 下钻带同一业务日期（OV05）：区块按钮与事项「查看详情」都 router.push 规范地址并带
//     start/end；未交付页留给宿主占位，本页不留死链逻辑；
//   ⑤ 获权区块按能力目录判定：公共账号不渲染「获权场站表现」、不发 plants 请求；
//   ⑥ 窗口变化（上下文代次）后所有区块旧结果作废、全部重查；
//   ⑦ 历史候选按区块所属分析传入（required-source-ids 按分析必需输入），不混源；
//   ⑧ 界面只出现业务语言，不出现来源标识原文。
// mock 边界：insightClient 打桩（保留类型与错误类）；useInsightContext 用真 composable
//（真 router + 全局地区/公司 ref）；shared/insight 契约镜像（OVERVIEW_BLOCKS、分析目录）用真模块。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { beijingToday } from 'shared/midlong/dates.mjs'
import { fetchInsightCapabilities, queryInsight } from '@/services/insight/insightClient'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import YunnanOverviewPage from './YunnanOverviewPage.vue'

// ── 可控 mock 状态 ───────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  responder: null as ((request: any) => Promise<any>) | null,
}))

vi.mock('@/services/insight/insightClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    queryInsight: vi.fn((request: any) => state.responder!(request)),
    fetchInsightCapabilities: vi.fn(() => Promise.resolve(state.capabilities)),
  }
})

// ── 图表/表格/候选桩：绕开 ECharts 与弹层实现，捕获 props ────────────────────────────────

const InsightSeriesChartStub = defineComponent({
  name: 'InsightSeriesChart',
  props: { result: { type: Object, default: null }, current: { type: Object, default: null }, height: { type: Number, default: 320 } },
  emits: ['select'],
  render: () => h('div', { class: 'series-chart-stub' }),
})

const InsightResultTableStub = defineComponent({
  name: 'InsightResultTable',
  props: { result: { type: Object, default: null }, selection: { type: Object, default: null }, sourceTitles: { type: Object, default: null } },
  emits: ['row-click'],
  render: () => h('div', { class: 'result-table-stub' }),
})

const CandidatesStub = defineComponent({
  name: 'InsightHistoryCandidates',
  props: {
    modelValue: { type: Boolean, default: false },
    analysisId: { type: String, default: '' },
    filters: { type: Object, default: () => ({}) },
    requiredSourceIds: { type: Array as () => string[], default: () => [] },
  },
  emits: ['update:modelValue', 'select'],
  render: () => h('div', { class: 'candidates-stub' }),
})

// ── 能力目录与结果夹具（形状对照 dljy 仓 overview-views / price-views / supply-views）────

const KEY_ITEMS = 'overview.key-items'
const PRICES = 'prices.user-series'
const SUPPLY = 'supply.system-series'
const GRID = 'grid.boundary-series'
const PLANTS = 'plants.settlement-daily'

const SOURCE_TITLES: Record<string, string> = {
  'yn.price.user.day-ahead': '云南用户侧日前价格',
  'yn.price.user.real-time': '云南用户侧实时价格',
  'yn.system.load.actual': '云南电网负荷（实际）',
  'yn.system.hydro.actual': '云南水电出力（实际）',
  'yn.system.new-energy.actual': '云南新能源出力（实际）',
  'yn.system.load.forecast': '云南负荷预测',
  'csg.transfer.inter-provincial.forecast': '跨省送受预测（公开披露）',
  'cgn.plant.settlement-daily': '场站日结算（获权）',
}

const PROGRESS_INSUFFICIENT_REASON = '前一日同一时段缺 12 个时段，不比较'

/** 结果 sourceRefs：按来源生成（cgn 视为公司获权）。 */
function refsOf(sourceIds: string[]): Array<{ sourceId: string; accessScope: string }> {
  return sourceIds.map((sourceId) => ({ sourceId, accessScope: sourceId.startsWith('cgn.') ? 'company' : 'public' }))
}

function keyItemsResult(request: any, opts?: { empty?: boolean }) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['yn.price.user.day-ahead', 'yn.price.user.real-time', 'yn.system.load.actual', 'yn.system.load.forecast', 'yn.system.new-energy.actual']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'itemId', kind: 'category' }, { id: 'ruleId', kind: 'category' }, { id: 'rank', kind: 'ordinal' }],
      measures: [{ id: 'value', unit: 'by-item' }],
      rows: [],
      series: [],
      items: opts?.empty
        ? []
        : [
            {
              itemId: 'negative-price:1',
              rank: 1,
              ruleId: 'negative-price',
              ruleKind: 'analysis-default',
              title: '负电价时段',
              statement: '实时用户侧价累计负价 3.5 小时，最低 -55 元/MWh（02:15）',
              object: { priceObject: 'user-price', marketPhase: 'real-time' },
              interval: { start: '2026-09-17T00:00:00+08:00', end: '2026-09-18T00:00:00+08:00' },
              observation: { metricId: 'price.negative-duration', value: '3.5', unit: 'h' },
              baseline: { kind: 'threshold', value: '1', unit: 'h' },
              coverage: { validHours: '24' },
              severity: '3.5',
              drilldown: { analysisId: 'prices.user-series', view: 'summary', window: { start: '2026-09-17', end: '2026-09-17' } },
            },
          ],
      rules: [
        { ruleId: 'negative-price', title: '负电价时段', ruleKind: 'analysis-default', thresholds: { minNegativeHours: '1' }, description: '累计负价时长达到阈值', status: opts?.empty ? 'not-triggered' : 'triggered', reason: null, triggered: opts?.empty ? 0 : 1 },
        { ruleId: 'da-rt-spread', title: '日前实时价差较大', ruleKind: 'analysis-default', thresholds: { minAbsSpread: '200' }, description: '价差绝对值最大达到阈值', status: 'not-triggered', reason: null, triggered: 0 },
        { ruleId: 'load-forecast-deviation', title: '负荷预测偏差较大', ruleKind: 'analysis-default', thresholds: { minMaeRatioPercent: '3' }, description: '预测平均绝对误差占比达到阈值', status: 'insufficient-data', reason: '云南统调负荷预测或实际缺失', triggered: 0 },
      ],
      comparisons: [
        {
          ruleId: 'load-progress-change',
          status: 'ok',
          metricId: 'supply.mean-power',
          progressEnd: '2026-09-17T18:00:00+08:00',
          comparedSlots: 72,
          current: '12950.5',
          previous: '12410.25',
          changePercent: '4.35',
          window: { start: '2026-09-17T00:00:00+08:00', end: '2026-09-17T18:00:00+08:00' },
          referenceWindow: { start: '2026-09-16T00:00:00+08:00', end: '2026-09-16T18:00:00+08:00' },
        },
      ],
      notes: [{ note: '最多列 5 条，按「观测 / 阈值」从高到低；没有满足条件的就少于 5 条，不凑数。' }],
    },
  })
}

function keyItemsInsufficientProgress(request: any) {
  const result = keyItemsResult(request)
  const data = result.data as Record<string, unknown>
  data.comparisons = [
    { ruleId: 'load-progress-change', status: 'insufficient-data', reason: PROGRESS_INSUFFICIENT_REASON, progressEnd: '2026-09-17T18:00:00+08:00' },
  ]
  return result
}

function priceSummaryResult(request: any) {
  const priceSeries = (sourceId: string, phase: string) => ({
    seriesId: `${sourceId}|price`,
    sourceId,
    fieldId: 'price',
    unit: 'yuan/MWh',
    measureKind: 'price',
    dimensions: {},
    businessScope: 'user-price',
    resolutionMinutes: 60,
    nativeResolutionMinutes: 60,
    priceObject: 'user-price',
    marketPhase: phase,
    variant: null,
    kind: 'price-series',
  })
  const dayAhead = priceSeries('yn.price.user.day-ahead', 'day-ahead')
  const realTime = priceSeries('yn.price.user.real-time', 'real-time')
  const rows: Array<Record<string, string | null>> = []
  for (const meta of [dayAhead, realTime]) {
    rows.push(
      { seriesId: meta.seriesId, metricId: 'price.time-weighted-average', value: '262.5' },
      { seriesId: meta.seriesId, metricId: 'price.minimum', value: '-55', atIntervalStart: '2026-09-17T02:15:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'price.maximum', value: '410', atIntervalStart: '2026-09-17T19:00:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'price.negative-duration', value: '3.5' },
      { seriesId: meta.seriesId, metricId: 'sample.valid-hours', value: '24' }
    )
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['yn.price.user.day-ahead', 'yn.price.user.real-time']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows,
      series: [dayAhead, realTime],
      unavailableMetrics: [{ metricId: 'price.negative-energy-ratio', reason: '没有同对象同区间的电量，不计算负价电量占比' }],
    },
  })
}

function spreadResult(request: any) {
  const pair = {
    seriesId: 'spread:user-price:',
    kind: 'da-rt-spread',
    direction: 'day-ahead-minus-real-time',
    unit: 'yuan/MWh',
    priceObject: 'user-price',
    dimensions: {},
    dayAheadSeriesId: 'yn.price.user.day-ahead|price',
    realTimeSeriesId: 'yn.price.user.real-time|price',
    resolutionMinutes: 60,
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['yn.price.user.day-ahead', 'yn.price.user.real-time']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
      measures: [{ id: 'value', unit: 'by-series' }],
      rows: [{ seriesId: pair.seriesId, intervalStart: '2026-09-17T19:00:00+08:00', intervalEnd: '2026-09-17T20:00:00+08:00', value: '265.5' }],
      series: [pair],
      unpaired: [],
      tables: {
        summary: {
          rows: [
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread', value: '12.5' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-abs-mean', value: '40.25' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-maximum', value: '265.5', atIntervalStart: '2026-09-17T19:00:00+08:00' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-minimum', value: '-80.5', atIntervalStart: '2026-09-17T02:15:00+08:00' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-positive-share', value: '58.3' },
            { seriesId: pair.seriesId, metricId: 'sample.common-hours', value: '24' },
          ],
        },
        anomalies: {
          rows: [
            { seriesId: pair.seriesId, intervalStart: '2026-09-17T19:00:00+08:00', intervalEnd: '2026-09-17T20:00:00+08:00', value: '265.5', rank: '1' },
            { seriesId: pair.seriesId, intervalStart: '2026-09-17T02:15:00+08:00', intervalEnd: '2026-09-17T03:15:00+08:00', value: '-80.5', rank: '2' },
          ],
        },
      },
    },
  })
}

function sysSeriesMeta(sourceId: string, scope: string, variant: 'actual' | 'forecast') {
  return {
    seriesId: `${sourceId}|value`,
    sourceId,
    fieldId: 'value',
    unit: 'MW',
    measureKind: 'power',
    dimensions: {},
    businessScope: scope,
    resolutionMinutes: 15,
    nativeResolutionMinutes: 15,
    priceObject: null,
    marketPhase: null,
    variant,
  }
}

function supplySummaryResult(request: any) {
  const series = [
    sysSeriesMeta('yn.system.load.actual', 'yunnan', 'actual'),
    sysSeriesMeta('yn.system.hydro.actual', 'yunnan', 'actual'),
    sysSeriesMeta('yn.system.new-energy.actual', 'yunnan', 'actual'),
    sysSeriesMeta('yn.system.load.forecast', 'yunnan', 'forecast'),
    sysSeriesMeta('csg.system.load.actual', 'csg-aggregate', 'actual'),
  ]
  const share = {
    seriesId: 'share:hydro:yunnan',
    kind: 'share',
    unit: '%',
    businessScope: 'yunnan',
    numeratorSeriesId: 'yn.system.hydro.actual|value',
    denominatorSeriesId: 'yn.system.load.actual|value',
  }
  const rows: Array<Record<string, string | null>> = []
  for (const meta of series) {
    rows.push(
      { seriesId: meta.seriesId, metricId: 'supply.mean-power', value: '126.666666666667' },
      { seriesId: meta.seriesId, metricId: 'supply.minimum', value: '90.25', atIntervalStart: '2026-09-17T10:00:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'supply.maximum', value: '180', atIntervalStart: '2026-09-17T10:15:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'sample.valid-hours', value: '24' }
    )
  }
  rows.push(
    { seriesId: 'share:hydro:yunnan', metricId: 'supply.hydro-share', value: '62.5' },
    { seriesId: 'share:hydro:yunnan', metricId: 'sample.common-hours', value: '24' }
  )
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['yn.system.load.actual', 'yn.system.hydro.actual', 'yn.system.new-energy.actual']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows,
      series: [...series, share],
    },
  })
}

function forecastErrorResult(request: any) {
  const loadPair = {
    seriesId: 'error:load',
    kind: 'forecast-error',
    direction: 'forecast-minus-actual',
    forecastSeriesId: 'yn.system.load.forecast|value',
    actualSeriesId: 'yn.system.load.actual|value',
    unit: 'MW',
    businessScope: 'yunnan',
    category: 'load',
    resolutionMinutes: 15,
    mode: 'ex-post',
    eligibility: { samples: 60, expectedSamples: 96, coverageRatio: 0.625, eligible: false },
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['yn.system.load.forecast', 'yn.system.load.actual']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [],
      series: [loadPair],
      tables: {
        summary: {
          rows: [
            { seriesId: 'error:load', metricId: 'forecast.mae', value: '12.5' },
            { seriesId: 'error:load', metricId: 'forecast.bias', value: '-3.25' },
            { seriesId: 'error:load', metricId: 'sample.common-hours', value: '24' },
          ],
        },
      },
      unpaired: [{ seriesId: 'yn.system.non-market.forecast|value', reason: '没有可比的实际：非市场预测没有对应的实际曲线' }],
    },
  })
}

function gridSeriesResult(request: any) {
  const meta = sysSeriesMeta('csg.transfer.inter-provincial.forecast', 'csg-aggregate', 'forecast')
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['csg.transfer.inter-provincial.forecast']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [{ seriesId: meta.seriesId, intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T10:15:00+08:00', value: '2210.5' }],
      series: [meta],
    },
  })
}

function plantsResult(request: any) {
  const meta = {
    seriesId: 'cgn.plant.settlement-daily|某场站',
    sourceId: 'cgn.plant.settlement-daily',
    fieldId: 'settlementAmount',
    unit: 'yuan',
    measureKind: 'money',
    dimensions: { plant: '某场站' },
    businessScope: 'yunnan',
    resolutionMinutes: 1440,
    nativeResolutionMinutes: 1440,
    priceObject: null,
    marketPhase: null,
    variant: null,
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    sourceRefs: refsOf(['cgn.plant.settlement-daily']),
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'intervalStart', kind: 'time' }, { id: 'intervalEnd', kind: 'time' }],
      measures: [{ id: 'value', unit: 'yuan' }],
      rows: [{ seriesId: meta.seriesId, intervalStart: '2026-05-01T00:00:00+08:00', intervalEnd: '2026-05-02T00:00:00+08:00', value: '125000.5' }],
      series: [meta],
    },
  })
}

function defaultResponder(request: any): Promise<any> {
  if (request.analysisId === KEY_ITEMS) return Promise.resolve(keyItemsResult(request))
  if (request.analysisId === GRID) return Promise.resolve(gridSeriesResult(request))
  if (request.analysisId === PLANTS) return Promise.resolve(plantsResult(request))
  if (request.analysisId === PRICES) {
    return Promise.resolve(request.filters?.view === 'spread' ? spreadResult(request) : priceSummaryResult(request))
  }
  // supply.system-series
  return Promise.resolve(request.filters?.view === 'forecast-error' ? forecastErrorResult(request) : supplySummaryResult(request))
}

function overviewCaps(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['overview'],
      access: analysisId === PLANTS ? 'company' : 'public',
      sourceIds: Object.keys(SOURCE_TITLES),
      limits: { maxDays: analysisId === KEY_ITEMS ? 7 : 31, maxObjects: 0, requiresObjects: false },
    })),
    sources: Object.entries(SOURCE_TITLES).map(([sourceId, title]) => ({
      sourceId,
      title,
      businessScope: sourceId.startsWith('yn.') ? 'yunnan' : 'csg-aggregate',
      accessScope: sourceId.startsWith('cgn.') ? 'company' : 'public',
      measureKind: 'power',
      fields: [{ id: 'value', unit: 'MW', kind: 'power' }],
      nativeResolutionMinutes: 15,
      priceObject: null,
      marketPhase: null,
      variant: null,
      freshness: 'historical-package',
      objectDimension: null,
      note: null,
    })),
    endpoints: {},
    mock: false,
    productionWrite: false,
  }
}

/** 公共账号：四个公开分析（key-items / prices / supply / grid）。 */
const PUBLIC_CAPS = [KEY_ITEMS, PRICES, SUPPLY, GRID]
/** 获权账号：另加场站日结算。 */
const ENTITLED_CAPS = [...PUBLIC_CAPS, PLANTS]

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanOverviewPage, {
    global: {
      plugins: [router],
      stubs: {
        InsightSeriesChart: InsightSeriesChartStub,
        InsightResultTable: InsightResultTableStub,
        InsightHistoryCandidates: CandidatesStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

function queryCallsOf(predicate: (request: any) => boolean) {
  return vi.mocked(queryInsight).mock.calls.filter(([request]) => predicate(request))
}

async function setWindow(start: string, end: string) {
  wrapper!.getComponent(InsightDateRange).vm.$emit('update:modelValue', { start, end })
  await flushPromises()
}

async function click(testid: string) {
  await wrapper!.get(`[data-testid="${testid}"]`).trigger('click')
  await flushPromises()
}

function blockComponents() {
  return wrapper!.findAllComponents(InsightBlock)
}

beforeEach(async () => {
  localStorage.clear()
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/insight/:pageId', component: { render: () => null } },
    ],
  })
  await router.push('/')
  state.capabilities = overviewCaps(PUBLIC_CAPS)
  state.responder = defaultResponder
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('YunnanOverviewPage', () => {
  it('进页面自动加载当日事实：可见区块各查一次，默认窗口是北京时间当日，不需要预检点击', async () => {
    await mountPage()
    const calls = vi.mocked(queryInsight).mock.calls
    expect(calls.length).toBe(6) // key-items + prices(summary) + spread + supply(summary) + forecast + grid
    const today = beijingToday()
    for (const [request] of calls) {
      expect(request.context.businessWindow).toEqual({ start: today, end: today, timeZone: 'Asia/Shanghai' })
    }
    const analysisIds = calls.map(([request]) => `${request.analysisId}:${request.filters?.view ?? ''}`).sort()
    expect(analysisIds).toEqual(
      [
        `${GRID}:`,
        `${KEY_ITEMS}:key-items`,
        `${PRICES}:spread`,
        `${PRICES}:summary`,
        `${SUPPLY}:forecast-error`,
        `${SUPPLY}:summary`,
      ].sort()
    )
    // 单视图分析（电网）不送 view 筛选：契约只在多视图分析上登记 view 校验
    const gridCall = queryCallsOf((request) => request.analysisId === GRID)
    expect(gridCall[0]![0].filters).toEqual({})
  })

  it('区块独立渲染：价格卡用来源标题、供需卡只含云南实际与水电占比、预测卡带资格说明；界面不出现来源标识原文', async () => {
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain('云南用户侧日前价格')
    expect(text).toContain('云南用户侧实时价格')
    expect(text).toContain('云南电网负荷（实际）')
    expect(text).toContain('水电占比（云南，同一业务范围）')
    expect(text).toContain('负荷预测') // 预测卡标题（类别业务名）
    expect(text).toContain('事后对照') // mode 说明
    expect(text).toContain('可查看，不参与排名')
    expect(text).toContain('跨省送受预测（公开披露）')
    // 业务语言：来源标识不出现
    expect(text).not.toContain('yn.price.user.day-ahead')
    expect(text).not.toContain('cgn.plant.settlement-daily')
    // 南网背景不进云南供需卡（fixtures 里 csg 序列有统计行，但卡片标题不应出现南网来源）
    expect(text).not.toContain('南方电网整体口径负荷')
  })

  it('供需概况卡不含预测序列（fixtures 里含负荷预测行，被总览卡过滤）', async () => {
    await mountPage()
    const supplyCards = wrapper!.findAll('.yno-overview__card').filter((card) => card.text().includes('云南负荷预测'))
    expect(supplyCards).toHaveLength(0)
  })

  it('重点事项：事项原文、基线/覆盖与规则评估展示；同进度比较 ok 显示完整对比', async () => {
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain('实时用户侧价累计负价 3.5 小时，最低 -55 元/MWh（02:15）')
    expect(text).toContain('阈值 1 h')
    expect(text).toContain('有效小时 24')
    // 规则评估：insufficient-data 带原因
    expect(text).toContain('数据不足：云南统调负荷预测或实际缺失')
    expect(text).toContain('未达阈值')
    // 同进度比较（OV04 ok 分支；格式化按登记精度取一位小数）
    expect(text).toContain('前一日同时段')
    expect(text).toContain('高 4.4%')
    // 后端 notes 原样展示
    expect(text).toContain('没有满足条件的就少于 5 条，不凑数')
  })

  it('同进度比较参考期不完整：只说明原因，不显示假环比', async () => {
    state.responder = (request: any) =>
      request.analysisId === KEY_ITEMS ? Promise.resolve(keyItemsInsufficientProgress(request)) : defaultResponder(request)
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain(PROGRESS_INSUFFICIENT_REASON)
    expect(text).toContain('本期值见「供需与水电」区块')
    // 不出现环比数值（ok 分支才有的「前一日同时段 … MW」对比句式）
    expect(text).not.toContain('前一日同时段 12')
  })

  it('重点事项为空：显示不凑数文案，规则评估仍在', async () => {
    state.responder = (request: any) =>
      request.analysisId === KEY_ITEMS ? Promise.resolve(keyItemsResult(request, { empty: true })) : defaultResponder(request)
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain('没有满足阈值的事项')
    expect(text).toContain('未达阈值')
  })

  it('下钻带同一业务日期：事项「查看详情」跳价格页并携带事项窗口（OV05）', async () => {
    await mountPage()
    await click('yno-key-item-drill-1')
    expect(router.currentRoute.value.path).toBe('/insight/prices')
    expect(router.currentRoute.value.query).toMatchObject({ start: '2026-09-17', end: '2026-09-17' })
  })

  it('区块下钻：价格与供需按钮跳各自规范地址并携带当前窗口', async () => {
    await mountPage()
    await click('yno-prices-drilldown')
    expect(router.currentRoute.value.path).toBe('/insight/prices')
    const today = beijingToday()
    expect(router.currentRoute.value.query).toMatchObject({ start: today, end: today })
    await click('yno-supply-drilldown')
    expect(router.currentRoute.value.path).toBe('/insight/supply')
  })

  it('下钻 query 为统一可校验形状（任务 15.1）：携带 hx_from 返回锚点，值中不出现原始数组', async () => {
    await mountPage()
    await click('yno-prices-drilldown')
    const query = router.currentRoute.value.query
    expect(query).toMatchObject({ hx_from: 'overview' })
    // 共享四键仍在（目标页 useInsightContext 免费还原窗口），扩展字段只来自 hx_ 命名空间
    expect(query.start).toBe(beijingToday())
    expect(Object.keys(query).filter((key) => !['start', 'end', 'objects', 'sources'].includes(key))).toContain('hx_from')
    // 红线（D3/D11.1）：任何 query 值都不 JSON 化（原始数组/行数据不进 URL）
    for (const value of Object.values(query)) {
      expect(String(value)).not.toMatch(/[[\]{]/)
    }
  })

  it('电网/场站区块标注详情页建设中（未交付页不由本页伪造入口能力）', async () => {
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain('该详情页正在建设，尚未开通')
  })

  it('公共账号：不渲染获权场站区块、不发 plants 请求', async () => {
    await mountPage()
    expect(wrapper!.text()).not.toContain('获权场站表现')
    expect(queryCallsOf((request) => request.analysisId === PLANTS)).toHaveLength(0)
  })

  it('获权账号：场站区块可见并发请求（单视图分析不带 view 筛选）', async () => {
    state.capabilities = overviewCaps(ENTITLED_CAPS)
    await mountPage()
    expect(wrapper!.text()).toContain('获权场站表现')
    const plantsCalls = queryCallsOf((request) => request.analysisId === PLANTS)
    expect(plantsCalls).toHaveLength(1)
    expect(plantsCalls[0]![0].filters).toEqual({ view: 'series' })
  })

  it('窗口变化（上下文代次）后全部区块作废重查，请求窗口是新日期', async () => {
    await mountPage()
    vi.mocked(queryInsight).mockClear()
    await setWindow('2026-05-12', '2026-05-12')
    const calls = vi.mocked(queryInsight).mock.calls
    expect(calls.length).toBe(6)
    for (const [request] of calls) {
      expect(request.context.businessWindow).toMatchObject({ start: '2026-05-12', end: '2026-05-12' })
    }
    // 历史模式显式显示完整日期（OV01）
    expect(wrapper!.text()).toContain('历史模式：2026-05-12 ~ 2026-05-12')
  })

  it('单区块失败不影响其他区块：价差 503 时价格/供需/重点事项照常渲染', async () => {
    const { InsightRequestError } = await import('@/services/insight/insightClient')
    state.responder = (request: any) => {
      if (request.analysisId === PRICES && request.filters?.view === 'spread') {
        return Promise.reject(new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' }))
      }
      return defaultResponder(request)
    }
    await mountPage()
    const text = wrapper!.text()
    expect(text).toContain('云南用户侧日前价格') // 价格概况正常
    expect(text).toContain('水电占比（云南，同一业务范围）') // 供需正常
    expect(text).toContain('实时用户侧价累计负价') // 重点事项正常
    // 价差区块标题仍在（独立外壳），其内容是错误态而不是别的区块的数据
    expect(wrapper!.findAll('.yno-overview__card').some((card) => card.text().includes('日前 − 实时价差'))).toBe(false)
  })

  it('历史候选按区块所属分析传入：供需块候选为云南实际来源，key-items 块为该分析全部来源', async () => {
    await mountPage()
    // 打开供需区块的候选（第二个 InsightBlock：顺序 key-items, prices, spread, supply, ...）
    const blocks = blockComponents()
    const titles = blocks.map((block) => block.props('title'))
    const supplyIndex = titles.findIndex((title) => String(title).includes('供需与水电概况'))
    blocks[supplyIndex]!.vm.$emit('open-candidates')
    await flushPromises()
    const candidates = wrapper!.getComponent(CandidatesStub)
    expect(candidates.props('analysisId')).toBe(SUPPLY)
    expect(candidates.props('filters')).toEqual({ view: 'summary' })
    expect(candidates.props('requiredSourceIds')).toEqual([
      'yn.system.load.actual',
      'yn.system.hydro.actual',
      'yn.system.new-energy.actual',
      'yn.system.non-market.actual',
      'yn.system.total-generation.actual',
    ])
    // key-items 块候选为该分析全部来源
    blocks[0]!.vm.$emit('open-candidates')
    await flushPromises()
    expect(wrapper!.getComponent(CandidatesStub).props('analysisId')).toBe(KEY_ITEMS)
    expect(wrapper!.getComponent(CandidatesStub).props('requiredSourceIds')).toHaveLength(5)
  })

  it('窗口上限取最紧的分析（overview.key-items 限 7 天）', async () => {
    await mountPage()
    expect(wrapper!.getComponent(InsightDateRange).props('maxDays')).toBe(7)
  })
})
