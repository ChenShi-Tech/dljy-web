import { describe, expect, it } from 'vitest'
import { currentEdition, editionModuleCapabilities, isEditionRouteAvailable } from './regionModules'

// 内部档（默认构建/测试环境：VITE_EDITION 未置 → internal）。
// 客户档行为见 regionModules.edition.customer.spec.ts（mock IS_CUSTOMER_EDITION）。

describe('版本档位门控注册表（内部档基线）', () => {
  it('数据接入页群登记为 internal 可用', () => {
    const dataOps = editionModuleCapabilities.find((item) => item.id === 'data-ops')
    expect(dataOps).toBeDefined()
    expect(dataOps?.statusByEdition.internal).toBe('available')
    expect(currentEdition()).toBe('internal')
  })

  it('内部档：数据运维工作台与通用数据浏览器可达', () => {
    expect(isEditionRouteAvailable('/data-ops/console')).toBe(true)
    expect(isEditionRouteAvailable('/yygl/data-browser')).toBe(true)
  })

  it('内部档：前缀覆盖面内的面板深链（旧 redirect 路径）同样可达', () => {
    expect(isEditionRouteAvailable('/data-ops/upload')).toBe(true)
    expect(isEditionRouteAvailable('/yygl/data-onboarding')).toBe(true)
  })

  it('未覆盖路径版本中性放行（存量页群不受门控影响）', () => {
    expect(isEditionRouteAvailable('/dashboard')).toBe(true)
    expect(isEditionRouteAvailable('/xhjy/desk')).toBe(true)
    expect(isEditionRouteAvailable('/no-such-page-for-spec')).toBe(true)
  })

  it('内部档：封存洞察工作区六入口保留，已交付驾驶舱与经典页不受影响', () => {
    for (const p of ['/insight/overview', '/insight/prices', '/insight/supply', '/insight/grid-boundaries', '/insight/plants', '/insight/research']) {
      expect(isEditionRouteAvailable(p)).toBe(true)
    }
    expect(isEditionRouteAvailable('/insight/cockpit')).toBe(true)
    expect(isEditionRouteAvailable('/sjfx/zrsjg')).toBe(true)
  })
})
