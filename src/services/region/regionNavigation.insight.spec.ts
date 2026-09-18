// 地区切换解析 × 市场洞察规范页（dljy#2995 阶段 A）
// ----------------------------------------------------------------------------
// 洞察分支三态：目标地区支持且已交付 → 原地停留（保留合法 query）；已登记但不支持/
// 未交付 → 目标地区默认入口（白名单 query）；未登记 → 原地停留（宿主显示未开通）。
// 以及非洞察路径的行为回归：与改动前一致（系统页/地区感知页原地、其余落 landing）。

import { beforeEach, describe, expect, it } from 'vitest'
import { resolveRegionSwitchRoute } from './regionNavigation'
import {
  __resetInsightWorkspaces,
  registerInsightWorkspace,
  type InsightWorkspaceDescriptor
} from './insightWorkspace'

const stubLoad = () => Promise.resolve({})

function registerWorkspace(overrides: Partial<InsightWorkspaceDescriptor>) {
  registerInsightWorkspace({
    workspaceId: 'test.insight',
    regionId: 'yunnan',
    version: 1,
    defaultPageId: 'overview',
    enabled: () => true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 10, load: stubLoad, delivered: true },
      { pageId: 'prices', title: '价格与价差', order: 20, load: stubLoad, delivered: true },
      { pageId: 'supply', title: '供需与水电', order: 30, load: stubLoad, delivered: false }
    ],
    ...overrides
  })
}

const tradeLead = { roleCode: 'TRADE_LEAD' } as const
const admin = { roleCode: 'ADMIN' } as const

describe('resolveRegionSwitchRoute：市场洞察规范页', () => {
  beforeEach(() => {
    __resetInsightWorkspaces()
    // 云南：开关开，overview/prices 已交付、supply 已登记未交付
    registerWorkspace({})
    // 山西：兼容登记，overview 已交付、prices 已交付，supply 未登记
    registerWorkspace({
      regionId: 'shanxi',
      pages: [
        { pageId: 'overview', title: '市场洞察驾驶舱', order: 10, load: stubLoad, delivered: true },
        { pageId: 'prices', title: '价格分析', order: 20, load: stubLoad, delivered: true }
      ]
    })
  })

  it('目标地区支持且已交付 → 原地停留，保留当前合法 query（date 等业务参数不丢）', () => {
    expect(resolveRegionSwitchRoute('shanxi', tradeLead, '/insight/prices', { date: '2026-09-17' })).toEqual({
      path: '/insight/prices',
      query: { date: '2026-09-17' }
    })
  })

  it('已登记但不支持该页（山西无 supply）→ 回目标地区默认入口，仅保留白名单 query', () => {
    expect(
      resolveRegionSwitchRoute('shanxi', tradeLead, '/insight/supply', { date: '2026-09-17', market: 'da' })
    ).toEqual({
      path: '/insight/overview',
      query: { date: '2026-09-17' }
    })
  })

  it('已登记但未交付（云南 supply）→ 同样回目标地区默认入口', () => {
    expect(resolveRegionSwitchRoute('yunnan', tradeLead, '/insight/supply', { date: '2026-09-17' })).toEqual({
      path: '/insight/overview',
      query: { date: '2026-09-17' }
    })
  })

  it('未登记工作区的地区（广东）→ 原地停留，由宿主显示未开通（不跳走、不借他省数据）', () => {
    expect(resolveRegionSwitchRoute('guangdong', tradeLead, '/insight/prices', { date: '2026-09-17' })).toEqual({
      path: '/insight/prices',
      query: { date: '2026-09-17' }
    })
  })

  it('开关关闭的工作区按未登记处理：原地停留', () => {
    __resetInsightWorkspaces()
    registerWorkspace({ enabled: () => false })
    expect(resolveRegionSwitchRoute('yunnan', tradeLead, '/insight/prices', { date: '2026-09-17' })).toEqual({
      path: '/insight/prices',
      query: { date: '2026-09-17' }
    })
  })

  it('非规范洞察路径不进洞察分支：/insight/cockpit 旧入口走通用 landing 逻辑', () => {
    // 云南 TRADE_LEAD 的 landing 首选即云南工作台首页
    expect(resolveRegionSwitchRoute('yunnan', tradeLead, '/insight/cockpit')).toEqual({ path: '/xhjy/yunnan' })
  })
})

describe('resolveRegionSwitchRoute：非洞察路径行为回归（与改动前一致）', () => {
  it('系统页原地停留：/system/accounts', () => {
    expect(resolveRegionSwitchRoute('yunnan', admin, '/system/accounts')).toEqual({ path: '/system/accounts' })
    expect(resolveRegionSwitchRoute('shanxi', admin, '/system/accounts')).toEqual({ path: '/system/accounts' })
  })

  it('地区感知页原地停留：/sdzl/region-rules、/xhjy/region', () => {
    expect(resolveRegionSwitchRoute('guangdong', tradeLead, '/sdzl/region-rules')).toEqual({ path: '/sdzl/region-rules' })
    expect(resolveRegionSwitchRoute('sichuan', tradeLead, '/xhjy/region')).toEqual({ path: '/xhjy/region' })
  })

  it('普通页落地区 landing：山西切云南落云南工作台首页，云南切广东落地区总览', () => {
    expect(resolveRegionSwitchRoute('yunnan', tradeLead, '/sjfx/zrsjg')).toEqual({ path: '/xhjy/yunnan' })
    expect(resolveRegionSwitchRoute('guangdong', admin, '/sjfx/zrsjg')).toEqual({ path: '/xhjy/region' })
  })
})
