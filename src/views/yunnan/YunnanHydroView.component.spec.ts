// YunnanHydroView.component.spec.ts — 云南水电分析页回归（dljy#3389）
// 守什么不变量：
//   ① 获权两分析按能力目录判定：公共账号不渲染空框、不发获权请求，只留一个「需开通」短标签；
//     获权账号见两卡，周出力区域默认只选「云南」，机组群默认选中唯一的群（清空则不发请求）、表格没有「上限」列；
//   ② 区域切换即重查：新请求携带新 objectIds；清空区域不发请求；
//   ③ 缺值显示「—」不显示 0（指标卡按登记精度，极值带出现时段）；
//   ④ 窗口变化作废旧结果：在途旧响应迟到也不写进新窗口状态；
//   ⑤ 主图同轴叠线不堆叠（无 stack / areaStyle）、缺测断线（connectNulls:false、step:'end'），
//     预测与南网背景序列不进主图；
//   ⑥ 页面整洁纪律（2026-09-28）：无大段说明框（不用 InsightNote），说明全为短标签 + 悬浮提示。
// mock 边界：insightClient 打桩（保留类型与错误类）；useInsightContext 用真 composable
//（真 router + 全局地区/公司 ref）；shared/insight 契约镜像用真模块（指标精度取登记）。
import { defineComponent, h } from 'vue'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInsightCapabilities,
  fetchInsightCoverage,
  queryInsight,
} from '@/services/insight/insightClient'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import InsightDateRange from '@/components/insight/InsightDateRange.vue'
import InsightNote from '@/components/insight/InsightNote.vue'
import MetricTile from '@/components/common/MetricTile.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import YunnanHydroView from './YunnanHydroView.vue'

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
    // 入口锚定的覆盖扫描：返回空候选 → 保持当日默认，不引入额外状态（锚定分支由旧页用例覆盖）。
    fetchInsightCoverage: vi.fn(() =>
      Promise.resolve({
        schemaVersion: 'insight-coverage/v1',
        analysisId: 'supply.system-series',
        regionId: 'yunnan',
        businessWindow: { start: '2026-09-17', end: '2026-09-17' },
        sources: [],
        candidates: { discrete: false, dates: [], ranges: [] },
        note: '',
        mock: false,
        productionWrite: false,
      })
    ),
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

const SYSTEM = 'supply.system-series'
const HYDRO_WEEKLY = 'supply.hydro-weekly-output'
const HYDRO_GROUPS = 'supply.hydro-unit-groups'

const MAIN_TITLE = '水电 · 统调负荷 · 新能源（实际，MW）'

const SOURCE_TITLES: Record<string, string> = {
  'yn.system.hydro.actual': '云南水电出力（实际）',
  'yn.system.load.actual': '云南电网负荷（实际）',
  'yn.system.new-energy.actual': '云南新能源出力（实际）',
  'yn.system.load.forecast': '云南负荷预测',
  'csg.system.hydro.actual': '南方电网整体口径水电（实际，背景）',
  'cgn.hydro.weekly-output.forecast': '水电周出力预测（逐日平均出力，按区域）',
  'cgn.hydro.yn-group-share': '云南水电机组群组成与机组出力占比（按日）',
}

/** 主图序列目录条目（seriesId 形如「来源|字段」；带一条预测与一条南网背景用于裁剪断言）。 */
function sysSeries(args: { sourceId: string; scope: string; variant: 'actual' | 'forecast' }) {
  return {
    seriesId: `${args.sourceId}|value`,
    sourceId: args.sourceId,
    fieldId: 'value',
    unit: 'MW',
    measureKind: 'power',
    dimensions: {},
    businessScope: args.scope,
    resolutionMinutes: 15,
    nativeResolutionMinutes: 15,
    priceObject: null,
    marketPhase: null,
    variant: args.variant,
  }
}

const SYSTEM_SERIES = [
  sysSeries({ sourceId: 'yn.system.hydro.actual', scope: 'yunnan', variant: 'actual' }),
  sysSeries({ sourceId: 'yn.system.load.actual', scope: 'yunnan', variant: 'actual' }),
  sysSeries({ sourceId: 'yn.system.new-energy.actual', scope: 'yunnan', variant: 'actual' }),
  sysSeries({ sourceId: 'yn.system.load.forecast', scope: 'yunnan', variant: 'forecast' }),
  sysSeries({ sourceId: 'csg.system.hydro.actual', scope: 'csg-aggregate', variant: 'actual' }),
]

function seriesRows(): Array<{ seriesId: string; intervalStart: string; intervalEnd: string; value: string }> {
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
      rows: seriesRows(),
      series: SYSTEM_SERIES,
    },
  })
}

/** summary 目录：主图序列 + 水电占比行（kind share）。 */
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
  ]
}

function summaryResult(request: any, opts?: { omitHydroRows?: boolean; hydroShare?: string }) {
  const rows: Array<Record<string, string | null>> = []
  for (const meta of SYSTEM_SERIES) {
    if (opts?.omitHydroRows && meta.sourceId === 'yn.system.hydro.actual') continue
    rows.push(
      { seriesId: meta.seriesId, metricId: 'supply.mean-power', value: '126.666666666667' },
      { seriesId: meta.seriesId, metricId: 'supply.minimum', value: '90.25', atIntervalStart: '2026-09-17T10:00:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'supply.maximum', value: '180', atIntervalStart: '2026-09-17T10:15:00+08:00' },
      { seriesId: meta.seriesId, metricId: 'sample.valid-hours', value: '24' }
    )
  }
  rows.push(
    { seriesId: 'share:hydro:yunnan', metricId: 'supply.hydro-share', value: opts?.hydroShare ?? '62.5' },
    { seriesId: 'share:hydro:yunnan', metricId: 'sample.common-hours', value: '24' }
  )
  return insightResult({
    contextVersion: request.context.contextVersion,
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows,
      series: summaryCatalog(),
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
  if (request.filters?.view === 'summary') return Promise.resolve(summaryResult(request))
  return Promise.resolve(systemSeriesResult(request))
}

function caps(analysisIds: string[]): any {
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
      limits: { maxDays: 31, maxObjects: 10, requiresObjects: analysisId !== SYSTEM },
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

const PUBLIC_CAPS = [SYSTEM]
const ENTITLED_CAPS = [SYSTEM, HYDRO_WEEKLY, HYDRO_GROUPS]

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanHydroView, {
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

function chartSeriesOf(title: string): Array<Record<string, unknown>> {
  const option = chartOptionsByTitle.get(title)
  return (option?.series ?? []) as Array<Record<string, unknown>>
}

function tileProps(): Array<Record<string, unknown>> {
  return wrapper!
    .findAllComponents(MetricTile)
    .map((tile) => tile.props() as unknown as Record<string, unknown>)
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
  state.capabilities = caps(PUBLIC_CAPS)
  state.responder = defaultResponder
  vi.mocked(queryInsight).mockClear()
  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(fetchInsightCoverage).mockClear()
  chartOptionsByTitle.clear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('获权与公开两种渲染', () => {
  it('公共账号：不渲染获权卡、不发获权请求，只留一个「需开通」短标签（悬浮说明）', async () => {
    state.capabilities = caps(PUBLIC_CAPS)
    await mountPage()

    expect(queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)).toHaveLength(0)
    expect(wrapper!.text()).not.toContain('水电周出力预测')
    expect(wrapper!.text()).not.toContain('机组群构成')
    const tags = wrapper!.findAll('[data-testid="ynh-entitlement-tag"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]!.text()).toContain('需开通')
    // 指标卡与主图照常渲染（公开面完整可用）
    expect(wrapper!.findAllComponents(MetricTile).length).toBe(5)
    expect(chartSeriesOf(MAIN_TITLE).length).toBeGreaterThan(0)
  })

  it('获权账号：两卡并排渲染，周出力默认只选「云南」、机组群默认选中唯一的群，均随首查发出；清空机组群不再发请求', async () => {
    state.capabilities = caps(ENTITLED_CAPS)
    await mountPage()

    expect(wrapper!.text()).toContain('水电周出力预测')
    expect(wrapper!.text()).toContain('机组群构成')
    const weeklyCalls = queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)
    expect(weeklyCalls).toHaveLength(1)
    expect(weeklyCalls[0]![0]!.filters!.objectIds).toEqual(['云南'])
    // 机组群数据基线只有一个群：默认选中它并随首查发出（不用人再去点）
    const groupCalls = queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)
    expect(groupCalls).toHaveLength(1)
    expect(groupCalls[0]![0]!.filters!.objectIds).toEqual(['31 家水电'])
    expect(unitGroupSelect().props('modelValue')).toBe('31 家水电')
    // 两项都有权：不出现「需开通」标签
    expect(wrapper!.find('[data-testid="ynh-entitlement-tag"]').exists()).toBe(false)

    const picker = wrapper!.getComponent('[data-testid="ynh-hydro-regions"]') as unknown as VueWrapper<any>
    expect(picker.props('modelValue')).toEqual(['云南'])
    // 表格没有「上限」字样的列（来源只披露组成与占比）
    const labels = wrapper!
      .findAllComponents({ name: 'ElTableColumn' })
      .map((column) => String(column.props('label') ?? ''))
    expect(labels).toContain('出力占比（%）')
    expect(labels.filter((label) => label.includes('上限'))).toHaveLength(0)
    expect(wrapper!.text()).toContain('某水电厂')

    // 清空机组群：不再发请求，显示选择提示
    unitGroupSelect().vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(queryCallsOf((request) => request.analysisId === HYDRO_GROUPS)).toHaveLength(1)
    expect(wrapper!.text()).toContain('请选择机组群')
  })

  it('部分获权（只有机组群）：只渲染该卡，仍保留一个「需开通」标签', async () => {
    state.capabilities = caps([SYSTEM, HYDRO_GROUPS])
    await mountPage()

    expect(wrapper!.text()).not.toContain('水电周出力预测')
    expect(wrapper!.text()).toContain('机组群构成')
    expect(wrapper!.findAll('[data-testid="ynh-entitlement-tag"]')).toHaveLength(1)
  })
})

describe('区域切换重查与机组群', () => {
  it('区域切换即重查：新请求携带新 objectIds；清空区域不再发请求', async () => {
    state.capabilities = caps(ENTITLED_CAPS)
    await mountPage()
    expect(queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)).toHaveLength(1)

    ;(wrapper!.getComponent('[data-testid="ynh-hydro-regions"]') as unknown as VueWrapper<any>).vm.$emit('update:modelValue', ['云南', '广东'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)
    expect(calls).toHaveLength(2)
    expect(calls[1]![0]!.filters!.objectIds).toEqual(['云南', '广东'])

    ;(wrapper!.getComponent('[data-testid="ynh-hydro-regions"]') as unknown as VueWrapper<any>).vm.$emit('update:modelValue', [])
    await flushPromises()
    expect(queryCallsOf((request) => request.analysisId === HYDRO_WEEKLY)).toHaveLength(2)
  })
})

describe('指标卡', () => {
  it('数值按登记精度显示：均值 126.666666666667 → 126.7，占比 62.5%，极值带出现时段与数据截至', async () => {
    await mountPage()

    const tiles = tileProps()
    expect(tiles).toHaveLength(5)
    const byLabel = new Map(tiles.map((tile) => [String(tile.label), tile]))
    expect(byLabel.get('水电平均出力')).toMatchObject({ value: '126.7', unit: 'MW' })
    expect(byLabel.get('最高出力')).toMatchObject({ value: '180', unit: 'MW', sub: '2026-09-17 10:15 出现' })
    expect(byLabel.get('最低出力')).toMatchObject({ value: '90.3', unit: 'MW', sub: '2026-09-17 10:00 出现' })
    expect(byLabel.get('水电占比（云南）')).toMatchObject({ value: '62.5', unit: '%' })
    expect(byLabel.get('数据截至')).toMatchObject({ value: '2026-09-17' })
  })

  it('缺值显示「—」不显示 0：summary 缺水电行时均值/极值卡为「—」，口径说明在卡片 ⓘ 悬浮里', async () => {
    state.responder = (request) =>
      request.filters?.view === 'summary' ? Promise.resolve(summaryResult(request, { omitHydroRows: true })) : defaultResponder(request)
    await mountPage()

    const tiles = tileProps()
    const byLabel = new Map(tiles.map((tile) => [String(tile.label), tile]))
    expect(byLabel.get('水电平均出力')).toMatchObject({ value: '—' })
    expect(byLabel.get('最高出力')).toMatchObject({ value: '—', sub: '' })
    expect(byLabel.get('最低出力')).toMatchObject({ value: '—', sub: '' })
  })
})

describe('主图与整洁纪律', () => {
  it('主图同轴叠线不堆叠：无 stack / areaStyle、缺测断开（connectNulls:false、step:end）；预测与南网背景不进主图', async () => {
    await mountPage()

    const series = chartSeriesOf(MAIN_TITLE)
    expect(series).toHaveLength(3)
    const names = series.map((line) => String(line.name))
    expect(names).toContain('云南水电出力（实际）')
    expect(names).toContain('云南电网负荷（实际）')
    expect(names).toContain('云南新能源出力（实际）')
    expect(names.some((name) => name.includes('预测'))).toBe(false)
    expect(names.some((name) => name.includes('南方电网整体口径'))).toBe(false)
    for (const line of series) {
      expect(line.stack).toBeUndefined()
      expect(line.areaStyle).toBeUndefined()
      expect(line.connectNulls).toBe(false)
      expect(line.step).toBe('end')
      expect(line.smooth).toBe(false)
    }
  })

  it('页面整洁纪律：无大段说明框（InsightNote），说明全为短标签 + 悬浮提示；来水库容弃水只留短标签', async () => {
    state.capabilities = caps(ENTITLED_CAPS)
    await mountPage()

    expect(wrapper!.findAllComponents(InsightNote)).toHaveLength(0)
    expect(wrapper!.text()).toContain('同轴叠线')
    expect(wrapper!.text()).toContain('缺测断线')
    expect(wrapper!.text()).toContain('来水·库容·弃水')
    // 「暂无来源」不画空图：页面上没有为来水/库容/弃水渲染任何图表卡
    const chartTitles = [...chartOptionsByTitle.keys()]
    expect(chartTitles.filter((title) => title.includes('库容') || title.includes('来水'))).toHaveLength(0)
  })
})

describe('窗口变化作废旧结果', () => {
  it('改窗重查新窗口；在途旧代次响应迟到也不写回（标记值不出现、新窗口值保留）', async () => {
    // 旧代次 summary 挂起（标记值 88.8）；其余查询走默认 responder
    let resolveOld: (value: unknown) => void = () => {}
    const oldPromise = new Promise((resolve) => {
      resolveOld = resolve
    })
    let oldSummaryAsked = false
    state.responder = (request) => {
      if (request.filters?.view === 'summary' && !oldSummaryAsked) {
        oldSummaryAsked = true
        return oldPromise.then(() => summaryResult(request, { hydroShare: '88.8' }))
      }
      return defaultResponder(request)
    }
    await mountPage()
    // 旧代次 summary 在途：概况区块加载中，无指标文本
    expect(wrapper!.text()).toContain('正在读取资料')
    expect(wrapper!.text()).not.toContain('62.5')

    // 改窗：旧在途作废；新窗口 series/summary 由默认 responder 正常返回并渲染
    await setWindow('2026-09-10', '2026-09-11')
    const newWindowCalls = queryCallsOf(
      (request) => request.analysisId === SYSTEM && request.context.businessWindow.start === '2026-09-10'
    )
    expect(newWindowCalls.map((call) => call[0]!.filters!.view).sort()).toEqual(['series', 'summary'])
    expect(wrapper!.text()).toContain('62.5')

    resolveOld(null)
    await flushPromises()
    // 迟到的旧代次响应（标记值 88.8）不得写回指标卡
    expect(wrapper!.text()).not.toContain('88.8')
    expect(wrapper!.text()).toContain('62.5')
  })
})

// VTU 对字符串选择器返回弱类型，统一断言回 VueWrapper。
function unitGroupSelect(): VueWrapper<any> {
  return wrapper!.getComponent('[data-testid="ynh-unit-group"]') as unknown as VueWrapper<any>
}
