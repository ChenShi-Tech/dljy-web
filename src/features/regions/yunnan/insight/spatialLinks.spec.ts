// spatialLinks.spec.ts — 空间查阅深链登记回归（dljy#3106 图表清单核对 D6.1「三维地形/空间」行）
// 守什么不变量（design D6.1 末行：从节点/电网/场站动作进入已有空间资产，保留入口与上下文；
// 模式与红线同 businessLinks——登记+白名单+权限+出口双保险）：
//   ① 目标登记处全部是既有 grid-geo 只读空间场景路径，不含可写动词，不指向写端点；
//   ② 深链 query 只含白名单键（对象上下文键 / keyword / from），值均为非空标量字符串——
//     对象名数组、原始数据与嵌套对象不进 URL；
//   ③ 对象绑定（节点/场站）与关键词承接（通道/断面）都是「单个对象名」语义：
//     空对象名、缺公司/地区不组装 query，入口判定不渲染；
//   ④ 深链不携带可写动词；出口双保险：白名单外键、空值、数组或可写动词一律不 push；
//   ⑤ 入口显隐走 governance.canAccessPath 既有口径：无权限不渲染，governance 读取失败按无权限。
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import {
  SPATIAL_LINK_TARGETS,
  canFollowSpatialLink,
  isSpatialLinkQuery,
  keywordSpatialLinkQuery,
  objectSpatialLinkQuery,
  openSpatialViewLink,
  spatialEntryVisible,
  spatialLinkHasWriteVerb,
} from './spatialLinks'

const gov = vi.hoisted(() => ({
  canAccessPath: vi.fn<(path: string, user: unknown) => boolean>(() => true),
  user: null as unknown,
}))

vi.mock('@/services/governance', () => ({ canAccessPath: gov.canAccessPath }))

vi.mock('@/services/auth', () => ({ getCurrentUser: vi.fn(() => gov.user) }))

function routerSpy() {
  const push = vi.fn()
  return { push, router: { push } as unknown as Router }
}

describe('空间查阅目标登记（D6.1 入口未就绪项补齐）', () => {
  it('目标均为既有 grid-geo 只读空间场景路径，路径本身不含可写动词', () => {
    expect(SPATIAL_LINK_TARGETS.marketSpatial).toBe('/grid-assets/market')
    expect(SPATIAL_LINK_TARGETS.disclosureSpatial).toBe('/grid-assets/disclosures')
    for (const path of Object.values(SPATIAL_LINK_TARGETS)) {
      expect(/submit|create|confirm|approve|void|delete/.test(path)).toBe(false)
    }
  })
})

describe('对象绑定深链 query（价格页节点 / 场站页单场站）', () => {
  it('只带单个对象名 + 地区/公司归属 + 窗口末日 + from；值全为非空字符串，无数组', () => {
    const query = objectSpatialLinkQuery({
      kind: 'node',
      objectId: '甲节点',
      regionId: 'yunnan',
      companyId: 'company-a',
      date: '2026-09-10',
      from: 'insight-prices',
    })
    expect(query).toEqual({
      objectKind: 'node',
      objectId: '甲节点',
      objectRegion: 'yunnan',
      objectCompany: 'company-a',
      objectDate: '2026-09-10',
      from: 'insight-prices',
    })
    expect(isSpatialLinkQuery(query)).toBe(true)
    expect(spatialLinkHasWriteVerb(query)).toBe(false)
    // 数组、嵌套对象不进 URL：值类型逐个校验
    for (const value of Object.values(query)) {
      expect(typeof value === 'string' && value.length > 0).toBe(true)
    }
  })

  it('空对象名、缺地区或缺公司不组装（返回空 query）——不带一半上下文假装能承接', () => {
    const base = { kind: 'node' as const, objectId: '甲节点', regionId: 'yunnan', companyId: 'company-a', from: 'insight-prices' as const }
    expect(objectSpatialLinkQuery({ ...base, objectId: '' })).toEqual({})
    expect(objectSpatialLinkQuery({ ...base, regionId: '' })).toEqual({})
    expect(objectSpatialLinkQuery({ ...base, companyId: '' })).toEqual({})
  })

  it('objectDate 只在真实业务日期格式下携带；非日期值不带键（不伪造窗口）', () => {
    const base = { kind: 'plant' as const, objectId: '甲风电场', regionId: 'yunnan', companyId: 'company-a', from: 'insight-plants' as const }
    expect(objectSpatialLinkQuery({ ...base }).objectDate).toBeUndefined()
    expect(objectSpatialLinkQuery({ ...base, date: '2026-13-01' }).objectDate).toBeUndefined()
    expect(objectSpatialLinkQuery({ ...base, date: '2026-09-10' }).objectDate).toBe('2026-09-10')
  })

  it('关键词承接 query（电网页通道/断面）只带 keyword + from（+ objectDate）；空词不组装', () => {
    const query = keywordSpatialLinkQuery({ keyword: '某输电通道', date: '2026-09-10', from: 'insight-grid-boundaries' })
    expect(query).toEqual({ keyword: '某输电通道', objectDate: '2026-09-10', from: 'insight-grid-boundaries' })
    expect(isSpatialLinkQuery(query)).toBe(true)
    expect(keywordSpatialLinkQuery({ keyword: '', from: 'insight-grid-boundaries' })).toEqual({})
  })
})

describe('白名单与出口双保险', () => {
  it('白名单判定拒绝未知键、空值、数组与嵌套对象', () => {
    const legal = { keyword: '某输电通道', from: 'insight-grid-boundaries' }
    expect(isSpatialLinkQuery(legal)).toBe(true)
    expect(isSpatialLinkQuery({ ...legal, data: 'raw' })).toBe(false) // 白名单外键
    expect(isSpatialLinkQuery({ ...legal, keyword: '' })).toBe(false) // 空值
    expect(isSpatialLinkQuery({ objectIds: ['甲节点'] })).toBe(false) // 对象名数组不进 URL
    expect(isSpatialLinkQuery({ objectKind: 'node', objectId: { name: '甲节点' } })).toBe(false)
    expect(isSpatialLinkQuery({})).toBe(false)
  })

  it('深链不携带可写动词（键名或值）；携带即判真', () => {
    expect(spatialLinkHasWriteVerb({ keyword: '某通道', action: 'submit' })).toBe(true)
    expect(spatialLinkHasWriteVerb({ keyword: 'submit-记录', from: 'insight-prices' })).toBe(true)
    expect(spatialLinkHasWriteVerb({ keyword: '某通道', from: 'insight-prices' })).toBe(false)
  })

  it('跳转出口双保险：合法 query 才 push；数组、白名单外键或可写动词一律不动', () => {
    const { push, router } = routerSpy()
    const legal = objectSpatialLinkQuery({
      kind: 'plant',
      objectId: '甲风电场',
      regionId: 'yunnan',
      companyId: 'company-a',
      date: '2026-09-10',
      from: 'insight-plants',
    })
    openSpatialViewLink(router, { path: SPATIAL_LINK_TARGETS.marketSpatial, query: legal })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ path: '/grid-assets/market', query: legal })

    openSpatialViewLink(router, { path: SPATIAL_LINK_TARGETS.marketSpatial, query: { ...legal, rows: ['1', '2'] } as unknown as Record<string, string> })
    openSpatialViewLink(router, { path: SPATIAL_LINK_TARGETS.marketSpatial, query: { ...legal, submit: '1' } })
    openSpatialViewLink(router, { path: SPATIAL_LINK_TARGETS.marketSpatial, query: {} })
    expect(push).toHaveBeenCalledTimes(1)
  })
})

describe('入口权限显隐（三页共用判定）', () => {
  it('目标路径有权限 + 单个对象名 + 公司明确才渲染；任一缺失不渲染', () => {
    gov.canAccessPath.mockImplementation(() => true)
    expect(
      spatialEntryVisible({ path: SPATIAL_LINK_TARGETS.marketSpatial, objectName: '甲节点', companyId: 'company-a' })
    ).toBe(true)
    // 无对象（未选对象 / 未选参考节点）不渲染
    expect(
      spatialEntryVisible({ path: SPATIAL_LINK_TARGETS.marketSpatial, objectName: '', companyId: 'company-a' })
    ).toBe(false)
    expect(
      spatialEntryVisible({ path: SPATIAL_LINK_TARGETS.marketSpatial, objectName: null, companyId: 'company-a' })
    ).toBe(false)
    // 公司未选不渲染：grid-geo 对象上下文按 地区+公司 校验归属，绑定必然落空
    expect(spatialEntryVisible({ path: SPATIAL_LINK_TARGETS.marketSpatial, objectName: '甲节点', companyId: null })).toBe(false)
    // 无权限不渲染（而不是渲染后再让目标页拦截）
    gov.canAccessPath.mockImplementation(() => false)
    expect(
      spatialEntryVisible({ path: SPATIAL_LINK_TARGETS.disclosureSpatial, objectName: '某输电通道', companyId: 'company-a' })
    ).toBe(false)
  })

  it('canFollowSpatialLink 走 governance 既有口径；governance 抛错按无权限处理', () => {
    gov.canAccessPath.mockImplementation(() => true)
    expect(canFollowSpatialLink('/grid-assets/market')).toBe(true)
    gov.canAccessPath.mockImplementation(() => {
      throw new Error('governance unavailable')
    })
    expect(canFollowSpatialLink('/grid-assets/market')).toBe(false)
  })
})
