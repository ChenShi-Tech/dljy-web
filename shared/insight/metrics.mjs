// 指标定义、生效版本、显示精度与排名资格（#2993 任务 3.11，DE12—DE13、D5 第 8/9 条）。
//
// 每个指标引用一份有版本的定义：单位、公式、显示精度与舍入方式、依据类型（官方规则 / 平台分析默认值 / 用户参数）、
// 生效区间，以及排名所需的最低样本与覆盖。计算永远用未舍入的十进制值，格式化只在最后一步做。
// 分析默认值只是平台的分析口径，不冒称已核验的官方规则；跨生效日按适用版本分段，缺历史依据的区间不套今天的规则。

import { decimalCompare, decimalRound, parseDecimal } from '../midlong/decimal.mjs'

/** 依据类型：official 官方规则（需写明出处）· analysis-default 平台分析默认值 · user 用户参数。 */
export const RULE_KINDS = Object.freeze(['official', 'analysis-default', 'user'])
/** 舍入方式：目前只登记十进制四舍五入（半数远离零），与中长期模块同一实现。 */
export const ROUNDING_MODES = Object.freeze(['half-away-from-zero'])

const definition = spec => Object.freeze({
  rounding: 'half-away-from-zero',
  ruleKind: 'analysis-default',
  eligibility: Object.freeze({ minSamples: 1, minCoverageRatio: '0' }),
  effective: Object.freeze([Object.freeze({ from: null, to: null, params: Object.freeze({}) })]),
  ...spec,
})

/**
 * 首批指标（公式与 design D5 核心公式表一致）。basis 写明口径出处；分析默认值上线后按真实样本核对再固化。
 */
export const INSIGHT_METRICS = Object.freeze([
  definition({ metricId: 'price.time-weighted-average', version: '1', label: '时长加权均价', unit: 'yuan/MWh', places: 2, formula: 'Σ(Pt×Δt)/ΣΔt', basis: '有价有效时段；缺槽不缩短分母而是报告覆盖' }),
  definition({ metricId: 'price.negative-duration', version: '1', label: '负价时长', unit: 'h', places: 2, formula: 'ΣΔt(Pt<0)', basis: '按单序列；节点集合另给节点时隙占比' }),
  definition({ metricId: 'price.node-negative-slot-ratio', version: '1', label: '节点时隙负价占比', unit: '%', places: 1, formula: '负价有效节点时长/全部有效节点时长', basis: '与单节点负价时长、负价电量占比分开' }),
  definition({ metricId: 'price.da-rt-spread', version: '1', label: '日前实时价差', unit: 'yuan/MWh', places: 2, formula: 'Pda−Prt（同对象共同有效区间）', basis: '方向固定为日前减实时；不是套利收益' }),
  definition({ metricId: 'price.node-basis', version: '1', label: '节点基差', unit: 'yuan/MWh', places: 2, formula: 'Pnode−Preference（同时段）', basis: '参考对象及权重明确、映射有效' }),
  definition({ metricId: 'plant.capture-price', version: '1', label: '价格捕获参考价', unit: 'yuan/MWh', places: 2, formula: 'Σ(Et×Pnode,t)/ΣEt', basis: '同一发电/上网电量口径；是参考价不是结算收入', eligibility: Object.freeze({ minSamples: 1, minCoverageRatio: '0' }) }),
  definition({ metricId: 'settlement.weighted-average-price', version: '1', label: '结算均价（量费加权）', unit: 'yuan/MWh', places: 2, formula: 'Σ电费/Σ电量（成对有效记录）', basis: '正式或所选暂结分别计算；复用复盘结算统计内核' }),
  definition({ metricId: 'forecast.mae', version: '1', label: '平均绝对误差', unit: 'MW', places: 2, formula: 'Σ|F−A|/n', basis: '同目标、同粒度、同提前量；不等于考核费用', eligibility: Object.freeze({ minSamples: 96, minCoverageRatio: '0.8' }) }),
  definition({ metricId: 'forecast.bias', version: '1', label: '平均偏差', unit: 'MW', places: 2, formula: 'Σ(F−A)/n', basis: '正值表示预测偏高', eligibility: Object.freeze({ minSamples: 96, minCoverageRatio: '0.8' }) }),
  definition({ metricId: 'forecast.energy-error', version: '1', label: '电量误差', unit: 'MWh', places: 3, formula: 'Σ(F−A)×Δt', basis: '仅区间平均功率可积算；绝对误差另列防抵消' }),
  definition({ metricId: 'supply.residual-demand-proxy', version: '1', label: '剩余需求代理（分析代理）', unit: 'MW', places: 1, formula: '负荷+净外送−新能源', basis: '三者同范围同区间且方向明确；不是官方竞价空间，缺一项不可算' }),
])

const BY_ID = new Map(INSIGHT_METRICS.map(item => [item.metricId, item]))

export function getMetricDefinition(metricId) {
  return BY_ID.get(metricId) ?? null
}

/** 登记自检：依据类型、舍入方式、精度、生效区间不重叠、官方规则必须写出处。 */
export function validateMetricDefinitions(list = INSIGHT_METRICS) {
  const errors = []
  const ids = new Set()
  for (const item of list) {
    const where = item.metricId ?? '(缺 metricId)'
    if (ids.has(item.metricId)) errors.push(`${where}: 重复登记`)
    ids.add(item.metricId)
    if (!RULE_KINDS.includes(item.ruleKind)) errors.push(`${where}: 未知依据类型 ${item.ruleKind}`)
    if (!ROUNDING_MODES.includes(item.rounding)) errors.push(`${where}: 未知舍入方式 ${item.rounding}`)
    if (!Number.isInteger(item.places) || item.places < 0 || item.places > 6) errors.push(`${where}: 显示精度应为 0—6 位小数`)
    if (item.ruleKind === 'official' && !item.source) errors.push(`${where}: 官方规则必须写明出处`)
    const periods = [...item.effective].sort((a, b) => String(a.from ?? '').localeCompare(String(b.from ?? '')))
    for (let i = 1; i < periods.length; i++) {
      if (periods[i - 1].to === null || periods[i].from === null || periods[i - 1].to >= periods[i].from) errors.push(`${where}: 生效区间重叠`)
    }
  }
  return errors
}

/**
 * 按生效区间切分业务窗（DE13）：每段引用当时适用的定义版本；没有定义覆盖的日期单独成段，
 * 标 no-historical-basis——不能拿今天的规则去认定过去。
 * @returns {Array<{ start: string, end: string, effective: object|null, reason: null|'no-historical-basis' }>}
 */
export function resolveEffectiveSegments(metricOrId, window) {
  const metric = typeof metricOrId === 'string' ? getMetricDefinition(metricOrId) : metricOrId
  if (!metric) throw new Error(`未登记的指标：${metricOrId}`)
  const DAY = 86_400_000
  const day = date => Date.parse(`${date}T00:00:00Z`)
  const iso = ms => new Date(ms).toISOString().slice(0, 10)
  const segments = []
  for (let t = day(window.start); t <= day(window.end); t += DAY) {
    const date = iso(t)
    const effective = metric.effective.find(item => (item.from === null || item.from <= date) && (item.to === null || date <= item.to)) ?? null
    const last = segments.at(-1)
    if (last && last.effective === effective) last.end = date
    else segments.push({ start: date, end: date, effective, reason: effective ? null : 'no-historical-basis' })
  }
  return segments
}

/**
 * 显示格式化：按登记精度用十进制四舍五入（半数远离零）。输入必须是未舍入的规范十进制值；
 * null 原样返回（缺数不显示成 0）。
 */
export function formatMetricValue(metricId, value) {
  if (value === null || value === undefined) return null
  const metric = getMetricDefinition(metricId)
  if (!metric) throw new Error(`未登记的指标：${metricId}`)
  const parsed = parseDecimal(value, { allowNegative: true })
  if (!parsed.ok) throw new Error(`指标值不是合法十进制数：${String(value)}`)
  return decimalRound(parsed.value, metric.places)
}

/**
 * 排名（DE13、D5 第 9 条）：先按共同样本与资格门槛筛选，不合格项可查看但不参与排名；
 * 再按未舍入值排序，相同值按规范对象 ID 稳定排列并标记并列，并列者名次相同。
 * @param {Array<{ objectId: string, value: string|null, samples: number, coverageRatio: string }>} items
 * @param {{ metricId: string, direction: 'asc'|'desc' }} options asc 表示越小越好（如误差）
 */
export function rankEligible(items, { metricId, direction }) {
  const metric = getMetricDefinition(metricId)
  if (!metric) throw new Error(`未登记的指标：${metricId}`)
  if (!['asc', 'desc'].includes(direction)) throw new Error('排名方向只能是 asc 或 desc')
  const ineligible = []
  const eligible = []
  for (const item of items) {
    if (item.value === null || item.value === undefined) ineligible.push({ objectId: item.objectId, reason: 'no-value' })
    else if (!(item.samples >= metric.eligibility.minSamples)) ineligible.push({ objectId: item.objectId, reason: 'insufficient-samples', samples: item.samples, required: metric.eligibility.minSamples })
    else if (decimalCompare(item.coverageRatio ?? '0', metric.eligibility.minCoverageRatio) < 0) ineligible.push({ objectId: item.objectId, reason: 'insufficient-coverage', coverageRatio: item.coverageRatio, required: metric.eligibility.minCoverageRatio })
    else eligible.push(item)
  }
  const sign = direction === 'asc' ? 1 : -1
  eligible.sort((a, b) => sign * decimalCompare(a.value, b.value) || a.objectId.localeCompare(b.objectId))
  const ranked = []
  eligible.forEach((item, index) => {
    const previous = ranked.at(-1)
    const tied = Boolean(previous) && decimalCompare(previous.value, item.value) === 0
    const rank = tied ? previous.rank : index + 1
    if (tied) previous.tied = true
    ranked.push({ objectId: item.objectId, value: item.value, rank, tied })
  })
  return { metricId, definitionVersion: metric.version, eligibility: metric.eligibility, ranked, ineligible: ineligible.sort((a, b) => a.objectId.localeCompare(b.objectId)) }
}
