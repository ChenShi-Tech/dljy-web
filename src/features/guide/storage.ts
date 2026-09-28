// 导引会话与完成记录的持久化（dljy#3404）。
// 键布局：`dljy.guide.v1|<用户名>|<来源公司>` 存会话；`…|active` 存当前会话的来源公司指针；
// `…|done` 存已完成的 guideId 列表。只存界面进度与已建记录 id，不存业务数据。
// 读写全 try/catch：隐私模式 / 配额满 / 数据损坏一律静默降级（当作没有会话），绝不抛错打断页面。
import type { GuideSession } from './types'

const PREFIX = 'dljy.guide.v1'
const SESSION_STATUSES = ['running', 'paused', 'target-missing', 'done']

// node 测试环境没有 localStorage：内存 Map 兜底，行为一致只是不跨刷新。
const memory = new Map<string, string>()
let backing: Storage | null | undefined

function store(): Storage | null {
  if (backing !== undefined) return backing
  try {
    backing = typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    backing = null
  }
  return backing
}

function readRaw(key: string): string | null {
  try {
    const value = store()?.getItem(key)
    if (typeof value === 'string') return value
  } catch {
    // 读取被拦（权限策略等）：当没有数据。
  }
  return memory.get(key) ?? null
}

function writeRaw(key: string, value: string): void {
  try {
    store()?.setItem(key, value)
  } catch {
    // 写入被拦 / 配额满：静默丢弃，刷新后导引从头再来，不影响页面。
  }
  memory.set(key, value)
}

function removeRaw(key: string): void {
  try {
    store()?.removeItem(key)
  } catch {
    // 同上：清理失败不抛。
  }
  memory.delete(key)
}

/** 形状与版本校验：不符即视为损坏，调用方丢弃。 */
function isGuideSession(value: unknown): value is GuideSession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    s.v === 1
    && typeof s.guideId === 'string'
    && typeof s.stepId === 'string'
    && typeof s.runTag === 'string'
    && typeof s.artifacts === 'object' && s.artifacts !== null
    && typeof s.originCompanyId === 'string'
    && typeof s.practiceCompanyId === 'string'
    && typeof s.regionId === 'string'
    && SESSION_STATUSES.includes(String(s.status))
    && typeof s.startedAt === 'number'
    && typeof s.updatedAt === 'number'
  )
}

function sessionKey(username: string, originCompanyId: string): string {
  return `${PREFIX}|${username}|${originCompanyId}`
}

function activeKey(username: string): string {
  return `${PREFIX}|${username}|active`
}

function doneKey(username: string): string {
  return `${PREFIX}|${username}|done`
}

/** 读会话：无 / 损坏 / 版本不符都返回 null。 */
export function loadGuideSession(username: string, originCompanyId: string): GuideSession | null {
  const raw = readRaw(sessionKey(username, originCompanyId))
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isGuideSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveGuideSession(username: string, originCompanyId: string, session: GuideSession): void {
  writeRaw(sessionKey(username, originCompanyId), JSON.stringify(session))
}

export function clearGuideSession(username: string, originCompanyId: string): void {
  removeRaw(sessionKey(username, originCompanyId))
}

/** active 指针：记录当前导引属于哪个来源公司，刷新恢复时按它定位会话键。 */
export function loadActiveGuideOrigin(username: string): string | null {
  return readRaw(activeKey(username))
}

export function saveActiveGuideOrigin(username: string, originCompanyId: string): void {
  writeRaw(activeKey(username), originCompanyId)
}

export function clearActiveGuideOrigin(username: string): void {
  removeRaw(activeKey(username))
}

/** 完成记录：完成后在选择面板显示「已完成 · 再来一遍」。 */
export function markGuideCompleted(username: string, guideId: string): void {
  const done = loadCompletedGuides(username)
  if (done.includes(guideId)) return
  writeRaw(doneKey(username), JSON.stringify([...done, guideId]))
}

export function loadCompletedGuides(username: string): string[] {
  const raw = readRaw(doneKey(username))
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/** 测试用：重置探测缓存与内存兜底；生产代码不得调用。 */
export function resetGuideStorageCache(): void {
  backing = undefined
  memory.clear()
}
