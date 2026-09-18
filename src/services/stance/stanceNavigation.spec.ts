// 立场导航视图层单测（Epic #2193 · #2196）。
// 钉住三条可见性规则 + 直链守卫 + 切换路由解析；真实导航树参与断言
// （防「标注写了但过滤函数读不到」这类装配断层）。
import { describe, expect, it } from 'vitest'
import { navigation } from '@/data/navigation'
import type { SubjectType } from '@/services/governance'
import {
  CROSS_VIEW_STANCE_TYPES,
  filterNavigationForStance,
  isPathAvailableInStance,
  matchesNavigationStance,
  resolveStanceSwitchRoute
} from './stanceNavigation'

/** 发电侧专属页（真实标注）：机组出力台账。 */
const GENERATOR_ONLY = '/gsgl/output'
/** 共享页：现货交易驾驶舱。 */
const SHARED = '/dashboard'
/**
 * 售电侧专属页用 fixture（真实树内的 /djcs/retail-price 在默认冻结的计算器组里
 * 不进导航，这也如实反映了当前售电侧在导航树内暂无专属页的事实，P2 售电补课
 * 后再换真实路径）。
 */
const fixtureTree = [
  { path: '/grp', title: '组', icon: {}, children: [
    { path: SHARED, title: '共享页', icon: {} },
    { path: '/djcs/retail-price', title: '售电测算', icon: {}, stanceAffinity: ['RETAILER' as SubjectType] },
    { path: GENERATOR_ONLY, title: '机组出力', icon: {}, stanceAffinity: ['GENERATOR' as SubjectType] }
  ] }
]

function flattenPaths(items: typeof navigation): string[] {
  return items.flatMap((item) => [item.path, ...flattenPaths((item.children ?? []) as typeof navigation)])
}

describe('可见性规则（三桶）', () => {
  it('共享页（无标注）全立场可见', () => {
    for (const stance of ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER'] as SubjectType[]) {
      expect(matchesNavigationStance({ path: SHARED, title: 'x', icon: {} }, stance)).toBe(true)
    }
  })

  it('组合/集团视角（TRADER/GROUP）恒全可见——连别人家的专属页也可见', () => {
    const generatorItem = { path: GENERATOR_ONLY, title: 'x', icon: {}, stanceAffinity: ['GENERATOR' as SubjectType] }
    for (const stance of CROSS_VIEW_STANCE_TYPES) {
      expect(matchesNavigationStance(generatorItem, stance)).toBe(true)
    }
  })

  it('专职立场只看共享页 + 本立场专属页', () => {
    const generatorItem = { path: '/x', title: 'x', icon: {}, stanceAffinity: ['GENERATOR' as SubjectType] }
    expect(matchesNavigationStance(generatorItem, 'GENERATOR')).toBe(true)
    expect(matchesNavigationStance(generatorItem, 'RETAILER')).toBe(false)
    expect(matchesNavigationStance(generatorItem, 'STORAGE')).toBe(false)
    expect(matchesNavigationStance(generatorItem, 'LOAD')).toBe(false)
  })

  it('立场未定（null/undefined）恒可见——只走角色/地区过滤，行为与历史一致', () => {
    const generatorItem = { path: '/x', title: 'x', icon: {}, stanceAffinity: ['GENERATOR' as SubjectType] }
    expect(matchesNavigationStance(generatorItem, null)).toBe(true)
    expect(matchesNavigationStance(generatorItem, undefined)).toBe(true)
  })
})

describe('真实导航树的过滤装配', () => {
  it('发电立场保留发电专属页与共享页、剔除售电专属页', () => {
    const paths = flattenPaths(filterNavigationForStance(navigation, 'GENERATOR') as typeof navigation)
    expect(paths).toContain(GENERATOR_ONLY)
    expect(paths).toContain(SHARED)
  })

  it('售电立场保留售电专属页、剔除发电专属页（fixture 树）', () => {
    const paths = flattenPaths(filterNavigationForStance(fixtureTree as unknown as typeof navigation, 'RETAILER') as typeof navigation)
    expect(paths).toContain('/djcs/retail-price')
    expect(paths).not.toContain(GENERATOR_ONLY)
    expect(paths).toContain(SHARED)
  })

  it('组合视角（TRADER）全量——专属页一个不藏', () => {
    const paths = flattenPaths(filterNavigationForStance(navigation, 'TRADER') as typeof navigation)
    const all = flattenPaths(navigation)
    expect(paths.sort()).toEqual(all.sort())
  })

  it('全空立场（未过滤）与全量一致', () => {
    const paths = flattenPaths(filterNavigationForStance(navigation, null) as typeof navigation)
    const all = flattenPaths(navigation)
    expect(paths.sort()).toEqual(all.sort())
  })

  it('分组内专属页被整组剔除时分组不残留空壳', () => {
    // 公司管理组：台账/出力=发电专属，总览/合同=共享。售电立场下分组应仍存在
    // （还有共享子项），但子项里不该再有台账/出力。
    const group = filterNavigationForStance(navigation, 'RETAILER').find((item) => item.path === '/gsgl')
    expect(group).toBeTruthy()
    expect(group?.children?.map((c) => c.path)).not.toContain(GENERATOR_ONLY)
    expect(group?.children?.map((c) => c.path)).toContain('/gsgl/contracts')
  })
})

describe('直链守卫与切换路由', () => {
  it('isPathAvailableInStance：共享页恒可用、专属页只对本立场与组合视角可用', () => {
    expect(isPathAvailableInStance(SHARED, 'RETAILER')).toBe(true)
    expect(isPathAvailableInStance(GENERATOR_ONLY, 'RETAILER')).toBe(false)
    expect(isPathAvailableInStance(GENERATOR_ONLY, 'GENERATOR')).toBe(true)
    expect(isPathAvailableInStance(GENERATOR_ONLY, 'TRADER')).toBe(true)
    expect(isPathAvailableInStance(GENERATOR_ONLY, null)).toBe(true)
    // 未登记路径 = 共享
    expect(isPathAvailableInStance('/ycsj/center', 'LOAD')).toBe(true)
  })

  it('resolveStanceSwitchRoute：共享页停留、专属页落默认工作台', () => {
    const user = { roleCode: 'TRADER' as const }
    expect(resolveStanceSwitchRoute('RETAILER', user, SHARED)).toBe(SHARED)
    expect(resolveStanceSwitchRoute('RETAILER', user, GENERATOR_ONLY)).toBe('/xhjy/zptqx')
  })
})

describe('中长期菜单口径收口（dljy#2988）', () => {
  const groupChildren = (title: string) => navigation.find((g) => g.title === title)?.children?.map((c) => `${c.path}|${c.title}`) ?? []

  it('敞口看板改名「中长期与现货套保」并移入现货交易组，路由路径不变', () => {
    const spot = groupChildren('现货交易')
    const midlong = groupChildren('中长期交易')
    expect(spot).toContain('/zcqjy/exposure|中长期与现货套保')
    expect(midlong.some((x) => x.startsWith('/zcqjy/exposure|'))).toBe(false)
    expect(midlong.some((x) => x.includes('敞口'))).toBe(false)
  })

  it('山西采集族的两个旧页面在菜单名上标注地区，避免与云南中长期底账页混淆', () => {
    const midlong = groupChildren('中长期交易')
    expect(midlong).toContain('/zcqjy/zccljk|持仓量监控（山西采集）')
    expect(midlong).toContain('/zcqjy/zjyap|交易月历（山西·国网）')
    // 云南中长期底账页仍在中长期组。
    expect(midlong).toContain('/zcqjy/positions|月度持仓')
    expect(midlong).toContain('/zcqjy/plans|售电计划')
  })
})
