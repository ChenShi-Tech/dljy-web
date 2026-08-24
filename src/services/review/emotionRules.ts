// 情绪化决策识别 · 规则清单 v1（Epic #2033 · M4 · #2049：模板十一）
// ---------------------------------------------------------------------------
// 方案拍板「先规则后模型」：v1 只在高置信信号上打标（宁缺勿滥）
// R1 过度自信候选：P10–P90 区间相对中位过窄（< bandRatio）且 actual 出区间；
// R2 犹豫候选：同一标的日同一决策点出现多条条目（改判迹象）；
// R3 追涨候选：决策时点所在小时价格较前一小时上涨 ≥ chasePct 且 judgement 同向看涨
//   （依赖 decisionTime + 小时价格上下文，缺任一不打标——宁缺勿滥）；
// R4 杀跌候选：同上但下跌且 judgement 同向看跌。
// 页面明示「学习辅导用途、非考核依据」，不做排名（复盘文化红线：为学习非追责）。
// 数据源：决策日志（P10/P50/P90 vs 实际）+ 规则模式 + 小时价格上下文；可整体停用且停用无残留。

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
  /** 决策时点（迁移 044 独立列，人工填写；缺省 = 时点未知 → R3/R4 不打标） */
  decisionTime?: string | null
  /** 判断方向（看涨/看跌），R3/R4 同向判定用 */
  judgement?: string | null
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

/**
 * 小时价格上下文：date → 24 小时价格（元/MWh）。R3/R4 用「决策时点所在小时 vs 前一小时」
 * 的环比；上下文缺席（null）或对应小时缺价 → 不打标（宁缺勿滥）。
 */
export type HourlyPriceContext = Record<string, (number | null)[]> | null

/** 决策时点 → [日期, 小时]；形态不符返回 null。 */
function decisionHourOf(e: EmotionEntryLike): { date: string; hour: number } | null {
  if (!e.decisionTime) return null
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/.exec(String(e.decisionTime).trim())
  if (!m) return null
  const hour = Number(m[2])
  return hour >= 0 && hour <= 23 ? { date: m[1], hour } : null
}

/** 判断方向：文本口径「看涨/看跌」（决策日志 judgement 自由文本，宽松匹配）。 */
function judgementDirection(e: EmotionEntryLike): 'up' | 'down' | null {
  const j = String(e.judgement ?? '')
  const up = /看涨|做多|买入|增持|上调|追价/.test(j)
  const down = /看跌|做空|卖出|减持|下调|回避/.test(j)
  if (up === down) return null // 同时命中或都不命中：方向不明不打标
  return up ? 'up' : 'down'
}

export function detectEmotionPatterns(
  entries: readonly EmotionEntryLike[],
  opts: { bandRatio?: number; chasePct?: number; hourlyPrices?: HourlyPriceContext } = {}
): EmotionDetection {
  const bandRatio = opts.bandRatio ?? 0.1
  const chasePct = opts.chasePct ?? 0.15
  const patterns: EmotionPattern[] = []
  const coverageGaps: string[] = []

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

  // R3 追涨 / R4 杀跌：决策时点所在小时价较前一小时波动 ≥ chasePct 且 judgement 同向。
  // 三重前置缺一不打标：decisionTime 缺失 / 小时价格上下文缺席（含该小时缺价）/ 方向不明。
  const hourly = opts.hourlyPrices ?? null
  if (hourly) {
    const chase: EmotionEntryLike[] = []
    const panic: EmotionEntryLike[] = []
    let missingTime = 0
    let missingPrice = 0
    for (const e of entries) {
      const at = decisionHourOf(e)
      if (!at) { missingTime += 1; continue }
      const day = hourly[at.date]
      const cur = day?.[at.hour]
      const prev = at.hour > 0 ? day?.[at.hour - 1] : null
      if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) { missingPrice += 1; continue }
      const change = (cur - prev) / Math.abs(prev)
      const dir = judgementDirection(e)
      if (dir === null) continue
      if (change >= chasePct && dir === 'up') chase.push(e)
      if (change <= -chasePct && dir === 'down') panic.push(e)
    }
    if (chase.length) {
      patterns.push({
        kind: 'chase_up',
        label: EMOTION_KIND_LABEL.chase_up,
        evidence: `决策时点小时价较前一小时涨 ≥ ${(chasePct * 100).toFixed(0)}% 且判断同向看涨：${chase.length} 条（${chase.slice(0, 3).map((e) => `#${e.seq}`).join('、')}${chase.length > 3 ? '…' : ''}）`,
        seqs: chase.map((e) => e.seq)
      })
    }
    if (panic.length) {
      patterns.push({
        kind: 'panic_sell',
        label: EMOTION_KIND_LABEL.panic_sell,
        evidence: `决策时点小时价较前一小时跌 ≥ ${(chasePct * 100).toFixed(0)}% 且判断同向看跌：${panic.length} 条（${panic.slice(0, 3).map((e) => `#${e.seq}`).join('、')}${panic.length > 3 ? '…' : ''}）`,
        seqs: panic.map((e) => e.seq)
      })
    }
    if (missingTime || missingPrice) {
      coverageGaps.push(`决策时点缺失 ${missingTime} 条、小时价格缺席 ${missingPrice} 条不打标`)
    }
  }

  const coverageNote = hourly
    ? `已扫描 ${entries.length} 条决策日志（含小时价格上下文）。追涨/杀跌判定=决策时点所在小时价较前一小时波动 ≥15% 且判断同向；${coverageGaps.join('；') || '前置数据齐备'}——宁缺勿滥。情绪栏自评（决策复盘单）数据积累后并入模型版（先规则后模型）。`
    : `已扫描 ${entries.length} 条决策日志。追涨/杀跌需价格波动上下文联动（逐时价格 × 决策时点），` +
      `联动数据未接入前不打标——宁缺勿滥；情绪栏自评（决策复盘单）数据积累后并入模型版（先规则后模型）。`
  return { patterns, coverageNote }
}

/** 停用开关存储键（localStorage；停用时面板零残留，只留开关一行）。 */
export const EMOTION_TOGGLE_KEY = 'review.emotionPatternDisabled'
