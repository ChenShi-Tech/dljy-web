import type { MarketTimingProfile } from './market-timing.mjs';
export type DecisionUnit = {
    /** 决策单元时长（分钟） */
    intervalMin: number;
    /** 一天有多少个决策单元 */
    unitsPerDay: number;
    /** 每个决策单元由多少个出清点合成（1 = 出清即结算，无合成） */
    clearingPointsPerUnit: number;
    /** 小时内切换是否产生价差收益（合成算子非 none 时为 false） */
    intraUnitSwitchingProfitable: boolean;
    reason: string;
};
/**
 * R1：由市场时序推导套利决策单元。
 * 这是 S8 优化目标函数的维度来源——**不要用 96 点价格做目标函数**，除非该省结算
 * 粒度确实等于出清粒度。
 */
export declare function decisionUnitOf(timing: MarketTimingProfile): DecisionUnit;
export type CapacityPaymentInput = {
    /** 额定功率 kW */
    ratedPowerKw: number;
    /** 容量电价标准 元/(kW·年) */
    standardYuanPerKwYear: number;
    /** 满功率连续放电时长 h */
    dischargeDurationH: number;
    /** 折算分母：全年最长净负荷高峰持续时长 h */
    denominatorH: number;
    /** 年循环次数 */
    cyclesPerYear: number;
    /** 可用容量 MWh */
    usableCapacityMwh: number;
    /** 运行口径放电深度（注意与寿命口径 DOD 不同源，勿混用） */
    operatingDod: number;
    /** 是否纳入容量电价清单管理——未纳入则 c_cap 记 0 */
    inCapacityList: boolean;
};
export type CapacityPayment = {
    /** 折算比例 min(1, 时长/分母) */
    ratio: number;
    /** 年容量收入 元 */
    annualRevenueYuan: number;
    /** 年放电电量 MWh */
    annualDischargeMwh: number;
    /** 度电容量折价 元/MWh */
    cCapYuanPerMwh: number;
    note: string;
};
/**
 * R11：容量电价折算到度电。
 *
 * **反直觉但关键**：`c_cap` 与年循环次数成反比。容量电价是按功率给的固定收入，
 * 多循环只是把它摊薄——所以不能把「多拿容量补贴」当作增加循环的理由，增加循环
 * 的唯一理由是价差本身足够（R3）。
 *
 * 「是否纳入清单管理」是**资产级配置**而非全局参数：未纳入的项目 c_cap 记 0，
 * 盈亏平衡价差整体上移，商业模型完全不同。
 */
export declare function capacityPayment(input: CapacityPaymentInput): CapacityPayment;
export type BreakevenInput = {
    /** 充电小时结算价 元/MWh */
    chargePriceYuanPerMwh: number;
    /** 综合往返效率（交流侧，含辅助用电） */
    roundTripEfficiency: number;
    /** 充电侧刚性加价 元/MWh：上网环节线损电价 + 系统运行费 */
    chargeAdderYuanPerMwh: number;
    /** 度电循环成本 元/MWh：电池衰减折旧 + 可变运维 */
    cycleCostYuanPerMwh: number;
    /** 度电容量折价 元/MWh（来自 R11） */
    cCapYuanPerMwh: number;
    /** 度电辅助服务折价 元/MWh（保守默认 0） */
    cAsYuanPerMwh: number;
};
export type BreakevenResult = {
    /** 要求价差 元/MWh */
    requiredSpreadYuanPerMwh: number;
    /** 要求放电价 元/MWh */
    requiredDischargePriceYuanPerMwh: number;
    /** 明细：效率损耗项 */
    efficiencyLossYuanPerMwh: number;
    /** 明细：充电加价摊入项 a/η */
    chargeAdderLoadedYuanPerMwh: number;
    cycleCostYuanPerMwh: number;
    creditYuanPerMwh: number;
};
/**
 * R3：盈亏平衡价差。放出 1 MWh 需从电网购入 1/η_RT MWh。
 *
 * ```
 * P_dis + c_cap + c_as = (P_chg + a) / η_RT + C_cyc
 * ΔP_required = P_chg × (1/η_RT − 1) + a/η_RT + C_cyc − c_cap − c_as
 * ```
 */
export declare function breakevenSpread(input: BreakevenInput): BreakevenResult;
export type ArbitrageVerdict = 'execute' | 'needs_approval' | 'skip';
export declare const ARBITRAGE_VERDICT_LABEL: Record<ArbitrageVerdict, string>;
/** 安全边际判定：实际价差 ≥ 要求价差 × 1.15 才无条件执行。 */
export declare function arbitrageVerdict(actualSpread: number, requiredSpread: number, safetyMargin?: number): {
    verdict: ArbitrageVerdict;
    safetyMultiple: number;
};
export type DispatchInput = {
    /** 决策单元价格序列（长度 = unitsPerDay），元/MWh */
    unitPrices: number[];
    /** 可用功率 MW */
    availablePowerMw: number;
    /** 可用容量 MWh */
    capacityMwh: number;
    socMin: number;
    socMax: number;
    socStart: number;
    socTarget: number;
    socTargetTolerance: number;
    /** 单向效率（充/放各一次开方自 η_RT，或分别给定） */
    chargeEfficiency: number;
    dischargeEfficiency: number;
    /** 被辅助服务锁定、不可用于能量套利的单元索引 */
    lockedUnits: number[];
    /** 日循环次数上限（公司限值，规则通常不设上限） */
    maxCyclesPerDay: number;
    breakeven: BreakevenInput;
    /** 双循环增量毛利/增量成本的门槛 */
    secondCycleRatioThreshold: number;
};
export type DispatchPair = {
    chargeUnit: number;
    dischargeUnit: number;
    chargePrice: number;
    dischargePrice: number;
    spread: number;
    requiredSpread: number;
    safetyMultiple: number;
    /** 该对的放电电量 MWh */
    dischargeMwh: number;
    /** 该对毛利 元 */
    grossMarginYuan: number;
};
export type DispatchPlan = {
    pairs: DispatchPair[];
    /** 每个决策单元的功率 MW（正=放电，负=充电，0=待机） */
    unitPowerMw: number[];
    /** 每个决策单元结束时的 SOC */
    socTrajectory: number[];
    maxChargeUnits: number;
    maxDischargeUnits: number;
    totalGrossMarginYuan: number;
    cycles: number;
    /** 无套利窗口日：一对都不成立 */
    noArbitrageWindow: boolean;
    rejectReason: string | null;
    /** 因 SOC 轨迹不可行而被回退的对数（手册 R2 步骤 8） */
    rolledBackPairs: number;
};
/**
 * R2：充放小时选择 + SOC 轨迹递推。
 *
 * 步骤严格按手册：①算 n_chg/n_dis 上限 ②价格排序 ③剔除辅助服务锁定单元
 * ④时序可行性（放电单元必须晚于其配对的充电单元，不能先放后充）⑤逐对加入并用
 * R3 校验 ⑥到上限停止 ⑦双循环判定 ⑧SOC 轨迹递推，越界回退最后一对。
 *
 * 毛利 ≤ 0 时返回「无套利窗口日」——此时只应下发维持 SOC 的最小动作计划，
 * 而不是硬凑一个循环。
 */
export declare function planDispatch(input: DispatchInput): DispatchPlan;
/**
 * 把决策单元级功率展开为执行粒度曲线（如 24 小时 → 96 点）。
 * 采用「满功率优先」原则：单元内功率恒定即可，因为单元内价格已被结算算子拉平，
 * 分配方式不影响收益，只影响设备磨损（R1 推论 2）。
 */
export declare function expandToExecutionCurve(unitPowerMw: number[], pointsPerUnit: number): number[];
export type ConstraintCheck = {
    id: string;
    label: string;
    passed: boolean;
    detail: string;
    /** true = 阻断下发；false = 仅告警 */
    blocking: boolean;
};
export type ConstraintInput = {
    plan: DispatchPlan;
    availablePowerMw: number;
    socMin: number;
    socMax: number;
    socTarget: number;
    socTargetTolerance: number;
    /** 相邻单元功率变化上限 MW */
    rampLimitMw: number;
    maxCyclesPerDay: number;
    /** 当月累计充电电量 MWh（含本计划） */
    monthlyChargeMwh: number;
    /** 月度充电限额 MWh = 额定充电功率 × 12h × 当月天数 */
    monthlyChargeQuotaMwh: number;
    /** 中长期履约率 */
    contractComplianceRatio: number;
    complianceBand: [number, number];
    /** 是否存在身份混用（储能充电与售电采购同账户同标的） */
    identityMixed: boolean;
};
/** 手册 S8 的八项约束全量校验，任一阻断项不通过即不得下发。 */
export declare function checkDispatchConstraints(input: ConstraintInput): ConstraintCheck[];
/** 是否允许下发：所有阻断项通过。 */
export declare function canDispatch(checks: ConstraintCheck[]): boolean;
