import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetRegionSlots,
  registerRegionSlot,
  registeredSlotsForRegion,
  resolveRegionSlot
} from './regionSlots'

const stub = { name: 'StubPanel' }
const other = { name: 'OtherPanel' }

describe('地区插槽注册表', () => {
  beforeEach(() => __resetRegionSlots())

  it('按 (插槽, 地区) 解析注册的组件', () => {
    registerRegionSlot({ slotId: 'cockpit.elasticity', regionId: 'yunnan', component: stub })
    expect(resolveRegionSlot('cockpit.elasticity', 'yunnan')?.component).toBe(stub)
  })

  it('未注册的地区返回 null——内核据此走通用内容或诚实空态，不渲染他省面板', () => {
    registerRegionSlot({ slotId: 'cockpit.elasticity', regionId: 'yunnan', component: stub })
    expect(resolveRegionSlot('cockpit.elasticity', 'shanxi')).toBeNull()
    expect(resolveRegionSlot('cockpit.spread', 'yunnan')).toBeNull()
  })

  it('同插槽不同地区互不干扰（地区独立性）', () => {
    registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'yunnan', component: stub })
    registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'guangdong', component: other })
    expect(resolveRegionSlot('cockpit.spread', 'yunnan')?.component).toBe(stub)
    expect(resolveRegionSlot('cockpit.spread', 'guangdong')?.component).toBe(other)
  })

  it('重复注册同一 (插槽, 地区) 抛错——静默覆盖会让渲染结果依赖 import 顺序', () => {
    registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'yunnan', component: stub })
    expect(() => registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'yunnan', component: other }))
      .toThrow(/重复注册/)
  })

  it('capabilityPath 随注册透传，供内核二次校验能力闸门', () => {
    registerRegionSlot({
      slotId: 'cockpit.elasticity',
      regionId: 'yunnan',
      component: stub,
      capabilityPath: '/xhjy/yunnan/elasticity'
    })
    expect(resolveRegionSlot('cockpit.elasticity', 'yunnan')?.capabilityPath).toBe('/xhjy/yunnan/elasticity')
  })

  it('registeredSlotsForRegion 只列该省已注册插槽（排序稳定）', () => {
    registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'yunnan', component: stub })
    registerRegionSlot({ slotId: 'cockpit.elasticity', regionId: 'yunnan', component: stub })
    registerRegionSlot({ slotId: 'cockpit.spread', regionId: 'guangdong', component: other })
    expect(registeredSlotsForRegion('yunnan')).toEqual(['cockpit.elasticity', 'cockpit.spread'])
    expect(registeredSlotsForRegion('guangdong')).toEqual(['cockpit.spread'])
    expect(registeredSlotsForRegion('shanxi')).toEqual([])
  })
})

describe('云南扩展包装配', () => {
  beforeEach(() => __resetRegionSlots())

  it('installRegionPackages 幂等：重复调用不触发重复注册错误', async () => {
    const { installRegionPackages } = await import('@/features/regions')
    expect(() => {
      installRegionPackages()
      installRegionPackages()
    }).not.toThrow()
  })
})
