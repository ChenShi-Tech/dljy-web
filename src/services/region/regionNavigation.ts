import {
  canAccessPath,
  firstAccessiblePath,
  isPathAvailableInRegion,
  type GovernanceUser
} from '@/services/governance'
import { getRegionLandingRoutes as getRegisteredRegionLandingRoutes } from '@/services/region/regionModules'

type UserLike = Pick<GovernanceUser, 'roleCode'> | null | undefined

export function getRegionLandingRoutes(regionId: string, user: UserLike) {
  return getRegisteredRegionLandingRoutes(regionId, user)
}

export function resolveRegionSwitchRoute(regionId: string, user: UserLike, fromPath: string) {
  const normalizedFromPath = normalizePath(fromPath)
  if (shouldStayOnSystemRoute(normalizedFromPath) || shouldStayOnRegionAwareRoute(normalizedFromPath)) {
    if (canUseRouteInRegion(normalizedFromPath, regionId, user)) return normalizedFromPath
  }

  return getRegionLandingRoutes(regionId, user).find((path) => canUseRouteInRegion(path, regionId, user))
    ?? firstAccessiblePath(user, regionId)
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
