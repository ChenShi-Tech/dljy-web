// insightLinkGuard.spec.ts — 洞察深链公共守门骨架回归（dljy#3121 两套登记归一）
// 守什么不变量（businessLinks 与 spatialLinks 共用的骨架，差异只在各自登记的条目数据）：
//   ① 放行：白名单内键 + 非空标量字符串值；requiredKeys 模式下必备键齐备、
//      非 requiredKeys 模式下 query 非空，即合法；
//   ② 拒绝：白名单外键、空值、缺必备键与空 query；
//   ③ 写动词：键名或值出现 submit/create/confirm 等即判真（携带即拒绝跳转）；
//   ④ URL 编码安全：数组、嵌套对象不进 URL（值必须是非空标量字符串）；
//   ⑤ 权限门控：governance.canAccessPath 既有口径，读取失败按无权限；
//   ⑥ 出口双保险：合法 query 才 push，数组、白名单外键或可写动词一律不动。
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import {
  canFollowInsightLink,
  insightLinkHasWriteVerb,
  isWhitelistedLinkQuery,
  openInsightLink,
} from './insightLinkGuard'

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

// 与两套登记的守门口径同形（条目数据留在各自登记处，这里用等形配置驱动公共骨架）
const businessGuard = {
  allowedKeys: ['start', 'end', 'object', 'from', 'panel'],
  requiredKeys: ['start', 'end', 'from'],
} as const
const spatialGuard = {
  allowedKeys: ['objectKind', 'objectId', 'objectRegion', 'objectCompany', 'objectDate', 'keyword', 'from'],
} as const

describe('白名单 query 校验（放行 / 拒绝）', () => {
  it('放行：requiredKeys 模式下必备键齐备 + 白名单内键 + 非空字符串值', () => {
    const base = { start: '2026-05-01', end: '2026-05-31', from: 'insight-plants' }
    expect(isWhitelistedLinkQuery(base, businessGuard)).toBe(true)
    expect(isWhitelistedLinkQuery({ ...base, panel: 'upload' }, businessGuard)).toBe(true)
  })

  it('放行：非 requiredKeys 模式（空间链口径）只要求非空 query + 白名单键', () => {
    expect(isWhitelistedLinkQuery({ keyword: '某输电通道', from: 'insight-prices' }, spatialGuard)).toBe(true)
    expect(isWhitelistedLinkQuery({ objectKind: 'node', from: 'insight-prices' }, spatialGuard)).toBe(true)
  })

  it('拒绝：白名单外键、空值、缺必备键与空 query', () => {
    const base = { start: '2026-05-01', end: '2026-05-31', from: 'insight-plants' }
    expect(isWhitelistedLinkQuery({ ...base, data: 'raw' }, businessGuard)).toBe(false) // 白名单外键
    expect(isWhitelistedLinkQuery({ ...base, end: '' }, businessGuard)).toBe(false) // 空值
    expect(isWhitelistedLinkQuery({ start: '2026-05-01', from: 'insight-plants' }, businessGuard)).toBe(false) // 缺必备键 end
    expect(isWhitelistedLinkQuery({}, businessGuard)).toBe(false) // 空 query 缺必备键
    expect(isWhitelistedLinkQuery({}, spatialGuard)).toBe(false) // 非 requiredKeys 模式：空 query 也拒绝
  })
})

describe('写动词拒绝', () => {
  it('键名或值出现 submit/create/confirm 等即判真；干净 query 判假', () => {
    expect(insightLinkHasWriteVerb({ keyword: '某通道', action: 'submit' })).toBe(true) // 键名命中
    expect(insightLinkHasWriteVerb({ start: 'submit-2026-05-01' })).toBe(true) // 值命中
    expect(insightLinkHasWriteVerb({ keyword: '某通道', from: 'insight-prices' })).toBe(false)
    expect(insightLinkHasWriteVerb({})).toBe(false)
  })
})

describe('URL 编码安全（只有非空标量字符串进 URL）', () => {
  it('数组值与嵌套对象值一律拒绝——原始数据不进 URL', () => {
    expect(isWhitelistedLinkQuery({ objectIds: ['甲节点'] }, spatialGuard)).toBe(false)
    expect(isWhitelistedLinkQuery({ objectKind: 'node', objectId: { name: '甲节点' } }, spatialGuard)).toBe(false)
    expect(
      isWhitelistedLinkQuery(
        { keyword: ['某通道'], from: 'insight-grid-boundaries' } as unknown as Record<string, unknown>,
        spatialGuard
      )
    ).toBe(false)
  })
})

describe('权限门控（governance 既有口径）', () => {
  it('有权限放行；无权限与 governance 抛错都按无权限处理', () => {
    gov.canAccessPath.mockImplementation(() => true)
    expect(canFollowInsightLink('/xhjy/review')).toBe(true)
    gov.canAccessPath.mockImplementation(() => false)
    expect(canFollowInsightLink('/xhjy/review')).toBe(false)
    gov.canAccessPath.mockImplementation(() => {
      throw new Error('governance unavailable')
    })
    expect(canFollowInsightLink('/xhjy/review')).toBe(false)
  })
})

describe('出口双保险', () => {
  it('合法 query 才 push；数组、白名单外键、空 query 或可写动词一律不动', () => {
    const { push, router } = routerSpy()
    const legal = { keyword: '某输电通道', from: 'insight-prices' }
    openInsightLink(router, { path: '/grid-assets/disclosures', query: legal, guard: spatialGuard })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ path: '/grid-assets/disclosures', query: legal })

    openInsightLink(router, {
      path: '/grid-assets/disclosures',
      query: { ...legal, rows: ['1', '2'] } as unknown as Record<string, string>,
      guard: spatialGuard,
    })
    openInsightLink(router, { path: '/grid-assets/disclosures', query: { ...legal, data: 'raw' }, guard: spatialGuard })
    openInsightLink(router, { path: '/grid-assets/disclosures', query: {}, guard: spatialGuard })
    expect(push).toHaveBeenCalledTimes(1)
  })
})
