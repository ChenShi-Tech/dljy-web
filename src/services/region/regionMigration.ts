// 地区规则迁移顾问：切换地区时，对比上一地区 vs 当前地区的现货规则画像，
// 列出业务相关差异 + 受影响的工作台/参数，提醒"哪些已配策略需重新标定"。
// 纯前端：复用 regionContext.packageRegionSummary（各省 RegionRuleSet/现货画像），无需后端。
// 贴合本项目「省级多地区规则差异」这一核心特点。
import { packageRegionSummary } from '@/services/region/regionContext'

export type RegionDiffItem = { label: string; from: string; to: string; impact: string }
export type RegionDiff = { fromName: string; toName: string; items: RegionDiffItem[] }

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? '允许' : '不允许'
  return String(v)
}

/** 对比两个地区的现货规则画像，返回有业务含义的差异项（无差异返回空 items）。 */
export function diffRegions(prevId: string, curId: string): RegionDiff {
  const a = packageRegionSummary(prevId)
  const b = packageRegionSummary(curId)
  const items: RegionDiffItem[] = []
  const push = (changed: boolean, label: string, from: unknown, to: unknown, impact: string) => {
    if (changed) items.push({ label, from: fmt(from), to: fmt(to), impact })
  }

  push(a.gridOperator !== b.gridOperator, '电网经营区', a.gridOperator, b.gridOperator,
    '申报通道、信息披露源与跨区衔接口径不同')
  push(
    a.mechanism.priceFloor !== b.mechanism.priceFloor || a.mechanism.priceCap !== b.mechanism.priceCap,
    '现货限价区间',
    `${a.mechanism.priceFloor}~${a.mechanism.priceCap} 元/MWh`,
    `${b.mechanism.priceFloor}~${b.mechanism.priceCap} 元/MWh`,
    '申报价格上下限需重设，回测/策略的限价约束随之调整'
  )
  push(a.mechanism.allowsNegative !== b.mechanism.allowsNegative, '负电价',
    a.mechanism.allowsNegative, b.mechanism.allowsNegative, '低谷申报与储能充电策略是否考虑负价')
  push(a.mechanism.settlement !== b.mechanism.settlement, '结算机制',
    a.mechanism.settlement, b.mechanism.settlement, '结算校核与偏差考核口径变化')
  push(a.mechanism.renewableBidding !== b.mechanism.renewableBidding, '新能源申报规则',
    a.mechanism.renewableBidding, b.mechanism.renewableBidding, '新能源场站申报方式需按新规调整')
  push(a.priceProfile.peakValleySpread !== b.priceProfile.peakValleySpread, '峰谷价差',
    `${a.priceProfile.peakValleySpread} 元/MWh`, `${b.priceProfile.peakValleySpread} 元/MWh`,
    '套利空间与储能充放计划收益预期变化')
  push(a.priceProfile.volatility !== b.priceProfile.volatility, '价格波动性',
    a.priceProfile.volatility, b.priceProfile.volatility, '风控敞口与仓位（Kelly/CVaR）参数应重评')
  push(a.marketStage !== b.marketStage, '市场阶段',
    a.marketStage, b.marketStage, '数据可信度与可用功能范围不同')

  return { fromName: a.regionName, toName: b.regionName, items }
}
