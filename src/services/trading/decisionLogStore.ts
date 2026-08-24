// ============================================================================
// 决策日志存储 · 双模式门面（Epic #2033 · M1 · #2037 前端切换）
// ----------------------------------------------------------------------------
// #2037 服务端化后这里不再是「localStorage 原型」单实现，而是按端点探针二选一：
//
//   · server：权威台账（Node BFF /api/v1/review/decision-logs，追加写落库 +
//     服务端 SHA-256 哈希链，迁移 025 表结构，留存 ≥5 年）。写入走 HTTP，
//     链校验结论取服务端 /verify（浏览器没有 node:crypto，不重算 SHA-256）。
//   · local：浏览器原型（下方 localStorage 实现，FNV 哈希）。**只在端点不存在
//     （404/405）时启用**——端点在但报错（未授权/网络）时绝不静默回落本地：
//     审计台账宁可报错重试，不能让人误以为写进了权威链。
//
// 两边共用 shared/trading-rules/decision-log.mjs 的同一份校验/统计实现
// （coverageOf/hitRate 纯函数与哈希算法无关，前端对服务端条目照常本地统计）。
// ============================================================================

import {
  appendCorrection,
  appendEntry,
  backfillActual,
  verifyChain,
  type DecisionLogDraft,
  type DecisionLogEntry
} from 'shared/trading-rules/decision-log.mjs'
import { buildImportPlan } from './decisionLogApi'
import {
  fetchChainVerdict,
  fetchDecisionLogFeed,
  postBackfill,
  postDecisionLog
} from './decisionLogClient'

const STORAGE_KEY = 'dljy.prototype.decisionLog'

/** 原型态存储的显式声明——消费方（页面）必须把它展示出来（仅 local 模式）。 */
export const PROTOTYPE_STORAGE_NOTICE =
  '原型态：链存于浏览器本地、哈希在前端计算，可检出误改与顺序错乱，但不具备防蓄意篡改与 ≥5 年留存能力。生产须改服务端追加写 + 加密哈希。'

/** server 模式的存储说明（替代原型警示，说清楚链在哪、谁算的哈希）。 */
export const SERVER_STORAGE_NOTE =
  '服务端台账（#2037）：追加写落库、SHA-256 哈希链在服务端计算与校验，留存 ≥5 年；决策人由登录身份落名，不可代签。'

export type DecisionLogMode = 'server' | 'local'

// ── 模式探针（会话内 TTL 缓存，避免每个消费组件重复探测） ────────────────────
const MODE_TTL_MS = 5 * 60 * 1000
let modeCache: { mode: DecisionLogMode; at: number } | null = null

export async function resolveDecisionLogMode(force = false): Promise<DecisionLogMode> {
  if (!force && modeCache && Date.now() - modeCache.at < MODE_TTL_MS) return modeCache.mode
  const feed = await fetchDecisionLogFeed()
  // 只有「端点不存在」才回落本地原型；未授权/网络错误按 server 模式走，
  // 让具体读写把真实错误抛给页面（权威链存在时不允许伪造本地写入成功）。
  const mode: DecisionLogMode = feed.available || feed.reason !== 'endpoint-absent' ? 'server' : 'local'
  modeCache = { mode, at: Date.now() }
  return mode
}

/** 当前生效模式的页面提示；server 模式返回 SERVER_STORAGE_NOTE。 */
export function storageNoticeFor(mode: DecisionLogMode): string {
  return mode === 'server' ? SERVER_STORAGE_NOTE : PROTOTYPE_STORAGE_NOTICE
}

export type DecisionLogSnapshot = {
  mode: DecisionLogMode
  log: DecisionLogEntry[]
  /** server 模式加载失败时的错误（页面如实展示，不用空链冒充） */
  error: string | null
}

/** 统一加载入口：server → GET 列表；local → localStorage。 */
export async function loadLogAsync(): Promise<DecisionLogSnapshot> {
  const mode = await resolveDecisionLogMode()
  if (mode === 'local') return { mode, log: loadLog(), error: null }
  const feed = await fetchDecisionLogFeed()
  if (feed.available) return { mode, log: feed.entries, error: null }
  return {
    mode,
    log: [],
    error: feed.reason === 'unauthorized' ? '决策日志服务未授权（登录态或公司权限）' : '决策日志服务暂不可达，稍后重试'
  }
}

/** 服务端链校验结论（SHA-256 权威）；local 模式或服务不可用返回 null。 */
export async function fetchServerVerdict(
  mode: DecisionLogMode
): Promise<{ engine: string; verdict: ReturnType<typeof verifyChain> } | null> {
  if (mode !== 'server') return null
  return fetchChainVerdict()
}

// ── 写路径（按模式分发；错误向上抛，页面展示原因） ────────────────────────────

export async function appendAndPersistAsync(
  draft: DecisionLogDraft,
  decisionTime?: string | null
): Promise<DecisionLogEntry[]> {
  const mode = await resolveDecisionLogMode()
  if (mode === 'local') return appendAndPersist(draft)
  await postDecisionLog({
    targetDate: draft.targetDate,
    decisionPoint: draft.decisionPoint,
    judgement: draft.judgement,
    rationale: draft.rationale,
    p10: draft.p10,
    p50: draft.p50,
    p90: draft.p90,
    confidence: draft.confidence,
    correctionOf: null,
    // 决策时点（迁移 044 独立非哈希列，#2049 追涨/杀跌判定前置）：可选，缺省=时点未知
    decisionTime: decisionTime ?? null
    // 刻意不传 author（服务端按会话身份落名）与 at（落链时点由服务端定，见导入同款口径）
  })
  return reloadServer(mode)
}

export async function correctAndPersistAsync(
  targetId: string,
  draft: Omit<DecisionLogDraft, 'correctionOf'>
): Promise<DecisionLogEntry[]> {
  const mode = await resolveDecisionLogMode()
  if (mode === 'local') return correctAndPersist(targetId, draft)
  await postDecisionLog({
    targetDate: draft.targetDate,
    decisionPoint: draft.decisionPoint,
    judgement: draft.judgement,
    rationale: draft.rationale,
    p10: draft.p10,
    p50: draft.p50,
    p90: draft.p90,
    confidence: draft.confidence,
    at: draft.at,
    correctionOf: targetId
  })
  return reloadServer(mode)
}

export async function backfillAndPersistAsync(entryId: string, actual: number, lesson?: string): Promise<DecisionLogEntry[]> {
  const mode = await resolveDecisionLogMode()
  if (mode === 'local') return backfillAndPersist(entryId, actual, lesson)
  await postBackfill(entryId, lesson === undefined ? { actual } : { actual, lesson })
  return reloadServer(mode)
}

async function reloadServer(mode: DecisionLogMode): Promise<DecisionLogEntry[]> {
  const feed = await fetchDecisionLogFeed()
  if (feed.available) return feed.entries
  throw new Error(mode === 'server' ? '写入已落链，但刷新台账失败——刷新页面核对' : '写入后刷新失败')
}

// ── 本地原型实现（local 模式的落盘；也是导入源） ──────────────────────────────

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

/** 便捷：读取并校验链（local 模式 FNV；服务端条目勿用——SHA-256 哈希会被误判为断链）。 */
export function loadAndVerify(): { log: DecisionLogEntry[]; verdict: ReturnType<typeof verifyChain> } {
  const log = loadLog()
  return { log, verdict: verifyChain(log) }
}

// ── 原型 → 服务端的一次性迁移（显式触发，不自动搬） ──────────────────────────

/** 本地原型条数（server 模式下据此展示「导入浏览器原型数据」入口）。 */
export function localPrototypeCount(): number {
  return loadLog().length
}

export type ImportOutcome = {
  imported: number
  backfilled: number
  /** 部分失败时的原因（中断在哪条，剩余未导入） */
  error: string | null
}

/**
 * 把浏览器原型链按序导入服务端台账。显式操作（页面按钮触发，不自动）：
 *   · author 重置为导入者会话身份（服务端强制，本地 author 字段丢弃）；
 *   · at 以服务端落链时间为准（导入时间 ≠ 原判断时间，页面文案如实说明）；
 *   · 已回填过 actual 的条目追加后补 backfill；
 *   · 导入成功**不**清空本地——由使用者核对后手动清，双向都可追溯。
 */
export async function importLocalPrototypeToServer(): Promise<ImportOutcome & { log: DecisionLogEntry[] }> {
  const local = loadLog()
  const plan = buildImportPlan(local)
  if (!plan.length) return { imported: 0, backfilled: 0, error: null, log: [] }
  const idMap = new Map<string, string>()
  let backfilled = 0
  const finish = (error: string | null): ImportOutcome & { log: DecisionLogEntry[] } => ({
    imported: idMap.size,
    backfilled,
    error,
    log: []
  })
  for (const step of plan) {
    let correctionOf: string | null = null
    if (step.draft.correctionOf) {
      correctionOf = idMap.get(step.draft.correctionOf) ?? null
      if (!correctionOf) {
        return finish(`更正条目指向的本体（本地 id ${step.draft.correctionOf}）不在导入集内，导入中断于 ${step.localId}`)
      }
    }
    try {
      const entry = await postDecisionLog({ ...step.draft, correctionOf })
      idMap.set(step.localId, entry.id)
      if (step.backfill) {
        await postBackfill(entry.id, { actual: step.backfill.actual, lesson: step.backfill.lesson ?? undefined })
        backfilled += 1
      }
    } catch (e) {
      return finish(e instanceof Error ? e.message : '导入中断')
    }
  }
  const feed = await fetchDecisionLogFeed()
  return {
    imported: plan.length,
    backfilled,
    error: null,
    log: feed.available ? feed.entries : []
  }
}
