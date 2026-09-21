// canAccessPath 判权口径单测：
// 1) 授权判定只看路径——query/hash 剥离（登录/立场回跳存 fullPath，routes 是全等清单，
//    带 query 比对曾把有权用户误判无权、登录后丢深链落默认页）；
// 2) /yygl/import-hub 死授权回归网——该路径是 adminOnly 数据运维台的重定向壳，
//    保留授权只会让 SETTLEMENT/RETAIL_MANAGER 点了必被弹回 dashboard。
import { describe, expect, it } from 'vitest'
import { canAccessPath, roleLabels, type RoleCode } from '@/services/governance'

describe('canAccessPath 判权只看路径（query/hash 不影响）', () => {
  it('独立专题对所有角色严格沿用复盘中心权限', () => {
    for (const roleCode of Object.keys(roleLabels) as RoleCode[]) expect(canAccessPath('/xhjy/review/analysis?date=2026-05-31', { roleCode })).toBe(canAccessPath('/xhjy/review', { roleCode }))
  })
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

  it('中长期售电合同/月度持仓与旧「合同管理」可见范围一致：换入口不扩权也不收窄（dljy#2939，原方案用例 18）', () => {
    for (const roleCode of Object.keys(roleLabels) as RoleCode[]) {
      const legacy = canAccessPath('/gsgl/contracts', { roleCode })
      expect(canAccessPath('/zcqjy/contracts', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/contracts/42?deliveryFrom=2027-01', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/positions', { roleCode })).toBe(legacy)
      // 放行只命中这三类路径：前缀相似的路径与中长期其它页面仍按角色规则判定，不被顺带放开。
      expect(canAccessPath('/zcqjy/contracts-export', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
      expect(canAccessPath('/zcqjy/positions/detail', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
    }
  })

  it('中长期 P2 分时持仓、场站维度持仓与分解集详情与月度持仓同一可见范围（dljy#2971）', () => {
    for (const roleCode of Object.keys(roleLabels) as RoleCode[]) {
      const legacy = canAccessPath('/gsgl/contracts', { roleCode })
      expect(canAccessPath('/zcqjy/positions/intervals', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/positions/stations', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/curves/7', { roleCode })).toBe(legacy)
      // 只放行这三类路径：前缀相似的路径仍按角色规则判定。
      expect(canAccessPath('/zcqjy/curves', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
      expect(canAccessPath('/zcqjy/positions/intervals-export', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
    }
  })

  it('中长期 P3 售电计划与交易执行与月度持仓同一可见范围（dljy#2973）', () => {
    for (const roleCode of Object.keys(roleLabels) as RoleCode[]) {
      const legacy = canAccessPath('/gsgl/contracts', { roleCode })
      expect(canAccessPath('/zcqjy/plans', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/execution', { roleCode })).toBe(legacy)
      // 只放行这两个精确路径：前缀相似的路径仍按角色规则判定。
      expect(canAccessPath('/zcqjy/plans-export', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
      expect(canAccessPath('/zcqjy/execution/1', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
    }
  })

  it('中长期 P4/P5 合同调整、业务复盘与外部账单与月度持仓同一可见范围（dljy#3014/#3016）', () => {
    for (const roleCode of Object.keys(roleLabels) as RoleCode[]) {
      const legacy = canAccessPath('/gsgl/contracts', { roleCode })
      expect(canAccessPath('/zcqjy/adjustments', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/review', { roleCode })).toBe(legacy)
      expect(canAccessPath('/zcqjy/bills', { roleCode })).toBe(legacy)
      // 只放行这三个精确路径：前缀相似的路径仍按角色规则判定。
      expect(canAccessPath('/zcqjy/adjustments/1', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
      expect(canAccessPath('/zcqjy/review-export', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
      expect(canAccessPath('/zcqjy/bills/2', { roleCode })).toBe(canAccessPath('/zcqjy/not-a-midlong-page', { roleCode }))
    }
  })

  it('SETTLEMENT / RETAIL_MANAGER 对 /yygl/import-hub 死授权已移除', () => {
    expect(canAccessPath('/yygl/import-hub', { roleCode: 'SETTLEMENT' })).toBe(false)
    expect(canAccessPath('/yygl/import-hub', { roleCode: 'RETAIL_MANAGER' })).toBe(false)
  })
})
