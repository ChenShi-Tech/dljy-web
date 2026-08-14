// ============================================================================
// 地区插槽注册表（Epic #1431 S3 第二段）
// ----------------------------------------------------------------------------
// 定位：通用内核与地区扩展包之间的**唯一契约面**。内核只认「插槽 id」，扩展包把自己的
// 面板注册到插槽上；内核绝不 import 具体扩展包（`verify:region-isolation` 第三道守卫
// 强制），从而实现「某地区可单独开发、增删该省面板不触碰内核与他省」。
//
// 与能力注册表的分工：
//   - regionModules（能力）回答「该省这条路由/这个卡片**允不允许**看」；
//   - 本注册表回答「该省这个插槽**用哪个组件**渲染」。
//   渲染前两者都要过：能力 available 且插槽有注册，才渲染扩展面板。
//
// 装配时机：`src/features/regions/index.ts` 在应用启动时统一 import 各扩展包的
// `register.ts` 完成注册；内核 import 的是该聚合入口（不含具体省名），不违反守卫。
// ============================================================================

import type { Component } from 'vue'

/** 插槽 id 命名：`<内核页>.<位置>`，如 `cockpit.elasticity`。内核与扩展包共用常量。 */
export type RegionSlotId =
  | 'cockpit.elasticity'
  | 'cockpit.spread'
  | 'cockpit.spotPnl'
  | 'cockpit.plantOutput'
  | 'cockpit.priceOutputLinkage'
  | 'cockpit.disclosure'

export type RegionSlotRegistration = {
  slotId: RegionSlotId
  regionId: string
  /** 异步组件加载器（保持内核按需加载、不把各省面板打进主包） */
  component: Component
  /** 该面板依赖的能力路径（可选）：内核据此二次校验，缺能力即便注册也不渲染 */
  capabilityPath?: string
}

// slotId → regionId → registration
const registry = new Map<RegionSlotId, Map<string, RegionSlotRegistration>>()

/**
 * 注册地区面板到插槽。同一 (slotId, regionId) 重复注册会抛错——两个扩展包争抢同一插槽
 * 属于装配错误，必须显式暴露而非静默后者覆盖前者（沉默覆盖会让渲染结果依赖 import 顺序）。
 */
export function registerRegionSlot(registration: RegionSlotRegistration): void {
  const bySlot = registry.get(registration.slotId) ?? new Map<string, RegionSlotRegistration>()
  if (bySlot.has(registration.regionId)) {
    throw new Error(
      `地区插槽重复注册：${registration.slotId} 已被地区 ${registration.regionId} 占用——` +
      '同一插槽同一地区只能有一个面板，请检查扩展包的 register.ts'
    )
  }
  bySlot.set(registration.regionId, registration)
  registry.set(registration.slotId, bySlot)
}

/** 解析某地区某插槽的注册；无注册返回 null（内核据此走通用内容或诚实空态）。 */
export function resolveRegionSlot(slotId: RegionSlotId, regionId: string): RegionSlotRegistration | null {
  return registry.get(slotId)?.get(regionId) ?? null
}

/** 某地区已注册的全部插槽 id（排序）——供隔离快照与调试使用。 */
export function registeredSlotsForRegion(regionId: string): RegionSlotId[] {
  const out: RegionSlotId[] = []
  for (const [slotId, bySlot] of registry) {
    if (bySlot.has(regionId)) out.push(slotId)
  }
  return out.sort()
}

/** 仅供测试：清空注册表（生产代码不应调用）。 */
export function __resetRegionSlots(): void {
  registry.clear()
}
