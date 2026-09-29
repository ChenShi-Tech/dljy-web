// 套保补仓试算与方案对比预览的纯函数与类型（openspec build-midlong-spot-hedging 任务 8.5，HM-07/HB-05；ChenShi-Tech/dljy#3422）。
//
// 前端不算正式口径：形状展开与重算全在服务端（POST /simulate），本文件只做四件事：
// - 请求体构造与本地预校验（电量、回看天数、窗口）——校验不过不发请求；
// - 响应的防御性归一（旧后端可能缺 shapes/before，如实降级，不造字段）；
// - 422 按 details.field 定位到中文字段（shape.kind / shape.days / granularity 等）；
// - 方案对比预览（HB-05）：基于已返回的套保率用 shared 的 compareSchemes 逐一判级，纯函数、零请求。
// 页面经本文件取用 shared/hedge 与 shared/midlong 的共享规则，不直接依赖 shared/ 路径。

import { beijingToday, isIsoDate, monthFirstDay, monthKeyOf, monthLastDay, nextDay } from 'shared/midlong/dates.mjs'
import { compareSchemes } from 'shared/hedge/bands.mjs'
import { BAND_PRESETS } from 'shared/hedge/band-presets.mjs'
import {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, SIMULATION_ASSUMPTION_LABEL, SIMULATION_PROFILE_DEFAULT_DAYS,
  SIMULATION_PROFILE_MAX_DAYS, SIMULATION_SHAPE_LABELS, SIMULATION_SHAPES, STANDARD_METRIC_LABELS, STANDARD_METRIC_RULE,
} from 'shared/hedge/contract.mjs'
import type { HedgeSimulationShapeInfo, SimulationShape, StandardMetric } from 'shared/hedge/contract.mjs'
import {
  BAND_BASIS_LABELS, BAND_TIERS, BAND_TIER_LABELS, INFERENCE_NOTE, buildSchemeTiers, formatPercent,
} from './hedgeMaintenanceModel'
import type { BandBasis, BandTier, FieldFailure, TierDraft } from './hedgeMaintenanceModel'

export {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, BAND_BASIS_LABELS, BAND_TIERS, BAND_TIER_LABELS,
  INFERENCE_NOTE, SIMULATION_ASSUMPTION_LABEL, SIMULATION_SHAPE_LABELS, STANDARD_METRIC_LABELS, STANDARD_METRIC_RULE,
  formatPercent,
}

/** 试算形状三选（HM-07）：均匀 / 近 N 日实际出力形状 / 合同分时曲线。 */
export type SimulationShapeKind = SimulationShape
export const SIMULATION_SHAPE_KINDS = SIMULATION_SHAPES as readonly SimulationShapeKind[]
export const SIMULATION_SHAPE_KIND_LABELS = SIMULATION_SHAPE_LABELS as Readonly<Record<SimulationShapeKind, string>>
export const SIMULATION_PROFILE_DAYS_DEFAULT = SIMULATION_PROFILE_DEFAULT_DAYS
export const SIMULATION_PROFILE_DAYS_MAX = SIMULATION_PROFILE_MAX_DAYS

// ── 窗口（后端 resolveWindow 同口径：T 的今明两日 / T 所在整月是标准窗口，HB-02）────────

export type SimulateWindowPreset = 'TODAY2' | 'MONTH' | 'CUSTOM'

/** 评估日 T：历史视角取认知时点所在的北京时间日，当前视图取今天。asOf 无效时回落今天。 */
export function evaluationToday(asOf: string | null, now: number = Date.now()): string {
  const ms = asOf ? Date.parse(asOf) : NaN
  return Number.isFinite(ms) && ms > 0 ? beijingToday(ms) : beijingToday(now)
}

/** 窗口取值：预设按 T 推出，自定义校验起止（YYYY-MM-DD，含首尾、起始不晚于结束）；非法返回 null。 */
export function windowRange(
  preset: SimulateWindowPreset,
  custom: { from: string; to: string },
  today: string = beijingToday(),
): { fromDate: string; toDate: string } | null {
  if (preset === 'TODAY2') return { fromDate: today, toDate: nextDay(today) ?? today }
  if (preset === 'MONTH') {
    const month = monthKeyOf(today)
    if (!month) return null
    return { fromDate: monthFirstDay(month) ?? today, toDate: monthLastDay(month) ?? today }
  }
  const { from, to } = custom
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null
  return { fromDate: from, toDate: to }
}

/**
 * 标准窗口判定（与后端 resolveWindow 的 metricWindow 同口径）：
 * T 的今明两日 → TODAY2_INTERVAL；T 所在整月 → MONTH_INTERVAL；其余为非标准窗口（只展示，不判级）。
 */
export function standardMetricOfWindow(
  fromDate: string,
  toDate: string,
  today: string = beijingToday(),
): 'TODAY2_INTERVAL' | 'MONTH_INTERVAL' | null {
  if (fromDate === today && toDate === (nextDay(today) ?? today)) return 'TODAY2_INTERVAL'
  const month = monthKeyOf(today)
  if (month && fromDate === (monthFirstDay(month) ?? month) && toDate === (monthLastDay(month) ?? month)) return 'MONTH_INTERVAL'
  return null
}

// ── 输入预校验（不合法不发请求）────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** 试算电量：非零十进制数（正为补仓、负为减仓）。 */
export function parseQuantityMwh(text: string): ParseResult<string> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: '请填写试算电量（MWh，正为补仓、负为减仓）' }
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) return { ok: false, message: '试算电量须为数字（MWh，正为补仓、负为减仓）' }
  if (Number(trimmed) === 0) return { ok: false, message: '试算电量不能为 0（不调整无需试算）' }
  return { ok: true, value: trimmed }
}

/** 近 N 日形状的回看天数：缺省 14，整数 1—60（后端 SIMULATION_PROFILE_* 同口径）。 */
export function parseProfileDays(text: string): ParseResult<number> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: SIMULATION_PROFILE_DAYS_DEFAULT }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > SIMULATION_PROFILE_DAYS_MAX) {
    return { ok: false, message: `回看天数须为 1—${SIMULATION_PROFILE_DAYS_MAX} 的整数（缺省 ${SIMULATION_PROFILE_DAYS_DEFAULT}）` }
  }
  return { ok: true, value: Number(trimmed) }
}

// ── 请求体（HM-07：权重一律由服务端计算，客户端只传形状参数）──────────────────

/** 表单里的形状输入；stationId/days/contractId 为空表示未选（不传给后端，走服务端缺省）。 */
export interface SimulateShapeInput {
  kind: SimulationShapeKind
  stationId?: number | null
  days?: number | null
  contractId?: number | null
}

export interface SimulateRequestBody {
  window: { fromDate: string; toDate: string }
  adjustments: Array<{ quantityMwh: string; shape: { kind: SimulationShapeKind; stationId?: number; days?: number; contractId?: number } }>
}

/**
 * 组装 POST /simulate 请求体：FLAT 只有 kind；RECENT_ACTUAL_PROFILE 显式带 days（缺省 14），
 * 选了场站才带 stationId（缺省 = 范围内全部场站之和）；CONTRACT_CURVE 必须带 contractId。
 */
export function buildSimulateBody(input: { window: { fromDate: string; toDate: string }; quantityMwh: string; shape: SimulateShapeInput }): SimulateRequestBody {
  const { kind, stationId, days, contractId } = input.shape
  let shape: SimulateRequestBody['adjustments'][number]['shape']
  if (kind === 'RECENT_ACTUAL_PROFILE') {
    shape = { kind, days: days ?? SIMULATION_PROFILE_DAYS_DEFAULT }
    if (stationId != null) shape.stationId = stationId
  } else if (kind === 'CONTRACT_CURVE') {
    shape = { kind, contractId: contractId as number }
  } else {
    shape = { kind: 'FLAT' }
  }
  return {
    window: { fromDate: input.window.fromDate, toDate: input.window.toDate },
    adjustments: [{ quantityMwh: input.quantityMwh, shape }],
  }
}

// ── 失败映射（422 按 details.field 定位字段）────────────────────────────────────

export interface SimulateFailure {
  status: number
  errorCode: string
  field: string | null
  /** field 的中文名；field 为空或未收录时为 null。 */
  label: string | null
  /** 给用户看的整句提示。 */
  text: string
}

const SIMULATE_FIELD_LABELS: Readonly<Record<string, string>> = {
  'shape.kind': '试算形状',
  'shape.days': '回看天数',
  'shape.stationId': '形状场站',
  'shape.contractId': '合同曲线',
  quantityMwh: '试算电量',
  granularity: '粒度',
  window: '交割窗口',
  'window.fromDate': '交割起始日',
  'window.toDate': '交割结束日',
  adjustments: '试算区间',
  asOf: '认知时点',
}

type HedgeErrorLike = { status?: unknown; errorCode?: unknown; message?: unknown; details?: unknown }

/** 把 /simulate 的失败转成可操作提示：422 带上字段中文名，方便定位到具体输入框。 */
export function simulateFailureOf(err: unknown, fallback = '试算失败，可重试'): SimulateFailure {
  const like = err as HedgeErrorLike
  if (!(err instanceof Error) || typeof like.errorCode !== 'string') {
    const message = err instanceof Error && err.message ? err.message : ''
    return { status: 0, errorCode: 'NETWORK', field: null, label: null, text: message ? `试算失败：${message}` : fallback }
  }
  const status = typeof like.status === 'number' ? like.status : 0
  const message = typeof like.message === 'string' ? like.message : '试算失败'
  const details = like.details as Record<string, unknown> | null | undefined
  const field = details && typeof details.field === 'string' ? details.field : null
  const label = field ? SIMULATE_FIELD_LABELS[field] ?? null : null
  const where = status === 422 && field ? `（字段 ${field}${label ? `「${label}」` : ''}）` : ''
  return { status, errorCode: like.errorCode, field, label, text: `${like.errorCode}：${message}${where}` }
}

// ── 响应归一（旧后端可能缺字段：如实降级，不造字段）────────────────────────────

export interface HedgeRatioValue { value: string | null; status: string }
export interface HedgeSimulationRatio {
  coverage: { coveredCount: number | null; totalCount: number | null }
  withMechanism: HedgeRatioValue
  midlongOnly: HedgeRatioValue
}
export interface HedgeSimulationInterval {
  start: string
  covered: boolean
  generationMwh: string | null
  midlongMwh: string | null
  mechanismMwh: string | null
  /** 调整后响应才有；before.intervals 没有（正式敞口不显示，不用试算值冒充）。 */
  exposure: { withMechanism: string | null; midlongOnly: string | null } | null
}
export interface HedgeSimulationResult {
  fromDate: string | null
  toDate: string | null
  granularity: string | null
  /** 试算前的正式口径（对照基线）。 */
  before: { ratio: HedgeSimulationRatio | null; intervals: HedgeSimulationInterval[] }
  /** 调整后逐时段（含敞口）与比率。 */
  intervals: HedgeSimulationInterval[]
  ratio: HedgeSimulationRatio | null
  /** 每条调整实际用到的形状（一律标「假设」，HM-07）。 */
  shapes: HedgeSimulationShapeInfo[]
  note: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asDecimal(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function normalizeRatioValue(value: unknown): HedgeRatioValue {
  const rec = asRecord(value)
  return { value: asDecimal(rec?.value), status: typeof rec?.status === 'string' ? rec.status : 'OK' }
}

function normalizeRatio(value: unknown): HedgeSimulationRatio | null {
  const rec = asRecord(value)
  if (!rec) return null
  const coverage = asRecord(rec.coverage)
  return {
    coverage: {
      coveredCount: typeof coverage?.coveredCount === 'number' ? coverage.coveredCount : null,
      totalCount: typeof coverage?.totalCount === 'number' ? coverage.totalCount : null,
    },
    withMechanism: normalizeRatioValue(rec.withMechanism),
    midlongOnly: normalizeRatioValue(rec.midlongOnly),
  }
}

function normalizeIntervals(value: unknown): HedgeSimulationInterval[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const rec = asRecord(row) ?? {}
    const exposure = asRecord(rec.exposure)
    return {
      start: typeof rec.start === 'string' ? rec.start : '',
      covered: rec.covered === true,
      generationMwh: asDecimal(rec.generationMwh),
      midlongMwh: asDecimal(rec.midlongMwh),
      mechanismMwh: asDecimal(rec.mechanismMwh),
      exposure: exposure ? { withMechanism: asDecimal(exposure.withMechanism), midlongOnly: asDecimal(exposure.midlongOnly) } : null,
    }
  })
}

function normalizeShapes(value: unknown): HedgeSimulationShapeInfo[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const rec = asRecord(row) ?? {}
    return {
      index: typeof rec.index === 'number' ? rec.index : 0,
      kind: (typeof rec.kind === 'string' ? rec.kind : 'FLAT') as SimulationShape,
      label: typeof rec.label === 'string' ? rec.label : undefined,
      assumption: typeof rec.assumption === 'string' ? rec.assumption : undefined,
      stationId: typeof rec.stationId === 'number' ? rec.stationId : undefined,
      days: typeof rec.days === 'number' ? rec.days : undefined,
      contractId: typeof rec.contractId === 'number' ? rec.contractId : undefined,
      note: typeof rec.note === 'string' ? rec.note : undefined,
      weightedIntervalCount: typeof rec.weightedIntervalCount === 'number' ? rec.weightedIntervalCount : 0,
      skippedIntervalCount: typeof rec.skippedIntervalCount === 'number' ? rec.skippedIntervalCount : 0,
      skippedStarts: Array.isArray(rec.skippedStarts) ? rec.skippedStarts.filter((s): s is string => typeof s === 'string') : [],
    }
  })
}

/** /simulate 响应的防御性归一：结构不符返回 null（页面按加载失败处理，不渲染半份结果）。 */
export function normalizeSimulationResult(raw: unknown): HedgeSimulationResult | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const before = asRecord(rec.before)
  return {
    fromDate: typeof rec.fromDate === 'string' ? rec.fromDate : null,
    toDate: typeof rec.toDate === 'string' ? rec.toDate : null,
    granularity: typeof rec.granularity === 'string' ? rec.granularity : null,
    before: { ratio: normalizeRatio(before?.ratio), intervals: normalizeIntervals(before?.intervals) },
    intervals: normalizeIntervals(rec.intervals),
    ratio: normalizeRatio(rec.ratio),
    shapes: normalizeShapes(rec.shapes),
    note: typeof rec.note === 'string' ? rec.note : null,
  }
}

// ── 方案对比预览（HB-05：纯函数、零请求、不影响生效方案）──────────────────────

export interface CompareScheme {
  key: string
  label: string
  basis: BandBasis
  /** 三档界限（小数字符串）；档位整体未设定为 null。 */
  tiers: Record<BandTier, { lower: string | null; upper: string | null } | null>
  /** 预置方案的适用场景说明。 */
  scenario: string | null
  /** 数值效力标注：预置方案一律「推断，仅供参考」（HB-01）。 */
  inferenceNote: string | null
}

export interface SchemeAssessment { level: string; reason: string | null; hints: string[]; tier: string | null; basis: string | null }
export interface SchemeCompareRow extends CompareScheme {
  /** metric 为 null（非标准窗口）或比率缺失时为空对象：只展示界限，不判级。 */
  metrics: Partial<Record<StandardMetric, SchemeAssessment | null>>
}

function tiersOf(raw: unknown): Record<BandTier, { lower: string | null; upper: string | null } | null> {
  const source = asRecord(raw)
  const out = {} as Record<BandTier, { lower: string | null; upper: string | null } | null>
  for (const tier of BAND_TIERS) {
    const band = asRecord(source?.[tier])
    out[tier] = band && (band.lower != null || band.upper != null)
      ? { lower: asDecimal(band.lower), upper: asDecimal(band.upper) }
      : null
  }
  return out
}

/** 预置方案（保守/均衡/灵活，BAND_PRESETS 随代码发布，读取不发请求）。 */
export function presetSchemes(): CompareScheme[] {
  return BAND_PRESETS.map((preset) => ({
    key: `preset:${preset.key}`,
    label: preset.label,
    basis: preset.basis as BandBasis,
    tiers: tiersOf(preset.tiers),
    scenario: typeof preset.scenario === 'string' ? preset.scenario : null,
    inferenceNote: INFERENCE_NOTE,
  }))
}

/** 自定义方案草稿（百分数）→ 对比行输入；校验失败按字段返回（与维护页同一份规则）。 */
export function customSchemeFrom(draft: TierDraft, basis: BandBasis):
  { ok: true; scheme: CompareScheme } | ({ ok: false } & FieldFailure) {
  const built = buildSchemeTiers(draft)
  if (!built.ok) return { ok: false, field: built.field, message: built.message }
  return {
    ok: true,
    scheme: { key: 'custom', label: '自定义', basis, tiers: built.tiers, scenario: null, inferenceNote: null },
  }
}

/**
 * 各方案逐一判级（HB-05）：按方案自身的判级依据挑对应口径的套保率（含机制/仅中长期），
 * 调 shared 的 compareSchemes 即时计算。metric 为 null（非标准窗口）或比率缺失时返回空 metrics。
 */
export function compareSchemeRows(schemes: readonly CompareScheme[], ratio: HedgeSimulationRatio | null, metric: StandardMetric | null): SchemeCompareRow[] {
  return schemes.map((scheme) => {
    if (!metric || !ratio) return { ...scheme, metrics: {} }
    const pick = scheme.basis === 'MIDLONG_ONLY' ? ratio.midlongOnly : ratio.withMechanism
    const [row] = compareSchemes({
      schemes: [{ key: scheme.key, label: scheme.label, tiers: scheme.tiers, basis: scheme.basis }],
      ratios: { [metric]: { value: pick.value, status: pick.status } },
    }) as Array<{ metrics: Record<string, SchemeAssessment> }>
    return { ...scheme, metrics: { [metric]: row?.metrics?.[metric] ?? null } }
  })
}
