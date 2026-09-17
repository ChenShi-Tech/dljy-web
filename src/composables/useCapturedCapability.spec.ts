// 用 vi.mock 隔离 regionContext/regionModules（避免拖入真实注册表与副作用导入），
// 只验证四件套对 capability 状态的映射口径与两页历史副本逐字一致。
// vi.mock 工厂被提升到文件顶，可变桩必须放 vi.hoisted 持有（vitest 提升规则）。
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  regionId: 'shanxi',
  capability: null as unknown
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: {
    get value() {
      return { id: mocks.regionId }
    }
  }
}))
vi.mock('@/services/region/regionModules', () => ({
  getRegionCapabilityForPath: () => mocks.capability
}))

import { useCapturedCapability } from '@/composables/useCapturedCapability'

function withCapability(stub: unknown) {
  mocks.capability = stub
}

describe('useCapturedCapability 能力降级四件套', () => {
  it('能力未配置（null）→ 不判降级、无支撑项、无备注', () => {
    withCapability(null)
    const c = useCapturedCapability('/xhjy/zrqsb')
    expect(c.routeCapability.value).toBeNull()
    expect(c.capabilitySupports.value).toEqual([])
    expect(c.isCapabilityDegraded.value).toBe(false)
    expect(c.capabilityNote.value).toBeNull()
  })

  it('status=degraded → 判降级；route.note 优先作为备注', () => {
    withCapability({
      status: 'degraded',
      route: { note: '当前地区暂无日前上报真实源', dataSupportByRegion: { shanxi: [{ expectation: 'missing', note: '采集缺失' }] } },
      module: { dataSupportByRegion: {} }
    })
    const c = useCapturedCapability('/xhjy/zrqsb')
    expect(c.isCapabilityDegraded.value).toBe(true)
    expect(c.capabilitySupports.value).toEqual([{ expectation: 'missing', note: '采集缺失' }])
    expect(c.capabilityNote.value).toBe('当前地区暂无日前上报真实源')
  })

  it('hidden / not-configured 同样判降级', () => {
    withCapability({ status: 'hidden', route: {}, module: { dataSupportByRegion: {} } })
    expect(useCapturedCapability('/xhjy/zptqx').isCapabilityDegraded.value).toBe(true)
    withCapability({ status: 'not-configured', route: {}, module: { dataSupportByRegion: {} } })
    expect(useCapturedCapability('/xhjy/zptqx').isCapabilityDegraded.value).toBe(true)
  })

  it('无 route.note 时回退到第一个 missing 支撑项备注；healthy 状态不判降级', () => {
    withCapability({
      status: 'ok',
      route: {},
      module: { dataSupportByRegion: { shanxi: [{ expectation: 'missing', note: '回退备注' }] } }
    })
    const c = useCapturedCapability('/xhjy/zptqx')
    expect(c.isCapabilityDegraded.value).toBe(false)
    expect(c.capabilityNote.value).toBe('回退备注')
  })
})
