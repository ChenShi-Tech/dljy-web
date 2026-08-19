// 决策日志的原型态存储
// ----------------------------------------------------------------------------
// ⚠️ 这是原型态实现，不是决策日志的最终形态。
//
// 手册要求决策日志「append-only + 哈希链、写后不可改」，其目的是在监管质询时作为
// 自证材料。而本模块把链存在浏览器 localStorage 里、哈希在浏览器端计算
// 这意味着：
// · 换台机器/清缓存就没了，不具备 ≥5 年留存能力；
// · 拥有浏览器的人可以连内容带哈希一起重算，链校验拦不住蓄意篡改。
//
// 它能提供的价值只有一个：验证业务闭环是否成立（字段够不够、校验合不合理、
// 更正与回填的交互顺不顺）。上生产必须换成服务端追加写 + 加密哈希 + 独立审计留痕。
// 页面上必须同步显示这条限制，不能让使用者误以为已经具备不可篡改能力。

import {
  appendCorrection,
  appendEntry,
  backfillActual,
  verifyChain,
  type DecisionLogDraft,
  type DecisionLogEntry
} from 'shared/trading-rules/decision-log.mjs'

const STORAGE_KEY = 'dljy.prototype.decisionLog'

/** 原型态存储的显式声明，消费方（页面）必须把它展示出来。 */
export const PROTOTYPE_STORAGE_NOTICE =
  '原型态：链存于浏览器本地、哈希在前端计算，可检出误改与顺序错乱，但不具备防蓄意篡改与 ≥5 年留存能力。生产须改服务端追加写 + 加密哈希。'

export function loadLog(): DecisionLogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DecisionLogEntry[]) : []
  } catch {
    return []
  }
}

function persist(log: DecisionLogEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    // 存储不可用时不阻断作业；页面据 verifyChain 结果提示使用者本次未落盘。
  }
}

/** 追加一条并落盘，返回新链。校验失败时向上抛错（页面负责展示原因）。 */
export function appendAndPersist(draft: DecisionLogDraft): DecisionLogEntry[] {
  const log = loadLog()
  const entry = appendEntry(log, draft)
  const next = [...log, entry]
  persist(next)
  return next
}

/** 追加一条更正记录（原条目原样保留）。 */
export function correctAndPersist(targetId: string, draft: Omit<DecisionLogDraft, 'correctionOf'>): DecisionLogEntry[] {
  const log = loadLog()
  const entry = appendCorrection(log, targetId, draft)
  const next = [...log, entry]
  persist(next)
  return next
}

/** T+2 回填实际结果（不参与哈希，不破坏链）。 */
export function backfillAndPersist(entryId: string, actual: number, lesson?: string): DecisionLogEntry[] {
  const log = loadLog()
  const next = log.map((e) => (e.id === entryId ? backfillActual(e, actual, lesson) : e))
  persist(next)
  return next
}

/** 清空（仅原型演示用；真实台账不存在"清空"这个操作）。 */
export function clearLog(): DecisionLogEntry[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上
  }
  return []
}

/** 便捷：读取并校验链。 */
export function loadAndVerify(): { log: DecisionLogEntry[]; verdict: ReturnType<typeof verifyChain> } {
  const log = loadLog()
  return { log, verdict: verifyChain(log) }
}
