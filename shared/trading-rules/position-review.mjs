// ============================================================================
// 立场复盘焦点（#2005 · 2026-08-13 会议第一优先级抽象）
// ----------------------------------------------------------------------------
// 三类身份的目标与买卖逻辑正相反：售电买电求成本最低、电厂卖电求收入最高、
// 储能套利求价差。同一张偏差表在三个立场下要问的问题不同——用户侧问「买没买到」，
// 电源侧问「卖没卖掉 / 爆没爆仓」，储能问「窗口吃到没」。本表把每个立场的
// 复盘目标、复盘要点与 S6 补仓口径集中定义，S1/S2/S6 面板按当前作业立场取用。
//
// 落地节奏按会议建议：先做透用户侧（售电）闭环，电厂侧为镜像口径，储能独立
// 视角——本表三态齐备，面板先消费用户侧全链 + 电厂侧复盘要点，储能 S6 口径
// 显式声明不适用（不硬套买方逻辑）。
// ============================================================================

/**
 * @typedef {'buyer'|'seller'|'storage'|'none'} PositionFrame
 * 复盘框架：buyer=买方（成本最低）/ seller=卖方（收入最高）/ storage=套利。
 */

/**
 * @typedef {Object} PositionReviewFocus
 * @property {PositionFrame} frame
 * @property {string} goal 复盘目标一句话
 * @property {string[]} reviewPoints 复盘要点（S1 晨会按此问问题）
 * @property {'applicable'|'mirrored'|'not_primary'} s6Scope S6 中长期补仓口径
 * @property {string} s6Note S6 口径说明
 */

/**
 * @type {Record<string, PositionReviewFocus>}
 * key = SubjectType（RETAILER/LOAD=买方，GENERATOR=卖方，STORAGE=储能）。
 */
export const POSITION_REVIEW_FOCUS = {
  RETAILER: {
    frame: 'buyer',
    goal: '购电成本最低 + 保量不触发偏差考核',
    reviewPoints: [
      '买没买到：日前中标率与缺口时段（缺口敞在贵现货上最伤）',
      '成本口径：实际购电成本 vs 预算/中长期均价',
      '偏差考核：被考核电量与罚款估算（申报 vs 实际）'
    ],
    s6Scope: 'applicable',
    s6Note: '买方口径：缺口=预测用电−中长期持仓，缺口敞在贵现货上要赶紧补'
  },
  LOAD: {
    frame: 'buyer',
    goal: '用电成本最低 + 保量不触发偏差考核',
    reviewPoints: [
      '买没买到：日前中标率与缺口时段',
      '成本口径：实际用电成本 vs 预算/中长期均价',
      '偏差考核：被考核电量与罚款估算'
    ],
    s6Scope: 'applicable',
    s6Note: '买方口径（大用户）：与售电同框架，规模与容差带按自身合同口径'
  },
  GENERATOR: {
    frame: 'seller',
    goal: '售电收入最高 + 合同履约不违约',
    reviewPoints: [
      '卖没卖掉：日前中标率与落空时段（高价时段落空最伤收入）',
      '收入口径：现货+中长期加权收入 vs 基准电价',
      '合同敞口：合同电量 vs 预测发电量（发不够=合同缺口，超发=富余走现货）',
      '弃电风险：新能源大发时段的中标与限电'
    ],
    s6Scope: 'mirrored',
    s6Note: '卖方口径（镜像）：合同>预测发电=合同缺口要补发电或买回；富余电量在现货便宜时多签锁价、现货贵时留现货卖'
  },
  STORAGE: {
    frame: 'storage',
    goal: '充放电套利价差最大化 + 容量收益',
    reviewPoints: [
      '窗口吃到没：计划充放时段 vs 实际执行（S3 窗口清单回看）',
      '循环毛利：实际价差 − 循环成本（R3 口径）是否为正',
      '约束执行：SOC 带内、循环次数、月度充电限额'
    ],
    s6Scope: 'not_primary',
    s6Note: '储能立场：中长期补仓非主作业线（套利为主）——S6 仅记录容量租赁/合约决定，不套买方缺口逻辑'
  },
  TRADER: {
    frame: 'buyer',
    goal: '组合视角：按当前作业立场的目标复盘（切到哪个立场用哪套）',
    reviewPoints: ['按当前作业立场的复盘要点执行（切换立场见立场选择器）'],
    s6Scope: 'applicable',
    s6Note: '组合视角跟随当前作业立场口径'
  },
  GROUP: {
    frame: 'none',
    goal: '管理层视角：关注整体损益与风险敞口，不作业',
    reviewPoints: ['集团视角无单立场复盘点——看组合报表与风险总览'],
    s6Scope: 'not_primary',
    s6Note: '管理层不作业'
  }
}

/**
 * 取立场复盘焦点；未知/空立场返回 null（调用方走通用口径，不猜立场）。
 * @param {string|null|undefined} position SubjectType
 * @returns {PositionReviewFocus|null}
 */
export function reviewFocusOf(position) {
  if (!position) return null
  return POSITION_REVIEW_FOCUS[position] ?? null
}
