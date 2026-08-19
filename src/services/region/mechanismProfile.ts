// mechanismProfile — 市场机制画像（逐字段溯源投影）
// ----------------------------------------------------------------------------
// 定位（ADR docs/architecture/serving-route-registry-adr.md 裁决四 · Epic #1431 S2）：
// 数据契约的 meta 回答「数据真不真、哪个地区」；本画像回答「这份数据是什么标的、
// 什么粒度、da/rt 能不能分」，即怎么读这份数据。消费方（图表/agent/报表）据此
// 决定渲染口径，不再各自硬编码地区分支。
//
// 铁律：每个字段都带 source，只做投影不造事实。无法从权威源推导的一律
// `{ value: 'unknown', source: null }`，禁止用展示层画像（如 operator profile 的
// hierarchy 层级文案）猜测机制（二轮评审 B4）。
//
// 字段 → 唯一权威源：
// priceBasis / maturity / ruleVersion / ruleAsOf → regionSettlementRules（省级规则事实）
// gridOperator                                   → REGION_GRID_OPERATOR 常量
// daRtSeparated / granularityNative/Served / resamplePolicy
// → serving-route-registry 路由声明
// （路由本身就是这些事实的来源，不是二手推断）
// clearingModel                                  → 恒 unknown：正式出清规则事实源未接入前，
// 南网「区域联合出清」等表述只是文档描述，
// 不构成可机读机制证据（B4）

import { REGION_GRID_OPERATOR } from 'shared/region/constants.mjs'
import { resolveServingRoute, type ServingDatasetId, type ServingRoute } from '@/services/data/contracts/servingRoutes.gen'
import { getRegionSettlementRule, normalizeGridOperatorToken, type RegionSettlementRule, type SettlementPriceBasis } from './regionSettlementRules'

/** 字段溯源标签：指明该字段值来自哪个权威源；null 表示无法推导（value 必为 'unknown'）。 */
export type MechanismFieldSource =
  | 'settlement-rules'
  | 'grid-operator-constant'
  | 'serving-route'

export type MechanismField<T> = {
  value: T | 'unknown'
  source: MechanismFieldSource | null
  /** 该字段为何 unknown / 有何限定（进 UI tooltip 与审计） */
  note?: string
}

export type MechanismProfile = {
  regionId: string
  /** 本画像所描述的数据集（机制字段随数据集路由而异） */
  datasetId: ServingDatasetId
  gridOperator: MechanismField<'csg' | 'sgcc'>
  priceBasis: {
    generation: MechanismField<SettlementPriceBasis>
    consumption: MechanismField<SettlementPriceBasis>
  }
  /** 该地区该数据集的日前/实时是否真正分离；false = 单一口径，禁止渲染双线 */
  daRtSeparated: MechanismField<boolean>
  /** 源数据原生粒度（分钟） */
  granularityNative: MechanismField<number>
  /** 服务层交付粒度（分钟），与原生不等即发生了重采样，UI 必须角标 */
  granularityServed: MechanismField<number>
  resamplePolicy: MechanismField<'step_repeat' | 'interpolate' | null>
  /** B4：正式出清规则事实源接入前恒 unknown，不从展示画像推导 */
  clearingModel: MechanismField<'provincial' | 'regional_joint'>
  maturity: MechanismField<RegionSettlementRule['maturity']>
  ruleVersion: MechanismField<string>
  ruleAsOf: MechanismField<string>
}

const UNKNOWN: MechanismField<never> = { value: 'unknown', source: null }

function unknownWith(note: string): MechanismField<never> {
  return { value: 'unknown', source: null, note }
}

/** serving 层统一交付 96 点/15min（quarter_hour 数据集口径）。 */
const SERVED_GRANULARITY_MINUTES = 15

/**
 * 结算规则是否为该地区专属收录（非通用底座回退）。通用底座的 priceBasis 是保守占位
 * （`generic-2024` 版本 + notes 标注 fallback），不能当作该省机制事实透出。
 */
function isRegionSpecificRule(rule: RegionSettlementRule, regionId: string): boolean {
  return rule.regionId === regionId && rule.maturity !== 'generic'
}

function priceBasisField(
  rule: RegionSettlementRule,
  regionId: string,
  pick: (rule: RegionSettlementRule) => SettlementPriceBasis
): MechanismField<SettlementPriceBasis> {
  if (!isRegionSpecificRule(rule, regionId)) {
    return unknownWith(`${regionId} 未收录专属结算口径（当前为通用底座回退），价格标的不可断言`)
  }
  return { value: pick(rule), source: 'settlement-rules', note: `${rule.label}（${rule.version}）` }
}

function routeFields(route: ServingRoute | null, regionId: string, datasetId: ServingDatasetId) {
  if (!route) {
    const note = `${regionId} 未配置 ${datasetId} serving 路由，粒度与 da/rt 分离性不可断言`
    return {
      daRtSeparated: unknownWith(note),
      granularityNative: unknownWith(note),
      granularityServed: unknownWith(note),
      resamplePolicy: unknownWith(note)
    }
  }
  return {
    daRtSeparated: {
      value: route.daRtSeparated,
      source: 'serving-route' as const,
      note: route.daRtSeparated
        ? '日前/实时为独立数据源，价差有意义'
        : '该地区该数据集无日前/实时维度，两条线同源——禁止渲染为双线'
    },
    granularityNative: { value: route.granularityNative, source: 'serving-route' as const },
    granularityServed: { value: SERVED_GRANULARITY_MINUTES, source: 'serving-route' as const },
    resamplePolicy: {
      value: route.resamplePolicy,
      source: 'serving-route' as const,
      ...(route.resamplePolicy
        ? { note: `源 ${route.granularityNative} 分钟粒度经 ${route.resamplePolicy} 重采样到 ${SERVED_GRANULARITY_MINUTES} 分钟` }
        : {})
    }
  }
}

/**
 * 解析地区 × 数据集的机制画像。纯投影：不发请求、不缓存、不造事实。
 * @param regionId 地区 id（与 regions.ts RegionProfile.id 一致）
 * @param datasetId serving-route-registry 数据集 id
 */
export function resolveMechanismProfile(regionId: string, datasetId: ServingDatasetId): MechanismProfile {
  const rule = getRegionSettlementRule(regionId)
  const operator = normalizeGridOperatorToken((REGION_GRID_OPERATOR as Record<string, string>)[regionId])
  const route = resolveServingRoute(datasetId, regionId)
  const regionSpecific = isRegionSpecificRule(rule, regionId)
  return {
    regionId,
    datasetId,
    gridOperator: operator
      ? { value: operator, source: 'grid-operator-constant' }
      : unknownWith(`${regionId} 不在 REGION_GRID_OPERATOR 登记面内`),
    priceBasis: {
      generation: priceBasisField(rule, regionId, (item) => item.generatorPriceBasis),
      consumption: priceBasisField(rule, regionId, (item) => item.userPriceBasis)
    },
    ...routeFields(route, regionId, datasetId),
    // B4：operator profile 的 hierarchy（「南方区域/省级市场/节点」）是展示层级文案，
    // 不是出清模型证据；接入正式规则事实源前一律 unknown，不做任何推导。
    clearingModel: unknownWith('出清模型尚无机器可读事实源，未从展示层画像推导（ADR 裁决四 B4）'),
    maturity: regionSpecific
      ? { value: rule.maturity, source: 'settlement-rules' }
      : unknownWith(`${regionId} 未收录专属结算口径，成熟度不可断言`),
    ruleVersion: regionSpecific
      ? { value: rule.version, source: 'settlement-rules' }
      : UNKNOWN,
    ruleAsOf: regionSpecific
      ? { value: rule.asOf, source: 'settlement-rules' }
      : UNKNOWN
  }
}

// 图表口径规矩（S2 两条硬规矩，消费方必须据此渲染）

/**
 * 规矩一：是否允许渲染日前/实时双线。
 * `daRtSeparated=false`（如山西基线宽表无 da/rt 维度）时两条线同源、完全重合，
 * 画双线是伪造信息量，只渲染单线并标注口径。unknown 同样保守按单线处理。
 */
export function allowsDualPriceSeries(profile: MechanismProfile): boolean {
  return profile.daRtSeparated.value === true
}

/**
 * 规矩二：是否必须显示粒度角标（原生粒度 ≠ 服务粒度 = 发生过重采样，
 * 展示的点数并非源数据真实分辨率，不标注会让用户误判精度）。
 */
export function requiresGranularityBadge(profile: MechanismProfile): boolean {
  const native = profile.granularityNative.value
  const served = profile.granularityServed.value
  return typeof native === 'number' && typeof served === 'number' && native !== served
}

/** 粒度角标文案（仅在 requiresGranularityBadge 为真时使用）。 */
export function granularityBadgeText(profile: MechanismProfile): string | null {
  if (!requiresGranularityBadge(profile)) return null
  const native = profile.granularityNative.value as number
  const served = profile.granularityServed.value as number
  return `源 ${Math.round(1440 / native)} 点/${native}min → 展示 ${Math.round(1440 / served)} 点/${served}min`
}

/** 价格口径角标文案（单线/双线口径说明，供图表标题旁常驻显示）。 */
export function priceBasisBadgeText(profile: MechanismProfile): string {
  if (profile.daRtSeparated.value === false) return '基线·无日前/实时分价'
  if (profile.daRtSeparated.value === true) {
    const consumption = profile.priceBasis.consumption.value
    if (consumption === 'unified') return '用户侧统一电价·日前/实时分离'
    if (consumption === 'nodal') return '节点电价·日前/实时分离'
    if (consumption === 'zonal') return '分区电价·日前/实时分离'
    return '日前/实时分离'
  }
  return '口径未登记'
}
