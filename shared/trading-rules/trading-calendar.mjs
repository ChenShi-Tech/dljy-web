// ============================================================================
// D+N 交易时间口径（作业日视角的「今天做什么、今天看到什么」）
// ----------------------------------------------------------------------------
// 与 market-timing.mjs 的分工（2026-08-13 需求会议 §3.4 拍板建此层）：
//   - market-timing 管**时刻**（几点截止、几点出清、几点结算）；
//   - trading-calendar 管**偏移与语义**（今天做的是 D+几的交易、看到的出清是
//     D-几的、中长期撮合报 D+几、日前是否锁定不可调）。
// 两层合起来回答「今天做什么、出的是什么」。此前口径散落在页面各自的 D-1/D+1
// 假设里（如作业台默认标的日写死明日），换地区不换假设就是错口径。
//
// 诚实性纪律与 market-timing 同源：**没有权威依据的地区不登记**（云南刻意不登记，
// 界面走「口径未登记」空态并要求人工确认标的日，不默认抄邻省）。已登记条目全部
// 带 source 与 verify 标记，进 T11 参数复核台账。
//
// 与现有「D-1 现货申报窗口」的关系按会议待确认的**并存**处理：现货申报窗口时刻
// 仍以 marketTiming 为准（山西等传统省今天报 D+1），中长期撮合按 D+2——两轨并存，
// 不互斥切换。
// ============================================================================

/**
 * @typedef {Object} TradingCalendarProfile
 * @property {string} regionId
 * @property {number[]} spotBidTargets 作业日(今天=0)可申报现货的标的日偏移，升序。
 *   会议口径：现货可报 D+1/D+2（新疆）；传统日前省只有 D+1（山西）。
 * @property {number} primarySpotTarget 今天**主要**在做的现货标的日偏移。
 *   新疆会议口径「今天做的是后天(D+2)的交易」→ 2；传统 D-1 窗口省 → 1。
 * @property {number|null} mltMatchingTarget 中长期撮合申报的标的日偏移；null = 无权威依据不登记
 * @property {number|null} latestClearedOffset 今天能看到的最新已出清运行日偏移（负数=过去）；
 *   null = 不登记（如山西出清发布在标的日前夜，随钟点变化，不宜用单一偏移表达）
 * @property {boolean} dayAheadLocked 日前出清 = 实时锁定不可调（口径事实，非时刻）
 * @property {string} source 口径依据，界面可追溯
 * @property {boolean} verify true = 待复核（进 T11 参数复核台账）
 */

/**
 * 已登记地区的 D+N 口径。
 *
 * - `xinjiang`：全部来自 2026-08-13 梁乃峰需求会议 §3.4 的原话——今天做的是后天(D+2)
 *   的交易、出清出的是三天前的(D-3)、现货可报 D+1/D+2、中长期撮合报 D+2、日前实时
 *   锁定不可调。新疆凌晨出清的**作息差异**由 marketTiming 的时刻字段承载，本层只管偏移。
 * - `shanxi`：传统日前口径（申报发生在标的日前一作业日），今天报 D+1；与
 *   marketTiming.shanxi.bidDeadline 的「D-1 日前申报截止」标注一致。中长期撮合与
 *   最新可见出清偏移无权威依据，不登记。
 *
 * @type {Record<string, TradingCalendarProfile>}
 */
export const TRADING_CALENDAR = {
  xinjiang: {
    regionId: 'xinjiang',
    spotBidTargets: [1, 2],
    primarySpotTarget: 2,
    mltMatchingTarget: 2,
    latestClearedOffset: -3,
    dayAheadLocked: true,
    source: '2026-08-13 梁乃峰需求会议 §3.4（今天做 D+2、出清看 D-3、现货可报 D+1/D+2、中长期撮合 D+2）',
    verify: true
  },
  shanxi: {
    regionId: 'shanxi',
    spotBidTargets: [1],
    primarySpotTarget: 1,
    mltMatchingTarget: null,
    latestClearedOffset: null,
    dayAheadLocked: true,
    source: '传统日前口径：申报发生在标的日前一作业日（与 marketTiming.shanxi 的 D-1 标注一致）',
    verify: true
  }
}

/**
 * 取地区 D+N 口径；未登记返回 null（调用方走「口径未登记」空态，不得回落他省）。
 * @param {string} regionId
 * @returns {TradingCalendarProfile|null}
 */
export function getTradingCalendar(regionId) {
  return TRADING_CALENDAR[regionId] ?? null
}

/**
 * ISO 日期（YYYY-MM-DD）平移 N 天。用 UTC 正午锚定做日算术，避免本地时区的
 * 午夜切换把日期掰弯；输出仍是 YYYY-MM-DD。
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function shiftIsoDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d, 12, 0, 0)
  return new Date(base + days * 86400000).toISOString().slice(0, 10)
}

/** @typedef {{offset:number, date:string}} OffsetDay */

/**
 * 按口径把「作业日」翻译成结构化视图：今天主要做哪天、可报哪几天、撮合报哪天、
 * 能看到哪天的出清。供 S1–S7 各步判定「今天做什么、出的是什么」。
 * @param {TradingCalendarProfile} calendar
 * @param {string} todayIso 作业日（YYYY-MM-DD）
 * @returns {{
 *   today: string,
 *   primarySpot: OffsetDay,
 *   spotTargets: OffsetDay[],
 *   mltMatching: OffsetDay|null,
 *   latestCleared: OffsetDay|null
 * }}
 */
export function workdayView(calendar, todayIso) {
  return {
    today: todayIso,
    primarySpot: { offset: calendar.primarySpotTarget, date: shiftIsoDate(todayIso, calendar.primarySpotTarget) },
    spotTargets: calendar.spotBidTargets.map((o) => ({ offset: o, date: shiftIsoDate(todayIso, o) })),
    mltMatching:
      calendar.mltMatchingTarget === null
        ? null
        : { offset: calendar.mltMatchingTarget, date: shiftIsoDate(todayIso, calendar.mltMatchingTarget) },
    latestCleared:
      calendar.latestClearedOffset === null
        ? null
        : { offset: calendar.latestClearedOffset, date: shiftIsoDate(todayIso, calendar.latestClearedOffset) }
  }
}

/**
 * 作业台默认标的日：已登记地区取 primarySpotTarget（新疆 D+2、山西 D+1），
 * 未登记返回 null——调用方须显式呈现「口径未登记」，不得悄悄默认明日。
 * @param {string} regionId
 * @param {string} todayIso
 * @returns {string|null}
 */
export function defaultTargetDate(regionId, todayIso) {
  const calendar = getTradingCalendar(regionId)
  if (!calendar) return null
  return shiftIsoDate(todayIso, calendar.primarySpotTarget)
}

/**
 * 口径一句话摘要（页头徽章用）：今天做什么 / 看到什么 / 撮合报哪天。
 * @param {TradingCalendarProfile} calendar
 * @param {string} todayIso
 * @returns {string}
 */
export function workdaySummary(calendar, todayIso) {
  const v = workdayView(calendar, todayIso)
  const parts = [`今天做 D+${calendar.primarySpotTarget}（${v.primarySpot.date}）的现货交易`]
  if (calendar.spotBidTargets.length > 1) {
    parts.push(`现货可报 ${calendar.spotBidTargets.map((o) => `D+${o}`).join('/')}`)
  }
  if (v.mltMatching) parts.push(`中长期撮合报 D+${calendar.mltMatchingTarget}（${v.mltMatching.date}）`)
  if (v.latestCleared) {
    parts.push(`今日可见出清为 D${calendar.latestClearedOffset}（${v.latestCleared.date}）`)
  }
  if (calendar.dayAheadLocked) parts.push('日前出清即锁定不可调')
  return parts.join(' · ')
}
