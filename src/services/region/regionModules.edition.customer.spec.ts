// 客户交付档页群门控（customer-edition-page-gating spec）：customer 构建下数据接入页群
// 不可达——fail-closed（覆盖面内未登记 available 一律拦截），未覆盖路径版本中性。
// 与仓库既有 .customer.spec.ts 同款做法：mock 编译期常量 IS_CUSTOMER_EDITION。
import { describe, expect, it, vi } from 'vitest'
import { filterNavigationForUser } from '@/services/governance'
import { currentEdition, isEditionRouteAvailable } from './regionModules'

vi.mock('@/services/edition', () => ({ IS_CUSTOMER_EDITION: true, IS_INTERNAL_EDITION: false }))

describe('版本档位门控（客户档 fail-closed）', () => {
  it('当前档位为 customer', () => {
    expect(currentEdition()).toBe('customer')
  })

  it('数据运维工作台与通用数据浏览器不可达', () => {
    expect(isEditionRouteAvailable('/data-ops/console')).toBe(false)
    expect(isEditionRouteAvailable('/yygl/data-browser')).toBe(false)
  })

  it('前缀覆盖面内的面板深链（旧 redirect 路径）一并拦截', () => {
    expect(isEditionRouteAvailable('/data-ops/upload')).toBe(false)
    expect(isEditionRouteAvailable('/data-ops/console/anything')).toBe(false)
  })

  it('未覆盖路径版本中性放行（客户档其余页群不受影响）', () => {
    expect(isEditionRouteAvailable('/dashboard')).toBe(true)
    expect(isEditionRouteAvailable('/xhjy/desk')).toBe(true)
  })

  it('封存洞察工作区六入口不可达；已交付驾驶舱与经典洞察页照常', () => {
    for (const p of ['/insight/overview', '/insight/prices', '/insight/supply', '/insight/grid-boundaries', '/insight/plants', '/insight/research']) {
      expect(isEditionRouteAvailable(p), p).toBe(false)
    }
    expect(isEditionRouteAvailable('/insight/cockpit')).toBe(true)
    expect(isEditionRouteAvailable('/sjfx/zrsjg')).toBe(true)
  })
})

describe('导航过滤链随档位摘除菜单（客户档）', () => {
  it('filterNavigationForUser 丢弃数据接入页群入口（整组从菜单消失）', () => {
    const items = [
      { path: '/dashboard', title: '驾驶舱' },
      {
        path: '/data-mgmt',
        title: '数据管理',
        children: [
          { path: '/data-ops/console', title: '数据运维工作台' },
          { path: '/yygl/data-browser', title: '通用数据浏览器' }
        ]
      }
    ]
    const filtered = filterNavigationForUser(items, { roleCode: 'ADMIN' }, 'yunnan')
    expect(filtered.map((item) => item.path)).toEqual(['/dashboard'])
    expect(filtered.some((item) => item.path === '/data-mgmt')).toBe(false)
  })
})
