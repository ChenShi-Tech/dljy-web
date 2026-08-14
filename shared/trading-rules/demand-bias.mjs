// ============================================================================
// R4 · 用户侧 96 点需求曲线申报偏置规则
// ----------------------------------------------------------------------------
// 用户侧报量不报价，申报曲线仅作日前电能量结算依据、不作为出清边界。因此申报量的
// 真实作用是**决定日前电量与实时电量的分割点**：
//
//   日前偏差电费 = (日前申报量 − 中长期量) × P_日前
//   实时偏差电费 = (实际用电量 − 日前申报量) × P_实时
//
// 推论：多报 1 MWh ≈「按日前价买、按实时价卖」；少报 1 MWh ≈「按实时价买、按日前价卖」。
// 所以预测实时更贵就该上偏，反之下偏。
//
// **最容易实现错的一点：回收是不对称的。** 只有「偏得多 + 价格方向对自己有利」才回收；
// 偏错方向不罚——因为那时你已经自己亏了，规则不再叠加惩罚。这意味着 L0=30% 是一条
// **收益封顶线**，不是风险封顶线。把它实现成对称的双向惩罚，会让偏置策略被系统性低估。
// ============================================================================
export function confidenceLevelOf(score) {
    if (score >= 70)
        return 'high';
    if (score >= 50)
        return 'medium';
    return 'low';
}
/**
 * R4 偏置规则表。管理带默认 ±20%，比法定带 ±30% 内收 10 个百分点——
 * 这 10 个点是给负荷预测误差留的保险：若负荷预测本身 MAPE 8%，偏置 20% 时最坏
 * 情况已逼近 28%，再往上就会撞 30% 硬线。
 */
export function decideBias(input) {
    const conf = confidenceLevelOf(input.confidenceScore);
    const dp = input.priceSpreadYuanPerMwh;
    const band = Math.abs(input.managementBand);
    let tableRatio = 0;
    let reason = '';
    if (conf === 'low') {
        reason = '置信度不足 50，方向判断不成立，回到中枢不下注';
    }
    else if (dp > 80) {
        tableRatio = conf === 'high' ? band : band * 0.4;
        reason = conf === 'high' ? '实时显著更贵且高置信 → 上偏至管理带上限' : '实时显著更贵但置信度中等 → 上偏打折';
    }
    else if (dp > 30) {
        tableRatio = conf === 'high' ? band * 0.6 : band * 0.4;
        reason = '实时偏贵 → 适度上偏';
    }
    else if (dp >= -30) {
        tableRatio = 0;
        reason = '价差在 ±30 元/MWh 内，方向不明不下注（中枢）';
    }
    else if (dp >= -80) {
        tableRatio = conf === 'high' ? -band * 0.6 : -band * 0.4;
        reason = '实时偏便宜 → 适度下偏';
    }
    else {
        tableRatio = conf === 'high' ? -band : -band * 0.4;
        reason = conf === 'high' ? '实时显著更便宜且高置信 → 下偏至管理带下限' : '实时显著更便宜但置信度中等 → 下偏打折';
    }
    const factor = Math.min(Math.max(input.exposureFactor, 0), 1);
    const biasRatio = tableRatio * factor;
    if (factor === 0 && tableRatio !== 0) {
        reason = '数据门禁为「仅展示」，偏置强制归零（手册 R4 末行 / S16 降级）';
    }
    else if (factor < 1 && tableRatio !== 0) {
        reason += `；数据门禁降级，暴露按 ${factor} 折减`;
    }
    return {
        biasRatio: Math.round(biasRatio * 10000) / 10000,
        tableRatio: Math.round(tableRatio * 10000) / 10000,
        confidence: conf,
        reason
    };
}
/**
 * L0 不对称回收计算。
 *
 * ```
 * 多报且实时更贵：回收 = [Q申报 − Q实际 × (1+L0)] × (P实时 − P日前)
 * 少报且实时更便宜：回收 = [Q实际 × (1−L0) − Q申报] × (P日前 − P实时)
 * 其余情形：不回收
 * ```
 *
 * 「其余情形」包含一种反直觉但正确的场景：**偏出 L0 很多、但方向判断错了 → 不回收**。
 * 因为此时交易员已经在市场上自负亏损，规则不再叠加惩罚。
 */
export function computeRecovery(input) {
    const actual = input.actualMwh;
    const declared = input.declaredMwh;
    const spread = input.realtimePrice - input.dayAheadPrice;
    const deviationRatio = actual > 0 ? (declared - actual) / actual : 0;
    const upper = actual * (1 + input.l0);
    const lower = actual * (1 - input.l0);
    const overDeclared = declared > upper;
    const underDeclared = declared < lower;
    const outOfBand = overDeclared || underDeclared;
    if (overDeclared && spread > 0) {
        const recovery = (declared - upper) * spread;
        return {
            recoveryYuan: Math.round(recovery * 100) / 100,
            deviationRatio: Math.round(deviationRatio * 10000) / 10000,
            outOfBand: true,
            favorableDirection: true,
            reason: `多报越出 +${(input.l0 * 100).toFixed(0)}% 免罚带且实时更贵（方向有利）→ 回收超出部分的价差收益`
        };
    }
    if (underDeclared && spread < 0) {
        const recovery = (lower - declared) * -spread;
        return {
            recoveryYuan: Math.round(recovery * 100) / 100,
            deviationRatio: Math.round(deviationRatio * 10000) / 10000,
            outOfBand: true,
            favorableDirection: true,
            reason: `少报越出 −${(input.l0 * 100).toFixed(0)}% 免罚带且实时更便宜（方向有利）→ 回收超出部分的价差收益`
        };
    }
    return {
        recoveryYuan: 0,
        deviationRatio: Math.round(deviationRatio * 10000) / 10000,
        outOfBand,
        favorableDirection: false,
        reason: outOfBand
            ? '偏差越出免罚带，但价格方向不利——已自负亏损，规则不叠加回收'
            : '偏差在免罚带内，不回收'
    };
}
export function deviationAlertOf(ratioAbs, l0 = 0.3) {
    const r = Math.abs(ratioAbs);
    if (r >= l0)
        return 'breach';
    if (r > 0.27)
        return 'red';
    if (r > 0.22)
        return 'yellow';
    if (r > 0.15)
        return 'blue';
    return 'ok';
}
export const DEVIATION_ALERT_LABEL = {
    ok: '正常',
    blue: '提示',
    yellow: '关注',
    red: '处置（逼近硬线）',
    breach: '越硬线'
};
