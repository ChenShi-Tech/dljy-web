// 市场洞察导航装配（dljy#2995 阶段 A）：applyInsightWorkspaceNavigation 的纯函数行为。
// 云南开关关 / 开、山西兼容登记、广东未登记四态，及「替换后仍走权限过滤链」的组合断言。

import { beforeEach, describe, expect, it } from 'vitest'
import { applyInsightWorkspaceNavigation, navigation, type NavItem } from './navigation'
import {
  INSIGHT_PAGE_PATHS,
  __resetInsightWorkspaces,
  registerInsightWorkspace,
  type InsightWorkspaceDescriptor
} from '@/services/region/insightWorkspace'
import { filterNavigationForUser } from '@/services/governance'

const stubLoad = () => Promise.resolve({})

function registerWorkspace(overrides: Partial<InsightWorkspaceDescriptor>) {
  registerInsightWorkspace({
    workspaceId: 'test.insight',
    regionId: 'yunnan',
    version: 1,
    defaultPageId: 'overview',
    enabled: () => true,
    replacesNavigation: true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 10, load: stubLoad, delivered: true },
      { pageId: 'prices', title: '价格与价差', order: 20, load: stubLoad, delivered: true },
      { pageId: 'plants', title: '场站市场表现', order: 30, load: stubLoad, delivered: true }
    ],
    ...overrides
  })
}

const insightGroupIndex = () => navigation.findIndex((item) => item.path === '/insight')

describe('市场洞察导航装配纯函数', () => {
  beforeEach(() => __resetInsightWorkspaces())

  it('未登记地区（广东）：返回原数组引用，任何分组不变', () => {
    expect(applyInsightWorkspaceNavigation(navigation, 'guangdong')).toBe(navigation)
  })

  it('云南开关关闭：装配不生效，返回原数组引用（侧边栏与现状完全一致）', () => {
    registerWorkspace({ enabled: () => false })
    expect(applyInsightWorkspaceNavigation(navigation, 'yunnan')).toBe(navigation)
  })

  it('已启用但没有任何已交付页（阶段 A 云南形态）：保持现有 children，不显示空分组', () => {
    registerWorkspace({
      pages: [{ pageId: 'overview', title: '市场总览', order: 1, load: stubLoad, delivered: false }]
    })
    expect(applyInsightWorkspaceNavigation(navigation, 'yunnan')).toBe(navigation)
  })

  it('山西兼容登记（replacesNavigation 未设、两页已交付）：导航保持现状', () => {
    registerWorkspace({
      regionId: 'shanxi',
      replacesNavigation: undefined,
      pages: [
        { pageId: 'overview', title: '市场洞察驾驶舱', order: 1, load: stubLoad, delivered: true },
        { pageId: 'prices', title: '价格分析', order: 2, load: stubLoad, delivered: true }
      ]
    })
    expect(applyInsightWorkspaceNavigation(navigation, 'shanxi')).toBe(navigation)
  })

  it('已启用装配型工作区且有交付页：市场洞察分组 children 原位替换为 delivered 页（按 order）', () => {
    registerWorkspace({})
    const assembled = applyInsightWorkspaceNavigation(navigation, 'yunnan')
    expect(assembled).not.toBe(navigation)
    const group = assembled[insightGroupIndex()]
    expect(group.children?.map((child) => child.path)).toEqual([
      INSIGHT_PAGE_PATHS.overview,
      INSIGHT_PAGE_PATHS.prices,
      INSIGHT_PAGE_PATHS.plants
    ])
    expect(group.children?.map((child) => child.title)).toEqual(['市场总览', '价格与价差', '场站市场表现'])
    // 分组自身标识不变（path/title/icon 原样保留）
    expect(group.path).toBe('/insight')
    expect(group.title).toBe(navigation[insightGroupIndex()].title)
  })

  it('替换只影响市场洞察分组：其他分组对象引用不变', () => {
    registerWorkspace({})
    const assembled = applyInsightWorkspaceNavigation(navigation, 'yunnan')
    navigation.forEach((item, index) => {
      if (index === insightGroupIndex()) return
      expect(assembled[index], item.path).toBe(item)
    })
  })

  it('替换后的 children 仍经 filterNavigationForUser 过滤：无对应旧入口权限的角色看不到该页', () => {
    registerWorkspace({})
    const assembled = applyInsightWorkspaceNavigation(navigation, 'yunnan')
    // PLANT_OPERATOR 拥有 '/insight' 组（驾驶舱可见），但无节点价/结算价权限
    //（/insight/plants 的别名旧入口都不可访问）→ 替换后过滤必须摘掉 plants
    const filtered = filterNavigationForUser(assembled, { roleCode: 'PLANT_OPERATOR' }, 'yunnan')
    const group = filtered.find((item: NavItem) => item.path === '/insight')
    expect(group?.children?.map((child) => child.path)).toEqual([
      INSIGHT_PAGE_PATHS.overview,
      INSIGHT_PAGE_PATHS.prices
    ])
    // 有结算价/节点价权限的角色（TRADE_LEAD 经云南工作台 routes）能看到全部三页
    const traderFiltered = filterNavigationForUser(assembled, { roleCode: 'TRADE_LEAD' }, 'yunnan')
    const traderGroup = traderFiltered.find((item: NavItem) => item.path === '/insight')
    expect(traderGroup?.children?.map((child) => child.path)).toEqual([
      INSIGHT_PAGE_PATHS.overview,
      INSIGHT_PAGE_PATHS.prices,
      INSIGHT_PAGE_PATHS.plants
    ])
  })
})
