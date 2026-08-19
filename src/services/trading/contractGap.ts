// S6 中长期补仓（一日作业链第六步）：敞口评估与补仓建议。
//
// 口径为买方立场（售电/大用户）：中长期持仓覆盖预测用电量，缺口按现货价结算。
// 因此建议的核心逻辑只有一句话：**缺口敞在贵的现货上要赶紧补，敞在便宜的现货上
// 可以故意留着**；超签反过来，多余持仓按现货价回售，现货便宜时回售吃亏（转让止损），
// 现货贵时回售反而有利（不动）。
//
// S2 的市场态势（regime）提供"现货贵不贵"的判断，S3 的方向判断在两可情形下拍板。
// 两者都缺席时按平衡市处理并在理由里写明，不假装有判断。

import type { MarketRegime } from 'shared/trading-rules/supply-demand.mjs'

export type GapDirection = 'add' | 'reduce' | 'hold'

export type ContractGapInput = {
  /** 预测电量 MWh（S3 申报曲线合计，或独立预测口径） */
  forecastMwh: number
  /** 中长期已持仓电量 MWh（同一交割期口径） */
  contractedMwh: number
  /** S2 主导市场态势；未产出传 null */
  regime: MarketRegime | null
  /** S3 方向判断；未产出传 null */
  direction: GapDirection | null
  /** 观望带：|敞口率| 不超过该值不动作（交易成本 > 敞口损益），默认 5% */
  holdBand?: number
}

export type GapSuggestion = 'buy-urgent' | 'buy' | 'hold' | 'sell'

export const GAP_SUGGESTION_LABEL: Record<GapSuggestion, string> = {
  'buy-urgent': '尽快补仓',
  buy: '择机补仓',
  hold: '观望',
  sell: '挂牌转让'
}

export type ContractGapAssessment = {
  /** 预测 − 持仓：正=缺口（现货敞口在买侧），负=超签（多余持仓回售现货） */
  gapMwh: number
  /** 敞口率 gap/预测；预测为 0 时为 null */
  gapPct: number | null
  suggestion: GapSuggestion
  reason: string
}

const EXPENSIVE: ReadonlySet<string> = new Set(['tight', 'scarce'])
const CHEAP: ReadonlySet<string> = new Set(['surplus', 'extreme_surplus'])

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function assessContractGap(input: ContractGapInput): ContractGapAssessment {
  const holdBand = input.holdBand ?? 0.05
  const gapMwh = round2(input.forecastMwh - input.contractedMwh)

  if (!(input.forecastMwh > 0)) {
    return {
      gapMwh,
      gapPct: null,
      suggestion: 'hold',
      reason: '无有效预测电量，敞口率无从计算——先回 S3 产出预测再做补仓决定'
    }
  }

  const gapPct = round2((gapMwh / input.forecastMwh) * 10000) / 10000
  const pctText = `${(gapPct * 100).toFixed(1)}%`

  if (Math.abs(gapPct) <= holdBand) {
    return {
      gapMwh,
      gapPct,
      suggestion: 'hold',
      reason: `敞口率 ${pctText} 在观望带 ±${(holdBand * 100).toFixed(0)}% 内，动仓的交易成本大于敞口损益`
    }
  }

  const regimeKnown = input.regime !== null
  const spotExpensive = regimeKnown && EXPENSIVE.has(input.regime as string)
  const spotCheap = regimeKnown && CHEAP.has(input.regime as string)

  if (gapMwh > 0) {
    // 缺口：不足部分按现货价买入结算
    if (spotExpensive) {
      return {
        gapMwh,
        gapPct,
        suggestion: 'buy-urgent',
        reason: `缺口 ${gapMwh} MWh（${pctText}）敞在偏紧现货上——每拖一天都按高价现货结算，最贵的补法是不补`
      }
    }
    if (spotCheap) {
      // 现货便宜：留敞口吃低价是合理策略，除非 S3 判断市场走强
      return input.direction === 'add'
        ? {
            gapMwh,
            gapPct,
            suggestion: 'buy',
            reason: `缺口 ${gapMwh} MWh（${pctText}）；现货虽宽松，但 S3 判断增持（预期走强），在低价窗口补仓正是时机`
          }
        : {
            gapMwh,
            gapPct,
            suggestion: 'hold',
            reason: `缺口 ${gapMwh} MWh（${pctText}）敞在宽松现货上——低价现货结算比中长期均价划算，刻意留敞口`
          }
    }
    return {
      gapMwh,
      gapPct,
      suggestion: 'buy',
      reason: `缺口 ${gapMwh} MWh（${pctText}）；${regimeKnown ? '平衡市' : '市场态势未产出（按平衡市处理）'}下缺口无价差红利，按计划补齐`
    }
  }

  // 超签：多余持仓按现货价回售
  const excess = Math.abs(gapMwh)
  if (spotCheap) {
    return {
      gapMwh,
      gapPct,
      suggestion: 'sell',
      reason: `超签 ${excess} MWh（${pctText}）在宽松现货上回售必然低于合同均价——挂牌转让止损`
    }
  }
  if (spotExpensive) {
    return input.direction === 'reduce'
      ? {
          gapMwh,
          gapPct,
          suggestion: 'sell',
          reason: `超签 ${excess} MWh；现货偏紧回售本可获利，但 S3 判断减持（预期走弱），趁高价转让落袋`
        }
      : {
          gapMwh,
          gapPct,
          suggestion: 'hold',
          reason: `超签 ${excess} MWh 在偏紧现货上按高价回售反而有利——不动，等回售结算`
        }
  }
  return {
    gapMwh,
    gapPct,
    suggestion: 'hold',
    reason: `超签 ${excess} MWh（${pctText}）；${regimeKnown ? '平衡市' : '市场态势未产出（按平衡市处理）'}下回售损益中性，转让还要付交易成本，不动`
  }
}

// 挂牌价 vs 年度均价 / 概率分布判时机 / 波动守卫 / 凯利仓位上限（#1966）
// ----------------------------------------------------------------------------
// 手册 S6：①对比月度挂牌价与年度均价（"现在补划不划算"的核心依据）②按概率分布
// 判断补仓时机 ③价格快速波动（>5%）暂停补仓、改用对冲（F3.8）。判断函数全部
// 纯逻辑 + null 诚实空态：任一输入缺失不硬给结论。

/** 挂牌价 vs 年度均价：低于年均价 → 补仓锁定划算；高于 → 不补/转出。 */
export function listingVsAnnualAverage(
  listingYuanPerMwh: number | null | undefined,
  annualAvgYuanPerMwh: number | null | undefined,
  thresholdPct = 3
): { diffPct: number; verdict: 'below' | 'above' | 'comparable'; hint: string } | null {
  if (!Number.isFinite(listingYuanPerMwh) || !Number.isFinite(annualAvgYuanPerMwh)) return null
  const l = Number(listingYuanPerMwh)
  const a = Number(annualAvgYuanPerMwh)
  if (l <= 0 || a <= 0) return null
  const diffPct = Math.round(((l - a) / a) * 1000) / 10
  if (Math.abs(diffPct) < thresholdPct) {
    return { diffPct, verdict: 'comparable', hint: `挂牌价较年度均价高 ${diffPct}%（< ${thresholdPct}% 阈值）——价格上无显著优势，按缺口紧迫度决定` }
  }
  return diffPct < 0
    ? { diffPct, verdict: 'below', hint: `挂牌价较年度均价低 ${Math.abs(diffPct)}%——低于年均价补仓锁定划算（买方）；卖方立场反向（转出有利）` }
    : { diffPct, verdict: 'above', hint: `挂牌价较年度均价高 ${diffPct}%——买方此时补仓吃亏，等回落或转出持仓；卖方立场反向` }
}

/**
 * 概率分布判时机（手册 S6 步骤②）：挂牌价与 S3 预测分布（P50 均值/谷/峰）对照
 * 挂牌价明显低于预测均值 → 锁价（现货大概率更贵）；明显高于 → 观望（现货更便宜）。
 * 阈值为经验初值（±5%），文档明示可校准。
 */
export function timingWithDistribution(
  listingYuanPerMwh: number | null | undefined,
  digest: { mean: number; valley: number; peak: number } | null | undefined
): { verdict: 'lock_now' | 'wait' | 'neutral'; hint: string } | null {
  if (!Number.isFinite(listingYuanPerMwh) || !digest) return null
  const l = Number(listingYuanPerMwh)
  const { mean, valley, peak } = digest
  if (!(mean > 0)) return null
  if (l < mean * 0.95) {
    return { verdict: 'lock_now', hint: `挂牌价 ${l} 低于预测均值 ${mean} 超 5%——锁价划算（预测现货均值更贵${l <= valley ? '，且已低于预测谷值 ' + valley : ''}）` }
  }
  if (l > mean * 1.05) {
    return { verdict: 'wait', hint: `挂牌价 ${l} 高于预测均值 ${mean} 超 5%——不急补（预测现货更便宜）${l >= peak ? '，已高于预测峰值 ' + peak + '（锁价明显吃亏）' : ''}` }
  }
  return { verdict: 'neutral', hint: `挂牌价 ${l} 与预测均值 ${mean} 相当（±5% 内）——价格维度中性，按缺口紧迫度与波动守卫决定` }
}

/** 价格快速波动守卫（手册异常处理：>5% 暂停补仓，等待窗口或改用对冲 F3.8）。 */
export function volatilityGuard(
  changePct: number | null | undefined,
  thresholdPct = 5
): { paused: boolean; hint: string } {
  if (!Number.isFinite(changePct)) {
    return { paused: false, hint: '今日价格波动幅度未录入——守卫不生效（录入后 >5% 自动暂停补仓建议）' }
  }
  const c = Number(changePct)
  if (Math.abs(c) > thresholdPct) {
    return {
      paused: true,
      hint: `价格波动 ${c}%（超 ±${thresholdPct}%）——按手册暂停补仓：等待窗口企稳，或改用对冲工具（F3.8：以现货敞口反向对冲替代直接补仓）`
    }
  }
  return { paused: false, hint: `价格波动 ${c}%（±${thresholdPct}% 内）——守卫未触发，可按建议执行` }
}

/**
 * 凯利仓位上限（会议：补仓/平仓判断仓位上限用凯利公式，无把握就低风险操作）。
 * 胜率来源：S3 方向判断的人工置信度（已是链上人工给定的概率，不另编）；
 * 盈亏（元/MWh 口径）：赢 = 预测均值 − 挂牌价（锁价节省），亏 = 挂牌价 − 预测谷值
 * （错判时最多按谷价吃亏的机会成本口径）。riskBudgetPct 上限沿用 quant 域参数。
 */
export function kellyPositionCap(input: {
  confidencePct: number | null | undefined
  listingYuanPerMwh: number | null | undefined
  digest: { mean: number; valley: number } | null | undefined
  riskBudgetPct?: number
}): { capPct: number; winYuanPerMwh: number; lossYuanPerMwh: number; note: string } | null {
  const { confidencePct, listingYuanPerMwh, digest } = input
  if (!Number.isFinite(confidencePct) || !Number.isFinite(listingYuanPerMwh) || !digest) return null
  const p = Math.min(Math.max(Number(confidencePct) / 100, 0), 1)
  const l = Number(listingYuanPerMwh)
  const win = Math.max(digest.mean - l, 0.01)
  const loss = Math.max(l - digest.valley, 0.01)
  const payoff = win / loss
  const raw = Math.max(0, (payoff * p - (1 - p)) / payoff)
  const budget = Number.isFinite(input.riskBudgetPct) && input.riskBudgetPct! > 0 ? input.riskBudgetPct! : 18
  const capPct = Math.round(Math.min(raw * 0.5, budget / 100) * 1000) / 10
  return {
    capPct,
    winYuanPerMwh: Math.round(win * 10) / 10,
    lossYuanPerMwh: Math.round(loss * 10) / 10,
    note: `半 Kelly（胜率取 S3 置信 ${Math.round(p * 100)}%、赢 ${Math.round(win)} / 亏 ${Math.round(loss)} 元/MWh 机会成本口径）× 风险预算 ${budget}%——补仓量上限，无把握就低风险操作`
  }
}


// 立场感知补仓（#2005）：卖方镜像口径 + 储能不适用声明
// ----------------------------------------------------------------------------
// 买方口径见 assessContractGap（缺口=预测用电−持仓）。卖方（电厂）镜像：
// 合同电量 vs 预测发电量，合同>预测=合同缺口（补发电或现货买回，紧），合同<预测=
// 富余电量（现货便宜时多签锁价 / 现货贵时留现货卖）。储能不套此逻辑（套利为主）。

export type PositionGapAssessment = ContractGapAssessment & {
  /** 评估口径：buyer=买方原口径 / seller=卖方镜像 / storage=不适用（仅记录） */
  frame: 'buyer' | 'seller' | 'storage'
  /** 卖方口径下的语义翻转说明（gapMwh 在卖方=合同电量−预测发电，正=合同缺口） */
  gapLabel: string
}

export function assessContractGapForPosition(
  input: ContractGapInput & { position?: string | null }
): PositionGapAssessment {
  const position = input.position ?? ''
  if (position === 'STORAGE') {
    const base = assessContractGap(input)
    return {
      ...base,
      frame: 'storage',
      gapLabel: '储能口径不适用（套利为主）',
      reason: `储能立场：中长期补仓口径不适用——套利为主（S3/S4 窗口），以下数字仅按买方公式参考${base.reason ? '——' + base.reason : ''}`
    }
  }
  if (position === 'GENERATOR') {
    // 卖方镜像：把「预测发电量 vs 合同电量」映射到买方框架的「持仓 vs 预测」再翻语义
    const mirrored = assessContractGap({
      forecastMwh: input.contractedMwh,
      contractedMwh: input.forecastMwh,
      regime: input.regime,
      direction: input.direction,
      holdBand: input.holdBand
    })
    const gapMwh = round2(input.contractedMwh - input.forecastMwh)
    const gapPct = input.forecastMwh > 0 ? round2(gapMwh / input.forecastMwh) : null
    const regimeNote = input.regime
      ? (input.regime === 'tight' || input.regime === 'scarce') ? '现货偏贵' : (input.regime === 'balanced' ? '现货平衡' : '现货便宜')
      : '现货态势未知（按平衡处理）'
    const hint =
      gapMwh > 0
        ? `合同电量超出预测发电 ${Math.abs(gapMwh)} MWh（合同缺口）——发不够须补发电或现货买回；${regimeNote}时买回成本${(input.regime === 'tight' || input.regime === 'scarce') ? '高，优先自查可调出力' : '可控，可现货买回'}`
        : gapMwh < 0
          ? `富余发电能力 ${Math.abs(gapMwh)} MWh——${regimeNote}时${(input.regime === 'surplus' || input.regime === 'extreme_surplus') ? '多签中长期锁价（现货便宜卖不上价）' : '留现货卖（现货贵卖得更贵）'}`
          : `合同与预测发电持平（${regimeNote}）`
    return {
      ...mirrored,
      gapMwh,
      gapPct,
      frame: 'seller',
      gapLabel: '合同电量 − 预测发电（正=合同缺口，负=富余）',
      reason: hint
    }
  }
  // 买方（RETAILER/LOAD/TRADER 等）原口径
  const base = assessContractGap(input)
  return { ...base, frame: 'buyer', gapLabel: '预测电量 − 中长期持仓（正=缺口，负=超签）' }
}
