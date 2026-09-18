// 中长期售电 P5：业务复盘、外部账单与差异处理的共享契约（#3015，Epic #2937，tasks 12—13）。
//
// 单一事实源：后端 server/midlong/midlong-p5-* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、错误码、提示文案与纯函数规则。零依赖（只引用同目录的十进制工具）、前后端同构。
//
// 口径红线（specs midlong-business-review MR-01..06、design D6/D9 P5 行）：
// - 三种金额分离（MR-02）：合同名义量价金额（P1 持仓口径）/ 外部中长期账单金额（当前有效版本分项）/
//   有凭证的收款金额；逐项附来源与覆盖状态。缺完整结算参数只登记外部结果，不宣称已独立复算。
// - 账单业务键 =（公司 + 交易主体 + 来源 + 外部账单编号）：同号新修订版本追加（旧版保留），
//   相关差异转需重新核对；金额聚合只取当前有效版本，两版不重复累计（MR-03）。
// - 整张综合账单无法拆出中长期分项（UNITEMIZED）只归档并标未分项：不按比例猜分、不接现货计算填补、
//   不产生臆造中长期收入（MR-03）。
// - 收款凭证（编号、金额、日期、文件）是到账依据：无凭证不显示到账（MR-02）。
// - 差异按可比口径计算（同主体、同交割期、同单位；价格另须同币种与税口径），差值如实显示
//   （台账 1000 对账单 980 显示 −20）；登记不自动改台账；关闭差异必须有处理说明；
//   来源一致性核对与完整结算复算严格区分（MR-04）。
// - 复盘指标只覆盖中长期量价事实：计划完成、成交量价、对手方/方式分布、未成交、错过窗口、变更与
//   资料缺口；不推断现货择时收益、套保收益或实际利润（MR-01）；不可比曲线分列、不排名。
// - 绿电总价已含环境价值时名义金额按总价、分项展示、不重复相加（MR-06）。
// - 月度报告冻结输入版本（合同/计划/成交确认/账单）、查询范围、计算口径、覆盖范围与质量缺口与确认
//   信息；导出与归档一致；迟到修订生成新报告版本，旧报告数值不变（MR-05）。

import { decimalAdd, decimalCompare, decimalDiv, decimalIsZero, decimalMul, decimalSub, decimalSum } from './decimal.mjs'

// ── 账单 ─────────────────────────────────────────────────────────────────────

/** 账单登记形态：有中长期明确分项 / 整张综合账单无法拆分（只归档标未分项）。 */
export const BILL_KINDS = Object.freeze(['ITEMIZED', 'UNITEMIZED'])

/** 差异处理状态：待处理 / 需重新核对（账单修订后）/ 已解决（关闭，必须有处理说明）。 */
export const DISCREPANCY_STATUSES = Object.freeze(['OPEN', 'RECHECK_REQUIRED', 'RESOLVED'])

/** 差异两侧的取数来源：台账侧固定为 P1 持仓口径（合同/确认成交的正式义务），外部侧为账单分项。 */
export const DISCREPANCY_SIDES = Object.freeze(['POSITION_LEDGER', 'EXTERNAL_BILL'])

/** 结算附件用途：账单原件 / 收款凭证文件 / 差异证据。 */
export const SETTLEMENT_ATTACHMENT_PURPOSES = Object.freeze(['BILL_DOCUMENT', 'PAYMENT_VOUCHER', 'DISCREPANCY_EVIDENCE'])

/** 结算与复盘在 midlong_settlement_events 里追加的事件类型。 */
export const SETTLEMENT_EVENT_TYPES = Object.freeze([
  'BILL_REGISTERED', 'BILL_REVISED', 'BILL_VOUCHER_ADDED',
  'DISCREPANCY_REGISTERED', 'DISCREPANCY_UPDATED', 'DISCREPANCY_RESOLVED', 'DISCREPANCY_RECHECK_REQUIRED',
  'REVIEW_REPORT_GENERATED',
])

/** 复盘报告的范围：按交易主体 / 全公司（交割月内全部主体）。 */
export const REVIEW_REPORT_SCOPES = Object.freeze(['SUBJECT', 'COMPANY'])

// ── 专属错误码（补充 MIDLONG_ERROR_CODES，沿用同一信封与风格）─────────────────

export const SETTLEMENT_ERROR_CODES = Object.freeze([
  'DUPLICATE_BILL_CONTENT',
  'UNITEMIZED_BILL_NO_SPLIT',
  'DISCREPANCY_ALREADY_OPEN',
  'DISCREPANCY_NO_DIFFERENCE',
  'DISCREPANCY_RESOLUTION_NOTE_REQUIRED',
  'REPORT_INPUTS_UNCHANGED',
])
export const SETTLEMENT_ERROR_LABELS = Object.freeze({
  DUPLICATE_BILL_CONTENT: '同一外部账单编号已登记不同内容，请以修订版本提交',
  UNITEMIZED_BILL_NO_SPLIT: '整张综合账单无法拆出中长期分项时只能按未分项归档，不能携带或推算分项',
  DISCREPANCY_ALREADY_OPEN: '该比对目标已有未解决的差异，请先处理既有差异（或待账单修订后重新核对）',
  DISCREPANCY_NO_DIFFERENCE: '两侧可比数量与价格一致，没有可登记的差异',
  DISCREPANCY_RESOLUTION_NOTE_REQUIRED: '关闭差异必须填写处理说明',
  REPORT_INPUTS_UNCHANGED: '报告输入版本未变化，未生成新版本（同内容重放请复用原请求标识）',
})

// ── 中文标签与固定提示 ───────────────────────────────────────────────────────

export const BILL_KIND_LABELS = Object.freeze({
  ITEMIZED: '有中长期明确分项', UNITEMIZED: '综合账单（未分项，仅归档）',
})
export const DISCREPANCY_STATUS_LABELS = Object.freeze({
  OPEN: '待处理', RECHECK_REQUIRED: '需重新核对（账单已修订）', RESOLVED: '已解决（已关闭）',
})
export const DISCREPANCY_SIDE_LABELS = Object.freeze({
  POSITION_LEDGER: '中长期台账（合同/确认成交正式持仓）', EXTERNAL_BILL: '外部账单（中长期分项）',
})
export const SETTLEMENT_ATTACHMENT_PURPOSE_LABELS = Object.freeze({
  BILL_DOCUMENT: '账单原件', PAYMENT_VOUCHER: '收款凭证文件', DISCREPANCY_EVIDENCE: '差异证据',
})
export const SETTLEMENT_EVENT_TYPE_LABELS = Object.freeze({
  BILL_REGISTERED: '登记外部账单', BILL_REVISED: '账单修订（旧版保留）', BILL_VOUCHER_ADDED: '登记收款凭证',
  DISCREPANCY_REGISTERED: '登记量价差异', DISCREPANCY_UPDATED: '补充差异原因/负责人/证据',
  DISCREPANCY_RESOLVED: '解决差异（关闭）', DISCREPANCY_RECHECK_REQUIRED: '差异需重新核对（账单修订）',
  REVIEW_REPORT_GENERATED: '生成复盘报告版本（冻结输入）',
})
export const REVIEW_REPORT_SCOPE_LABELS = Object.freeze({ SUBJECT: '按交易主体', COMPANY: '全公司' })

/** 页面、导出与接口共用的固定口径提示。 */
export const SETTLEMENT_NOTICES = Object.freeze({
  threeAmounts: '三种金额分别列示：合同名义量价金额（持仓口径）、外部中长期账单金额（当前有效版本分项）、有凭证的收款金额；含义不同，不可相加或互相替代。',
  nominalNotSettlement: '合同名义金额是量价乘积的台账口径，不是结算收入，也不代表盈利结果。',
  billedCurrentRevision: '账单金额只按当前有效版本累计：同一外部账单编号的多个修订版本不重复相加，旧版保留可查。',
  unitemizedArchive: '整张综合账单无法拆出中长期分项：只归档并标未分项，不对综合总额做任何比例拆分或推算，不接入现货计算填补、不产生臆造的中长期收入。',
  noVoucherNoReceipt: '无收款凭证不显示到账：凭证（编号、金额、日期、文件）是到账依据，账单金额本身不代表已收款。',
  notIndependentlyRecomputed: '登记与核对只做来源一致性核对；缺完整结算参数时不宣称已独立复算，完整结算复算须独立结算依据。',
  consistencyNotRecompute: '差异核对是台账、确认单与账单之间的来源一致性核对，不是完整结算复算；关闭差异不改变任何台账数据。',
  discrepancyNoAutoLedger: '登记差异不自动改写合同台账：量差与价差如实显示（外部 − 台账），处理结果只记录在差异台账。',
  resolutionNoteRequired: '关闭差异必须填写处理说明；未处理前差异保持待处理或需重新核对。',
  billRevisionRecheck: '该外部账单编号收到修订版本：旧版保留，金额聚合改按新当前版本；相关差异已转需重新核对。',
  comparableGroupsOnly: '价格比较须同产品、交割期、曲线、币种与税口径：口径不可比时按组分列展示，不生成统一均价与排名。',
  reviewScopeOnly: '复盘只覆盖中长期量价事实：不推断市场择时、套保或利润结论，不读取现货、预测数据。',
  greenTotalIncludesEnvironment: '绿电合同总价已含环境价值时，名义金额按总价计算，电能量与环境价值分项展示，不再次相加环境价值。',
  greenEnvironmentMissing: '绿电合同缺环境价值价格或履约依据：只标资料缺口，不模拟机制差价、绿证收益或核销结果。',
  reportFrozen: '报告版本已冻结输入（合同/计划/成交确认/账单版本、查询范围、计算口径、覆盖范围与质量缺口）：导出与归档一致，当前数据变化不回写旧报告。',
  reportSuperseded: '迟到修订已生成新报告版本：旧报告数值保持不变，版本差异可查。',
})

/** 复盘页面与接口禁止出现的口径（测试用）。 */
export const FORBIDDEN_REVIEW_TERMS = Object.freeze(['现货择时收益', '套保收益', '实际利润'])
/** 账单与差异页面、接口禁止出现的口径（测试用）。 */
export const FORBIDDEN_SETTLEMENT_TERMS = Object.freeze(['按比例猜分', '按比例拆分账单', '复算通过', '已自动修正台账'])

// ── 纯函数规则 ───────────────────────────────────────────────────────────────

const normNum = (v) => (v === null || v === undefined || v === '' ? null : String(v))
const nullish = (v) => v === null || v === undefined

/**
 * 账单内容指纹（业务幂等去重用）：形态、来源、外部修订标识、期间、金额口径与分项
 * （月份、量、价、金额）规范化后拼接。同业务键同指纹视为同一份账单的重复处理，
 * 异指纹必须走修订（DUPLICATE_BILL_CONTENT）。备注与上传文件不参与指纹。
 * @param {{ billKind: string, sourceName?: string|null, externalRevisionLabel?: string|null,
 *           periodStartMonth?: string, periodEndMonth?: string, currency?: string,
 *           taxBasis?: string|null, priceComponent?: string|null, amount?: string,
 *           lineItems?: Array<{ deliveryMonth?: string|null, quantity?: string|null, price?: string|null, amount?: string|null }> }} value
 */
export function billContentFingerprint(value) {
  const items = (Array.isArray(value?.lineItems) ? value.lineItems : [])
    .map((i) => `${String(i?.deliveryMonth ?? '')}|${normNum(i?.quantity) ?? ''}|${normNum(i?.price) ?? ''}|${normNum(i?.amount) ?? ''}`)
    .sort()
  return JSON.stringify([
    String(value?.billKind ?? ''),
    normNum(value?.sourceName) ?? '',
    normNum(value?.externalRevisionLabel) ?? '',
    String(value?.periodStartMonth ?? ''),
    String(value?.periodEndMonth ?? ''),
    String(value?.currency ?? 'CNY'),
    normNum(value?.taxBasis) ?? '',
    normNum(value?.priceComponent) ?? '',
    normNum(value?.amount) ?? '',
    items,
  ])
}

/**
 * 同口径量价差异（MR-04）：外部侧（账单分项）相对台账侧（P1 持仓）的差值，如实显示。
 * 电量差 = 外部 − 台账（台账 1000、外部 980 → −20）；价格差只在同币种、同含税口径
 * （且台账侧均价可比、两侧价格已知）时计算，否则只给电量差并标注不可比。
 * @param {{ ledgerQuantity: string|null, ledgerPrice: string|null, ledgerCurrency?: string,
 *           ledgerTaxBasis?: string, externalQuantity: string|null, externalPrice: string|null,
 *           externalCurrency?: string, externalTaxBasis?: string }} input
 * @returns {{ quantityDelta: string|null, priceDelta: string|null, priceComparable: boolean,
 *            basis: string, comparableSides: string[] }} basis 为「外部 − 台账」的口径说明。
 */
export function computeQuantityPriceDelta({ ledgerQuantity, ledgerPrice, ledgerCurrency = 'CNY', ledgerTaxBasis = 'UNKNOWN',
  externalQuantity, externalPrice, externalCurrency = 'CNY', externalTaxBasis = 'UNKNOWN' } = {}) {
  const quantityDelta = nullish(ledgerQuantity) || nullish(externalQuantity) ? null : decimalSub(externalQuantity, ledgerQuantity)
  const priceComparable = !nullish(ledgerPrice) && !nullish(externalPrice)
    && String(ledgerCurrency) === String(externalCurrency)
    && !['UNKNOWN'].includes(String(ledgerTaxBasis)) && String(ledgerTaxBasis) === String(externalTaxBasis)
  const priceDelta = priceComparable ? decimalSub(externalPrice, ledgerPrice) : null
  return {
    quantityDelta,
    priceDelta,
    priceComparable,
    basis: '外部账单 − 中长期台账（同主体、同交割期、规范单位 MWh；价格须同币种与税口径）',
    comparableSides: priceComparable
      ? ['同币种', '同含税口径']
      : ['电量按规范单位 MWh 可比', ...(nullish(ledgerPrice) || nullish(externalPrice) ? ['至少一侧价格未知'] : []), ...((String(ledgerTaxBasis) !== String(externalTaxBasis) || ['UNKNOWN'].includes(String(ledgerTaxBasis))) ? ['含税口径不一致或未知'] : []), ...(String(ledgerCurrency) !== String(externalCurrency) ? ['币种不一致'] : [])],
  }
}

/**
 * 三种金额分离（MR-02）：同一范围（主体 + 交割月）下名义、账单、收款三行，
 * 逐项附来源与覆盖状态。账单金额只取各账单当前有效版本；未分项账单计入未分项归档数、
 * 不产生中长期金额；收款金额只计有凭证部分；从未宣称已独立复算。
 * @param {{ month: string, nominal: { amount: string|null, complete: boolean, groups?: Array<{ currency: string,
 *            taxBasis: string, priceComponent: string, knownQuantity: string, notionalAmount: string }>,
 *            unknownPriceQuantity?: string, coverageRatio?: string|null },
 *           bills?: Array<{ billId: number, currentRevisionNo: number, billKind: string, currency: string,
 *            inPeriod: boolean, monthItemAmount: string|null, monthItemQuantity: string|null }>,
 *           unitemizedBillCount?: number, voucherAmount: string|null, voucherCount?: number,
 *           hasBills?: boolean, hasVouchers?: boolean }} input
 */
export function buildSettlementAmounts({ month, nominal, bills = [], unitemizedBillCount = 0, voucherAmount = null, voucherCount = 0 } = {}) {
  const itemized = bills.filter((b) => b.billKind === 'ITEMIZED')
  const monthAmounts = itemized.filter((b) => b.inPeriod && b.monthItemAmount !== null).map((b) => b.monthItemAmount)
  const billedAmount = monthAmounts.length ? decimalSum(monthAmounts) : null
  const monthQuantities = itemized.filter((b) => b.inPeriod && b.monthItemQuantity !== null).map((b) => b.monthItemQuantity)
  const billedQuantity = monthQuantities.length ? decimalSum(monthQuantities) : null
  // 收款金额只计有凭证部分：无凭证（voucherCount=0）即为 null，不显示到账（MR-02）。
  const received = voucherCount > 0 ? voucherAmount : null
  return {
    month,
    nominalAmount: {
      amount: nominal?.amount ?? null,
      source: 'CONTRACT_LEDGER',
      sourceLabel: '中长期合同量价（持仓口径，名义金额）',
      coverage: nominal?.complete === true ? 'COMPLETE' : 'PARTIAL',
      groups: nominal?.groups ?? [],
      notice: SETTLEMENT_NOTICES.nominalNotSettlement,
    },
    billedAmount: {
      amount: billedAmount,
      quantity: billedQuantity,
      source: 'EXTERNAL_BILL',
      sourceLabel: '外部中长期账单（当前有效版本分项）',
      coverage: billedAmount === null ? 'MISSING' : 'PARTIAL',
      unitemizedBillCount,
      currentRevisionOnly: true,
      notice: SETTLEMENT_NOTICES.billedCurrentRevision,
    },
    receivedAmount: {
      amount: received,
      voucherCount,
      source: 'PAYMENT_VOUCHER',
      sourceLabel: '收款凭证（编号 + 金额 + 日期 + 文件）',
      coverage: received === null ? 'MISSING' : 'PARTIAL',
      notice: SETTLEMENT_NOTICES.noVoucherNoReceipt,
    },
    independentlyRecomputed: { status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' },
    notice: SETTLEMENT_NOTICES.threeAmounts,
  }
}

/**
 * 绿电价格组成（MR-06）：由合同版本价格口径推出单价组成与名义金额。
 * - 总价已含环境价值（ENERGY_WITH_ENVIRONMENT，如 310 = 300 + 10）：名义按总价 310，
 *   电能量分项 = 总价 − 环境价值（300），环境价值分项单列（10），不再次相加。
 * - 电能量价另列环境价值（ENERGY_ONLY，300 + 10）：单位合计 310，两分项分别展示。
 * - 缺环境价值价格：只标资料缺口（GAP 列表），不模拟机制差价、绿证收益或核销结果。
 * @param {{ quantity: string, sellerPrice: string|null, environmentPrice: string|null,
 *           priceComponent: string }} input
 * @returns {{ unitTotal: string|null, energyUnit: string|null, environmentUnit: string|null,
 *            notionalAmount: string|null, composition: 'TOTAL_INCLUDES_ENVIRONMENT'|'ENERGY_PLUS_ENVIRONMENT'|'ENVIRONMENT_UNKNOWN',
 *            gaps: string[] }}
 */
export function greenPricingComposition({ quantity, sellerPrice, environmentPrice, priceComponent } = {}) {
  const gaps = []
  if (nullish(sellerPrice)) gaps.push('缺合同总价（售电价格）')
  const q = nullish(quantity) ? null : quantity
  if (priceComponent === 'ENERGY_WITH_ENVIRONMENT') {
    const unitTotal = normNum(sellerPrice) ?? null
    const environmentUnit = normNum(environmentPrice) ?? null
    const energyUnit = unitTotal !== null && environmentUnit !== null && decimalCompare(unitTotal, environmentUnit) >= 0
      ? decimalSub(unitTotal, environmentUnit)
      : null
    if (environmentUnit === null) gaps.push('总价已含环境价值但未登记环境价值分项')
    else if (energyUnit === null) gaps.push('总价低于环境价值分项，组成异常，请核对')
    return {
      unitTotal,
      energyUnit,
      environmentUnit,
      notionalAmount: unitTotal !== null && q !== null ? decimalMul(q, unitTotal) : null,
      composition: 'TOTAL_INCLUDES_ENVIRONMENT',
      gaps,
    }
  }
  if (priceComponent === 'ENERGY_ONLY') {
    const energyUnit = normNum(sellerPrice) ?? null
    const environmentUnit = normNum(environmentPrice) ?? null
    const unitTotal = energyUnit !== null && environmentUnit !== null ? decimalAdd(energyUnit, environmentUnit) : null
    if (environmentUnit === null) gaps.push('电能量价之外的环境价值未登记')
    return {
      unitTotal,
      energyUnit,
      environmentUnit,
      notionalAmount: unitTotal !== null && q !== null ? decimalMul(q, unitTotal) : null,
      composition: environmentUnit === null ? 'ENVIRONMENT_UNKNOWN' : 'ENERGY_PLUS_ENVIRONMENT',
      gaps,
    }
  }
  return {
    unitTotal: normNum(sellerPrice) ?? null,
    energyUnit: null,
    environmentUnit: normNum(environmentPrice) ?? null,
    notionalAmount: nullish(sellerPrice) || q === null ? null : decimalMul(q, sellerPrice),
    composition: 'ENVIRONMENT_UNKNOWN',
    gaps: [...gaps, '价格构成未核对（UNVERIFIED），无法拆分环境价值'],
  }
}

/**
 * 报告输入版本差异（MR-05）：对比两份输入冻结集合，列出发生变化的输入
 * （用于生成新版本的变更说明与「受影响报告」定位）。只比版本引用，不比数值。
 * @param {{ contracts?: Record<string, number>, plans?: Record<string, number>,
 *           confirmations?: Record<string, number>, bills?: Record<string, number> }} previous
 * @param {{ contracts?: Record<string, number>, plans?: Record<string, number>,
 *           confirmations?: Record<string, number>, bills?: Record<string, number> }} next
 * @returns {Array<{ kind: 'CONTRACT'|'PLAN'|'CONFIRMATION'|'BILL', id: number, from: number|null, to: number|null }>}
 */
export function reportInputChanges(previous = {}, next = {}) {
  const changes = []
  for (const [kind, key] of [['CONTRACT', 'contracts'], ['PLAN', 'plans'], ['CONFIRMATION', 'confirmations'], ['BILL', 'bills']]) {
    const before = previous?.[key] ?? {}
    const after = next?.[key] ?? {}
    for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
      const from = nullish(before[id]) ? null : Number(before[id])
      const to = nullish(after[id]) ? null : Number(after[id])
      if (from !== to) changes.push({ kind, id: Number(id), from, to })
    }
  }
  return changes
}

/** 报告指标快照的内容指纹（输入冻结 + 指标数值），用于版本一致性与导出一致性核对。 */
export function reportContentFingerprint({ inputFreeze, metrics } = {}) {
  return JSON.stringify([inputFreeze ?? null, metrics ?? null])
}

/**
 * 复盘量价分组的可比判定（MR-01）：同月内多个（币种、税口径、价格构成）分组时
 * 分列展示且不生成统一均价与排名；单一分组才给汇总均价。
 * @param {Array<{ currency: string, taxBasis: string, priceComponent: string, knownQuantity: string, notionalAmount: string }>} groups
 */
export function summarizeComparableGroups(groups = []) {
  const rows = groups.map((g) => ({ ...g, averagePrice: decimalIsZero(g.knownQuantity) ? null : decimalDiv(g.notionalAmount, g.knownQuantity, 6) }))
  const comparable = rows.length <= 1
  return {
    groups: rows,
    comparable,
    averagePrice: comparable && rows.length === 1 ? rows[0].averagePrice : null,
    notionalAmount: comparable && rows.length === 1 ? rows[0].notionalAmount : null,
    ranking: null,
    rankingNotice: comparable ? null : SETTLEMENT_NOTICES.comparableGroupsOnly,
  }
}
