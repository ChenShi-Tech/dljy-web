import { describe, expect, it } from 'vitest'
import {
  getRegionSettlementRule,
  normalizeGridOperatorToken,
  regionSettlementRules
} from './regionSettlementRules'

describe('normalizeGridOperatorToken', () => {
  it('两套电网词汇都归一', () => {
    expect(normalizeGridOperatorToken('csg')).toBe('csg')
    expect(normalizeGridOperatorToken('china-southern-grid')).toBe('csg')
    expect(normalizeGridOperatorToken('sgcc')).toBe('sgcc')
    expect(normalizeGridOperatorToken('state-grid')).toBe('sgcc')
  })

  it('蒙西/特殊区/未知/空值不落国网南网', () => {
    expect(normalizeGridOperatorToken('mengxi')).toBeNull()
    expect(normalizeGridOperatorToken('other')).toBeNull()
    expect(normalizeGridOperatorToken('inner-mongolia-grid')).toBeNull()
    expect(normalizeGridOperatorToken('')).toBeNull()
    expect(normalizeGridOperatorToken(null)).toBeNull()
    expect(normalizeGridOperatorToken(undefined)).toBeNull()
  })
})

describe('getRegionSettlementRule 电网底座回退', () => {
  it('已收录省份直接命中，不受 operator 参数影响', () => {
    expect(getRegionSettlementRule('yunnan', 'state-grid').regionId).toBe('yunnan')
    expect(getRegionSettlementRule('shanxi', 'csg').regionId).toBe('shanxi')
  })

  it('csg 与 china-southern-grid 都落南网底座（此前 csg 误落国网）', () => {
    const short = getRegionSettlementRule('unknown-region', 'csg')
    const long = getRegionSettlementRule('unknown-region', 'china-southern-grid')
    expect(short.label).toBe('南网通用现货结算底座')
    expect(long.label).toBe('南网通用现货结算底座')
  })

  it('sgcc 与 state-grid 都落国网底座', () => {
    expect(getRegionSettlementRule('unknown-region', 'sgcc').label).toBe('国网通用现货结算底座')
    expect(getRegionSettlementRule('unknown-region', 'state-grid').label).toBe('国网通用现货结算底座')
  })

  it('不传 operator 时按 REGION_GRID_OPERATOR 从 regionId 推导（广西是南网省份）', () => {
    const rule = getRegionSettlementRule('guangxi')
    expect(rule.label).toBe('南网通用现货结算底座')
    expect(rule.regionId).toBe('guangxi')
    expect(rule.notes.at(-1)).toContain('fallback')
  })

  it('国网未收录省份不传 operator 落国网底座', () => {
    expect(getRegionSettlementRule('hebei').label).toBe('国网通用现货结算底座')
  })

  it('未知地区且无 operator 时保守落国网底座并标注 fallback', () => {
    const rule = getRegionSettlementRule('unknown-region')
    expect(rule.label).toBe('国网通用现货结算底座')
    expect(rule.notes.at(-1)).toContain('unknown-region')
  })
})

describe('规则元数据一致性', () => {
  it('广东为征求意见稿，maturity 不得标 active', () => {
    const guangdong = regionSettlementRules.guangdong
    expect(guangdong.version).toContain('征求意见稿')
    expect(guangdong.maturity).toBe('draft')
  })
})
