import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  INSIGHT_PAGE_PATHS,
  __resetInsightWorkspaces,
  getInsightWorkspace,
  insightPageIdFromPath,
  isInsightWorkspacePath,
  listInsightNavigation,
  registerInsightWorkspace,
  resolveInsightPage,
  type InsightWorkspaceDescriptor
} from './insightWorkspace'

const stubLoad = () => Promise.resolve({})

function fixtureWorkspace(overrides: Partial<InsightWorkspaceDescriptor> = {}): InsightWorkspaceDescriptor {
  return {
    workspaceId: 'test.insight',
    regionId: 'yunnan',
    version: 1,
    defaultPageId: 'overview',
    enabled: () => true,
    replacesNavigation: true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 10, load: stubLoad, delivered: true },
      { pageId: 'prices', title: '价格与价差', order: 20, load: stubLoad, delivered: false },
      { pageId: 'research', title: '研究工作台', order: 30, load: stubLoad, delivered: true }
    ],
    ...overrides
  }
}

describe('市场洞察工作区注册表', () => {
  beforeEach(() => __resetInsightWorkspaces())

  it('注册后按地区读取工作区', () => {
    registerInsightWorkspace(fixtureWorkspace())
    expect(getInsightWorkspace('yunnan')?.workspaceId).toBe('test.insight')
    expect(getInsightWorkspace('shanxi')).toBeNull()
  })

  it('同地区重复注册抛错（参照 regionSlots：静默覆盖会让渲染依赖 import 顺序）', () => {
    registerInsightWorkspace(fixtureWorkspace())
    expect(() => registerInsightWorkspace(fixtureWorkspace({ workspaceId: 'another' }))).toThrow(/重复注册/)
  })

  it('不同地区互不干扰', () => {
    registerInsightWorkspace(fixtureWorkspace())
    registerInsightWorkspace(fixtureWorkspace({ regionId: 'shanxi', workspaceId: 'shanxi.insight' }))
    expect(getInsightWorkspace('yunnan')?.workspaceId).toBe('test.insight')
    expect(getInsightWorkspace('shanxi')?.workspaceId).toBe('shanxi.insight')
  })

  it('开关未启用与未注册行为一致：getInsightWorkspace / resolve / 导航均按未开通处理', () => {
    registerInsightWorkspace(fixtureWorkspace({ enabled: () => false }))
    expect(getInsightWorkspace('yunnan')).toBeNull()
    expect(resolveInsightPage('yunnan', 'overview')).toEqual({ kind: 'not-registered' })
    expect(listInsightNavigation('yunnan')).toBeNull()
  })

  it('resolveInsightPage 三种结果：page / page-not-supported（回默认入口）/ page-not-delivered（带占位页）', () => {
    registerInsightWorkspace(fixtureWorkspace())
    expect(resolveInsightPage('yunnan', 'overview')).toMatchObject({ kind: 'page', page: { pageId: 'overview' } })
    // 已登记工作区但未登记该页 → 回默认入口
    expect(resolveInsightPage('yunnan', 'supply')).toEqual({
      kind: 'fallback',
      to: INSIGHT_PAGE_PATHS.overview,
      reason: 'page-not-supported'
    })
    // 已登记未交付 → 同样指向默认入口，但携带该页 descriptor 供宿主渲染占位
    const pending = resolveInsightPage('yunnan', 'prices')
    expect(pending).toMatchObject({ kind: 'fallback', to: INSIGHT_PAGE_PATHS.overview, reason: 'page-not-delivered' })
    expect(pending.kind === 'fallback' && pending.page?.pageId).toBe('prices')
    // 未注册地区
    expect(resolveInsightPage('guangdong', 'overview')).toEqual({ kind: 'not-registered' })
  })

  it('listInsightNavigation：已启用装配型工作区只列 delivered 页并按 order 排序', () => {
    registerInsightWorkspace(fixtureWorkspace())
    const entries = listInsightNavigation('yunnan')
    expect(entries?.map((entry) => entry.path)).toEqual([INSIGHT_PAGE_PATHS.overview, INSIGHT_PAGE_PATHS.research])
  })

  it('listInsightNavigation：已启用但没有任何已交付页 → null（保持现有导航，不显示空分组）', () => {
    registerInsightWorkspace(
      fixtureWorkspace({ pages: [{ pageId: 'overview', title: '市场总览', order: 1, load: stubLoad, delivered: false }] })
    )
    expect(listInsightNavigation('yunnan')).toBeNull()
  })

  it('listInsightNavigation：非 replacesNavigation 的兼容登记 → null（导航保持现状）', () => {
    registerInsightWorkspace(fixtureWorkspace({ replacesNavigation: false }))
    expect(listInsightNavigation('yunnan')).toBeNull()
    registerInsightWorkspace(fixtureWorkspace({ regionId: 'shanxi', replacesNavigation: undefined }))
    expect(listInsightNavigation('shanxi')).toBeNull()
  })

  it('insightPageIdFromPath：识别六条规范路径；/insight/cockpit 旧入口与无关路径返回 null', () => {
    for (const [pageId, path] of Object.entries(INSIGHT_PAGE_PATHS)) {
      expect(insightPageIdFromPath(path)).toBe(pageId)
      expect(isInsightWorkspacePath(path)).toBe(true)
    }
    expect(insightPageIdFromPath('/insight/cockpit')).toBeNull()
    expect(insightPageIdFromPath('/sjfx/zrsjg')).toBeNull()
    expect(insightPageIdFromPath('/insight/prices?date=2026-09-17')).toBe('prices')
    expect(insightPageIdFromPath('insight/prices/')).toBe('prices')
    expect(insightPageIdFromPath('/insight/unknown')).toBeNull()
  })

  it('内核源码不 import 任何省包路径（地区隔离纪律的静态断言，注释说明不算）', () => {
    const source = readFileSync(new URL('./insightWorkspace.ts', import.meta.url), 'utf8')
    // 静态 import 与动态 import() 都不允许指向省包；文件头注释里的路径说明不算引用
    expect(source).not.toMatch(/from\s+'[^']*features\/regions/)
    expect(source).not.toMatch(/import\([^)]*features\/regions/)
  })
})

describe('地区包真包集成（installRegionPackages 装配）', () => {
  beforeAll(async () => {
    // 清掉前面 fixture describe 残留的注册，再按应用启动路径装配真包
    __resetInsightWorkspaces()
    const { installRegionPackages } = await import('@/features/regions')
    installRegionPackages()
  })

  it('山西兼容登记：overview/prices 两页已交付可直接解析，其余四页 page-not-supported', () => {
    expect(resolveInsightPage('shanxi', 'overview')).toMatchObject({ kind: 'page' })
    expect(resolveInsightPage('shanxi', 'prices')).toMatchObject({ kind: 'page' })
    expect(resolveInsightPage('shanxi', 'supply')).toMatchObject({ kind: 'fallback', reason: 'page-not-supported' })
    expect(resolveInsightPage('shanxi', 'research')).toMatchObject({ kind: 'fallback', reason: 'page-not-supported' })
    // 兼容登记不替换导航
    expect(listInsightNavigation('shanxi')).toBeNull()
  })

  it('云南工作区默认关闭（VITE_YUNNAN_INSIGHT_WORKSPACE 未设）：一切按未开通处理', () => {
    vi.unstubAllEnvs()
    expect(getInsightWorkspace('yunnan')).toBeNull()
    expect(resolveInsightPage('yunnan', 'overview')).toEqual({ kind: 'not-registered' })
    expect(listInsightNavigation('yunnan')).toBeNull()
  })

  it('云南开关打开：overview 与 supply 页已交付可解析并进导航，其余四页仍为建设占位（page-not-delivered）', () => {
    vi.stubEnv('VITE_YUNNAN_INSIGHT_WORKSPACE', '1')
    const workspace = getInsightWorkspace('yunnan')
    expect(workspace?.workspaceId).toBe('yunnan.insight')
    expect(workspace?.pages).toHaveLength(6)
    // dljy#3009：市场总览页交付；dljy#3008：供需与水电页交付；prices 页四页签已上线但三维热力未齐，delivered 仍 false
    expect(workspace?.pages.filter((page) => page.delivered).map((page) => page.pageId)).toEqual(['overview', 'supply'])
    expect(resolveInsightPage('yunnan', 'overview')).toMatchObject({ kind: 'page' })
    expect(resolveInsightPage('yunnan', 'supply')).toMatchObject({ kind: 'page' })
    expect(resolveInsightPage('yunnan', 'prices')).toMatchObject({ kind: 'fallback', reason: 'page-not-delivered' })
    // 导航只收 delivered 页 → 市场总览 + 供需与水电两项（按 order 排序）
    expect(listInsightNavigation('yunnan')).toEqual([
      expect.objectContaining({ path: '/insight/overview', title: '市场总览' }),
      expect.objectContaining({ path: '/insight/supply', title: '供需与水电' }),
    ])
    vi.unstubAllEnvs()
  })

  it('广东、四川未登记工作区：resolve 一律 not-registered', () => {
    expect(getInsightWorkspace('guangdong')).toBeNull()
    expect(getInsightWorkspace('sichuan')).toBeNull()
    expect(resolveInsightPage('guangdong', 'overview')).toEqual({ kind: 'not-registered' })
    expect(resolveInsightPage('sichuan', 'prices')).toEqual({ kind: 'not-registered' })
  })
})
