// 市场洞察分析目录（#2993 任务 3.1，D4）：只有登记在这里的 analysisId 才能被查询。
//
// 每项声明：页面归属、适用地区、访问范围、允许的来源、可用筛选与查询上限。
// 访问范围取来源里最严格的一项——混用公开价格与公司私有电量的结果继承公司私有范围（CH05）。
// 其他地区不会因为这里登记了云南分析而自动获得它（RS01）：regionIds 是白名单。

import { INSIGHT_ERRORS, InsightContractError, MAX_WINDOW_DAYS } from './contract.mjs'
import { getInsightSource } from './sources.mjs'

/** HTTP 接口目录（D4）。读接口的 POST 不产生业务写入，productionWrite 恒为 false。 */
export const INSIGHT_ENDPOINTS = Object.freeze({
  capabilities: Object.freeze({ method: 'GET', path: '/api/v1/market-insight/capabilities' }),
  coverage: Object.freeze({ method: 'POST', path: '/api/v1/market-insight/coverage' }),
  query: Object.freeze({ method: 'POST', path: '/api/v1/market-insight/query' }),
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
    analysisId: 'plants.output-series', title: '场站出力八类曲线（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.output'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50 },
  }),
  analysis({
    analysisId: 'plants.settlement-daily', title: '场站日结算与源系统损失（获权）',
    pageIds: ['plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.plant.settlement-daily', 'cgn.plant.loss-daily'],
    filters: { objectIds: objectIdsFilter(200) }, limits: { maxObjects: 200 },
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
