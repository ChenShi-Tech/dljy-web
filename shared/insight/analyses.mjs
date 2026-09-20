// 市场洞察分析目录（#2993 任务 3.1，D4）：只有登记在这里的 analysisId 才能被查询。
//
// 每项声明：页面归属、适用地区、访问范围、允许的来源、可用筛选与查询上限。
// 访问范围取来源里最严格的一项——混用公开价格与公司私有电量的结果继承公司私有范围（CH05）。
// 其他地区不会因为这里登记了云南分析而自动获得它（RS01）：regionIds 是白名单。

import { INSIGHT_ERRORS, InsightContractError, MAX_WINDOW_DAYS } from './contract.mjs'
import { RECORD_KINDS, getInsightSource } from './sources.mjs'

/** HTTP 接口目录（D4）。读接口的 POST 不产生业务写入，productionWrite 恒为 false。 */
export const INSIGHT_ENDPOINTS = Object.freeze({
  capabilities: Object.freeze({ method: 'GET', path: '/api/v1/market-insight/capabilities' }),
  coverage: Object.freeze({ method: 'POST', path: '/api/v1/market-insight/coverage' }),
  query: Object.freeze({ method: 'POST', path: '/api/v1/market-insight/query' }),
  researchPreview: Object.freeze({ method: 'POST', path: '/api/v1/market-insight/research/preview' }),
})

const fail = (message, details) => { throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, message, details) }
const ID_RE = /^[A-Za-z0-9一-龥][A-Za-z0-9一-龥._:\-/（）()Ⅰ-Ⅻ#·\s]{0,119}$/

/** 对象标识列表筛选：去重、限量、逐项校验格式。 */
export function objectIdsFilter(max) {
  return value => {
    if (!Array.isArray(value) || !value.length) fail('请至少选择一个对象')
    if (value.length > max) throw new InsightContractError(INSIGHT_ERRORS.LIMIT_EXCEEDED, `一次最多选择 ${max} 个对象`, { maxObjects: max })
    if (value.some(item => typeof item !== 'string' || !ID_RE.test(item))) fail('对象标识格式不正确')
    if (new Set(value).size !== value.length) fail('对象选择有重复')
    return Object.freeze([...value])
  }
}

/**
 * 视图筛选（#3004）：同一分析的明细、摘要、价差、切面、基差共用读取版本集合，只是呈现不同（D4.1）。
 * 允许的视图随分析登记；不支持的视图直接说明原因，不回一个空结果。
 */
export function viewFilter(allowed) {
  return value => {
    if (!allowed.includes(value)) fail(`该分析支持的视图：${allowed.join('、')}`, { allowedViews: allowed })
    return value
  }
}

/** 节点基差的参考对象：显式指定、格式同对象标识；是否在所选对象里由查询层核对。 */
export function referenceObjectFilter(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail('参考对象标识格式不正确')
  return value
}

/** 目标粒度筛选：只能汇总到更粗的已登记粒度（15/60/1440 分钟），细化由内核拒绝。 */
export function resolutionFilter(value) {
  if (![15, 60, 1440].includes(value)) fail('汇总粒度只能是 15、60 或 1440 分钟')
  return value
}

function analysis(definition) {
  const sources = definition.sourceIds.map(id => {
    const entry = getInsightSource(id)
    if (!entry) throw new Error(`分析 ${definition.analysisId} 引用了未登记的来源 ${id}`)
    return entry
  })
  const access = sources.some(entry => entry.accessScope === 'company') ? 'company' : 'public'
  const views = Object.freeze([...(definition.views ?? ['series'])])
  if (views.length > 1 && !definition.viewFamily) throw new Error(`分析 ${definition.analysisId} 登记了多个视图，必须声明视图族`)
  // 是否/清单类来源不是数值时序（GB03）：只能单独组成记录视图分析，不与曲线混在一起，也不给曲线视图。
  const recordSources = sources.filter(entry => RECORD_KINDS.includes(entry.measure.kind))
  const recordsFamily = definition.viewFamily === 'records'
  if (recordSources.length && (recordSources.length !== sources.length || !recordsFamily)) throw new Error(`分析 ${definition.analysisId}：是否/清单类来源只能单独组成记录视图分析`)
  if (recordsFamily && (!recordSources.length || views.some(view => view !== 'records'))) throw new Error(`分析 ${definition.analysisId}：记录视图分析只能读是否/清单类来源、只给记录视图`)
  return Object.freeze({
    version: '1',
    viewFamily: null,
    ...definition,
    views,
    filters: Object.freeze({
      resolutionMinutes: resolutionFilter,
      ...(views.length > 1 ? { view: viewFilter(views) } : {}),
      ...(views.includes('basis') ? { referenceObjectId: referenceObjectFilter } : {}),
      ...definition.filters,
    }),
    sourceIds: Object.freeze([...definition.sourceIds]),
    access,
    limits: Object.freeze({ maxDays: MAX_WINDOW_DAYS, maxObjects: 0, requiresObjects: false, ...definition.limits }),
  })
}

export const INSIGHT_ANALYSES = Object.freeze([
  analysis({
    analysisId: 'supply.system-series', title: '云南系统曲线（负荷、电源、非市场，含南网整体背景）',
    pageIds: ['overview', 'supply'], regionIds: ['yunnan'],
    sourceIds: [
      'yn.system.load.actual', 'yn.system.hydro.actual', 'yn.system.new-energy.actual', 'yn.system.non-market.actual', 'yn.system.total-generation.actual',
      'yn.system.load.forecast', 'yn.system.new-energy.forecast-d1', 'yn.system.non-market.forecast', 'yn.transfer.send-out.forecast',
      'csg.system.load.actual', 'csg.system.hydro.actual', 'csg.system.new-energy.actual', 'csg.system.non-market.actual', 'csg.system.total-generation.actual',
      'csg.system.load.forecast', 'csg.system.new-energy.forecast-d1', 'csg.system.total-generation.forecast',
    ],
    limits: { maxDays: 31 },
    // 供需视图（#3005）：统计与分类、预测与实际配对、剩余需求代理
    viewFamily: 'supply', views: ['series', 'summary', 'forecast-error', 'residual-proxy'],
  }),
  analysis({
    // 市场总览重点事项（#3006，OV03/OV04）：规则与阈值在 overview.mjs 登记；同进度比较要读前一日作参考期
    analysisId: 'overview.key-items', title: '市场总览重点事项', pageIds: ['overview'], regionIds: ['yunnan'],
    sourceIds: ['yn.price.user.day-ahead', 'yn.price.user.real-time', 'yn.system.load.actual', 'yn.system.load.forecast', 'yn.system.new-energy.actual'],
    viewFamily: 'overview', views: ['key-items', 'series'], reference: { days: 1, views: ['key-items'] },
    limits: { maxDays: 7 },
  }),
  analysis({
    // 水电周出力（#3005，SH02）：私有渠道的逐日平均出力，按区域分列；云南与其他省不相加
    analysisId: 'supply.hydro-weekly-output', title: '水电周出力预测（按区域，获权）',
    pageIds: ['supply'], regionIds: ['yunnan'],
    sourceIds: ['cgn.hydro.weekly-output.forecast'],
    filters: { objectIds: objectIdsFilter(10) }, limits: { maxDays: 31, maxObjects: 10 },
  }),
  analysis({
    // 云南水电机组群组成与占比（#3005，SH02）：只有占比，没有上限值
    analysisId: 'supply.hydro-unit-groups', title: '云南水电机组群组成与机组出力占比（获权）',
    pageIds: ['supply'], regionIds: ['yunnan'],
    sourceIds: ['cgn.hydro.yn-group-share'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50 },
  }),
  analysis({
    // 跨省与电网边界（#3022，GB01/GB02）：通道流量与断面限值只在同名、同方向、同一时段配对
    analysisId: 'grid.channel-flows', title: '省间联络线、重点通道与断面限值（获权）',
    pageIds: ['grid-boundaries'], regionIds: ['yunnan'],
    sourceIds: ['cgn.grid.tie-line.actual', 'cgn.grid.key-channel.actual', 'cgn.grid.key-line-transformer.actual', 'cgn.grid.section-constraint.actual', 'cgn.grid.external-tie-line.forecast'],
    viewFamily: 'grid', views: ['series', 'limit-match'],
    filters: { objectIds: objectIdsFilter(30) }, limits: { maxDays: 7, maxObjects: 30 },
  }),
  analysis({
    analysisId: 'grid.transfer-daily', title: '送电电量下限、通道能力与断面负载（日，获权）',
    pageIds: ['grid-boundaries'], regionIds: ['yunnan'],
    sourceIds: ['cgn.grid.priority-limit.forecast', 'cgn.grid.transmission-capacity.forecast', 'cgn.grid.stable-section.actual', 'cgn.grid.section-congestion.actual', 'cgn.grid.load-summary.actual'],
    limits: { maxDays: 31 },
  }),
  analysis({
    // 备用与机组（#3022，GB03）：容量、占比、权重按原义分列，不换算出力
    analysisId: 'grid.reserve-units', title: '备用、检修容量与机组群（获权）',
    pageIds: ['grid-boundaries'], regionIds: ['yunnan'],
    sourceIds: ['cgn.reserve.peak.actual', 'cgn.reserve.forecast', 'cgn.units.non-da-new-energy-capacity', 'cgn.units.maintenance-capacity', 'cgn.units.price-weight', 'cgn.units.group-share'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50 },
  }),
  analysis({
    // 是否调峰、必开必停清单：记录不是时序，只给记录视图
    analysisId: 'grid.unit-lists', title: '是否调峰与必开必停清单（获权）',
    pageIds: ['grid-boundaries'], regionIds: ['yunnan'],
    sourceIds: ['cgn.units.peak-regulation', 'cgn.units.must-run-stop'],
    viewFamily: 'records', views: ['records'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50 },
  }),
  analysis({
    analysisId: 'prices.user-series', title: '云南用户侧日前/实时价格',
    pageIds: ['overview', 'prices'], regionIds: ['yunnan'],
    sourceIds: ['yn.price.user.day-ahead', 'yn.price.user.real-time'],
    // 用户侧价没有节点维度：不提供节点基差（PR02）
    viewFamily: 'price', views: ['series', 'summary', 'spread', 'profile'],
  }),
  analysis({
    analysisId: 'prices.public-node-series', title: '云南公开历史节点价格',
    pageIds: ['prices'], regionIds: ['yunnan'],
    sourceIds: ['yn.price.node.public.day-ahead', 'yn.price.node.public.real-time'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'price', views: ['series', 'summary', 'spread', 'profile', 'basis'],
  }),
  analysis({
    analysisId: 'prices.company-node-series', title: '厂侧节点价格（获权）',
    pageIds: ['prices'], regionIds: ['yunnan'],
    sourceIds: ['cgn.price.node.day-ahead', 'cgn.price.node.real-time'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'price', views: ['series', 'summary', 'spread', 'profile', 'basis'],
  }),
  analysis({
    analysisId: 'prices.plant-node-series', title: '场站关联节点价格（获权）',
    pageIds: ['prices', 'plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.price.plant-node.day-ahead', 'cgn.price.plant-node.real-time', 'cgn.plant.nodal-price'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'price', views: ['series', 'summary', 'spread', 'profile', 'basis'],
  }),
  analysis({
    analysisId: 'grid.boundary-series', title: '跨省送受与公开披露度量',
    pageIds: ['grid-boundaries'], regionIds: ['yunnan'],
    sourceIds: ['csg.transfer.inter-provincial.forecast', 'csg.disclosure.stable-section', 'csg.disclosure.reserve.forecast'],
    limits: { maxDays: 31 },
  }),
  analysis({
    // 八类厂站曲线（#3028 任务 11.3）：供应商比较按共同场站×时段组织，共同样本不足只并列展示
    analysisId: 'plants.output-series', title: '场站出力八类曲线（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.output'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50 },
    viewFamily: 'plants', views: ['series', 'supplier-comparison'],
  }),
  analysis({
    // 价格捕获参考（#3028 任务 11.2，PP03）：同口径上网电量 × 场站节点价，Σ(Et×P)/ΣE；
    // 多节点分列，参考价不是收入。价格不双计：节点价唯一来源是 cgn.plant.nodal-price
    analysisId: 'plants.price-capture', title: '场站价格捕获参考（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.business-actual', 'cgn.plant.nodal-price'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'plants', views: ['series', 'capture'],
  }),
  analysis({
    analysisId: 'plants.settlement-daily', title: '场站日结算与源系统损失（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.settlement-daily', 'cgn.plant.loss-daily'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxObjects: 200 },
    // 损失解释（#3081 任务 12.3，ST03—ST04）：源值照常展示，电网损失全空保持未提供，
    // 分项不齐不做完整瀑布、只给「未解释差额」
    viewFamily: 'plants', views: ['series', 'loss-explain'],
  }),
  // 正式/暂结同键差异（#3081 任务 12.1，ST01、A08）：正式读模型 vs 暂结原始证据，
  // 两态都在才比差异，不相加；只有暂结的日期显式说明，无正式不静默用暂结
  analysis({
    analysisId: 'plants.settlement-status-diff', title: '场站日结算正式/暂结差异（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.settlement-daily', 'cgn.settlement.daily-settlement-temp'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxObjects: 200 },
    viewFamily: 'plants', views: ['series', 'status-diff'],
  }),
  // ── 五月月包余量分析（#3026 接入通道；数据落库前诚实缺数，#3027 补录后可查）──────────
  analysis({
    // 申报、出清、上网、集控实发对照（PP06）：量纲同为 MWh 但口径分开，语义对照视图并列不相加；
    // 中长期电量以「合同口径引用」单独成列（plants.midlong-reference 的来源）
    analysisId: 'plants.clearing-actual', title: '申报、出清、上网与集控实发对照（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: [
      'cgn.plant.spot-clearing-day-ahead', 'cgn.plant.spot-clearing-real-time',
      'cgn.plant.business-declared', 'cgn.plant.business-actual', 'cgn.plant.control-generation',
      'cgn.plant.midlong-energy',
    ],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'plants', views: ['series', 'semantics'],
  }),
  analysis({
    analysisId: 'plants.business-forecast', title: '一体化预测出力（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.business-integrated-forecast'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'plants.midlong-reference', title: '场站历史中长期电量与合同价（只读引用，获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.midlong-energy', 'cgn.plant.midlong-price'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'plants.daily-metrics', title: '场站日报指标（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.daily-metrics'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxDays: 31, maxObjects: 200, requiresObjects: true },
    // 覆盖摘要（#3028 任务 11.1）：宽表六字段各自独立统计有效样本
    viewFamily: 'plants', views: ['series', 'coverage-summary'],
  }),
  analysis({
    analysisId: 'plants.settlement-interval', title: '分时结算电量电费（正式/暂结，获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.settlement-interval-formal', 'cgn.plant.settlement-interval-temp'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    // 语义对照（#3028 任务 11.4）：分时结算电量列进对照表；电费与单价不进（只对电量口径）。
    // 结算统计（#3081 任务 12.2，ST02）：量费加权均价等按来源分别算，formal/temp 不互加。
    viewFamily: 'plants', views: ['series', 'semantics', 'settlement-stats'],
  }),
  // 结算单据与核对（#3081 任务 12.4，ST05—ST06）：账单索引/下载/单元格/月结载荷/拆分审批
  // 是记录（含月周期资料），只给记录视图；正式核对另见 plants.settlement-reconcile
  analysis({
    analysisId: 'plants.settlement-docs', title: '结算单据与原件引用（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.settlement.bill-records', 'cgn.settlement.bill-downloads', 'cgn.settlement.bill-cells', 'cgn.settlement.monthly-doc', 'cgn.settlement.daily-split'],
    viewFamily: 'records', views: ['records'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxObjects: 200 },
  }),
  // 日报/日结/月结同周期核对（#3081 任务 12.4，ST05）：不同周期不相加不互比，
  // 同周期差异列带来源引用；缺测说明参与质量过滤
  analysis({
    analysisId: 'plants.settlement-reconcile', title: '日报、日结与月结核对（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.daily-metrics', 'cgn.plant.settlement-daily', 'cgn.settlement.monthly-total'],
    viewFamily: 'plants', views: ['reconcile'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxObjects: 200, requiresObjects: true },
  }),
  // ── 五月月包余量分析（#3026 接入通道；数据落库前诚实缺数，#3027 补录后可查）──────────
  analysis({
    // 申报、出清、上网、集控实发对照（PP06）：量纲同为 MWh 但口径分开，语义对照视图并列不相加；
    // 中长期电量以「合同口径引用」单独成列（plants.midlong-reference 的来源）
    analysisId: 'plants.clearing-actual', title: '申报、出清、上网与集控实发对照（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: [
      'cgn.plant.spot-clearing-day-ahead', 'cgn.plant.spot-clearing-real-time',
      'cgn.plant.business-declared', 'cgn.plant.business-actual', 'cgn.plant.control-generation',
      'cgn.plant.midlong-energy',
    ],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    viewFamily: 'plants', views: ['series', 'semantics'],
  }),
  analysis({
    analysisId: 'plants.business-forecast', title: '一体化预测出力（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.business-integrated-forecast'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'plants.midlong-reference', title: '场站历史中长期电量与合同价（只读引用，获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.midlong-energy', 'cgn.plant.midlong-price'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'plants.daily-metrics', title: '场站日报指标（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.daily-metrics'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxDays: 31, maxObjects: 200, requiresObjects: true },
    // 覆盖摘要（#3028 任务 11.1）：宽表六字段各自独立统计有效样本
    viewFamily: 'plants', views: ['series', 'coverage-summary'],
  }),
  analysis({
    analysisId: 'plants.settlement-interval', title: '分时结算电量电费（正式，获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.settlement-interval-formal'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
    // 语义对照（#3028 任务 11.4）：分时结算电量列进对照表；电费与单价不进（只对电量口径）
    viewFamily: 'plants', views: ['series', 'semantics'],
  }),
])

const BY_ID = new Map(INSIGHT_ANALYSES.map(entry => [entry.analysisId, entry]))

/** 目录查询：未登记返回 null，由契约层转成 404。 */
export function getInsightAnalysis(analysisId) {
  return BY_ID.get(analysisId) ?? null
}

/** 某地区可用的分析；未登记地区返回空列表，不借用其他地区的登记。 */
export function listInsightAnalyses(regionId) {
  return INSIGHT_ANALYSES.filter(entry => entry.regionIds.includes(regionId))
}

export const insightCatalog = Object.freeze({ getAnalysis: getInsightAnalysis })
