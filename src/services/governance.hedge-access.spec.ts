// 中长期与现货套保入口：角色 × 地区可见性（dljy#3401）
// ---------------------------------------------------------------------------
// 任务 8.1 把旧路由 /zcqjy/exposure 迁到 /xhjy/hedge 时漏改了角色白名单与地区能力登记：
// 交易员从此看不到菜单（旧链接跳过去也被拦），山西等未开放地区反而照常显示菜单。
// 这里用真实 navigation / governance / regionModules 断言迁移后的口径。
import { describe, expect, it } from 'vitest'
import { navigation } from '@/data/navigation'
import { canAccessPath, filterNavigationForUser, isPathAvailableInRegion } from './governance'
import type { RoleCode } from './governance'

function flatPaths(items: ReturnType<typeof filterNavigationForUser>): string[] {
  return items.flatMap((item) => [item.path, ...(item.children ? flatPaths(item.children) : [])])
}

const HEDGE = '/xhjy/hedge'

describe('中长期与现货套保入口（#3401）', () => {
  it('交易员、风控与既有可见角色在云南菜单里看得到套保页', () => {
    for (const roleCode of ['TRADER', 'RISK', 'TRADE_LEAD', 'BOSS', 'ADMIN'] as RoleCode[]) {
      expect(canAccessPath(HEDGE, { roleCode }), roleCode).toBe(true)
      expect(flatPaths(filterNavigationForUser(navigation, { roleCode }, 'yunnan')), roleCode).toContain(HEDGE)
    }
  })

  it('不扩权：交易与风控动线之外的角色仍然进不去', () => {
    for (const roleCode of ['QUANT', 'SETTLEMENT', 'PLANT_OPERATOR', 'RETAIL_MANAGER', 'STORAGE_OPERATOR'] as RoleCode[]) {
      expect(canAccessPath(HEDGE, { roleCode }), roleCode).toBe(false)
    }
  })

  it('只开放云南：其余地区摘除菜单且路由不可达', () => {
    expect(isPathAvailableInRegion(HEDGE, 'yunnan')).toBe(true)
    for (const region of ['shanxi', 'guangdong', 'sichuan']) {
      expect(isPathAvailableInRegion(HEDGE, region), region).toBe(false)
      expect(flatPaths(filterNavigationForUser(navigation, { roleCode: 'ADMIN' }, region)), region).not.toContain(HEDGE)
    }
  })
})
