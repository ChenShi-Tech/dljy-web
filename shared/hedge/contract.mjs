// 中长期与现货套保的共享契约（openspec build-midlong-spot-hedging，Epic #3037）。
//
// 单一事实源：后端 server/hedge/* 与前端（经 sync:web 同步到 dljy-web 只读）共用这里的
// 枚举、中文标签、错误码、响应形状与「标准指标 → 期限档 → 口径」对照表。零依赖、前后端同构。
//
// 边界（design D1/D15）：
// - 套保是现货侧独立模块，只读消费中长期台账；中长期模块不反向依赖本目录。
// - 只对云南开放；其他地区的请求一律「该地区未开放」（UNSUPPORTED_REGION）。
// - 未知值全程用 null 传播，数值一律用十进制字符串（复用 shared/midlong/decimal.mjs）。

export const HEDGE_API_PREFIX = '/api/v1/hedge'

/** 本变更只开放云南（design D15）。其他地区不读取任何套保数据。 */
export const HEDGE_REGIONS = Object.freeze(['yunnan'])

// ── 附录 G 枚举 ────────────────────────────────────────────────────────────────

/** 数据腿标识（meta.watermarks 与 legs[] 的键）。 */
export const LEG_KEYS = Object.freeze([
  'LEDGER', 'LABELS', 'MECHANISM', 'ACTUAL', 'FORECAST_MODEL', 'FORECAST_VENDOR', 'PRICE', 'BAND', 'BASELINE', 'CAPS',
])

/** 数据腿状态。STALE 只允许出现在 ACTUAL、FORECAST_*、PRICE 三类数据腿上（HW-01）。 */
export const LEG_STATUSES = Object.freeze(['OK', 'PARTIAL', 'STALE', 'FAILED', 'FORBIDDEN', 'UNSUPPORTED', 'NOT_CONFIGURED'])
export const STALE_ELIGIBLE_LEG_KEYS = Object.freeze(['ACTUAL', 'FORECAST_MODEL', 'FORECAST_VENDOR', 'PRICE'])

/** 发电来源（HG-01）：每个「场站 × 时段」只能取这三种之一。 */
export const INTERVAL_SOURCES = Object.freeze(['ACTUAL', 'FORECAST', 'UNCOVERED'])

/** 未覆盖原因（HG-01/HF）。 */
export const UNCOVERED_REASONS = Object.freeze([
  'ACTUAL_MISSING', 'IN_PROGRESS', 'NO_FORECAST_SOURCE', 'FORECAST_NOT_ARRIVED', 'MODEL_NOT_ADMITTED', 'STALE_INPUT', 'RUN_PURGED', 'UNMAPPED',
])
export const UNCOVERED_REASON_LABELS = Object.freeze({
  ACTUAL_MISSING: '实际缺失',
  IN_PROGRESS: '时段进行中',
  NO_FORECAST_SOURCE: '无预测来源',
  FORECAST_NOT_ARRIVED: '预测未到达',
  MODEL_NOT_ADMITTED: '自研模型未准入',
  STALE_INPUT: '输入过期',
  RUN_PURGED: '预测运行已清理',
  UNMAPPED: '对象名称未映射',
})

/** 套保率口径（HM-02）。 */
export const RATIO_BASES = Object.freeze(['INTERVAL', 'BASELINE'])
/** 含机制 / 仅中长期（HM-01）。 */
export const LOCK_BASES = Object.freeze(['WITH_MECHANISM', 'MIDLONG_ONLY'])

/** 期限档（HB-02）：区间按距离交割的期限分三档。 */
export const TIERS = Object.freeze(['DAY_AHEAD', 'INTRA_MONTH', 'FORWARD'])
export const TIER_LABELS = Object.freeze({ DAY_AHEAD: '日前档', INTRA_MONTH: '月内档', FORWARD: '远期档' })

/** 标准指标（HB-02 对照表的键）：判级只对这些指标执行。 */
export const STANDARD_METRICS = Object.freeze(['TODAY2_INTERVAL', 'MONTH_INTERVAL', 'MONTH_BASELINE', 'FORWARD_BASELINE'])
export const STANDARD_METRIC_LABELS = Object.freeze({
  TODAY2_INTERVAL: '今明两日逐时段套保率',
  MONTH_INTERVAL: '当月逐时段套保率',
  MONTH_BASELINE: '当月全月基准套保率',
  FORWARD_BASELINE: '后续月份基准套保率',
})

/**
 * 标准指标 → 期限档 → 口径 对照表（HB-02）。
 * 「今天」「明天」「当月」以评估时刻 T 为准：当前视图取当前时刻，历史视图取认知时点。
 * 边界：次日属下月时，今明窗口仍按日前档判级；下月月度指标照常按远期档，两者互不替代。
 */
export const STANDARD_METRIC_RULE = Object.freeze({
  TODAY2_INTERVAL: Object.freeze({ tier: 'DAY_AHEAD', ratioBasis: 'INTERVAL' }),
  MONTH_INTERVAL: Object.freeze({ tier: 'INTRA_MONTH', ratioBasis: 'INTERVAL' }),
  MONTH_BASELINE: Object.freeze({ tier: 'INTRA_MONTH', ratioBasis: 'BASELINE' }),
  FORWARD_BASELINE: Object.freeze({ tier: 'FORWARD', ratioBasis: 'BASELINE' }),
})

/** 判级（HM-04）。 */
export const ASSESSMENT_LEVELS = Object.freeze(['UNDER', 'WITHIN', 'OVER', 'NOT_ASSESSED'])
export const ASSESSMENT_LEVEL_LABELS = Object.freeze({ UNDER: '欠保', WITHIN: '区间内', OVER: '过保', NOT_ASSESSED: '未评估' })

/** 未评估原因，以及只设单侧界限时的提示（HM-04/HB-02/HB-03）。 */
export const ASSESSMENT_REASONS = Object.freeze([
  'NO_ACTIVE_SCHEME', 'TIER_NOT_SET', 'LOWER_NOT_SET', 'UPPER_NOT_SET', 'NOT_COMPUTABLE', 'INCOMPLETE_COVERAGE',
  'MECHANISM_INCOMPLETE', 'LEG_FAILED', 'FORBIDDEN', 'NON_STANDARD_WINDOW', 'REALIZED_NOT_ASSESSED', 'REGION_UNSUPPORTED',
  'NO_CREDENTIAL', 'UNALLOCATED_PRESENT',
])
export const ASSESSMENT_REASON_LABELS = Object.freeze({
  NO_ACTIVE_SCHEME: '套保区间未配置',
  TIER_NOT_SET: '档位未设定',
  LOWER_NOT_SET: '下限未设定',
  UPPER_NOT_SET: '上限未设定',
  NOT_COMPUTABLE: '不可计算',
  INCOMPLETE_COVERAGE: '不完整',
  MECHANISM_INCOMPLETE: '机制参数不完整',
  LEG_FAILED: '数据加载失败',
  FORBIDDEN: '无权限查看中长期持仓',
  NON_STANDARD_WINDOW: '非标准窗口',
  REALIZED_NOT_ASSESSED: '已实现指标不判级',
  REGION_UNSUPPORTED: '该地区未开放',
  NO_CREDENTIAL: '无访问凭据',
  UNALLOCATED_PRESENT: '存在未分配锁价量',
})

/** 查询粒度与时长（分钟）。时段网格取锁价与发电两侧都支持的最粗粒度，不插值（HG-04/D8）。 */
export const GRANULARITIES = Object.freeze(['QUARTER_HOUR', 'HOUR', 'DAY'])
export const GRANULARITY_MINUTES = Object.freeze({ QUARTER_HOUR: 15, HOUR: 60, DAY: 1440 })

/** 视图：当前视图 / 认知时点视图（HW-05）。 */
export const HEDGE_VIEWS = Object.freeze(['CURRENT', 'AS_OF'])

// ── 购方类别与品种维度（HC-02/D3）─────────────────────────────────────────────
// 购方类别是合同的分类标注，不是合同版本；未标注即「未分类」，禁止按对手方名称推断。

export const BUYER_CATEGORY_DIMENSION = 'BUYER_CATEGORY'
export const BUYER_CATEGORIES = Object.freeze([
  'GRID_AGENCY', 'PRIORITY_GENERATION', 'RETAILER', 'END_USER', 'INTER_PROVINCIAL_BUYER', 'OTHER',
])
export const BUYER_CATEGORY_LABELS = Object.freeze({
  GRID_AGENCY: '电网代理购电',
  PRIORITY_GENERATION: '优先发电计划',
  RETAILER: '售电公司',
  END_USER: '电力用户',
  INTER_PROVINCIAL_BUYER: '省外购方',
  OTHER: '其他',
})
export const BUYER_CATEGORY_UNCLASSIFIED = 'UNCLASSIFIED'
export const BUYER_CATEGORY_UNCLASSIFIED_LABEL = '未分类'

/** 锁价电量支持的分维度（HC-02）；维度内部之和等于总量，维度之间不得相加。 */
export const BREAKDOWN_DIMENSIONS = Object.freeze(['productKind', 'marketScope', 'energyAttribute', 'buyerCategory', 'lockSource'])
export const BREAKDOWN_DIMENSION_LABELS = Object.freeze({
  productKind: '交易品种周期',
  marketScope: '市场范围',
  energyAttribute: '电能属性',
  buyerCategory: '购方类别',
  lockSource: '锁价来源',
})
export const LOCK_SOURCES = Object.freeze(['MIDLONG', 'MECHANISM'])
export const LOCK_SOURCE_LABELS = Object.freeze({ MIDLONG: '中长期', MECHANISM: '机制电量' })

// ── 机制参数（HC-03/D4）────────────────────────────────────────────────────────

export const MECHANISM_PARAM_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'RETIRED'])
export const MECHANISM_PARAM_STATUS_LABELS = Object.freeze({ PENDING: '待确认', CONFIRMED: '已确认', RETIRED: '已结束' })
export const MECHANISM_END_REASONS = Object.freeze(['EXPIRY', 'EXIT', 'SUPERSEDED'])
export const MECHANISM_END_REASON_LABELS = Object.freeze({ EXPIRY: '执行期到期', EXIT: '自愿退出', SUPERSEDED: '被下一年度接替' })
export const MECHANISM_PROJECT_CLASSES = Object.freeze(['EXISTING', 'INCREMENTAL'])
export const MECHANISM_PROJECT_CLASS_LABELS = Object.freeze({ EXISTING: '存量', INCREMENTAL: '增量' })
/** 市场交易均价参照口径（HC-04）：按生效期登记，不在代码里判断现货运行状态。 */
export const MECHANISM_REFERENCE_BASES = Object.freeze(['MIDLONG_MONTHLY_AVG', 'RT_NODAL_MONTHLY_AVG'])
export const MECHANISM_REFERENCE_BASIS_LABELS = Object.freeze({
  MIDLONG_MONTHLY_AVG: '同类型机组月度中长期交易加权均价（现货连续运行前）',
  RT_NODAL_MONTHLY_AVG: '同类型机组月度实时市场分时节点加权均价（现货连续运行后）',
})
/** 机制电价的价格单位。 */
export const MECHANISM_PRICE_UNIT = 'CNY_PER_MWH'

// ── 补仓试算形状（HM-07/D-附录 B.10）─────────────────────────────────────────

export const SIMULATION_SHAPES = Object.freeze(['FLAT', 'RECENT_ACTUAL_PROFILE', 'CONTRACT_CURVE'])
export const SIMULATION_SHAPE_LABELS = Object.freeze({
  FLAT: '均匀',
  RECENT_ACTUAL_PROFILE: '近 14 天实际出力形状',
  CONTRACT_CURVE: '合同分时曲线',
})

// ── 附录 C 错误码 ──────────────────────────────────────────────────────────────

export const HEDGE_ERROR_CODES = Object.freeze([
  'UNSUPPORTED_REGION',
  'VALIDATION_FAILED',
  'ASOF_IN_FUTURE',
  'MECHANISM_RATIO_INCREASE_NEEDS_NOTE',
  'BAND_TIER_INVALID',
  'BACKDATING_NOT_ALLOWED',
  'SIMULATION_EXCEEDS_LOCKED',
  'VERSION_CONFLICT',
  'FORBIDDEN',
  'HEDGE_CONSISTENCY_FAILED',
])

/** 错误码 → HTTP 状态（附录 C）。 */
export const HEDGE_ERROR_STATUS = Object.freeze({
  UNSUPPORTED_REGION: 422,
  VALIDATION_FAILED: 422,
  ASOF_IN_FUTURE: 422,
  MECHANISM_RATIO_INCREASE_NEEDS_NOTE: 422,
  BAND_TIER_INVALID: 422,
  BACKDATING_NOT_ALLOWED: 422,
  SIMULATION_EXCEEDS_LOCKED: 422,
  VERSION_CONFLICT: 409,
  FORBIDDEN: 403,
  HEDGE_CONSISTENCY_FAILED: 500,
})

export const HEDGE_ERROR_LABELS = Object.freeze({
  UNSUPPORTED_REGION: '该地区未开放',
  VALIDATION_FAILED: '参数校验未通过',
  ASOF_IN_FUTURE: '认知时点晚于当前时刻',
  MECHANISM_RATIO_INCREASE_NEEDS_NOTE: '比例高于上一年，需填写确认说明',
  BAND_TIER_INVALID: '区间档位不合法',
  BACKDATING_NOT_ALLOWED: '生效时刻不能早于操作时刻',
  SIMULATION_EXCEEDS_LOCKED: '减仓量超过该时段的中长期锁价电量',
  VERSION_CONFLICT: '数据已被他人更新，请刷新后重试',
  FORBIDDEN: '无权执行该操作',
  HEDGE_CONSISTENCY_FAILED: '守恒校验未通过',
})

// ── 附录 A 响应形状 ────────────────────────────────────────────────────────────
// 响应体一律 { data, meta }；数值为十进制字符串，未知为 null；时刻按北京时间解释。

export const HEDGE_META_KEYS = Object.freeze(['generatedAt', 'asOf', 'view', 'watermarks', 'gaps'])
/** 缺口行形状：{ code, message, affected }（meta.gaps[]）。 */
export const HEDGE_GAP_KEYS = Object.freeze(['code', 'message', 'affected'])
/** 写接口（/simulate 除外）必须携带的幂等键请求头。 */
export const HEDGE_IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** 判级依据：预置方案一律按含机制判级（附录 E）。 */
export const SCHEME_BASES = Object.freeze(['WITH_MECHANISM', 'MIDLONG_ONLY'])

/** 区间界限的合法区间（HB-03）：0—200%。 */
export const BAND_LIMIT_LOW = '0'
export const BAND_LIMIT_HIGH = '2'
