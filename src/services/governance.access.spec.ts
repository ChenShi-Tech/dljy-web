// canAccessPath 判权口径单测：
// 1) 授权判定只看路径——query/hash 剥离（登录/立场回跳存 fullPath，routes 是全等清单，
//    带 query 比对曾把有权用户误判无权、登录后丢深链落默认页）；
// 2) /yygl/import-hub 死授权回归网——该路径是 adminOnly 数据运维台的重定向壳，
//    保留授权只会让 SETTLEMENT/RETAIL_MANAGER 点了必被弹回 dashboard。
import { describe, expect, it } from 'vitest'
import { canAccessPath } from '@/services/governance'

describe('canAccessPath 判权只看路径（query/hash 不影响）', () => {
  const quant = { roleCode: 'QUANT' as const }

  it('精确清单路径带 query 仍有权（登录回跳深链场景）', () => {
    expect(canAccessPath('/ycsj/lab', quant)).toBe(true)
    expect(canAccessPath('/ycsj/lab?tab=official', quant)).toBe(true)
    expect(canAccessPath('/ycsj/lab#anchor', quant)).toBe(true)
  })

  it('无权路径带 query 仍无权（不因剥离而扩大授权面）', () => {
    // /system/accounts 属 adminOnlyRoutes，非管理员恒拒
    expect(canAccessPath('/system/accounts?x=1', quant)).toBe(false)
  })

  it('SETTLEMENT / RETAIL_MANAGER 对 /yygl/import-hub 死授权已移除', () => {
    expect(canAccessPath('/yygl/import-hub', { roleCode: 'SETTLEMENT' })).toBe(false)
    expect(canAccessPath('/yygl/import-hub', { roleCode: 'RETAIL_MANAGER' })).toBe(false)
  })
})
