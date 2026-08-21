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

// ── 责任归属四分类（配套模板七）──────────────────────────────────────────────
//
// 与上面的 DEVIATION_CAUSES 是**两个维度**，不是两套重复分类：
//   · DEVIATION_CAUSES 回答「偏差为什么发生」——可观测的物理量，决定今天盯什么；
//   · DEVIATION_RESPONSIBILITY 回答「偏差谁该负责」——复盘会追责与改进分工的口径
//     （配套模板七《偏差归因分析报告》的行类别）。写回时两者都填（需求文档 §三 3.2）。

/**
 * @typedef {'forecast'|'emergency'|'strategy'|'operation'} DeviationResponsibilityId
 */

/**
 * @typedef {Object} DeviationResponsibility
 * @property {DeviationResponsibilityId} id 存储值，存 id 不存中文
 * @property {string} label 展示名（对齐模板七行名）
 * @property {string} hint 什么情况选它
 */

/**
 * 偏差责任归属分类表（模板七：预测不准/突发情况/策略失误/操作失误）。
 *
 * `cause='none'`（无明显偏差）时无责可归，允许不填；其余主因要求填写。
 *
 * @type {readonly DeviationResponsibility[]}
 */
export const DEVIATION_RESPONSIBILITY = Object.freeze([
  Object.freeze({
    id: 'forecast',
    label: '预测不准',
    hint: '负荷/新能源/价格预测误差导致申报偏离实际'
  }),
  Object.freeze({
    id: 'emergency',
    label: '突发情况',
    hint: '设备故障、电网事件、天气突变等不可预见因素'
  }),
  Object.freeze({
    id: 'strategy',
    label: '策略失误',
    hint: '申报策略选择错误（方向/价位/形态判断失误）'
  }),
  Object.freeze({
    id: 'operation',
    label: '操作失误',
    hint: '人工填报或操作错误（量价录错、漏报、时限错过）'
  })
])

/** @type {Record<DeviationResponsibilityId, string>} */
export const RESPONSIBILITY_LABEL = Object.freeze(
  Object.fromEntries(DEVIATION_RESPONSIBILITY.map((r) => [r.id, r.label]))
)

/** 可选责任归属 id 全集。 */
export const RESPONSIBILITY_IDS = Object.freeze(DEVIATION_RESPONSIBILITY.map((r) => r.id))

/**
 * 判断某个存储值是不是合法责任归属 id。
 * @param {unknown} value
 * @returns {value is DeviationResponsibilityId}
 */
export function isResponsibilityId(value) {
  return (
    typeof value === 'string' &&
    RESPONSIBILITY_IDS.includes(/** @type {DeviationResponsibilityId} */ (value))
  )
}

/**
 * 展示用：把责任归属存储值渲染成人话。命中不了原样返回（与 causeLabelOf 同一纪律）。
 * @param {unknown} value
 * @returns {string}
 */
export function responsibilityLabelOf(value) {
  if (typeof value !== 'string' || !value) return '—'
  return RESPONSIBILITY_LABEL[/** @type {DeviationResponsibilityId} */ (value)] ?? value
}

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

// ── 峰平谷聚合（需求 3 · 第二层「分时段」，对齐模板二/模板八的分时段口径）────────

/**
 * @typedef {Object} TimeSegmentDef
 * @property {string} segment 段名（如「高峰」「平段」「低谷」）
 * @property {number[]} hours 属于该段的整点小时（0–23；来源：地区规则包 timeSegmentFactors）
 * @property {number} factor 系数（峰平谷拆分只用 hours，factor 仅为对齐规则包结构）
 */

/**
 * @typedef {Object} PeakFlatValleyResult
 * @property {string} segment 段名
 * @property {number} slots 该段覆盖的 96 点时段数
 * @property {number} totalMwh 该段电量合计（MWh）
 * @property {number|null} sharePct 该段电量占比（%）；总量为 0 时 null（不用 0 冒充）
 */

/**
 * 把 96 点序列按峰平谷时段定义聚合（需求 3 第二层）。
 *
 * 时段定义由调用方从**地区规则包**传入（如 src/rules/provinces/yunnan/settlement.ts
 * 的 timeSegmentFactors）——峰平谷时段各省不同，规则层不硬编码。15 分钟点归属按
 * 该点起始整点判断（点 i 属于小时 floor(i/4)）。未覆盖任何段的小时（定义残缺）
 * 计入「未定义段」行，不静默丢弃。
 *
 * @param {readonly number[] | null | undefined} curve96 96 点电量序列（MWh/点）
 * @param {readonly TimeSegmentDef[]} segments 峰平谷时段定义
 * @returns {PeakFlatValleyResult[]}
 */
export function aggregatePeakFlatValley(curve96, segments) {
  if (!Array.isArray(curve96) || curve96.length === 0) return []
  // 预排序段名，输出稳定（不依赖传入顺序）
  const defs = [...segments].sort((a, b) => a.segment.localeCompare(b.segment, 'zh-Hans'))
  const acc = new Map(defs.map((d) => [d.segment, { segment: d.segment, slots: 0, totalMwh: 0 }]))
  const undefinedRow = { segment: '未定义段', slots: 0, totalMwh: 0 }
  const hourToSegment = new Map()
  for (const d of defs) {
    for (const h of d.hours) {
      if (Number.isInteger(h) && h >= 0 && h <= 23) hourToSegment.set(h, d.segment)
    }
  }
  let defined = false
  curve96.forEach((v, i) => {
    const hour = Math.floor(i / 4)
    const seg = hourToSegment.get(hour)
    const value = Number.isFinite(v) ? v : 0
    if (seg) {
      defined = true
      const row = acc.get(seg)
      row.slots += 1
      row.totalMwh += value
    } else {
      undefinedRow.slots += 1
      undefinedRow.totalMwh += value
    }
  })
  const grand = [...acc.values()].reduce((s, r) => s + r.totalMwh, 0) + undefinedRow.totalMwh
  const withShare = (r) => ({
    ...r,
    totalMwh: Number(r.totalMwh.toFixed(4)),
    sharePct: grand > 0 ? Number(((r.totalMwh / grand) * 100).toFixed(1)) : null
  })
  const rows = [...acc.values()].map(withShare)
  if (undefinedRow.slots > 0 && defined) rows.push(withShare(undefinedRow))
  return rows
}

/**
 * 复盘结论能否写回。
 *
 * 注意 `pending` **同样要求写今日要点**：主因待查不等于今天没有该盯的事，缺了要点
 * 这条复盘对次日作业就是零输出。
 *
 * 责任归属（需求 1）：主因非 `none` 时必填——「偏差为什么发生」与「偏差谁该负责」
 * 两问都要有答案才能写回；`none` 无责可归，允许不填。
 *
 * @param {MorningReviewDraft & { responsibility?: unknown }} draft
 * @returns {MorningReviewValidation}
 */
export function validateMorningReview(draft) {
  const errors = []
  if (!isCauseId(draft?.cause)) errors.push('请选择偏差主因（判不了就选「待分析」）')
  // 责任归属（需求 1）：主因已判定（非 none/pending）时必填——「偏差为什么发生」与
  // 「偏差谁该负责」两问都要有答案。none 无责可归；pending 主因未定，责任归属同样
  // 未定（同为欠条，晨会补定后一起回填）——强填只会逼出随手选的假归因。
  if (isCauseId(draft?.cause) && draft.cause !== 'none' && draft.cause !== 'pending') {
    if (draft?.responsibility == null) {
      errors.push('请选择责任归属（偏差谁该负责；主因「待分析」时随晨会讨论一并回填）')
    } else if (!isResponsibilityId(draft.responsibility)) {
      errors.push('责任归属不合法（预测不准/突发情况/策略失误/操作失误）')
    }
  }
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
