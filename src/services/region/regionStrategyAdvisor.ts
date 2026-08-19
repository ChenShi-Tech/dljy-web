// 地区现货量化决策算法（纯前端，沿用 quant.ts/tradingLab.ts 模式，后续可迁 FastAPI）。
// 输入 = 地区档案 + 主体画像；输出 = 策略评分 / 收益风险快测 / 地区校准参数。
// 现跑地区“特征示意”模型，结果 basis 标注；接入真实采集后同一逻辑即生产级。
import type { PricePoint, StorageParams } from '@/services/quant/quant'
import {
  getRegionSpotProfile,
  type RegionSpotProfile,
  type RegionTradingParams,
  type StrategyArchetype,
  type SubjectKind
} from '@/data/regionSpotProfiles'

export type SubjectProfile = {
  kind: SubjectKind
  capacityMw: number // 装机/可调容量
  contractCoverage: number // 中长期合约覆盖率 0~1
  hasStorage: boolean
}

export type StrategyFitScore = {
  archetype: StrategyArchetype
  score: number // 0~100
  reasons: string[]
}

export type SpotPnlEstimate = {
  expectedRevenueWan: number // 预期现货收益 万元（区间中值）
  revenueLowWan: number
  revenueHighWan: number
  deviationCostWan: number // 日前-实时偏差成本 万元
  negativeExposureWan: number // 负价时段暴露 万元（负=损失）
  storageUpsideWan: number // 加储能套利的边际收益 万元（hasStorage=false 时为潜在值）
  basis: 'curated' | 'captured'
}

export type RegionCalibratedParams = {
  priceFloor: number
  priceCap: number
  volBudget: number
  negativeThreshold: number // 负价规避触发阈值 元/MWh
  granularity: string
  priceLabel: '节点价' | '统一价' // 价格标签口径，供预测对齐
  arbWindow: { chargeHours: number[]; dischargeHours: number[] } // 储能套利时段
  basis: 'curated' | 'captured'
}

const VOL_WEIGHT: Record<string, number> = { low: 0.4, mid: 0.6, high: 0.85, extreme: 1 }

export function scoreStrategyFit(profile: RegionSpotProfile, subject: SubjectProfile): StrategyFitScore[] {
  return profile.strategyArchetypes
    .map((archetype) => {
      const subjectWeight = archetype.fitWeights[subject.kind] ?? 0.3
      const volFactor = VOL_WEIGHT[profile.priceProfile.volatility] ?? 0.6
      const reasons: string[] = []
      let score = 100 * subjectWeight * volFactor
      // 储能套利类原型：有储能加分，无储能视为潜力
      if (archetype.id.includes('arb') || archetype.id.includes('spread')) {
        if (subject.hasStorage) {
          score *= 1.15
          reasons.push('具备储能，套利可直接落地')
        } else {
          score *= 0.8
          reasons.push('暂无储能，套利收益为潜在值')
        }
      }
      // 合约覆盖低时，现货暴露类策略更关键
      if (subject.contractCoverage < 0.6) {
        score *= 1.08
        reasons.push('合约覆盖偏低，现货策略权重上调')
      }
      reasons.unshift(`主体类型契合度 ${(subjectWeight * 100).toFixed(0)}%，地区波动性系数 ${volFactor}`)
      return { archetype, score: Math.max(0, Math.min(100, Math.round(score))), reasons }
    })
    .sort((a, b) => b.score - a.score)
}

export function estimateSpotPnL(profile: RegionSpotProfile, subject: SubjectProfile): SpotPnlEstimate {
  const curve = profile.priceProfile.typicalDayCurve
  const mean = curve.length ? curve.reduce((sum, v) => sum + v, 0) / curve.length : 0
  const mwhPerDay = subject.capacityMw * 24
  // 现货敞口 = 未被中长期覆盖的部分
  const spotShare = 1 - subject.contractCoverage
  const expectedRevenueWan = (mean * mwhPerDay * spotShare) / 10000
  const volPct = VOL_WEIGHT[profile.priceProfile.volatility] ?? 0.6
  const band = Math.abs(expectedRevenueWan) * volPct
  // 偏差成本：覆盖越低、波动越大越高（示意）
  const deviationCostWan = (mwhPerDay * spotShare * profile.priceProfile.peakValleySpread * 0.05 * volPct) / 10000
  // 负价暴露：负价频率 × 谷段电量 × 估计负价幅度
  const negMagnitude = Math.min(0, profile.mechanism.priceFloor)
  const negativeExposureWan = (profile.priceProfile.negativePriceFreq * mwhPerDay * spotShare * negMagnitude) / 10000
  // 储能套利上行：峰谷价差 × 容量假设(按 25% 容量、4h)
  const storageUpsideWan = (profile.priceProfile.peakValleySpread * subject.capacityMw * 0.25 * 4) / 10000
  return {
    expectedRevenueWan: round2(expectedRevenueWan),
    revenueLowWan: round2(expectedRevenueWan - band),
    revenueHighWan: round2(expectedRevenueWan + band),
    deviationCostWan: round2(deviationCostWan),
    negativeExposureWan: round2(negativeExposureWan),
    storageUpsideWan: round2(storageUpsideWan),
    basis: profile.dataSource
  }
}

export function calibrateRegionParams(profile: RegionSpotProfile): RegionCalibratedParams {
  const curve = profile.priceProfile.typicalDayCurve
  // 谷段(最低 4 小时)充电、峰段(最高 4 小时)放电
  const indexed = curve.map((v, h) => ({ v, h }))
  const charge = [...indexed].sort((a, b) => a.v - b.v).slice(0, 4).map((x) => x.h).sort((a, b) => a - b)
  const discharge = [...indexed].sort((a, b) => b.v - a.v).slice(0, 4).map((x) => x.h).sort((a, b) => a - b)
  return {
    priceFloor: profile.mechanism.priceFloor,
    priceCap: profile.mechanism.priceCap,
    volBudget: profile.riskParams.suggestedVolBudget,
    negativeThreshold: profile.mechanism.allowsNegative ? Math.round(profile.mechanism.priceFloor * 0.5) : 0,
    granularity: profile.mechanism.granularity,
    priceLabel: profile.mechanism.priceFormation === '节点电价' ? '节点价' : '统一价',
    arbWindow: { chargeHours: charge, dischargeHours: discharge },
    basis: profile.dataSource
  }
}

// 把地区典型曲线转成 OODA/quant 用的 PricePoint[]（24 点 → hour/price）。
// 曲线为空（未启动省）时返回空数组，调用方回退到 quant 的默认曲线。
export function regionPriceCurve(regionId: string): PricePoint[] {
  const profile = getRegionSpotProfile(regionId)
  return profile.priceProfile.typicalDayCurve.map((price, hour) => ({ hour, price }))
}

// 地区校准的储能参数：用地区典型均价覆盖 contractPrice（中长期合约参考价），
// 并按字段独立叠加地区显式校准的「储能相关」口径（偏差罚比 / 峰谷σ；地区未校准时回退量化默认 → 零行为变更）。
export function regionStorageParams(regionId: string, base: StorageParams): StorageParams {
  const profile = getRegionSpotProfile(regionId)
  const tp = profile.tradingParams ?? {}
  // B26 修复：按字段独立覆盖，仅当地区显式校准了储能相关字段才覆盖 base。
  // 旧实现用聚合 calibrated（任一 tradingParams 字段非空即 true）一刀切，会导致地区只校准
  // lab-only 字段（confidenceBounds/socBounds/riskThresholds）时连带把 base 的罚比/σ 强制重置为
  // 默认（跨维度串扰）。逐字段守卫后：未校准 storage 字段 → 原样保留 base，零行为变更。
  let merged: StorageParams = base
  if (tp.deviationPenaltyPct != null) merged = { ...merged, deviationPenaltyPct: tp.deviationPenaltyPct }
  if (tp.peakValleySigma != null) merged = { ...merged, peakValleySigma: tp.peakValleySigma }
  const curve = profile.priceProfile.typicalDayCurve
  if (!curve.length) return merged
  const mean = Math.round(curve.reduce((sum, v) => sum + v, 0) / curve.length)
  return { ...merged, contractPrice: mean }
}

// 交易口径地区化框架（PR-4）
// 量化算法当前内置的交易口径字面默认值，集中镜像于此，供 view 层注入时回退使用。
// 与以下自包含算法中的字面量一一对应（quant.ts/tradingLab.ts 须运行时自包含、不能 import 地区数据，故各自保留同一字面默认）：
// peakValleySigma   ↔ quant.analyzePriceCurve 的 ±0.65σ 峰/谷阈值（stats 标注，经 buildOodaDecision 注入）
// detectPeakValleyArbitrage 直接取「先低后高」最大价差对、不用 σ，故 σ 不改变套利识别灵敏度
// deviationPenaltyPct ↔ quant.defaultStorageParams.deviationPenaltyPct = 12
// confidenceBounds  ↔ tradingLab 置信度 clamp [52, 92]
// socBounds         ↔ tradingLab SOC clamp [12, 92]
// riskThresholds    ↔ tradingLab 风险判级 收益>18&置信>74→低 / 收益>12→中 / 否则高
// 改这里的默认值时，务必同步上述算法字面量，否则 verify:quant-parity 会失配。
export const TRADING_PARAM_DEFAULTS = {
  peakValleySigma: 0.65,
  deviationPenaltyPct: 12,
  confidenceBounds: [52, 92] as [number, number],
  socBounds: [12, 92] as [number, number],
  riskThresholds: { lowRiskReturn: 18, lowRiskConfidence: 74, midRiskReturn: 12 }
} as const

export type ResolvedRegionTradingParams = {
  peakValleySigma: number
  deviationPenaltyPct: number
  confidenceBounds: [number, number]
  socBounds: [number, number]
  riskThresholds: { lowRiskReturn: number; lowRiskConfidence: number; midRiskReturn: number }
  /** 是否使用了地区自定义校准值（false=全部回退通用默认，即未校准） */
  calibrated: boolean
  /** 口径来源：region-calibrated=地区已校准 / default-uncalibrated=通用默认(待校准) */
  basis: 'region-calibrated' | 'default-uncalibrated'
}

// 解析地区交易口径参数：地区 profile.tradingParams 填了哪项用哪项，未填回退量化算法字面默认。
// 返回值由 view 层注入 quant.ts / tradingLab.ts。当前所有地区均未填 tradingParams →
// 全部回退默认 → 与历史输出逐位一致（零行为变更，verify:quant-parity 守门）；值待真实校准。
export function deriveRegionTradingParams(regionId: string): ResolvedRegionTradingParams {
  const tp: RegionTradingParams = getRegionSpotProfile(regionId).tradingParams ?? {}
  const calibrated = Object.values(tp).some((v) => v !== undefined && v !== null)
  return {
    peakValleySigma: tp.peakValleySigma ?? TRADING_PARAM_DEFAULTS.peakValleySigma,
    deviationPenaltyPct: tp.deviationPenaltyPct ?? TRADING_PARAM_DEFAULTS.deviationPenaltyPct,
    confidenceBounds: tp.confidenceBounds ?? TRADING_PARAM_DEFAULTS.confidenceBounds,
    socBounds: tp.socBounds ?? TRADING_PARAM_DEFAULTS.socBounds,
    riskThresholds: tp.riskThresholds ?? TRADING_PARAM_DEFAULTS.riskThresholds,
    calibrated,
    basis: calibrated ? 'region-calibrated' : 'default-uncalibrated'
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
