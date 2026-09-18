// 套保区间判级与方案校验（openspec build-midlong-spot-hedging，HB-01—HB-06、HM-04）。
//
// 判级只对 STANDARD_METRIC_RULE 列出的标准指标执行，使用生效方案中该指标对应的
// 期限档与判级依据；判级依据之外的另一个套保率值只展示，不判级（HM-04）。
// 未评估的情形一律显式给原因，MUST NOT 默认为安全（HA-01）。
// 零依赖纯函数；界限与比率都是十进制字符串。

import { decimalCompare } from '../midlong/decimal.mjs'
import { BAND_LIMIT_HIGH, BAND_LIMIT_LOW, STANDARD_METRIC_RULE } from './contract.mjs'

/**
 * 方案校验（HB-03）：界限取值 0—200%；同一档同时设定上下限时下限必须小于上限。
 * 允许只设一侧。校验失败返回 { ok:false, code:'BAND_TIER_INVALID', details:{ field } }，
 * field 形如 'tiers.DAY_AHEAD.upper'，页面据此定位字段。
 */
export function validateSchemeTiers({ tiers }) {
  for (const [tier, band] of Object.entries(tiers ?? {})) {
    if (band === null || band === undefined) continue
    const { lower = null, upper = null } = band
    for (const [side, value] of [['lower', lower], ['upper', upper]]) {
      if (value === null) continue
      if (decimalCompare(value, BAND_LIMIT_LOW) < 0 || decimalCompare(value, BAND_LIMIT_HIGH) > 0) {
        return invalid(`tiers.${tier}.${side}`, `界限必须在 0 到 200% 之间（${tier}.${side}）`)
      }
    }
    if (lower !== null && upper !== null && decimalCompare(lower, upper) >= 0) {
      return invalid(`tiers.${tier}.lower`, `${tier} 档下限必须小于上限`)
    }
  }
  return { ok: true }
}

function invalid(field, message) {
  const error = new Error(message)
  error.code = 'BAND_TIER_INVALID'
  error.details = { field }
  return { ok: false, code: 'BAND_TIER_INVALID', details: { field }, message }
}

/**
 * 按标准指标取该指标对应的期限档界限（HB-02 对照表）。
 * 没有生效方案 → NO_ACTIVE_SCHEME；档位整体未设定（lower 与 upper 都为 null）→ TIER_NOT_SET，
 * MUST NOT 借用其他档的数值。
 */
export function resolveMetricBand({ scheme, metric }) {
  if (!scheme) return { band: null, tier: null, reason: 'NO_ACTIVE_SCHEME' }
  const rule = STANDARD_METRIC_RULE[metric]
  if (!rule) return { band: null, tier: null, reason: 'NON_STANDARD_WINDOW' }
  const band = scheme.tiers?.[rule.tier] ?? null
  if (!band || (band.lower == null && band.upper == null)) return { band: null, tier: rule.tier, reason: 'TIER_NOT_SET' }
  return { band: { lower: band.lower ?? null, upper: band.upper ?? null }, tier: rule.tier, reason: null }
}

/**
 * 单值判级（HM-04/HB-03）：低于下限 → UNDER；高于上限 → OVER；区间内 → WITHIN。
 * 只设一侧时另一侧不判级：比率落在已设一侧之内 → WITHIN 并带「上限未设定/下限未设定」提示
 * （HB-03 场景：只设下限 70%，比率 130% 不判过保，显示「区间内（上限未设定）」）。
 * ratio 为 null（不可计算/不完整）时不在这里处理——调用方先把状态转成未评估。
 */
export function assessValue({ band, ratio }) {
  if (!band) return { level: 'NOT_ASSESSED', reason: 'NO_ACTIVE_SCHEME', hints: [] }
  if (ratio === null || ratio === undefined) return { level: 'NOT_ASSESSED', reason: 'NOT_COMPUTABLE', hints: [] }
  const hints = []
  const { lower = null, upper = null } = band
  if (lower !== null && decimalCompare(ratio, lower) < 0) return { level: 'UNDER', reason: null, hints }
  if (upper !== null && decimalCompare(ratio, upper) > 0) return { level: 'OVER', reason: null, hints }
  if (upper === null) hints.push('UPPER_NOT_SET')
  if (lower === null) hints.push('LOWER_NOT_SET')
  return { level: 'WITHIN', reason: null, hints }
}

/**
 * 标准指标完整判级入口（HM-04）：
 * - metric 为 null（非标准窗口）→ NOT_ASSESSED: NON_STANDARD_WINDOW；
 * - ratioStatus 携带的不可计算/不完整/机制不完整/无权限等原因 → 直接作为未评估原因；
 * - stationScope 且 unallocatedPresent → NOT_ASSESSED: UNALLOCATED_PRESENT（场站锁价量被低估）。
 * 返回 { level, reason, hints, tier, basis }；basis 是生效方案的判级依据
 * （WITH_MECHANISM / MIDLONG_ONLY），判级只按它对应的那个值执行。
 */
export function assessMetric({
  scheme,
  metric = null,
  ratio = null,
  ratioStatus = 'OK',
  unallocatedPresent = false,
  stationScope = false,
  legFailed = false,
  forbidden = false,
  regionUnsupported = false,
  noCredential = false,
}) {
  if (metric === null) return { level: 'NOT_ASSESSED', reason: 'NON_STANDARD_WINDOW', hints: [], tier: null, basis: null }
  if (regionUnsupported) return { level: 'NOT_ASSESSED', reason: 'REGION_UNSUPPORTED', hints: [], tier: null, basis: null }
  if (noCredential) return { level: 'NOT_ASSESSED', reason: 'NO_CREDENTIAL', hints: [], tier: null, basis: null }
  if (forbidden) return { level: 'NOT_ASSESSED', reason: 'FORBIDDEN', hints: [], tier: null, basis: null }
  if (legFailed) return { level: 'NOT_ASSESSED', reason: 'LEG_FAILED', hints: [], tier: null, basis: null }
  if (ratioStatus === 'NOT_COMPUTABLE') return { level: 'NOT_ASSESSED', reason: 'NOT_COMPUTABLE', hints: [], tier: null, basis: scheme?.basis ?? null }
  if (ratioStatus === 'MECHANISM_INCOMPLETE') return { level: 'NOT_ASSESSED', reason: 'MECHANISM_INCOMPLETE', hints: [], tier: null, basis: scheme?.basis ?? null }
  if (ratioStatus === 'INCOMPLETE_COVERAGE') return { level: 'NOT_ASSESSED', reason: 'INCOMPLETE_COVERAGE', hints: [], tier: null, basis: scheme?.basis ?? null }
  if (stationScope && unallocatedPresent) return { level: 'NOT_ASSESSED', reason: 'UNALLOCATED_PRESENT', hints: [], tier: null, basis: scheme?.basis ?? null }

  const { band, tier, reason } = resolveMetricBand({ scheme, metric })
  if (reason) return { level: 'NOT_ASSESSED', reason, hints: [], tier, basis: scheme?.basis ?? null }
  const outcome = assessValue({ band, ratio })
  return { ...outcome, tier, basis: scheme?.basis ?? null }
}

/** 已实现（结算）指标永远只展示数值：显式返回 REALIZED_NOT_ASSESSED（HB-02/HR-01）。 */
export function realizedAssessment() {
  return { level: 'NOT_ASSESSED', reason: 'REALIZED_NOT_ASSESSED', hints: [], tier: null, basis: null }
}

/**
 * 方案对比（HB-05）：基于已返回的套保率，对各方案逐一判级，纯函数、无副作用。
 * schemes: [{ key, label, tiers, basis }]；ratios: { [StandardMetric]: { value, status } }。
 */
export function compareSchemes({ schemes, ratios }) {
  return (schemes ?? []).map((scheme) => ({
    key: scheme.key,
    label: scheme.label,
    basis: scheme.basis ?? null,
    metrics: Object.fromEntries(
      Object.entries(ratios ?? {}).map(([metric, { value, status }]) => [
        metric,
        assessMetric({ scheme, metric, ratio: value, ratioStatus: status ?? 'OK' }),
      ]),
    ),
  }))
}
