// @vitest-environment happy-dom
// 价格驱动分析的驱动级授权（dljy#3390）
// ----------------------------------------------------------------------------
// 合并页 /sjfx/price-drivers 不单独授权：可访问 ⇔ 任一驱动因素的旧路径可访问，
// 页内每个驱动因素按各自旧路径（zrxgx=新能源出力、zrxgx2=统调负荷）判定。
// 三类断言：① 逐角色全量等价；② 只有单一驱动权限的角色（售电经理）只放行该驱动；
// ③ 管理员在权限矩阵保存的覆盖配置（写回旧路径）下口径不变，单独写合并页路径不生效。
import { afterEach, describe, expect, it } from 'vitest'
import {
  canAccessPath,
  canAccessPriceDriver,
  PRICE_DRIVERS_PATH,
  priceDriverAccessPaths,
  resetRoleAccessOverride,
  roleLabels,
  saveRoleAccessOverride,
  type RoleCode
} from './governance'

const allRoleCodes = Object.keys(roleLabels) as RoleCode[]

afterEach(() => {
  resetRoleAccessOverride()
})

describe('价格驱动分析按驱动因素授权（dljy#3390）', () => {
  it('逐角色：合并页可访问 ⇔ 任一驱动旧路径可访问；驱动判定与旧路径一致', () => {
    for (const roleCode of allRoleCodes) {
      const user = { roleCode }
      const renewable = canAccessPath(priceDriverAccessPaths.renewable, user)
      const load = canAccessPath(priceDriverAccessPaths.load, user)
      expect(canAccessPath(PRICE_DRIVERS_PATH, user), `${roleCode} → 合并页`).toBe(renewable || load)
      expect(canAccessPriceDriver('renewable', user), `${roleCode} → 新能源`).toBe(renewable)
      expect(canAccessPriceDriver('load', user), `${roleCode} → 统调负荷`).toBe(load)
    }
  })

  it('售电经理只有统调负荷：能进合并页，但只放行统调负荷驱动（合并不扩权）', () => {
    const user = { roleCode: 'RETAIL_MANAGER' as RoleCode }
    expect(canAccessPath(PRICE_DRIVERS_PATH, user)).toBe(true)
    expect(canAccessPriceDriver('load', user)).toBe(true)
    expect(canAccessPriceDriver('renewable', user)).toBe(false)
  })

  it('两个旧页都无权的角色（交易员）进不了合并页', () => {
    const user = { roleCode: 'TRADER' as RoleCode }
    expect(canAccessPath(PRICE_DRIVERS_PATH, user)).toBe(false)
    expect(canAccessPriceDriver('renewable', user)).toBe(false)
    expect(canAccessPriceDriver('load', user)).toBe(false)
  })

  it('矩阵覆盖写回旧路径：只勾统调负荷 → 合并页可进、只放行统调负荷', () => {
    saveRoleAccessOverride('PLANT_OPERATOR', { defaultRoute: '/dashboard', groups: [], routes: ['/dashboard', '/sjfx/zrxgx2'], actions: [] })
    const user = { roleCode: 'PLANT_OPERATOR' as RoleCode }
    expect(canAccessPath(PRICE_DRIVERS_PATH, user)).toBe(true)
    expect(canAccessPriceDriver('load', user)).toBe(true)
    expect(canAccessPriceDriver('renewable', user)).toBe(false)
  })

  it('合并页路径本身不可单独授权：覆盖里只写合并页、没写任何驱动旧路径 → 拒绝', () => {
    saveRoleAccessOverride('PLANT_OPERATOR', { defaultRoute: '/dashboard', groups: [], routes: ['/dashboard', PRICE_DRIVERS_PATH], actions: [] })
    const user = { roleCode: 'PLANT_OPERATOR' as RoleCode }
    expect(canAccessPath(PRICE_DRIVERS_PATH, user)).toBe(false)
  })

  it("持有 '/sjfx' 组的覆盖等价于两个驱动都放行（组本身就覆盖两个旧路径）", () => {
    saveRoleAccessOverride('PLANT_OPERATOR', { defaultRoute: '/dashboard', groups: ['/sjfx'], routes: ['/dashboard'], actions: [] })
    const user = { roleCode: 'PLANT_OPERATOR' as RoleCode }
    expect(canAccessPath(PRICE_DRIVERS_PATH, user)).toBe(true)
    expect(canAccessPriceDriver('renewable', user)).toBe(true)
    expect(canAccessPriceDriver('load', user)).toBe(true)
  })
})
