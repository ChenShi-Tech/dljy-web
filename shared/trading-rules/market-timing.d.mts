/** 结算价聚合算子：出清粒度 → 结算粒度的折算方式。各省结构性不同，不是数值不同。 */
export type SettlementAggregator = 'none' | 'arithmetic_mean' | 'weighted_mean';
export type MarketTimingProfile = {
    regionId: string;
    /** D-1 日前申报截止（北京时间 HH:mm）。全天最硬的死线。 */
    bidDeadline: string;
    /** 申报三级提醒时刻（蓝/黄/红）。红色时刻起进入应急通道。 */
    bidReminders: [string, string, string];
    /** D-1 日前预出清发布；null = 该省无预出清环节 */
    preClearingAt: string | null;
    /** D-1 日前正式出清发布（当日损益第一次锁定） */
    finalClearingAt: string;
    /** D-2 运行日边界条件发布（夜间情景预演的触发点） */
    boundaryPublishAt: string;
    /** 储能次日计划下发死线；null = 未登记或无此环节 */
    storagePlanDispatchAt: string | null;
    /** 场站回执死线；null = 同上 */
    storageAckAt: string | null;
    /** D+1 日清算临时结果发布（发现结算问题的最早窗口） */
    dailySettlementAt: string;
    /** 日前出清粒度（分钟） */
    daClearingIntervalMin: number;
    /** 实时出清粒度（分钟）。与结算粒度**必须分开**：山西 5 分钟出清、15 分钟结算。 */
    rtClearingIntervalMin: number;
    /** 结算粒度（分钟）。新疆/广东 60，山西/山东/甘肃 15。 */
    settlementIntervalMin: number;
    /**
     * 结算价聚合算子。新疆/广东 = 小时内 4 个 15 分钟节点电价算术平均；
     * 南方区域 = 加权平均（不同算子）；晋鲁甘 = 15 分钟直用。
     * 储能套利的决策单元由此决定：算术平均 ⇒ 小时内充放切换收益恒为 0。
     */
    settlementAggregator: SettlementAggregator;
    /** 规则依据（原文名称），用于界面可追溯与月度参数复核 */
    source: string;
    /** true = 参数待复核（对应手册附录C，进 T11 参数复核台账） */
    verify: boolean;
};
/**
 * 已登记地区的市场时序。
 *
 * - `xinjiang`：依据《新疆电力现货市场调电试运行工作方案》（2024）与《新疆电力
 *   中长期市场实施细则》（2026-04-01 施行）。**本仓无新疆市场数据**，此处登记的是
 *   规则参数（来自公开规则原文，属真实），与「有没有新疆的价格/负荷数据」是两件事。
 * - `shanxi`：依据七省规则对比调研。山西日前有 8:00 / 9:30 两个申报节点，此处取
 *   最终截止 9:30；实时出清 5 分钟是山西独有，正是「出清粒度 ≠ 结算粒度」的实证。
 *
 * 云南（本仓 UI 默认地区）**刻意不登记**：其现货时序无权威依据在手，编一份等于
 * 给交易员一个假死线。云南在交易台上走「时序未登记」空态。
 */
export declare const MARKET_TIMING: Record<string, MarketTimingProfile>;
/** 取地区市场时序；未登记地区返回 null（调用方须走「时序未登记」空态，不得回落他省）。 */
export declare function getMarketTiming(regionId: string): MarketTimingProfile | null;
/** 把 HH:mm 解析为「当天该时刻」的 Date；用于倒计时计算。 */
export declare function timeToDate(hhmm: string, base: Date): Date;
/** 距某时刻还有多少分钟（已过则为负）。 */
export declare function minutesUntil(hhmm: string, now: Date): number;
export type DeadlineUrgency = 'passed' | 'critical' | 'warning' | 'notice' | 'normal';
/**
 * 按三级提醒时刻判定申报死线紧迫度。
 * 提醒时刻来自 rulepack，不在此写死——换省只换数据，判级逻辑不动。
 */
export declare function bidDeadlineUrgency(timing: MarketTimingProfile, now: Date): DeadlineUrgency;
/** 结算粒度说明文案：储能决策单元是否被拉平到小时，直接由聚合算子决定。 */
export declare function settlementUnitHint(timing: MarketTimingProfile): string;
