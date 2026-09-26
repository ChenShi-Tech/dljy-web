// 市场洞察规范入口的权限等价（dljy#2995 阶段 A，spec RW05 不扩权）
// ----------------------------------------------------------------------------
// /insight/<pageId> 的可访问性 = 「任一对应旧入口可访问」。两类断言：
// ① 逐角色全量等价（新路径可访问 ⇔ 任一旧入口可访问）——防止别名判定被挪到
//   groups 前缀匹配之后（多数角色拥有 '/insight' 组，先走组匹配等于借组扩权）；
// ② 具体正反例：拥有 '/insight' 组但无私有旧入口权限的角色（PLANT_OPERATOR 无节点价/
//   结算价、SETTLEMENT 无 grid-assets）必须被拒绝——这是「菜单隐藏不是权限检查」的负例。

import { describe, expect, it } from 'vitest'
import {
  canAccessPath,
  insightPathAccessAliases,
  roleLabels,
  type RoleCode
} from './governance'

const allRoleCodes = Object.keys(roleLabels) as RoleCode[]

describe('insightPathAccessAliases 权限等价', () => {
  it('六条规范路径各自登记了旧入口别名（等价表完整）', () => {
    expect(Object.keys(insightPathAccessAliases).sort()).toEqual([
      '/insight/grid-boundaries',
      '/insight/overview',
      '/insight/plants',
      '/insight/prices',
      '/insight/research',
      '/insight/supply'
    ])
    for (const aliases of Object.values(insightPathAccessAliases)) {
      expect(aliases.length).toBeGreaterThan(0)
    }
  })

  it('逐角色断言：新路径可访问 ⇔ 任一旧入口可访问（含管理员全放行）', () => {
    for (const roleCode of allRoleCodes) {
      const user = { roleCode }
      for (const [newPath, aliases] of Object.entries(insightPathAccessAliases)) {
        const viaAnyLegacy = aliases.some((alias) => canAccessPath(alias, user))
        expect(canAccessPath(newPath, user), `${roleCode} → ${newPath}`).toBe(viaAnyLegacy)
      }
    }
  })

  it('query/hash 不影响别名判定（normalizePath 先行）', () => {
    expect(canAccessPath('/insight/plants?tab=settlement', { roleCode: 'PLANT_OPERATOR' })).toBe(false)
    expect(canAccessPath('/insight/prices?date=2026-09-17', { roleCode: 'PLANT_OPERATOR' })).toBe(true)
  })

  it('负例：拥有 /insight 组但没有结算价/节点价权限的角色不能访问 /insight/plants', () => {
    const user = { roleCode: 'PLANT_OPERATOR' } as const
    // 前提自检：该角色确实拥有 '/insight' 组（驾驶舱可见）、且两个旧入口都无权限
    expect(canAccessPath('/insight/cockpit', user)).toBe(true)
    expect(canAccessPath('/xhjy/yunnan/settlement-price', user)).toBe(false)
    expect(canAccessPath('/xhjy/yunnan/node-price', user)).toBe(false)
    // 若别名判定失效（先走 groups 前缀），'/insight' 组会放行 plants → 扩权
    expect(canAccessPath('/insight/plants', user)).toBe(false)
  })

  it('负例：拥有 /insight 组但没有 grid-assets 权限的角色不能访问 /insight/grid-boundaries', () => {
    const user = { roleCode: 'SETTLEMENT' } as const
    expect(canAccessPath('/insight/cockpit', user)).toBe(true)
    expect(canAccessPath('/grid-assets/disclosures', user)).toBe(false)
    expect(canAccessPath('/insight/grid-boundaries', user)).toBe(false)
  })

  it('正例：旧入口可访问的角色换规范入口不缩权', () => {
    // PLANT_OPERATOR routes 显式含 /sjfx/zrsjg → prices 等价放行
    expect(canAccessPath('/insight/prices', { roleCode: 'PLANT_OPERATOR' })).toBe(true)
    // TRADE_LEAD 经云南工作台 routes 拿到节点价 → plants 等价放行
    expect(canAccessPath('/insight/plants', { roleCode: 'TRADE_LEAD' })).toBe(true)
    // PLANT_OPERATOR 有 '/grid-assets' 组 → grid-boundaries 等价放行
    expect(canAccessPath('/insight/grid-boundaries', { roleCode: 'PLANT_OPERATOR' })).toBe(true)
  })

  it('管理员级角色六条规范路径全放行', () => {
    for (const roleCode of ['BOSS', 'ADMIN'] as const) {
      for (const newPath of Object.keys(insightPathAccessAliases)) {
        expect(canAccessPath(newPath, { roleCode }), `${roleCode} → ${newPath}`).toBe(true)
      }
    }
  })
})
