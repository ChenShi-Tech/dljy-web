/** 预测置信度分档（0-100）。 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export declare function confidenceLevelOf(score: number): ConfidenceLevel;
export type BiasInput = {
    /** 预测价差 ΔP = P_实时 − P_日前（元/MWh） */
    priceSpreadYuanPerMwh: number;
    /** 预测置信度 0-100 */
    confidenceScore: number;
    /** 管理带上限（绝对值），内收自法定带 L0 留安全垫 */
    managementBand: number;
    /** 数据门禁给出的暴露系数（1 / 0.5 / 0），见 dataIntegrity.exposureFactorOf */
    exposureFactor: number;
};
export type BiasDecision = {
    /** 最终偏置比例（正=上偏多报，负=下偏少报） */
    biasRatio: number;
    /** 规则表给出的原始档位（未经暴露系数裁剪） */
    tableRatio: number;
    confidence: ConfidenceLevel;
    reason: string;
};
/**
 * R4 偏置规则表。管理带默认 ±20%，比法定带 ±30% 内收 10 个百分点——
 * 这 10 个点是给负荷预测误差留的保险：若负荷预测本身 MAPE 8%，偏置 20% 时最坏
 * 情况已逼近 28%，再往上就会撞 30% 硬线。
 */
export declare function decideBias(input: BiasInput): BiasDecision;
export type RecoveryInput = {
    /** 申报电量 MWh */
    declaredMwh: number;
    /** 实际用电量 MWh */
    actualMwh: number;
    /** 日前出清价 元/MWh */
    dayAheadPrice: number;
    /** 实时出清价 元/MWh */
    realtimePrice: number;
    /** 免罚带 L0（如 0.30） */
    l0: number;
};
export type RecoveryResult = {
    /** 回收金额 元（≥0；0 表示不回收） */
    recoveryYuan: number;
    /** 实际偏差率（(申报−实际)/实际） */
    deviationRatio: number;
    /** 是否越出免罚带 */
    outOfBand: boolean;
    /** 价格方向是否对申报方有利（有利才回收） */
    favorableDirection: boolean;
    reason: string;
};
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
export declare function computeRecovery(input: RecoveryInput): RecoveryResult;
/** 偏差率告警分级（手册 S9 实时监盘矩阵：>15% 蓝 / >22% 黄 / >27% 红 / 30% 硬线）。 */
export type DeviationAlert = 'ok' | 'blue' | 'yellow' | 'red' | 'breach';
export declare function deviationAlertOf(ratioAbs: number, l0?: number): DeviationAlert;
export declare const DEVIATION_ALERT_LABEL: Record<DeviationAlert, string>;
