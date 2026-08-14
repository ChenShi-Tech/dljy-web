/** D+N 交易时间口径（作业日视角）：今天做的是 D+几的交易、看到的出清是 D-几的。 */
export type TradingCalendarProfile = {
    regionId: string;
    /** 作业日(今天=0)可申报现货的标的日偏移，升序。新疆可报 D+1/D+2，传统日前省只有 D+1。 */
    spotBidTargets: number[];
    /** 今天**主要**在做的现货标的日偏移。新疆会议口径「今天做的是后天」→ 2；传统 D-1 窗口省 → 1。 */
    primarySpotTarget: number;
    /** 中长期撮合申报的标的日偏移；null = 无权威依据不登记。 */
    mltMatchingTarget: number | null;
    /**
     * 今天能看到的最新已出清运行日偏移（负数=过去）；null = 不登记（如山西出清发布在
     * 标的日前夜，随钟点变化，不宜用单一偏移表达）。
     */
    latestClearedOffset: number | null;
    /** 日前出清 = 实时锁定不可调（口径事实，非时刻）。 */
    dayAheadLocked: boolean;
    /** 口径依据（原文名称/会议纪要），用于界面可追溯与参数复核。 */
    source: string;
    /** true = 待复核（进 T11 参数复核台账）。 */
    verify: boolean;
};
/** 已登记地区的 D+N 口径。云南（UI 默认地区）刻意不登记：无权威依据在手。 */
export declare const TRADING_CALENDAR: Record<string, TradingCalendarProfile>;
/** 取地区 D+N 口径；未登记返回 null（调用方走「口径未登记」空态，不得回落他省）。 */
export declare function getTradingCalendar(regionId: string): TradingCalendarProfile | null;
/** ISO 日期（YYYY-MM-DD）平移 N 天（UTC 正午锚定，避开本地时区午夜切换）。 */
export declare function shiftIsoDate(iso: string, days: number): string;
export type OffsetDay = {
    offset: number;
    date: string;
};
/** 按口径把「作业日」翻译成结构化视图：今天主要做哪天、可报哪几天、撮合报哪天、能看到哪天的出清。 */
export declare function workdayView(calendar: TradingCalendarProfile, todayIso: string): {
    today: string;
    primarySpot: OffsetDay;
    spotTargets: OffsetDay[];
    mltMatching: OffsetDay | null;
    latestCleared: OffsetDay | null;
};
/**
 * 作业台默认标的日：已登记地区取 primarySpotTarget（新疆 D+2、山西 D+1），
 * 未登记返回 null——调用方须显式呈现「口径未登记」，不得悄悄默认明日。
 */
export declare function defaultTargetDate(regionId: string, todayIso: string): string | null;
/** 口径一句话摘要（页头徽章用）：今天做什么 / 看到什么 / 撮合报哪天。 */
export declare function workdaySummary(calendar: TradingCalendarProfile, todayIso: string): string;
