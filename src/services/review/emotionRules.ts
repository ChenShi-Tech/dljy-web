// 情绪化决策识别 · 规则清单 v1（Epic #2033 · M4 · #2049：模板十一）
// ---------------------------------------------------------------------------
// 方案拍板「先规则后模型」：v1 只在高置信信号上打标（宁缺勿滥）
// R1 过度自信候选：P10–P90 区间相对中位过窄（< bandRatio）且 actual 出区间；
// R2 犹豫候选：同一标的日同一决策点出现多条条目（改判迹象）；
// 追涨/杀跌需「价格大幅波动时追价」的价格联动上下文，逐时价格与决策时点
// 联动数据未接入，v1 不打标（标注待接入，不硬造）。
// 页面明示「学习辅导用途、非考核依据」，不做排名（复盘文化红线：为学习非追责）。
// 数据源：决策日志（P10/P50/P90 vs 实际）+ 规则模式；可整体停用且停用无残留。

export type EmotionKind = 'overconfidence' | 'hesitation' | 'chase_up' | 'panic_sell'

export const EMOTION_KIND_LABEL: Record<EmotionKind, string> = {
  overconfidence: '过度自信',
  hesitation: '犹豫',
  chase_up: '追涨',
  panic_sell: '杀跌'
}

/** 复盘文化红线：学习辅导定位 + 不做排名（页面必须展示） */
export const EMOTION_NOTE =
  '情绪化识别为学习辅导用途、非考核依据；不做排名视图（复盘文化红线：为学习非追责）。'

export type EmotionEntryLike = {
  seq: number
  targetDate: string
  decisionPoint: string
  p10?: number | null
  p50?: number | null
  p90?: number | null
  actual?: string | number | null
}

export type EmotionPattern = {
  kind: EmotionKind
  label: string
  evidence: string
  /** 命中条目 seq（回查用） */
  seqs: number[]
}

export type EmotionDetection = {
  patterns: EmotionPattern[]
  /** 覆盖说明：打标口径与未覆盖原因（如实呈现，不打标≠没有问题） */
  coverageNote: string
}

/** 区间相对中位的宽度比：<bandRatio 视为过窄（缺省 10%，方案判定参考的保守取值）。 */
function bandRatioOf(e: EmotionEntryLike): number | null {
  if (typeof e.p10 !== 'number' || typeof e.p50 !== 'number' || typeof e.p90 !== 'number') return null
  if (e.p50 === 0 || !Number.isFinite(e.p10) || !Number.isFinite(e.p50) || !Number.isFinite(e.p90)) return null
  return Math.abs(e.p90 - e.p10) / Math.abs(e.p50)
}

function actualOutOfBand(e: EmotionEntryLike): boolean {
  if (typeof e.p10 !== 'number' || typeof e.p90 !== 'number') return false
  const a = typeof e.actual === 'number' ? e.actual : Number(e.actual)
  if (!Number.isFinite(a)) return false
  return a < e.p10 || a > e.p90
}

export function detectEmotionPatterns(
  entries: readonly EmotionEntryLike[],
  opts: { bandRatio?: number } = {}
): EmotionDetection {
  const bandRatio = opts.bandRatio ?? 0.1
  const patterns: EmotionPattern[] = []

  // R1 过度自信候选：区间过窄且实际出区间（预测过度集中被打脸）
  const overconf = entries.filter((e) => {
    const r = bandRatioOf(e)
    return r !== null && r < bandRatio && actualOutOfBand(e)
  })
  if (overconf.length) {
    patterns.push({
      kind: 'overconfidence',
      label: EMOTION_KIND_LABEL.overconfidence,
      evidence: `P10–P90 区间宽度 < 中位的 ${(bandRatio * 100).toFixed(0)}% 且实际出区间：${overconf.length} 条（${overconf.slice(0, 3).map((e) => `#${e.seq}`).join('、')}${overconf.length > 3 ? '…' : ''}）`,
      seqs: overconf.map((e) => e.seq)
    })
  }

  // R2 犹豫候选：同标的日同决策点多条（改判迹象）
  const seen = new Map<string, EmotionEntryLike[]>()
  for (const e of entries) {
    const key = `${e.targetDate}|${e.decisionPoint.trim()}`
    seen.set(key, [...(seen.get(key) ?? []), e])
  }
  const hesitating = [...seen.values()].filter((xs) => xs.length >= 2)
  if (hesitating.length) {
    patterns.push({
      kind: 'hesitation',
      label: EMOTION_KIND_LABEL.hesitation,
      evidence: `同一决策点多条记录（改判迹象）：${hesitating.length} 组（如 ${hesitating[0][0].targetDate}「${hesitating[0][0].decisionPoint}」×${hesitating[0].length}）`,
      seqs: hesitating.flat().map((e) => e.seq)
    })
  }

  const coverageNote =
    `已扫描 ${entries.length} 条决策日志。追涨/杀跌需价格波动上下文联动（逐时价格 × 决策时点），` +
    `联动数据未接入前不打标——宁缺勿滥；情绪栏自评（决策复盘单）数据积累后并入模型版（先规则后模型）。`
  return { patterns, coverageNote }
}

/** 停用开关存储键（localStorage；停用时面板零残留，只留开关一行）。 */
export const EMOTION_TOGGLE_KEY = 'review.emotionPatternDisabled'
