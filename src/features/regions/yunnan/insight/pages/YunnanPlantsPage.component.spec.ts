// YunnanPlantsPage.component.spec.ts — 云南场站市场表现页回归（dljy#3083，OpenSpec 任务 11.5/11.6）
// 守什么不变量（对照 specs yunnan-plant-market-performance、dljy 仓 plants-views.mjs）：
//   ① 五页签懒加载：查询形状固定（view 筛选、单视图分析不带 view）；结算页签零请求；
//   ② 获权分析按能力目录判定：公共账号整页「获权数据需开通」说明，切遍页签不发任何请求；
//   ③ 对象选项来自覆盖接口 objects：字段缺失（老后端）显示「无法列出」不发查询；
//     为空如实说明；未选对象不发请求；objectsNote 原文透出；
//   ④ 组合覆盖摘要：六字段独立卡片、按有效样本排序、分母文案「所选获权资料对象」原文；
//   ⑤ 捕获参考价：view=capture 带 objectIds、按节点分列、「不是收入」与「只是节点量价参考
//     乘积」文案、负价电量暴露卡、小时分桶图；
//   ⑥ 供应商比较：view=supplier-comparison、共同样本不足「只并列展示，不比较不排名」、
//     单源标单源、夜间零值固定说明、可比组共同样本均值极值表；
//   ⑦ 语义对照：view=semantics、列=申报/出清/上网/集控实发等、null 显示「—」、notes 原文、
//     不出现派生偏差列（「偏差对照将在口径确认后提供」）；
//   ⑧ 上下文（窗口）变化全部作废重查（含覆盖清单）；界面只出现业务语言。
// mock 边界：insightClient 打桩（保留类型与错误类）；useInsightContext 用真 composable；
// shared/insight 契约镜像用真模块（指标/精度取登记）。
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
import ChartCard from '@/components/common/ChartCard.vue'
import { insightResult } from '@/components/insight/insightFixtures'
import YunnanPlantsPage from './YunnanPlantsPage.vue'

// ── 可控 mock 状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  responder: null as ((request: any) => Promise<any>) | null,
  /** coverage 来源清单：analysisId → sources[]（objects 字段按场景给或不给）。 */
  coverageSources: null as Record<string, Array<{ sourceId: string; objects?: string[]; objectsNote?: string }>> | null,
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

// ── 能力目录与结果夹具（形状对照 dljy 仓 plants-views.mjs / sources.mjs）─────────────────

const DAILY_METRICS = 'plants.daily-metrics'
const SETTLEMENT_DAILY = 'plants.settlement-daily'
const PRICE_CAPTURE = 'plants.price-capture'
const OUTPUT_SERIES = 'plants.output-series'
const CLEARING_ACTUAL = 'plants.clearing-actual'
const BUSINESS_FORECAST = 'plants.business-forecast'

const SOURCE_TITLES: Record<string, string> = {
  'cgn.plant.daily-metrics': '场站日报指标（获权）',
  'cgn.plant.settlement-daily': '场站日结算（正式，五月月包）',
  'cgn.plant.output': '场站出力八类曲线（五月月包）',
  'cgn.plant.nodal-price': '场站节点结算电价（五月月包，小时）',
  'cgn.plant.business-actual': '实际上网电量（经营汇总，获权）',
  'cgn.plant.business-declared': '日前申报电量（经营汇总，获权）',
  'cgn.plant.spot-clearing-day-ahead': '日前出清电量（申报出清，获权）',
  'cgn.plant.spot-clearing-real-time': '实时出清电量（申报出清，获权）',
  'cgn.plant.control-generation': '集控实发电量（获权）',
  'cgn.plant.settlement-interval-formal': '分时结算电量电费（正式，获权）',
  'cgn.plant.midlong-energy': '中长期电量（合同口径引用，获权）',
  'cgn.plant.business-integrated-forecast': '一体化预测出力（经营汇总，获权）',
}

/** 序列目录条目（seriesId = 来源|字段|…维度值，与后端 captureRowsToSeries 同构）。 */
function plantSeries(args: {
  sourceId: string
  unit: string
  measureKind?: string
  fieldId?: string
  dimensions?: Record<string, string>
  variant?: string | null
}) {
  const dims = args.dimensions ?? {}
  return {
    seriesId: [args.sourceId, args.fieldId ?? 'value', ...Object.values(dims)].join('|'),
    sourceId: args.sourceId,
    fieldId: args.fieldId ?? 'value',
    unit: args.unit,
    measureKind: args.measureKind ?? 'energy',
    dimensions: dims,
    businessScope: 'plant',
    resolutionMinutes: 60,
    nativeResolutionMinutes: 60,
    priceObject: null,
    marketPhase: null,
    variant: args.variant ?? 'actual',
  }
}

const DENOMINATOR_NOTE = '分母是「所选获权资料对象」：只统计本次获权资料里真实出现的场站，不是全集团场站清单；组合汇总由页面聚合各对象行，后端不另做组合总额。'

// ── 组合总览：coverage-summary（六字段独立统计）与正式日结 ──────────────────────────────

const DAILY_FIELDS = ['totalGeneration', 'marketGeneration', 'dayAheadDeclared', 'integratedForecast', 'settlementRevenue', 'marketPrice']

function coverageSummaryResult(request: any) {
  const series: Array<Record<string, unknown>> = []
  const rows: Array<Record<string, unknown>> = []
  for (const plant of ['乙光伏电站', '甲风电场']) {
    for (const field of DAILY_FIELDS) {
      const meta = plantSeries({
        sourceId: 'cgn.plant.daily-metrics',
        unit: field === 'settlementRevenue' ? 'yuan' : field === 'marketPrice' ? 'yuan/MWh' : 'MWh',
        measureKind: field === 'marketPrice' ? 'price' : field === 'settlementRevenue' ? 'amount' : 'energy',
        fieldId: field,
        dimensions: { plant },
      })
      series.push({ ...meta, kind: 'field-series' })
      // 乙光伏电站先出现但样本更少：卡片按有效样本数从多到少排序，甲风电场应排在前
      const valid = plant === '甲风电场' ? '30' : '20'
      const days = plant === '甲风电场' ? '30' : '15'
      rows.push({ seriesId: meta.seriesId, metricId: 'sample.valid-count', value: valid })
      rows.push({ seriesId: meta.seriesId, metricId: 'sample.covered-days', value: days })
    }
  }
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: DAILY_METRICS,
    sourceRefs: [{ sourceId: 'cgn.plant.daily-metrics', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'metricId', kind: 'category' },
      ],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows,
      series,
      coverage: { denominatorBasis: 'authorized-observed-objects', denominatorNote: DENOMINATOR_NOTE, observedNote: 'observed 为该对象全部字段的有效样本数合计', objects: [] },
      notes: [{ note: '日报宽表各字段独立统计：一个字段缺测不代表其他字段缺测，也不用其他字段补齐或折算。' }],
    },
  })
}

function settlementDailyResult(request: any) {
  const energy = plantSeries({ sourceId: 'cgn.plant.settlement-daily', unit: 'MWh', fieldId: 'totalEnergy', dimensions: { plant: '甲风电场' } })
  const fee = plantSeries({ sourceId: 'cgn.plant.settlement-daily', unit: 'yuan', fieldId: 'totalFee', dimensions: { plant: '甲风电场' } })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: SETTLEMENT_DAILY,
    sourceRefs: [{ sourceId: 'cgn.plant.settlement-daily', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'by-series' }],
      rows: [
        { seriesId: energy.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '500.25' },
        { seriesId: fee.seriesId, intervalStart: '2026-09-17T00:00:00+08:00', intervalEnd: '2026-09-18T00:00:00+08:00', value: '155000.75' },
      ],
      series: [energy, fee],
    },
  })
}

// ── 价格出力：capture（按节点分列 + 负价暴露 + 小时分桶）与出力曲线 ─────────────────────

const CAPTURE_ID = 'capture:cgn.plant.business-actual|value|甲风电场|实际上网电量|cgn.plant.nodal-price|price|甲风电场|甲节点A|日前'

function captureResult(request: any) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: PRICE_CAPTURE,
    sourceRefs: [
      { sourceId: 'cgn.plant.business-actual', accessScope: 'company' },
      { sourceId: 'cgn.plant.nodal-price', accessScope: 'company' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'metricId', kind: 'category' },
      ],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId: CAPTURE_ID, metricId: 'plant.capture-price', value: '312.45' },
        { seriesId: CAPTURE_ID, metricId: 'plant.capture-paired-energy', value: '1200.5' },
        { seriesId: CAPTURE_ID, metricId: 'plant.capture-reference-product', value: '375123.4' },
        { seriesId: CAPTURE_ID, metricId: 'plant.negative-price-energy', value: '80.25' },
        { seriesId: CAPTURE_ID, metricId: 'price.negative-energy-ratio', value: '6.7' },
        { seriesId: CAPTURE_ID, metricId: 'sample.valid-count', value: '20' },
      ],
      series: [
        {
          seriesId: CAPTURE_ID,
          kind: 'capture-reference',
          objectId: '甲风电场',
          unit: 'yuan/MWh',
          formula: 'Σ(Et×Pnode,t)/ΣEt',
          energySourceId: 'cgn.plant.business-actual',
          priceSourceId: 'cgn.plant.nodal-price',
          priceDimensions: { plant: '甲风电场', nodeName: '甲节点A', dataType: '日前' },
          weightRule: 'energy-weighted',
          weightNote: '电量加权平均节点价参考：不是收入，也不含电网损失',
          pairedSlots: 20,
          zeroEnergySlots: 2,
          negativeEnergySlots: 3,
        },
      ],
      unpaired: [{ seriesId: 'cgn.plant.nodal-price|price|乙光伏电站|乙节点B', reason: '场站 乙光伏电站 没有同口径电量序列，不能计算捕获参考价' }],
      coverage: { denominatorBasis: 'authorized-observed-objects', denominatorNote: DENOMINATOR_NOTE, observedNote: 'observed 为该对象的有效电量样本数（时段数）', objects: [] },
      notes: [
        { note: '捕获参考价 = Σ(电量×节点价)/Σ电量，是「电量加权平均节点价参考」：不是收入，也不含电网损失；分子只是节点量价参考乘积，不是实际结算电费。' },
        { note: '只有同一对象、同一时段双方都有效才配对；零电量时段不进分子分母；负电量时段不自动进入捕获价，按条数单列。' },
      ],
      tables: {
        distribution: {
          rows: [
            { seriesId: CAPTURE_ID, metricId: 'plant.capture-price', timeOfDay: '12:00', value: '355.8' },
            { seriesId: CAPTURE_ID, metricId: 'plant.capture-price', timeOfDay: '00:00', value: '290.1' },
          ],
          rule: '小时 × 电量加权均价：该小时配对时段的 Σ(Et×P)/ΣEt；零电量时段已剔除。',
        },
      },
    },
  })
}

function outputSeriesResult(request: any) {
  const output = plantSeries({
    sourceId: 'cgn.plant.output',
    unit: 'MW',
    measureKind: 'power',
    dimensions: { plant: '甲风电场', unitName: '1 号机组', dataType: '子站回传' },
  })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: OUTPUT_SERIES,
    sourceRefs: [{ sourceId: 'cgn.plant.output', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [{ seriesId: output.seriesId, intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T11:00:00+08:00', value: '85.5' }],
      series: [output],
    },
  })
}

// ── 预测执行：supplier-comparison（分组表 + 共同样本统计）───────────────────────────────

const GROUP_JIA = 'compare:cgn.plant.output:甲风电场'
const GROUP_YI = 'compare:cgn.plant.output:乙光伏电站'
const GROUP_BING = 'compare:cgn.plant.output:丙风电场'
const JIA_HUICHUAN = 'cgn.plant.output|value|甲风电场|子站回传'
const JIA_XIAFA = 'cgn.plant.output|value|甲风电场|最终下发'

function supplierComparisonResult(request: any) {
  const curve = (seriesId: string, dataType: string, objectId: string, unitName: string | null) => ({
    seriesId,
    kind: 'plant-curve',
    groupId: `compare:cgn.plant.output:${objectId}${unitName ? `:${unitName}` : ''}`,
    objectId,
    unitName,
    dataType,
    unit: 'MW',
    resolutionMinutes: 60,
  })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: OUTPUT_SERIES,
    sourceRefs: [{ sourceId: 'cgn.plant.output', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'metricId', kind: 'category' },
      ],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId: JIA_HUICHUAN, metricId: 'sample.valid-count', value: '24' },
        { seriesId: JIA_HUICHUAN, metricId: 'sample.covered-days', value: '1' },
        { seriesId: JIA_XIAFA, metricId: 'sample.valid-count', value: '24' },
        { seriesId: JIA_XIAFA, metricId: 'sample.covered-days', value: '1' },
      ],
      series: [
        curve(JIA_HUICHUAN, '子站回传', '甲风电场', null),
        curve(JIA_XIAFA, '最终下发', '甲风电场', null),
        curve('cgn.plant.output|value|乙光伏电站|子站回传', '子站回传', '乙光伏电站', null),
        curve('cgn.plant.output|value|丙风电场|子站回传', '子站回传', '丙风电场', null),
        curve('cgn.plant.output|value|丙风电场|最终下发', '最终下发', '丙风电场', null),
      ],
      groups: [
        {
          groupId: GROUP_JIA,
          objectId: '甲风电场',
          unitName: null,
          members: [
            { seriesId: JIA_HUICHUAN, dataType: '子站回传', validSamples: 24 },
            { seriesId: JIA_XIAFA, dataType: '最终下发', validSamples: 24 },
          ],
          commonSlots: 24,
          singleSource: false,
          comparable: true,
          note: '按 24 个共同有效时段比较',
        },
        {
          groupId: GROUP_YI,
          objectId: '乙光伏电站',
          unitName: null,
          members: [{ seriesId: 'cgn.plant.output|value|乙光伏电站|子站回传', dataType: '子站回传', validSamples: 2 }],
          commonSlots: 2,
          singleSource: true,
          comparable: false,
          note: '单源：这条曲线只有一个 data_type，没有可比较对象',
        },
        {
          groupId: GROUP_BING,
          objectId: '丙风电场',
          unitName: null,
          members: [
            { seriesId: 'cgn.plant.output|value|丙风电场|子站回传', dataType: '子站回传', validSamples: 10 },
            { seriesId: 'cgn.plant.output|value|丙风电场|最终下发', dataType: '最终下发', validSamples: 10 },
          ],
          commonSlots: 2,
          singleSource: false,
          comparable: false,
          note: '共同样本不足：共同有效时段只有 2 个（少于 4 个），只并列展示，不比较不排名',
        },
      ],
      notes: [
        { note: '夜间零值是真实值照常参与统计，不剔除、不标注异常。' },
        { note: '比较只是并列观察，不是供应商考核，也不判定预测责任；最终下发与原预测的差异属于执行观察。' },
      ],
      tables: {
        common: {
          rows: [
            { seriesId: JIA_HUICHUAN, metricId: 'supply.mean-power', value: '82.4', groupId: GROUP_JIA },
            { seriesId: JIA_HUICHUAN, metricId: 'supply.minimum', value: '12.0', atIntervalStart: '2026-09-17T03:00:00+08:00', groupId: GROUP_JIA },
            { seriesId: JIA_HUICHUAN, metricId: 'supply.maximum', value: '156.5', atIntervalStart: '2026-09-17T19:00:00+08:00', groupId: GROUP_JIA },
            { seriesId: JIA_XIAFA, metricId: 'supply.mean-power', value: '80.1', groupId: GROUP_JIA },
            { seriesId: JIA_XIAFA, metricId: 'supply.minimum', value: '10.5', atIntervalStart: '2026-09-17T03:00:00+08:00', groupId: GROUP_JIA },
            { seriesId: JIA_XIAFA, metricId: 'supply.maximum', value: '150.0', atIntervalStart: '2026-09-17T19:00:00+08:00', groupId: GROUP_JIA },
            { seriesId: GROUP_JIA, metricId: 'sample.common-hours', value: '24', groupId: GROUP_JIA },
          ],
          rule: '共同时段内的时长加权均值与极值；只在可比（comparable）的分组给出。',
        },
      },
    },
  })
}

// ── 申报出清实际：semantics（宽表列固定、null=无资料）与一体化预测 ──────────────────────

const SEMANTIC_COLUMNS = [
  { id: 'dayAheadDeclared', label: '日前申报电量', sourceId: 'cgn.plant.business-declared', semantic: '经营汇总口径：日前申报电量' },
  { id: 'dayAheadClearing', label: '日前出清电量', sourceId: 'cgn.plant.spot-clearing-day-ahead', semantic: '市场出清口径' },
  { id: 'realTimeClearing', label: '实时出清电量', sourceId: 'cgn.plant.spot-clearing-real-time', semantic: '市场出清口径' },
  { id: 'actualGridEnergy', label: '实际上网电量', sourceId: 'cgn.plant.business-actual', semantic: '经营汇总口径：上网电量' },
  { id: 'controlGeneration', label: '集控实发电量', sourceId: 'cgn.plant.control-generation', semantic: '集控口径发电量，与结算/市场电量并列对照，不互换' },
  { id: 'settlementIntervalEnergy', label: '分时结算电量（正式）', sourceId: 'cgn.plant.settlement-interval-formal', semantic: '结算口径 totalload；正式与暂结不混算，只取电量列' },
  { id: 'midlongContractReference', label: '中长期电量（合同口径引用）', sourceId: 'cgn.plant.midlong-energy', semantic: '历史合同曲线只读引用，不是现货口径' },
]

function semanticsResult(request: any) {
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: CLEARING_ACTUAL,
    sourceRefs: [
      { sourceId: 'cgn.plant.business-declared', accessScope: 'company' },
      { sourceId: 'cgn.plant.spot-clearing-day-ahead', accessScope: 'company' },
    ],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'objectId', kind: 'category' },
        { id: 'date', kind: 'date' },
        { id: 'roleId', kind: 'category' },
      ],
      measures: [{ id: 'value', unit: 'MWh' }],
      rows: [],
      series: [],
      excluded: [{ seriesId: 'cgn.plant.settlement-interval-formal|totalFee|甲风电场', reason: '语义对照只对电量口径；该序列（如电费、单价）不进对照表' }],
      coverage: { denominatorBasis: 'authorized-observed-objects', denominatorNote: DENOMINATOR_NOTE, observedNote: 'observed 为该对象在各口径列的有效电量样本数（时段数）', objects: [] },
      notes: [
        { note: '申报、出清、上网、集控实发、分时结算与中长期引用语义不同：各口径不相加、不差值、不分摊。' },
        { note: '某口径在某对象×业务日没有资料时输出 null（该口径本窗口无资料），不用其他口径填充、不按比例分摊。' },
      ],
      tables: {
        semantics: {
          columns: SEMANTIC_COLUMNS,
          rows: [
            {
              objectId: '甲风电场',
              date: '2026-09-17',
              dayAheadDeclared: '120.5',
              dayAheadClearing: '118.0',
              realTimeClearing: null,
              actualGridEnergy: '119.2',
              controlGeneration: '121.0',
              settlementIntervalEnergy: null,
              midlongContractReference: '90.0',
            },
          ],
          rule: '行=对象×业务日，列=各口径日电量；null 表示该口径本窗口无资料。',
        },
      },
    },
  })
}

function businessForecastResult(request: any) {
  const forecast = plantSeries({
    sourceId: 'cgn.plant.business-integrated-forecast',
    unit: 'MW',
    measureKind: 'power',
    dimensions: { plant: '甲风电场' },
    variant: 'forecast',
  })
  return insightResult({
    contextVersion: request.context.contextVersion,
    analysisId: BUSINESS_FORECAST,
    sourceRefs: [{ sourceId: 'cgn.plant.business-integrated-forecast', accessScope: 'company' }],
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [
        { id: 'seriesId', kind: 'category' },
        { id: 'intervalStart', kind: 'time' },
        { id: 'intervalEnd', kind: 'time' },
      ],
      measures: [{ id: 'value', unit: 'MW' }],
      rows: [{ seriesId: forecast.seriesId, intervalStart: '2026-09-17T10:00:00+08:00', intervalEnd: '2026-09-17T11:00:00+08:00', value: '72.0' }],
      series: [forecast],
    },
  })
}

function defaultResponder(request: any): Promise<any> {
  if (request.analysisId === DAILY_METRICS) return Promise.resolve(coverageSummaryResult(request))
  if (request.analysisId === SETTLEMENT_DAILY) return Promise.resolve(settlementDailyResult(request))
  if (request.analysisId === PRICE_CAPTURE) return Promise.resolve(captureResult(request))
  if (request.analysisId === OUTPUT_SERIES) {
    return Promise.resolve(request.filters?.view === 'supplier-comparison' ? supplierComparisonResult(request) : outputSeriesResult(request))
  }
  if (request.analysisId === CLEARING_ACTUAL) return Promise.resolve(semanticsResult(request))
  if (request.analysisId === BUSINESS_FORECAST) return Promise.resolve(businessForecastResult(request))
  throw new Error(`unexpected analysis ${request.analysisId}`)
}

const DEFAULT_COVERAGE_SOURCES: Record<string, Array<{ sourceId: string; objects?: string[]; objectsNote?: string }>> = {
  [DAILY_METRICS]: [{ sourceId: 'cgn.plant.daily-metrics', objects: ['甲风电场', '乙光伏电站'] }],
  [PRICE_CAPTURE]: [{ sourceId: 'cgn.plant.nodal-price', objects: ['甲风电场', '乙光伏电站'] }],
  [OUTPUT_SERIES]: [{ sourceId: 'cgn.plant.output', objects: ['甲风电场', '乙光伏电站', '丙风电场'] }],
  [CLEARING_ACTUAL]: [
    { sourceId: 'cgn.plant.business-declared', objects: ['甲风电场'] },
    { sourceId: 'cgn.plant.spot-clearing-day-ahead', objects: ['甲风电场'] },
  ],
}

function plantsCaps(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['plants'],
      access: 'company',
      sourceIds: Object.keys(SOURCE_TITLES),
      limits: { maxDays: 31, maxObjects: analysisId === DAILY_METRICS || analysisId === SETTLEMENT_DAILY ? 200 : 50, requiresObjects: analysisId !== SETTLEMENT_DAILY },
    })),
    sources: Object.entries(SOURCE_TITLES).map(([sourceId, title]) => ({
      sourceId,
      title,
      businessScope: 'plant',
      accessScope: 'company',
      measureKind: 'energy',
      fields: [{ id: 'value', unit: 'MWh', kind: 'energy' }],
      nativeResolutionMinutes: 60,
      priceObject: null,
      marketPhase: null,
      variant: null,
      freshness: 'historical-package',
      objectDimension: 'plant',
      note: null,
    })),
    endpoints: {},
    mock: false,
    productionWrite: false,
  }
}

const ENTITLED_CAPS = [DAILY_METRICS, SETTLEMENT_DAILY, PRICE_CAPTURE, OUTPUT_SERIES, CLEARING_ACTUAL, BUSINESS_FORECAST]
const PUBLIC_CAPS: string[] = []

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanPlantsPage, {
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

function pickerOf(testid: string) {
  return wrapper!.findAllComponents(InsightObjectPicker).find((picker) => picker.attributes('data-testid') === testid)!
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
  state.capabilities = plantsCaps(ENTITLED_CAPS)
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

describe('组合总览', () => {
  it('公共账号：整页「获权数据需开通」说明，切遍五页签不发任何查询与覆盖请求；结算占位可见', async () => {
    state.capabilities = plantsCaps(PUBLIC_CAPS)
    await mountPage()
    for (const tab of ['price-output', 'forecast', 'clearing', 'settlement']) await switchTab(tab)

    expect(vi.mocked(queryInsight).mock.calls).toHaveLength(0)
    expect(vi.mocked(fetchInsightCoverage).mock.calls).toHaveLength(0)
    const text = wrapper!.text()
    expect(text).toContain('获权数据需开通')
    expect(text).not.toContain('组合覆盖摘要（获权）')
    expect(text).not.toContain('价格捕获参考（获权）')
    expect(text).not.toContain('供应商比较（获权）')
    expect(text).not.toContain('申报出清实发对照（获权）')
    expect(wrapper!.find('[data-testid="ypp-settlement-placeholder"]').exists()).toBe(true)
  })

  it('coverage objects 缺失（老后端）时：显示「无法列出」、选择器禁用、不发任何查询', async () => {
    state.coverageSources = { [DAILY_METRICS]: [{ sourceId: 'cgn.plant.daily-metrics' }] }
    await mountPage()

    expect(wrapper!.text()).toContain('对象清单需要新版洞察服务，当前无法列出')
    expect(pickerOf('ypp-overview-objects').props('disabled')).toBe(true)
    expect(pickerOf('ypp-overview-objects').props('options')).toEqual([])
    expect(queryCallsOf((request) => request.analysisId === DAILY_METRICS)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === SETTLEMENT_DAILY)).toHaveLength(0)
  })

  it('objects 为空数组是「窗口内没有对象」：如实说明，不伪造选项也不发查询', async () => {
    state.coverageSources = { [DAILY_METRICS]: [{ sourceId: 'cgn.plant.daily-metrics', objects: [] }] }
    await mountPage()

    expect(wrapper!.text()).toContain('所选窗口内没有可选对象')
    expect(queryCallsOf((request) => request.analysisId === DAILY_METRICS)).toHaveLength(0)
  })

  it('未选对象不发请求；覆盖请求不带 objectIds；空态给「请先选择场站对象」引导', async () => {
    await mountPage()

    const coverageCalls = coverageCallsOf(DAILY_METRICS)
    expect(coverageCalls).toHaveLength(1)
    expect((coverageCalls[0]![0] as any).filters?.objectIds).toBeUndefined()
    expect(queryCallsOf((request) => request.analysisId === DAILY_METRICS)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === SETTLEMENT_DAILY)).toHaveLength(0)
    expect(wrapper!.text()).toContain('请先选择场站对象')
    expect(wrapper!.text()).toContain('未选不发请求')
  })

  it('选定对象：coverage-summary 查询带 objectIds；六字段独立卡片、按有效样本排序、分母文案原文', async () => {
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场', '乙光伏电站'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === DAILY_METRICS)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.view).toBe('coverage-summary')
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['甲风电场', '乙光伏电站'])

    const text = wrapper!.text()
    for (const label of ['总发电量', '市场化电量', '日前申报电量', '一体化预测电量', '结算电费', '市场均价']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('有效样本 30 个 · 覆盖 30 天')
    expect(text).toContain('有效样本 20 个 · 覆盖 15 天')
    // 排序：同一字段卡内有效样本多的场站在前（乙光伏电站虽先出现但样本少）
    const firstCard = wrapper!.find('[data-testid="ypp-field-card-totalGeneration"]')
    expect(firstCard.text()).toContain('甲风电场')
    expect(firstCard.text()).toContain('乙光伏电站')
    expect(firstCard.text().indexOf('甲风电场')).toBeLessThan(firstCard.text().indexOf('乙光伏电站'))
    // 分母文案「所选获权资料对象」按后端原文呈现
    expect(wrapper!.find('[data-testid="ypp-denominator-note"]').text()).toContain('所选获权资料对象')
    expect(wrapper!.find('[data-testid="ypp-denominator-note"]').text()).toContain('不是全集团场站清单')
  })

  it('正式日结明细联动查询（单视图分析不带 view 筛选、带 objectIds）并渲染明细', async () => {
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === SETTLEMENT_DAILY)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.view).toBeUndefined()
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['甲风电场'])
    const block = blockOf('正式日结明细（获权）')!
    expect(block.text()).toContain('500.25')
    expect(block.text()).toContain('155000.75')
  })

  it('窗口变化：覆盖清单重列、两查询作废重发并带新窗口', async () => {
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    expect(queryCallsOf((request) => request.analysisId === DAILY_METRICS)).toHaveLength(1)

    await setWindow('2026-09-10', '2026-09-11')

    expect(coverageCallsOf(DAILY_METRICS)).toHaveLength(2)
    const calls = queryCallsOf((request) => request.analysisId === DAILY_METRICS || request.analysisId === SETTLEMENT_DAILY)
    expect(calls).toHaveLength(4) // 两分析 × 新旧窗口各一次
    for (const call of calls.slice(2)) {
      expect(call[0]!.context!.businessWindow.start).toBe('2026-09-10')
      expect(call[0]!.filters!.objectIds).toEqual(['甲风电场'])
    }
  })
})

describe('价格出力', () => {
  it('未选对象不发请求；选定后 capture 与出力曲线各查一次、带同一组 objectIds', async () => {
    await mountPage()
    await switchTab('price-output')

    expect(queryCallsOf((request) => request.analysisId === PRICE_CAPTURE)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === OUTPUT_SERIES)).toHaveLength(0)
    expect(wrapper!.text()).toContain('请先选择场站对象')

    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === PRICE_CAPTURE || request.analysisId === OUTPUT_SERIES)
    expect(calls).toHaveLength(2)
    expect(calls.find(([request]) => request.analysisId === PRICE_CAPTURE)![0]!.filters!.view).toBe('capture')
    expect(calls.find(([request]) => request.analysisId === OUTPUT_SERIES)![0]!.filters!.view).toBe('series')
    for (const call of calls) expect(call[0]!.filters!.objectIds).toEqual(['甲风电场'])
  })

  it('捕获表按节点分列：「不是收入、不含电网损失」与「只是节点量价参考乘积」文案在', async () => {
    await mountPage()
    await switchTab('price-output')
    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const text = wrapper!.text()
    expect(text).toContain('电量加权平均节点价参考，不是收入、不含电网损失')
    expect(text).toContain('节点量价参考乘积只是电量×节点价的参考乘积，不是实际结算电费')
    const table = wrapper!.find('[data-testid="ypp-capture-table"]')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('甲风电场')
    expect(table.text()).toContain('甲节点A')
    expect(table.text()).toContain('312.45')
    expect(table.text()).toContain('1200.5') // 配对电量按登记精度显示
    expect(table.text()).toContain('20')
    const labels = wrapper!.findAllComponents({ name: 'ElTableColumn' }).map((column) => String(column.props('label') ?? ''))
    expect(labels).toContain('节点量价参考乘积（元）')
  })

  it('负价电量暴露卡渲染：暴露电量、占比与负价时段数', async () => {
    await mountPage()
    await switchTab('price-output')
    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const cards = wrapper!.find('[data-testid="ypp-negative-cards"]')
    expect(cards.exists()).toBe(true)
    expect(cards.text()).toContain('负价时段暴露电量')
    expect(cards.text()).toContain('80.25')
    expect(cards.text()).toContain('负价电量占比')
    expect(cards.text()).toContain('6.7')
    expect(cards.text()).toContain('负价时段数')
    expect(cards.text()).toContain('3')
  })

  it('小时分桶图与未配对说明：分桶图表存在、后端原因与 notes 原文透出', async () => {
    await mountPage()
    await switchTab('price-output')
    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const captureBlock = blockOf('价格捕获参考（获权）')!
    expect(captureBlock.findAllComponents(ChartCard).length).toBeGreaterThan(0)
    expect(wrapper!.text()).toContain('未配对')
    expect(wrapper!.text()).toContain('场站 乙光伏电站 没有同口径电量序列，不能计算捕获参考价')
    expect(wrapper!.text()).toContain('零电量时段不进分子分母')
  })

  it('出力曲线区块共用对象选择：曲线渲染、并列对照（不做逐时乘积）说明在', async () => {
    await mountPage()
    await switchTab('price-output')
    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const block = blockOf('场站出力曲线（获权）')!
    expect(block.findAll('.series-chart-stub')).toHaveLength(1)
    expect(block.text()).toContain('并列对照')
    expect(block.text()).toContain('本期不做逐时乘积画线')
    expect(block.text()).toContain('与上方价格捕获表同一组场站对象')
  })
})

describe('预测执行', () => {
  it('未选不发请求；选定后 supplier-comparison 查询带 objectIds；分组表渲染（场站×家族×供应商）', async () => {
    await mountPage()
    await switchTab('forecast')

    expect(queryCallsOf((request) => request.analysisId === OUTPUT_SERIES)).toHaveLength(0)
    expect(wrapper!.text()).toContain('请先选择场站对象')

    pickerOf('ypp-forecast-objects').vm.$emit('update:modelValue', ['甲风电场', '乙光伏电站', '丙风电场'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === OUTPUT_SERIES)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.view).toBe('supplier-comparison')
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['甲风电场', '乙光伏电站', '丙风电场'])

    const table = wrapper!.find('[data-testid="ypp-compare-table"]')
    expect(table.exists()).toBe(true)
    const text = table.text()
    expect(text).toContain('甲风电场')
    expect(text).toContain('子站回传')
    expect(text).toContain('最终下发')
    expect(text).toContain('全场站')
    expect(text).toContain('按 24 个共同有效时段比较')
  })

  it('共同样本不足组显示「只并列展示，不比较不排名」、单源标单源、夜间零值说明在；可比组统计表渲染', async () => {
    await mountPage()
    await switchTab('forecast')
    pickerOf('ypp-forecast-objects').vm.$emit('update:modelValue', ['甲风电场', '乙光伏电站', '丙风电场'])
    await flushPromises()

    const text = wrapper!.text()
    expect(text).toContain('共同样本不足：共同有效时段只有 2 个（少于 4 个），只并列展示，不比较不排名')
    expect(text).toContain('单源：只有一个供应商/预测源，没有可比较对象')
    expect(text).toContain('夜间零值是真实值')

    const stats = wrapper!.find('[data-testid="ypp-common-table"]')
    expect(stats.exists()).toBe(true)
    expect(stats.text()).toContain('82.4')
    expect(stats.text()).toContain('156.5')
    expect(stats.text()).toContain('10.5')
    expect(stats.text()).toContain('2026-09-17 19:00')
    // 不足/单源组不进比较统计：只有甲风电场两个成员
    expect(stats.text()).not.toContain('乙光伏电站')
    expect(stats.text()).not.toContain('丙风电场')
  })
})

describe('申报出清实际', () => {
  it('未选不发请求；选定后 semantics 查询带 objectIds；对照表列齐全、null 显示「—」、notes 原文', async () => {
    await mountPage()
    await switchTab('clearing')

    expect(queryCallsOf((request) => request.analysisId === CLEARING_ACTUAL)).toHaveLength(0)
    expect(queryCallsOf((request) => request.analysisId === BUSINESS_FORECAST)).toHaveLength(0)

    pickerOf('ypp-clearing-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === CLEARING_ACTUAL)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.view).toBe('semantics')
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['甲风电场'])

    const table = wrapper!.find('[data-testid="ypp-semantics-table"]')
    expect(table.exists()).toBe(true)
    const labels = wrapper!.findAllComponents({ name: 'ElTableColumn' }).map((column) => String(column.props('label') ?? ''))
    for (const label of ['日前申报电量', '日前出清电量', '实时出清电量', '实际上网电量', '集控实发电量', '分时结算电量（正式）', '中长期电量（合同口径引用）']) {
      expect(labels).toContain(label)
    }
    expect(table.text()).toContain('120.5')
    expect(table.text()).toContain('121.0')
    // 缺失口径（实时出清、分时结算）本窗口无资料：显示「—」，不用其他口径填充
    expect(table.text()).toContain('—')
    expect(wrapper!.text()).toContain('各口径不相加、不差值、不分摊')
    expect(wrapper!.text()).toContain('不用其他口径填充、不按比例分摊')
    // 未纳入对照的口径逐条原因
    expect(wrapper!.text()).toContain('语义对照只对电量口径')
  })

  it('不提供派生偏差列：「偏差对照将在口径确认后提供」，对照表无「偏差」列', async () => {
    await mountPage()
    await switchTab('clearing')
    pickerOf('ypp-clearing-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    expect(wrapper!.text()).toContain('偏差对照将在口径确认后提供')
    const labels = wrapper!.findAllComponents({ name: 'ElTableColumn' }).map((column) => String(column.props('label') ?? ''))
    expect(labels.some((label) => label.includes('偏差'))).toBe(false)
  })

  it('一体化预测曲线联动查询（单视图分析不带 view、共用对象选择）并渲染曲线', async () => {
    await mountPage()
    await switchTab('clearing')
    pickerOf('ypp-clearing-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const calls = queryCallsOf((request) => request.analysisId === BUSINESS_FORECAST)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]!.filters!.view).toBeUndefined()
    expect(calls[0]![0]!.filters!.objectIds).toEqual(['甲风电场'])
    const block = blockOf('一体化预测出力（获权）')!
    expect(block.findAll('.series-chart-stub')).toHaveLength(1)
    expect(block.text()).toContain('与上方对照表同一组场站对象')
  })
})

describe('状态与展示纪律', () => {
  it('结算占位页签：切到后不发任何请求，占位说明可见', async () => {
    await mountPage()
    await switchTab('overview')
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    const callsBefore = vi.mocked(queryInsight).mock.calls.length

    await switchTab('settlement')

    expect(vi.mocked(queryInsight).mock.calls).toHaveLength(callsBefore)
    expect(vi.mocked(fetchInsightCoverage).mock.calls).toHaveLength(coverageCallsOf(DAILY_METRICS).length)
    expect(wrapper!.text()).toContain('结算表现（正式/暂结对照、分项与原件追溯）建设中')
    expect(wrapper!.text()).toContain('本页签不发任何数据请求')
  })

  it('页签懒加载：切走再切回不重查（同签名）', async () => {
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    const callsBefore = vi.mocked(queryInsight).mock.calls.length
    const coverageBefore = coverageCallsOf(DAILY_METRICS).length

    await switchTab('price-output')
    await switchTab('overview')
    expect(vi.mocked(queryInsight).mock.calls).toHaveLength(callsBefore)
    expect(coverageCallsOf(DAILY_METRICS)).toHaveLength(coverageBefore)
  })

  it('单区块失败不影响其他区块：覆盖摘要读取失败时正式日结照常渲染', async () => {
    state.responder = (request) => {
      if (request.analysisId === DAILY_METRICS) {
        return Promise.reject(new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' }))
      }
      return defaultResponder(request)
    }
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const text = wrapper!.text()
    expect(text).toContain('资料读取失败')
    expect(text).toContain('重试')
    expect(text).toContain('500.25')
  })

  it('objectsNote（清单截断说明）原文透出', async () => {
    state.coverageSources = {
      [DAILY_METRICS]: [{ sourceId: 'cgn.plant.daily-metrics', objects: ['甲风电场'], objectsNote: '窗口内对象超过 200 个，仅列前 200 个（按名称排序）' }],
    }
    await mountPage()

    expect(wrapper!.text()).toContain('窗口内对象超过 200 个，仅列前 200 个（按名称排序）')
  })

  it('界面只出现业务语言：不出现来源标识、分析标识与内部字段原文', async () => {
    await mountPage()
    pickerOf('ypp-overview-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    await switchTab('price-output')
    pickerOf('ypp-price-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    await switchTab('forecast')
    pickerOf('ypp-forecast-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()
    await switchTab('clearing')
    pickerOf('ypp-clearing-objects').vm.$emit('update:modelValue', ['甲风电场'])
    await flushPromises()

    const text = wrapper!.text()
    expect(text).not.toContain('cgn.plant')
    expect(text).not.toContain('plants.daily-metrics')
    expect(text).not.toContain('plants.price-capture')
    expect(text).not.toContain('plants.output-series')
    expect(text).not.toContain('plants.clearing-actual')
    expect(text).not.toContain('plants.settlement-daily')
    expect(text).not.toContain('plants.business-forecast')
    expect(text).not.toContain('sourceId')
    expect(text).not.toContain('objectIds')
    expect(text).not.toContain('coverage-summary')
    expect(text).not.toContain('supplier-comparison')
    expect(text).not.toContain('data_type')
    expect(text).not.toContain('dayAheadDeclared')
  })
})
