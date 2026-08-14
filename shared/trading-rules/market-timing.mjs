// ============================================================================
// 地区市场时序（省域规则包 timing + granularity 段）
// ----------------------------------------------------------------------------
// 放在 shared/ 而非 src/：申报动线的死线判定、决策单元推导既要在前端展示，也要在
// 服务端把关（`server/spot-declarations-api.mjs` 的风控检查）。放前端就注定服务端
// 要么够不着、要么重写一份，两份口径迟早漂移。
//
// 诚实性纪律：**没有权威规则依据的地区一律不登记**，而不是抄一份邻省的时刻表。
// 未登记地区在界面上表现为「时序未登记」、不给死线倒计时——一个错的申报截止时刻
// 比没有时刻更危险，交易员会照着它排班。
// ============================================================================

/**
 * @typedef {'none'|'arithmetic_mean'|'weighted_mean'} SettlementAggregator
 * 结算价聚合算子：出清粒度 → 结算粒度的折算方式。各省结构性不同，不是数值不同。
 */

/**
 * @typedef {Object} MarketTimingProfile
 * @property {string} regionId
 * @property {string} bidDeadline D-1 日前申报截止（北京时间 HH:mm），全天最硬的死线
 * @property {[string,string,string]} bidReminders 三级提醒时刻（蓝/黄/红）
 * @property {string|null} preClearingAt 日前预出清发布；null = 无此环节
 * @property {string} finalClearingAt 日前正式出清发布（当日损益第一次锁定）
 * @property {string} boundaryPublishAt D-2 运行日边界条件发布
 * @property {string|null} storagePlanDispatchAt 储能次日计划下发死线
 * @property {string|null} storageAckAt 场站回执死线
 * @property {string} dailySettlementAt D+1 日清算临时结果发布
 * @property {number} daClearingIntervalMin 日前出清粒度（分钟）
 * @property {number} rtClearingIntervalMin 实时出清粒度（分钟），与结算粒度必须分开
 * @property {number} settlementIntervalMin 结算粒度（分钟）
 * @property {SettlementAggregator} settlementAggregator 结算价聚合算子
 * @property {string} source 规则依据（原文名称），用于界面可追溯与月度参数复核
 * @property {boolean} verify true = 参数待复核（对应手册附录C，进 T11 参数复核台账）
 */

/**
 * 已登记地区的市场时序。
 *
 * - `xinjiang`：依据《新疆电力现货市场调电试运行工作方案》（2024）与《新疆电力
 *   中长期市场实施细则》（2026-04-01 施行）。**本仓无新疆市场数据**，此处登记的是
 *   规则参数（来自公开规则原文，属真实），与「有没有新疆的价格/负荷数据」是两件事。
 * - `shanxi`：依据七省规则对比调研。山西日前有 8:00 / 9:30 两个申报节点，此处取
 *   最终截止 9:30；实时出清 5 分钟是山西独有，正是「出清粒度 ≠ 结算粒度」的实证。
 *
 * 云南（本仓 UI 默认地区）**刻意不登记**：其现货时序无权威依据在手。
 *
 * @type {Record<string, MarketTimingProfile>}
 */
export const MARKET_TIMING = {
  xinjiang: {
    regionId: 'xinjiang',
    bidDeadline: '08:45',
    bidReminders: ['08:30', '08:40', '08:43'],
    preClearingAt: '11:00',
    finalClearingAt: '18:00',
    boundaryPublishAt: '18:00',
    storagePlanDispatchAt: '19:10',
    storageAckAt: '19:30',
    dailySettlementAt: '09:00',
    daClearingIntervalMin: 15,
    rtClearingIntervalMin: 15,
    settlementIntervalMin: 60,
    settlementAggregator: 'arithmetic_mean',
    source: '新疆电力现货市场调电试运行工作方案（2024）+ 中长期实施细则（2026-04-01）',
    verify: true
  },
  shanxi: {
    regionId: 'shanxi',
    bidDeadline: '09:30',
    bidReminders: ['09:00', '09:20', '09:27'],
    preClearingAt: null,
    finalClearingAt: '18:00',
    boundaryPublishAt: '18:00',
    storagePlanDispatchAt: null,
    storageAckAt: null,
    dailySettlementAt: '09:00',
    daClearingIntervalMin: 15,
    rtClearingIntervalMin: 5,
    settlementIntervalMin: 15,
    settlementAggregator: 'none',
    source: '七省现货规则对比调研（2025–2026），待以山西现行细则原文复核',
    verify: true
  }
}

/**
 * 取地区市场时序；未登记地区返回 null（调用方须走「时序未登记」空态，不得回落他省）。
 * @param {string} regionId
 * @returns {MarketTimingProfile|null}
 */
export function getMarketTiming(regionId) {
  return MARKET_TIMING[regionId] ?? null
}

/**
 * 把 HH:mm 解析为「当天该时刻」的 Date。
 * @param {string} hhmm
 * @param {Date} base
 * @returns {Date}
 */
export function timeToDate(hhmm, base) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

/**
 * 距某时刻还有多少分钟（已过则为负）。
 * @param {string} hhmm
 * @param {Date} now
 * @returns {number}
 */
export function minutesUntil(hhmm, now) {
  return Math.round((timeToDate(hhmm, now).getTime() - now.getTime()) / 60000)
}

/** @typedef {'passed'|'critical'|'warning'|'notice'|'normal'} DeadlineUrgency */

/**
 * 按三级提醒时刻判定申报死线紧迫度。
 * 提醒时刻来自规则包，不在此写死——换省只换数据，判级逻辑不动。
 * @param {MarketTimingProfile} timing
 * @param {Date} now
 * @returns {DeadlineUrgency}
 */
export function bidDeadlineUrgency(timing, now) {
  if (minutesUntil(timing.bidDeadline, now) < 0) return 'passed'
  const [blue, yellow, red] = timing.bidReminders
  if (minutesUntil(red, now) <= 0) return 'critical'
  if (minutesUntil(yellow, now) <= 0) return 'warning'
  if (minutesUntil(blue, now) <= 0) return 'notice'
  return 'normal'
}

/**
 * 结算粒度说明文案：储能决策单元是否被拉平到小时，直接由聚合算子决定。
 * @param {MarketTimingProfile} timing
 * @returns {string}
 */
export function settlementUnitHint(timing) {
  if (timing.settlementAggregator === 'none') {
    return `${timing.settlementIntervalMin} 分钟直接结算，套利决策单元 = ${timing.settlementIntervalMin} 分钟`
  }
  const points = timing.settlementIntervalMin / timing.daClearingIntervalMin
  const op = timing.settlementAggregator === 'arithmetic_mean' ? '算术平均' : '加权平均'
  return `${timing.settlementIntervalMin} 分钟结算（${points} 个 ${timing.daClearingIntervalMin} 分钟点${op}），套利决策单元 = 小时，小时内充放切换无价差收益`
}
