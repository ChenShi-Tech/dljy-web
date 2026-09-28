// 云南水电分析的可见范围（dljy#3389）
// ----------------------------------------------------------------------------
// 水电页是普通页面授权（可在权限矩阵里单独勾选），默认可见范围与「逐日系统负荷」一致：
// 同属供需数据，不因新增页面扩权，也不让原本能看系统负荷的角色看不到。
import { describe, expect, it } from 'vitest'
import { canAccessPath, roleLabels, type RoleCode } from './governance'

const allRoleCodes = Object.keys(roleLabels) as RoleCode[]

describe('水电分析页默认授权（dljy#3389）', () => {
  it('逐角色：水电页可访问 ⇔ 逐日系统负荷可访问', () => {
    for (const roleCode of allRoleCodes) {
      const user = { roleCode }
      expect(canAccessPath('/sjfx/hydro', user), `${roleCode}`).toBe(canAccessPath('/sjfx/actualLoad', user))
    }
  })

  it('逐页授权的量化角色可见，无系统负荷权限的交易员不可见', () => {
    expect(canAccessPath('/sjfx/hydro', { roleCode: 'QUANT' })).toBe(true)
    expect(canAccessPath('/sjfx/hydro', { roleCode: 'TRADER' })).toBe(false)
  })
})
