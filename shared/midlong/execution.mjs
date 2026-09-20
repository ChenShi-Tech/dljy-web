// 中长期售电 P4：执行确认（外部成交确认单、部分成交、占用转换与冲正）的共享契约（#3013，Epic #2937）。
//
// 单一事实源：后端 server/midlong/midlong-p4-execution-* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、错误码、提示文案与纯函数规则。零依赖（只引用同目录的十进制工具）、前后端同构。
//
// 口径红线（specs midlong-trade-execution MT-03..06、midlong-sales-planning MS-04/05、midlong-position-ledger MP-01）：
// - 业务键 = 公司 + 交易主体 + 来源 + 确认单号：同键同内容重复处理幂等（持仓与占用转换各只发生一次）；
//   同键内容变化必须作为修订版本；不同主体同号各自独立，不自动关联、不共享成交或持仓。
// - 预成交（PRE_CLEARED）只保留记录：不入正式持仓、不占用计划额度、不转换占用。
// - 确认成交（CLEARED）在同一数据库事务完成：义务创建/关联、确认版本与关联、占用转换、方案状态与偏差快照
//   全部成功或全部不生效（design D7）。
// - 占用转换只减「未完成占用」，下限为 0；已释放占用不得再次扣减；方案过期后的迟到成交照常入账义务、
//   占用保持 0 并重算计划偏差；超计划的真实成交照常登记并提示超计划，不丢弃（MS-05）。
// - 关联校验公司与交易主体一致，不能只凭合同号自动匹配；补充关联只新增关联记录，不新增同一义务（持仓不变）。
// - 确认成交后的外部撤销走冲正：追加冲正记录与合同更正版本，不物理删旧成交、不当草稿撤单；
//   占用不因冲正凭空恢复（外部撤销 ≠ 新计划）。
// - 缺价格可登记真实量、保持价格不完整（不编价）；来源不支持的产品停在待核对，不自动映射。

import { decimalAdd, decimalCompare, decimalDiv, decimalIsZero, decimalSub, decimalSum } from './decimal.mjs'

// ── 确认结果状态（与方案状态机的执行段一致） ─────────────────────────────────

/**
 * 外部确认单的结果状态：预成交（只留记录）、确认成交（进义务与占用转换）、外部撤销（冲正版本）。
 * 与 PROPOSAL_STATUSES 中的执行段同名同义。
 */
export const EXECUTION_RESULT_STATUSES = Object.freeze(['PRE_CLEARED', 'CLEARED', 'WITHDRAWN'])
/** 登记接口可直接提交的结果状态（外部撤销只能经 revoke 产生 WITHDRAWN 版本，不能直接登记）。 */
export const EXECUTION_REGISTERABLE_RESULT_STATUSES = Object.freeze(['PRE_CLEARED', 'CLEARED'])

/** 确认单 ↔ 合同的关联类型：确认成交创建了唯一新义务 / 关联既有已核验合同义务。 */
export const EXECUTION_LINK_KINDS = Object.freeze(['OBLIGATION_CREATED', 'EXISTING_LINKED'])

/** 执行确认在计划事件表（midlong_planning_events）里追加的事件类型（含方案侧的执行状态事件）。 */
export const EXECUTION_EVENT_TYPES = Object.freeze([
  'PROPOSAL_PRE_CLEARED', 'PROPOSAL_CLEARED', 'PROPOSAL_WITHDRAWN',
  'EXECUTION_CONFIRMATION_REGISTERED', 'EXECUTION_CONFIRMATION_REVISED', 'EXECUTION_CONFIRMATION_REVOKED',
  'EXECUTION_CONTRACT_LINKED', 'EXECUTION_OCCUPATION_CONVERTED',
])

// ── 执行确认专属错误码（补充 MIDLONG_ERROR_CODES，沿用同一信封与风格） ────────

export const EXECUTION_ERROR_CODES = Object.freeze(['DUPLICATE_CONFIRMATION_CONTENT', 'SUBJECT_MISMATCH', 'OCCUPATION_ALREADY_RELEASED'])
export const EXECUTION_ERROR_LABELS = Object.freeze({
  DUPLICATE_CONFIRMATION_CONTENT: '同一确认单号已登记不同内容，请以修订版本提交',
  SUBJECT_MISMATCH: '交易主体不一致，拒绝自动关联，请核对归属',
  OCCUPATION_ALREADY_RELEASED: '方案占用已释放，不得再次扣减',
})

// ── 中文标签与固定提示 ───────────────────────────────────────────────────────

export const EXECUTION_RESULT_STATUS_LABELS = Object.freeze({
  PRE_CLEARED: '预成交', CLEARED: '确认成交', WITHDRAWN: '外部撤销（已冲正）',
})
export const EXECUTION_LINK_KIND_LABELS = Object.freeze({
  OBLIGATION_CREATED: '由确认单创建的合同义务', EXISTING_LINKED: '关联既有合同义务',
})
export const EXECUTION_EVENT_TYPE_LABELS = Object.freeze({
  PROPOSAL_PRE_CLEARED: '方案收到预成交结果', PROPOSAL_CLEARED: '方案确认成交（占用转换）', PROPOSAL_WITHDRAWN: '方案被外部撤单（冲正）',
  EXECUTION_CONFIRMATION_REGISTERED: '登记外部成交确认单', EXECUTION_CONFIRMATION_REVISED: '确认单内容修订（旧版保留）',
  EXECUTION_CONFIRMATION_REVOKED: '外部撤销冲正（旧成交保留）', EXECUTION_CONTRACT_LINKED: '确认单关联合同',
  EXECUTION_OCCUPATION_CONVERTED: '占用转换为成交',
})

/** 页面与接口共用的固定口径提示。 */
export const EXECUTION_NOTICES = Object.freeze({
  preClearedNotFormal: '预成交结果只保留记录：不增加正式持仓、不占用计划额度、不转换占用，待有效结果核验后才转为确认义务。',
  clearedAtomic: '确认成交在同一事务完成义务登记、确认留痕与占用转换；任一步失败整体不生效，可安全重试。',
  duplicateReplay: '同一确认单重复处理：已链接既有确认记录，持仓与占用转换不重复发生。',
  contentChangeIsRevision: '同一确认单号内容变化必须作为修订版本提交（旧版本保留），不能按新成交重复入账。',
  subjectMismatch: '候选合同与确认单交易主体不一致：已拒绝自动关联，请人工核对归属；不同主体同号各自独立，不共享成交或持仓。',
  lateResult: '方案占用已释放（过期、撤销或关闭）：迟到真实成交照常入账义务，占用保持 0、不会为负，请核对计划偏差。',
  occupationFloor: '占用转换只扣减未完成占用、下限为 0；已释放占用不得再次扣减。',
  overPlan: '该成交使确认已售电量超过确认目标（超计划）：义务已照常登记、不丢弃，请调整计划或方案。',
  planDeviation: '该成交导致计划偏差：已按最新已售重算剩余计划待售量与可安排计划量，请核对。',
  revokeReversal: '外部撤销按冲正处理：旧成交记录与合同版本保留，对应义务已生成更正版本；占用不因冲正恢复（外部撤销不等于新计划）。',
  linkNoDoubleCount: '关联既有合同只新增关联记录，不新增同一义务：月度持仓仍只计算该合同义务一次。',
  linkRequiresConfirmed: '只能关联已核验确认的合同；未核验合同请先在合同底账完成核验，避免同一义务双份记录。',
  unsupportedProduct: '该来源产品暂不支持自动映射：确认单停在待核对，不创建义务、不转换占用，请人工核对后处理。',
  priceUnknown: '确认单缺价格：真实电量照常登记，价格保持未知（不编价），价格覆盖 incomplete。',
})

/** 执行确认页面与接口禁止出现的口径（测试用）。 */
export const FORBIDDEN_EXECUTION_TERMS = Object.freeze(['自动撤销占用', '负占用'])

// ── 纯函数规则 ───────────────────────────────────────────────────────────────

const normNum = (v) => (v === null || v === undefined || v === '' ? null : String(v))
const nullish = (v) => v === null || v === undefined

/**
 * 确认单内容指纹（业务幂等去重用）：结果状态、品种、交易方式、价格口径、外部确认时刻与交割段
 * （月份、量、价）规范化后拼接；同键同指纹视为同一份确认单的重复处理，异指纹必须走修订。
 * @param {{ resultStatus: string, productKind?: string|null, tradeMethod?: string|null, unsupportedProduct?: string|null,
 *           priceTaxBasis?: string|null, priceComponent?: string|null, externalConfirmedAt?: string|null,
 *           segments?: Array<{ deliveryMonth: string, quantity: string, price?: string|null }> }} value
 */
export function confirmationContentFingerprint(value) {
  const segments = (Array.isArray(value?.segments) ? value.segments : [])
    .map((s) => `${String(s?.deliveryMonth ?? '')}|${normNum(s?.quantity) ?? ''}|${normNum(s?.price) ?? ''}`)
    .sort()
  return JSON.stringify([
    String(value?.resultStatus ?? ''),
    normNum(value?.productKind) ?? '',
    normNum(value?.tradeMethod) ?? '',
    normNum(value?.unsupportedProduct) ?? '',
    normNum(value?.priceTaxBasis) ?? '',
    normNum(value?.priceComponent) ?? '',
    normNum(value?.externalConfirmedAt) ?? '',
    segments,
  ])
}

/**
 * 占用转换分配（MS-04 精确数字、MT-04 绝对量语义、MT-06 下限 0）。
 * 确认单的每个版本声明该确认单在各交割月的**最终**已确认量（不是对先前版本的无条件追加）：
 * 目标转换量 = 本次版本量 − 该确认单此前已转换量；正增量只减未完成占用（不足部分不转、下限 0），
 * 负增量（修订减量）只回退该确认单自己已转换的量（不侵占其他确认单的转换量）。
 * @param {{ segments?: Array<{ deliveryMonth: string, quantity: string }>,
 *           previousConvertedByMonth?: Record<string, string>,
 *           openOccupations?: Array<{ deliveryMonth: string, remainingQuantity: string }> }} input
 *   openOccupations.remainingQuantity = quantity − converted_quantity（未释放占用的未完成量）；已释放行不应出现在输入里。
 *   previousConvertedByMonth：该确认单此前各月累计已转换量（首版登记传 {}）。
 * @returns {{ months: Array<{ deliveryMonth: string, targetQuantity: string, previousConvertedQuantity: string, delta: string,
 *            remainingBefore: string|null, remainingAfter: string|null, reason: 'CONVERTED'|'PARTIAL'|'REDUCED'|'OCCUPATION_NOT_OPEN' }>,
 *            totalDelta: string, totalUnconverted: string, lateResult: boolean }}
 *   lateResult：有目标增量但因占用不足（典型：方案过期已释放）未能全部转换——真实量照常入账义务。
 */
export function allocateOccupationConversion({ segments = [], previousConvertedByMonth = {}, openOccupations = [] } = {}) {
  const remainingByMonth = new Map(openOccupations.map((o) => [o.deliveryMonth, o.remainingQuantity]))
  const previousByMonth = new Map(Object.entries(previousConvertedByMonth ?? {}).map(([m, q]) => [m, normNum(q) ?? '0']))
  const months = []
  let totalDelta = '0'
  let totalUnconverted = '0'
  for (const segment of segments) {
    const target = normNum(segment?.quantity) ?? '0'
    const previous = previousByMonth.get(segment.deliveryMonth) ?? '0'
    const remainingBefore = remainingByMonth.get(segment.deliveryMonth) ?? null
    const rawDelta = decimalSub(target, previous)
    let delta = '0'
    let reason = 'OCCUPATION_NOT_OPEN'
    if (decimalCompare(rawDelta, '0') >= 0) {
      const capacity = remainingBefore === null ? '0' : remainingBefore
      delta = decimalCompare(rawDelta, capacity) <= 0 ? rawDelta : capacity
      totalUnconverted = decimalAdd(totalUnconverted, decimalSub(rawDelta, delta))
      // 一点没转换成（无开放占用或占用已尽）与部分转换分别标注，页面与快照可区分。
      reason = decimalIsZero(rawDelta) || decimalCompare(delta, rawDelta) === 0
        ? 'CONVERTED'
        : decimalIsZero(delta) ? 'OCCUPATION_NOT_OPEN' : 'PARTIAL'
    } else {
      // 修订减量：最多回退该确认单自己此前转换的量。
      const reducible = decimalCompare(decimalSub('0', rawDelta), previous) <= 0 ? decimalSub('0', rawDelta) : previous
      delta = decimalSub('0', reducible)
      reason = 'REDUCED'
    }
    if (remainingBefore !== null) remainingByMonth.set(segment.deliveryMonth, decimalSub(remainingBefore, delta))
    totalDelta = decimalAdd(totalDelta, delta)
    months.push({
      deliveryMonth: segment.deliveryMonth,
      targetQuantity: target,
      previousConvertedQuantity: previous,
      delta,
      remainingBefore,
      remainingAfter: remainingBefore === null ? null : decimalSub(remainingBefore, delta),
      reason,
    })
  }
  // 修订删掉的交割月（新版本 segments 里不再出现、但此前转换过量）：绝对量语义同样适用于占用——
  // 该月按 previous 全额负增量回退，否则占用余量被永久吃掉（MT-04/MS-04，P4 审计 P2-1）。
  for (const [removedMonth, previous] of previousByMonth) {
    if (months.some((m) => m.deliveryMonth === removedMonth)) continue
    if (decimalIsZero(previous)) continue
    const delta = decimalSub('0', previous)
    const remainingBefore = remainingByMonth.get(removedMonth) ?? null
    if (remainingBefore !== null) remainingByMonth.set(removedMonth, decimalSub(remainingBefore, delta))
    totalDelta = decimalAdd(totalDelta, delta)
    months.push({
      deliveryMonth: removedMonth,
      targetQuantity: '0',
      previousConvertedQuantity: previous,
      delta,
      remainingBefore,
      remainingAfter: remainingBefore === null ? null : decimalSub(remainingBefore, delta),
      reason: 'REDUCED',
    })
  }
  months.sort((a, b) => (a.deliveryMonth < b.deliveryMonth ? -1 : 1))
  return { months, totalDelta, totalUnconverted, lateResult: decimalCompare(totalUnconverted, '0') > 0 }
}

/**
 * 计划偏差（MT-06 / MS-05）：确认成交（或修订/冲正）后按适用计划重算的余额与偏差提示。
 * @param {{ plans?: Array<{ planId: number, periodType: 'YEAR'|'MONTH', periodKey: string, targetQuantity: string|null,
 *           soldQuantity: string|null, soldComplete: boolean }>, segments?: Array<{ deliveryMonth: string, quantity: string }>,
 *           conversion?: { totalUnconverted?: string, lateResult?: boolean } } } input
 *   plans 的 soldQuantity 为本次变动前已售（持仓现值）；soldComplete=false 时已知已售只是下限。
 *   segments 的 quantity 是各月对已售的**净增量**（登记=确认量，修订=新旧差，冲正=负数）。
 * @returns {{ rows: Array<object>, notices: string[] }} rows 每个适用计划一行；
 *   有净增量却无适用计划的交割月在 notices 里点名（目标未知不编造余额）。
 */
export function buildPlanDeviation({ plans = [], segments = [], conversion = {} } = {}) {
  const deltaByMonth = new Map()
  for (const segment of segments) {
    deltaByMonth.set(segment.deliveryMonth, decimalAdd(deltaByMonth.get(segment.deliveryMonth) ?? '0', segment.quantity))
  }
  const coveredMonths = new Set()
  const rows = []
  const notices = []
  for (const plan of plans) {
    const months = plan.periodType === 'MONTH' ? [plan.periodKey] : Array.from({ length: 12 }, (_, i) => `${plan.periodKey}-${String(i + 1).padStart(2, '0')}`)
    const confirmedInPeriod = decimalSum(months.map((m) => deltaByMonth.get(m) ?? '0'))
    months.forEach((m) => deltaByMonth.delete(m))
    const targetKnown = !nullish(plan.targetQuantity)
    const soldBefore = normNum(plan.soldQuantity) ?? '0'
    const soldAfter = targetKnown ? decimalAdd(soldBefore, confirmedInPeriod) : null
    // 偏差判定用「已知已售（下限）」：已售覆盖不完整时下限超过目标同样是确定事实（与 computePlanProgress 同口径）。
    const overPlan = targetKnown && soldAfter !== null && decimalCompare(soldAfter, plan.targetQuantity) > 0
    const remainingAfter = targetKnown && soldAfter !== null ? decimalSub(plan.targetQuantity, soldAfter) : null
    months.forEach((m) => coveredMonths.add(m))
    rows.push({
      planId: plan.planId,
      periodType: plan.periodType,
      periodKey: plan.periodKey,
      targetQuantity: targetKnown ? plan.targetQuantity : null,
      soldQuantityBefore: normNum(plan.soldQuantity),
      soldComplete: Boolean(plan.soldComplete),
      confirmedQuantityInPeriod: confirmedInPeriod,
      knownSoldQuantityAfter: soldAfter,
      remainingPlanQuantityAfter: remainingAfter,
      completionRateAfter: targetKnown && soldAfter !== null && !decimalIsZero(plan.targetQuantity) ? decimalDiv(soldAfter, plan.targetQuantity, 6) : null,
      overPlan,
      verificationStatus: !targetKnown ? 'TARGET_UNKNOWN' : plan.soldComplete ? 'VERIFIED' : 'UNVERIFIED',
    })
    if (overPlan) notices.push(EXECUTION_NOTICES.overPlan)
  }
  const uncovered = [...deltaByMonth.entries()].filter(([m, delta]) => decimalCompare(delta, '0') > 0).map(([m]) => m).filter((m) => !coveredMonths.has(m))
  if (uncovered.length) notices.push(`交割月 ${uncovered.sort().join('、')} 没有已确认的售电目标，本次成交照常登记义务，不计算目标余额。`)
  if (conversion.lateResult && decimalCompare(conversion.totalUnconverted ?? '0', '0') > 0) notices.push(EXECUTION_NOTICES.lateResult)
  return { rows, notices: [...new Set(notices)] }
}
