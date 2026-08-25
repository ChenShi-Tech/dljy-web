// 临场改价留痕 · localStorage store（Epic #2033 · S1 策略复盘 · #2016 缺口二）
// ---------------------------------------------------------------------------
// 「计划价 → 临场改价」及依据的事后可追溯记录：当日登记（计划价/改后价/依据），
// 次日复盘时回判「改对/改错」——改对=可复制（值得沉淀为规则），改错=需修正（纪律问题）。
// 纪律对齐 tradingMemory.ts：纯函数不碰 localStorage（模块顶层零访问），
// 持久化仅函数内读写，存储不可用时降级内存态不阻断作业。
import { PRICE_CHANGE_VERDICT_LABEL, type PriceChangeVerdict } from '@/services/review/strategyReview'

const STORAGE_KEY = 'dljy.prototype.strategyPriceChanges'

export type PriceChangeRecord = {
  id: string
  /** 改价发生的作业日 YYYY-MM-DD */
  date: string
  /** 关联决策点（如「晚高峰申报价」；自由文本） */
  decisionPoint: string
  /** 计划价（申报前定的价） */
  planPrice: number
  /** 临场改后价 */
  changedPrice: number
  /** 改价依据（当时看到了什么） */
  rationale: string
  /** 登记时间戳（ms） */
  ts: number
  /** 事后判定：null=待判定（次日回判）；改对=可复制 / 改错=需修正 */
  verdict: PriceChangeVerdict | null
  /** 判定备注（对在哪/错在哪，供沉淀） */
  verdictNote: string | null
}

function loadAll(): PriceChangeRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PriceChangeRecord[]) : []
  } catch {
    return []
  }
}

function persist(records: PriceChangeRecord[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 存储不可用（隐私模式等）：本次仅内存口径，不阻断登记作业
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `pc-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export type PriceChangeDraft = {
  date: string
  decisionPoint: string
  planPrice: number
  changedPrice: number
  rationale: string
}

/** 校验草稿（纯函数）：返回错误文案数组，空=可登记。 */
export function validatePriceChangeDraft(draft: PriceChangeDraft): string[] {
  const issues: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) issues.push('日期必须是 YYYY-MM-DD')
  if (!draft.decisionPoint.trim()) issues.push('决策点必填')
  if (!Number.isFinite(draft.planPrice)) issues.push('计划价必须是数值')
  if (!Number.isFinite(draft.changedPrice)) issues.push('改后价必须是数值')
  if (Number.isFinite(draft.planPrice) && Number.isFinite(draft.changedPrice) && draft.planPrice === draft.changedPrice) {
    issues.push('改后价与计划价相同——没有改动就不算临场改价')
  }
  if (!draft.rationale.trim()) issues.push('改价依据必填（当时看到了什么）')
  return issues
}

/** 登记一条临场改价（当日或补登），返回新列表。校验失败向上抛（页面展示原因）。 */
export function addPriceChange(draft: PriceChangeDraft): PriceChangeRecord[] {
  const issues = validatePriceChangeDraft(draft)
  if (issues.length) throw new Error(issues.join('；'))
  const records = loadAll()
  const record: PriceChangeRecord = {
    id: newId(),
    date: draft.date,
    decisionPoint: draft.decisionPoint.trim(),
    planPrice: draft.planPrice,
    changedPrice: draft.changedPrice,
    rationale: draft.rationale.trim(),
    ts: Date.now(),
    verdict: null,
    verdictNote: null,
  }
  const next = [...records, record]
  persist(next)
  return next
}

export function listPriceChanges(): PriceChangeRecord[] {
  return loadAll()
}

/** 待判定清单（verdict=null），按日期倒序——次日晨会回判的工作清单。 */
export function pendingPriceChanges(): PriceChangeRecord[] {
  return loadAll()
    .filter((r) => r.verdict === null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** 已判定清单（供「可复制」经验沉淀查看）。 */
export function judgedPriceChanges(): PriceChangeRecord[] {
  return loadAll().filter((r) => r.verdict !== null)
}

/** 回判一条：改对（可复制）/改错（需修正），可附对错备注。id 不存在返回 null。 */
export function judgePriceChange(id: string, verdict: PriceChangeVerdict, note?: string): PriceChangeRecord[] | null {
  const records = loadAll()
  const idx = records.findIndex((r) => r.id === id)
  if (idx === -1) return null
  records[idx] = { ...records[idx], verdict, verdictNote: note?.trim() || null }
  const next = [...records]
  persist(next)
  return next
}

/** 判定结论文案（改对=可复制 / 改错=需修正）。 */
export function verdictLabelOf(verdict: PriceChangeVerdict | null): string {
  return verdict ? PRICE_CHANGE_VERDICT_LABEL[verdict] : '待判定'
}

/** 清空（仅原型演示/测试用）。 */
export function clearPriceChanges(): PriceChangeRecord[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同 persist
  }
  return []
}
