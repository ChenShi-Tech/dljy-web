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
  return Object.freeze({
    version: '1',
    ...definition,
    filters: Object.freeze({ resolutionMinutes: resolutionFilter, ...definition.filters }),
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
      'yn.system.load.forecast', 'yn.system.new-energy.forecast-d1', 'yn.system.non-market.forecast',
      'csg.system.load.actual', 'csg.system.hydro.actual', 'csg.system.new-energy.actual', 'csg.system.non-market.actual', 'csg.system.total-generation.actual',
      'csg.system.load.forecast', 'csg.system.new-energy.forecast-d1', 'csg.system.total-generation.forecast',
    ],
    limits: { maxDays: 31 },
  }),
  analysis({
    analysisId: 'prices.user-series', title: '云南用户侧日前/实时价格',
    pageIds: ['overview', 'prices'], regionIds: ['yunnan'],
    sourceIds: ['yn.price.user.day-ahead', 'yn.price.user.real-time'],
  }),
  analysis({
    analysisId: 'prices.public-node-series', title: '云南公开历史节点价格',
    pageIds: ['prices'], regionIds: ['yunnan'],
    sourceIds: ['yn.price.node.public.day-ahead', 'yn.price.node.public.real-time'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'prices.company-node-series', title: '厂侧节点价格（获权）',
    pageIds: ['prices'], regionIds: ['yunnan'],
    sourceIds: ['cgn.price.node.day-ahead', 'cgn.price.node.real-time'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
  }),
  analysis({
    analysisId: 'prices.plant-node-series', title: '场站关联节点价格（获权）',
    pageIds: ['prices', 'plants'], regionIds: ['yunnan'],
    sourceIds: ['cgn.price.plant-node.day-ahead', 'cgn.price.plant-node.real-time', 'cgn.plant.nodal-price'],
    filters: { objectIds: objectIdsFilter(50) }, limits: { maxDays: 31, maxObjects: 50, requiresObjects: true },
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
