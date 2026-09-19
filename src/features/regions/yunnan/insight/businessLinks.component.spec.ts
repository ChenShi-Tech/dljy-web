// businessLinks.component.spec.ts — 业务模块只读深链登记回归（dljy#3096，OpenSpec 任务 15.5）
// 守什么不变量（design D11 表、insight-context-handoff CH04/CH05、PP07）：
//   ① 深链 query 只含白名单键（期间/对象名/from/panel），值均为非空字符串——
//      原始数据数组与嵌套对象不进 URL（CH05）；
//   ② 深链不携带可写动词（submit/create/confirm 等）：跳转是查看，不是发起操作；
//   ③ 目标登记处全部是既有业务模块的只读页面路径，不指向任何写端点；
//   ④ 跳转出口双保险：白名单外键、空值或带可写动词的 query 一律不 push。
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import {
  DEEP_LINK_TARGETS,
  businessDeepLinkQuery,
  deepLinkHasWriteVerb,
  isDeepLinkQuery,
  openBusinessDeepLink,
  openDataMaintenanceLink,
} from './businessLinks'

function routerSpy() {
  const push = vi.fn()
  return { push, router: { push } as unknown as Router }
}

describe('businessDeepLinkQuery', () => {
  it('只带期间、from 标记与可选对象名；值全为非空字符串，空对象名不带键', () => {
    const minimal = businessDeepLinkQuery({ window: { start: '2026-05-01', end: '2026-05-31' }, from: 'insight-plants' })
    expect(minimal).toEqual({ start: '2026-05-01', end: '2026-05-31', from: 'insight-plants' })

    const withObject = businessDeepLinkQuery({
      window: { start: '2026-05-01', end: '2026-05-31' },
      from: 'insight-prices',
      objectId: '甲风电场',
    })
    expect(withObject).toEqual({ start: '2026-05-01', end: '2026-05-31', from: 'insight-prices', object: '甲风电场' })

    for (const query of [minimal, withObject]) {
      expect(isDeepLinkQuery(query)).toBe(true)
      expect(deepLinkHasWriteVerb(query)).toBe(false)
      expect(Object.values(query).every((value) => typeof value === 'string' && value.length > 0)).toBe(true)
    }
  })

  it('白名单判定拒绝原始数据数组、嵌套对象、未知键与空值', () => {
    const base = { start: '2026-05-01', end: '2026-05-31', from: 'insight-plants' }
    expect(isDeepLinkQuery({ ...base, rows: ['120.5', '88.0'] })).toBe(false) // 原始数据数组不进 URL
    expect(isDeepLinkQuery({ ...base, object: { name: '甲风电场' } })).toBe(false)
    expect(isDeepLinkQuery({ ...base, data: 'raw' })).toBe(false) // 白名单外键
    expect(isDeepLinkQuery({ ...base, end: '' })).toBe(false) // 空值
    expect(isDeepLinkQuery({})).toBe(false)
  })

  it('深链不携带可写动词；目标登记处均为只读页面路径', () => {
    expect(deepLinkHasWriteVerb({ action: 'submit' })).toBe(true)
    expect(deepLinkHasWriteVerb({ start: 'submit-2026-05-01' })).toBe(true)
    // 结算深链目标是复盘业务页路径，不是任何写端点
    expect(DEEP_LINK_TARGETS.settlementReview).toBe('/xhjy/review')
    expect(DEEP_LINK_TARGETS.midlongPositions).toBe('/zcqjy/positions')
    expect(DEEP_LINK_TARGETS.dataMaintenance).toBe('/data-ops/console')
    for (const path of Object.values(DEEP_LINK_TARGETS)) {
      expect(/submit|create|confirm|approve|void|delete/.test(path)).toBe(false)
    }
  })

  it('跳转出口双保险：合法 query 才 push；白名单外键或可写动词一律拒绝', () => {
    const { push, router } = routerSpy()
    const legal = { start: '2026-05-01', end: '2026-05-31', from: 'insight-plants' }

    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: legal })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ path: '/xhjy/review', query: legal })

    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: { start: '2026-05-01' } as Record<string, string> })
    openBusinessDeepLink(router, {
      path: DEEP_LINK_TARGETS.settlementReview,
      query: { ...legal, submit: '1' },
    })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('资料维护深链：一次组装出 panel=upload + 期间 + from 并跳转', () => {
    const { push, router } = routerSpy()
    openDataMaintenanceLink(router, { window: { start: '2026-05-01', end: '2026-05-31' }, from: 'insight-prices' })
    expect(push).toHaveBeenCalledWith({
      path: '/data-ops/console',
      query: { start: '2026-05-01', end: '2026-05-31', from: 'insight-prices', panel: 'upload' },
    })
  })
})
