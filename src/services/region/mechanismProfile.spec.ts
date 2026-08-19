import { describe, expect, it } from 'vitest'
import {
  allowsDualPriceSeries,
  granularityBadgeText,
  priceBasisBadgeText,
  requiresGranularityBadge,
  resolveMechanismProfile
} from './mechanismProfile'

describe('MechanismProfile 逐字段溯源', () => {
  it('云南 clearing_price：机制字段来自 serving 路由声明', () => {
    const profile = resolveMechanismProfile('yunnan', 'clearing_price')
    expect(profile.daRtSeparated).toMatchObject({ value: true, source: 'serving-route' })
    expect(profile.granularityNative).toMatchObject({ value: 60, source: 'serving-route' })
    expect(profile.granularityServed).toMatchObject({ value: 15, source: 'serving-route' })
    expect(profile.resamplePolicy).toMatchObject({ value: 'step_repeat', source: 'serving-route' })
  })

  it('山西 clearing_price：listrs_full 的 dmx 按 type 分日前/实时两条真曲线，原生即 15min 无重采样', () => {
    // #1531 前指向 24 点逐日文件、无 da/rt 维度（daRtSeparated:false）；现取 listrs_full 的
    // dmx 容器，type '0' 日前 / '1' 实时是两条真曲线，故为 true。
    const profile = resolveMechanismProfile('shanxi', 'clearing_price')
    expect(profile.daRtSeparated).toMatchObject({ value: true, source: 'serving-route' })
    expect(profile.granularityNative.value).toBe(15)
    expect(profile.resamplePolicy.value).toBeNull()
  })

  it('价格标的与成熟度来自结算规则', () => {
    const yunnan = resolveMechanismProfile('yunnan', 'clearing_price')
    expect(yunnan.priceBasis.generation).toMatchObject({ value: 'nodal', source: 'settlement-rules' })
    expect(yunnan.priceBasis.consumption).toMatchObject({ value: 'unified', source: 'settlement-rules' })
    expect(yunnan.maturity).toMatchObject({ value: 'trial', source: 'settlement-rules' })

    // 蒙西用户侧是全国独一份的分区价，证明画像不是按电网套模板
    const innerMongolia = resolveMechanismProfile('inner-mongolia', 'clearing_price')
    expect(innerMongolia.priceBasis.consumption.value).toBe('zonal')
  })

  it('电网归属来自 REGION_GRID_OPERATOR 常量', () => {
    expect(resolveMechanismProfile('yunnan', 'clearing_price').gridOperator)
      .toMatchObject({ value: 'csg', source: 'grid-operator-constant' })
    expect(resolveMechanismProfile('shanxi', 'clearing_price').gridOperator)
      .toMatchObject({ value: 'sgcc', source: 'grid-operator-constant' })
  })

  it('B4：clearingModel 恒 unknown，绝不从展示层画像推导', () => {
    for (const regionId of ['yunnan', 'shanxi', 'guangdong', 'inner-mongolia']) {
      const profile = resolveMechanismProfile(regionId, 'clearing_price')
      expect(profile.clearingModel.value).toBe('unknown')
      expect(profile.clearingModel.source).toBeNull()
    }
  })

  it('未配置路由的地区：机制字段 unknown 且带原因，不猜测', () => {
    // 河北无 clearing_price 路由（serving-route-registry 未登记）
    const profile = resolveMechanismProfile('hebei', 'clearing_price')
    expect(profile.daRtSeparated).toMatchObject({ value: 'unknown', source: null })
    expect(profile.daRtSeparated.note).toContain('未配置')
    expect(profile.granularityNative.value).toBe('unknown')
  })

  it('未收录专属结算口径的地区：价格标的 unknown，不透出通用底座占位值', () => {
    // 河北回退 sgcc 通用底座（generic），其 unified/unified 是保守占位不是河北机制事实
    const profile = resolveMechanismProfile('hebei', 'clearing_price')
    expect(profile.priceBasis.generation).toMatchObject({ value: 'unknown', source: null })
    expect(profile.priceBasis.consumption.value).toBe('unknown')
    expect(profile.maturity.value).toBe('unknown')
    // 电网归属仍可断言（常量登记面覆盖全省）
    expect(profile.gridOperator.value).toBe('sgcc')
  })

  it('node_price 数据集：云南有路由、山西无路由', () => {
    expect(resolveMechanismProfile('yunnan', 'node_price').daRtSeparated.value).toBe(true)
    expect(resolveMechanismProfile('guangdong', 'node_price').granularityNative.value).toBe(15)
    expect(resolveMechanismProfile('shanxi', 'node_price').daRtSeparated.value).toBe('unknown')
  })
})

describe('图表口径两规矩', () => {
  it('规矩一：daRtSeparated=false 禁双线，unknown 保守按单线', () => {
    expect(allowsDualPriceSeries(resolveMechanismProfile('yunnan', 'clearing_price'))).toBe(true)
    expect(allowsDualPriceSeries(resolveMechanismProfile('shanxi', 'clearing_price'))).toBe(true)
    // 未配置路由的地区 → unknown，保守按单线（不伪造双线信息量）
    expect(allowsDualPriceSeries(resolveMechanismProfile('hebei', 'clearing_price'))).toBe(false)
    // 显式 false 的分支：#1531 后注册表里已无 false 的实例（各地区都能分离），
    // 但规矩本身仍须成立，新地区若声明 false，消费方必须只画单线。
    const single = resolveMechanismProfile('yunnan', 'clearing_price')
    expect(allowsDualPriceSeries({ ...single, daRtSeparated: { ...single.daRtSeparated, value: false } })).toBe(false)
  })

  it('规矩二：原生≠服务粒度必须角标，相等则无角标', () => {
    const yunnan = resolveMechanismProfile('yunnan', 'clearing_price')
    expect(requiresGranularityBadge(yunnan)).toBe(true)
    expect(granularityBadgeText(yunnan)).toBe('源 24 点/60min → 展示 96 点/15min')

    const shanxi = resolveMechanismProfile('shanxi', 'clearing_price')
    expect(requiresGranularityBadge(shanxi)).toBe(false)
    expect(granularityBadgeText(shanxi)).toBeNull()

    // unknown 粒度不产生误导性角标
    expect(requiresGranularityBadge(resolveMechanismProfile('hebei', 'clearing_price'))).toBe(false)
  })

  it('价格口径角标随机制变化', () => {
    expect(priceBasisBadgeText(resolveMechanismProfile('yunnan', 'clearing_price')))
      .toBe('用户侧统一电价·日前/实时分离')
    // 山西 #1531 起也接上真分价，且结算规则同样登记用电侧统一电价 → 与云南同一句文案。
    // 两地区角标一致不是退化：文案由 (daRtSeparated, priceBasis.consumption) 决定，
    // 这两项在两地区确实相同；差异体现在下面 hebei（未配置路由 → 口径未登记）。
    expect(priceBasisBadgeText(resolveMechanismProfile('shanxi', 'clearing_price')))
      .toBe('用户侧统一电价·日前/实时分离')
    expect(priceBasisBadgeText(resolveMechanismProfile('hebei', 'clearing_price')))
      .toBe('口径未登记')
  })
})
