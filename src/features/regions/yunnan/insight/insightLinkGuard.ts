// insightLinkGuard.ts — 洞察跨页深链登记的公共守门骨架（dljy#3121 两套登记归一）
// ----------------------------------------------------------------------------
// businessLinks（#3096 业务只读深链）与 spatialLinks（#3106 空间查阅深链）职责相邻，
// 此前各自实现同一套守门逻辑。本模块把公共面收敛为一处，两套登记只保留各自的
// 条目数据（目标路径、白名单键、来源标记与各自的 query 组装语义）：
//   - 白名单校验（URL 编码安全）：键只含登记白名单，值均为非空标量字符串——数组、
//     嵌套对象不进 URL（CH05：URL 不携带敏感原始数据）；
//   - 可写动词拒绝：键名或值出现 submit/create/confirm 等即拒绝（跳转只承载「查看」）；
//   - 权限门控：governance.canAccessPath 既有口径，读取失败按无权限（不渲染入口）；
//   - 出口双保险：白名单 + 写动词再校验一遍，不合法不 push——宁可不开口，不带脏参数跳转。
// 差异语义留在各自登记：业务链要求期间键齐备（requiredKeys），空间链只要求非空 query。

import type { Router } from 'vue-router'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'

/** 深链守门口径：allowedKeys 为该登记的 query 白名单键；requiredKeys 给出时必须齐备
 *  （如业务链的期间 start/end 与 from），不给时要求 query 非空（如空间链至少带一个键）。 */
export type InsightLinkGuard = { allowedKeys: readonly string[]; requiredKeys?: readonly string[] }

/** 深链 query 里不允许出现的可写动词（键名与值都不允许）：跳转只承载「查看」。 */
const LINK_WRITE_VERBS = ['submit', 'create', 'confirm', 'approve', 'adjust', 'void', 'execute', 'action'] as const

/** 深链是否携带可写动词（键名或值里出现 submit/create/confirm 等）：携带即拒绝跳转。 */
export function insightLinkHasWriteVerb(query: Record<string, unknown>): boolean {
  return Object.entries(query).some(([key, value]) => {
    const text = `${key}=${String(value)}`.toLowerCase()
    return LINK_WRITE_VERBS.some((verb) => text.includes(verb))
  })
}

/** 白名单 query 校验（URL 编码安全骨架）：键只含白名单、值均为非空标量字符串（数组、
 *  嵌套对象不进 URL）；requiredKeys 齐备（或未给时 query 非空）才算合法深链。 */
export function isWhitelistedLinkQuery(query: Record<string, unknown>, guard: InsightLinkGuard): boolean {
  const entries = Object.entries(query)
  const required = guard.requiredKeys ?? []
  return (
    (required.length > 0 ? required.every((key) => key in query) : entries.length > 0) &&
    entries.every(([key]) => guard.allowedKeys.includes(key)) &&
    entries.every(([, value]) => typeof value === 'string' && value.length > 0)
  )
}

/** 目标路径对当前用户是否可访问（governance 既有口径；读取失败按无权限处理，不渲染入口）。 */
export function canFollowInsightLink(path: string): boolean {
  try {
    return canAccessPath(path, getCurrentUser())
  } catch {
    return false
  }
}

/** 组装并跳转的统一出口（双保险）：query 通过白名单校验且无可写动词才 push，否则不动
 *  ——入口显隐已由页面按权限判定，这里再兜一道，不带脏参数跳转。 */
export function openInsightLink(
  router: Router,
  args: { path: string; query: Record<string, string>; guard: InsightLinkGuard }
): void {
  if (!isWhitelistedLinkQuery(args.query, args.guard) || insightLinkHasWriteVerb(args.query)) return
  void router.push({ path: args.path, query: args.query })
}
