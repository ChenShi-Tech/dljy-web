import { describe, expect, it } from 'vitest'
import {
  PUBLIC_GRID_COMMIT_HINT,
  PUBLIC_GRID_PRECHECK_NOTE,
  PUBLIC_GRID_TEMPLATE_IDS,
  canWritePublicGridData,
  isPublicGridTemplate
} from './publicGrid'

// 公共落点口径（dljy#2898 验收③）：与后端 server/shared/role-matrix.mjs 的
// PUBLIC_GRID_WRITE_ROLES（仅 ADMIN）同口径，清单只含 yn-t0-node-price。
describe('publicGrid 公共落点口径', () => {
  it('公共落点清单只含节点电价模板（yn-t0-node-price）', () => {
    expect([...PUBLIC_GRID_TEMPLATE_IDS]).toEqual(['yn-t0-node-price'])
  })

  it('isPublicGridTemplate 按清单判定，空值安全返回 false', () => {
    expect(isPublicGridTemplate('yn-t0-node-price')).toBe(true)
    expect(isPublicGridTemplate('forecast_reserve')).toBe(false)
    expect(isPublicGridTemplate('yn-t0-system-load')).toBe(false)
    expect(isPublicGridTemplate('')).toBe(false)
    expect(isPublicGridTemplate(null)).toBe(false)
    expect(isPublicGridTemplate(undefined)).toBe(false)
  })

  // 反向验证锚点：公共落点写权限刻意不含 BOSS（#2890 拍板——BOSS 权限边界是自身
  // 公司树，平台公共数据不在其中），只有平台超管 ADMIN。
  it('canWritePublicGridData 仅 ADMIN 为真，BOSS 与公司级角色均为假', () => {
    expect(canWritePublicGridData('ADMIN')).toBe(true)
    expect(canWritePublicGridData('BOSS')).toBe(false)
    expect(canWritePublicGridData('TRADER')).toBe(false)
    expect(canWritePublicGridData('SETTLEMENT')).toBe(false)
    expect(canWritePublicGridData('TRADE_LEAD')).toBe(false)
    expect(canWritePublicGridData('')).toBe(false)
    expect(canWritePublicGridData(null)).toBe(false)
    expect(canWritePublicGridData(undefined)).toBe(false)
  })

  it('只读提示都点明「仅平台管理员可提交」，预检提示另说明预检不受限', () => {
    expect(PUBLIC_GRID_COMMIT_HINT).toContain('仅平台管理员可提交')
    expect(PUBLIC_GRID_PRECHECK_NOTE).toContain('仅平台管理员可提交')
    expect(PUBLIC_GRID_PRECHECK_NOTE).toContain('预检')
  })
})
