// 中长期售电 P4：合同调整（外部调整、转让、部分终止）的共享契约（#3013，Epic #2937，tasks 11.1—11.3）。
//
// 单一事实源：后端 server/midlong/midlong-p4-adjust-* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、错误码、提示文案与纯函数规则。零依赖（只引用同目录的十进制工具）、前后端同构。
//
// 口径红线（specs midlong-contract-adjustment MA-01..05、midlong-position-ledger MP-06、design D4/D7）：
// - 更正（CORRECTION）纠正录入错误，调整（ADJUSTMENT/TRANSFER/PARTIAL_TERMINATION）改变外部义务：
//   两类变更分开登记，调整产生的合同版本 revision_kind 即调整类型，不与录入更正混用（MA-01）。
// - 我方义务变化方向（OBLIGATION_INCREASE/DECREASE）必须来自核验单据的明确字段或显式映射登记，
//   不得从「买入/卖出」字样或电量正负推断；无法确认方向时停在待核对并阻止生效（MA-02）。
// - 转让价款、补偿、手续费为独立字段（金额、币种、含税口径），与原合同售电价分开记录，不进持仓均价（MA-02）。
// - 只改指定交割片段：减少量不得超过该片段当前有效义务（可调余额按片段计算并展示）；
//   未受影响片段在新版本中复制原值，不按比例缩小全年（MA-03）。
// - 确认调整在单事务内原子生成合同新版本 + 生效台账 + 解释事件；以外部变更业务键防重复导入，
//   以原版本号（base_revision_no）防并发同 base 生效（MA-04）。
// - 历史认知视图不漂移：迟到调整/更正在当前视图反映，asOf 视图仍用当时版本（MP-06，复用 P1 版本选择机制）。

import { decimalAdd, decimalCompare, decimalSub } from './decimal.mjs'

// ── 类型与状态 ───────────────────────────────────────────────────────────────

/** 调整的业务类型（区别于录入更正 CORRECTION；与合同版本 revision_kind 的调整段同源）。 */
export const ADJUSTMENT_TYPES = Object.freeze(['ADJUSTMENT', 'TRANSFER', 'PARTIAL_TERMINATION'])
/** 调整主档状态：DRAFT（方向已明确、待确认生效）、PENDING_VERIFICATION（方向待核对、阻止生效）、EFFECTIVE（已生效，终态）。 */
export const ADJUSTMENT_STATUSES = Object.freeze(['DRAFT', 'PENDING_VERIFICATION', 'EFFECTIVE'])
/** 我方义务变化方向：只能来自核验单据明确字段或显式映射登记，不从字样或正负推断。 */
export const OBLIGATION_DIRECTIONS = Object.freeze(['OBLIGATION_INCREASE', 'OBLIGATION_DECREASE'])
/** 方向来源：核验单据的明确字段 / 显式映射登记（外部产品代码 → 内部方向，带依据）。 */
export const ADJUSTMENT_DIRECTION_SOURCES = Object.freeze(['DOCUMENT_FIELD', 'MAPPING_REGISTERED'])
/** 停在待核对的原因：无法确认我方义务变化方向（且无显式映射）。 */
export const ADJUSTMENT_PENDING_REASONS = Object.freeze(['NO_DIRECTION'])
/** 独立价款科目：与原合同售电价分开记录，不进持仓均价。 */
export const ADJUSTMENT_PRICE_KINDS = Object.freeze(['transferPrice', 'compensation', 'handlingFee'])

// ── 中文标签与固定提示 ───────────────────────────────────────────────────────

export const ADJUSTMENT_TYPE_LABELS = Object.freeze({
  ADJUSTMENT: '外部调整', TRANSFER: '合同转让', PARTIAL_TERMINATION: '部分终止',
})
export const ADJUSTMENT_STATUS_LABELS = Object.freeze({
  DRAFT: '待生效', PENDING_VERIFICATION: '待核对（方向未确认）', EFFECTIVE: '已生效',
})
export const OBLIGATION_DIRECTION_LABELS = Object.freeze({
  OBLIGATION_INCREASE: '我方义务增加', OBLIGATION_DECREASE: '我方义务减少',
})
export const ADJUSTMENT_DIRECTION_SOURCE_LABELS = Object.freeze({
  DOCUMENT_FIELD: '核验单据明确字段', MAPPING_REGISTERED: '显式映射登记',
})
export const ADJUSTMENT_PENDING_REASON_LABELS = Object.freeze({
  NO_DIRECTION: '无法确认我方义务增减方向',
})
export const ADJUSTMENT_PRICE_KIND_LABELS = Object.freeze({
  transferPrice: '转让价款', compensation: '补偿价款', handlingFee: '手续费',
})

/** 页面与接口共用的固定口径提示。 */
export const ADJUSTMENT_NOTICES = Object.freeze({
  directionNoInference: '方向不得从「买入/卖出」字样或电量正负推断：只能来自核验单据的明确字段或显式映射登记（带依据）。',
  directionPending: '外部文件无法确认我方义务增减方向：调整停在待核对，不改变持仓；请核对单据后以修订补明确方向，再确认生效。',
  directionFromMapping: '方向来自显式映射登记（来源产品代码 → 内部类型/方向），登记依据可查；与单据不一致时以修订的明确字段为准。',
  atomicEffect: '确认调整在同一事务生成合同新版本、生效台账与解释记录；任一步失败整体不生效，可安全重试。',
  duplicateReplay: '同一外部变更重复导入：已链接既有调整记录，持仓与合同版本不重复变动。',
  segmentScopeOnly: '调整只作用于指定交割片段：未受影响片段在新版本中保持原值，不按全年比例缩小。',
  priceIndependent: '转让价款、补偿与手续费单列登记：不并入原合同售电价格、不进入持仓均价。',
  adjustableBalance: '可调整余额按交割片段计算：减少量不得超过该片段当前有效义务（正式月度分解量）。',
  baseMoved: '合同在登记后已被他人变更：请基于最新版本重新核对并提交（原版本号已不匹配）。',
  retroactive: '该调整改写已结束的交割片段：当前视图反映调整，历史 asOf 认知视图仍使用当时版本，差异可经变更影响查询解释。',
  futureEffective: '预定未来生效：生效时刻之前当前持仓仍采用原版本，到点后自动采用新版本。',
  unallocatedPool: '未分解电量池不受片段调整影响：调整只改指定片段的正式分解量。',
  noVolumeChange: '补充资料与留痕不产生电量变更：无经济内容变化的操作不生成合同新版本。',
})

/** 调整页面与接口禁止出现的口径（测试用）。 */
export const FORBIDDEN_ADJUSTMENT_TERMS = Object.freeze(['按比例缩小', '按买入卖出判定方向', '转让价款计入均价'])

// ── 纯函数规则 ───────────────────────────────────────────────────────────────

const normNum = (v) => (v === null || v === undefined || v === '' ? null : String(v))

/**
 * 调整内容指纹（业务幂等去重用）：类型、方向、外部产品代码、独立价款、生效时刻与交割段
 * （月份、变化量）规范化后拼接；同业务键同指纹视为同一份外部变更的重复导入，异指纹必须走修订。
 * 变化原因、备注与来源名称不参与指纹（同一份外部文件重导时这些描述可能不同）。
 * @param {{ adjustmentType: string, direction?: string|null, externalProductCode?: string|null,
 *           counterpartyName?: string|null, businessEffectiveAt?: string|null, prices?: object|null,
 *           segments?: Array<{ deliveryMonth: string, quantity: string }> }} value
 */
export function adjustmentContentFingerprint(value) {
  const segments = (Array.isArray(value?.segments) ? value.segments : [])
    .map((s) => `${String(s?.deliveryMonth ?? '')}|${normNum(s?.quantity) ?? ''}`)
    .sort()
  return JSON.stringify([
    String(value?.adjustmentType ?? ''),
    normNum(value?.direction) ?? '',
    normNum(value?.externalProductCode) ?? '',
    normNum(value?.counterpartyName) ?? '',
    normNum(value?.businessEffectiveAt) ?? '',
    value?.prices && Object.keys(value.prices).length ? value.prices : null,
    segments,
  ])
}

/**
 * 方向解析（MA-02）：显式字段（核验单据明确字段的转录）优先；无显式字段时查显式映射登记；
 * 两者都没有 → 待核对（NO_DIRECTION）。显式字段与映射登记冲突 → 拒绝（人工核对，不静默取一）。
 * @param {{ explicitDirection?: string|null, mapping?: { direction: string, adjustmentType: string }|null }} input
 * @returns {{ ok: true, direction: string, source: 'DOCUMENT_FIELD'|'MAPPING_REGISTERED', mappingType?: string }
 *          | { ok: false, reason: 'DIRECTION_CONFLICT', explicitDirection: string, mappingDirection: string }
 *          | { ok: true, direction: null, source: null, pendingReason: 'NO_DIRECTION' }}
 */
export function resolveAdjustmentDirection({ explicitDirection = null, mapping = null } = {}) {
  if (explicitDirection !== null && explicitDirection !== undefined && explicitDirection !== '') {
    if (mapping && mapping.direction !== explicitDirection) {
      return { ok: false, reason: 'DIRECTION_CONFLICT', explicitDirection, mappingDirection: mapping.direction }
    }
    return { ok: true, direction: explicitDirection, source: 'DOCUMENT_FIELD' }
  }
  if (mapping) return { ok: true, direction: mapping.direction, source: 'MAPPING_REGISTERED', mappingType: mapping.adjustmentType }
  return { ok: true, direction: null, source: null, pendingReason: 'NO_DIRECTION' }
}

/**
 * 可调整余额（MA-03）：按交割片段（月）展示当前有效义务 = 当前合同版本该月的正式月度分解量。
 * 内部估算分解不计入可调余额（本就不进持仓）；未分解电量池不属于任何片段，不参与片段校验。
 * @param {{ allocations?: Array<{ deliveryMonth: string, quantity: string, evidenceBasis: string }>,
 *           months?: string[] }} input
 * @returns {Array<{ deliveryMonth: string, adjustableQuantity: string, hasFormalAllocation: boolean }>}
 *   请求的每个月一行，未请求但有正式分解的月份不返回（前端按需展示全部月份可用 balance 接口）。
 */
export function adjustableBalanceRows({ allocations = [], months = [] } = {}) {
  const formal = new Map()
  for (const a of allocations) {
    if (a?.evidenceBasis !== 'FORMAL') continue
    formal.set(a.deliveryMonth, decimalAdd(formal.get(a.deliveryMonth) ?? '0', normNum(a.quantity) ?? '0'))
  }
  return [...new Set(months)].sort().map((deliveryMonth) => ({
    deliveryMonth,
    adjustableQuantity: formal.has(deliveryMonth) ? formal.get(deliveryMonth) : '0',
    hasFormalAllocation: formal.has(deliveryMonth),
  }))
}

/**
 * 调整作用后的新分解快照（MA-03/MA-04 核心）：只改指定交割片段，未受影响片段逐字段复制原值
 * （量、价、价格状态、证据基础、来源行），绝不按比例缩小其他片段。
 * 方向为 DECREASE 时逐片段校验：变化量不得超过该片段当前有效义务（正式分解量），
 * 超过的片段进入 exceeded（调用方据此 422 并展示可调量），不产生部分应用的结果。
 * 片段必须有正式分解行（没有分解的月份不属于任何片段，其电量在未分解池里，不能用片段调整改写）。
 * @param {{ allocations?: Array<{ deliveryMonth: string, quantity: string, price?: string|null, priceStatus?: string,
 *            evidenceBasis: string, derivation?: string }>,
 *           direction?: string|null, segments?: Array<{ deliveryMonth: string, quantity: string }> }} input
 * @returns {{ ok: boolean, exceeded?: Array<{ deliveryMonth: string, requested: string, adjustable: string }>,
 *           missing?: string[], allocations?: Array<object>, deltas?: Array<{ deliveryMonth: string, before: string,
 *           after: string, delta: string }>, totalDelta?: string }}
 */
export function applyAdjustmentToAllocations({ allocations = [], direction = null, segments = [] } = {}) {
  const formal = allocations.filter((a) => a?.evidenceBasis === 'FORMAL')
  const byMonth = new Map(formal.map((a) => [a.deliveryMonth, a]))
  const requested = new Map((Array.isArray(segments) ? segments : []).map((s) => [s.deliveryMonth, normNum(s.quantity) ?? '0']))

  const exceeded = []
  const missing = []
  for (const [deliveryMonth, quantity] of requested) {
    const current = byMonth.get(deliveryMonth)
    if (!current) { missing.push(deliveryMonth); continue }
    if (direction === 'OBLIGATION_DECREASE' && decimalCompare(current.quantity, quantity) < 0) {
      exceeded.push({ deliveryMonth, requested: quantity, adjustable: current.quantity })
    }
  }
  if (exceeded.length || missing.length) return { ok: false, exceeded, missing }

  const deltas = []
  let totalDelta = '0'
  const next = allocations.map((a) => {
    const change = requested.get(a.deliveryMonth)
    if (a.evidenceBasis !== 'FORMAL' || change === undefined) return { ...a }
    const sign = direction === 'OBLIGATION_INCREASE' ? 1 : -1
    const after = sign > 0 ? decimalAdd(a.quantity, change) : decimalSub(a.quantity, change)
    const delta = sign > 0 ? change : decimalSub('0', change)
    totalDelta = decimalAdd(totalDelta, delta)
    deltas.push({ deliveryMonth: a.deliveryMonth, before: a.quantity, after, delta })
    // 减到 0 的片段保留该月行（quantity=0），使「该月义务已终止」在快照中可见。
    return { ...a, quantity: after }
  })
  return { ok: true, allocations: next, deltas, totalDelta }
}

