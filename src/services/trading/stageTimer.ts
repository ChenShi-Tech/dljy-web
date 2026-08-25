// S1 实机计时 · 纯逻辑工具（Epic #2033 · #2040 验收残留）
// ---------------------------------------------------------------------------
// 「晨会从开始到形成共识的实机分钟数」测量：进入时间戳记在 sessionStorage
// （per 申报单 + 日期，刷新不重计）；writeBack 成功时计算 elapsed 并给出
// >5 分钟黄标判定（阈值可配，缺省 5 分钟）。
// 红线（U4）：**零写回**——计时结果不进任何单据字段，只做页面呈现与测量协议；
// 数值由现场真实操作产生，测量协议记录在文档（docs/review-system）。

export const S1_STAGE_KEY_PREFIX = 'dljy.prototype.s1Timer'
export const DEFAULT_S1_SLOW_MINUTES = 5

export type S1TimerView = {
  /** 进入时间戳（ms）；null = 本次会话未开始计时（尚未进入 S1） */
  startedAt: number | null
  /** 已用分钟（基于给定 now；startedAt 缺席为 null） */
  elapsedMinutes: number | null
  /** 超过慢阈值（缺省 5 分钟）→ true（黄标；不阻断流程，只提示） */
  slow: boolean
}

/** 计时存储键：per 申报单 + 日期（同日同单刷新不重计，跨单/跨日自然隔离）。 */
export function s1TimerKey(declarationId: string, date: string): string {
  return `${S1_STAGE_KEY_PREFIX}.${declarationId}.${date}`
}

/** 进入 S1：记时间戳（已存在则保留——刷新/重进不重计）。返回生效的时间戳。 */
export function markS1Started(declarationId: string, date: string, now = Date.now()): number {
  const key = s1TimerKey(declarationId, date)
  const existing = readStartedAt(declarationId, date)
  if (existing !== null) return existing
  try {
    sessionStorage.setItem(key, String(now))
  } catch {
    // 存储不可用（隐私模式等）：本次仅内存口径，计时退化为会话内
  }
  return now
}

/** 读已记的进入时间戳；未记/畸形返回 null。 */
export function readStartedAt(declarationId: string, date: string): number | null {
  try {
    const raw = sessionStorage.getItem(s1TimerKey(declarationId, date))
    const n = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** 计时视图：elapsed 按整数分钟向上取整（协议口径：跨过 30 秒即算 1 分钟在途）。 */
export function s1TimerView(
  declarationId: string,
  date: string,
  opts: { now?: number; slowMinutes?: number } = {}
): S1TimerView {
  const now = opts.now ?? Date.now()
  const slowMinutes = opts.slowMinutes ?? DEFAULT_S1_SLOW_MINUTES
  const startedAt = readStartedAt(declarationId, date)
  if (startedAt === null) return { startedAt: null, elapsedMinutes: null, slow: false }
  const elapsedMinutes = Math.max(0, Math.ceil((now - startedAt) / 60000))
  return { startedAt, elapsedMinutes, slow: elapsedMinutes > slowMinutes }
}

/** writeBack 成功后的收口读数（U4：只返回视图，不写回任何单据字段）。 */
export function s1ElapsedOnComplete(
  declarationId: string,
  date: string,
  opts: { now?: number } = {}
): number | null {
  return s1TimerView(declarationId, date, opts).elapsedMinutes
}
