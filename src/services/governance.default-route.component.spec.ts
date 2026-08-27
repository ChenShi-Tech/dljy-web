// @vitest-environment happy-dom
// 角色默认路由「守卫决策收敛」回归网（SETTLEMENT 登录循环的防复发门禁）：
// 循环病灶形态 = 守卫对 defaultRoute 的重定向终点拒绝后，回退路径与原路径互指。
// 本 spec 用真实 router.resolve + 守卫同款判定函数，模拟「着陆页连续两轮决策」：
// 第一轮按守卫三分支（地区拦截/权限拦截/放行）求出落点，第二轮对该落点再跑一遍，
// 断言两轮结果一致（收敛）且最终落点确实可进入——任何角色把 defaultRoute 配成
// 「白名单壳→禁入终点」或互相指环的配置都会在此变红。
import { describe, expect, it } from 'vitest'
import {
  accessRules,
  canAccessPath,
  firstAccessiblePath,
  isPathAvailableInRegion,
  type RoleCode
} from '@/services/governance'
import router from '@/router'
import { defaultRegionId } from '@/data/regions'

const roles = Object.keys(accessRules) as RoleCode[]
const REGION_RULES_FALLBACK = '/sdzl/region-rules'

/** 跟随记录级 redirect 取守卫实际看到的终态路径 */
function terminalOf(path: string): string {
  const resolved = router.resolve(path)
  expect(resolved.matched.length, `${path} 应注册为路由`).toBeGreaterThan(0)
  return resolved.path
}

/** 复刻 router/index.ts 全局守卫的返回值逻辑（仅路径维度） */
function guardDecision(roleCode: RoleCode, path: string): string {
  if (!isPathAvailableInRegion(terminalOf(path), defaultRegionId)) {
    return canAccessPath(REGION_RULES_FALLBACK, { roleCode }) ? REGION_RULES_FALLBACK : firstAccessiblePath({ roleCode }, defaultRegionId)
  }
  if (!canAccessPath(terminalOf(path), { roleCode })) {
    return firstAccessiblePath({ roleCode }, defaultRegionId)
  }
  return terminalOf(path)
}

describe('角色登录落地·守卫决策两轮收敛', () => {
  for (const role of roles) {
    const rule = accessRules[role]
    it(`${role}: ${rule.defaultRoute} 两轮守卫决策收敛到可进入的终态`, () => {
      const first = guardDecision(role, rule.defaultRoute)
      const second = guardDecision(role, first)
      expect(second, `${role} 从 ${rule.defaultRoute} 出发两轮守卫结果发散: ${first} → ${second}，登录将陷入循环`).toBe(first)

      // 收敛点必须是「真终态」：redirect 已走完、且不在禁区
      expect(terminalOf(first)).toBe(first)
      if (first !== REGION_RULES_FALLBACK && first !== '/dashboard') {
        expect(canAccessPath(first, { roleCode: role }), `${role} 落点 ${first} 应可达`).toBe(true)
      }
    })
  }
})
