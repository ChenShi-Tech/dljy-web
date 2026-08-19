// trustGate.ts — 决策可信度门禁（provenance/trust gate）
// ----------------------------------------------------------------------------
// 把数据真伪（DataSourceBasis，见 basis.ts）升级为「能否进真金白银决策」的判定，
// 治理评估指出的「沉默的合成/占位传染」：合成/Mock 数据若被误用为申报/结算/外发依据，
// 会产出不可信托的决策。本模块在决策输出边界设硬阻塞，凡 basis 低于 captured 的链路，
// 产出带不可移除水印 + 禁止进申报/结算/外发。
//
// 判定（保守）：
// basis ∈ {real, captured}                          → operational（可进决策/申报/结算/外发）
// basis ∈ {synthetic, illustrative, empty, user_saved} | 未知/缺失 → advisory_only（仅决策支持，禁进申报/结算/外发）
//
// 与 data-access-paradigm §3 真伪 quartet 的关系：basis 是 quartet 的语义视图（unifyBasis 归一），
// 本模块把 basis 进一步二分为 decisionGrade，供决策边界（申报/结算/外发）硬判定。
// 与 RiskLevel L2_EXTERNAL 的关系：L2 管「外发动作需人工审批」，trustGate 管「输入数据能否进决策」
// 正交且互补：L2 外发前应先过 trustGate（advisory_only 数据不得外发）。

import type { DataSourceBasis } from './types'

export type DecisionGrade = 'operational' | 'advisory_only'

/** basis → decisionGrade 映射（保守：未知/缺失回落 advisory_only）。 */
export const DECISION_GRADE_FROM_BASIS: Record<DataSourceBasis, DecisionGrade> = {
  real: 'operational',
  captured: 'operational',
  synthetic: 'advisory_only',
  illustrative: 'advisory_only',
  empty: 'advisory_only',
  user_saved: 'advisory_only',
}

/** basis → decisionGrade（未知/缺失 → advisory_only，保守）。 */
export function decisionGradeFromBasis(basis?: DataSourceBasis | null): DecisionGrade {
  if (!basis) return 'advisory_only'
  return DECISION_GRADE_FROM_BASIS[basis] ?? 'advisory_only'
}

/** 是否可进真金白银决策（operational）。 */
export function isOperational(basis?: DataSourceBasis | null): boolean {
  return decisionGradeFromBasis(basis) === 'operational'
}

/**
 * 不可移除水印文本（决策产出标注）。operational 返回空串；advisory_only 返回显式警告。
 * 用于申报曲线/结算单/报告等决策产出的可见标注（前端渲染 + 后端 receipt 携带）。
 */
export function trustWatermark(basis?: DataSourceBasis | null): string {
  const grade = decisionGradeFromBasis(basis)
  if (grade === 'operational') return ''
  return `⚠ advisory_only · 仅决策支持，非结算/申报依据（basis=${basis ?? 'unknown'}）`
}

/**
 * 硬阻塞断言：basis 非 operational 时抛错。
 * 用于真实申报/结算/外发边界（如 bid_executor 真实接通后、submit_declaration）。
 * 当前 Mock 阶段调用方可选择只记 watermark 不 assert（预留接口，真实接通升级为硬阻塞）。
 */
export function assertOperational(basis: DataSourceBasis | null | undefined, label = 'decision'): void {
  if (!isOperational(basis)) {
    throw new Error(
      `[trust-gate] ${label} 拒绝执行：输入 basis=${basis ?? 'unknown'} 为 advisory_only（仅决策支持，非结算/申报依据）`
    )
  }
}
