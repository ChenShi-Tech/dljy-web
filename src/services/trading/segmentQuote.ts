// 分段价量报价草稿（F3.4 · 手册 S4 步骤①）—— 发电侧/储能立场的报量报价结构
// ----------------------------------------------------------------------------
// 手册要求系统生成「分几段、每段什么价」的报价草稿供交易员检查。此前申报单只有
// 整条电量曲线（报量不报价），价格维度缺位。
//
// 生成逻辑（经验初值，可改可校准）：
//   1. 把 96 点按电量**从小到大**排序，按电量份额切成 N 段（3 段 45/35/20、
//      4 段 40/30/20/10）——发电侧供给曲线性质：低量段是保底出力（低价保中标），
//      高量段是峰时高出力（系统需要你，有议价力），**价格必须随段位单调递增**；
//   2. 各段价格落在 S2 价格中枢区间的固定分位上（3 段 25%/55%/90%、4 段 20%/45%/70%/92%），
//      取整（报价精度规则）；
//   3. 段表 → 96 点价格曲线（priceCurve96，申报单原生字段），逐点价 = 该点所属段价。
//
// 诚实性：S2 没给价格中枢时返回 null（没有价格锚不硬编）；校验器把单调性/整数/
// 限价带当硬约束，人工改动违反即报。
export type SegmentRow = {
  /** 段位序（0=基荷 → N-1=峰荷/尖峰） */
  rank: number
  label: string
  priceYuanPerMwh: number
  energyMwh: number
  slots: number
  sharePct: number
}

const SEGMENT_PRESETS: Record<number, { shares: number[]; priceFractions: number[]; labels: string[] }> = {
  3: { shares: [0.45, 0.35, 0.2], priceFractions: [0.25, 0.55, 0.9], labels: ['基荷段', '腰荷段', '峰荷段'] },
  4: { shares: [0.4, 0.3, 0.2, 0.1], priceFractions: [0.2, 0.45, 0.7, 0.92], labels: ['基荷段', '腰荷段', '峰荷段', '尖峰段'] }
}

/**
 * 生成分段报价草稿。任一输入缺失/畸形返回 null——没有电量曲线或没有价格中枢
 * （S2 产出）就不该生成价格，硬编一个价格锚比不给更危险。
 */
export function buildSegmentDraft(
  curveMwh96: number[],
  priceCenterLow: number | null | undefined,
  priceCenterHigh: number | null | undefined,
  segmentCount: 3 | 4 = 3
): SegmentRow[] | null {
  const preset = SEGMENT_PRESETS[segmentCount]
  if (!preset) return null
  if (!Array.isArray(curveMwh96) || curveMwh96.length < 24) return null
  // 先验原始值再转数：Number(null)===0，先转会把「没给中枢」伪装成「中枢下界 0」
  if (!Number.isFinite(priceCenterLow) || !Number.isFinite(priceCenterHigh)) return null
  const low = Number(priceCenterLow)
  const high = Number(priceCenterHigh)
  if (high <= low) return null

  const values = curveMwh96.map(Number).filter(Number.isFinite)
  if (values.length !== curveMwh96.length) return null
  // 电量升序：底部 45% 电量的时点构成基荷段（低价保中），顶部是尖峰段
  const sortedAsc = [...values].sort((a, b) => a - b)
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null

  const rows: SegmentRow[] = []
  // 段电量取**走位实际值**（整点切位后的累计差），不用预设份额的报告值——两套数
  // 各报各的会让「段表合计 ≠ 曲线总量」，交易员核对时发现对不上比没有段表更糟。
  let acc = 0
  let idx = 0
  for (let i = 0; i < preset.shares.length; i += 1) {
    const isLast = i === preset.shares.length - 1
    const accBefore = acc
    const slotsBefore = idx
    if (isLast) {
      acc = total // 最后一段吃掉剩余全部（份额合计=1，切位误差归并到最后一段）
      idx = values.length
    } else {
      const boundary = total * preset.shares.slice(0, i + 1).reduce((a, b) => a + b, 0)
      while (idx < sortedAsc.length && acc < boundary - 1e-9) {
        acc += sortedAsc[idx]!
        idx += 1
      }
    }
    const segEnergy = acc - accBefore
    const price = Math.round(low + (high - low) * preset.priceFractions[i]!)
    rows.push({
      rank: i,
      label: preset.labels[i]!,
      priceYuanPerMwh: price,
      energyMwh: Math.round(segEnergy * 10) / 10,
      slots: idx - slotsBefore,
      sharePct: Math.round((segEnergy / total) * 1000) / 10
    })
  }
  return rows
}

/**
 * 段表 → 96 点价格曲线：每个时点按其电量在降序中的段位取该段价格。
 * 与 buildSegmentDraft 同一套切位逻辑，保证「段表合计 = 曲线逐点映射」一致。
 */
export function segmentsToPriceCurve96(segments: SegmentRow[], curveMwh96: number[]): number[] | null {
  if (!Array.isArray(segments) || !segments.length) return null
  if (!Array.isArray(curveMwh96) || !curveMwh96.length) return null
  const values = curveMwh96.map(Number)
  if (values.some((v) => !Number.isFinite(v))) return null
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  // 段边界 = 逐段累计电量（由段表 sharePct×总量；与草稿切位同构，舍入漂移 ≤0.1%）
  const boundaries: number[] = []
  let cum = 0
  for (let i = 0; i < segments.length - 1; i += 1) {
    cum += (segments[i]!.sharePct / 100) * total
    boundaries.push(cum)
  }
  // 电量升序走位（带原下标回填）：底部累计电量越过节界即换段——与 buildSegmentDraft 同一切法
  const idxAsc = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  let seg = 0
  let acc = 0
  for (const { v, i } of idxAsc) {
    acc += v
    while (seg < segments.length - 1 && acc > boundaries[seg]! + 1e-9) seg += 1
    out[i] = segments[seg]!.priceYuanPerMwh
  }
  return out
}

/**
 * 段表校验（人工改动后的硬约束）：价格随段位**严格递增**（供给曲线性质，平价或
 * 倒挂会让段位失去意义）、整数价（报价精度规则）、非负；给了限价带则须在带内。
 */
export function validateSegments(
  segments: SegmentRow[],
  priceCap?: { floor: number; cap: number } | null
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!
    if (!Number.isFinite(s.priceYuanPerMwh) || s.priceYuanPerMwh < 0) {
      problems.push(`第 ${i + 1} 段价格非法（${s.priceYuanPerMwh}）`)
    }
    if (!Number.isInteger(s.priceYuanPerMwh)) {
      problems.push(`第 ${i + 1} 段价格须为整数（当前 ${s.priceYuanPerMwh}）`)
    }
    if (priceCap && Number.isFinite(priceCap.floor) && Number.isFinite(priceCap.cap)) {
      if (s.priceYuanPerMwh < priceCap.floor || s.priceYuanPerMwh > priceCap.cap) {
        problems.push(`第 ${i + 1} 段价格 ${s.priceYuanPerMwh} 超出限价带 [${priceCap.floor}, ${priceCap.cap}]`)
      }
    }
    if (i > 0 && Number.isFinite(segments[i - 1]!.priceYuanPerMwh) && Number.isFinite(s.priceYuanPerMwh)) {
      if (s.priceYuanPerMwh <= segments[i - 1]!.priceYuanPerMwh) {
        problems.push(`第 ${i} 段 → 第 ${i + 1} 段价格未严格递增（供给曲线倒挂/平价）`)
      }
    }
  }
  return { ok: problems.length === 0, problems }
}
