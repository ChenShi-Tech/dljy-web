// 市场洞察研究预设目录与请求解析（#3080，Epic #2989；OpenSpec insight-research-workbench 任务 13.1）。
//
// 研究工作台的白名单入口（design D9、RS01）：只有登记在这里的预设才能经
// POST /api/v1/market-insight/research/preview 运行；不引入可执行脚本或自由 SQL。
// 每个预设声明：允许的已登记 analysisId（能力链路：预设 → 已登记分析 → 已登记来源）、
// 输入角色（序列/价差/剩余需求代理/同类日特征）、允许的变换、样本条件与缺口原因。
// regionIds 是白名单：其他地区不会因为登记了云南预设而自动获得它（RS01，同 analyses 模式）。
//
// 首期只开放五类确定性内核：共同样本相关（含分组）、明确滞后比较、异常窗口扫描、
// 同类日（显式特征标准化 + 加权距离）、负荷同进度比较。同类日不默认输出预测价格；
// 相关分析不输出置信区间（未处理时序自相关），异常窗口不给因果结论（RS05）。

import { INSIGHT_ERRORS, InsightContractError, assertKnownKeys, calendarDayMs, parseExpectedResult, parseInsightContext } from './contract.mjs'
import { getInsightAnalysis } from './analyses.mjs'
import { getInsightSource, sourceFields } from './sources.mjs'
import { decimalCompare, parseDecimal, toScaled } from '../midlong/decimal.mjs'

/** 研究预览结果的 schemaVersion（有界研究结果 + 方法/样本说明 + 可保存定义草稿）。 */
export const RESEARCH_SCHEMA_VERSION = 'insight-research/v1'
/** 研究内核方法版本：算法或口径变化时递增，随结果返回（RS06 保存定义的前置）。 */
export const RESEARCH_METHOD_VERSION = 'research-kernel/1'

/** 首期开放的确定性研究内核（RS01—RS04）。 */
export const RESEARCH_KINDS = Object.freeze(['correlation', 'lag-comparison', 'anomaly-window', 'similar-day', 'progress-comparison'])
/** 分组维度：none 全样本；month 按北京日历月分组。丰/枯的官方日历未登记为指标规则，平台不臆造季节规则（D5 第 9 条）。 */
export const RESEARCH_GROUPINGS = Object.freeze(['none', 'month'])
/** 输入角色：series 直接取序列；price-spread 同对象日前−实时；residual-proxy 负荷+送出−新能源（与 supply-views 同公式）。 */
export const RESEARCH_INPUT_ROLES = Object.freeze(['series', 'price-spread', 'residual-proxy'])
/** 同类日特征的日聚合方式：等时长槽位的算术平均 / 最大值（逐日计算，当日缺任一槽不产出该日值）。 */
export const RESEARCH_FEATURE_TRANSFORMS = Object.freeze(['daily-mean', 'daily-max'])
/** D10 研究预览上限：选中对象初始最多 50 个（观测 100000 上限取服务端 insight-query.MAX_OBSERVATIONS 同值）。 */
export const RESEARCH_MAX_OBJECTS = 50
/** 明确滞后的槽位上限（含方向）：首期限一个日历日内（96 个 15 分钟槽），不搜索最优滞后。 */
export const RESEARCH_MAX_LAG_SLOTS = 96
/** 异常窗口长度上限（槽位数）：首期限一天。 */
export const RESEARCH_MAX_WINDOW_SLOTS = 96

const fail = (message, details) => { throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, message, details) }
const fail404 = (message, details) => { throw new InsightContractError(INSIGHT_ERRORS.NOT_REGISTERED, message, details) }
const fail422 = (message, details) => { throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, message, details) }
const ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/

/** 预设输入：role=series 时 parts 只有一项；price-spread 两项（日前、实时）；residual-proxy 三项（负荷、送出、新能源）。 */
function input(definition) {
  return Object.freeze({
    role: 'series',
    resolutionMinutes: null,
    ...definition,
    parts: Object.freeze(definition.parts.map(part => Object.freeze({ ...part }))),
  })
}

const priceInput = (label, sourceId, phase) => input({ role: 'series', label, parts: [{ sourceId, fieldId: 'value' }], marketPhase: phase })

function preset(definition) {
  return Object.freeze({
    version: '1',
    limits: Object.freeze({ maxDays: 366 }),
    ...definition,
    regionIds: Object.freeze([...definition.regionIds]),
    analysisIds: Object.freeze([...definition.analysisIds]),
    inputs: Object.freeze(Object.fromEntries(Object.entries(definition.inputs ?? {}).map(([key, value]) => [key, input(value)]))),
    ...(definition.features ? { features: Object.freeze(definition.features.map(feature => Object.freeze({ ...feature }))) } : {}),
    sample: Object.freeze({ ...definition.sample }),
  })
}

/**
 * 云南研究预设（RS01）。缺口原因写明「什么情况下这个预设算不出或样本变少」，不承诺替代数据。
 * 分组维度 month 只是日历月：丰/枯的官方口径未登记，分组差异只陈述结构，不冒充来水结论。
 */
export const INSIGHT_RESEARCH_PRESETS = Object.freeze([
  preset({
    presetId: 'research.price-new-energy-correlation',
    title: '云南价格 × 新能源出力（共同样本相关）',
    kind: 'correlation', regionIds: ['yunnan'],
    analysisIds: ['prices.user-series', 'supply.system-series'],
    inputs: {
      x: priceInput('用户侧日前价格', 'yn.price.user.day-ahead', 'day-ahead'),
      y: input({ role: 'series', label: '新能源出力（实际）', parts: [{ sourceId: 'yn.system.new-energy.actual', fieldId: 'value' }], resolutionMinutes: 60 }),
    },
    sample: { minSamples: 24, minCoverageRatio: '0.5' },
    gapReason: '用户侧价与新能源实际来自不同披露通道：任一侧缺时段或整日缺数，共同样本就按双方都有效的对齐时段收缩，不补零。',
  }),
  preset({
    presetId: 'research.price-load-correlation',
    title: '云南价格 × 统调负荷（共同样本相关）',
    kind: 'correlation', regionIds: ['yunnan'],
    analysisIds: ['prices.user-series', 'supply.system-series'],
    inputs: {
      x: priceInput('用户侧日前价格', 'yn.price.user.day-ahead', 'day-ahead'),
      y: input({ role: 'series', label: '统调负荷（实际）', parts: [{ sourceId: 'yn.system.load.actual', fieldId: 'value' }], resolutionMinutes: 60 }),
    },
    sample: { minSamples: 24, minCoverageRatio: '0.5' },
    gapReason: '负荷实际为 15 分钟披露曲线，按完整小时汇总后与小时价配对；缺任一原生时段的小时不产出值，不插补。',
  }),
  preset({
    presetId: 'research.residual-proxy-price-correlation',
    title: '剩余需求代理 × 价格（共同样本相关）',
    kind: 'correlation', regionIds: ['yunnan'],
    analysisIds: ['supply.system-series', 'prices.user-series'],
    inputs: {
      x: input({
        role: 'residual-proxy', label: '剩余需求代理（分析代理，预测口径）', resolutionMinutes: 60,
        parts: [
          { sourceId: 'yn.system.load.forecast', fieldId: 'value' },
          { sourceId: 'yn.transfer.send-out.forecast', fieldId: 'value' },
          { sourceId: 'yn.system.new-energy.forecast-d1', fieldId: 'value' },
        ],
      }),
      y: priceInput('用户侧日前价格', 'yn.price.user.day-ahead', 'day-ahead'),
    },
    sample: { minSamples: 24, minCoverageRatio: '0.5' },
    gapReason: '代理 = 负荷预测 + 云南总送出预测 − 新能源日前预测，三者同小时都齐才可算；本来源只有送出方向没有受入，代理是分析代理不是官方竞价空间。',
  }),
  preset({
    presetId: 'research.hydro-output-price-correlation',
    title: '云南水电出力 × 价格（共同样本相关）',
    kind: 'correlation', regionIds: ['yunnan'],
    analysisIds: ['supply.system-series', 'prices.user-series'],
    inputs: {
      x: input({ role: 'series', label: '水电出力（实际）', parts: [{ sourceId: 'yn.system.hydro.actual', fieldId: 'value' }], resolutionMinutes: 60 }),
      y: priceInput('用户侧日前价格', 'yn.price.user.day-ahead', 'day-ahead'),
    },
    sample: { minSamples: 24, minCoverageRatio: '0.5' },
    gapReason: '水电与价格的季节结构差异大：汇总相关与分月相关方向可能不同，结果同时给出两组并提示结构差异，不挑显著者作结论（RS05）。',
  }),
  preset({
    presetId: 'research.price-spread-transfer-correlation',
    title: '用户侧日前−实时价差 × 云南总送出（共同样本相关）',
    kind: 'correlation', regionIds: ['yunnan'],
    analysisIds: ['prices.user-series', 'supply.system-series'],
    inputs: {
      x: input({
        role: 'price-spread', label: '用户侧日前−实时价差', resolutionMinutes: 60,
        parts: [
          { sourceId: 'yn.price.user.day-ahead', fieldId: 'value' },
          { sourceId: 'yn.price.user.real-time', fieldId: 'value' },
        ],
      }),
      y: input({ role: 'series', label: '云南总送出（预测）', parts: [{ sourceId: 'yn.transfer.send-out.forecast', fieldId: 'value' }], resolutionMinutes: 60 }),
    },
    sample: { minSamples: 24, minCoverageRatio: '0.5' },
    gapReason: '现有来源只有云南总送出（预测）方向、没有受入与实际口径，不能当作净外送；价差只在日前与实时同小时都有效时产出，不是套利收益。',
  }),
  preset({
    presetId: 'research.price-load-lag-comparison',
    title: '云南价格 × 统调负荷（明确滞后比较）',
    kind: 'lag-comparison', regionIds: ['yunnan'],
    analysisIds: ['prices.user-series', 'supply.system-series'],
    inputs: {
      x: priceInput('用户侧日前价格', 'yn.price.user.day-ahead', 'day-ahead'),
      y: input({ role: 'series', label: '统调负荷（实际）', parts: [{ sourceId: 'yn.system.load.actual', fieldId: 'value' }], resolutionMinutes: 60 }),
    },
    sample: { minSamples: 4, minCoverageRatio: '0' },
    gapReason: '滞后量必须由研究假设显式给出（含方向），内核不搜索最优滞后；移动后仍共同的窗口收缩时样本随之减少，缺测不补零。',
  }),
  preset({
    presetId: 'research.load-progress-comparison',
    title: '统调负荷较前一日同进度比较',
    kind: 'progress-comparison', regionIds: ['yunnan'],
    analysisIds: ['supply.system-series'],
    inputs: { series: input({ role: 'series', label: '统调负荷（实际）', parts: [{ sourceId: 'yn.system.load.actual', fieldId: 'value' }], resolutionMinutes: 60 }) },
    limits: { maxDays: 1 },
    reference: { days: 1 },
    sample: { minSamples: 4, minCoverageRatio: '0' },
    gapReason: '同进度比较只对单日窗口：当日已发布到哪个时段就只和前一日同段比；前一日该段缺任何时段则不比较，历史资料包整日齐全时等同全日对比。',
  }),
  preset({
    presetId: 'research.price-anomaly-window',
    title: '用户侧实时价异常窗口扫描',
    kind: 'anomaly-window', regionIds: ['yunnan'],
    analysisIds: ['prices.user-series'],
    inputs: { series: priceInput('用户侧实时价格', 'yn.price.user.real-time', 'real-time') },
    sample: { minSamples: 2, minCoverageRatio: '0' },
    gapReason: '阈值（绝对值或该序列自身的分位数）是平台分析默认值，不是官方规则；只输出超阈窗口清单，不解释成因、不给因果结论。',
  }),
  preset({
    presetId: 'research.load-similar-day',
    title: '负荷同类日（供需特征加权距离）',
    kind: 'similar-day', regionIds: ['yunnan'],
    analysisIds: ['supply.system-series'],
    features: [
      { id: 'load-mean', label: '负荷日均出力', sourceId: 'yn.system.load.actual', fieldId: 'value', transform: 'daily-mean', resolutionMinutes: 60, weight: '0.6' },
      { id: 'new-energy-mean', label: '新能源日均出力', sourceId: 'yn.system.new-energy.actual', fieldId: 'value', transform: 'daily-mean', resolutionMinutes: 60, weight: '0.4' },
    ],
    sample: { minSamples: 8, minCoverageRatio: '0' },
    gapReason: '候选日缺任一必需特征即整日排除（不补值）；候选完整日少于最小候选数时明确返回不足；标准化参数只在候选集合内计算，不以相似度承诺价格预测。',
  }),
])

const BY_ID = new Map(INSIGHT_RESEARCH_PRESETS.map(item => [item.presetId, item]))

/** 目录查询：未登记返回 null，由调用方转成 404。 */
export function getResearchPreset(presetId) {
  return BY_ID.get(presetId) ?? null
}

/** 某地区可用的研究预设；未登记地区返回空列表，不借用其他地区的登记。 */
export function listResearchPresets(regionId) {
  return INSIGHT_RESEARCH_PRESETS.filter(item => item.regionIds.includes(regionId))
}

/** 预设引用的全部来源×字段（含派生角色的成分与同类日特征），登记自检与运行时共用。 */
export function researchPresetSources(item) {
  return [
    ...Object.values(item.inputs).flatMap(side => side.parts.map(part => ({ ...part, role: side.role }))),
    ...(item.features ?? []).map(feature => ({ sourceId: feature.sourceId, fieldId: feature.fieldId, role: 'feature' })),
  ]
}

/** 登记自检：id 唯一且格式正确、kind/角色合法、analysisId 与来源已登记、来源属于所声明的分析、同类日默认权重和恰好为 1。 */
export function validateResearchPresets(presets = INSIGHT_RESEARCH_PRESETS) {
  const errors = []
  const seen = new Set()
  const ONE = 10n ** 18n
  for (const item of presets) {
    const where = item.presetId ?? '(缺 presetId)'
    if (!ID_RE.test(item.presetId ?? '')) errors.push(`${where}: presetId 格式不正确`)
    if (seen.has(item.presetId)) errors.push(`${where}: 重复登记`)
    seen.add(item.presetId)
    if (!RESEARCH_KINDS.includes(item.kind)) errors.push(`${where}: 未知研究类型 ${item.kind}`)
    if (!item.regionIds?.length) errors.push(`${where}: 必须声明地区白名单（其他地区不自动获得预设）`)
    if (!item.title) errors.push(`${where}: 缺标题`)
    if (!item.gapReason) errors.push(`${where}: 缺缺口原因`)
    const analysisIds = item.analysisIds ?? []
    if (!analysisIds.length) errors.push(`${where}: 必须声明允许的已登记分析`)
    const analysisSourceIds = new Set(analysisIds.flatMap(id => getInsightAnalysis(id)?.sourceIds ?? []))
    for (const id of analysisIds) if (!getInsightAnalysis(id)) errors.push(`${where}: 引用了未登记的分析 ${id}`)
    for (const part of researchPresetSources(item)) {
      const source = getInsightSource(part.sourceId)
      if (!source) { errors.push(`${where}: 引用了未登记的来源 ${part.sourceId}`); continue }
      if (!sourceFields(source).some(field => field.id === part.fieldId)) errors.push(`${where}: 来源 ${part.sourceId} 没有「${part.fieldId}」字段`)
      if (!analysisSourceIds.has(part.sourceId)) errors.push(`${where}: 来源 ${part.sourceId} 不在声明的分析 ${analysisIds.join('、')} 内`)
    }
    for (const [side, spec] of Object.entries(item.inputs)) {
      if (!RESEARCH_INPUT_ROLES.includes(spec.role)) errors.push(`${where}: 输入 ${side} 未知角色 ${spec.role}`)
      const expectedParts = spec.role === 'price-spread' ? 2 : spec.role === 'residual-proxy' ? 3 : 1
      if (spec.parts.length !== expectedParts) errors.push(`${where}: 输入 ${side} 角色 ${spec.role} 应有 ${expectedParts} 个成分`)
      if (spec.resolutionMinutes !== null && ![15, 60, 1440].includes(spec.resolutionMinutes)) errors.push(`${where}: 输入 ${side} 汇总粒度只能是 15/60/1440 分钟`)
    }
    if ((item.kind === 'correlation' || item.kind === 'lag-comparison') && Object.keys(item.inputs).length < 2) {
      errors.push(`${where}: 相关与滞后比较需要 x、y 两侧输入`)
    }
    if (['anomaly-window', 'progress-comparison'].includes(item.kind) && !('series' in item.inputs)) {
      errors.push(`${where}: ${item.kind} 需要 series 输入`)
    }
    if (item.kind === 'similar-day') {
      const features = item.features ?? []
      if (features.length < 1) errors.push(`${where}: 同类日预设至少登记一个特征`)
      if (new Set(features.map(feature => feature.id)).size !== features.length) errors.push(`${where}: 同类日特征 id 重复`)
      let weightSum = 0n
      for (const feature of features) {
        if (!RESEARCH_FEATURE_TRANSFORMS.includes(feature.transform)) errors.push(`${where}: 特征 ${feature.id} 未知变换 ${feature.transform}`)
        const parsed = parseDecimal(feature.weight, { allowNegative: true, maxScale: 18 })
        if (!parsed.ok) errors.push(`${where}: 特征 ${feature.id} 默认权重必须是十进制数`)
        else weightSum += toScaled(parsed.value)
      }
      if (features.length && weightSum !== ONE) errors.push(`${where}: 同类日默认权重之和必须恰好为 1`)
    }
    if (item.kind === 'progress-comparison' && item.limits.maxDays !== 1) errors.push(`${where}: 同进度比较只对单日窗口`)
    if (item.kind !== 'progress-comparison' && item.reference !== undefined) errors.push(`${where}: 只有同进度比较声明参考期`)
    if (!Number.isSafeInteger(item.sample?.minSamples) || item.sample.minSamples < 1) errors.push(`${where}: 最低样本数必须是正整数`)
    const ratio = parseDecimal(item.sample?.minCoverageRatio ?? '', { allowNegative: true })
    if (!ratio.ok || decimalCompare(ratio.value, '0') < 0 || decimalCompare(ratio.value, '1') > 0) errors.push(`${where}: 最低覆盖率必须是 0—1 的十进制数`)
  }
  return errors
}

/**
 * 解析研究预览请求 `{ presetId, context, filters?, transformations?, mode?, asOf? }`。
 * mode/asOf 按契约住在 context 里（parseInsightContext 校验事前必须带 asOf）；
 * 顶层再给一份时必须与 context 一致，不一致直接拒绝，不静默挑一个（口径唯一）。
 */
export function parseResearchPreviewRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求体应为对象')
  assertKnownKeys(body, ['presetId', 'context', 'filters', 'transformations', 'mode', 'asOf'], '研究请求')
  if (typeof body.presetId !== 'string' || !ID_RE.test(body.presetId)) fail('研究预设标识格式不正确')
  const item = getResearchPreset(body.presetId)
  if (!item) fail404(`未登记的研究预设：${body.presetId}`)
  const contextInput = { ...(body.context ?? {}) }
  for (const key of ['mode', 'asOf']) {
    if (body[key] === undefined || body[key] === null) continue
    if (contextInput[key] !== undefined && contextInput[key] !== body[key]) fail(`「${key}」在请求与上下文中重复且不一致`)
    contextInput[key] = body[key]
  }
  const context = parseInsightContext(contextInput)
  if (!item.regionIds.includes(context.regionId)) fail404('该地区暂未开通这项研究预设')
  if (context.businessWindow.days > item.limits.maxDays) {
    throw new InsightContractError(INSIGHT_ERRORS.LIMIT_EXCEEDED, `该研究预设一次最多 ${item.limits.maxDays} 天，请缩小日期范围`, { maxDays: item.limits.maxDays })
  }
  assertKnownKeys(body.filters ?? {}, item.kind === 'correlation' ? ['groupBy'] : [], '研究筛选')
  const filters = Object.freeze(item.kind === 'correlation' ? { groupBy: groupByFilter(body.filters?.groupBy, item) } : {})
  const transformations = parseTransformations(item, body.transformations, context)
  return Object.freeze({ preset: item, context, filters, transformations })
}

function groupByFilter(value, item) {
  const allowed = item.groupings ?? RESEARCH_GROUPINGS
  const resolved = value ?? 'none'
  if (!allowed.includes(resolved)) fail422(`该预设支持的分组维度：${allowed.join('、')}`, { allowedGroupings: allowed })
  if (!RESEARCH_GROUPINGS.includes(resolved)) fail(`未登记的分组维度：${String(resolved)}`)
  return resolved
}

/** 变换参数按预设类型解析：滞后、窗口、同类日的参数必须显式给出，缺了就是缺了，不猜默认（D9）。 */
function parseTransformations(item, value, context) {
  if (value === undefined || value === null) value = {}
  if (typeof value !== 'object' || Array.isArray(value)) fail('变换参数应为对象')
  switch (item.kind) {
    case 'correlation':
      assertKnownKeys(value, [], '相关分析的变换参数')
      return Object.freeze({})
    case 'progress-comparison':
      assertKnownKeys(value, [], '同进度比较的变换参数')
      return Object.freeze({})
    case 'lag-comparison': {
      assertKnownKeys(value, ['lagSlots'], '滞后比较的变换参数')
      const lagSlots = value.lagSlots
      if (!Number.isSafeInteger(lagSlots) || lagSlots === 0) fail('滞后槽位数必须是非零整数（含方向：正数把 y 向早处对齐 k 个槽位，负数向晚处对齐）')
      if (Math.abs(lagSlots) > RESEARCH_MAX_LAG_SLOTS) {
        throw new InsightContractError(INSIGHT_ERRORS.LIMIT_EXCEEDED, `滞后槽位最多 ±${RESEARCH_MAX_LAG_SLOTS}（一个日历日），请明确给出研究假设的滞后量`, { maxLagSlots: RESEARCH_MAX_LAG_SLOTS })
      }
      return Object.freeze({ lagSlots })
    }
    case 'anomaly-window': {
      assertKnownKeys(value, ['windowSlots', 'threshold'], '异常窗口的变换参数')
      const windowSlots = value.windowSlots
      if (!Number.isSafeInteger(windowSlots) || windowSlots < 1) fail('窗口长度必须是正整数槽位数')
      if (windowSlots > RESEARCH_MAX_WINDOW_SLOTS) {
        throw new InsightContractError(INSIGHT_ERRORS.LIMIT_EXCEEDED, `窗口长度最多 ${RESEARCH_MAX_WINDOW_SLOTS} 个槽位（一个日历日）`, { maxWindowSlots: RESEARCH_MAX_WINDOW_SLOTS })
      }
      return Object.freeze({ windowSlots, threshold: parseThreshold(value.threshold) })
    }
    case 'similar-day': {
      assertKnownKeys(value, ['targetDate', 'minCandidates', 'features'], '同类日的变换参数')
      if (value.targetDate === undefined || value.targetDate === null) fail('同类日需要显式给出目标日')
      const targetMs = calendarDayMs(value.targetDate)
      const startMs = calendarDayMs(context.businessWindow.start)
      const endMs = calendarDayMs(context.businessWindow.end)
      if (targetMs < startMs || targetMs > endMs) fail('目标日必须在业务日期范围内')
      return Object.freeze(parseSimilarDay(item, value))
    }
    default:
      fail(`未登记的研究类型：${item.kind}`)
  }
}

function parseThreshold(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('阈值必须显式给出：{ kind: "absolute", value } 或 { kind: "quantile", p }')
  assertKnownKeys(value, ['kind', 'value', 'p'], '阈值')
  if (value.kind === 'absolute') {
    const parsed = parseDecimal(value.value, { allowNegative: true })
    if (!parsed.ok) fail('绝对阈值必须是十进制数')
    return Object.freeze({ kind: 'absolute', value: parsed.value })
  }
  if (value.kind === 'quantile') {
    const parsed = parseDecimal(value.p, { allowNegative: true })
    if (!parsed.ok || decimalCompare(parsed.value, '0') <= 0 || decimalCompare(parsed.value, '1') > 0) fail('分位数必须是 (0, 1] 之间的十进制数')
    return Object.freeze({ kind: 'quantile', p: parsed.value })
  }
  return fail('阈值类型只能是 absolute 或 quantile')
}

function parseSimilarDay(item, value) {
  const minCandidates = value.minCandidates ?? 8
  if (!Number.isSafeInteger(minCandidates) || minCandidates < 2) fail('最小候选数必须是 ≥2 的整数')
  let features = item.features.map(feature => ({ id: feature.id, weight: feature.weight }))
  if (value.features !== undefined && value.features !== null) {
    if (!Array.isArray(value.features) || !value.features.length) fail('特征选择应为非空列表')
    const known = new Map(features.map(feature => [feature.id, feature]))
    const seen = new Set()
    features = value.features.map(selection => {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) fail('特征选择格式不正确')
      assertKnownKeys(selection, ['id', 'weight'], '特征选择')
      const feature = known.get(selection.id)
      if (!feature) fail422(`该预设登记的特征：${[...known.keys()].join('、')}`, { allowedFeatures: [...known.keys()] })
      if (seen.has(selection.id)) fail('特征选择有重复')
      seen.add(selection.id)
      const parsed = parseDecimal(selection.weight, { allowNegative: true })
      if (!parsed.ok || decimalCompare(parsed.value, '0') <= 0) fail('特征权重必须是大于 0 的十进制数')
      return { id: selection.id, weight: parsed.value }
    })
  }
  const ONE = 10n ** 18n
  const total = features.reduce((sum, feature) => {
    const parsed = parseDecimal(feature.weight, { allowNegative: true, maxScale: 18 })
    if (!parsed.ok) fail('特征权重必须是十进制数')
    return sum + toScaled(parsed.value)
  }, 0n)
  if (total !== ONE) fail('特征权重之和必须恰好为 1')
  return { targetDate: value.targetDate, minCandidates, features: Object.freeze(features.map(feature => Object.freeze({ ...feature }))) }
}

// ── 研究定义保存（任务 14.3，RS06）───────────────────────────────────────────────────────────
/** 服务端冻结的标准研究定义 schemaVersion：定义、方法版本、源引用一起冻结，按新源重跑生成新运行版本。 */
export const RESEARCH_DEFINITION_SCHEMA_VERSION = 'insight-research-definition/v1'

const DEFINITION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 解析研究定义保存请求 `{ presetId, context, filters?, transformations?, expected, title?,
 * idempotencyKey, definitionId? }`。
 * 浏览器只提交定义与源引用（同预览请求的形状）加期望版本：不接受任何结果数据或汇总，
 * 服务端按同一研究内核重跑核验一致后才冻结；definitionId 给出即「更新已保存条目」，
 * 缺省即新建；幂等键必填，重复提交不重复创建。
 */
export function parseResearchDefinitionSaveBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('研究定义保存请求体应为对象')
  assertKnownKeys(body, ['presetId', 'context', 'filters', 'transformations', 'expected', 'title', 'idempotencyKey', 'definitionId'], '研究定义保存')
  if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.trim().length > 200) {
    fail('请提供有效的研究定义保存标识：重复提交凭它复用原条目，不会重复创建')
  }
  let definitionId = null
  if (body.definitionId !== undefined && body.definitionId !== null) {
    if (typeof body.definitionId !== 'string' || !DEFINITION_ID_RE.test(body.definitionId)) fail('研究定义标识格式不正确')
    definitionId = body.definitionId
  }
  const preview = parseResearchPreviewRequest({
    presetId: body.presetId,
    context: body.context,
    ...(body.filters !== undefined ? { filters: body.filters } : {}),
    ...(body.transformations !== undefined ? { transformations: body.transformations } : {}),
  })
  const expected = parseExpectedResult(body.expected)
  if (!expected) fail('保存研究定义必须带上你看到的结果版本：服务端重跑核对一致才会保存，不一致会提示先重跑')
  const title = body.title === undefined || body.title === null ? null : String(body.title).trim().slice(0, 200) || null
  return Object.freeze({ ...preview, definitionId, expected, title, idempotencyKey: body.idempotencyKey.trim() })
}
