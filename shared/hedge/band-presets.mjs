// 预置套保区间方案（openspec build-midlong-spot-hedging，HB-01，附录 E/F）。
//
// 只读数据，随代码发布。无强制下限：国家和云南对新能源的中长期签约比例都没有强制下限
// （136 号文 [F1]、云南 720 号方案 [F2] 都写明「可以适当降低中长期签约比例」），
// 因此本表所有数值的效力都是 INFERENCE（推断），页面必须标注「推断，仅供参考」，
// MUST NOT 被表述为政策要求。三个方案一律按「含机制」判级：机制电量与中长期合同的
// 锁价效果可以叠加 [F2]。采用预置方案时，服务端写入版本快照，之后改这里不影响历史判级（HB-04）。
//
// 出处编号见 design 附录 F；完整调研报告不入仓。

/** 数值效力：POLICY_MANDATORY 政策强制 / INDUSTRY_PRACTICE 行业实践 / INFERENCE 推断。 */
export const BAND_VALUE_ORIGINS = Object.freeze(['POLICY_MANDATORY', 'INDUSTRY_PRACTICE', 'INFERENCE'])

/** 推斂数值的固定标注（HB-01）。 */
export const INFERENCE_NOTE = '推断，仅供参考'

const SOURCES = Object.freeze({
  F1: '发改价格〔2025〕136 号（新能源入市改革）',
  F2: '云发改价格〔2025〕720 号（云南实施方案，全文已核）',
  F6: '发改运行〔2022〕1861 号（年度保底、滚动补足，全文已核）',
  F7: '2026 年中长期签约履约通知要点（用户侧 80% 目标仅作参照）',
  F10: 'Norton Rose Fulbright：Physical fixed-volume hedges（不满签 P50/P99，全文已核）',
  F11: 'Renewabl：PPA risk management（小时匹配率即有效对冲率）',
  F15: '中国能源新闻网：零负电价诱因剖析（欠保在负价时段的代价，全文已核）',
})

/** 每行数值都带 origin（效力）与 sources（出处编号）；出处文本由 bandSourceOf 提供。 */
function tier(lower, upper, note) {
  return Object.freeze({
    lower,
    upper,
    origin: 'INFERENCE',
    sources: note.sources,
    note: note.text,
  })
}

export const BAND_PRESETS = Object.freeze([
  Object.freeze({
    key: 'CONSERVATIVE',
    label: '保守',
    basis: 'WITH_MECHANISM',
    scenario: '收益确定性优先，比如还贷期、预期现货偏弱',
    tiers: Object.freeze({
      DAY_AHEAD: tier('0.85', '1.05', { text: '临近交割区间上移收窄；上限按新能源出力不可调收紧（不照搬煤电 110%—115% 口径）', sources: ['F6', 'F7', 'F10'] }),
      INTRA_MONTH: tier('0.8', '1.0', { text: '滚动补足结构；机制比例 45%—100% 叠加后含机制口径可能超 100%', sources: ['F6', 'F2'] }),
      FORWARD: tier('0.7', '0.9', { text: '年度保底、滚动补足的做法；机制电量叠加', sources: ['F6', 'F7'] }),
    }),
  }),
  Object.freeze({
    key: 'BALANCED',
    label: '均衡',
    basis: 'WITH_MECHANISM',
    scenario: '一般经营年份',
    tiers: Object.freeze({
      DAY_AHEAD: tier('0.75', '1.0', { text: '临近交割上移收窄；上限不超过 105%（出力不可调）', sources: ['F6', 'F10'] }),
      INTRA_MONTH: tier('0.7', '0.95', { text: '用户侧 80% 目标仅作参照，不作强制', sources: ['F7', 'F10'] }),
      FORWARD: tier('0.6', '0.85', { text: '小时匹配 60%—75% 的有效对冲区间作参照', sources: ['F11'] }),
    }),
  }),
  Object.freeze({
    key: 'FLEXIBLE',
    label: '灵活',
    basis: 'WITH_MECHANISM',
    scenario: '预测与交易能力较强，愿意保留现货敞口',
    tiers: Object.freeze({
      DAY_AHEAD: tier('0.6', '0.95', { text: '临近交割上移收窄；出力不可调，上限仍收紧到 95%', sources: ['F6', 'F10'] }),
      INTRA_MONTH: tier('0.55', '0.85', { text: '保留现货敞口；欠保在负价时段代价大，需盯盘', sources: ['F15', 'F11'] }),
      FORWARD: tier('0.45', '0.75', { text: '欧洲 24/7 匹配 60%—75% 仅作参照，云南无强制下限', sources: ['F11', 'F1', 'F2'] }),
    }),
  }),
])

/** 出处编号 → 引用文本（页面「查看出处」展示；附录 F 的精简版，随文档同步维护）。 */
export function bandSourceOf(id) {
  return SOURCES[id] ?? null
}

/** 日前档上限一律不大于 105%（附录 E 设计要点，测试钉住）。 */
export const DAY_AHEAD_UPPER_LIMIT = '1.05'
