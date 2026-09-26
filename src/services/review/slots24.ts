// 24 时段展示聚合（Epic #2033 · M1 · #2038，2026-08-13 拍板：底层 96 点、24 时段仅展示聚合）
// ---------------------------------------------------------------------------
// E1–E3/N1 类 slots24 模板的渲染支撑：96 点底座 → 24 小时聚合；峰谷标识读
// SettlementRuleSpec，未参数化省份显式提示（不借用他省参数，settlement.ts 纪律）。
import type { SettlementRuleSpec } from '@/rules/types'

/** 96 点 → 24 时段：每 4 点求和；任一原始点缺失则该时段为 null（缺点不出半真值）。 */
export function aggregate96to24(curve: readonly (number | null)[]): Array<number | null> {
  if (curve.length === 0) return []
  // 长度非 96 的容错：按 4 点一组聚合，余量单独成组（渲染层以数组下标为小时）
  const slots: Array<number | null> = []
  for (let i = 0; i < curve.length; i += 4) {
    const group = curve.slice(i, i + 4)
    const sum = group.reduce<number | null>((acc, v) => {
      if (acc === null || v === null || Number.isNaN(v)) return null
      return acc + v
    }, 0)
    slots.push(sum)
  }
  return slots
}

/** 96 点下标 → 小时（0–23）；下标越界返回 null。 */
export function hourOfPointIndex(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index > 95) return null
  return Math.floor(index / 4)
}

export type SegmentLabels =
  | { parameterized: true; labels: readonly string[] }
  | { parameterized: false; labels: null; note: string }

export const SEGMENT_UNPARAMETERIZED_NOTE =
  '本省峰谷时段尚未配置：不借用其他省份的时段划分，峰谷标识留空。'

/**
 * 24 小时峰谷标识：按 spec.timeSegmentFactors 的 hours[] 归属；未命中小时标
 * '平'（segmentFactorOf 同款兜底语义，系数缺省 1，标识缺省平段）。
 * spec 为 null（未参数化省份）→ parameterized:false + 提示文案，由页面显式呈现。
 */
export function segmentLabelsOf(spec: SettlementRuleSpec | null): SegmentLabels {
  if (!spec || spec.timeSegmentFactors.length === 0) {
    return { parameterized: false, labels: null, note: SEGMENT_UNPARAMETERIZED_NOTE }
  }
  const labels: string[] = []
  for (let h = 0; h < 24; h += 1) {
    const seg = spec.timeSegmentFactors.find((s) => s.hours.includes(h))
    labels.push(seg ? seg.segment : '平')
  }
  return { parameterized: true, labels }
}
