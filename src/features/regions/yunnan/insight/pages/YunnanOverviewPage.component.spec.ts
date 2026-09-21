// YunnanOverviewPage.component.spec.ts — 云南市场总览页回归（dljy#3009 任务 8.3/8.4）
// 守什么不变量（对照 specs yunnan-market-overview）：
//   ① 进页面自动加载当日事实：能力目录就绪后逐块查询，不需要任何预检点击；默认窗口是
//     北京时间当日，不自动改日（A02）；
//   ② 区块按 OVERVIEW_BLOCKS 独立查询、独立失败：view 筛选按契约登记（多视图分析送 block.view
//     ——settlement-daily 升级正式/损失解释双视图后场站区块送 view=series），单视图分析不送；
//     一个区块失败不影响其他区块渲染（OV02）；
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
import { fetchGridDisclosureEvents, fetchGridDisclosureOverview } from '@/features/gridGeo/client'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightBlock from '@/components/insight/InsightBlock.vue'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import { activeAiPage, resolveInterpret } from '@/features/aiSidebar/pageRegistry'
import YunnanOverviewPage from './YunnanOverviewPage.vue'

// ── 可控 mock 状态 ───────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  responder: null as ((request: any) => Promise<any>) | null,
}))

vi.mock('@/composables/useAgentHealth', () => ({
  // 页面 AI 入口的探活打桩：不发起真实网络连接；AI 入口可见性按在线处理。
  useAgentHealth: () => ({ health: { value: 'online' }, ready: { value: true }, offline: { value: false }, check: async () => {} }),
}))

vi.mock('@/services/insight/insightClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    queryInsight: vi.fn((request: any) => state.responder!(request)),
    fetchInsightCapabilities: vi.fn(() => Promise.resolve(state.capabilities)),
  }
})

// 电网事件摘要（10.7）的数据通道打桩：grid-geo 披露事件接口（与电网边界页同一批接口）。
// eventsPool 按「窗口内停电时间升序」排列；mock 按 page/pageSize 切片模拟分页语义。
const gridState = vi.hoisted(() => ({
  overview: null as Record<string, unknown> | null,
  eventsPool: [] as Array<Record<string, unknown>>,
  eventsTotal: 0,
  eventsError: null as Error | null,
  overviewError: null as Error | null,
}))

vi.mock('@/features/gridGeo/client', () => ({
  fetchGridDisclosureOverview: vi.fn(() => {
    if (gridState.overviewError) return Promise.reject(gridState.overviewError)
    return Promise.resolve(gridState.overview)
  }),
  fetchGridDisclosureEvents: vi.fn((params: Record<string, unknown>) => {
    if (gridState.eventsError) return Promise.reject(gridState.eventsError)
    const pageSize = Number(params.pageSize ?? 30)
    const page = Number(params.page ?? 1)
    const start = (page - 1) * pageSize
    return Promise.resolve({
      items: gridState.eventsPool.slice(start, start + pageSize),
      total: gridState.eventsTotal || gridState.eventsPool.length,
      page,
      pageSize,
      categories: [],
      dataAvailability: { status: 'available', reason: '真实授权导出行，空间范围按源字段绑定', fallback: false },
    })
  }),
}))

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
  gridState.overview = gridEventsOverview()
  gridState.eventsPool = gridEventsPool()
  gridState.eventsTotal = 0
  gridState.eventsError = null
  gridState.overviewError = null
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(fetchGridDisclosureOverview).mockClear()
  vi.mocked(fetchGridDisclosureEvents).mockClear()
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

  it('获权账号：场站区块可见并发请求（settlement-daily 已登记双视图，view 按区块送 series）', async () => {
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

// ── AI 解读注册（dljy#3100，任务 15.3）：六页注册覆盖之总览页 ─────────────────────────────

describe('YunnanOverviewPage · AI 解读注册（15.3）', () => {
  it('注册统一侧栏声明并挂入口按钮：采集只含当前签名的已就绪区块，payload 无原始行', async () => {
    await mountPage()
    expect(wrapper!.find('[data-testid="yno-ai-entry"]').exists()).toBe(true)
    const def = activeAiPage().value
    expect(def?.label).toBe('云南市场总览')
    const plan = resolveInterpret(def!)
    const slice = plan?.context?.() as { blocks: Array<Record<string, unknown>> } | null
    expect(slice).not.toBeNull()
    // 六个可见区块（key-items/prices/spread/supply/forecast/grid）全部就绪且当前签名一致
    expect(slice!.blocks).toHaveLength(6)
    expect(JSON.stringify(slice)).not.toMatch(/"rows"/)
  })

  it('窗口变化后旧结果全部作废：新查询未就绪期间采集为空（过期资料不进 AI 上下文）', async () => {
    await mountPage()
    const def = activeAiPage().value!
    expect((resolveInterpret(def)!.context?.() as { blocks: unknown[] }).blocks).toHaveLength(6)
    state.responder = () => new Promise(() => {}) // 新查询挂起：旧结果已清、新结果未到
    await setWindow('2026-09-17', '2026-09-18') // 代次 +1：旧结果属于另一份读取
    const slice = resolveInterpret(def)!.context?.() as { blocks: unknown[] } | null
    expect(slice?.blocks ?? []).toHaveLength(0)
  })
})

// ── 电网事件摘要（dljy#3102，任务 10.7，GB04 + OV02/OV03）────────────────────────────────
// 守什么不变量：摘要与电网边界页检修干预页签同一批披露事件接口（不重建事实库、不经洞察
// 分析查询）；原始数/独立事件数与计划/实际分组口径与该页一致（GB04）；最近三条为窗口内
// 停电时间最晚的记录；下钻只带业务窗口；未接入/无记录诚实空态；单块失败不外溢（OV02）。

/** identity 归并汇总夹具：原始 7 条（计划 4 / 实际 3），独立 3 条，1 条身份不足未归并。 */
function gridEventsOverview() {
  return {
    total: 7,
    countsByCategory: { maintenance: 4, intervention: 2, outage: 1, congestion: 0, constraint: 0 },
    dayOnlyCount: 1,
    dayOnlyCountsByCategory: { maintenance: 1, intervention: 0, outage: 0, congestion: 0, constraint: 0 },
    buckets: [],
    bucket: 'day',
    coverage: { from: '2026-09-17', to: '2026-09-17', total: 7, timeBasis: 'businessDate', publishedTimeKnown: 6, sourceImportedTimeKnown: 6, effectiveTimeKnown: 7 },
    dataAvailability: { status: 'available', reason: '真实授权导出行，空间范围按源字段绑定', fallback: false },
    identity: {
      rawCount: 7,
      distinctCount: 3,
      unidentifiedCount: 1,
      byCategory: {
        maintenance: { rawCount: 4, distinctCount: 1, unidentifiedCount: 0 },
        intervention: { rawCount: 2, distinctCount: 1, unidentifiedCount: 1 },
        outage: { rawCount: 1, distinctCount: 1, unidentifiedCount: 0 },
      },
      note: '独立事件数只统计身份可确认的记录；身份不足的记录保留原样、单列为未归并。',
    },
  }
}

function disclosureEventFixture(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'ev-1',
    providerId: 'csg-authorized-export',
    category: 'maintenance',
    title: '某水电厂 1 号机组检修',
    summary: '计划检修：1 号机组停复电安排',
    businessDate: '2026-09-17',
    effectiveAt: '2026-09-17T08:00:00+08:00',
    expiresAt: '2026-09-20T18:00:00+08:00',
    publishedAt: '2026-09-16T10:00:00+08:00',
    timeQuality: { effective: 'source', published: 'source', intervalBasis: 'planned', issues: [] },
    source: { file: 'f.csv', recordId: 'r1', url: null, sourceTable: 'tb_disclosure_forecast_maintenance_plan' },
    confidence: 'verified-source-row',
    ...overrides,
  }
}

/** 五条记录按窗口内停电时间升序（start-asc）：最近三条 = 第 3/4/5 条（倒序展示）。 */
function gridEventsPool() {
  return [
    disclosureEventFixture({ eventId: 'ev-1', title: '某电厂 1 号机组检修', effectiveAt: '2026-09-13T08:00:00+08:00', expiresAt: '2026-09-14T18:00:00+08:00' }),
    disclosureEventFixture({ eventId: 'ev-2', category: 'intervention', title: '某线路人工干预', effectiveAt: '2026-09-14T09:00:00+08:00', expiresAt: '2026-09-14T20:00:00+08:00', timeQuality: { effective: 'source', published: 'source', intervalBasis: 'actual', issues: [] } }),
    disclosureEventFixture({ eventId: 'ev-3', category: 'outage', title: '某风电场非计划停运', effectiveAt: '2026-09-15T10:00:00+08:00', expiresAt: '2026-09-16T12:00:00+08:00', identity: { version: 2, versions: 7, rule: 'source-interval', key: 'k3' } }),
    disclosureEventFixture({ eventId: 'ev-4', title: '某变电站检修（仅业务日）', effectiveAt: null, expiresAt: null, timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: ['missing-interval'] } }),
    disclosureEventFixture({ eventId: 'ev-5', category: 'intervention', title: '某水电站人工干预', effectiveAt: '2026-09-17T12:00:00+08:00', expiresAt: '2026-09-17T20:00:00+08:00' }),
  ]
}

describe('YunnanOverviewPage · 电网事件摘要（10.7）', () => {
  it('进页面自动读披露摘要：overview+events 各查一次，窗口为默认当日；不经洞察分析查询', async () => {
    await mountPage()
    const overviewCalls = vi.mocked(fetchGridDisclosureOverview).mock.calls
    expect(overviewCalls).toHaveLength(1)
    const today = beijingToday()
    expect(overviewCalls[0]![0]).toMatchObject({ category: 'maintenance,intervention,outage', identity: 'annotate', from: today, to: today })
    const eventsCalls = vi.mocked(fetchGridDisclosureEvents).mock.calls
    expect(eventsCalls).toHaveLength(1)
    expect(eventsCalls[0]![0]).toMatchObject({ category: 'maintenance,intervention,outage', identity: 'annotate', sort: 'start-asc', from: today, to: today, pageSize: 100 })
  })

  it('摘要计数与归并口径（GB04）：原始/独立/未归并来自 identity 汇总；计划/实际分组与电网页一致', async () => {
    await mountPage()
    const counts = wrapper!.get('[data-testid="yno-events-counts"]')
    expect(counts.text()).toContain('原始记录 7 条')
    expect(counts.text()).toContain('独立事件 3 条')
    expect(counts.text()).toContain('1 条身份不足、保留未归并')
    const plan = wrapper!.get('[data-testid="yno-events-plan"]')
    expect(plan.text()).toContain('计划检修（检修计划与电网检修信息）')
    expect(plan.text()).toContain('4 条') // 原始= maintenance 4
    expect(plan.text()).toContain('1 条') // 独立= maintenance 1
    const actual = wrapper!.get('[data-testid="yno-events-actual"]')
    expect(actual.text()).toContain('实际干预（人工干预与非计划停运）')
    expect(actual.text()).toContain('3 条') // 原始= intervention 2 + outage 1
    expect(actual.text()).toContain('2 条') // 独立= 1 + 1
    // 明细接口一次都没落洞察分析管道：queryInsight 调用次数与既有区块一致（6）
    expect(queryCallsOf(() => true)).toHaveLength(6)
  })

  it('最近 3 条渲染：窗口内停电时间最晚的三条倒序展示；起止缺失如实「未提供」，带版本标注', async () => {
    await mountPage()
    expect(wrapper!.get('[data-testid="yno-events-recent"]').text()).toContain('最近 3 条（窗口内停电时间最晚）')
    expect(wrapper!.get('[data-testid="yno-events-recent-1"]').text()).toContain('某水电站人工干预')
    expect(wrapper!.get('[data-testid="yno-events-recent-1"]').text()).toContain('2026-09-17 12:00')
    expect(wrapper!.get('[data-testid="yno-events-recent-2"]').text()).toContain('某变电站检修（仅业务日）')
    expect(wrapper!.get('[data-testid="yno-events-recent-2"]').text()).toContain('未提供')
    expect(wrapper!.get('[data-testid="yno-events-recent-3"]').text()).toContain('某风电场非计划停运')
    expect(wrapper!.get('[data-testid="yno-events-recent-3"]').text()).toContain('第 2 版 / 共 7 版')
    // 不出现更早的两条
    expect(wrapper!.get('[data-testid="yno-events-recent"]').text()).not.toContain('1 号机组检修')
    expect(wrapper!.get('[data-testid="yno-events-recent"]').text()).not.toContain('某线路人工干预')
  })

  it('记录超过一页：取末页尾部三条（补一次 page=2 的明细查询）', async () => {
    const pool = Array.from({ length: 130 }, (_, index) =>
      disclosureEventFixture({ eventId: `ev-bulk-${index}`, title: `批量披露记录 ${String(index).padStart(3, '0')}`, effectiveAt: `2026-09-0${(index % 9) + 1}T0${index % 9}:00:00+08:00` })
    )
    gridState.eventsPool = pool
    gridState.eventsTotal = 130
    await mountPage()
    const calls = vi.mocked(fetchGridDisclosureEvents).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]![0]).toMatchObject({ page: 2 })
    const first = wrapper!.get('[data-testid="yno-events-recent-1"]')
    expect(first.text()).toContain('批量披露记录 129')
  })

  it('下钻携带当前业务窗口（OV05）：跳电网边界页并带 start/end', async () => {
    await mountPage()
    await setWindow('2026-09-15', '2026-09-17')
    await click('yno-events-drilldown')
    expect(router.currentRoute.value.path).toBe('/insight/grid-boundaries')
    expect(router.currentRoute.value.query).toMatchObject({ start: '2026-09-15', end: '2026-09-17' })
  })

  it('身份归并结果缺失：只显示原始数并如实说明，不硬凑独立事件数（OV03）', async () => {
    const overview = gridEventsOverview()
    delete (overview as Record<string, unknown>).identity
    gridState.overview = overview
    await mountPage()
    const counts = wrapper!.get('[data-testid="yno-events-counts"]')
    expect(counts.text()).toContain('原始记录 7 条')
    expect(counts.text()).not.toContain('独立事件')
    expect(wrapper!.find('[data-testid="yno-events-identity-missing"]').exists()).toBe(true)
    expect(wrapper!.get('[data-testid="yno-events-plan"]').text()).toContain('—') // 独立事件如实缺省
    expect(wrapper!.text()).not.toContain('独立事件 1 条')
  })

  it('事件源未接入/窗口无记录：诚实空态 + 原因，不发明细查询、不硬凑卡片（OV03）', async () => {
    gridState.overview = { ...gridEventsOverview(), dataAvailability: { status: 'not-configured', reason: '当前国网地区尚未接入省级披露 Provider', fallback: false } }
    await mountPage()
    expect(wrapper!.get('[data-testid="yno-events-empty"]').text()).toContain('披露事件源未接入')
    expect(wrapper!.get('[data-testid="yno-events-empty"]').text()).toContain('当前国网地区尚未接入省级披露 Provider')
    expect(vi.mocked(fetchGridDisclosureEvents)).not.toHaveBeenCalled()

    gridState.overview = { ...gridEventsOverview(), identity: { ...gridEventsOverview().identity as Record<string, unknown>, rawCount: 0, distinctCount: 0, unidentifiedCount: 0, byCategory: {} }, total: 0 }
    gridState.overviewError = null
    vi.mocked(fetchGridDisclosureOverview).mockClear()
    await mountPage()
    expect(wrapper!.get('[data-testid="yno-events-empty"]').text()).toContain('当前窗口内没有计划检修、实际干预或故障的披露记录')
    expect(wrapper!.find('[data-testid="yno-events-plan"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="yno-events-recent"]').exists()).toBe(false)
  })

  it('单块失败隔离（OV02）：明细接口失败只影响本区块，重试成功后恢复；其他区块照常', async () => {
    gridState.eventsError = new Error('披露事件读取超时')
    await mountPage()
    expect(wrapper!.get('[data-testid="yno-events-error"]').text()).toContain('披露事件读取超时')
    // 其他区块不受影响
    expect(wrapper!.text()).toContain('云南用户侧日前价格')
    expect(wrapper!.text()).toContain('水电占比（云南，同一业务范围）')
    // 摘要计数（overview 成功）仍展示
    expect(wrapper!.get('[data-testid="yno-events-counts"]').text()).toContain('原始记录 7 条')
    // 重试成功恢复
    gridState.eventsError = null
    await click('yno-events-retry')
    expect(wrapper!.find('[data-testid="yno-events-error"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="yno-events-recent-1"]').exists()).toBe(true)
  })

  it('可见性按接口实际语义（公开披露、公司级作用域）：公共账号可读摘要，获权场站区块仍不可见', async () => {
    await mountPage()
    expect(wrapper!.find('[data-testid="yno-events-note"]').exists()).toBe(true)
    expect(wrapper!.text()).not.toContain('获权场站表现')
    expect(queryCallsOf((request) => request.analysisId === PLANTS)).toHaveLength(0)
  })

  it('窗口变化重查：旧摘要作废，按新窗口重发 overview+events', async () => {
    await mountPage()
    vi.mocked(fetchGridDisclosureOverview).mockClear()
    vi.mocked(fetchGridDisclosureEvents).mockClear()
    await setWindow('2026-05-12', '2026-05-13')
    expect(vi.mocked(fetchGridDisclosureOverview).mock.calls[0]![0]).toMatchObject({ from: '2026-05-12', to: '2026-05-13' })
    expect(vi.mocked(fetchGridDisclosureEvents).mock.calls[0]![0]).toMatchObject({ from: '2026-05-12', to: '2026-05-13' })
  })

  it('业务语言：界面不出现接口原文、类别代码或身份字段原文', async () => {
    await mountPage()
    const text = wrapper!.get('[data-testid="yno-events-note"]').text()
      + wrapper!.text()
    expect(text).not.toContain('maintenance,intervention,outage')
    expect(text).not.toContain('annotate')
    expect(text).not.toContain('distinctCount')
    expect(text).not.toContain('csg-authorized-export')
    expect(text).not.toContain('start-asc')
    expect(text).toContain('与电网边界页完整筛选同源同口径')
  })
})
