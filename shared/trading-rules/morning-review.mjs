// ============================================================================
// S1 晨会复盘（08:00–08:30）· 归因分类与收口规则
// ----------------------------------------------------------------------------
// 晨会要在 5 分钟内回答两个问题：**昨天为什么偏**、**今天怎么不重犯**。这两件事
// 都没有数据库可查——偏差事实是算出来的，主因是人判断的。本模块只管后者的规则：
// 主因该按什么维度分、什么情况下允许说「还不知道」、什么算写完了。
//
// 三条来自业务侧的约束，落成了下面的分类表：
//
// ① **按业务成因分，不按责任环节分。** 早期实现用「预测偏差 / 价格误判 / 执行问题 /
//    数据问题」——那是复盘会追责的维度，不是次日能改的维度。交易员早上要拿走的是
//    「今天盯哪个量」，所以分类必须落到**可观测的物理量**上：负荷、新能源、通道、价格。
//    知道「昨天是新能源大发压价」，今天就去盯新能源预测；知道「是执行问题」，今天
//    盯什么？没有下一步动作的分类，写了也是死字段。
//
// ② **「待分析」是一等公民，不是兜底。** 手册的异常处理明确要求：归因无法判定时标记
//    待分析、留晨会人工讨论。把它做成「必须选一个真实主因」的强制项，只会逼出一个
//    随手选的假归因——比留空更坏，因为它看起来是结论。故 `pending` 与其余分类同级，
//    且**照样要求写今日要点**：归因没定，不代表今天没有该盯的事。
//
// ③ **窗口只提示、不硬拦。** 08:00–08:30 是作业规范（公司内控），不是市场规则。越窗
//    作业该被看见，但不该被阻断——昨天的复盘 09:00 补写仍然有价值，拦下来只会让人
//    跳过 S1 直接开工。硬约束只留给市场规则本身（见 release-checklist 的分档定义）。
// ============================================================================

/**
 * @typedef {'load'|'renewable'|'corridor'|'price'|'none'|'pending'} DeviationCauseId
 */

/**
 * @typedef {Object} DeviationCause
 * @property {DeviationCauseId} id 存储值。**存 id 不存中文**，改标签不动历史数据
 * @property {string} label 展示名
 * @property {string} hint 什么情况选它——给交易员看的判据，不是给开发看的注释
 * @property {string} nextAction 选了它，今天该盯什么。分类的价值全在这一列
 */

/**
 * 偏差主因分类表。
 *
 * 前四项是业务成因（可观测物理量），后两项是结论态：`none` = 已判定无明显偏差，
 * `pending` = 尚未判定。两者**不可混用**——「无明显偏差」是结论，「待分析」是欠条。
 *
 * @type {readonly DeviationCause[]}
 */
export const DEVIATION_CAUSES = Object.freeze([
  Object.freeze({
    id: 'load',
    label: '负荷',
    hint: '实际用电与负荷预测偏离，且偏离时段与偏差时段重合',
    nextAction: '今日盯负荷预测，重点核对昨日偏离时段的同时刻预测值'
  }),
  Object.freeze({
    id: 'renewable',
    label: '新能源',
    hint: '风光实际出力与预测偏离（大发压价或骤减拉价）',
    nextAction: '今日盯新能源出力预测与气象更新，关注同类天气型日的历史偏差'
  }),
  Object.freeze({
    id: 'corridor',
    label: '通道',
    hint: '省间外送/联络线计划变更、通道受阻或检修，改变了省内供需边界',
    nextAction: '今日核对外送计划与检修安排，通道有变即重算供需比'
  }),
  Object.freeze({
    id: 'price',
    label: '价格',
    hint: '基本面判断无误，但对价格水平或时段形态判断错了（报价策略问题）',
    nextAction: '今日复核价格中枢与报价曲线形态，对齐昨日实际出清价的时段分布'
  }),
  Object.freeze({
    id: 'none',
    label: '无明显偏差',
    hint: '偏差在正常波动带内，无需归因',
    nextAction: '维持既有策略，关注是否有新的边界条件变化'
  }),
  Object.freeze({
    id: 'pending',
    label: '待分析',
    hint: '证据不足以判定主因（如出清或实际数据缺失、多因素叠加难以分离）',
    nextAction: '晨会人工讨论；补齐缺失数据后回填主因'
  })
])

/** @type {Record<DeviationCauseId, string>} */
export const CAUSE_LABEL = Object.freeze(
  Object.fromEntries(DEVIATION_CAUSES.map((c) => [c.id, c.label]))
)

/** 可选主因 id 全集。 */
export const CAUSE_IDS = Object.freeze(DEVIATION_CAUSES.map((c) => c.id))

/**
 * 判断某个存储值是不是合法主因 id。
 * @param {unknown} value
 * @returns {value is DeviationCauseId}
 */
export function isCauseId(value) {
  return typeof value === 'string' && CAUSE_IDS.includes(/** @type {DeviationCauseId} */ (value))
}

/**
 * 按中文标签反查 id——**只给 AI 辅助填报的返回值用**。
 *
 * AI 返回的是人话标签（提示词里给的就是中文），落库前必须映射回 id；映射不中就丢弃，
 * 不猜、不做模糊匹配：宁可让交易员自己选，也不能把一个猜出来的主因写进单据留痕。
 *
 * @param {unknown} label
 * @returns {DeviationCauseId | null}
 */
export function causeIdOfLabel(label) {
  if (typeof label !== 'string') return null
  const hit = DEVIATION_CAUSES.find((c) => c.label === label.trim())
  return hit ? hit.id : null
}

/**
 * 展示用：把存储值渲染成人话。
 *
 * **命中不了的值原样返回**，不显示「未知」。历史单据里存的是改版前的中文主因
 * （「预测偏差」等），把它显示成「未知」等于抹掉了当时真实写下的判断。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function causeLabelOf(value) {
  if (typeof value !== 'string' || !value) return '—'
  return CAUSE_LABEL[/** @type {DeviationCauseId} */ (value)] ?? value
}

/** 归因是否尚未判定（决定单据上要不要挂「待晨会讨论」标记）。 */
export function isPendingCause(value) {
  return value === 'pending'
}

/** 今日要点的最短长度。低于此长度的多半是「无」「正常」这类占位。 */
export const LESSONS_MIN_LENGTH = 4

/**
 * @typedef {Object} MorningReviewDraft
 * @property {unknown} cause
 * @property {unknown} lessons
 */

/**
 * @typedef {Object} MorningReviewValidation
 * @property {boolean} ok
 * @property {string[]} errors 人话错误信息，可直接上屏
 */

/**
 * 复盘结论能否写回。
 *
 * 注意 `pending` **同样要求写今日要点**：主因待查不等于今天没有该盯的事，缺了要点
 * 这条复盘对次日作业就是零输出。
 *
 * @param {MorningReviewDraft} draft
 * @returns {MorningReviewValidation}
 */
export function validateMorningReview(draft) {
  const errors = []
  if (!isCauseId(draft?.cause)) errors.push('请选择偏差主因（判不了就选「待分析」）')
  const lessons = typeof draft?.lessons === 'string' ? draft.lessons.trim() : ''
  if (lessons.length < LESSONS_MIN_LENGTH) {
    errors.push(`今日不重犯要点至少 ${LESSONS_MIN_LENGTH} 字，要具体到今天盯哪个量`)
  }
  return { ok: errors.length === 0, errors }
}

// ── 作业窗口 ────────────────────────────────────────────────────────────────

/** 晨会复盘的作业窗口（公司内控规范，非市场规则）。 */
export const MORNING_WINDOW = Object.freeze({ startMinute: 8 * 60, endMinute: 8 * 60 + 30 })

/**
 * @typedef {'before'|'within'|'after'} MorningWindowState
 */

/**
 * 当前时刻相对作业窗口的位置。
 *
 * 取时间的动作留给调用方（纯函数便于测试，也避免规则层持有时区假设）。
 *
 * @param {number} minuteOfDay 0–1439
 * @returns {MorningWindowState}
 */
export function morningWindowState(minuteOfDay) {
  if (minuteOfDay < MORNING_WINDOW.startMinute) return 'before'
  if (minuteOfDay > MORNING_WINDOW.endMinute) return 'after'
  return 'within'
}

/** @type {Record<MorningWindowState, string>} */
export const MORNING_WINDOW_NOTE = Object.freeze({
  before: '晨会复盘窗口 08:00–08:30 尚未开始，可提前准备',
  within: '正在晨会复盘窗口内（08:00–08:30），目标 5 分钟内完成',
  after: '已过晨会复盘窗口（08:00–08:30）——补写仍然留痕，但今日要点对当日作业的价值已打折'
})
