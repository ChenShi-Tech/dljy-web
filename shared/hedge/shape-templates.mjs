// 补仓试算的形状模板（openspec build-midlong-spot-hedging，HM-07，附录 B.10）。
//
// 形状只用于试算与假设展开：MUST NOT 被用来补齐正式的锁价曲线，也不做正式持仓的分解（HM-07）。
// 零依赖纯函数；权重为十进制字符串，规范化后之和为 1。

import { decimalDiv, decimalMul, decimalSum } from '../midlong/decimal.mjs'

export const SHAPE_TEMPLATES_VERSION = 1

export const SHAPE_TEMPLATES = Object.freeze({
  FLAT: Object.freeze({ label: '均匀', description: '电量均匀分摊到交割时段' }),
  RECENT_ACTUAL_PROFILE: Object.freeze({
    label: '近 14 天实际出力形状',
    defaultDays: 14,
    description: '按该场站近 14 天实际出力的相对形状分摊；缺实际的子时段如实剔除后重归一化',
  }),
  CONTRACT_CURVE: Object.freeze({
    label: '合同分时曲线',
    description: '按某份已有合同的分时曲线相对形状分摊',
  }),
})

/**
 * 把形状权重规范化为总和 1 的比例。weights: 十进制字符串或 null 数组；
 * null 子时段（如缺实际的时段）如实剔除后重归一化，不用 0 顶替。
 * 全部为 null 或总和为 0 时返回 null（无法展开，调用方按校验错误处理，不默认均匀）。
 */
export function normalizeWeights(weights) {
  const list = weights ?? []
  const known = list.filter((w) => w !== null && w !== undefined)
  if (!known.length) return null
  const total = decimalSum(known)
  if (total === '0') return null
  return list.map((w) => (w === null || w === undefined ? null : decimalDiv(w, total, 12)))
}

/**
 * 按形状把试算电量展开为逐时段电量（HM-07 计算核的输入准备）。
 * intervals 与 weights（可空）一一对应：
 * - FLAT（或未给权重）：均匀分摊；
 * - 其他形状：相对权重经 normalizeWeights 规范化后按比例分摊。
 * 权重含 null 时该时段不分摊——调用方必须用「展开合计 = 试算电量」校验兜底，
 * 合不上的形状（如合同曲线覆盖不到交割窗口）按校验错误拒绝，不静默截断。
 * 返回 [{ startMs, quantityMwh }]；无法展开返回 null。
 */
export function expandShape({ kind, quantityMwh, intervals, weights = null }) {
  if (kind === 'FLAT' || weights === null) {
    if (!intervals.length) return []
    const even = decimalDiv(quantityMwh, String(intervals.length), 12)
    return intervals.map((row) => ({ startMs: row.startMs, quantityMwh: even }))
  }
  const normalized = normalizeWeights(weights)
  if (!normalized) return null
  return intervals.map((row, i) => ({
    startMs: row.startMs,
    quantityMwh: normalized[i] === null ? null : decimalMul(quantityMwh, normalized[i]),
  }))
}
