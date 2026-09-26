// YunnanPricesPage.component.spec.ts — 云南价格与价差页回归（dljy#3007 任务 6.5/6.6 第一部分）
// 守什么不变量（对照 specs yunnan-price-analysis）：
//   ① 价格对象只列能力目录可用的；公共账号看不到厂侧对象；切换是显式操作，查询失败不回落；
//   ② 节点类未选对象、基差未选参考对象：页面层拦截，不发请求；
//   ③ 用户侧价无节点维度：基差页签只显示固定说明；
//   ④ 参考对象只能从已选对象中选，被移出已选集合时清空；
//   ⑤ 不可用指标（负价电量占比）按后端原文如实标注，不显示成 0；集合权重口径原文展示；
//   ⑥ 指标显示按登记精度（126.666…→126.67）；
//   ⑦ 价差方向与异常规则固定文案；异常行点击生成语义选区（无 dataIndex/seriesIndex）；
//   ⑧ 422（只选一侧来源）直显后端文案；profile 窗口天数与有效天数如实、不冒充季节规律；
//   ⑨ 上下文变化后迟到结果不写进新状态；页签懒加载切回不重查；
//   ⑩ 界面只出现业务语言，不出现来源标识原文；
//   ⑪ 导出与材料入口（dljy#3078 任务 15.2/14.5）：时段走势/历史分布区块有「导出 CSV」与
//      「加入材料」；无公司写权限者只少材料入口（导出是只读动作）；材料窗口的冻结请求与
//      当前查询同口径（analysisId + view + objectIds），期望版本取自当前结果。
// mock 边界：insightClient（保留类型与错误类）/ spotClient / cgnYunnanLivePrice / review
// workpapers 客户端打桩；useInsightContext 用真 composable（真 router + 全局地区/公司 ref）。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import {
  fetchInsightCapabilities,
  queryInsight,
} from '@/services/insight/insightClient'
import { searchSpotNodes } from '@/services/market/spotClient'
import { getCurrentUser } from '@/services/auth'
import { beijingToday } from 'shared/midlong/dates.mjs'
import { sevenDayWindowEndingAt } from './prices/priceProfileModel'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightHistoryCandidates from '@/components/insight/InsightHistoryCandidates.vue'
import InsightMaterialDialog from '@/components/insight/InsightMaterialDialog.vue'
import InsightObjectPicker from '@/components/insight/InsightObjectPicker.vue'
import {
  captureInsightMaterial,
  getWorkpaper,
  listWorkpapers,
  saveWorkpaper,
} from '@/services/review/workpapers'
import {
  insightResult,
  nodePriceResult,
  nodePriceSeries,
  READ_SET_REF,
  RESULT_VERSION,
  row,
} from '@/components/insight/insightFixtures'
import { activeAiPage, resolveInterpret } from '@/features/aiSidebar/pageRegistry'
import YunnanPricesPage from './YunnanPricesPage.vue'

// ── 可控 mock 状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  responder: null as ((request: any) => Promise<any>) | null,
}))

vi.mock('@/composables/useAgentHealth', () => ({
  // 页面 AI 入口的探活打桩：不发起真实网络连接；AI 入口可见性按在线处理。
  useAgentHealth: () => ({ health: { value: 'online' }, ready: { value: true }, offline: { value: false }, check: async () => {} }),
}))

const geo = vi.hoisted(() => ({
  plants: vi.fn<() => Promise<any>>(),
  nodes: vi.fn<() => Promise<any>>(),
  object: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/services/insight/insightClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    queryInsight: vi.fn((request: any) => state.responder!(request)),
    fetchInsightCapabilities: vi.fn(() => Promise.resolve(state.capabilities)),
  }
})

vi.mock('@/features/gridGeo/client', () => ({
  fetchGridGeoPlants: geo.plants,
  fetchGridGeoNodes: geo.nodes,
  fetchGridObject: geo.object,
}))

vi.mock('@/services/market/spotClient', () => ({
  searchSpotNodes: vi.fn(async () => ({ count: 2, nodes: ['YN.KM.01', 'YN.KM.02'] })),
}))

vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  fetchCgnYunnanPriceBundle: vi.fn(async () => ({
    plants: { items: [{ plantName: '某光伏电站' }, { plantName: '某风电场' }] },
  })),
  hasCgnYunnanPriceEntitlement: () => false,
}))

// 材料窗口的复盘客户端打桩：默认成功形状，用例按需覆盖（入口显隐用例不触发调用）
vi.mock('@/services/review/workpapers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listWorkpapers: vi.fn(),
    getWorkpaper: vi.fn(),
    captureInsightMaterial: vi.fn(),
    saveWorkpaper: vi.fn(),
  }
})

// ── 图表桩：绕开 ECharts canvas；捕获 applySelection 调用（选区语义断言用）──────────────

const chartApplyCalls: Array<InsightSelection | null> = []

const InsightSeriesChartStub = defineComponent({
  name: 'InsightSeriesChart',
  props: {
    result: { type: Object, default: null },
    current: { type: Object, default: null },
    height: { type: Number, default: 320 },
  },
  emits: ['select'],
  setup(_props, { expose }) {
    expose({
      applySelection: (selection: InsightSelection | null) => {
        chartApplyCalls.push(selection)
      },
    })
  },
  render: () => h('div', { class: 'series-chart-stub' }),
})

const ChartCardStub = defineComponent({
  name: 'ChartCard',
  props: { title: { type: String, default: '' } },
  setup(props) {
    return () => h('div', { class: 'chart-card-stub' }, props.title)
  },
})

const Price3DSceneStub = defineComponent({
  name: 'Price3DScene',
  props: { lines: { type: Array, default: () => [] }, timePoints: { type: Array, default: () => [] }, dates: { type: Array, default: () => [] } },
  emits: ['initError', 'pointClick'],
  render: () => h('div', { class: 'price-3d-scene-stub' }),
})

// ── 结果夹具（形状对照 dljy 仓 price-views.mjs；contextVersion 跟随页面请求）────────────

const SPREAD_ANOMALY_RULE = '按价差绝对值从大到小，最多 20 个时段；同值按时间先后、再按对象排列。只是排序，不是官方异常认定。'
const SPREAD_ONE_SIDE_422 = '日前实时价差需要同时读取日前与实时两类价格，请在来源里同时选择'
const UNAVAILABLE_NEGATIVE_ENERGY = '没有同对象同区间的电量，不计算负价电量占比'
const SET_WEIGHT_NOTE = '每个节点每个有效时段等权；不是电量加权，也不是全省结算价'
const PLANT_BINDING_NOTE = '场站与节点的关系取自当前绑定，没有生效期；历史日期上的关系是按当前映射的观察，不是已认证的历史关系。'

function seriesResult(request: any) {
  return nodePriceResult(['300.5'], { contextVersion: request.context.contextVersion })
}

function summaryResult(request: any) {
  const set = {
    seriesId: 'set:yn.price.node.public.day-ahead',
    kind: 'object-set',
    sourceId: 'yn.price.node.public.day-ahead',
    unit: 'by-metric',
    priceObject: 'public-node',
    marketPhase: 'day-ahead',
    dimensions: {},
    memberSeriesIds: ['ser-node-1'],
    weightRule: 'equal-object-slot',
    weightNote: SET_WEIGHT_NOTE,
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId: 'ser-node-1', metricId: 'price.time-weighted-average', value: '126.666666666667' },
        { seriesId: 'ser-node-1', metricId: 'price.minimum', value: '50', atIntervalStart: '2026-09-10T03:00:00+08:00' },
        { seriesId: 'ser-node-1', metricId: 'price.maximum', value: '400', atIntervalStart: '2026-09-10T19:00:00+08:00' },
        { seriesId: 'ser-node-1', metricId: 'price.negative-duration', value: '2.5' },
        { seriesId: 'ser-node-1', metricId: 'sample.valid-hours', value: '24' },
        { seriesId: set.seriesId, metricId: 'sample.object-count', value: '1' },
        { seriesId: set.seriesId, metricId: 'sample.series-count', value: '1' },
        { seriesId: set.seriesId, metricId: 'price.node-set-equal-weight-average', value: '126.67' },
        { seriesId: set.seriesId, metricId: 'sample.valid-hours', value: '24' },
      ],
      series: [nodePriceSeries(), set],
      unavailableMetrics: [
        { metricId: 'price.negative-energy-ratio', reason: UNAVAILABLE_NEGATIVE_ENERGY },
      ],
    },
  })
}

function spreadResult(request: any) {
  const pair = {
    seriesId: 'spread:public-node:YN.KM.01',
    kind: 'da-rt-spread',
    direction: 'day-ahead-minus-real-time',
    unit: 'yuan/MWh',
    priceObject: 'public-node',
    marketPhase: null,
    dimensions: { nodeName: 'YN.KM.01' },
    dayAheadSeriesId: 'ser-node-1',
    realTimeSeriesId: 'ser-node-2',
    resolutionMinutes: 15,
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
      measures: [{ id: 'value', unit: 'yuan/MWh' }],
      rows: [row(pair.seriesId, '2026-09-10T10:00:00+08:00', '2026-09-10T10:15:00+08:00', '88.25')],
      series: [pair],
      tables: {
        summary: {
          rows: [
            { seriesId: pair.seriesId, metricId: 'sample.common-hours', value: '24' },
            { seriesId: pair.seriesId, metricId: 'sample.day-ahead-valid-hours', value: '24' },
            { seriesId: pair.seriesId, metricId: 'sample.real-time-valid-hours', value: '24' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread', value: '12.5' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-abs-mean', value: '30.25' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-maximum', value: '88.25', atIntervalStart: '2026-09-10T10:00:00+08:00' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-minimum', value: '-20', atIntervalStart: '2026-09-10T03:00:00+08:00' },
            { seriesId: pair.seriesId, metricId: 'price.da-rt-spread-positive-share', value: '62.5' },
          ],
        },
        anomalies: {
          rule: SPREAD_ANOMALY_RULE,
          rows: [
            { seriesId: pair.seriesId, intervalStart: '2026-09-10T10:00:00+08:00', intervalEnd: '2026-09-10T10:15:00+08:00', value: '88.25', rank: '1' },
          ],
        },
      },
      unpaired: [],
    },
  })
}

/** 长表行（多日立体/热力/双切面消费）：15 分钟时段 + 业务日 + 时点。 */
function profileRow(seriesId: string, date: string, timeOfDay: string, value: string) {
  const [h0, m0] = timeOfDay.split(':').map(Number)
  const endMinutes = h0! * 60 + m0! + 15
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return { seriesId, date, timeOfDay, intervalStart: `${date}T${timeOfDay}:00+08:00`, intervalEnd: `${date}T${endTime}:00+08:00`, value }
}

function profileResult(request: any) {
  const second = nodePriceSeries({ seriesId: 'ser-node-2', dimensions: { nodeName: 'YN.KM.02' }, marketPhase: 'real-time', sourceId: 'yn.price.node.public.real-time' })
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'date', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'yuan/MWh' }],
      // 长表：两个业务日 × 日前(ser-node-1)/实时(ser-node-2)，缺测=行不存在（09-11 实时 00:15 缺、含负价）
      rows: [
        profileRow('ser-node-1', '2026-09-10', '00:00', '210.5'),
        profileRow('ser-node-1', '2026-09-10', '00:15', '220'),
        profileRow('ser-node-2', '2026-09-10', '00:00', '205.25'),
        profileRow('ser-node-2', '2026-09-10', '00:15', '215'),
        profileRow('ser-node-1', '2026-09-11', '00:00', '150'),
        profileRow('ser-node-1', '2026-09-11', '00:15', '140'),
        profileRow('ser-node-2', '2026-09-11', '00:00', '155'),
        profileRow('ser-node-2', '2026-09-11', '00:15', '-12.5'),
      ],
      series: [nodePriceSeries(), second],
      tables: {
        daily: {
          rows: [
            { seriesId: 'ser-node-1', date: '2026-09-10', metricId: 'price.time-weighted-average', value: '210.5' },
            { seriesId: 'ser-node-1', date: '2026-09-11', metricId: 'price.time-weighted-average', value: '220.5' },
            { seriesId: 'ser-node-2', date: '2026-09-10', metricId: 'price.time-weighted-average', value: '205' },
          ],
        },
        timeOfDay: {
          rows: [
            { seriesId: 'ser-node-1', timeOfDay: '00:00', metricId: 'price.time-weighted-average', value: '200' },
            { seriesId: 'ser-node-1', timeOfDay: '01:00', metricId: 'price.time-weighted-average', value: '202' },
          ],
        },
      },
    },
  })
}

function basisResult(request: any) {
  const entry = {
    seriesId: 'basis:public-node:YN.KM.02',
    kind: 'node-basis',
    unit: 'yuan/MWh',
    priceObject: 'public-node',
    marketPhase: 'day-ahead',
    dimensions: { nodeName: 'YN.KM.02' },
    baseSeriesId: 'ser-node-2',
    referenceSeriesId: 'ser-node-1',
    referenceObjectId: 'YN.KM.01',
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
      measures: [{ id: 'value', unit: 'yuan/MWh' }],
      rows: [row(entry.seriesId, '2026-09-10T00:00:00+08:00', '2026-09-10T01:00:00+08:00', '5.5')],
      series: [entry],
      tables: {
        summary: {
          rows: [
            { seriesId: entry.seriesId, metricId: 'sample.common-hours', value: '24' },
            { seriesId: entry.seriesId, metricId: 'price.node-basis', value: '5.5' },
            { seriesId: entry.seriesId, metricId: 'price.node-basis-minimum', value: '-2', atIntervalStart: '2026-09-10T03:00:00+08:00' },
            { seriesId: entry.seriesId, metricId: 'price.node-basis-maximum', value: '12', atIntervalStart: '2026-09-10T19:00:00+08:00' },
          ],
        },
      },
      notes: [{ sourceId: 'yn.price.node.public.day-ahead', note: PLANT_BINDING_NOTE }],
      unpaired: [{ seriesId: 'ser-node-3', reason: '参考对象在该来源这段日期没有资料' }],
    },
  })
}

function defaultResponder(request: any): Promise<any> {
  switch (request.filters?.view) {
    case 'summary':
      return Promise.resolve(summaryResult(request))
    case 'spread':
      return Promise.resolve(spreadResult(request))
    case 'profile':
      return Promise.resolve(profileResult(request))
    case 'basis':
      return Promise.resolve(basisResult(request))
    default:
      return Promise.resolve(seriesResult(request))
  }
}

function capsWith(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['prices'],
      access: 'public',
      sourceIds: ['yn.price.node.public.day-ahead', 'yn.price.node.public.real-time'],
      limits: { maxDays: 31, maxObjects: 50, requiresObjects: analysisId !== 'prices.user-series' },
    })),
    sources: [
      { sourceId: 'yn.price.node.public.day-ahead', title: '公开历史节点价·日前', accessScope: 'public' },
      { sourceId: 'yn.price.node.public.real-time', title: '公开历史节点价·实时', accessScope: 'public' },
    ],
    endpoints: {},
    mock: false,
    productionWrite: false,
  }
}

const ALL_ANALYSES = [
  'prices.user-series',
  'prices.public-node-series',
  'prices.company-node-series',
  'prices.plant-node-series',
]

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanPricesPage, {
    global: {
      plugins: [router],
      stubs: { InsightSeriesChart: InsightSeriesChartStub, ChartCard: ChartCardStub, Price3DScene: Price3DSceneStub },
    },
  })
  await flushPromises()
  return wrapper
}

function queryCallsOf(predicate: (request: any) => boolean) {
  return vi.mocked(queryInsight).mock.calls.filter(([request]) => predicate(request))
}

// VTU 对字符串选择器返回弱类型（无 vm/props），统一断言回 VueWrapper。
function priceObjectSelect(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="ynp-price-object"]') as unknown as VueWrapper<any>
}

function basisReferenceSelect(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="ynp-basis-reference"]') as unknown as VueWrapper<any>
}

async function choosePriceObject(analysisId: string) {
  priceObjectSelect().vm.$emit('change', analysisId)
  await flushPromises()
}

async function switchTab(name: string) {
  wrapper!.getComponent({ name: 'ElTabs' }).vm.$emit('tab-change', name)
  await flushPromises()
}

async function chooseObjects(...ids: string[]) {
  wrapper!.getComponent(InsightObjectPicker).vm.$emit('update:modelValue', ids)
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
    // 兜底路由：业务模块只读深链用例要真实 push 到 /data-ops/console（dljy#3096）
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/:pathMatch(.*)*', component: { render: () => null } },
    ],
  })
  await router.push('/')
  state.capabilities = capsWith(ALL_ANALYSES)
  state.responder = defaultResponder
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(searchSpotNodes).mockClear()
  vi.mocked(listWorkpapers).mockClear()
  vi.mocked(getWorkpaper).mockClear()
  vi.mocked(captureInsightMaterial).mockClear()
  vi.mocked(saveWorkpaper).mockClear()
  chartApplyCalls.length = 0
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('价格对象目录', () => {
  it('只列能力目录可用的对象：公共账号只有用户侧与公开节点两个选项，默认第一个，不出现厂侧对象', async () => {
    state.capabilities = capsWith(['prices.user-series', 'prices.public-node-series'])
    await mountPage()

    const options = priceObjectSelect().findAllComponents({ name: 'ElOption' })
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.props('label'))).toEqual(['用户侧价格', '公开历史节点价'])
    // 默认选第一个可用对象（用户侧价，无对象维度，直接查询）
    expect(priceObjectSelect().props('modelValue')).toBe('prices.user-series')
    expect(queryCallsOf((request) => request.analysisId === 'prices.user-series')).toHaveLength(2)
  })

  it('节点类对象未选时不发任何查询；选完对象后查询携带 filters.objectIds', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()

    expect(queryInsight).not.toHaveBeenCalled()
    expect(wrapper!.text()).toContain('请先选择节点或场站')

    await chooseObjects('YN.KM.01')
    const calls = queryCallsOf((request) => request.filters?.view === 'series')
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['YN.KM.01'])
  })

  it('切换价格对象后查询失败：保持所选对象不自动回落，显示读取失败，不替用户改查公开节点价', async () => {
    await mountPage()
    // 默认用户侧价已查询成功；切到厂侧节点价（需对象）
    state.responder = () =>
      Promise.reject(
        Object.assign(new Error('资料读取失败，请稍后重试'), { status: 503, errorCode: 'UNAVAILABLE' })
      )
    await choosePriceObject('prices.company-node-series')
    await chooseObjects('YN.KM.01')

    // 所选仍是厂侧节点价（用户显式操作，失败不回落）
    expect(priceObjectSelect().props('modelValue')).toBe('prices.company-node-series')
    expect(wrapper!.text()).toContain('资料读取失败')
    // 没有替用户回落到公开节点价
    expect(queryCallsOf((request) => request.analysisId === 'prices.public-node-series')).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === 'prices.company-node-series').length).toBeGreaterThan(0)
  })

  it('历史候选按当前价格对象的日前与实时两个价格来源求交集（场站清单来源不参与）', async () => {
    state.capabilities = capsWith(['prices.public-node-series', 'prices.plant-node-series'])
    await mountPage()

    expect(wrapper!.getComponent(InsightHistoryCandidates).props('requiredSourceIds')).toEqual([
      'yn.price.node.public.day-ahead',
      'yn.price.node.public.real-time',
    ])

    await choosePriceObject('prices.plant-node-series')
    // 场站关联价分析含第三来源 cgn.plant.nodal-price（场站清单，非价格读取），交集只按两个价格来源
    expect(wrapper!.getComponent(InsightHistoryCandidates).props('requiredSourceIds')).toEqual([
      'cgn.price.plant-node.day-ahead',
      'cgn.price.plant-node.real-time',
    ])
  })
})

describe('节点基差页签', () => {
  it('用户侧价格没有节点维度：基差页签显示固定说明且不发 basis 查询', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()
    await switchTab('basis')

    expect(wrapper!.text()).toContain('用户侧价格没有节点维度，不提供节点基差')
    expect(queryCallsOf((request) => request.filters?.view === 'basis')).toHaveLength(0)
  })

  it('未选参考对象不发 basis 查询；选定后查询携带 referenceObjectId 与 objectIds，未配对与 notes 原文随结果展示', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01', 'YN.KM.02')
    await switchTab('basis')

    expect(wrapper!.text()).toContain('请先选择参考节点或参考场站')
    expect(queryCallsOf((request) => request.filters?.view === 'basis')).toHaveLength(0)

    basisReferenceSelect().vm.$emit('update:modelValue', 'YN.KM.01')
    await flushPromises()
    const calls = queryCallsOf((request) => request.filters?.view === 'basis')
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.referenceObjectId).toBe('YN.KM.01')
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['YN.KM.01', 'YN.KM.02'])
    // 场站绑定关系口径说明（后端 notes 原文）与未配对原因（不悄悄丢弃）随结果展示
    expect(wrapper!.text()).toContain(PLANT_BINDING_NOTE)
    expect(wrapper!.text()).toContain('未配对')
    expect(wrapper!.text()).toContain('参考对象在该来源这段日期没有资料')
  })

  it('参考对象只能从已选对象中选；被移出已选集合时自动清空', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01', 'YN.KM.02')
    await switchTab('basis')

    // VTU 组件 wrapper 持有的是取用时的 vnode 快照，重新渲染后须重新 getComponent 再看子树
    const optionValues = () =>
      basisReferenceSelect()
        .findAllComponents({ name: 'ElOption' })
        .map((option) => option.props('value'))
    expect(optionValues()).toEqual(['YN.KM.01', 'YN.KM.02'])

    basisReferenceSelect().vm.$emit('update:modelValue', 'YN.KM.02')
    await flushPromises()

    // 从已选对象中移除 YN.KM.02：参考随之清空（数据一致性，不是回落），选项只剩 YN.KM.01
    await chooseObjects('YN.KM.01')
    expect(basisReferenceSelect().props('modelValue')).toBe('')
    expect(optionValues()).toEqual(['YN.KM.01'])
  })
})

describe('统计摘要', () => {
  it('负价电量占比标注「不可用」并按后端原文说明原因，不显示成 0；集合权重口径原文展示', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()

    const text = wrapper!.text()
    expect(text).toContain(`负价电量占比 不可用：${UNAVAILABLE_NEGATIVE_ENERGY}`)
    expect(text).not.toContain('负价电量占比：0')
    expect(text).toContain(SET_WEIGHT_NOTE)
    expect(text).toContain('所选对象集合')
  })

  it('指标按登记精度显示：126.666666666667 → 126.67', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()

    const text = wrapper!.text()
    expect(text).toContain('126.67')
    expect(text).not.toContain('126.666')
  })
})

describe('日前实时价差', () => {
  it('方向说明与异常规则固定文案；配对统计以卡片呈现（指标名与精度取登记）；查询按 view=spread 发起', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()
    await switchTab('spread')

    const text = wrapper!.text()
    expect(text).toContain('价差 = 日前 − 实时，正值表示日前高于实时；这是价格差，不是收益')
    expect(text).toContain(SPREAD_ANOMALY_RULE)
    // 配对统计卡：均值 12.5、绝对值均值 30.25（登记精度）、极值带出现时段
    expect(text).toContain('12.5')
    expect(text).toContain('30.25')
    expect(text).toContain('88.25')
    expect(text).toContain('10:00 出现')
    expect(queryCallsOf((request) => request.filters?.view === 'spread')).toHaveLength(1)
  })

  it('异常行点击生成语义选区：无 dataIndex/seriesIndex，承载对象与时段并定位图表', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01')
    await switchTab('spread')

    const tables = wrapper!.findAllComponents({ name: 'ElTable' })
    const anomalyTable = tables.find((table) => {
      const data = table.props('data') as Array<Record<string, unknown>>
      return Boolean(data?.length && 'rank' in data[0])
    })
    expect(anomalyTable).toBeTruthy()
    anomalyTable!.vm.$emit('row-click', {
      seriesId: 'spread:public-node:YN.KM.01',
      intervalStart: '2026-09-10T10:00:00+08:00',
      intervalEnd: '2026-09-10T10:15:00+08:00',
      value: '88.25',
      rank: '1',
    })
    await flushPromises()

    const selection = chartApplyCalls.at(-1)
    expect(selection).toBeTruthy()
    const json = JSON.stringify(selection)
    expect(json).not.toContain('dataIndex')
    expect(json).not.toContain('seriesIndex')
    expect(json).toContain('YN.KM.01')
    expect(json).toContain('2026-09-10T10:00:00+08:00')
    expect(wrapper!.text()).toContain('已定位时段')
  })

  it('「以选区进入研究」：按白名单只带窗口起止日 + 来源引用跳研究页（对象引用与时段数组不进 URL）', async () => {
    router.addRoute({ path: '/insight/research', component: { render: () => null } })
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01')
    await switchTab('spread')

    const tables = wrapper!.findAllComponents({ name: 'ElTable' })
    const anomalyTable = tables.find((table) => {
      const data = table.props('data') as Array<Record<string, unknown>>
      return Boolean(data?.length && 'rank' in data[0])
    })
    anomalyTable!.vm.$emit('row-click', {
      seriesId: 'spread:public-node:YN.KM.01',
      intervalStart: '2026-09-10T10:00:00+08:00',
      intervalEnd: '2026-09-10T10:15:00+08:00',
      value: '88.25',
      rank: '1',
    })
    await flushPromises()

    await wrapper!.find('[data-testid="ynp-spread-to-research"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/insight/research')
    const query = router.currentRoute.value.query
    expect(query.from).toBe('prices')
    expect(query.start).toBe('2026-09-10')
    expect(query.end).toBe('2026-09-10')
    expect(String(query.sources)).toContain('yn.price.node.public')
    // 研究预览不消费对象范围：对象引用不进承接（带过去就是假承接）；时段数组与版本令牌同样不交接
    expect(query.objects).toBeUndefined()
    expect(query.timeIntervals).toBeUndefined()
    expect(query.resultRef).toBeUndefined()
  })

  it('空间入口：独立节点未关联场站时不跳转（市场空间态势无法聚焦独立节点，如实说明）', async () => {
    router.addRoute({ path: '/grid-assets/market', component: { render: () => null } })
    state.capabilities = capsWith(['prices.public-node-series'])
    geo.object.mockClear()
    geo.nodes.mockResolvedValue({ data: { items: [{ assetId: 'ND-KM01', standardName: 'YN.KM.01', nodeName: 'YN.KM.01', aliases: [] }] } })
    geo.object.mockResolvedValue({
      reference: { kind: 'node', id: 'ND-KM01', regionId: 'yunnan' },
      relations: { plants: [], nodes: [] },
    })
    await mountPage()
    await chooseObjects('YN.KM.01')
    await switchTab('basis')
    basisReferenceSelect().vm.$emit('update:modelValue', 'YN.KM.01')
    await flushPromises()

    await wrapper!.find('[data-testid="ynp-basis-spatial"]').trigger('click')
    await flushPromises()
    // 名字解析成资产 ID 后仍要确认场站关联：无关联不跳转，路由停在价格页
    expect(geo.object).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).not.toBe('/grid-assets/market')
  })

  it('只选一侧来源的 422：直显后端文案', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()
    state.responder = (request) =>
      request.filters?.view === 'spread'
        ? Promise.reject(Object.assign(new Error(SPREAD_ONE_SIDE_422), { status: 422, errorCode: 'INVALID_FILTER' }))
        : defaultResponder(request)
    await switchTab('spread')

    expect(wrapper!.text()).toContain(SPREAD_ONE_SIDE_422)
  })
})

describe('历史分布', () => {
  it('窗口天数与各序列有效天数如实展示；样本说明与「暂不支持按季节、工作日筛选」都在', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()
    await setWindow('2026-09-10', '2026-09-11')
    await switchTab('profile')

    const text = wrapper!.text()
    expect(text).toContain('业务窗口 2026-09-10 ~ 2026-09-11（2 天）')
    // 两条序列：一条两天、一条一天（缺测如实，不装满窗；序列名含市场阶段「日前」）
    expect(text).toContain('YN.KM.01 日前 2 天')
    expect(text).toContain('YN.KM.02 实时 1 天')
    expect(text).toContain('只统计所选窗口内真实存在的时段；样本只有一年或更短时，不代表多年季节规律')
    expect(text).toContain('暂不支持按季节、工作日筛选')
    expect(text).toContain('逐日均价（时长加权）')
    expect(text).toContain('各时段跨日均价（时长加权）')
  })
})

describe('状态纪律', () => {
  it('上下文变化后迟到结果不写进新状态；页签切走再切回不重查', async () => {
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()
    await switchTab('profile')

    // 旧口径请求挂起（profile + 此前的 series/summary 已完成，这里只拦 profile）
    let resolveOld: (value: any) => void = () => {}
    const oldPromise = new Promise((resolve) => {
      resolveOld = resolve
    })
    const oldVersion = `rv1:${'c'.repeat(64)}`
    state.responder = (request) =>
      request.filters?.view === 'profile'
        ? oldPromise.then(() => insightResult({ resultVersion: oldVersion, contextVersion: request.context.contextVersion }))
        : defaultResponder(request)

    // 换窗口：上下文变化作废在途请求，并按新口径重查
    await setWindow('2026-09-10', '2026-09-11')

    // 旧响应迟到到达：不得写进新状态（图表仍显示新口径结果）
    resolveOld(null)
    await flushPromises()

    const profileChart = wrapper!
      .findAllComponents(InsightSeriesChartStub)
      .map((chart) => chart.props('result') as any)
      .filter((result) => result?.data)
    // 时段走势在新窗口下重查成功；任何已渲染结果都不是旧版本
    expect(profileChart.every((result) => result.resultVersion !== oldVersion)).toBe(true)

    // 换窗后首次切回时段走势：旧状态已被清空，按新口径重查是正确行为，先让它查完
    await switchTab('series')
    // 同签名下切走再切回：不重查
    const seriesCallsBefore = queryCallsOf((request) => request.filters?.view === 'series').length
    await switchTab('profile')
    await switchTab('series')
    expect(queryCallsOf((request) => request.filters?.view === 'series')).toHaveLength(seriesCallsBefore)
  })

  it('能力目录请求在途被业务窗切换作废后自动重拉恢复，不静默死锁（dljy#3065）', async () => {
    // 第一次能力目录请求挂起：模拟页面加载即被上下文切换作废的在途请求
    let resolveFirst: (value: any) => void = () => {}
    const firstCapabilities = new Promise((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(fetchInsightCapabilities).mockResolvedValueOnce(firstCapabilities as any)

    await mountPage() // onMounted → loadCapabilities → 第 1 次能力目录请求挂起

    // 换窗口：上下文代次 +1，作废在途能力目录请求
    await setWindow('2026-09-10', '2026-09-11')

    // 迟到响应到达：run 判代次落后返回 null；修复后应自动重拉，而非静默死锁
    resolveFirst(capsWith(ALL_ANALYSES))
    await flushPromises()
    await flushPromises()

    // 重拉后能力目录就绪，默认页签（series）查询已发出；修复前目录与错误均为 null，查询被永久拦截
    expect(vi.mocked(fetchInsightCapabilities).mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(queryCallsOf((request) => request.filters?.view === 'series').length).toBeGreaterThan(0)
  })
})

describe('展示纪律', () => {
  it('界面只出现业务语言：不出现来源标识、family、SQL、表名原文', async () => {
    state.capabilities = capsWith(ALL_ANALYSES)
    await mountPage()
    await switchTab('spread')

    const text = wrapper!.text()
    expect(text).not.toContain('yn.price')
    expect(text).not.toContain('cgn.price')
    expect(text).not.toContain('sourceId')
    expect(text).not.toContain('family')
    expect(text).not.toContain('SELECT ')
  })
})

// ── 多日展示模式（单日走势 / 多日立体 / 日期×时段热力；dljy#3007 任务 6.8/6.9）────────

function modeGroup(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="ynp-series-mode"]') as unknown as VueWrapper<any>
}

async function switchMode(mode: 'single' | 'multi3d' | 'heatmap') {
  modeGroup().vm.$emit('update:modelValue', mode)
  await flushPromises()
}

function profileCalls() {
  return queryCallsOf((request) => request.filters?.view === 'profile')
}

function modeStorageKey(analysisId = 'prices.user-series') {
  return `ynp.prices.mode|${getCurrentUser().username}|yunnan|${analysisId}`
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom }
}

describe('多日展示模式', () => {
  it('切到多日立体：数据面走 profile 视图（与「历史分布」页签共用，切过去不重查）', async () => {
    await mountPage()
    // 默认单日走势：只查 series + summary，不发 profile
    expect(profileCalls()).toHaveLength(0)
    expect(queryCallsOf((request) => request.filters?.view === 'series')).toHaveLength(1)

    await switchMode('multi3d')
    expect(profileCalls()).toHaveLength(1)
    // series 视图查询行为不变（模式只切换展示）
    expect(queryCallsOf((request) => request.filters?.view === 'series')).toHaveLength(1)

    // 历史分布页签与多日模式共用同一份 profile 结果：同签名不重查
    await switchTab('profile')
    expect(profileCalls()).toHaveLength(1)
  })

  it('单日窗口不悄悄扩窗：提示 + 「改为 7 天」按钮，点了才扩窗并按新口径重查', async () => {
    await mountPage()
    await switchMode('multi3d')
    expect(wrapper!.find('[data-testid="ynp-3dw-window-hint"]').exists()).toBe(true)
    const extend = wrapper!.find('[data-testid="ynp-3dw-extend"]')
    expect(extend.exists()).toBe(true)
    // 按钮文案写明目标窗口（结束日=今天，往前数 7 天）
    const expected = sevenDayWindowEndingAt(beijingToday())
    expect(extend.text()).toContain(`改为 ${expected.start} — ${expected.end} 共 7 天`)

    await extend.trigger('click')
    await flushPromises()
    // 页面 setBusinessWindow：日期窗控件与上下文同步为 7 天窗口
    expect(wrapper!.getComponent(InsightDateRange).props('modelValue')).toEqual(expected)
    // 口径变化：profile 按新窗口重查（旧结果属于旧口径，不冒充）
    expect(profileCalls()).toHaveLength(2)
  })

  it('模式按 用户+地区+价格对象 记忆：换对象换键，换回恢复', async () => {
    await mountPage()
    await switchMode('heatmap')
    expect(modeGroup().props('modelValue')).toBe('heatmap')
    expect(localStorage.getItem(modeStorageKey())).toBe('heatmap')

    // 换到公开节点价：另一个键没有记忆 → 回单日走势
    await choosePriceObject('prices.public-node-series')
    expect(modeGroup().props('modelValue')).toBe('single')
    expect(localStorage.getItem(modeStorageKey('prices.public-node-series'))).toBeNull()

    // 换回用户侧价：恢复该键记忆的模式
    await choosePriceObject('prices.user-series')
    expect(modeGroup().props('modelValue')).toBe('heatmap')
  })

  it('localStorage 不可用（读写抛错）：页面正常、模式切换不炸、行为回默认', async () => {
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: throwingStorage() })
    try {
      await mountPage()
      await switchMode('multi3d')
      // 读写都抛错：页面仍渲染工作区（记忆静默失败，模式仍由本次会话状态决定）
      expect(wrapper!.find('[data-testid="ynp-price-3d-workspace"]').exists()).toBe(true)
      expect(modeGroup().props('modelValue')).toBe('multi3d')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: original })
    }
  })
})

// ── 导出与材料入口（dljy#3078 任务 15.2/14.5）────────────────────────────────────────────

function entryButtons(testId: string) {
  return wrapper!.findAll(`[data-testid="${testId}"]`)
}

describe('导出与材料入口', () => {
  it('时段走势区块提供「导出 CSV」与「加入材料」（管理员默认可写）；点加入材料打开窗口，请求与当前查询同口径、期望版本取自当前结果', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01')

    expect(entryButtons('insight-export-csv')).toHaveLength(1)
    expect(entryButtons('insight-add-material')).toHaveLength(1)

    await entryButtons('insight-add-material')[0]!.trigger('click')
    await flushPromises()

    const dialog = wrapper!.getComponent(InsightMaterialDialog)
    expect(dialog.props('subject')).toBe('时段走势')
    expect(dialog.props('region')).toBe('yunnan')
    expect(dialog.props('companyId')).toBe('c1')
    const request = dialog.props('request') as { analysisId: string; context: Record<string, unknown>; filters: Record<string, unknown> }
    expect(request.analysisId).toBe('prices.public-node-series')
    expect(request.filters).toEqual({ view: 'series', objectIds: ['YN.KM.01'] })
    // 上下文剥掉代次（导航概念）：同口径重复保存的幂等键稳定
    expect(request.context.contextVersion).toBeUndefined()
    // 期望版本 = 当前结果的版本引用（服务端据此核验，不一致返回 409）
    const result = dialog.props('result') as { resultVersion: string; readSetRef: string }
    expect(result.resultVersion).toBe(RESULT_VERSION)
    expect(result.readSetRef).toBe(READ_SET_REF)
  })

  it('历史分布区块同样有入口；窗口请求按 view=profile 组装', async () => {
    state.capabilities = capsWith(['prices.public-node-series'])
    await mountPage()
    await chooseObjects('YN.KM.01')
    await switchTab('profile')

    // el-tabs 保留已访问页签：时段走势 + 历史分布两个区块都有入口；历史分布的块在 DOM 靠后
    expect(entryButtons('insight-add-material')).toHaveLength(2)
    await entryButtons('insight-add-material')[1]!.trigger('click')
    await flushPromises()

    const dialog = wrapper!.getComponent(InsightMaterialDialog)
    expect(dialog.props('subject')).toBe('历史分布')
    expect((dialog.props('request') as { filters: Record<string, unknown> }).filters.view).toBe('profile')
  })

  it('无公司写权限（TRADER）：「加入材料」不出现，「导出 CSV」保留——只读与写入的权限语义分离', async () => {
    localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'trader' }))
    state.capabilities = capsWith(['prices.user-series'])
    await mountPage()

    expect(entryButtons('insight-add-material')).toHaveLength(0)
    expect(entryButtons('insight-export-csv')).toHaveLength(1)
    // 入口都没出现，复盘客户端一次也不该被调
    expect(listWorkpapers).not.toHaveBeenCalled()
  })

  it('点击「导出 CSV」触发浏览器下载，文件名含业务窗口（同版本全量前端导出）', async () => {
    const downloads: string[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      state.capabilities = capsWith(['prices.user-series'])
      await mountPage()

      await entryButtons('insight-export-csv')[0]!.trigger('click')
      await flushPromises()

      expect(clickSpy).toHaveBeenCalledTimes(1)
      // 文件名窗口取自结果本体（夹具的业务窗 2026-09-10），不是「今天」
      expect(downloads[0]).toBe('洞察-时段走势-2026-09-10至2026-09-10.csv')
    } finally {
      vi.restoreAllMocks()
    }
  })
})

// ── 业务模块只读深链·资料维护（dljy#3096，任务 15.5：design D11 / CH05 / PP07）───────────
// 价格页的深链面只有「前往资料维护」：空态原因为「未接入/超覆盖」且对上传中心有权限才显示；
// 跳转只带期间/from 标记，不在洞察手填真实值；无权限不渲染。

describe('业务模块只读深链·资料维护', () => {
  /** 让统计摘要空态（区块无条件渲染在时段走势页签），其余视图照常。 */
  function emptySummaryResponder(reason: 'not-onboarded' | 'beyond-coverage') {
    return (request: any): Promise<any> => {
      if (request.filters?.view !== 'summary') return defaultResponder(request)
      return Promise.resolve(insightResult({
        contextVersion: request.context.contextVersion,
        analysisId: request.analysisId,
        sourceRefs: [{ sourceId: 'yn.price.node.public.day-ahead', accessScope: 'public' }],
        runtime: {
          access: 'granted',
          availability: { state: 'empty', reason },
          freshness: { state: 'unknown' },
          comparability: { status: 'compatible', reasons: [] },
        },
        data: { schemaVersion: 'insight-result-data/v1', dimensions: [], measures: [], rows: [], series: [] },
      }))
    }
  }

  it('空态原因为「超覆盖」且有权限（管理员）：入口显示，跳转上传中心只带期间/from/panel', async () => {
    localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'admin' }))
    state.responder = emptySummaryResponder('beyond-coverage')
    await mountPage()

    const entry = wrapper!.find('[data-testid="insight-open-maintenance"]')
    expect(entry.exists()).toBe(true)
    expect(entry.text()).toBe('前往资料维护')

    vi.spyOn(router, 'push')
    await entry.trigger('click')
    await flushPromises()

    const target = vi.mocked(router.push).mock.calls.at(-1)![0] as unknown as { path: string; query: Record<string, string> }
    expect(target.path).toBe('/data-ops/console')
    // query 白名单：期间 + from + panel，全部字符串（无原始数据数组、无可写动词）
    expect(Object.keys(target.query).sort()).toEqual(['end', 'from', 'panel', 'start'])
    expect(Object.values(target.query).every((value) => typeof value === 'string' && value.length > 0)).toBe(true)
    expect(target.query.from).toBe('insight-prices')
    expect(target.query.panel).toBe('upload')
  })

  it('空态原因为「未接入」但无权限（TRADER 无数据运维授权）：入口不渲染', async () => {
    localStorage.setItem('dljy_governance_user', JSON.stringify({ username: 'trader' }))
    state.responder = emptySummaryResponder('not-onboarded')
    await mountPage()

    expect(wrapper!.text()).toContain('尚未接入')
    expect(wrapper!.find('[data-testid="insight-open-maintenance"]').exists()).toBe(false)
  })
})

// ── AI 解读注册（dljy#3100，任务 15.3）：六页注册覆盖之价格页 ─────────────────────────────

describe('YunnanPricesPage · AI 解读注册（15.3）', () => {
  it('注册统一侧栏声明并挂入口按钮：采集含时段走势与统计摘要，payload 无原始行', async () => {
    await mountPage()
    expect(wrapper!.find('[data-testid="ynp-ai-entry"]').exists()).toBe(true)
    const def = activeAiPage().value
    expect(def?.label).toBe('云南价格分析')
    const slice = resolveInterpret(def!)!.context?.() as { blocks: Array<Record<string, unknown>> } | null
    expect(slice).not.toBeNull()
    expect(slice!.blocks.map((block) => block.blockId).sort()).toEqual(['series', 'summary'])
    expect(JSON.stringify(slice)).not.toMatch(/"rows"/)
  })

  it('切换价格对象后旧签名结果作废：新查询未就绪期间采集为空（过期资料不进上下文）', async () => {
    await mountPage()
    const def = activeAiPage().value!
    expect((resolveInterpret(def)!.context?.() as { blocks: unknown[] }).blocks).toHaveLength(2)
    state.responder = () => new Promise(() => {}) // 新查询挂起（公共节点价需先选对象）
    await choosePriceObject('prices.public-node-series') // 全部旧结果作废
    const slice = resolveInterpret(def)!.context?.() as { blocks: unknown[] } | null
    expect(slice?.blocks ?? []).toHaveLength(0)
  })
})
