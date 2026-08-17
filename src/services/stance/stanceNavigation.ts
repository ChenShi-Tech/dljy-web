// ============================================================================
// 立场导航视图层（Epic #2193 · #2196）——同一导航树按立场出不同工作台
// ----------------------------------------------------------------------------
// 设计与 regionNavigation 同构（过滤 + isPathAvailable + 切换路由三件套），但有一条
// 关键差别：立场亲和只做**视图层重组**，不动 RBAC——canAccessPath（角色白名单）与
// isPathAvailableInRegion（地区门控）照旧生效，本层在其上再叠一层「该页属于哪个
// 立场的专属工作台」。
//
// 可见性规则：
//   · 缺省（无 stanceAffinity）= 共享页，全立场可见；
//   · 组合/集团视角（TRADER/GROUP 主立场）恒全可见——它们天然跨立场作业；
//   · 专职立场（GENERATOR/RETAILER/STORAGE/LOAD）只看共享页 + 本立场专属页。
//
// 标注刻意保守（P1 三桶只标清楚无疑的叶子，如机组台账/日前上报=发电、售电电价
// 测算=售电）：宁可少过滤、不可把人正在用的页藏掉；预测中心等「页内 tab 分立场」
// 的入口按共享处理，立场分化下沉到页内 tab。
// ============================================================================

import { navigation } from '@/data/navigation'
import type { NavItem } from '@/data/navigation'
import { canAccessPath, firstAccessiblePath, type NavigationLike } from '@/services/governance'
import type { SubjectType } from '@/services/governance'

/** 跨立场视角：组合（TRADER）与集团（GROUP）主立场看全量，不做立场过滤。 */
export const CROSS_VIEW_STANCE_TYPES: readonly SubjectType[] = ['TRADER', 'GROUP']

type StancedItem = NavigationLike & { stanceAffinity?: SubjectType[]; children?: StancedItem[] }
type UserLike = Parameters<typeof canAccessPath>[1]

/** 单条导航项在给定立场下是否可见（规则见模块注释）。 */
export function matchesNavigationStance(item: StancedItem, stanceType: SubjectType | null | undefined): boolean {
  if (!stanceType) return true // 立场未定（未登录/未选择）→ 只走角色/地区过滤，行为与历史一致
  if (CROSS_VIEW_STANCE_TYPES.includes(stanceType)) return true
  const affinity = item.stanceAffinity
  if (!affinity?.length) return true
  return affinity.includes(stanceType)
}

/** 递归过滤导航树：分组内有任一可见子项才保留分组。 */
export function filterNavigationForStance(items: StancedItem[], stanceType: SubjectType | null | undefined): StancedItem[] {
  const out: StancedItem[] = []
  for (const item of items) {
    if (item.children?.length) {
      const children = filterNavigationForStance(item.children, stanceType)
      if (children.length) out.push({ ...item, children })
      continue
    }
    if (matchesNavigationStance(item, stanceType)) out.push(item)
  }
  return out
}

// path → stanceAffinity 注册表：从导航树一次性拍平（feature 注入组随 navigation
// 导出同步收录）。未登记的 path = 共享，直链守卫放行。
const affinityByPath = new Map<string, SubjectType[]>()
function registerAffinity(items: NavItem[]) {
  for (const item of items) {
    if (item.stanceAffinity?.length) {
      affinityByPath.set(item.path, item.stanceAffinity)
    }
    if (item.children?.length) registerAffinity(item.children)
  }
}
registerAffinity(navigation)

/** 直链可用性：该路径是否属于当前立场的可见面（共享/未登记/组合视角恒可用）。 */
export function isPathAvailableInStance(path: string, stanceType: SubjectType | null | undefined): boolean {
  if (!stanceType) return true
  if (CROSS_VIEW_STANCE_TYPES.includes(stanceType)) return true
  const affinity = affinityByPath.get(path)
  if (!affinity?.length) return true
  return affinity.includes(stanceType)
}

function canUseRouteInStance(path: string, stanceType: SubjectType | null | undefined, user: UserLike) {
  return isPathAvailableInStance(path, stanceType) && canAccessPath(path, user)
}

/**
 * 立场切换后的路由解析：当前页在新立场仍可用则停留（系统页/共享页不踢人），
 * 否则落该用户的默认工作台（firstAccessiblePath：角色×地区感知）。
 */
export function resolveStanceSwitchRoute(stanceType: SubjectType | null | undefined, user: UserLike, fromPath: string) {
  const normalized = fromPath.startsWith('/') ? fromPath : `/${fromPath}`
  if (canUseRouteInStance(normalized, stanceType, user)) return normalized
  return firstAccessiblePath(user)
}
