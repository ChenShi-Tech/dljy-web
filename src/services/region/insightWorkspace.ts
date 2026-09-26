// 市场洞察地区工作区注册契约（dljy#2995 阶段 A，OpenSpec build-yunnan-regional-market-insight D1/D2）
// ----------------------------------------------------------------------------
// 定位：与 regionSlots（驾驶舱插槽）同层的「工作区级装配」内核契约面。内核只认
// InsightWorkspaceDescriptor，地区扩展包（src/features/regions/<省>/insight/）把自己的
// 六页登记进来；内核绝不 import 任何具体省包（verify:region-isolation 同款纪律，
// 由 insightWorkspace.spec.ts 静态读取源码断言），装配只经 features/regions/index.ts。
//
// 与其他注册表的分工：
// - regionModules（能力）回答「该省这条路由允不允许看」；
// - regionSlots 回答「该省这个插槽用哪个组件渲染」；
// - 本注册表回答「该省的市场洞察工作区有哪些页、每页懒加载哪个组件、是否已交付」。
// 页面地址不含省份（/insight/<pageId>），具体加载哪个省的组件由全局地区上下文决定，
// 不新增第二个地区选择器，也不在 URL 编码省份（D2 裁决）。
//
// delivered 语义：业务能力已验收才为 true。false 的页面不进导航（listInsightNavigation
// 只返回 delivered 页），直接访问由宿主渲染「正在建设」占位，绝不渲染半成品或借他省数据。

import { BrainCircuit, ChartSpline, Factory, Gauge, LineChart, Network } from 'lucide-vue-next'
import type { Component } from 'vue'

/** 六个业务页 id（全局规范，各地区按需登记，不要求各省登记同名页） */
export type InsightPageId = 'overview' | 'prices' | 'supply' | 'grid-boundaries' | 'plants' | 'research'

/** 规范页面路径（无省份段；D2.1 可读路径规范：全小写、多词连字符） */
export const INSIGHT_PAGE_PATHS: Record<InsightPageId, string> = {
  overview: '/insight/overview',
  prices: '/insight/prices',
  supply: '/insight/supply',
  'grid-boundaries': '/insight/grid-boundaries',
  plants: '/insight/plants',
  research: '/insight/research'
}

export const INSIGHT_PAGE_IDS = Object.keys(INSIGHT_PAGE_PATHS) as InsightPageId[]

export type InsightPageDescriptor = {
  pageId: InsightPageId
  title: string
  /** 导航排序（升序），仅同地区内比较 */
  order: number
  /** 懒加载地区组件（保持按需加载，不把各省页面打进主包） */
  load: () => Promise<Component | { default: Component }>
  /** 业务能力已验收才为 true；false 时不进导航，直接访问显示「尚未开通/正在建设」 */
  delivered: boolean
  /** 可选：页内私有区块的能力判定路径（供宿主/内核二次校验，阶段 A 暂未消费） */
  capabilityPath?: string
}

export type InsightWorkspaceDescriptor = {
  workspaceId: string
  regionId: string
  /** 工作区结构版本（页集合/排序变化时递增，供后续证据与缓存隔离使用） */
  version: number
  defaultPageId: InsightPageId
  /**
   * UI 装配开关（不是授权开关）。false 时本工作区视为未启用：导航沿用现有入口、
   * 地址解析呈未开通。云南读 VITE_YUNNAN_INSIGHT_WORKSPACE（默认关闭）；
   * 山西兼容登记恒 true。授权一律走 governance.canAccessPath 的权限别名，与此无关。
   */
  enabled: () => boolean
  /**
   * 是否用本工作区的 delivered 页替换「市场洞察」分组（path '/insight'）的直接子项。
   * 装配型工作区（云南）为 true；兼容型登记（山西：只为规范地址解析与跨地区切换服务，
   * 导航保持旧 /sjfx/* 等入口）不设或为 false。默认 false。
   */
  replacesNavigation?: boolean
  pages: InsightPageDescriptor[]
}

// regionId → descriptor
const registry = new Map<string, InsightWorkspaceDescriptor>()

/**
 * 登记地区工作区。同一地区重复注册抛错（参照 regionSlots 的做法）：两个扩展包争抢
 * 同一地区的工作区属于装配错误，必须显式暴露而非静默后者覆盖前者。
 */
export function registerInsightWorkspace(descriptor: InsightWorkspaceDescriptor): void {
  const existing = registry.get(descriptor.regionId)
  if (existing) {
    throw new Error(
      `市场洞察工作区重复注册：地区 ${descriptor.regionId} 已有工作区 ${existing.workspaceId}——` +
      '同一地区只能登记一个洞察工作区，请检查扩展包的 register.ts'
    )
  }
  registry.set(descriptor.regionId, descriptor)
}

/**
 * 取某地区的工作区。未注册返回 null；enabled() 为 false 同样返回 null——
 * 「未启用」与「未注册」在消费侧行为完全一致（导航沿用现有入口、地址解析呈未开通），
 * 故不区分两者；确需区分（调试/诊断）的场合再引入带 enabled 标志的变体。
 */
export function getInsightWorkspace(regionId: string): InsightWorkspaceDescriptor | null {
  const descriptor = registry.get(regionId) ?? null
  if (descriptor && !descriptor.enabled()) return null
  return descriptor
}

export type InsightPageResolution =
  | { kind: 'page'; page: InsightPageDescriptor }
  | {
      kind: 'fallback'
      /** 目标地区默认入口路径（INSIGHT_PAGE_PATHS[defaultPageId]） */
      to: string
      reason: 'page-not-supported' | 'page-not-delivered'
      /** reason 为 page-not-delivered 时携带该页 descriptor，宿主据此渲染其 load 指向的占位组件 */
      page?: InsightPageDescriptor
    }
  | { kind: 'not-registered' }

/**
 * 解析某地区某页。三种结果：
 * - page：正常渲染地区组件；
 * - fallback：该地区已登记工作区但此页不支持（page-not-supported，宿主回默认入口并提示）
 *   或已登记未交付（page-not-delivered，宿主渲染占位说明，不请求数据）；
 * - not-registered：该地区未登记（或开关未启用）工作区，宿主显示「暂未开通」，不发任何请求。
 */
export function resolveInsightPage(regionId: string, pageId: InsightPageId): InsightPageResolution {
  const workspace = getInsightWorkspace(regionId)
  if (!workspace) return { kind: 'not-registered' }
  const page = workspace.pages.find((item) => item.pageId === pageId)
  if (!page) {
    return { kind: 'fallback', to: INSIGHT_PAGE_PATHS[workspace.defaultPageId], reason: 'page-not-supported' }
  }
  if (!page.delivered) {
    return {
      kind: 'fallback',
      to: INSIGHT_PAGE_PATHS[workspace.defaultPageId],
      reason: 'page-not-delivered',
      page
    }
  }
  return { kind: 'page', page }
}

/** 导航条目（与 data/navigation 的 NavItem 必填字段结构兼容；内核不反向依赖 data 层类型） */
export type InsightNavEntry = {
  path: string
  title: string
  icon: object
}

// 六个规范页的固定图标：pageId 是全局枚举，图标属装配表现而非地区业务契约，由内核提供。
const INSIGHT_PAGE_ICONS: Record<InsightPageId, object> = {
  overview: Gauge,
  prices: ChartSpline,
  supply: LineChart,
  'grid-boundaries': Network,
  plants: Factory,
  research: BrainCircuit
}

/**
 * 已启用装配型工作区的 delivered 页面（按 order 升序），供「市场洞察」分组原位替换。
 * 返回 null = 沿用现有导航（未注册 / 开关未启用 / 非 replacesNavigation 的兼容登记 /
 * 已启用但没有任何已交付页——最后一种必须保持现有 children，不显示空分组）。
 */
export function listInsightNavigation(regionId: string): InsightNavEntry[] | null {
  const workspace = getInsightWorkspace(regionId)
  if (!workspace || !workspace.replacesNavigation) return null
  const delivered = workspace.pages
    .filter((page) => page.delivered)
    .sort((a, b) => a.order - b.order)
  if (!delivered.length) return null
  return delivered.map((page) => ({
    path: INSIGHT_PAGE_PATHS[page.pageId],
    title: page.title,
    icon: INSIGHT_PAGE_ICONS[page.pageId]
  }))
}

/** 从路径解析规范页 id（六条 /insight/<pageId> 之一；/insight/cockpit 是旧入口、不算） */
export function insightPageIdFromPath(path: string): InsightPageId | null {
  const pathOnly = path.split(/[?#]/)[0]
  const normalized = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  if (!normalized.startsWith('/insight/')) return null
  const segment = normalized.slice('/insight/'.length).replace(/\/+$/, '')
  return (INSIGHT_PAGE_IDS as string[]).includes(segment) ? (segment as InsightPageId) : null
}

/** 是否为六条规范洞察路径之一（用于地区切换解析的洞察分支；旧入口 /insight/cockpit 不算） */
export function isInsightWorkspacePath(path: string): boolean {
  return insightPageIdFromPath(path) !== null
}

/** 仅供测试：清空注册表（生产代码不应调用） */
export function __resetInsightWorkspaces(): void {
  registry.clear()
}
