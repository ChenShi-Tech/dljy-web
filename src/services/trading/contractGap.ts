// S6 中长期补仓（一日作业链第六步）：敞口评估与补仓建议。
//
// 口径为**买方立场**（售电/大用户）：中长期持仓覆盖预测用电量，缺口按现货价结算。
// 因此建议的核心逻辑只有一句话：**缺口敞在贵的现货上要赶紧补，敞在便宜的现货上
// 可以故意留着**；超签反过来——多余持仓按现货价回售，现货便宜时回售吃亏（转让止损），
// 现货贵时回售反而有利（不动）。
//
// S2 的市场态势（regime）提供"现货贵不贵"的判断，S3 的方向判断在两可情形下拍板。
// 两者都缺席时按平衡市处理并在理由里写明——不假装有判断。

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
