// 云南中长期售电合同（P1）的共享契约（#2938，Epic #2937）。
//
// 单一事实源：后端 server/midlong/* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、错误码与导入模板声明。零依赖、前后端同构。
//
// 边界（openspec build-yunnan-midlong-trading · MW-01/MC-01）：
// - 只纳管「电源侧售电」的中长期合同；现货（日前/实时）与零售合同不得被纳管。
// - 合同交易类型拆成相互独立的维度：交易品种周期（年度/月度/月内）、交割周期、交易方式、
//   市场范围、电能属性——不再把它们揉进一个 marketType 枚举。
// - P1 只开放「录入更正」一种经济变更；外部调整、转让、部分终止属于 P4，出现即 UNSUPPORTED_PRODUCT。

export const MIDLONG_API_PREFIX = '/api/v1/midlong'

/** P1 试点地区。其他地区诚实返回空并标注不支持，不回退、不串读。 */
export const MIDLONG_PILOT_REGIONS = Object.freeze(['yunnan'])

export const DOCUMENT_KINDS = Object.freeze(['FRAMEWORK', 'OBLIGATION'])
export const PRODUCT_KINDS = Object.freeze(['ANNUAL', 'MONTHLY', 'INTRA_MONTH'])
export const DELIVERY_CYCLES = Object.freeze(['YEAR', 'MULTI_MONTH', 'MONTH', 'WITHIN_MONTH'])
export const TRADE_METHODS = Object.freeze(['BILATERAL', 'CENTRALIZED_BIDDING', 'LISTING', 'CENTRALIZED_MATCHING'])
export const MARKET_SCOPES = Object.freeze(['PROVINCIAL', 'INTER_PROVINCIAL'])
export const ENERGY_ATTRIBUTES = Object.freeze(['CONVENTIONAL', 'GREEN'])
export const TRADING_SIDES = Object.freeze(['SELL'])

export const CONFIRMATION_STATUSES = Object.freeze(['DRAFT', 'PENDING_VERIFICATION', 'CONFIRMED', 'VOIDED'])
export const DELIVERY_PROGRESS_VALUES = Object.freeze(['NOT_STARTED', 'IN_DELIVERY', 'DELIVERY_ENDED', 'UNKNOWN'])

export const QUALITY_FLAGS = Object.freeze([
  'MISSING_SUBJECT',
  'SUBJECT_UNIT_CODE_MISSING',
  'STATION_UNALLOCATED',
  'MISSING_EVIDENCE',
  'MISSING_QUANTITY',
  'MISSING_DELIVERY_PERIOD',
  'MISSING_PRICE',
  'TAX_BASIS_UNKNOWN',
  'PRICE_COMPONENT_UNVERIFIED',
  'MISSING_MONTHLY_ALLOCATION',
  'PARTIAL_MONTHLY_ALLOCATION',
  'ESTIMATED_ALLOCATION_EXCLUDED',
  'LEGACY_BUYER_PRICE_ONLY',
])

export const PRICE_TYPES = Object.freeze(['FIXED', 'TIME_OF_USE'])
export const PRICE_STATUSES = Object.freeze(['KNOWN', 'UNKNOWN'])
export const TAX_BASES = Object.freeze(['TAX_INCLUDED', 'TAX_EXCLUDED', 'UNKNOWN'])
export const PRICE_COMPONENTS = Object.freeze(['ENERGY_ONLY', 'ENERGY_WITH_ENVIRONMENT', 'UNVERIFIED'])
export const CURRENCIES = Object.freeze(['CNY'])
export const EVIDENCE_BASES = Object.freeze(['FORMAL', 'INTERNAL_ESTIMATE'])
export const ALLOCATION_COMPLETENESS = Object.freeze(['COMPLETE', 'PARTIAL', 'NONE'])
/** 月分解行的来源：文件/人工录入的明细行，或「单月交割期」由合同条款直接确定。 */
export const ALLOCATION_DERIVATIONS = Object.freeze(['SOURCE_ROW', 'SINGLE_MONTH_TERMS'])

export const EVIDENCE_DOCUMENT_TYPES = Object.freeze([
  'ELECTRONIC_CONFIRMATION',
  'PAPER_CONTRACT',
  'TRADING_CENTER_EXPORT',
  'IMPORT_SOURCE_FILE',
  'SUPPLEMENT_SCAN',
  'OTHER',
])
/** 可作为「确认真实义务」依据的资料类型（MC-03：有效电子确认单即可，无需另附纸质合同）。 */
export const VERIFICATION_EVIDENCE_TYPES = Object.freeze(['ELECTRONIC_CONFIRMATION', 'PAPER_CONTRACT', 'TRADING_CENTER_EXPORT'])

export const REVISION_KINDS = Object.freeze(['INITIAL', 'BASELINE', 'CORRECTION'])
export const REVISION_STATUSES = Object.freeze(['DRAFT', 'CONFIRMED'])
export const CONTRACT_ORIGINS = Object.freeze(['MANUAL', 'IMPORT', 'ONBOARDING'])
/** P1 开放的经济变更类型。 */
export const CHANGE_TYPES = Object.freeze(['CORRECTION'])
/** 属于 P4 的变更类型：P1 明确拒绝，不自动映射。 */
export const DEFERRED_CHANGE_TYPES = Object.freeze(['ADJUSTMENT', 'TRANSFER', 'PARTIAL_TERMINATION'])

export const EVENT_TYPES = Object.freeze([
  'CREATED', 'DRAFT_UPDATED', 'IMPORTED', 'ONBOARDED', 'VERIFIED', 'CORRECTED', 'VOIDED',
  'EVIDENCE_ADDED', 'ALIAS_LINKED',
])

export const MIDLONG_ERROR_CODES = Object.freeze([
  'VALIDATION_FAILED',
  'SCOPE_DENIED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'PREVIEW_STALE',
  'BUSINESS_KEY_CONFLICT',
  'CONFIRMED_WRITE_PROTECTED',
  'MANAGED_BY_MIDLONG',
  'INCOMPLETE_BASIS',
  'UNSUPPORTED_PRODUCT',
  'UNSUPPORTED_REGION',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'EVIDENCE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'MODULE_DISABLED',
])

/** 数值导入默认最多保留的小数位；更多位须用户确认后按四舍五入保存（原文另存）。 */
export const MAX_IMPORT_DECIMALS = 6

/** 电量单位 → MWh 的换算系数（十进制字符串，精确换算）。 */
export const ENERGY_UNIT_FACTORS = Object.freeze({
  MWh: '1',
  kWh: '0.001',
  万kWh: '10',
  GWh: '1000',
  亿kWh: '100000',
})
/** 价格单位 → 元/MWh 的换算系数。 */
export const PRICE_UNIT_FACTORS = Object.freeze({
  '元/MWh': '1',
  '元/kWh': '1000',
  '元/千瓦时': '1000',
  '元/兆瓦时': '1',
  '分/kWh': '10',
})
export const CANONICAL_ENERGY_UNIT = 'MWh'
export const CANONICAL_PRICE_UNIT = '元/MWh'

// ── 中文标签（页面与导入模板共用）─────────────────────────────────────────────

export const DOCUMENT_KIND_LABELS = Object.freeze({ FRAMEWORK: '框架协议', OBLIGATION: '电量合同' })
export const PRODUCT_KIND_LABELS = Object.freeze({ ANNUAL: '年度', MONTHLY: '月度', INTRA_MONTH: '月内' })
export const DELIVERY_CYCLE_LABELS = Object.freeze({ YEAR: '整年', MULTI_MONTH: '跨多月', MONTH: '单月', WITHIN_MONTH: '月内时段' })
export const TRADE_METHOD_LABELS = Object.freeze({
  BILATERAL: '双边协商', CENTRALIZED_BIDDING: '集中竞价', LISTING: '挂牌', CENTRALIZED_MATCHING: '集中撮合',
})
export const MARKET_SCOPE_LABELS = Object.freeze({ PROVINCIAL: '省内', INTER_PROVINCIAL: '省间' })
export const ENERGY_ATTRIBUTE_LABELS = Object.freeze({ CONVENTIONAL: '常规电能', GREEN: '绿电' })
export const CONFIRMATION_STATUS_LABELS = Object.freeze({
  DRAFT: '草稿', PENDING_VERIFICATION: '待核对', CONFIRMED: '已确认', VOIDED: '已作废',
})
export const DELIVERY_PROGRESS_LABELS = Object.freeze({
  NOT_STARTED: '未开始交割', IN_DELIVERY: '交割中', DELIVERY_ENDED: '交割期已结束', UNKNOWN: '交割期未知',
})
export const QUALITY_FLAG_LABELS = Object.freeze({
  MISSING_SUBJECT: '交易主体待补',
  SUBJECT_UNIT_CODE_MISSING: '交易单元代码待补',
  STATION_UNALLOCATED: '场站未分配',
  MISSING_EVIDENCE: '缺核验依据',
  MISSING_QUANTITY: '合同电量缺失',
  MISSING_DELIVERY_PERIOD: '交割期缺失',
  MISSING_PRICE: '售电价格待核对',
  TAX_BASIS_UNKNOWN: '含税口径未知',
  PRICE_COMPONENT_UNVERIFIED: '价格构成未核对',
  MISSING_MONTHLY_ALLOCATION: '无月度分解',
  PARTIAL_MONTHLY_ALLOCATION: '月度分解不完整',
  ESTIMATED_ALLOCATION_EXCLUDED: '含内部估算分解（不计入持仓）',
  LEGACY_BUYER_PRICE_ONLY: '旧资料仅有买方价格',
})
export const PRICE_TYPE_LABELS = Object.freeze({ FIXED: '固定价', TIME_OF_USE: '分时价' })
export const TAX_BASIS_LABELS = Object.freeze({ TAX_INCLUDED: '含税', TAX_EXCLUDED: '不含税', UNKNOWN: '未知' })
export const PRICE_COMPONENT_LABELS = Object.freeze({
  ENERGY_ONLY: '电能量价', ENERGY_WITH_ENVIRONMENT: '电能量与环境价值合计', UNVERIFIED: '未核对',
})
export const EVIDENCE_BASIS_LABELS = Object.freeze({ FORMAL: '正式资料', INTERNAL_ESTIMATE: '内部估算' })
export const EVIDENCE_DOCUMENT_TYPE_LABELS = Object.freeze({
  ELECTRONIC_CONFIRMATION: '电子交易确认单',
  PAPER_CONTRACT: '纸质合同扫描件',
  TRADING_CENTER_EXPORT: '交易中心系统导出',
  IMPORT_SOURCE_FILE: '导入原始文件',
  SUPPLEMENT_SCAN: '补充资料',
  OTHER: '其他',
})
export const REVISION_KIND_LABELS = Object.freeze({ INITIAL: '初始录入', BASELINE: '存量纳管基线', CORRECTION: '录入更正' })
export const EVENT_TYPE_LABELS = Object.freeze({
  CREATED: '创建草稿', DRAFT_UPDATED: '修改草稿', IMPORTED: '文件导入', ONBOARDED: '存量纳管', VERIFIED: '核验确认',
  CORRECTED: '录入更正', VOIDED: '纠错作废', EVIDENCE_ADDED: '补充资料', ALIAS_LINKED: '关联外部编号',
})
export const MIDLONG_ERROR_LABELS = Object.freeze({
  VALIDATION_FAILED: '资料校验未通过',
  SCOPE_DENIED: '无权操作该公司或对象',
  NOT_FOUND: '合同不存在或不属于当前公司',
  VERSION_CONFLICT: '合同已被他人更新，请刷新后核对差异',
  PREVIEW_STALE: '预览已过期或数据已变化，请重新预览',
  BUSINESS_KEY_CONFLICT: '同一外部编号已存在不同内容的合同',
  CONFIRMED_WRITE_PROTECTED: '已确认合同不能直接修改或删除，请使用更正或作废',
  MANAGED_BY_MIDLONG: '该合同已纳入中长期售电管理，请在中长期合同页面操作',
  INCOMPLETE_BASIS: '核验依据不完整',
  UNSUPPORTED_PRODUCT: '当前阶段不支持该交易品种或变更类型',
  UNSUPPORTED_REGION: '当前地区尚未开通中长期售电模块',
  IDEMPOTENCY_KEY_REQUIRED: '缺少提交标识',
  IDEMPOTENCY_KEY_REUSED: '提交标识已用于不同内容的请求',
  EVIDENCE_UNAVAILABLE: '资料文件读取失败',
  STORAGE_UNAVAILABLE: '合同存储暂不可用',
  MODULE_DISABLED: '中长期售电模块已暂停使用（已确认合同仍受保护）',
})

// ── 旧合同底账兼容投影 ─────────────────────────────────────────────────────────
// 纳管合同在 company.contracts 保留一行「兼容投影」（旧 ID 与旧读接口不变），
// 版本与月分解才是计算权威。旧 marketType 只作投影与存量分类用，不回推新维度。

/** 新维度 → 旧 marketType（兼容投影）。 */
export function legacyMarketTypeOf({ productKind, tradeMethod, energyAttribute, marketScope }) {
  const annual = productKind === 'ANNUAL'
  if (energyAttribute === 'GREEN') {
    const prefix = marketScope === 'INTER_PROVINCIAL' ? 'cross_provincial_green' : 'provincial_green'
    return `${prefix}_${annual ? 'annual' : 'monthly'}`
  }
  const period = annual ? 'annual' : 'monthly'
  return `${period}_${tradeMethod === 'BILATERAL' ? 'bilateral' : 'centralized'}`
}

export const LEGACY_TRADE_MODE_OF = Object.freeze({
  BILATERAL: 'bilateral', CENTRALIZED_BIDDING: 'centralized', LISTING: 'listing', CENTRALIZED_MATCHING: 'matching',
})

export const LEGACY_STATUS_OF = Object.freeze({
  DRAFT: 'draft', PENDING_VERIFICATION: 'draft', CONFIRMED: 'active', VOIDED: 'cancelled',
})

/** 旧 marketType 中可作为「中长期售电候选」的类型；日前/实时是现货，日内撮合口径未核实。 */
export const LEGACY_MIDLONG_MARKET_TYPES = Object.freeze([
  'annual_bilateral', 'annual_centralized', 'monthly_bilateral', 'monthly_centralized',
  'provincial_green_annual', 'provincial_green_monthly', 'cross_provincial_green_annual', 'cross_provincial_green_monthly',
])
export const LEGACY_SPOT_MARKET_TYPES = Object.freeze(['day_ahead', 'real_time'])

/**
 * 存量合同分类（MW-01/MW-05）：只读判断，返回 { category, reasons }。
 * category：MIDLONG_CANDIDATE（候选，仍需人工确认电源侧售电后才能纳管）/ SPOT / RETAIL / UNKNOWN。
 * 判据只用已持久化的明确字段；缺字段或口径未核实一律 UNKNOWN，不猜测。
 */
export function classifyLegacyContract(row) {
  const reasons = []
  const subjectType = String(row?.subjectType ?? row?.subject_type ?? '').trim()
  const settlementRelation = String(row?.settlementRelation ?? row?.settlement_relation ?? '').trim()
  const marketType = String(row?.marketType ?? row?.market_type ?? '').trim()
  if (subjectType === 'retail_customer' || settlementRelation.startsWith('retail')) {
    reasons.push('零售客户或零售结算关系')
    return { category: 'RETAIL', reasons }
  }
  if (LEGACY_SPOT_MARKET_TYPES.includes(marketType)) {
    reasons.push('现货（日前/实时）交易类型')
    return { category: 'SPOT', reasons }
  }
  const deferredKeyword = deferredProductKeywordOf(row?.contractName ?? row?.contract_name)
  if (deferredKeyword) {
    // 合约转让/回购/置换的义务方向要凭核验单据确定（MA-02），不能按普通售电合同纳管。
    reasons.push(`交易名称含「${deferredKeyword}」，属于后续阶段（成交确认与转让调整）品种，义务方向未核实`)
    return { category: 'UNKNOWN', reasons }
  }
  if (LEGACY_MIDLONG_MARKET_TYPES.includes(marketType)) {
    reasons.push('中长期交易类型；是否为电源侧售电需人工确认')
    return { category: 'MIDLONG_CANDIDATE', reasons }
  }
  reasons.push(marketType ? `交易类型 ${marketType} 口径未核实` : '缺交易类型')
  return { category: 'UNKNOWN', reasons }
}

// ── 标准导入模板（MI-01）────────────────────────────────────────────────────────
// 列名为中文表头；aliases 为可接受的别名。unitIn 标注电量/价格列的单位可从表头括号读取，
// 如「合同电量（MWh）」。choices 为中文取值 → 枚举值。

const DOCUMENT_KIND_CHOICES = { 电量合同: 'OBLIGATION', 电量义务: 'OBLIGATION', 框架协议: 'FRAMEWORK' }
const PRODUCT_KIND_CHOICES = { 年度: 'ANNUAL', 月度: 'MONTHLY', 月内: 'INTRA_MONTH' }
const DELIVERY_CYCLE_CHOICES = { 整年: 'YEAR', 跨多月: 'MULTI_MONTH', 单月: 'MONTH', 月内时段: 'WITHIN_MONTH' }
const TRADE_METHOD_CHOICES = {
  双边协商: 'BILATERAL', 双边: 'BILATERAL', 集中竞价: 'CENTRALIZED_BIDDING', 挂牌: 'LISTING', 集中撮合: 'CENTRALIZED_MATCHING',
}
const MARKET_SCOPE_CHOICES = { 省内: 'PROVINCIAL', 省间: 'INTER_PROVINCIAL' }
const ENERGY_ATTRIBUTE_CHOICES = { 常规: 'CONVENTIONAL', 常规电能: 'CONVENTIONAL', 绿电: 'GREEN' }
const PRICE_TYPE_CHOICES = { 固定价: 'FIXED', 分时价: 'TIME_OF_USE' }
const TAX_BASIS_CHOICES = { 含税: 'TAX_INCLUDED', 不含税: 'TAX_EXCLUDED', 未知: 'UNKNOWN' }
const PRICE_COMPONENT_CHOICES = { 电能量价: 'ENERGY_ONLY', 电能量与环境价值合计: 'ENERGY_WITH_ENVIRONMENT', 未核对: 'UNVERIFIED' }
const EVIDENCE_BASIS_CHOICES = { 正式资料: 'FORMAL', 内部估算: 'INTERNAL_ESTIMATE' }
const YES_NO_CHOICES = { 是: true, 否: false }
/** 出现这些字样的交易名称属于 P4（合约转让等），P1 拒绝导入而不是自动映射。 */
export const DEFERRED_PRODUCT_KEYWORDS = Object.freeze(['合约转让', '合同转让', '转让交易', '回购', '置换'])

/** 合同/交易名称命中的后续阶段品种关键词；未命中返回 null。导入、手工录入与存量盘点共用同一判据。 */
export function deferredProductKeywordOf(name) {
  const text = String(name ?? '')
  return DEFERRED_PRODUCT_KEYWORDS.find((kw) => text.includes(kw)) ?? null
}

export const IMPORT_CONTRACT_COLUMNS = Object.freeze([
  { key: 'externalObligationId', name: '外部合同编号', aliases: ['合同编号', '确认单编号', '合同号', 'contractId'], required: true },
  { key: 'contractName', name: '合同名称', aliases: ['交易名称', 'tradeName'], required: true },
  { key: 'documentKind', name: '文件类型', aliases: [], required: true, choices: DOCUMENT_KIND_CHOICES },
  { key: 'subjectKey', name: '交易主体编码', aliases: ['主体编码'], required: false },
  { key: 'station', name: '场站', aliases: ['场站名称', '电厂'], required: false },
  { key: 'productKind', name: '交易品种周期', aliases: ['品种周期'], required: true, choices: PRODUCT_KIND_CHOICES },
  { key: 'deliveryCycle', name: '交割周期', aliases: [], required: false, choices: DELIVERY_CYCLE_CHOICES },
  { key: 'tradeMethod', name: '交易方式', aliases: [], required: true, choices: TRADE_METHOD_CHOICES },
  { key: 'marketScope', name: '市场范围', aliases: [], required: true, choices: MARKET_SCOPE_CHOICES },
  { key: 'energyAttribute', name: '电能属性', aliases: [], required: true, choices: ENERGY_ATTRIBUTE_CHOICES },
  { key: 'counterpartyName', name: '购电方', aliases: ['对手方', '买方名称', 'buyerName'], required: false },
  { key: 'signedDate', name: '签订日期', aliases: ['成交日期'], required: false, type: 'date' },
  { key: 'deliveryStart', name: '交割开始日期', aliases: ['交割开始', 'deliveryPeriodBegin'], required: true, type: 'date' },
  { key: 'deliveryEnd', name: '交割结束日期', aliases: ['交割结束', 'deliveryPeriodEnd'], required: true, type: 'date' },
  { key: 'totalQuantity', name: '合同电量', aliases: ['电量', 'volume'], required: false, unitIn: 'energy' },
  { key: 'quantityUnit', name: '电量单位', aliases: [], required: false },
  { key: 'sellerPrice', name: '售电价格', aliases: ['合同价格', '价格', 'price'], required: false, unitIn: 'price' },
  { key: 'priceUnit', name: '价格单位', aliases: [], required: false },
  { key: 'priceType', name: '价格类型', aliases: [], required: false, choices: PRICE_TYPE_CHOICES },
  { key: 'taxBasis', name: '含税口径', aliases: [], required: false, choices: TAX_BASIS_CHOICES },
  { key: 'priceComponent', name: '价格构成', aliases: [], required: false, choices: PRICE_COMPONENT_CHOICES },
  { key: 'environmentPrice', name: '环境价值价格', aliases: [], required: false, unitIn: 'price' },
  { key: 'allocationDeclaredComplete', name: '月度分解是否完整', aliases: ['分解是否完整'], required: false, choices: YES_NO_CHOICES },
  { key: 'sourceNamespace', name: '来源', aliases: ['来源命名空间'], required: false },
  { key: 'remarks', name: '备注', aliases: [], required: false },
])

export const IMPORT_ALLOCATION_COLUMNS = Object.freeze([
  { key: 'externalObligationId', name: '外部合同编号', aliases: ['合同编号', '确认单编号', '合同号', 'contractId'], required: true },
  { key: 'subjectKey', name: '交易主体编码', aliases: ['主体编码'], required: false },
  { key: 'deliveryMonth', name: '交割月份', aliases: ['月份'], required: true, type: 'month' },
  { key: 'quantity', name: '月度电量', aliases: ['电量'], required: true, unitIn: 'energy' },
  { key: 'quantityUnit', name: '电量单位', aliases: [], required: false },
  { key: 'price', name: '月度售电价格', aliases: ['价格'], required: false, unitIn: 'price' },
  { key: 'priceUnit', name: '价格单位', aliases: [], required: false },
  { key: 'evidenceBasis', name: '依据类型', aliases: [], required: true, choices: EVIDENCE_BASIS_CHOICES },
])

export const IMPORT_SHEETS = Object.freeze({ contracts: '合同主表', allocations: '月度分解' })

/** 模板示例行（明确是示例：导入时以 # 开头的行被忽略，示例值不代表任何真实合同）。 */
export const IMPORT_TEMPLATE_SAMPLES = Object.freeze({
  contracts: [[
    'SAMPLE-2027-001', '示例：2027 年度双边售电合同', '电量合同', 'SUBJ-SAMPLE', '示例风电场', '年度', '整年', '双边协商', '省内', '常规',
    '示例购电方', '2026-12-10', '2027-01-01', '2027-12-31', '12000', 'MWh', '300', '元/MWh', '固定价', '含税', '电能量价', '', '否', 'SAMPLE', '示例行，请替换',
  ]],
  allocations: [
    ['SAMPLE-2027-001', 'SUBJ-SAMPLE', '2027-01', '800', 'MWh', '', '', '正式资料'],
  ],
})
