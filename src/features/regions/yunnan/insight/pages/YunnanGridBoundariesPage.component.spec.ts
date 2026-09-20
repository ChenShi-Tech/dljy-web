// YunnanGridBoundariesPage.component.spec.ts — 云南跨省与电网边界页回归（dljy#3024 任务 10.5）
// 守什么不变量（对照 specs grid-boundary-analysis）：
//   ① 三页签懒加载：查询形状固定（view 筛选、公开分析无对象维度）；
//   ② 获权四分析按能力目录判定：公共账号不渲染获权区块、不发获权请求与覆盖请求，
//     每个页签给一条「获权数据需开通」说明；
//   ③ 对象选项来自覆盖接口各来源 objects 并集：字段缺失（老后端）时显示「无法列出」
//     且不发查询、不伪造选项；字段在但为空时如实说窗口内没有对象；
//   ④ 未选对象不发请求；选定后 series / limit-match（或 records）各查一次、带 objectIds；
//   ⑤ limit-match：配对行渲染（正负号原样）、按通道统计卡、未配对逐条原因、后端 notes；
//   ⑥ records 是记录不是曲线：表格呈现、不出现图表；
//   ⑦ 单区块失败不影响其他区块；上下文（窗口）变化全部作废重查（含覆盖清单）；
//   ⑧ 界面只出现业务语言，不出现来源标识原文。
// mock 边界：insightClient 打桩（保留类型与错误类）；useInsightContext 用真 composable
//（真 router + 全局地区/公司 ref）；shared/insight 契约镜像用真模块（指标/精度取登记）。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInsightCapabilities,
  fetchInsightCoverage,
  queryInsight,
  InsightRequestError,
} from '@/services/insight/insightClient'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightObjectPicker from '@/components/insight/InsightObjectPicker.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import YunnanGridBoundariesPage from './YunnanGridBoundariesPage.vue'
import { fetchGridDisclosureEvents, fetchGridDisclosureOverview, fetchGridObject } from '@/features/gridGeo/client'
import { ApiError } from '@/services/api'

// ── 可控 mock 状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  responder: null as ((request: any) => Promise<any>) | null,
  /** coverage 来源清单：analysisId → sources[]（objects 字段按场景给或不给）。 */
  coverageSources: null as Record<string, Array<{ sourceId: string; objects?: string[]; objectsNote?: string }>> | null,
  /** 检修干预页签（#3092）：当前账号角色与 gridGeo 披露客户端的可控响应。 */
  role: 'TRADER' as string,
  availability: 'available' as string,
}))

vi.mock('@/services/insight/insightClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    queryInsight: vi.fn((request: any) => state.responder!(request)),
    fetchInsightCapabilities: vi.fn(() => Promise.resolve(state.capabilities)),
    fetchInsightCoverage: vi.fn((request: any) => Promise.resolve(coverageResult(request))),
  }
})

// 检修干预页签（#3092）：gridGeo 披露客户端与账号角色的可控打桩（页面只经此读披露事件）。
vi.mock('@/services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCurrentUser: vi.fn(() => ({ roleCode: state.role }) as never),
  }
})
vi.mock('@/features/gridGeo/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    fetchGridDisclosureEvents: vi.fn((params: Record<string, string | number>) => {
      const wanted = String(params.category ?? '').split(',')
      const rows = maintenanceEventPool().filter((event) => wanted.includes(String(event.category)))
      return Promise.resolve({
        items: rows,
        total: rows.length,
        page: 1,
        pageSize: 100,
        categories: ['maintenance', 'intervention', 'outage'],
        dataAvailability: { status: state.availability, reason: '', fallback: false },
      })
    }),
    fetchGridDisclosureOverview: vi.fn(() => Promise.resolve(disclosureOverview.value)),
    fetchGridObject: vi.fn(() => {
      if (disclosureObjectError.value) return Promise.reject(disclosureObjectError.value)
      return Promise.resolve(disclosureObjectDetail.value)
    }),
  }
})

/** vi.hoisted 容器：工厂与用例共享的可控响应。 */
const { maintenanceEventPool, disclosureOverview, disclosureObjectDetail, disclosureObjectError } = vi.hoisted(() => ({
  maintenanceEventPool: () => maintenanceEventPoolValue,
  disclosureOverview: { value: null as any },
  disclosureObjectDetail: { value: null as any },
  disclosureObjectError: { value: null as any },
}))
let maintenanceEventPoolValue: Array<Record<string, unknown>> = []

function coverageResult(request: any) {
  return {
    schemaVersion: 'insight/v1',
    analysisId: request.analysisId,
    regionId: request.context.regionId,
    businessWindow: request.context.businessWindow,
    sources: state.coverageSources?.[request.analysisId] ?? [],
    candidates: { ranges: [], discrete: false },
    note: '',
    mock: false,
    productionWrite: false,
  }
}

// ── 图表桩：绕开 ECharts canvas ─────────────────────────────────────────────────────────

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

// ── 能力目录与结果夹具（形状对照 dljy 仓 grid-views.mjs / sources.mjs）───────────────────

const BOUNDARY_SERIES = 'grid.boundary-series'
const TRANSFER_DAILY = 'grid.transfer-daily'
const CHANNEL_FLOWS = 'grid.channel-flows'
const RESERVE_UNITS = 'grid.reserve-units'
const UNIT_LISTS = 'grid.unit-lists'

const SOURCE_TITLES: Record<string, string> = {
  'csg.transfer.inter-provincial.forecast': '省间送受电（预测，按通道）',
  'csg.disclosure.stable-section': '稳定断面最大负载率（日）',
  'csg.disclosure.reserve.forecast': '正/负备用（预测，按区域）',
  'cgn.grid.tie-line.actual': '省间联络线实际（总送出/总受入）',
  'cgn.grid.key-channel.actual': '重点通道输电实际',
  'cgn.grid.key-line-transformer.actual': '重点线路与主变潮流实际',
  'cgn.grid.section-constraint.actual': '输电断面限值（正向/反向）',
  'cgn.grid.external-tie-line.forecast': '区外联络线计划',
  'cgn.grid.priority-limit.forecast': '省间优先送电电量下限（日）',
  'cgn.grid.transmission-capacity.forecast': '通道最大可用输电能力（日）',
  'cgn.grid.stable-section.actual': '稳定断面最大负载率（日，获权）',
  'cgn.grid.section-congestion.actual': '重载与越限断面数量（日）',
  'cgn.grid.load-summary.actual': '电网负荷总体情况（日，南网）',
  'cgn.reserve.peak.actual': '高峰备用容量实际（日，按区域）',
  'cgn.reserve.forecast': '正负备用预测（获权，按区域）',
  'cgn.units.non-da-new-energy-capacity': '不参与日前市场的新能源容量（日）',
  'cgn.units.maintenance-capacity': '机组检修容量（日，南方区域总值）',
  'cgn.units.price-weight': '机组分段价格权重（日）',
  'cgn.units.group-share': '机组群组成与出力占比（必开/最小方式等，按区域）',
  'cgn.units.peak-regulation': '是否开展调峰（日，按区域）',
  'cgn.units.must-run-stop': '必开必停机组清单（日）',
}

/** 序列目录条目（seriesId = 来源|字段|…维度值，与后端 captureRowsToSeries 同构）。 */
function gridSeries(args: {
  sourceId: string
  unit: string
  fieldId?: string
  dimensions?: Record<string, string>
  variant?: string
}) {
  const dims = args.dimensions ?? {}
  return {
    seriesId: [args.sourceId, args.fieldId ?? 'value', ...Object.values(dims)].join('|'),
    sourceId: args.sourceId,
    fieldId: args.fieldId ?? 'value',
    unit: args.unit,
    measureKind: 'power',
    dimensions: dims,
    businessScope: 'csg-multi-region',
    resolutionMinutes: 1440,
    nativeResolutionMinutes: 1440,
    priceObject: null,
    marketPhase: null,
    variant: args.variant ?? 'actual',
  }
}

function boundarySeriesResult(request: any) {
  const first = gridSeries({ sourceId: 'csg.transfer.inter-provincial.forecast', unit: 'MWh', dimensions: { category: '云南送出电量' }, variant: 'forecast' })
  const second = gridSeries({ sourceId: 'csg.disclosure.reserve.forecast', unit: 'MW', dimensions: { region: '云南', reserveType: '正备用' }, variant: 'forecast' })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: BOUNDARY_SERIES,
    sourceRefs: [
      { sourceId: 'csg.transfer.inter-provincial.forecast', accessScope: 'public' },
      { sourceId: 'csg.disclosure.reserve.forecast', accessScope: 'public' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'by-series' }],
      rows: [
        // 方向与符号原样保留：送出为正、受入（外购回落）可以为负
        { seriesId: first.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '6120' },
        { seriesId: second.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '-140.5' },
      ],
      series: [first, second],
    },
  })
}

function transferDailyResult(request: any) {
  const limit = gridSeries({ sourceId: 'cgn.grid.priority-limit.forecast', unit: 'MWh', dimensions: { category: '云电送广东' }, variant: 'forecast' })
  const capacity = gridSeries({ sourceId: 'cgn.grid.transmission-capacity.forecast', unit: 'MW', dimensions: { channel: '昆柳龙直流' }, variant: 'forecast' })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: TRANSFER_DAILY,
    sourceRefs: [
      { sourceId: 'cgn.grid.priority-limit.forecast', accessScope: 'company' },
      { sourceId: 'cgn.grid.transmission-capacity.forecast', accessScope: 'company' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'by-series' }],
      rows: [
        { seriesId: limit.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '9800' },
        { seriesId: capacity.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '3000' },
      ],
      series: [limit, capacity],
    },
  })
}

const CHANNEL_FLOW_SERIES = 'cgn.grid.key-channel.actual|value|昆柳龙直流'

function channelSeriesResult(request: any) {
  const flow = gridSeries({ sourceId: 'cgn.grid.key-channel.actual', unit: 'MW', dimensions: { channel: '昆柳龙直流' } })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: CHANNEL_FLOWS,
    sourceRefs: [{ sourceId: 'cgn.grid.key-channel.actual', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [
        // 15 分钟潮流，正负号是方向
        { seriesId: flow.seriesId, intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T10:15:00+08:00', value: '873.5' },
        { seriesId: flow.seriesId, intervalStart: '2026-09-17T10:15:00+08:00', intervalEnd: '2026-09-17T10:30:00+08:00', value: '-25.25' },
      ],
      series: [flow],
    },
  })
}

function limitMatchResult(request: any, opts?: { paired?: boolean }) {
  if (opts?.paired === false) {
    return insightResult({
      contextVersion: request.context.contextVersion,
      analysisId: CHANNEL_FLOWS,
      sourceRefs: [{ sourceId: 'cgn.grid.tie-line.actual', accessScope: 'company' }],
      data: {
        schemaVersion: 'insight-result-data/v1',
        dimensions: [{ id: 'seriesId', kind: 'category' }],
        measures: [{ id: 'value', unit: 'MW' }],
        rows: [],
        series: [],
        unpaired: [
          { seriesId: 'cgn.grid.tie-line.actual|value|云南|天广直流', reason: '没有同名通道的断面限值，不计算裕度与负载率' },
          { seriesId: 'limit:昆柳龙直流(昆北)', reason: '有断面限值但没有同名通道的实际流量（名称近似的不自动匹配）' },
        ],
        tables: { summary: { rows: [] } },
        notes: [{ note: '只在同名通道、同一时段、同一业务范围与量纲下配对；名称近似的不自动匹配。' }],
      },
    })
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: CHANNEL_FLOWS,
    sourceRefs: [
      { sourceId: 'cgn.grid.key-channel.actual', accessScope: 'company' },
      { sourceId: 'cgn.grid.section-constraint.actual', accessScope: 'company' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
        { id: 'bindingSide', kind: 'category' },
      ],
      measures: [
        { id: 'value', unit: 'MW' },
        { id: 'flow', unit: 'MW' },
        { id: 'upperLimit', unit: 'MW' },
        { id: 'lowerLimit', unit: 'MW' },
        { id: 'loadRate', unit: '%' },
      ],
      rows: [
        {
          seriesId: `margin:${CHANNEL_FLOW_SERIES}`,
          intervalStart: '2026-09-17T10:00:00+08:00',
          intervalEnd: '2026-09-17T10:15:00+08:00',
          bindingSide: 'upper',
          value: '126.5',
          upperMargin: '126.5',
          lowerMargin: '1201.5',
          loadRate: '82.6',
          flow: '873.5',
          upperLimit: '1000',
          lowerLimit: '-328',
        },
      ],
      series: [
        {
          seriesId: `margin:${CHANNEL_FLOW_SERIES}`,
          kind: 'limit-match',
          channel: '昆柳龙直流',
          flowSeriesId: CHANNEL_FLOW_SERIES,
          flowSourceId: 'cgn.grid.key-channel.actual',
          upperLimitSeriesId: 'cgn.grid.section-constraint.actual|value|昆柳龙直流|正向限值',
          lowerLimitSeriesId: 'cgn.grid.section-constraint.actual|value|昆柳龙直流|反向限值',
          unit: 'MW',
          businessScope: 'csg-aggregate',
        },
      ],
      tables: {
        summary: {
          rows: [
            { seriesId: `margin:${CHANNEL_FLOW_SERIES}`, metricId: 'sample.matched-hours', value: '24' },
            { seriesId: `margin:${CHANNEL_FLOW_SERIES}`, metricId: 'grid.outside-limit-hours', value: '0.25' },
            { seriesId: `margin:${CHANNEL_FLOW_SERIES}`, metricId: 'grid.limit-margin-minimum', value: '-3.5', atIntervalStart: '2026-09-17T18:00:00+08:00', bindingSide: 'upper' },
            { seriesId: `margin:${CHANNEL_FLOW_SERIES}`, metricId: 'grid.limit-load-rate-maximum', value: '100.4', atIntervalStart: '2026-09-17T18:00:00+08:00' },
          ],
        },
      },
      notes: [{ note: '正向限值是实际流量的上界，反向限值是下界；正负号原样保留、不取绝对值。' }],
    },
  })
}

function reserveUnitsResult(request: any) {
  const peak = gridSeries({ sourceId: 'cgn.reserve.peak.actual', unit: 'MW', dimensions: { region: '云南' } })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: RESERVE_UNITS,
    sourceRefs: [{ sourceId: 'cgn.reserve.peak.actual', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [
        { seriesId: peak.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '1230.5' },
      ],
      series: [peak],
    },
  })
}

function unitListsResult(request: any) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: UNIT_LISTS,
    sourceRefs: [
      { sourceId: 'cgn.units.peak-regulation', accessScope: 'company' },
      { sourceId: 'cgn.units.must-run-stop', accessScope: 'company' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'sourceId', kind: 'category' },
        { id: 'date', kind: 'date' },
        { id: 'region', kind: 'category' },
        { id: 'plant', kind: 'category' },
        { id: 'unit', kind: 'category' },
        { id: 'mode', kind: 'category' },
      ],
      measures: [{ id: 'value', unit: 'text' }],
      // recordsView 形状：来源 + 业务日 + 维度平铺 + 记录内容；不是时序，没有 interval 列
      rows: [
        { sourceId: 'cgn.units.peak-regulation', date: '2026-09-17', region: '云南', flag: '是', value: '是' },
        { sourceId: 'cgn.units.must-run-stop', date: '2026-09-17', region: '云南', plant: '某电厂', unit: '1 号机', mode: '必开', value: '必开' },
      ],
      series: [],
    },
  })
}

function defaultResponder(request: any): Promise<any> {
  if (request.analysisId === CHANNEL_FLOWS) {
    return Promise.resolve(request.filters?.view === 'limit-match' ? limitMatchResult(request) : channelSeriesResult(request))
  }
  if (request.analysisId === TRANSFER_DAILY) return Promise.resolve(transferDailyResult(request))
  if (request.analysisId === RESERVE_UNITS) return Promise.resolve(reserveUnitsResult(request))
  if (request.analysisId === UNIT_LISTS) return Promise.resolve(unitListsResult(request))
  return Promise.resolve(boundarySeriesResult(request))
}

const DEFAULT_COVERAGE_SOURCES: Record<string, Array<{ sourceId: string; objects?: string[]; objectsNote?: string }>> = {
  [CHANNEL_FLOWS]: [
    { sourceId: 'cgn.grid.tie-line.actual', objects: ['昆柳龙直流', '天广直流'] },
    { sourceId: 'cgn.grid.key-channel.actual', objects: ['西电东送交流通道', '昆柳龙直流'] },
    { sourceId: 'cgn.grid.section-constraint.actual', objects: ['昆柳龙直流'] },
  ],
  [RESERVE_UNITS]: [
    { sourceId: 'cgn.reserve.peak.actual', objects: ['云南', '广东'] },
    { sourceId: 'cgn.units.group-share', objects: ['31 家水电'] },
  ],
  [UNIT_LISTS]: [
    { sourceId: 'cgn.units.peak-regulation', objects: ['云南'] },
    { sourceId: 'cgn.units.must-run-stop', objects: ['某电厂'] },
  ],
}

function gridCaps(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['grid-boundaries'],
      access: analysisId === BOUNDARY_SERIES ? 'public' : 'company',
      sourceIds: Object.keys(SOURCE_TITLES),
      limits:
        analysisId === CHANNEL_FLOWS
          ? { maxDays: 7, maxObjects: 30, requiresObjects: true }
          : analysisId === BOUNDARY_SERIES || analysisId === TRANSFER_DAILY
            ? { maxDays: 31, maxObjects: 0, requiresObjects: false }
            : { maxDays: 31, maxObjects: 50, requiresObjects: true },
    })),
    sources: Object.entries(SOURCE_TITLES).map(([sourceId, title]) => ({
      sourceId,
      title,
      businessScope: sourceId.startsWith('cgn.') ? 'csg-multi-region' : 'csg-aggregate',
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

const PUBLIC_CAPS = [BOUNDARY_SERIES]
const ENTITLED_CAPS = [BOUNDARY_SERIES, TRANSFER_DAILY, CHANNEL_FLOWS, RESERVE_UNITS, UNIT_LISTS]

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanGridBoundariesPage, {
    global: {
      plugins: [router],
      stubs: { InsightSeriesChart: InsightSeriesChartStub },
    },
  })
  await flushPromises()
  return wrapper
}

function queryCallsOf(predicate: (request: any) => boolean) {
  return vi.mocked(queryInsight).mock.calls.filter(([request]) => predicate(request))
}

function coverageCallsOf(analysisId: string) {
  return vi.mocked(fetchInsightCoverage).mock.calls.filter(([request]) => (request as any).analysisId === analysisId)
}

function pickers(): VueWrapper<any>[] {
  return wrapper!.findAllComponents(InsightObjectPicker) as unknown as VueWrapper<any>[]
}

/** 按标题找区块（Element Plus 会保留非激活页签的已渲染内容，按块断言才准确）。 */
function blockOf(title: string) {
  return wrapper!.findAll('section').find((section) => {
    const head = section.find('h3')
    return head.exists() && head.text() === title
  })
}

async function switchTab(name: string) {
  wrapper!.getComponent({ name: 'ElTabs' }).vm.$emit('tab-change', name)
  await flushPromises()
}

async function setWindow(start: string, end: string) {
  wrapper!.getComponent(InsightDateRange).vm.$emit('update:modelValue', { start, end })
  await flushPromises()
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
  state.capabilities = gridCaps(ENTITLED_CAPS)
  state.responder = defaultResponder
  state.coverageSources = DEFAULT_COVERAGE_SOURCES
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(fetchInsightCoverage).mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('送受电页签', () => {
  it('公开背景曲线与获权逐日送电都按明细视图查询：view=series、不带 objectIds（无对象维度）', async () => {
    await mountPage()

    const boundary = queryCallsOf((request) => request.analysisId === BOUNDARY_SERIES)
    expect(boundary).toHaveLength(1)
    expect(boundary[0]![0]!.filters!.view).toBe('series')
    expect(boundary[0]![0]!.filters!.objectIds).toBeUndefined()

    const transfer = queryCallsOf((request) => request.analysisId === TRANSFER_DAILY)
    expect(transfer).toHaveLength(1)
    expect(transfer[0]![0]!.filters!.view).toBe('series')
    expect(transfer[0]![0]!.filters!.objectIds).toBeUndefined()
  })

  it('公共账号：不渲染获权区块、不发获权查询与覆盖请求，三个页签各给「获权数据需开通」说明', async () => {
    state.capabilities = gridCaps(PUBLIC_CAPS)
    await mountPage()
    await switchTab('channel')
    await switchTab('reserve')

    expect(queryCallsOf((request) => request.analysisId === TRANSFER_DAILY)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === RESERVE_UNITS)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === UNIT_LISTS)).toHaveLength(0)
    expect(vi.mocked(fetchInsightCoverage).mock.calls).toHaveLength(0)

    const text = wrapper!.text()
    expect(text).toContain('获权数据需开通')
    expect(text).toContain('逐日送电电量与通道能力')
    expect(text).not.toContain('限值配对与裕度（获权）')
    expect(text).not.toContain('备用与检修容量（获权）')
    expect(text).not.toContain('必开必停清单（获权）')
  })

  it('单区块失败不影响其他区块：背景曲线读取失败时逐日送电照常渲染', async () => {
    state.responder = (request) => {
      if (request.analysisId === BOUNDARY_SERIES) {
        return Promise.reject(new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' }))
      }
      return defaultResponder(request)
    }
    await mountPage()

    const text = wrapper!.text()
    expect(text).toContain('资料读取失败') // 背景曲线区块的错误提示
    expect(text).toContain('重试')
    expect(text).toContain('逐日口径') // 获权区块的固定说明在
    expect(text).toContain('9800') // 逐日送电电量明细照常渲染
  })
})

describe('通道断面页签', () => {
  it('coverage 未给 objects（老后端）时：显示「无法列出」、选择器禁用、不发任何查询', async () => {
    state.coverageSources = {
      [CHANNEL_FLOWS]: [{ sourceId: 'cgn.grid.tie-line.actual' }],
    }
    await mountPage()
    await switchTab('channel')

    expect(wrapper!.text()).toContain('对象清单需要新版洞察服务，当前无法列出')
    expect(pickers()[0]!.props('disabled')).toBe(true)
    expect(pickers()[0]!.props('options')).toEqual([])
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(0)
  })

  it('objects 为空数组是「窗口内没有对象」：如实说明，不伪造选项也不发查询', async () => {
    state.coverageSources = {
      [CHANNEL_FLOWS]: [{ sourceId: 'cgn.grid.tie-line.actual', objects: [] }],
    }
    await mountPage()
    await switchTab('channel')

    expect(wrapper!.text()).toContain('所选窗口内没有可选对象')
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(0)
  })

  it('objects 在时选项取各来源并集；未选对象不发请求；覆盖请求不带 objectIds', async () => {
    await mountPage()
    await switchTab('channel')

    const picker = pickers()[0]!
    const options = picker.props('options') as Array<{ id: string }>
    expect(options.map((option) => option.id)).toEqual(['昆柳龙直流', '天广直流', '西电东送交流通道'])

    const coverageCalls = coverageCallsOf(CHANNEL_FLOWS)
    expect(coverageCalls).toHaveLength(1)
    expect((coverageCalls[0]![0] as any).filters?.objectIds).toBeUndefined()
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(0)
    expect(wrapper!.text()).toContain('请先选择通道或断面')
  })

  it('objectsNote（清单截断说明）原文透出', async () => {
    state.coverageSources = {
      [CHANNEL_FLOWS]: [{ sourceId: 'cgn.grid.tie-line.actual', objects: ['昆柳龙直流'], objectsNote: '窗口内对象超过 200 个，仅列前 200 个（按名称排序）' }],
    }
    await mountPage()
    await switchTab('channel')

    expect(wrapper!.text()).toContain('窗口内对象超过 200 个，仅列前 200 个（按名称排序）')
  })

  it('选定对象后 series 与 limit-match 各查一次、都带 objectIds；曲线出现', async () => {
    await mountPage()
    await switchTab('channel')

    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流', '天广直流'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call[0]!.filters!.view).sort()).toEqual(['limit-match', 'series'])
    for (const call of calls) {
      expect(call[0]!.filters!.objectIds).toEqual(['昆柳龙直流', '天广直流'])
    }
    // 通道潮流区块有一条曲线（送受电页签的两个图是已访问页签的残留渲染，不算）
    expect(blockOf('通道潮流（获权）')!.findAll('.series-chart-stub')).toHaveLength(1)
  })

  it('limit-match 配对表渲染：正负号原样（-328 / -3.5）、按通道统计卡、notes 原文', async () => {
    await mountPage()
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流'])
    await flushPromises()

    const table = wrapper!.find('[data-testid="ygb-limit-table"]')
    expect(table.exists()).toBe(true)
    const labels = wrapper!
      .findAllComponents({ name: 'ElTableColumn' })
      .map((column) => String(column.props('label') ?? ''))
    expect(labels).toContain('正向限值（MW）')
    expect(labels).toContain('反向限值（MW）')
    expect(labels).toContain('裕度（MW，负为超出）')
    const text = table.text()
    expect(text).toContain('873.5')
    expect(text).toContain('1000')
    expect(text).toContain('-328') // 反向限值为负：原样显示，不取绝对值
    expect(text).toContain('126.5')
    expect(text).toContain('82.6')
    expect(wrapper!.text()).toContain('昆柳龙直流 · 限值对比统计')
    expect(wrapper!.text()).toContain('-3.5') // 最小裕度为负：原样显示
    expect(wrapper!.text()).toContain('100.4')
    expect(wrapper!.text()).toContain('配对时长')
    expect(wrapper!.text()).toContain('正向限值是实际流量的上界，反向限值是下界')
  })

  it('无配对时逐条展示后端原因、不渲染配对表（无虚假裕度）', async () => {
    state.responder = (request) => {
      if (request.analysisId === CHANNEL_FLOWS && request.filters?.view === 'limit-match') {
        return Promise.resolve(limitMatchResult(request, { paired: false }))
      }
      return defaultResponder(request)
    }
    await mountPage()
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['天广直流'])
    await flushPromises()

    expect(wrapper!.find('[data-testid="ygb-limit-table"]').exists()).toBe(false)
    const text = wrapper!.text()
    expect(text).toContain('未配对')
    expect(text).toContain('没有同名通道的断面限值，不计算裕度与负载率')
    expect(text).toContain('有断面限值但没有同名通道的实际流量（名称近似的不自动匹配）')
    expect(text).toContain('没有配对上的时段')
  })

  it('窗口超过 7 天：通道查询被前置拦截并给出缩窗提示；缩短窗口后恢复查询', async () => {
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10') // 10 天 > 通道断面上限 7 天
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流'])
    await flushPromises()

    expect(wrapper!.text()).toContain('通道断面分析一次最多查 7 天')
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(0)

    await setWindow('2026-09-15', '2026-09-17')
    const calls = queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)
    expect(calls).toHaveLength(2)
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['昆柳龙直流'])
  })
})

describe('备用机组页签', () => {
  it('记录视图按表格呈现且不画曲线：unit-lists 查询 view=records，记录行与维度列齐全', async () => {
    await mountPage()
    await switchTab('reserve')

    expect(queryCallsOf((request) => request.analysisId === RESERVE_UNITS)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === UNIT_LISTS)).toHaveLength(0)

    const two = pickers()
    expect(two).toHaveLength(2)
    two[0]!.vm.$emit('update:modelValue', ['云南'])
    two[1]!.vm.$emit('update:modelValue', ['云南'])
    await flushPromises()

    const lists = queryCallsOf((request) => request.analysisId === UNIT_LISTS)
    expect(lists).toHaveLength(1)
    expect(lists[0]![0]!.filters!.view).toBe('records')
    expect(lists[0]![0]!.filters!.objectIds).toEqual(['云南'])

    const reserve = queryCallsOf((request) => request.analysisId === RESERVE_UNITS)
    expect(reserve).toHaveLength(1)
    expect(reserve[0]![0]!.filters!.view).toBe('series')
    expect(reserve[0]![0]!.filters!.objectIds).toEqual(['云南'])

    // 备用容量有序列图 + 明细表；记录只有表格，本区块不出现图表
    expect(wrapper!.text()).toContain('1230.5')
    const recordsTable = wrapper!.find('[data-testid="ygb-records-table"]')
    expect(recordsTable.exists()).toBe(true)
    expect(recordsTable.text()).toContain('必开')
    expect(recordsTable.text()).toContain('某电厂')
    const labels = wrapper!
      .findAllComponents({ name: 'ElTableColumn' })
      .map((column) => String(column.props('label') ?? ''))
    expect(labels).toContain('业务日')
    expect(labels).toContain('清单')
    expect(labels).toContain('必开/必停')
    expect(labels).toContain('是否调峰')
    expect(blockOf('备用与检修容量（获权）')!.findAll('.series-chart-stub')).toHaveLength(1)
    expect(blockOf('是否开展调峰与必开必停清单（获权）')!.findAll('.series-chart-stub')).toHaveLength(0)
    expect(wrapper!.text()).toContain('记录不是时序曲线')
  })
})

describe('状态与展示纪律', () => {
  it('页签懒加载：切走再切回不重查（同签名）', async () => {
    await mountPage()
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流'])
    await flushPromises()
    const channelCallsBefore = queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS).length
    const coverageBefore = coverageCallsOf(CHANNEL_FLOWS).length

    await switchTab('reserve')
    await switchTab('channel')
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(channelCallsBefore)
    expect(coverageCallsOf(CHANNEL_FLOWS)).toHaveLength(coverageBefore)
  })

  it('窗口变化：查询与对象清单全部作废重查（迟到的旧响应不写进新状态）', async () => {
    await mountPage()
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流'])
    await flushPromises()
    expect(queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)).toHaveLength(2)

    // 窗口变化后：覆盖清单重列、查询重发，都带新窗口
    await setWindow('2026-09-10', '2026-09-11')

    expect(coverageCallsOf(CHANNEL_FLOWS)).toHaveLength(2)
    const calls = queryCallsOf((request) => request.analysisId === CHANNEL_FLOWS)
    expect(calls).toHaveLength(4)
    // 前两次是旧窗口、后两次是新窗口：新查询都带新窗口与既选对象
    expect(calls[0]![0]!.context!.businessWindow.start).not.toBe('2026-09-10')
    for (const call of calls.slice(2)) {
      expect(call[0]!.context!.businessWindow.start).toBe('2026-09-10')
      expect(call[0]!.filters!.objectIds).toEqual(['昆柳龙直流'])
    }
  })

  it('界面只出现业务语言：不出现来源标识、分析标识与内部字段原文', async () => {
    await mountPage()
    await switchTab('channel')
    pickers()[0]!.vm.$emit('update:modelValue', ['昆柳龙直流'])
    await flushPromises()
    await switchTab('reserve')
    const two = pickers()
    two[0]!.vm.$emit('update:modelValue', ['云南'])
    two[1]!.vm.$emit('update:modelValue', ['云南'])
    await flushPromises()

    const text = wrapper!.text()
    expect(text).not.toContain('cgn.grid')
    expect(text).not.toContain('cgn.reserve')
    expect(text).not.toContain('cgn.units')
    expect(text).not.toContain('csg.transfer')
    expect(text).not.toContain('csg.disclosure')
    expect(text).not.toContain('grid.channel-flows')
    expect(text).not.toContain('sourceId')
    expect(text).not.toContain('objectIds')
    expect(text).not.toContain('limit-match')
    expect(text).not.toContain('bindingSide')
  })
})

// ── 检修干预页签（#3092，任务 10.6，GB04—GB06、CH01）────────────────────────────────────
// 守什么不变量：
//   ⑨ 计划检修（maintenance）与实际干预（intervention,outage）两组分列不混，identity=annotate；
//   ⑩ 同一事件重复披露显示「第 N 版 / 共 M 版」；计数区分原始记录与独立事件；
//   ⑪ 只有业务日的记录如实标注时间口径（仅业务日期、起止「未提供」），不推断精确停复电；
//   ⑫ 联看同期价格只携带事件窗口（start/end query），页面固定写明不自动归因；无窗口不给入口；
//   ⑬ 已关联场站只来自对象接口的明确关系；404/空关系显示「同名不作为关联依据」；
//   ⑭ 角色门控与后端同源：无披露角色不发请求；三态（有数/无数/未接入）诚实呈现。
describe('检修干预页签（#3092）', () => {
  const PLAN_TITLE = '220 千伏禄高肇直流检修'
  const ACTUAL_TITLE = '某机组非计划停运'

  function eventFixture(overrides: Record<string, unknown> = {}) {
    return {
      eventId: 'evt-plan-1',
      providerId: 'csg-authorized-export',
      category: 'maintenance',
      title: PLAN_TITLE,
      summary: '计划检修：设备例行检修，期间降低送电能力',
      regionId: 'yunnan',
      spatialBinding: { kind: 'region', ref: null, label: '云南', coordinates: null },
      effectiveAt: '2026-09-17T08:00:00+08:00',
      expiresAt: '2026-09-17T20:00:00+08:00',
      publishedAt: null,
      businessDate: '2026-09-17',
      timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'planned', issues: [] },
      source: {
        file: 'tb_disclosure_forecast_maintenance_plan_part001.csv',
        recordId: 'r-1',
        url: null,
        sourceTable: 'tb_disclosure_forecast_maintenance_plan',
        sourceType: 'IMPORT',
        mock: false,
        productionWrite: false,
        dataAvailability: 'available',
        license: '授权导出包',
        originalLinkStatus: 'unknown',
      },
      confidence: 'verified-source-row',
      importedAt: '2026-09-18T02:00:00+08:00',
      ...overrides,
    }
  }

  function actualEventFixture() {
    return eventFixture({
      eventId: 'evt-actual-1',
      category: 'intervention',
      title: ACTUAL_TITLE,
      effectiveAt: '2026-09-18T10:30:00+08:00',
      expiresAt: '2026-09-18T21:00:00+08:00',
      businessDate: '2026-09-18',
      timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'actual', issues: [] },
    })
  }

  beforeEach(() => {
    router.addRoute({ path: '/insight/prices', component: { render: () => null } })
    state.role = 'TRADER'
    state.availability = 'available'
    maintenanceEventPoolValue = []
    disclosureOverview.value = {
      total: 0,
      countsByCategory: {},
      dayOnlyCount: 0,
      dayOnlyCountsByCategory: {},
      buckets: [],
      coverage: { from: null, to: null, total: 0, timeBasis: 'businessDate', publishedTimeKnown: 0, sourceImportedTimeKnown: 0, effectiveTimeKnown: 0 },
      bucket: 'day',
      identity: { rawCount: 9, identifiedRawCount: 9, distinctCount: 3, unidentifiedCount: 0 },
      dataAvailability: { status: 'available', reason: '', fallback: false },
    }
    disclosureObjectDetail.value = null
    disclosureObjectError.value = null
    vi.mocked(fetchGridDisclosureEvents).mockClear()
    vi.mocked(fetchGridDisclosureOverview).mockClear()
    vi.mocked(fetchGridObject).mockClear()
  })

  async function openMaintenanceTab() {
    await mountPage()
    await switchTab('maintenance')
  }

  function groupOf(kind: 'plan' | 'actual') {
    return wrapper!.find(`[data-testid="ygb-maintenance-${kind}"]`)
  }

  it('计划检修与实际干预两组各查一次、分列不混：category 与 identity=annotate 固定', async () => {
    maintenanceEventPoolValue = [eventFixture(), actualEventFixture()]
    await openMaintenanceTab()

    const calls = vi.mocked(fetchGridDisclosureEvents).mock.calls
    expect(calls).toHaveLength(2)
    const byCategory = calls.map(([params]) => String((params as any).category)).sort()
    expect(byCategory).toEqual(['intervention,outage', 'maintenance'])
    for (const [params] of calls) {
      expect((params as any).identity).toBe('annotate')
      expect(String((params as any).pageSize)).toBe('100')
    }
    expect(groupOf('plan').text()).toContain(PLAN_TITLE)
    expect(groupOf('plan').text()).not.toContain(ACTUAL_TITLE)
    expect(groupOf('actual').text()).toContain(ACTUAL_TITLE)
    expect(groupOf('actual').text()).not.toContain(PLAN_TITLE)
  })

  it('重复披露显示「第 N 版 / 共 M 版」，计数区分原始记录与独立事件（GB04）', async () => {
    maintenanceEventPoolValue = [eventFixture({ identity: { rule: 'source-interval', key: 'k-1', versions: 7, version: 2 } })]
    await openMaintenanceTab()

    const counts = wrapper!.find('[data-testid="ygb-maintenance-counts"]')
    expect(counts.text()).toContain('原始记录 9 条')
    expect(counts.text()).toContain('独立事件 3 条')
    expect(groupOf('plan').text()).toContain('第 2 版 / 共 7 版')

    // 身份不足保留未归并提示而不是猜测合并
    disclosureOverview.value = {
      ...disclosureOverview.value,
      identity: { rawCount: 11, identifiedRawCount: 9, distinctCount: 3, unidentifiedCount: 2 },
    }
    wrapper!.unmount()
    await openMaintenanceTab()
    expect(wrapper!.find('[data-testid="ygb-maintenance-counts"]').text()).toContain('2 条身份不足')
  })

  it('只有业务日的记录：起止如实「未提供」、时间口径「仅业务日期」，不推断精确停复电（GB04）', async () => {
    maintenanceEventPoolValue = [eventFixture({
      effectiveAt: null,
      expiresAt: null,
      timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: ['legacy-business-date-inferred'] },
      identity: undefined,
    })]
    await openMaintenanceTab()
    const text = groupOf('plan').text()
    expect(text).toContain('未提供')
    expect(text).toContain('仅业务日期')
    expect(text).not.toContain('08:00')
  })

  it('联看同期价格只携带事件窗口（start/end query），页面固定写明不自动归因（GB05、CH01）', async () => {
    maintenanceEventPoolValue = [eventFixture()]
    await openMaintenanceTab()
    await wrapper!.find('[data-testid="ygb-maintenance-detail-open"]').trigger('click')
    await flushPromises()

    expect(wrapper!.find('[data-testid="ygb-maintenance-detail"]').text()).toContain('不自动归因')
    await wrapper!.find('[data-testid="ygb-maintenance-compare"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/insight/prices')
    expect(router.currentRoute.value.query.start).toBe('2026-09-17')
    expect(router.currentRoute.value.query.end).toBe('2026-09-17')
  })

  it('只有业务日的事件也能联看：窗口就是该业务日（同一起止日）', async () => {
    maintenanceEventPoolValue = [eventFixture({
      effectiveAt: null,
      expiresAt: null,
      timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: [] },
    })]
    await openMaintenanceTab()
    await wrapper!.find('[data-testid="ygb-maintenance-detail-open"]').trigger('click')
    await flushPromises()
    await wrapper!.find('[data-testid="ygb-maintenance-compare"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.start).toBe('2026-09-17')
    expect(router.currentRoute.value.query.end).toBe('2026-09-17')
  })

  it('推不出业务窗口的事件：不给联看入口并说明原因（不猜测窗口）', async () => {
    maintenanceEventPoolValue = [eventFixture({
      businessDate: null,
      effectiveAt: null,
      expiresAt: null,
      timeQuality: { effective: 'unknown', published: 'unknown', intervalBasis: 'unknown', issues: ['invalid-effective-time'] },
    })]
    await openMaintenanceTab()
    await wrapper!.find('[data-testid="ygb-maintenance-detail-open"]').trigger('click')
    await flushPromises()

    expect(wrapper!.find('[data-testid="ygb-maintenance-compare"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="ygb-maintenance-detail"]').text()).toContain('无法联看同期价格')
  })

  it('已关联场站只认明确关系；无关系（404）时显示「同名不作为关联依据」（GB06）', async () => {
    maintenanceEventPoolValue = [eventFixture()]
    disclosureObjectDetail.value = {
      relations: { plants: [{ id: 'p-mw', name: '漫湾水电站', regionId: 'yunnan' }], nodes: [] },
    }
    await openMaintenanceTab()
    await wrapper!.find('[data-testid="ygb-maintenance-detail-open"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-testid="ygb-maintenance-plants"]').text()).toContain('漫湾水电站')
    expect(wrapper!.find('[data-testid="ygb-maintenance-no-plants"]').exists()).toBe(false)

    disclosureObjectDetail.value = null
    disclosureObjectError.value = new ApiError('未找到当前地区的披露对象', { status: 404, code: 404, payload: {} as never })
    wrapper!.unmount()
    await openMaintenanceTab()
    await wrapper!.find('[data-testid="ygb-maintenance-detail-open"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-testid="ygb-maintenance-plants"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="ygb-maintenance-no-plants"]').text()).toContain('同名')
  })

  it('无披露读取角色：页签只给门控说明、不发披露请求（角色契约与后端同源）', async () => {
    state.role = 'AUDITOR'
    maintenanceEventPoolValue = [eventFixture()]
    await openMaintenanceTab()

    expect(wrapper!.find('[data-testid="ygb-maintenance-gated"]').exists()).toBe(true)
    expect(vi.mocked(fetchGridDisclosureEvents)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchGridDisclosureOverview)).not.toHaveBeenCalled()
  })

  it('三态诚实呈现：未接入与窗口内无记录分别给各自说明；窗口变化作废重查（新 from/to）', async () => {
    maintenanceEventPoolValue = [eventFixture()]
    await openMaintenanceTab()

    state.availability = 'not-configured'
    wrapper!.unmount()
    await openMaintenanceTab()
    expect(groupOf('plan').text()).toContain('公开披露事件库未接入当前地区')

    state.availability = 'missing'
    wrapper!.unmount()
    await openMaintenanceTab()
    expect(groupOf('plan').text()).toContain('没有已导入')

    // 窗口变化 → 两组按新窗口重查
    state.availability = 'available'
    wrapper!.unmount()
    await openMaintenanceTab()
    const before = vi.mocked(fetchGridDisclosureEvents).mock.calls.length
    await setWindow('2026-09-10', '2026-09-16')
    const calls = vi.mocked(fetchGridDisclosureEvents).mock.calls.slice(before)
    expect(calls).toHaveLength(2)
    for (const [params] of calls) {
      expect(String((params as any).from)).toBe('2026-09-10')
      expect(String((params as any).to)).toBe('2026-09-16')
    }
  })
})
