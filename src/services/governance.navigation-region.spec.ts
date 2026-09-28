// 导航地区隐藏入口测试（dljy#2991）
// ---------------------------------------------------------------------------
// hiddenInRegionIds 语义：只把菜单入口从对应地区摘除（filterNavigationForUser），
// 不改路由可达性与权限——旧链接/收藏深链仍可直接访问，由页面自身解释降级。
// 这里用真实 navigation 数据断言：云南菜单无 /sjfx/fshq，山西/广东/四川仍在；
// 同时锚定云南 /sjfx/fshq 路由保持可达（degraded，不被守卫踢走）。
import { describe, expect, it } from 'vitest'
import { navigation } from '@/data/navigation'
import { filterNavigationForUser, isPathAvailableInRegion } from './governance'

const ADMIN = { roleCode: 'ADMIN' as const }

function flatPaths(items: ReturnType<typeof filterNavigationForUser>): string[] {
  return items.flatMap((item) => [item.path, ...(item.children ? flatPaths(item.children) : [])])
}

describe('导航按地区隐藏入口但不拦路由（#2991）', () => {
  it('云南菜单不含分时行情 /sjfx/fshq', () => {
    const paths = flatPaths(filterNavigationForUser(navigation, ADMIN, 'yunnan'))
    expect(paths).toContain('/sjfx/zrsjg') // 对照：市场洞察其他入口仍在
    expect(paths).not.toContain('/sjfx/fshq')
  })

  it('山西/广东/四川菜单仍含分时行情', () => {
    for (const region of ['shanxi', 'guangdong', 'sichuan']) {
      expect(flatPaths(filterNavigationForUser(navigation, ADMIN, region))).toContain('/sjfx/fshq')
    }
  })

  it('隐藏只是菜单行为：云南 /sjfx/fshq 路由保持可达（旧深链不被守卫踢走）', () => {
    expect(isPathAvailableInRegion('/sjfx/fshq', 'yunnan')).toBe(true)
    expect(isPathAvailableInRegion('/sjfx/fshq', 'shanxi')).toBe(true)
  })

  it('云南菜单不含出清现货电量分析 /sjfx/zcqxhdl，其他地区仍含（#3388）', () => {
    expect(flatPaths(filterNavigationForUser(navigation, ADMIN, 'yunnan'))).not.toContain('/sjfx/zcqxhdl')
    for (const region of ['shanxi', 'guangdong', 'sichuan']) {
      expect(flatPaths(filterNavigationForUser(navigation, ADMIN, region))).toContain('/sjfx/zcqxhdl')
    }
  })

  it('云南 /sjfx/zcqxhdl 路由保持可达（旧深链落到停用说明，不被守卫踢走）', () => {
    expect(isPathAvailableInRegion('/sjfx/zcqxhdl', 'yunnan')).toBe(true)
    expect(isPathAvailableInRegion('/sjfx/zcqxhdl', 'shanxi')).toBe(true)
  })

  it('hiddenInRegionIds 不影响其他地区的条目（无 regionIds 交集时行为不变）', () => {
    // 市场洞察驾驶舱没有 hiddenInRegionIds，各地区菜单都应保留
    for (const region of ['yunnan', 'shanxi']) {
      expect(flatPaths(filterNavigationForUser(navigation, ADMIN, region))).toContain('/insight/cockpit')
    }
  })
})
