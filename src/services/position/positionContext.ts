// ============================================================================
// 作业立场上下文（当前以哪个市场立场视角作业）
// ----------------------------------------------------------------------------
// 与 regionContext（全局地区）同构，但有两条**不能照抄**的关键差别：
//
// ① 地区是运行时可切的业务维度；立场是**市场主体注册属性**，来自公司维度。
//    前端能自由改「我是什么立场」＝能自行装配出无权提交的申报单据。
//
// ② 立场集合**不复用用户的 `allowedSubjectTypes`**。那个字段是数据可见范围
//    （`server/middleware/data-scope.mjs` 用它过滤数据行），回答「我能看到哪些主体
//    类型的数据」；立场回答「我能以哪个主体身份申报」。两者正交，混用会把一次
//    功能改动变成一次越权面扩大。
//
// 可用作业立场 = 公司注册立场集合 ∩ 用户身份允许的范围：
//    · 会话主立场是 TRADER（交易组合）或 GROUP（集团）→ 组合/管理视角，
//      可在公司注册的全部立场间切换；
//    · 否则 → 只有自己的主立场，且必须在公司注册集合内（不在则空态，
//      因为「用户说自己是储能、但公司没注册储能主体」是配置错误，不该放行）。
//
// 为什么需要「切换」而不是平铺：手册所述「既买又卖」主体在同一天要提交两套互不
// 相干的单据，且新疆规则明令两种身份不得在同一标的交易（须分账户分标的）。把两套
// 单据平铺在一个界面上，交易员分不清自己在给哪个主体报价——这正是身份混用红线最
// 容易被踩的地方。分视角作业是业务要求，不是界面偏好。
// ============================================================================

import { computed, ref } from 'vue'
import { getStoredUser, type AuthUser } from '@/services/auth'
import { companyPositionsOf } from '@/data/companyPositions'
import type { SubjectType } from '@/services/governance'

const STORAGE_KEY = 'dljy.activePosition'

/** 会话主立场属于「跨立场视角」的取值：组合管理者与集团管理层。 */
const CROSS_POSITION_VIEWS: readonly SubjectType[] = ['TRADER', 'GROUP']

/**
 * 可用作业立场集合。空数组表示「会话未就绪 / 公司未注册主体 / 配置不一致」——
 * 调用方须走空态，**不得默认成任何具体立场**（默认成售电就是把储能主体的单据
 * 换成售电单据）。
 */
const availablePositionsRef = ref<SubjectType[]>([])
const activePositionRef = ref<SubjectType | null>(null)

export const availablePositions = computed(() => availablePositionsRef.value)
export const activePosition = computed(() => activePositionRef.value)

/** 多立场主体才需要视角切换器；单立场不显示切换 UI。 */
export const isMultiPosition = computed(() => availablePositionsRef.value.length > 1)

/**
 * 从会话 + 公司注册立场推导可用集合，并校验/修正当前作业立场。
 * 调用时机：应用启动、登录成功、切换用户/公司、进入依赖立场的页面。幂等。
 */
export function syncPositionsFromSession(user?: AuthUser | null): void {
  const session = user ?? getStoredUser()
  const primary = isSubjectType(session?.subjectType) ? session.subjectType : null
  const registered = normalize(companyPositionsOf(session?.companyId, primary))

  availablePositionsRef.value = resolveAvailable(primary, registered)

  const allowed = availablePositionsRef.value
  if (!allowed.length) {
    activePositionRef.value = null
    return
  }

  // 优先级：本地偏好（须在可用集合内）→ 会话主立场 → 集合首项。
  const stored = readStored()
  if (stored && allowed.includes(stored)) {
    activePositionRef.value = stored
    return
  }
  activePositionRef.value = primary && allowed.includes(primary) ? primary : allowed[0]
  persist(activePositionRef.value)
}

/**
 * 切换当前作业立场。
 * 守卫：拒绝切到不在可用集合内的立场，返回是否成功，便于界面给出反馈而非静默失败。
 */
export function setActivePosition(position: SubjectType): boolean {
  if (!availablePositionsRef.value.includes(position)) return false
  activePositionRef.value = position
  persist(position)
  return true
}

/** 会话失效时清空（登出时调用），避免下一个账号继承上一个账号的立场视角。 */
export function clearPositionContext(): void {
  availablePositionsRef.value = []
  activePositionRef.value = null
  safeRemove()
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

const VALID: readonly SubjectType[] = ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER']

function isSubjectType(value: unknown): value is SubjectType {
  return typeof value === 'string' && (VALID as readonly string[]).includes(value)
}

/** 去重 + 剔除非法值：配置与历史数据都可能带入已废弃的立场名。 */
function normalize(list: unknown): SubjectType[] {
  if (!Array.isArray(list)) return []
  const out: SubjectType[] = []
  for (const item of list) {
    if (isSubjectType(item) && !out.includes(item)) out.push(item)
  }
  return out
}

/**
 * 可用集合 = 公司注册立场 ∩ 用户身份允许范围。
 * 跨立场视角（TRADER/GROUP）取公司注册全集；其余取主立场单值且须被公司注册。
 */
function resolveAvailable(primary: SubjectType | null, registered: SubjectType[]): SubjectType[] {
  if (!primary) return []
  if (CROSS_POSITION_VIEWS.includes(primary)) {
    // 组合/管理视角：公司注册了什么就能看什么；公司未登记则退回主立场自身，
    // 保证 TRADER 账号至少有组合视角可用（其申报线为三线全集）。
    return registered.length ? registered : [primary]
  }
  return registered.includes(primary) ? [primary] : []
}

function readStored(): SubjectType | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isSubjectType(raw) ? raw : null
  } catch {
    return null
  }
}

function persist(position: SubjectType | null): void {
  try {
    if (position) window.localStorage.setItem(STORAGE_KEY, position)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage 不可用（隐私模式/配额满）不应阻断作业，视角退化为单次会话内有效。
  }
}

function safeRemove(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上
  }
}
