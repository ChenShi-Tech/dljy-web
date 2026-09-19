// 空间查阅深链（dljy#3106 图表清单核对 D6.1「三维地形、场站/节点空间位置」行未就绪项补齐）
// ----------------------------------------------------------------------------
// 规格依据：design D6.1 末行——三维地形、场站/节点空间位置：从节点/电网/场站动作进入
// 已有空间资产，保留入口与上下文，不在洞察复制 Cesium、底图、拓扑维护。
// 模式复用 businessLinks（#3096 任务 15.5 的登记+白名单+权限+出口模式；该登记文件在
// feat/insight-deeplink 分支，本分支尚未合入，故此处独立登记，红线与其一致）：
//   - 目标均为既有 grid-geo 模块的只读空间场景路径；洞察零复制 Cesium/底图/拓扑维护；
//   - 入口显隐由 governance.canAccessPath 对目标路径做既有口径判定（复用权限别名与
//     角色授权表，不新增权限面）；无权限不渲染，而不是渲染后再让目标页拦截；
//   - 深链 query 只允许白名单键（grid-geo 对象上下文既有键 + 披露检索词 + 来源标记），
//     值均为非空字符串；时段数组、原始序列与可写动词不进 URL（跳转是查看，不是发起操作）；
//   - 对象绑定需要公司范围明确（grid-geo 对象上下文按 地区+公司 校验归属，见
//     gridGeo/objectNavigation readGridObjectQuery）：公司未选或多对象选中时不渲染入口——
//     宁可不开口，不带一半上下文假装能承接。

import type { Router } from 'vue-router'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'

/** 空间查阅目标：既有 grid-geo 只读空间场景路径（登记处，文档与测试共用）。 */
export const SPATIAL_LINK_TARGETS = {
  /** 电力市场空间态势：节点/场站对象上下文绑定（对象栏、场站卡、价差/出力图层） */
  marketSpatial: '/grid-assets/market',
  /** 公开披露空间层：通道/断面名经检索词承接（输电主题披露与指标按名过滤） */
  disclosureSpatial: '/grid-assets/disclosures',
} as const

export type SpatialLinkTarget = (typeof SPATIAL_LINK_TARGETS)[keyof typeof SPATIAL_LINK_TARGETS]

/** 来源标记：这条深链从洞察哪个页面发出（接收方与排查用，不参与权限与数据判定）。 */
export type SpatialLinkOrigin = 'insight-prices' | 'insight-grid-boundaries' | 'insight-plants'

/** query 白名单键：对象绑定用 grid-geo 对象上下文既有键（objectNavigation 的接收口径），
 *  keyword 为披露空间层搜索词预填，from 为来源标记。其余键一律不带。 */
const SPATIAL_LINK_QUERY_KEYS = ['objectKind', 'objectId', 'objectRegion', 'objectCompany', 'objectDate', 'keyword', 'from'] as const

/** 深链 query 里不允许出现的可写动词（键名与值都不允许）：跳转只承载「查看」。 */
const WRITE_VERBS = ['submit', 'create', 'confirm', 'approve', 'adjust', 'void', 'execute', 'action'] as const

/** 真实日历业务日（YYYY-MM-DD，回读一致）；格式对但日历不存在（如 2026-13-01）不算。 */
function isBusinessDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

/**
 * 对象绑定 query（价格页节点 / 场站页单场站 → 电力市场空间态势）。
 * 只带单个对象名 + 地区/公司归属 + 业务日期（objectDate，洞察窗口末日）+ 来源标记；
 * 对象名、地区、公司任一为空则不组装（返回空 query，出口不会 push）——
 * 不带一半上下文假装能承接。时段（objectFrom/objectTo）是时刻区间，洞察业务日期窗
 * 没有时刻，不伪造，一律不带。
 */
export function objectSpatialLinkQuery(args: {
  kind: 'node' | 'plant'
  objectId: string
  regionId: string
  companyId: string
  date?: string
  from: SpatialLinkOrigin
}): Record<string, string> {
  if (!args.objectId || !args.regionId || !args.companyId) return {}
  const query: Record<string, string> = {
    objectKind: args.kind,
    objectId: args.objectId,
    objectRegion: args.regionId,
    objectCompany: args.companyId,
    from: args.from,
  }
  if (isBusinessDate(args.date)) query.objectDate = args.date
  return query
}

/**
 * 关键词承接 query（电网页通道/断面 → 公开披露空间层）：通道/断面在 grid-geo 无独立
 * 对象类型，以披露检索词承接（对象名预填搜索，输电主题按名过滤），不伪造对象绑定；
 * 业务日期（洞察窗口末日）经 objectDate 落到披露观察台。关键词为空不组装。
 */
export function keywordSpatialLinkQuery(args: { keyword: string; date?: string; from: SpatialLinkOrigin }): Record<string, string> {
  if (!args.keyword) return {}
  const query: Record<string, string> = { keyword: args.keyword, from: args.from }
  if (isBusinessDate(args.date)) query.objectDate = args.date
  return query
}

/** query 是否为合法空间深链：非空、只含白名单键、值均为非空字符串（数组/嵌套对象拒绝）。 */
export function isSpatialLinkQuery(query: Record<string, unknown>): boolean {
  const entries = Object.entries(query)
  return (
    entries.length > 0 &&
    entries.every(([key]) => (SPATIAL_LINK_QUERY_KEYS as readonly string[]).includes(key)) &&
    entries.every(([, value]) => typeof value === 'string' && value.length > 0)
  )
}

/** 深链是否携带可写动词（键名或值里出现 submit/create/confirm 等）：携带即拒绝跳转。 */
export function spatialLinkHasWriteVerb(query: Record<string, unknown>): boolean {
  return Object.entries(query).some(([key, value]) => {
    const text = `${key}=${String(value)}`.toLowerCase()
    return WRITE_VERBS.some((verb) => text.includes(verb))
  })
}

/** 目标路径对当前用户是否可访问（governance 既有口径；读取失败按无权限处理，不渲染入口）。 */
export function canFollowSpatialLink(path: string): boolean {
  try {
    return canAccessPath(path, getCurrentUser())
  } catch {
    return false
  }
}

/** 入口显隐判定（三页共用）：目标路径有权限 + 单个对象名 + 公司范围明确。
 *  多对象选中时不渲染（对象名数组不进 URL），公司未选时不渲染（绑定必然落空）。 */
export function spatialEntryVisible(args: {
  path: string
  objectName: string | null | undefined
  companyId: string | null | undefined
}): boolean {
  return Boolean(args.objectName) && Boolean(args.companyId) && canFollowSpatialLink(args.path)
}

/** 组装并跳转：显隐已由页面按 spatialEntryVisible 判定；这里再保证 query 只含白名单键、
 *  值均为非空标量且无可写动词（双保险），不合法直接不动——宁可不开口，不带脏参数跳转。 */
export function openSpatialViewLink(router: Router, args: { path: string; query: Record<string, string> }): void {
  if (!isSpatialLinkQuery(args.query) || spatialLinkHasWriteVerb(args.query)) return
  void router.push({ path: args.path, query: args.query })
}
