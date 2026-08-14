// S5 出清分析（一日作业链第五步）：申报曲线 vs 出清曲线的偏差判读。
//
// 交易员看出清结果要回答两个问题：**「中了多少」**（总量口径的中标率）和
// **「哪里错得最狠」**（逐时段找偏差最大的几个点）。第二个问题比第一个重要——
// 总量对了、个别尖峰时段全落空，实时市场的敞口正好敞在最贵的几个小时上。
// 所以本模块不满足于算一个平均数，而是把最坏时段排出来、并给出是否需要
// 转入实时调整的明确判断。

export type WorstSlot = {
  /** 96 点时段序号（0 起） */
  slot: number
  declaredMwh: number
  clearedMwh: number
  /** 出清 − 申报（正=多中，负=少中/落空） */
  deltaMwh: number
  /** 偏差率 delta/申报；该时段申报为 0 时无从计率，为 null */
  deltaPct: number | null
}

export type ClearingAnalysis = {
  slots: number
  totalDeclaredMwh: number
  totalClearedMwh: number
  /** 中标率 = 出清总量 / 申报总量；申报总量为 0 时为 null */
  clearRate: number | null
  /** 偏差绝对量最大的前 N 个时段（N 见 opts.worstCount） */
  worstSlots: WorstSlot[]
  /**
   * 是否需要转入实时调整：任一时段偏差率超阈值，或出现「未申报却中标」。
   * 阈值是管理参数（默认 15%），不是市场规则——各公司按自身风控口径覆盖。
   */
  needsRealtimeAction: boolean
  /** 触发实时调整判断的时段序号 */
  triggeredSlots: number[]
  summary: string
}

export type ClearingAnalysisOptions = {
  /** 单时段偏差率超过该值即判「需实时调整」；默认 0.15 */
  realtimeActionThreshold?: number
  /** 最坏时段列表长度；默认 5 */
  worstCount?: number
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

export function analyzeClearing(
  declared: number[],
  cleared: number[],
  opts: ClearingAnalysisOptions = {}
): ClearingAnalysis {
  if (!declared.length || declared.length !== cleared.length) {
    throw new Error(`申报与出清曲线长度不一致（${declared.length} vs ${cleared.length}），无法逐时段对齐`)
  }
  const threshold = opts.realtimeActionThreshold ?? 0.15
  const worstCount = opts.worstCount ?? 5

  const totalDeclaredMwh = round4(declared.reduce((a, b) => a + b, 0))
  const totalClearedMwh = round4(cleared.reduce((a, b) => a + b, 0))
  const clearRate = totalDeclaredMwh > 0 ? round4(totalClearedMwh / totalDeclaredMwh) : null

  const rows: WorstSlot[] = declared.map((d, i) => {
    const delta = cleared[i] - d
    return {
      slot: i,
      declaredMwh: d,
      clearedMwh: cleared[i],
      deltaMwh: round4(delta),
      deltaPct: d > 0 ? round4(delta / d) : null
    }
  })

  // 排最坏时段按**绝对偏差量**而非偏差率：0.1MWh 申报偏 300% 不如 20MWh 偏 30% 疼
  const worstSlots = [...rows]
    .filter((r) => r.deltaMwh !== 0)
    .sort((a, b) => Math.abs(b.deltaMwh) - Math.abs(a.deltaMwh))
    .slice(0, worstCount)

  const triggeredSlots = rows
    .filter((r) =>
      r.deltaPct !== null
        ? Math.abs(r.deltaPct) > threshold
        : r.clearedMwh > 0 // 未申报却中标：口径对不上，必须人工介入
    )
    .map((r) => r.slot)

  const needsRealtimeAction = triggeredSlots.length > 0

  const summaryParts: string[] = []
  summaryParts.push(
    clearRate === null
      ? '申报总量为 0，无中标率口径'
      : `中标率 ${(clearRate * 100).toFixed(1)}%（申报 ${totalDeclaredMwh} / 出清 ${totalClearedMwh} MWh）`
  )
  if (worstSlots.length) {
    const w = worstSlots[0]
    summaryParts.push(`最大偏差在第 ${w.slot + 1} 时段：申报 ${w.declaredMwh}、出清 ${w.clearedMwh}（Δ${w.deltaMwh}）`)
  }
  summaryParts.push(
    needsRealtimeAction
      ? `有 ${triggeredSlots.length} 个时段偏差率超 ${(threshold * 100).toFixed(0)}%，需评估实时市场调整`
      : '逐时段偏差均在阈值内，无需实时调整'
  )

  return {
    slots: declared.length,
    totalDeclaredMwh,
    totalClearedMwh,
    clearRate,
    worstSlots,
    needsRealtimeAction,
    triggeredSlots,
    summary: summaryParts.join('；')
  }
}
