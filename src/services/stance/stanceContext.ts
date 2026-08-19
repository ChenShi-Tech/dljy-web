// 作业立场上下文（当前以哪个市场主体身份作业）， Epic #2193 立场体系前端层
// ----------------------------------------------------------------------------
// 与 regionContext（全局地区）/ companyContext（公司视图）同构的第三个上下文，
// 但有一条不能照抄的关键差别：
//
// 立场允许集合只来自服务端下发（登录/刷新 payload 的 `user.stances`，服务端按
// 「公司注册立场 ∩ 身份」推导，见 `server/auth-store.mjs::deriveUserStances`），
// 前端零推导、零覆盖表。旧 positionContext 的「公司立场∩身份」客户端推导已上收
// 服务端（#2193 决策），`src/data/companyPositions.ts` 硬编码覆盖表随之删除
// 前端能自由改「我是什么立场」＝能自行装配出无权提交的申报单据。
//
// 与 allowedSubjectTypes 的正交论证（继承自 positionContext，仍是红线）：
// `allowedSubjectTypes` 是数据可见范围（data-scope.mjs 用它过滤数据行），
// 回答「我能看到哪些主体类型的数据」；立场回答「我能以哪个主体身份作业」。
// 把它当立场集合并扩大，等于顺手扩大数据可见范围，那是越权面，不是功能。
//
// 切换协议（克隆 x-company-id 模式）：本模块只把选择存 localStorage 并经 api.ts
// 统一注入 `x-stance-id` 头（值 = `subjectType:subjectId`）；服务端校验 ∈ 允许集合，
// 越权 403。缺头 = home 立场（现行为）。
//
// 空态原则：会话未就绪/数据脏 → 空集合、activeStance=null，**不得默认成任何具体
// 立场**（默认成售电就是把储能主体的单据换成售电单据）。单立场账号自动落 home。

import { computed, ref } from 'vue'
import { isStanceShape, type Stance, type SubjectType } from '@/services/governance'

const STORAGE_KEY = 'dljy.activeStance'
// 旧 positionContext 的残留键：登出/清空时一并移除，防旧值被误当新偏好。
const LEGACY_STORAGE_KEY = 'dljy.activePosition'
const USER_STORAGE_KEY = 'dljy_governance_user'

const VALID_SUBJECT_TYPES: readonly SubjectType[] = ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER']

const stancesRef = ref<Stance[]>([])
const activeKeyRef = ref<string | null>(null)
let syncedOnce = false

export const stances = computed(() => stancesRef.value)
export const activeStance = computed(() =>
  activeKeyRef.value ? stancesRef.value.find((s) => stanceKeyOf(s) === activeKeyRef.value) ?? null : null
)
/** 兼容交易日组件的旧语义：当前立场的类型（无活跃立场时 null）。 */
export const activeStanceType = computed<SubjectType | null>(() => activeStance.value?.subjectType ?? null)
export const activeStanceKey = computed(() => activeKeyRef.value)
/** 多立场账号才需要选择页与顶栏切换器；单立场不显示任何切换 UI。 */
export const isMultiStance = computed(() => stancesRef.value.length > 1)

/** 立场唯一键：类型 + 主体 id 联合（crossView 立场共用账号主体 id，仅类型不同）。 */
export function stanceKeyOf(stance: Pick<Stance, 'subjectType' | 'subjectId'>): string {
  return `${String(stance.subjectType).toUpperCase()}:${String(stance.subjectId ?? '')}`
}

type SessionUserLike = {
  subjectType?: string
  subjectId?: string
  subjectName?: string
  stances?: unknown
} | null | undefined

/**
 * 从会话用户（登录/刷新 payload 或 localStorage 存档）同步立场集合并校准当前立场。
 * 调用时机：登录成功、getInfo 刷新、governance-user-changed、深层直链守卫（惰性）。
 * 幂等。服务端 stances 缺失（旧会话/降级部署）→ 按 home 单立场兜底，行为等同历史。
 */
export function syncStancesFromSession(user?: SessionUserLike): void {
  syncedOnce = true
  const next = normalizeStances(user?.stances, user)
  stancesRef.value = next

  if (!next.length) {
    activeKeyRef.value = null
    return
  }
  // 单立场自动落 home，不进选择页；多立场须本地偏好（在集合内）或显式选择。
  if (next.length === 1) {
    activeKeyRef.value = stanceKeyOf(next[0])
    persist(activeKeyRef.value)
    return
  }
  const stored = readStoredKey()
  activeKeyRef.value = stored && next.some((s) => stanceKeyOf(s) === stored) ? stored : null
}

/**
 * 切换当前作业立场。守卫：拒绝切到不在允许集合内的立场（防御性，真正的闸门在
 * 服务端 x-stance-id 校验），返回是否成功，便于界面给出反馈而非静默失败。
 */
export function setActiveStance(key: string): boolean {
  const matched = stancesRef.value.find((s) => stanceKeyOf(s) === key)
  if (!matched) return false
  activeKeyRef.value = key
  persist(key)
  return true
}

/** 多立场且尚无有效选择 → 路由层引导到 /select-stance。 */
export function requiresStanceSelection(): boolean {
  ensureSynced()
  return stancesRef.value.length > 1 && activeKeyRef.value === null
}

/** api.ts 统一注入用：无活跃立场（未登录/未选择）返回 null，不发头（服务端=home）。 */
export function currentStanceHeader(): string | null {
  ensureSynced()
  return activeKeyRef.value
}

/** 登出清空（auth.clearAuthState 调用），避免下一个账号继承上一个账号的立场。 */
export function clearStanceContext(): void {
  stancesRef.value = []
  activeKeyRef.value = null
  syncedOnce = false
  safeRemove()
}

// 内部工具

/** 深层直链场景：守卫先于任何显式 sync 调用时，从 localStorage 存档惰性同步。 */
function ensureSynced() {
  if (syncedOnce) return
  syncStancesFromSession(readStoredUserRaw())
}

/** 直接读 localStorage 用户存档（不经 auth 模块，避免与 auth↔stance 相互 import 成环）。 */
function readStoredUserRaw(): SessionUserLike {
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as SessionUserLike
  } catch {
    return null
  }
}

/** 去重 + 剔除非法值；服务端 stances 缺失时按账号 home 三元组兜底（单立场）。 */
function normalizeStances(list: unknown, user: SessionUserLike): Stance[] {
  const out: Stance[] = []
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!isStanceShape(item)) continue
      if (!VALID_SUBJECT_TYPES.includes(item.subjectType)) continue
      const key = stanceKeyOf(item)
      if (out.some((s) => stanceKeyOf(s) === key)) continue
      out.push(item)
    }
  }
  if (out.length) return out
  const homeType = String(user?.subjectType ?? '') as SubjectType
  if (!VALID_SUBJECT_TYPES.includes(homeType)) return []
  return [{
    subjectType: homeType,
    subjectId: String(user?.subjectId ?? ''),
    subjectName: String(user?.subjectName ?? ''),
    crossView: false
  }]
}

function readStoredKey(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw && raw.includes(':') ? raw : null
  } catch {
    return null
  }
}

function persist(key: string | null) {
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage 不可用（隐私模式/配额满）不应阻断作业，立场退化为单次会话内有效。
  }
}

function safeRemove() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // 同上。
  }
}
