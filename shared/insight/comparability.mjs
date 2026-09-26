// 可比性判定（#2993 任务 3.5，DE04）：两份输入能否做差、配对、合并统计，不能就给出具体原因。
//
// 这里只做「能不能比」的判断，不产生数值。任何派生指标先过这一关：不可比时调用方只能分别展示，
// 不能算误差、价差、占比或合计（南网整体预测 × 云南实际、用户侧价 × 场站结算价都停在这里）。

import { getInsightSource } from './sources.mjs'

/**
 * 比较目的：
 *   spread         同一经济对象日前减实时（PR04）——价格对象、单位一致，市场阶段必须不同
 *   forecast-error 预测与实际配对（SH03）——同对象、同范围、同度量，一份预测一份实际
 *   basis          节点基差（PR05）——价格对象、市场阶段、单位一致；对象可以不同（参考对象须显式给出）
 *   sum            合计——范围与度量一致且可加（价格不可加）
 *   correlation    相关/分组比较——允许不同度量，但业务范围必须一致
 */
export const COMPARISON_PURPOSES = Object.freeze(['spread', 'forecast-error', 'basis', 'sum', 'correlation'])

const ADDITIVE_KINDS = new Set(['energy', 'amount', 'power', 'capacity'])

const reason = (code, detail) => Object.freeze({ code, detail })

/** 把 sourceId 或已展开的描述统一成可比较的字段集合。 */
function describe(input) {
  // 允许三种写法：sourceId 字符串；{ sourceId, objectRef }（按登记展开）；完整描述对象。
  const base = typeof input === 'string' ? getInsightSource(input)
    : input?.sourceId && !input.measure && !input.measureKind ? getInsightSource(input.sourceId) : input
  if (!base) return null
  return {
    sourceId: base.sourceId ?? null,
    businessScope: base.businessScope,
    objectRef: typeof input === 'string' ? null : input.objectRef ?? null,
    measureKind: base.measure?.kind ?? base.measureKind,
    unit: base.measure?.unit ?? base.unit,
    marketPhase: base.marketPhase ?? null,
    priceObject: base.priceObject ?? null,
    variant: base.variant ?? null,
  }
}

const sameObject = (a, b) => JSON.stringify(a.objectRef) === JSON.stringify(b.objectRef)

/**
 * @param {string|object} left sourceId 或 { ...source, objectRef }
 * @param {string|object} right
 * @param {{ purpose: string }} options
 * @returns {{ status: 'compatible'|'incompatible'|'insufficient', reasons: Array<{code:string, detail:string}> }}
 */
export function assessComparability(left, right, { purpose }) {
  if (!COMPARISON_PURPOSES.includes(purpose)) throw new Error(`未登记的比较目的：${purpose}`)
  const a = describe(left), b = describe(right)
  if (!a || !b) return { status: 'insufficient', reasons: [reason('unknown-source', '来源未登记，无法判断口径')] }
  const reasons = []
  if (a.businessScope !== b.businessScope) reasons.push(reason('scope-mismatch', `业务范围不同：${a.businessScope} 与 ${b.businessScope}`))
  if (purpose !== 'correlation') {
    if (a.measureKind !== b.measureKind) reasons.push(reason('measure-mismatch', `度量种类不同：${a.measureKind} 与 ${b.measureKind}`))
    if (a.unit !== b.unit) reasons.push(reason('unit-mismatch', `单位不同：${a.unit} 与 ${b.unit}`))
    if (a.priceObject !== b.priceObject) reasons.push(reason('price-object-mismatch', `价格对象不同：${a.priceObject ?? '无'} 与 ${b.priceObject ?? '无'}`))
  }
  if ((purpose === 'spread' || purpose === 'forecast-error') && !sameObject(a, b)) reasons.push(reason('object-mismatch', '不是同一个经济对象'))
  if (purpose === 'spread') {
    if (a.measureKind !== 'price') reasons.push(reason('not-price', '日前实时价差只对价格成立'))
    if (!a.marketPhase || !b.marketPhase || a.marketPhase === b.marketPhase) reasons.push(reason('phase-mismatch', '价差需要一份日前、一份实时'))
  }
  if (purpose === 'forecast-error') {
    const variants = new Set([a.variant, b.variant])
    if (!(variants.has('forecast') && variants.has('actual'))) reasons.push(reason('variant-mismatch', '预测误差需要一份预测与一份实际'))
  }
  if (purpose === 'basis') {
    if (a.measureKind !== 'price') reasons.push(reason('not-price', '基差只对价格成立'))
    if (a.marketPhase !== b.marketPhase) reasons.push(reason('phase-mismatch', '基差两侧必须是同一市场阶段'))
    if (!a.objectRef || !b.objectRef) reasons.push(reason('reference-missing', '基差必须明确所选对象与参考对象'))
  }
  if (purpose === 'sum' && !ADDITIVE_KINDS.has(a.measureKind)) reasons.push(reason('not-additive', `「${a.measureKind}」类数据不能相加`))
  return reasons.length ? { status: 'incompatible', reasons } : { status: 'compatible', reasons: [] }
}

/** 多份输入两两判定，任一不可比即整体不可比，原因去重后合并。 */
export function assessAll(inputs, options) {
  const reasons = new Map()
  let status = 'compatible'
  for (let i = 1; i < inputs.length; i++) {
    const result = assessComparability(inputs[0], inputs[i], options)
    if (result.status !== 'compatible') {
      status = status === 'incompatible' || result.status === 'incompatible' ? 'incompatible' : 'insufficient'
      for (const item of result.reasons) reasons.set(`${item.code}:${item.detail}`, item)
    }
  }
  return { status, reasons: [...reasons.values()] }
}
