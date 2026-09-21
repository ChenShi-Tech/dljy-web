// 业务模块只读深链（dljy#3096，OpenSpec build-yunnan-regional-market-insight 任务 15.5）
// ----------------------------------------------------------------------------
// 规格依据：insight-context-handoff CH04（交易合同与结算模块边界）、
// yunnan-plant-market-performance PP07（厂站详情与原操作分离）、design D11 表与 D2.1。
// 红线（任务 15.5 验收原文）：
//   - 进入只传证据（期间 start/end、对象名）与授权入口，不自动创建/提交交易，
//     不更改合同/电费，不增加无权限操作；
//   - 入口显隐由 governance.canAccessPath 对目标路径做既有口径判定（复用权限别名与
//     角色授权表，不新增权限面）；无权限不渲染，而不是渲染后再让目标页拦截；
//   - 深链 query 只允许白名单键（期间、对象名、来源标记、目标页面板），原始数据数组
//     与可写动词不进 URL（CH05：URL 不得携带敏感原始数据；跳转是查看，不是发起操作）。
// 目标均为既有业务模块的只读页面路径；本模块不创建任何写端点链接，也不持有业务状态。

import type { Router } from 'vue-router'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'

/** 深链目标：既有业务模块的只读页面路径（只读语义的入口登记处，文档与测试共用）。 */
export const DEEP_LINK_TARGETS = {
  /** 结算/复盘业务页（复盘中心：结算复盘、日报核验；不做结算确认与电费修正） */
  settlementReview: '/xhjy/review',
  /** 中长期模块只读台账（月度持仓：已确认售电义务按月汇总） */
  midlongPositions: '/zcqjy/positions',
  /** 上传中心/资料维护（数据运维工作台的上传面板；原权限决定是否可维护） */
  dataMaintenance: '/data-ops/console',
} as const

/** 深链 query 白名单键：期间（start/end）、单个对象名（object）、来源标记（from）、
 *  目标页面板（panel，仅资料维护跳转用）。其余键一律不带。 */
const DEEP_LINK_QUERY_KEYS = ['start', 'end', 'object', 'from', 'panel'] as const

/** 深链 query 里不允许出现的可写动词（键名与值都不允许）：跳转只承载「查看」。 */
const WRITE_VERBS = ['submit', 'create', 'confirm', 'approve', 'adjust', 'void', 'execute', 'action'] as const

/** 来源标记：接收方与排查用「这条深链从洞察哪个页面发出」。 */
export type InsightDeepLinkOrigin = 'insight-plants' | 'insight-prices'

/** 业务窗口引用（与 useInsightContext.businessWindow 同形）。 */
export type BusinessWindowRef = { start: string; end: string }

/**
 * 深链 query：仅非敏感 ID（期间/对象名）+ from 标记。
 * 空对象名不带键；值一律非空字符串——数组、嵌套对象不进 URL（CH05）。
 */
export function businessDeepLinkQuery(args: {
  window: BusinessWindowRef
  from: InsightDeepLinkOrigin
  objectId?: string | null
}): Record<string, string> {
  const query: Record<string, string> = {
    start: args.window.start,
    end: args.window.end,
    from: args.from,
  }
  if (args.objectId) query.object = args.objectId
  return query
}

/** 深链必备键：期间（start/end）与来源标记（from）。缺任何一个都不算合法深链。 */
const DEEP_LINK_REQUIRED_KEYS = ['start', 'end', 'from'] as const

/** query 是否为合法深链：必备键齐全、只含白名单键、值均为非空字符串（组装出口的统一闸门，测试共用判定）。 */
export function isDeepLinkQuery(query: Record<string, unknown>): boolean {
  const entries = Object.entries(query)
  return (
    DEEP_LINK_REQUIRED_KEYS.every((key) => key in query) &&
    entries.every(([key]) => (DEEP_LINK_QUERY_KEYS as readonly string[]).includes(key)) &&
    entries.every(([, value]) => typeof value === 'string' && value.length > 0)
  )
}

/** 深链是否携带可写动词（键名或值里出现 submit/create/confirm 等）：携带即拒绝跳转。 */
export function deepLinkHasWriteVerb(query: Record<string, unknown>): boolean {
  return Object.entries(query).some(([key, value]) => {
    const text = `${key}=${String(value)}`.toLowerCase()
    return WRITE_VERBS.some((verb) => text.includes(verb))
  })
}

/** 目标路径对当前用户是否可访问（governance 既有口径；读取失败按无权限处理，不渲染入口）。 */
export function canFollowDeepLink(path: string): boolean {
  try {
    return canAccessPath(path, getCurrentUser())
  } catch {
    return false
  }
}

/** 组装并跳转：入口显隐已由页面按 canFollowDeepLink 判定；这里再保证 query 只含
 *  白名单键且无可写动词（双保险），不合法直接不动——宁可不开口，不带脏参数跳转。 */
export function openBusinessDeepLink(router: Router, args: { path: string; query: Record<string, string> }): void {
  if (!isDeepLinkQuery(args.query) || deepLinkHasWriteVerb(args.query)) return
  void router.push({ path: args.path, query: args.query })
}

/** 「前往资料维护」：跳上传中心面板，携带缺口期间与来源标记（显隐在页面按权限判定）。 */
export function openDataMaintenanceLink(
  router: Router,
  args: { window: BusinessWindowRef; from: InsightDeepLinkOrigin }
): void {
  openBusinessDeepLink(router, {
    path: DEEP_LINK_TARGETS.dataMaintenance,
    query: { ...businessDeepLinkQuery({ window: args.window, from: args.from }), panel: 'upload' },
  })
}
