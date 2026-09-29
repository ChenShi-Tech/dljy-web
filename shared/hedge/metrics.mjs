// 套保敞口与套保率计算（openspec build-midlong-spot-hedging，HM-01—HM-07）。
//
// 零依赖纯函数、前后端同构；数值一律十进制字符串（复用 shared/midlong/decimal.mjs），
// 未知值全程用 null 传播——未知不是 0：被排除的时段单独计数，绝不按 0 参与汇总（HM-01）。
// 本模块不做任何取数与判级（判级见 bands.mjs）；只算数值与状态。

import {
  decimalAdd, decimalCompare, decimalDiv, decimalMul, decimalSub, decimalSum, fromScaled, toScaled,
} from '../midlong/decimal.mjs'

/** 守恒校验容差（HM-06/D8）：0.001 MWh。 */
export const CONSERVATION_TOLERANCE_MWH = '0.001'

/**
 * 逐时段敞口（HM-01）：同时给出含机制与仅中长期两个值。
 * 每个值只在它用到的各项都已知时计算，否则为 null。正值=多发（现货卖出、价格下行风险），
 * 负值=欠发（现货买回、价格上行风险）。
 */
export function intervalExposure({ generationMwh, midlongMwh, mechanismMwh }) {
  const midlongOnly = generationMwh !== null && midlongMwh !== null ? decimalSub(generationMwh, midlongMwh) : null
  const withMechanism = midlongOnly !== null && mechanismMwh !== null
    ? decimalSub(generationMwh, decimalAdd(midlongMwh, mechanismMwh))
    : null
  return { withMechanism, midlongOnly }
}

/** 已知值求和：返回 { sum, unknownCount }。未知项不计入求和，只计数。 */
export function sumKnown(values) {
  const known = values.filter((v) => v !== null && v !== undefined)
  return { sum: known.length ? decimalSum(known) : null, unknownCount: values.length - known.length }
}

/**
 * 窗口汇总（HM-01）：对两个值分别给出卖出方向合计、买入方向合计与净值。
 * 未知时段不按 0 参与——既不进方向合计，也不进净值，单独记入 unknownCount。
 */
export function windowAggregates(exposures) {
  const build = (key) => {
    const known = exposures.map((e) => e?.[key] ?? null).filter((v) => v !== null)
    let sell = 0n
    let buy = 0n
    for (const v of known) {
      const scaled = toScaled(v)
      if (scaled > 0n) sell += scaled
      else buy += -scaled
    }
    const net = sell - buy
    return {
      sellMwh: fromScaled(sell),
      buyMwh: fromScaled(buy),
      netMwh: fromScaled(net),
      sign: net > 0n ? 'SELL' : net < 0n ? 'BUY' : 'ZERO',
      knownCount: known.length,
      unknownCount: exposures.length - known.length,
    }
  }
  return { withMechanism: build('withMechanism'), midlongOnly: build('midlongOnly') }
}

/**
 * 逐时段口径套保率（HM-02）：只统计锁价与发电都已知的时段，锁价之和 ÷ 发电量之和。
 * intervals: [{ covered, generationMwh, midlongMwh, mechanismMwh }]；covered 表示该时段在
 * 所属口径（公司/交易单元）下范围内部场站全部已知（HG-03，由调用方按场站汇总判定）。
 *
 * 返回：
 * - coverage: { coveredCount, totalCount, ratio }（已覆盖时段占比）
 * - midlongOnly: { value, status }，status ∈ OK | NOT_COMPUTABLE
 * - withMechanism: { value, status }，status ∈ OK | NOT_COMPUTABLE | MECHANISM_INCOMPLETE
 *   任一已覆盖时段机制电量未知（而发电与中长期已知）时，含机制值为「不完整」，不给数值（HM-03）。
 */
export function intervalRatio({ intervals }) {
  const covered = (intervals ?? []).filter((row) => row?.covered)
  const totalCount = (intervals ?? []).length
  const coverageRatio = totalCount ? decimalDiv(String(covered.length), String(totalCount), 4) : null
  const coverage = { coveredCount: covered.length, totalCount, ratio: coverageRatio }
  if (!covered.length) {
    return {
      coverage,
      midlongOnly: { value: null, status: 'NOT_COMPUTABLE' },
      withMechanism: { value: null, status: 'NOT_COMPUTABLE' },
    }
  }

  // 仅中长期：用发电与中长期都已知的时段。
  const midlongEligible = covered.filter((row) => row.generationMwh !== null && row.midlongMwh !== null)
  let midlongOnly
  if (!midlongEligible.length) {
    midlongOnly = { value: null, status: 'NOT_COMPUTABLE' }
  } else {
    midlongOnly = {
      value: decimalDiv(
        decimalSum(midlongEligible.map((row) => row.midlongMwh)),
        decimalSum(midlongEligible.map((row) => row.generationMwh)),
        6,
      ),
      status: 'OK',
    }
  }

  // 含机制：任一「发电+中长期已知」的已覆盖时段机制未知 → 不完整（HM-03），不给数值。
  const mechanismIncomplete = covered.some(
    (row) => row.generationMwh !== null && row.midlongMwh !== null && row.mechanismMwh === null,
  )
  const mechEligible = covered.filter(
    (row) => row.generationMwh !== null && row.midlongMwh !== null && row.mechanismMwh !== null,
  )
  let withMechanism
  if (mechanismIncomplete) {
    withMechanism = { value: null, status: 'MECHANISM_INCOMPLETE' }
  } else if (!mechEligible.length) {
    withMechanism = { value: null, status: 'NOT_COMPUTABLE' }
  } else {
    withMechanism = {
      value: decimalDiv(
        decimalSum(mechEligible.map((row) => decimalAdd(row.midlongMwh, row.mechanismMwh))),
        decimalSum(mechEligible.map((row) => row.generationMwh)),
        6,
      ),
      status: 'OK',
    }
  }
  return { coverage, midlongOnly, withMechanism }
}

/**
 * 基准口径套保率（HM-02）：月度锁价总量（中长期 + 计划口径机制电量）÷ 该月发电基准。
 * baselineCoverage: 'COMPLETE' | 'PARTIAL'——部分场站缺基准时为 PARTIAL，结果标「不完整」，
 * 不把部分覆盖外推为全月结论；基准缺失或为 0 → 「不可计算」。
 */
export function baselineRatio({ midlongMwh, mechanismMwh, baselineMwh, baselineCoverage = 'COMPLETE' }) {
  const empty = { value: null, status: 'NOT_COMPUTABLE' }
  if (baselineMwh === null || baselineMwh === undefined || decimalCompare(baselineMwh, '0') === 0) {
    return { withMechanism: empty, midlongOnly: empty, denominator: baselineMwh ?? null }
  }
  if (baselineCoverage === 'PARTIAL') {
    const incomplete = { value: null, status: 'INCOMPLETE_COVERAGE' }
    return { withMechanism: incomplete, midlongOnly: incomplete, denominator: baselineMwh }
  }
  const midlongOnly = midlongMwh === null ? empty : { value: decimalDiv(midlongMwh, baselineMwh, 6), status: 'OK' }
  const withMechanism = midlongMwh === null || mechanismMwh === null
    ? { value: null, status: 'MECHANISM_INCOMPLETE' }
    : { value: decimalDiv(decimalAdd(midlongMwh, mechanismMwh), baselineMwh, 6), status: 'OK' }
  return { withMechanism, midlongOnly, denominator: baselineMwh }
}

/**
 * 粗粒度对齐（HG-04/D8）：只能向粗粒度汇总，不插值、不平分；
 * 任一子时段未知时，所在粗时段为未知。rows: [{ startMs, value }]（value 为十进制字符串或 null）。
 */
export function coalesceToCoarser(rows, { fromMinutes, toMinutes }) {
  if (fromMinutes > toMinutes || toMinutes % fromMinutes !== 0) {
    throw new TypeError(`不能从 ${fromMinutes} 分钟对齐到 ${toMinutes} 分钟：只允许向整除的更粗粒度汇总`)
  }
  const buckets = new Map()
  for (const row of rows ?? []) {
    const key = Math.floor(row.startMs / (toMinutes * 60_000))
    if (!buckets.has(key)) buckets.set(key, { startMs: key * toMinutes * 60_000, values: [] })
    buckets.get(key).values.push(row.value)
  }
  return [...buckets.values()]
    .sort((a, b) => a.startMs - b.startMs)
    .map((bucket) => ({
      startMs: bucket.startMs,
      value: bucket.values.some((v) => v === null || v === undefined) ? null : decimalSum(bucket.values),
    }))
}

/**
 * 价格敏感度（HM-05）：现货价格整体变动 1 元/MWh 时收入的变化量 = 已覆盖时段的含机制净敞口。
 * 含机制不完整时给参考值（仅中长期净敞口），标注「未计机制电量」。
 * 空窗口如实返回未知（value=null/incomplete=true）——零时段的 0 不是「价格无影响」（#3133）。
 */
export function priceSensitivity({ intervals }) {
  const rows = intervals ?? []
  if (!rows.length) return { value: null, incomplete: true, reference: null, note: '窗口内无可评估时段' }
  const withMechanism = rows.filter((row) => row.exposure?.withMechanism !== null && row.exposure?.withMechanism !== undefined)
  const incomplete = withMechanism.length !== rows.length
  if (incomplete) {
    const reference = decimalSum(rows.map((row) => row.exposure?.midlongOnly ?? '0'))
    return { value: null, incomplete: true, reference, note: '未计机制电量' }
  }
  return { value: decimalSum(withMechanism.map((row) => row.exposure.withMechanism)), incomplete: false, reference: null, note: null }
}

/**
 * 预测估值（HM-05）：只对开始时刻不早于 T 的时段计算，逐时段含机制敞口 × 预测价再求和。
 * 价格未覆盖或敞口未知的时段被排除并分类计数；输出覆盖比例；已过去时段单独提示。
 * 只估「量 × 价」的金额（元），不是利润也不是收益。
 */
export function forecastValuation({ intervals, evaluationStartMs }) {
  const future = (intervals ?? []).filter((row) => row.startMs >= evaluationStartMs)
  const past = (intervals ?? []).length - future.length
  let valued = 0n
  let valuedCount = 0
  let excludedNoPrice = 0
  let excludedUnknownExposure = 0
  for (const row of future) {
    const exposure = row.exposure?.withMechanism ?? null
    const price = row.priceYuanPerMwh ?? null
    if (price === null) { excludedNoPrice += 1; continue }
    if (exposure === null) { excludedUnknownExposure += 1; continue }
    valued += toScaled(decimalMul(exposure, price))
    valuedCount += 1
  }
  return {
    estimatedAmountCny: valuedCount ? fromScaled(valued) : null,
    coverage: { valuedCount, eligibleCount: future.length, ratio: future.length ? decimalDiv(String(valuedCount), String(future.length), 4) : null },
    excludedPastCount: past,
    excludedNoPriceCount: excludedNoPrice,
    excludedUnknownExposureCount: excludedUnknownExposure,
    note: past > 0 ? '已过去时段不估值，见结算复核' : null,
  }
}

/**
 * 补仓参考价差（HM-05）：逐时段预测价 − 中长期锁价加权均价。
 * 合同价未知的时段被排除并计数；汇总价差按中长期电量加权。
 */
export function referenceSpread({ intervals, evaluationStartMs }) {
  const future = (intervals ?? []).filter((row) => row.startMs >= evaluationStartMs)
  const rows = []
  let weighted = 0n
  let weight = 0n
  let excludedNoContractPrice = 0
  for (const row of future) {
    const price = row.priceYuanPerMwh ?? null
    const contractPrice = row.lockedWeightedPrice ?? null
    if (price === null || contractPrice === null) {
      if (price !== null) excludedNoContractPrice += 1
      rows.push({ startMs: row.startMs, spreadCnyPerMwh: null })
      continue
    }
    const spread = decimalSub(price, contractPrice)
    rows.push({ startMs: row.startMs, spreadCnyPerMwh: spread })
    if (row.midlongMwh !== null && row.midlongMwh !== undefined) {
      weighted += toScaled(decimalMul(spread, row.midlongMwh))
      weight += toScaled(row.midlongMwh)
    }
  }
  return {
    intervals: rows,
    weightedAverageSpread: weight === 0n ? null : fromScaled(weighted * 10n ** 18n / weight),
    excludedNoContractPriceCount: excludedNoContractPrice,
  }
}

/**
 * 补仓试算的计算核（HM-07）：把调整量按形状展开后的逐时段电量叠加到锁价曲线上，
 * 重算敞口与逐时段口径套保率。减仓量超过该时段中长期锁价电量 → SIMULATION_EXCEEDS_LOCKED。
 * adjustments: [{ startMs, endMs, quantityMwh, quantities: [{ startMs, quantityMwh }] }]，
 * quantities 已按形状展开（见 shape-templates.mjs 的 normalizeWeights）。
 * 结果不落库，输出带 basis: 'simulation'。
 */
export function simulateAdjustments({ intervals, adjustments }) {
  const deltas = new Map()
  for (const adjustment of adjustments ?? []) {
    for (const piece of adjustment.quantities ?? []) {
      deltas.set(piece.startMs, (deltas.get(piece.startMs) ?? 0n) + toScaled(piece.quantityMwh))
    }
  }
  const adjusted = []
  for (const row of intervals ?? []) {
    const delta = deltas.get(row.startMs)
    if (delta === undefined) {
      adjusted.push(row)
      continue
    }
    const midlong = row.midlongMwh
    if (delta < 0n && (midlong === null || midlong === undefined || toScaled(midlong) + delta < 0n)) {
      const error = new Error('减仓量超过该时段的中长期锁价电量')
      error.code = 'SIMULATION_EXCEEDS_LOCKED'
      error.details = { field: 'quantityMwh', startMs: row.startMs }
      throw error
    }
    if (midlong === null || midlong === undefined) {
      // 该时段中长期锁价未知（如只有月量）：未知 + 调整量仍是未知，不能把调整量当成锁价（HM-01/HC-06）。
      adjusted.push(row)
      continue
    }
    const nextMidlong = fromScaled(toScaled(midlong) + delta)
    adjusted.push({ ...row, midlongMwh: nextMidlong })
  }
  const exposures = adjusted.map((row) => ({
    ...row,
    exposure: intervalExposure({
      generationMwh: row.generationMwh ?? null,
      midlongMwh: row.midlongMwh ?? null,
      mechanismMwh: row.mechanismMwh ?? null,
    }),
  }))
  return {
    basis: 'simulation',
    intervals: exposures,
    ratio: intervalRatio({ intervals: exposures.map((row) => ({ covered: row.covered, generationMwh: row.generationMwh ?? null, midlongMwh: row.midlongMwh ?? null, mechanismMwh: row.mechanismMwh ?? null })) }),
  }
}

/**
 * 守恒校验（HM-06/D8）：
 * - 下层全部已知：按容差严格校验（默认 0.001 MWh），超出 → HEDGE_CONSISTENCY_FAILED 并带出层级；
 * - 下层含未知：只校验「已知部分之和不大于上层」，并产生一条 gap 说明。
 */
export function verifyConservation({ parentMwh, childMwhs, toleranceMwh = CONSERVATION_TOLERANCE_MWH, level = '' }) {
  const children = childMwhs ?? []
  const unknown = children.filter((v) => v === null || v === undefined).length
  if (unknown === 0) {
    const diff = toScaled(decimalSub(decimalSum(children), parentMwh ?? '0'))
    const tol = toScaled(toleranceMwh)
    if (diff < 0n ? -diff > tol : diff > tol) {
      return { ok: false, partial: false, code: 'HEDGE_CONSISTENCY_FAILED', level, diff: fromScaled(diff < 0n ? -diff : diff) }
    }
    return { ok: true, partial: false, gaps: [] }
  }
  const known = children.filter((v) => v !== null && v !== undefined)
  const knownSum = known.length ? toScaled(decimalSum(known)) : 0n
  const parent = toScaled(parentMwh ?? '0') + toScaled(toleranceMwh)
  if (knownSum > parent) {
    return { ok: false, partial: true, code: 'HEDGE_CONSISTENCY_FAILED', level, diff: fromScaled(knownSum - parent) }
  }
  return { ok: true, partial: true, gaps: [{ code: 'PARTIAL_CONSERVATION', message: '下层含未知，未做全量守恒校验', affected: level || null }] }
}
