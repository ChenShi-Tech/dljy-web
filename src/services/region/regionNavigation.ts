import type { LocationQuery } from 'vue-router'
import {
  canAccessPath,
  firstAccessiblePath,
  isPathAvailableInRegion,
  type GovernanceUser
} from '@/services/governance'
import { getRegionLandingRoutes as getRegisteredRegionLandingRoutes } from '@/services/region/regionModules'
import { insightPageIdFromPath, resolveInsightPage, type InsightPageId } from './insightWorkspace'

type UserLike = Pick<GovernanceUser, 'roleCode'> | null | undefined

/** 地区切换的落点：path + 可选 query（不传 query 时行为与旧版字符串返回一致：丢 query 落地） */
export type RegionSwitchTarget = {
  path: string
  query?: LocationQuery
}

// 市场洞察换页（回目标地区默认入口）时保留的公共业务 query；其余参数对新页面无意义，不透传
const INSIGHT_SWITCH_QUERY_WHITELIST = ['date', 'start', 'end']

export function getRegionLandingRoutes(regionId: string, user: UserLike) {
  return getRegisteredRegionLandingRoutes(regionId, user)
}

export function resolveRegionSwitchRoute(
  regionId: string,
  user: UserLike,
  fromPath: string,
  fromQuery?: LocationQuery
): RegionSwitchTarget {
  const normalizedFromPath = normalizePath(fromPath)
  // 市场洞察规范页（dljy#2995）：目标地区支持且已交付 → 原地停留（保留当前合法 query）；
  // 已登记但不支持/未交付 → 目标地区默认入口（白名单 query）；未登记（或开关未启用）→
  // 原地停留，由宿主显示「暂未开通」说明，不跳走、不借用他省数据。
  const insightPageId = insightPageIdFromPath(normalizedFromPath)
  if (insightPageId) {
    return resolveInsightSwitch(regionId, user, normalizedFromPath, insightPageId, fromQuery)
  }
  if (shouldStayOnSystemRoute(normalizedFromPath) || shouldStayOnRegionAwareRoute(normalizedFromPath)) {
    if (canUseRouteInRegion(normalizedFromPath, regionId, user)) return { path: normalizedFromPath }
  }

  const landing = getRegionLandingRoutes(regionId, user).find((path) => canUseRouteInRegion(path, regionId, user))
    ?? firstAccessiblePath(user, regionId)
  return { path: landing }
}

function resolveInsightSwitch(
  regionId: string,
  user: UserLike,
  fromPath: string,
  pageId: InsightPageId,
  fromQuery: LocationQuery | undefined
): RegionSwitchTarget {
  const resolution = resolveInsightPage(regionId, pageId)
  if (resolution.kind === 'fallback' && canUseRouteInRegion(resolution.to, regionId, user)) {
    // 已登记但不支持/未交付 → 目标地区默认入口；只保留白名单 query（date/start/end 等）
    return { path: resolution.to, query: pickWhitelistQuery(fromQuery) }
  }
  // page：原地停留；not-registered：同样原地停留（宿主显示未开通，不发请求）。
  // 两种情况都保留当前 query——原地停留页面语义连续，日期等业务参数不该丢。
  return { path: fromPath, query: fromQuery }
}

function pickWhitelistQuery(query: LocationQuery | undefined): LocationQuery {
  const kept: LocationQuery = {}
  for (const key of INSIGHT_SWITCH_QUERY_WHITELIST) {
    if (query && key in query) kept[key] = query[key]
  }
  return kept
}

function shouldStayOnSystemRoute(path: string) {
  // 系统配置页与地区无关，切地区时不该被踢走。AI 模型设置已并入「AI 工作室」，
  // 这里认合并后的宿主页（/ai-settings 只是重定向壳，切地区时当前路径已是 /system/ai-studio）。
  return path === '/system/permissions' || path === '/system/ai-studio' || path === '/system/accounts'
}

function shouldStayOnRegionAwareRoute(path: string) {
  return path === '/sdzl/region-rules' || path === '/xhjy/region'
}

function canUseRouteInRegion(path: string, regionId: string, user: UserLike) {
  return isPathAvailableInRegion(path, regionId) && canAccessPath(path, user)
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}
