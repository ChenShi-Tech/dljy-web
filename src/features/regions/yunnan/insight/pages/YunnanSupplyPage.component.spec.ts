// YunnanSupplyPage.component.spec.ts — 云南供需与水电页回归（dljy#3008 任务 7.5/7.6）
// 守什么不变量（对照 specs yunnan-supply-hydro-analysis）：
//   ① 类别不是互斥分量：主图序列不堆叠（无 stack / areaStyle），南网整体序列不进云南主图；
//   ② 预测曲线默认不同图，开关打开后以虚线出现；
//   ③ summary 的 notDerived / unavailableMetrics 按原文说明，不显示成 0；
//   ④ 获权两分析按能力目录判定：公共账号不渲染空框、不发获权请求，只说明「获权数据需开通」；
//     中广核账号水电周出力默认只选「云南」；机组群未选不发请求，表格没有「上限」列；
//   ⑤ forecast-error：未配对原因原文展示；未达门槛「可查看，不参与排名」；事后对照 mode 说明固定在；
//   ⑥ residual-proxy：缺输入时 unavailable 原因逐条、不画空线；formula 与「不是官方竞价空间」说明在；
//   ⑦ 窗口对比：未选参考窗口不发参考请求；选定后两次 summary 的 businessWindow 分别是当前与参考；
//     改当前窗口后旧对比作废（迟到的参考结果不写进新状态）；
//   ⑧ 页签懒加载切回不重查；界面只出现业务语言，不出现来源标识原文。
// mock 边界：insightClient 打桩（保留类型与错误类）；useInsightContext 用真 composable
//（真 router + 全局地区/公司 ref）；shared/insight 契约镜像用真模块（名称/精度取登记）。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInsightCapabilities,
  queryInsight,
} from '@/services/insight/insightClient'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightObjectPicker from '@/components/insight/InsightObjectPicker.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import YunnanSupplyPage from './YunnanSupplyPage.vue'

// ── 可控 mock 状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────

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

// ── 图表桩：绕开 ECharts canvas；ChartCard 调用 buildOption 捕获当前 option ─────────────

const chartOptionsByTitle = new Map<string, Record<string, unknown>>()

const ChartCardStub = defineComponent({
  name: 'ChartCard',
  props: {
    title: { type: String, default: '' },
    height: { type: Number, default: 280 },
    buildOption: { type: Function, default: null },
  },
  setup(props) {
    return () => {
      if (props.buildOption) {
        chartOptionsByTitle.set(props.title, (props.buildOption as () => Record<string, unknown>)())
      }
      return h('div', { class: 'chart-card-stub' }, props.title)
    }
  },
})

const InsightSeriesChartStub = defineComponent({
  name: 'InsightSeriesChart',
  props: {
    result: { type: Object, default: null },
    current: { type: Object, default: null },
    height: { type: Number, default: 320 },
  },
  emits: ['select'],
  render: () => h('div', { class: 'series-chart-stub' }),
})

// ── 能力目录与结果夹具（形状对照 dljy 仓 supply-views.mjs）──────────────────────────────

const SUPPLY_SYSTEM = 'supply.system-series'
const HYDRO_WEEKLY = 'supply.hydro-weekly-output'
const HYDRO_GROUPS = 'supply.hydro-unit-groups'

const SOURCE_TITLES: Record<string, string> = {
  'yn.system.load.actual': '云南电网负荷（实际）',
  'yn.system.hydro.actual': '云南水电出力（实际）',
  'yn.system.new-energy.actual': '云南新能源出力（实际）',
  'yn.system.non-market.actual': '云南非市场机组出力（实际）',
  'yn.system.total-generation.actual': '云南总发电（实际）',
  'yn.system.load.forecast': '云南负荷预测',
  'yn.system.new-energy.forecast-d1': '云南新能源日前预测',
  'csg.system.load.actual': '南方电网整体口径负荷（实际，背景）',
  'csg.system.hydro.actual': '南方电网整体口径水电（实际，背景）',
  'cgn.hydro.weekly-output.forecast': '水电周出力预测（逐日平均出力，按区域）',
  'cgn.hydro.yn-group-share': '云南水电机组群组成与机组出力占比（按日）',
}

const NOT_DERIVED_ITEMS = [
  { label: '非市场出力', reason: '没有直接来源；不按「总发电 − 水电 − 新能源」倒推，避免口径混叠' },
  { label: '各类别相加的供给总量', reason: '负荷、水电、新能源、非市场不是互斥分量，不合成总供给' },
]
const UNAVAILABLE_ENERGY_REASON = '功率口径没有电量，不计算供电量'
const UNPAIRED_NON_MARKET_REASON = '没有可比的实际：非市场预测没有对应的实际曲线'
const PROXY_FORMULA = '负荷预测 + 云南总送出预测 − 新能源日前预测（逐小时，15 分钟曲线四点齐全才取小时均值）'
const PROXY_FORECAST_UNAVAILABLE = '缺少输入：云南总送出预测这段日期没有资料'
const PROXY_ACTUAL_UNAVAILABLE = '剩余需求代理只有预测口径，实际口径没有对应来源'

/** 系统曲线序列目录条目（seriesId 形如「来源|字段」；category 是供应视图的类别字段）。 */
function sysSeries(args: {
  sourceId: string
  scope: string
  variant: 'actual' | 'forecast'
  category: string
  resolution?: number
}) {
  return {
    seriesId: `${args.sourceId}|value`,
    sourceId: args.sourceId,
    fieldId: 'value',
    unit: 'MW',
    measureKind: 'power',
    dimensions: {},
    businessScope: args.scope,
    resolutionMinutes: args.resolution ?? 15,
    nativeResolutionMinutes: args.resolution ?? 15,
    priceObject: null,
    marketPhase: null,
    variant: args.variant,
    category: args.category,
  }
}

const SYSTEM_SERIES = [
  sysSeries({ sourceId: 'yn.system.load.actual', scope: 'yunnan', variant: 'actual', category: 'load' }),
  sysSeries({ sourceId: 'yn.system.hydro.actual', scope: 'yunnan', variant: 'actual', category: 'hydro' }),
  sysSeries({ sourceId: 'yn.system.new-energy.actual', scope: 'yunnan', variant: 'actual', category: 'new-energy' }),
  sysSeries({ sourceId: 'yn.system.non-market.actual', scope: 'yunnan', variant: 'actual', category: 'non-market' }),
  sysSeries({ sourceId: 'yn.system.total-generation.actual', scope: 'yunnan', variant: 'actual', category: 'total-generation' }),
  sysSeries({ sourceId: 'yn.system.load.forecast', scope: 'yunnan', variant: 'forecast', category: 'load' }),
  sysSeries({ sourceId: 'yn.system.new-energy.forecast-d1', scope: 'yunnan', variant: 'forecast', category: 'new-energy' }),
  sysSeries({ sourceId: 'csg.system.load.actual', scope: 'csg-aggregate', variant: 'actual', category: 'load' }),
  sysSeries({ sourceId: 'csg.system.hydro.actual', scope: 'csg-aggregate', variant: 'actual', category: 'hydro' }),
]

function systemRows(): Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }> {
  const rows: Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }> = []
  for (const meta of SYSTEM_SERIES) {
    rows.push(
      { seriesId: meta.seriesId, intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T10:15:00+08:00', value: '126.666666666667' },
      { seriesId: meta.seriesId, intervalStart: '2026-09-17T10:15:00+08:00', intervalEnd: '2026-09-17T10:30:00+08:00', value: '130.5' }
    )
  }
  return rows
}

function systemSeriesResult(request: any) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: systemRows(),
      series: SYSTEM_SERIES,
    },
  })
}

/** summary 目录：普通序列 + 水电占比行（kind share，无 sourceId）。 */
function summaryCatalog() {
  return [
    ...SYSTEM_SERIES.map((meta) => ({ ...meta })),
    {
      seriesId: 'share:hydro:yunnan',
      kind: 'share',
      unit: '%',
      businessScope: 'yunnan',
      numeratorSeriesId: 'yn.system.hydro.actual|value',
      denominatorSeriesId: 'yn.system.total-generation.actual|value',
    },
    {
      seriesId: 'share:hydro:csg-aggregate',
      kind: 'share',
      unit: '%',
      businessScope: 'csg-aggregate',
      numeratorSeriesId: 'csg.system.hydro.actual|value',
      denominatorSeriesId: 'csg.system.load.actual|value',
    },
  ]
}

function summaryResult(request: any, opts?: { hydroShare?: string }) {
  const rows: Array<Record<string, string | null>> = []
  for (const meta of SYSTEM_SERIES) {
    rows.push(
      { seriesId: meta.seriesId, metricId: 'supply.mean-power', value: '126.666666666667' },
      { seriesId: meta.seriesId, metricId: 'supply.minimum', value: '90.25', atIntervalStart: '2026-09-17T10:00:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'supply.maximum', value: '180', atIntervalStart: '2026-09-17T10:15:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'sample.valid-hours', value: '24' }
    )
  }
  rows.push(
    { seriesId: 'share:hydro:yunnan', metricId: 'supply.hydro-share', value: opts?.hydroShare ?? '62.5' },
    { seriesId: 'share:hydro:yunnan', metricId: 'sample.common-hours', value: '24' },
    { seriesId: 'share:hydro:csg-aggregate', metricId: 'supply.hydro-share', value: '48.1' },
    { seriesId: 'share:hydro:csg-aggregate', metricId: 'sample.common-hours', value: '24' }
  )
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows,
      series: summaryCatalog(),
      notDerived: NOT_DERIVED_ITEMS,
      unavailableMetrics: [{ metricId: 'supply.energy', reason: UNAVAILABLE_ENERGY_REASON }],
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
    eligibility: { samples: 60, expectedSamples: 96, coverageRatio: 0.625, eligible: false, required: { minSamples: 96, minCoverageRatio: 0.8 } },
  }
  const newEnergyPair = {
    ...loadPair,
    seriesId: 'error:new-energy',
    forecastSeriesId: 'yn.system.new-energy.forecast-d1|value',
    actualSeriesId: 'yn.system.new-energy.actual|value',
    category: 'new-energy',
    eligibility: { samples: 96, expectedSamples: 96, coverageRatio: 1, eligible: true, required: { minSamples: 96, minCoverageRatio: 0.8 } },
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [
        { seriesId: 'error:load', intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T10:15:00+08:00', value: '-4.25' },
        { seriesId: 'error:load', intervalStart: '2026-09-17T10:15:00+08:00', intervalEnd: '2026-09-17T10:30:00+08:00', value: '6.75' },
      ],
      series: [loadPair, newEnergyPair],
      tables: {
        summary: {
          rows: [
            { seriesId: 'error:load', metricId: 'forecast.mae', value: '12.5' },
            { seriesId: 'error:load', metricId: 'forecast.bias', value: '-3.25' },
            { seriesId: 'error:load', metricId: 'sample.common-hours', value: '24' },
            { seriesId: 'error:load', metricId: 'sample.forecast-valid-hours', value: '24' },
            { seriesId: 'error:load', metricId: 'sample.actual-valid-hours', value: '24' },
          ],
        },
      },
      unpaired: [{ seriesId: 'yn.system.non-market.forecast|value', reason: UNPAIRED_NON_MARKET_REASON }],
      notes: [{ note: '新能源日前预测按发布日的次日目标日对齐，逐时段比较的是目标日实际' }],
      unavailableMetrics: [
        { metricId: 'forecast.energy-error', reason: '功率口径没有电量，不计算电量误差' },
        { metricId: 'forecast.mape', reason: '实际出力为零或接近零的时段不可用' },
      ],
    },
  })
}

function proxyResult(request: any) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [], // 缺输入：无逐小时代理值，页面不画空线
      series: [
        {
          seriesId: 'proxy:yunnan:forecast',
          kind: 'residual-demand-proxy',
          businessScope: 'yunnan',
          unit: 'MW',
          variant: 'forecast',
          resolutionMinutes: 60,
        },
      ],
      tables: { summary: { rows: [] } },
      formula: PROXY_FORMULA,
      notes: [{ note: '按逐小时口径呈现；云南总送出预测为 60 分钟，先对齐再作差' }],
      unavailable: [
        { item: 'residual-demand-proxy.forecast', reason: PROXY_FORECAST_UNAVAILABLE },
        { item: 'residual-demand-proxy.actual', reason: PROXY_ACTUAL_UNAVAILABLE },
      ],
    },
  })
}

function hydroWeeklyResult(request: any) {
  const meta = {
    seriesId: 'cgn.hydro.weekly-output.forecast|云南',
    sourceId: 'cgn.hydro.weekly-output.forecast',
    fieldId: 'value',
    unit: 'MW',
    measureKind: 'power',
    dimensions: { region: '云南' },
    businessScope: 'csg-multi-region',
    resolutionMinutes: 1440,
    nativeResolutionMinutes: 1440,
    priceObject: null,
    marketPhase: null,
    variant: 'forecast',
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [
        { seriesId: meta.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '2210.5' },
        { seriesId: meta.seriesId, intervalStart: '2026-09-18T00:00:00+08:00', intervalEnd: '2026-09-19T00:00:00+08:00', value: '2240' },
      ],
      series: [meta],
    },
  })
}

function hydroGroupsResult(request: any) {
  const seriesOf = (plant: string, unit: string) => ({
    seriesId: `cgn.hydro.yn-group-share|云南|31 家水电|${plant}|${unit}`,
    sourceId: 'cgn.hydro.yn-group-share',
    fieldId: 'value',
    unit: '%',
    measureKind: 'ratio',
    dimensions: { region: '云南', group: '31 家水电', plant, unit },
    businessScope: 'yunnan',
    resolutionMinutes: 1440,
    nativeResolutionMinutes: 1440,
    priceObject: null,
    marketPhase: null,
    variant: 'forecast',
  })
  const first = seriesOf('某水电厂', '1 号机')
  const second = seriesOf('某水电厂', '2 号机')
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: '%' }],
      rows: [
        { seriesId: first.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '3.25' },
        { seriesId: second.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '2.75' },
      ],
      series: [first, second],
    },
  })
}

function defaultResponder(request: any): Promise<any> {
  if (request.analysisId === HYDRO_WEEKLY) return Promise.resolve(hydroWeeklyResult(request))
  if (request.analysisId === HYDRO_GROUPS) return Promise.resolve(hydroGroupsResult(request))
  switch (request.filters?.view) {
    case 'summary':
      return Promise.resolve(summaryResult(request))
    case 'forecast-error':
      return Promise.resolve(forecastErrorResult(request))
    case 'residual-proxy':
      return Promise.resolve(proxyResult(request))
    default:
      return Promise.resolve(systemSeriesResult(request))
  }
}

function supplyCaps(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['supply'],
      access: 'public',
      sourceIds: Object.keys(SOURCE_TITLES),
      limits: { maxDays: 31, maxObjects: 10, requiresObjects: analysisId !== SUPPLY_SYSTEM },
    })),
    sources: Object.entries(SOURCE_TITLES).map(([sourceId, title]) => ({
      sourceId,
      title,
      businessScope: sourceId.startsWith('yn.') ? 'yunnan' : 'csg-multi-region',
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

const PUBLIC_CAPS = [SUPPLY_SYSTEM]
const ENTITLED_CAPS = [SUPPLY_SYSTEM, HYDRO_WEEKLY, HYDRO_GROUPS]

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanSupplyPage, {
    global: {
      plugins: [router],
      stubs: { InsightSeriesChart: InsightSeriesChartStub, ChartCard: ChartCardStub },
    },
  })
  await flushPromises()
  return wrapper
}

function queryCallsOf(predicate: (request: any) => boolean) {
  return vi.mocked(queryInsight).mock.calls.filter(([request]) => predicate(request))
}

function chartOptionOf(title: string): Record<string, unknown> | undefined {
  return chartOptionsByTitle.get(title)
}

function chartSeriesOf(title: string): Array<Record<string, unknown>> {
  const option = chartOptionOf(title)
  return (option?.series ?? []) as Array<Record<string, unknown>>
}

// VTU 对字符串选择器返回弱类型（无 vm/props），统一断言回 VueWrapper。
function forecastChoiceSelect(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="yns-forecast-choice"]') as unknown as VueWrapper<any>
}

function unitGroupSelect(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="yns-unit-group"]') as unknown as VueWrapper<any>
}

function referenceWindowPicker(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="yns-reference-window"]') as unknown as VueWrapper<any>
}

async function switchTab(name: string) {
  wrapper!.getComponent({ name: 'ElTabs' }).vm.$emit('tab-change', name)
  await flushPromises()
}

async function setWindow(start: string, end: string) {
  wrapper!.getComponent(InsightDateRange).vm.$emit('update:modelValue', { start, end })
  await flushPromises()
}

function currentWindow(): { start: string; end: string } {
  return wrapper!.getComponent(InsightDateRange).props('modelValue')
}

beforeEach(async () => {
  localStorage.clear()
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
  state.capabilities = supplyCaps(PUBLIC_CAPS)
  state.responder = defaultResponder
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
  chartOptionsByTitle.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('供需全景', () => {
  it('类别只叠线不堆叠：序列无 stack / areaStyle，南网整体序列不出现在云南主图', async () => {
    await mountPage()

    const series = chartSeriesOf('云南系统曲线（实际实线；预测虚线）')
    expect(series.length).toBeGreaterThan(0)
    for (const line of series) {
      expect(line.stack).toBeUndefined()
      expect(line.areaStyle).toBeUndefined()
    }
    // 云南主图只含云南序列；南网整体口径（背景）不混入
    const names = series.map((line) => String(line.name))
    expect(names.some((name) => name.includes('云南'))).toBe(true)
    expect(names.some((name) => name.includes('南方电网整体口径'))).toBe(false)
  })

  it('主图 tooltip 点值按来源精度显示（126.666666666667 → 126.667），不透出原始浮点', async () => {
    await mountPage()

    const title = '云南系统曲线（实际实线；预测虚线）'
    const formatter = (chartOptionOf(title)?.tooltip as { formatter?: (raw: unknown) => string } | undefined)?.formatter
    expect(typeof formatter).toBe('function')
    const seriesName = String(chartSeriesOf(title)[0]?.name ?? '')
    const out = formatter!([
      { marker: '', seriesName, data: { value: [Date.parse('2026-09-17T10:00:00+08:00'), 126.666666666667] } },
    ])
    expect(out).toContain('126.667')
    expect(out).not.toContain('126.666666666667')
  })

  it('预测曲线默认不同图；打开开关后以虚线出现在主图（阶梯、缺测断开口径不变）', async () => {
    await mountPage()

    const before = chartSeriesOf('云南系统曲线（实际实线；预测虚线）')
    expect(before.some((line) => String(line.name).includes('预测'))).toBe(false)

    ;(wrapper!.getComponent('[data-testid="yns-forecast-toggle"]') as unknown as VueWrapper<any>).vm.$emit('update:modelValue', true)
    await flushPromises()

    const after = chartSeriesOf('云南系统曲线（实际实线；预测虚线）')
    const forecastLines = after.filter((line) => String(line.name).includes('预测'))
    expect(forecastLines.length).toBeGreaterThan(0)
    for (const line of forecastLines) {
      expect((line.lineStyle as { type?: string } | undefined)?.type).toBe('dashed')
      expect(line.step).toBe('end')
      expect(line.connectNulls).toBe(false)
    }
  })

  it('notDerived 与不可用指标按原文说明原因，不显示成 0；水电占比卡写明同一业务范围口径', async () => {
    await mountPage()

    const text = wrapper!.text()
    for (const item of NOT_DERIVED_ITEMS) {
      expect(text).toContain(item.label)
      expect(text).toContain(item.reason)
    }
    expect(text).toContain(UNAVAILABLE_ENERGY_REASON)
    expect(text).not.toContain('不可用：0')
    expect(text).toContain('62.5') // 水电占比（云南）按登记精度显示
    expect(text).toContain('同一业务范围内：水电 / 总发电（共同有效时段按时长加权）')
    expect(text).toContain('水电占比（云南）')
    expect(text).toContain('水电占比（南方电网整体口径）')
  })
})

describe('水电页签', () => {
  it('公共账号：能力目录无两个获权分析时不发获权请求、不渲染空框，只说明获权数据需开通', async () => {
    state.capabilities = supplyCaps(PUBLIC_CAPS)
    await mountPage()
    await switchTab('hydro')

    expect(queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)).toHaveLength(0)
    const text = wrapper!.text()
    expect(text).toContain('获权数据需开通')
    expect(text).not.toContain('水电周出力预测（获权）')
    expect(text).not.toContain('云南水电机组群组成与占比（获权）')
  })

  it('中广核账号：水电周出力默认只选「云南」，请求携带 objectIds=[云南]；区域分列不相加的说明在', async () => {
    state.capabilities = supplyCaps(ENTITLED_CAPS)
    await mountPage()
    await switchTab('hydro')

    const pickers = wrapper!.findAllComponents(InsightObjectPicker)
    expect(pickers).toHaveLength(1)
    expect(pickers[0]!.props('modelValue')).toEqual(['云南'])
    const calls = queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['云南'])
    expect(wrapper!.text()).toContain('按区域分列、不相加')
    // 云南水电实际曲线与占比卡仍来自公开系统曲线
    expect(wrapper!.text()).toContain('水电占比（云南）')
  })

  it('机组群未选不发请求；选定后表格出现且没有「上限」字样的列（来源只披露组成与占比）', async () => {
    state.capabilities = supplyCaps(ENTITLED_CAPS)
    await mountPage()
    await switchTab('hydro')

    expect(wrapper!.text()).toContain('请先选择机组群')
    expect(queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)).toHaveLength(0)

    unitGroupSelect().vm.$emit('update:modelValue', '31 家水电')
    await flushPromises()
    const calls = queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['31 家水电'])

    const labels = wrapper!
      .findAllComponents({ name: 'ElTableColumn' })
      .map((column) => String(column.props('label') ?? ''))
    expect(labels).toContain('出力占比（%）')
    expect(labels.filter((label) => label.includes('上限'))).toHaveLength(0)
    expect(wrapper!.text()).toContain('某水电厂')
    expect(wrapper!.text()).toContain('来源只披露组成与占比')
  })
})

describe('预测与实际', () => {
  it('未配对原因原文展示；未达门槛显示「可查看，不参与排名」；事后对照 mode 说明固定在', async () => {
    await mountPage()
    await switchTab('forecast')

    const text = wrapper!.text()
    expect(text).toContain('事后对照（只有发布日期，没有发布时刻，不能当事前回测）')
    expect(text).toContain('未配对')
    expect(text).toContain(UNPAIRED_NON_MARKET_REASON)
    expect(text).toContain('可查看，不参与排名')
    expect(text).toContain('有效样本 60/96')
    expect(text).toContain('新能源日前预测按目标日对齐（发布日次日）')
    // 误差统计卡：MAE 与偏差按登记精度
    expect(text).toContain('12.5')
    expect(text).toContain('-3.25')
  })

  it('原始曲线同图对齐：预测虚线、实际实线；误差曲线只有一条「预测 − 实际」', async () => {
    await mountPage()
    await switchTab('forecast')

    const raw = chartSeriesOf('预测与实际（预测虚线、实际实线）')
    expect(raw).toHaveLength(2)
    const byName = new Map(raw.map((line) => [String(line.name), line]))
    expect((byName.get('云南负荷预测')?.lineStyle as { type?: string } | undefined)?.type).toBe('dashed')
    expect(byName.get('云南电网负荷（实际）')?.lineStyle).toBeUndefined()

    const error = chartSeriesOf('误差（预测 − 实际）')
    expect(error).toHaveLength(1)
    expect(error[0]!.name).toBe('预测 − 实际')
    expect(error[0]!.step).toBe('end')
  })

  it('切换预测选择：目录里两个配对都可选，标签用类别业务名', async () => {
    await mountPage()
    await switchTab('forecast')

    const select = forecastChoiceSelect()
    expect(select.props('modelValue')).toBe('error:load')
    const options = select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))
    expect(options).toEqual(['负荷预测', '新能源日前预测'])

    select.vm.$emit('update:modelValue', 'error:new-energy')
    await flushPromises()
    expect(forecastChoiceSelect().props('modelValue')).toBe('error:new-energy')
    // 新能源配对达门槛：不再出现未达提示
    expect(wrapper!.text()).not.toContain('未达排名门槛')
  })
})

describe('历史比较', () => {
  it('剩余需求代理：缺输入时 unavailable 原因逐条、不画空线；formula 与「不是官方竞价空间」说明在', async () => {
    await mountPage()
    await switchTab('history')

    const text = wrapper!.text()
    expect(text).toContain(PROXY_FORECAST_UNAVAILABLE)
    expect(text).toContain(PROXY_ACTUAL_UNAVAILABLE)
    expect(text).toContain(PROXY_FORMULA)
    expect(text).toContain('不是官方竞价空间')
    const lines = chartSeriesOf('剩余需求代理（逐小时，预测口径）')
    expect(lines).toHaveLength(0) // 缺输入不画空线
  })

  it('未选参考窗口不发参考请求；选定后两次 summary 的 businessWindow 分别是当前与参考，对比表并排呈现', async () => {
    await mountPage()
    await switchTab('history')

    expect(wrapper!.text()).toContain('请先选择参考窗口')
    const window = currentWindow()
    const summaryCalls = queryCallsOf((request) => request.filters?.view === 'summary')
    expect(summaryCalls.length).toBeGreaterThan(0)
    // 只有当前侧 summary：没有任何一次以参考窗口发起
    expect(summaryCalls.every((call) => call[0]!.context!.businessWindow.start === window.start)).toBe(true)

    referenceWindowPicker().vm.$emit('update:modelValue', { start: '2025-05-01', end: '2025-05-07' })
    await flushPromises()

    const calls = queryCallsOf((request) => request.filters?.view === 'summary')
    expect(calls.some((call) => call[0]!.context!.businessWindow.start === window.start)).toBe(true)
    const reference = calls.filter((call) => call[0]!.context!.businessWindow.start === '2025-05-01')
    expect(reference).toHaveLength(1)
    expect(reference[0]![0]!.context!.businessWindow.end).toBe('2025-05-07')
    // 对比表：当前/参考两列都有平均功率，标签写清参考窗口
    const text = wrapper!.text()
    expect(text).toContain('平均功率（当前，MW）')
    expect(text).toContain('平均功率（参考，MW）')
    expect(text).toContain('参考窗口 2025-05-01 ~ 2025-05-07')
    // 数值按指标精度显示（夹具 126.666666666667 → 126.7），不是恒「—」；断言收窄到对比表本身，
    // 避免误吃其他页签统计卡里的同值
    expect(wrapper!.find('[data-testid="yns-compare-table"]').text()).toContain('126.7')
  })

  it('改当前窗口后旧对比作废：迟到的参考结果不写进新状态，对比表不显示', async () => {
    await mountPage()
    await switchTab('history')

    // 参考侧 summary 挂起（旧代次）；改窗后的新代次请求永久挂起，不产生干扰
    let resolveOld: (value: unknown) => void = () => {}
    const oldPromise = new Promise((resolve) => {
      resolveOld = resolve
    })
    let oldReferenceAsked = false
    state.responder = (request) => {
      if (request.filters?.view === 'summary' && request.context.businessWindow.start === '2025-05-01') {
        if (!oldReferenceAsked) {
          oldReferenceAsked = true
          return oldPromise.then(() => summaryResult(request, { hydroShare: '88.8' }))
        }
        return new Promise(() => {})
      }
      return defaultResponder(request)
    }

    referenceWindowPicker().vm.$emit('update:modelValue', { start: '2025-05-01', end: '2025-05-07' })
    await flushPromises()
    // 参考请求在途时对比不显示
    expect(wrapper!.text()).not.toContain('平均功率（参考，MW）')

    // 改当前窗口：上下文代次作废在途请求，旧参考响应迟到也不得写入
    await setWindow('2026-09-10', '2026-09-11')
    resolveOld(null)
    await flushPromises()

    expect(wrapper!.text()).not.toContain('平均功率（参考，MW）')
    expect(wrapper!.text()).not.toContain('88.8')
  })

  it('两个窗口天数不同时明示「平均值可比、合计不可比」', async () => {
    await mountPage()
    await switchTab('history')

    // 当前窗口为 1 天（默认当日），参考窗口 7 天 → 天数不同提示
    referenceWindowPicker().vm.$emit('update:modelValue', { start: '2025-05-01', end: '2025-05-07' })
    await flushPromises()

    expect(wrapper!.text()).toContain('两个窗口天数不同，平均值可比、合计不可比')
  })
})

describe('状态与展示纪律', () => {
  it('历史候选按云南五条实际来源求交集（南网背景与预测来源不参与）', async () => {
    await mountPage()

    const required = wrapper!.getComponent(InsightHistoryCandidates).props('requiredSourceIds') as string[]
    expect([...required].sort()).toEqual(
      [
        'yn.system.load.actual',
        'yn.system.hydro.actual',
        'yn.system.new-energy.actual',
        'yn.system.non-market.actual',
        'yn.system.total-generation.actual',
      ].sort()
    )
  })

  it('页签懒加载：切走再切回不重查（同签名）', async () => {
    await mountPage()
    const seriesCallsBefore = queryCallsOf((request) => request.filters?.view === 'series').length
    await switchTab('forecast')
    await switchTab('hydro')
    await switchTab('overview')
    expect(queryCallsOf((request) => request.filters?.view === 'series')).toHaveLength(seriesCallsBefore)
  })

  it('界面只出现业务语言：不出现来源标识、内部字段原文', async () => {
    state.capabilities = supplyCaps(ENTITLED_CAPS)
    await mountPage()
    await switchTab('hydro')
    await switchTab('forecast')
    await switchTab('history')

    const text = wrapper!.text()
    expect(text).not.toContain('yn.system')
    expect(text).not.toContain('cgn.hydro')
    expect(text).not.toContain('sourceId')
    expect(text).not.toContain('supply.energy')
    expect(text).not.toContain('residual-demand-proxy.forecast')
  })
})
