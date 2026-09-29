// 套保维护入口的纯函数（openspec build-midlong-spot-hedging 任务 8.6，HW-10/HB-01..07/HG-07/HC-03；ChenShi-Tech/dljy#3423）。
//
// 只做表单换算与前端预校验，口径以后端为准：
// - 月份范围：默认北京时间当月起 3 个月，不写死；
// - 区间界限：页面按百分数录入，提交前换成后端的小数字符串（85 → "0.85"），再用与后端同一份 validateSchemeTiers 预校验；
// - 机制参数：确认时比例高于上一年度必须带说明（前端先拦；后端 422 MECHANISM_RATIO_INCREASE_NEEDS_NOTE 兜底）；
// - 失败映射：403 / 422（details.field 定位字段）/ 409（提示刷新后重试）。
// 页面经本文件取用 shared/hedge 与 shared/midlong 的共享规则，不直接依赖 shared/ 路径。

import { beijingToday, isIsoDate } from 'shared/midlong/dates.mjs'
import { decimalCompare } from 'shared/midlong/decimal.mjs'
import { compareText } from 'shared/insight/contract.mjs'
import { validateSchemeTiers } from 'shared/hedge/bands.mjs'
import { INFERENCE_NOTE, bandSourceOf } from 'shared/hedge/band-presets.mjs'
import {
  BAND_LIMIT_HIGH, BAND_LIMIT_LOW,
  MECHANISM_END_REASON_LABELS, MECHANISM_END_REASONS, MECHANISM_PARAM_STATUS_LABELS, MECHANISM_PROJECT_CLASSES,
  MECHANISM_PROJECT_CLASS_LABELS, MECHANISM_REFERENCE_BASES, MECHANISM_REFERENCE_BASIS_LABELS, TIERS, TIER_LABELS,
} from 'shared/hedge/contract.mjs'

export {
  INFERENCE_NOTE, MECHANISM_END_REASON_LABELS, MECHANISM_END_REASONS, MECHANISM_PARAM_STATUS_LABELS,
  MECHANISM_PROJECT_CLASSES, MECHANISM_PROJECT_CLASS_LABELS, MECHANISM_REFERENCE_BASES, MECHANISM_REFERENCE_BASIS_LABELS,
  compareText,
}

export type BandTier = 'DAY_AHEAD' | 'INTRA_MONTH' | 'FORWARD'
export type BandSide = 'lower' | 'upper'
export type BandBasis = 'WITH_MECHANISM' | 'MIDLONG_ONLY'

/** 期限档按远近排列：日前 → 月内 → 远期。 */
export const BAND_TIERS = TIERS as readonly BandTier[]
export const BAND_TIER_LABELS = TIER_LABELS as Readonly<Record<BandTier, string>>
export const BAND_BASIS_LABELS: Readonly<Record<BandBasis, string>> = { WITH_MECHANISM: '含机制', MIDLONG_ONLY: '仅中长期' }
/** 预置数值效力（HB-01）：推断数值必须带「推断，仅供参考」。 */
export const BAND_VALUE_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  POLICY_MANDATORY: '政策强制',
  INDUSTRY_PRACTICE: '行业实践',
  INFERENCE: INFERENCE_NOTE,
}

/** 预置方案出处编号 → 引用文本；未收录的编号如实显示「出处待补」。 */
export function bandSourceText(id: string): string {
  return bandSourceOf(id) ?? '出处待补'
}

// ── 月份范围（HG-07 / HB-07：默认当月起 3 个月，不写死）─────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
/** 一次最多展开的月数：场站 × 月的录入表再宽就不可用了。 */
export const MAX_MONTH_SPAN = 12

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value)
}

export function addMonths(month: string, count: number): string {
  const [year, mon] = month.split('-').map(Number)
  const index = year * 12 + (mon - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** 默认月份范围：北京时间当月起 3 个月（当月、次月、再下月）。 */
export function defaultMonthRange(today: string = beijingToday()): { fromMonth: string; toMonth: string } {
  const fromMonth = today.slice(0, 7)
  return { fromMonth, toMonth: addMonths(fromMonth, 2) }
}

/** 闭区间内的全部月份；范围非法或倒置时为空。 */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth) || compareText(fromMonth, toMonth) > 0) return []
  const out: string[] = []
  for (let month = fromMonth; compareText(month, toMonth) <= 0; month = addMonths(month, 1)) out.push(month)
  return out
}

/** 月份范围校验：返回错误文案，合法时为 null。 */
export function monthRangeError(fromMonth: string, toMonth: string): string | null {
  if (!isMonthKey(fromMonth) || !isMonthKey(toMonth)) return '请选择起止月份（YYYY-MM）'
  if (compareText(fromMonth, toMonth) > 0) return '起始月份不能晚于结束月份'
  if (monthsBetween(fromMonth, toMonth).length > MAX_MONTH_SPAN) return `一次最多查看 ${MAX_MONTH_SPAN} 个月`
  return null
}

// ── 百分数 ↔ 小数字符串（纯字符串运算，不经浮点）──────────────────────────────

const NUMBER_RE = /^(\d+)(?:\.(\d+))?$/
/** 非负十进制数（MWh、元/MWh）。 */
export function isNonNegativeDecimal(text: string): boolean {
  return NUMBER_RE.test(text.trim())
}

/** 两个数值字符串是否相等（「1500」与「1500.0」相等）；任一非数字时按原文比较。 */
export function sameDecimal(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? '').trim()
  const y = String(b ?? '').trim()
  if (!NUMBER_RE.test(x) || !NUMBER_RE.test(y)) return x === y
  try {
    return decimalCompare(x, y) === 0
  } catch {
    return x === y
  }
}

function normalizeDecimal(intPart: string, fracPart: string): string {
  const int = intPart.replace(/^0+(?=\d)/, '') || '0'
  const frac = fracPart.replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** 小数点左移两位：「85」→「0.85」，「100」→「1」，「85.5」→「0.855」。空串为 null；非数字为 undefined。 */
export function percentToRatio(text: string): string | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  const m = NUMBER_RE.exec(trimmed)
  if (!m) return undefined
  const digits = `${m[1]}${m[2] ?? ''}`
  const point = m[1].length - 2
  if (point <= 0) return normalizeDecimal('0', `${'0'.repeat(-point)}${digits}`)
  return normalizeDecimal(digits.slice(0, point), digits.slice(point))
}

/** 小数点右移两位：「0.85」→「85」。null/非数字为空串。 */
export function ratioToPercent(value: string | null | undefined): string {
  const m = NUMBER_RE.exec(String(value ?? '').trim())
  if (!m) return ''
  const frac = `${m[2] ?? ''}00`
  return normalizeDecimal(`${m[1]}${frac.slice(0, 2)}`, frac.slice(2))
}

/** 展示用：「0.85」→「85%」，null →「未设定」。 */
export function formatPercent(value: string | null | undefined): string {
  const percent = ratioToPercent(value)
  return percent ? `${percent}%` : '未设定'
}

// ── 区间方案表单（HB-03）────────────────────────────────────────────────────

export type TierDraft = Record<BandTier, Record<BandSide, string>>
export type BandTierValues = Partial<Record<BandTier, { lower?: string | null; upper?: string | null } | null>>

export function emptyTierDraft(): TierDraft {
  return { DAY_AHEAD: { lower: '', upper: '' }, INTRA_MONTH: { lower: '', upper: '' }, FORWARD: { lower: '', upper: '' } }
}

/** 已有档位（小数）→ 表单草稿（百分数）。 */
export function tierDraftFrom(tiers: BandTierValues | null | undefined): TierDraft {
  const draft = emptyTierDraft()
  for (const tier of BAND_TIERS) {
    draft[tier].lower = ratioToPercent(tiers?.[tier]?.lower ?? null)
    draft[tier].upper = ratioToPercent(tiers?.[tier]?.upper ?? null)
  }
  return draft
}

export interface FieldFailure { field: string | null; message: string }

function sideLabel(tier: BandTier, side: BandSide) {
  return `${BAND_TIER_LABELS[tier]}${side === 'lower' ? '下限' : '上限'}`
}

/**
 * 表单草稿 → 提交用档位（小数字符串，缺省为 null）。
 * 非数字、越界（0—200%）、同档下限不小于上限都按字段返回，field 与后端 details.field 同形（tiers.DAY_AHEAD.upper）。
 */
export function buildSchemeTiers(draft: TierDraft):
  { ok: true; tiers: Record<BandTier, { lower: string | null; upper: string | null }> } | ({ ok: false } & FieldFailure) {
  const tiers = {} as Record<BandTier, { lower: string | null; upper: string | null }>
  let anySet = false
  for (const tier of BAND_TIERS) {
    const band = { lower: null as string | null, upper: null as string | null }
    for (const side of ['lower', 'upper'] as const) {
      const value = percentToRatio(draft[tier][side])
      if (value === undefined) return { ok: false, field: `tiers.${tier}.${side}`, message: `${sideLabel(tier, side)}请输入 0 到 200 之间的数字（%）` }
      band[side] = value
      if (value !== null) anySet = true
    }
    tiers[tier] = band
  }
  if (!anySet) return { ok: false, field: null, message: '至少设定一个档位的上限或下限' }
  const check = validateSchemeTiers({ tiers }) as { ok: boolean; details?: { field?: string } }
  if (!check.ok) {
    const field = check.details?.field ?? null
    const [, tier, side] = (field ?? '').split('.') as [string, BandTier, BandSide]
    if (!BAND_TIERS.includes(tier)) return { ok: false, field, message: '区间档位不合法' }
    const value = tiers[tier][side]
    const message = value !== null && isOutOfBandRange(value)
      ? `${sideLabel(tier, side)}必须在 0 到 200% 之间`
      : `${BAND_TIER_LABELS[tier]}下限必须小于上限`
    return { ok: false, field, message }
  }
  return { ok: true, tiers }
}

function isOutOfBandRange(value: string) {
  return decimalCompare(value, BAND_LIMIT_LOW) < 0 || decimalCompare(value, BAND_LIMIT_HIGH) > 0
}

type ActivationTokenRow = { activationId: number | null; effectiveTo: string | null; rowVersion?: number | null }

/**
 * 切换生效的乐观令牌：后端 PUT 比对的是「未关闭生效行」的 activationId（预约切换时它是尚未到期的新行），
 * 不是 GET /band/activation 返回的 rowVersion 列（新插入的行会重置为 1，拿它比对会误报 409）。没有生效行时不带令牌。
 */
export function activationToken(state: { current: ActivationTokenRow | null; history: ActivationTokenRow[] } | null): number | undefined {
  const open = state?.history.find((row) => row.effectiveTo === null) ?? state?.current ?? null
  return open?.activationId ?? undefined
}

// ── 机制参数（HC-03 / D4）───────────────────────────────────────────────────

export interface MechanismRatioRow {
  periodKey: string
  stationId: number
  status: string
  ratio: string | null
  effectiveFrom: string | null
}

/**
 * 同场站「上一年度」比例：其它生效期中已确认（或确认后已结束）、生效起始不晚于本期生效起始的最近一期。
 * 后端按「最新 CONFIRMED 版本」判断；前端只拿得到各期的当前版本，已结束的期沿用结束前的比例与起始日，一并参与比较。
 */
export function previousYearRatio(rows: readonly MechanismRatioRow[], target: MechanismRatioRow, effectiveFrom: string): string | null {
  if (!isIsoDate(effectiveFrom)) return null
  const candidates = rows.filter((row) => row.stationId === target.stationId && row.periodKey !== target.periodKey
    && (row.status === 'CONFIRMED' || row.status === 'RETIRED')
    && row.ratio !== null && row.effectiveFrom !== null && compareText(row.effectiveFrom, effectiveFrom) <= 0)
  candidates.sort((a, b) => compareText(b.effectiveFrom as string, a.effectiveFrom as string))
  return candidates[0]?.ratio ?? null
}

/** 确认时比例高于上一年度且未填说明：前端直接拦下，不发请求。 */
export function ratioIncreaseNeedsNote(rows: readonly MechanismRatioRow[], target: MechanismRatioRow, effectiveFrom: string, overrideNote: string): { previous: string } | null {
  const previous = previousYearRatio(rows, target, effectiveFrom)
  if (previous === null || target.ratio === null || overrideNote.trim()) return null
  return decimalCompare(target.ratio, previous) > 0 ? { previous } : null
}

/** 机制比例按百分数录入（0—100，最多两位小数 = 后端小数四位）→ 小数字符串。 */
export function mechanismRatioFromPercent(text: string): { ok: true; ratio: string } | ({ ok: false } & FieldFailure) {
  const ratio = percentToRatio(text)
  if (ratio === null) return { ok: false, field: 'ratio', message: '请填写机制电量比例（%）' }
  if (ratio === undefined) return { ok: false, field: 'ratio', message: '比例请输入 0 到 100 之间的数字（%）' }
  if (decimalCompare(ratio, '1') > 0) return { ok: false, field: 'ratio', message: '比例不能超过 100%' }
  if ((ratio.split('.')[1] ?? '').length > 4) return { ok: false, field: 'ratio', message: '比例最多保留两位小数（%）' }
  return { ok: true, ratio }
}

/** 生效起止校验（YYYY-MM-DD；止日不早于起日）。 */
export function effectivePeriodError(from: string, to: string, { fromRequired = false } = {}): FieldFailure | null {
  if (!from && fromRequired) return { field: 'effectiveFrom', message: '请填写生效起始日' }
  if (from && !isIsoDate(from)) return { field: 'effectiveFrom', message: '生效起始日无效（YYYY-MM-DD）' }
  if (to && !isIsoDate(to)) return { field: 'effectiveTo', message: '生效止日无效（YYYY-MM-DD）' }
  if (from && to && compareText(to, from) < 0) return { field: 'effectiveTo', message: '生效止日不能早于起始日' }
  return null
}

// ── 时刻（北京时间）────────────────────────────────────────────────────────

const SHANGHAI_OFFSET_MS = 8 * 3_600_000

/** ISO 时刻 → 北京时间「YYYY-MM-DD HH:mm」；空为「—」。 */
export function formatBeijingTime(value: string | null | undefined): string {
  if (!value) return '—'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return String(value)
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** datetime-local 输入（按北京时间理解）→ 带 +08:00 的时刻；空串为 null，格式不对为 undefined。 */
export function beijingInputToInstant(value: string): string | null | undefined {
  const trimmed = value.trim()
  if (!trimmed) return null
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!m || !isIsoDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return undefined
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}+08:00`
}

// ── 失败映射（HW-10）────────────────────────────────────────────────────────

export interface MaintenanceFailure {
  status: number
  errorCode: string
  message: string
  field: string | null
  /** 批量写入里出错的行号（后端 details.index，从 0 起）。 */
  index: number | null
  /** 给用户看的整句提示。 */
  text: string
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: '方案名称', presetKey: '预置方案', basis: '判级依据', note: '说明', reason: '切换原因',
  schemeId: '方案', rowVersion: '生效方案版本', baseVersionNo: '版本号', companyIds: '公司范围', asOf: '认知时点',
  stationId: '场站', ratio: '比例', mechanismPrice: '机制电价', projectClass: '项目类别', referenceBasis: '参照口径',
  effectiveFrom: '生效起始', effectiveTo: '生效止日', sourceNote: '来源文件说明', overrideNote: '比例上调说明',
  endReason: '结束原因', status: '状态', action: '动作',
  items: '录入行', 'items.stationId': '场站', 'items.quantityMwh': '基准电量', 'items.expectedVersionNo': '基准版本',
  'items.rowVersion': '核定上限版本', capMwh: '核定上限', subjectId: '交易单元', month: '月份',
}

/** 后端字段名 → 中文名；区间档位字段（tiers.X.side）按档位拼。 */
export function fieldLabel(field: string | null | undefined): string | null {
  if (!field) return null
  const tierMatch = /^tiers\.(DAY_AHEAD|INTRA_MONTH|FORWARD)\.(lower|upper)$/.exec(field)
  if (tierMatch) return sideLabel(tierMatch[1] as BandTier, tierMatch[2] as BandSide)
  return FIELD_LABELS[field] ?? null
}

/** 维护写口需要的权限（设计 D10：公司上下文 canWrite，即平台管理员或本公司 BOSS）。 */
export const MAINTENANCE_WRITE_ROLE_NOTE = '维护需要公司写权限（平台管理员 ADMIN / 本公司 BOSS）'

type HedgeErrorLike = { status: number; errorCode: string; message: string; details?: Record<string, unknown> | null }
function isHedgeErrorLike(err: unknown): err is HedgeErrorLike {
  return err instanceof Error && typeof (err as Partial<HedgeErrorLike>).status === 'number'
    && typeof (err as Partial<HedgeErrorLike>).errorCode === 'string'
}

/** 把写口/读口失败转成可操作提示：403 说明所需权限，422 指出字段，409 提示刷新后重试。 */
export function maintenanceFailureOf(err: unknown): MaintenanceFailure {
  if (!isHedgeErrorLike(err)) {
    const message = err instanceof Error && err.message ? err.message : '请求失败'
    return { status: 0, errorCode: 'NETWORK', message, field: null, index: null, text: `操作失败：${message}` }
  }
  const details = err.details ?? null
  const field = typeof details?.field === 'string' ? details.field : null
  const index = Number.isInteger(details?.index) ? Number(details?.index) : null
  const base = { status: err.status, errorCode: err.errorCode, message: err.message, field, index }
  if (err.status === 403) return { ...base, text: `403：${err.message}。${MAINTENANCE_WRITE_ROLE_NOTE}` }
  if (err.status === 409) return { ...base, text: `409：${err.message}。数据已被他人更新，请刷新后核对再重试` }
  if (err.status === 422) {
    const label = fieldLabel(field)
    const where = field ? `（字段 ${field}${label ? `「${label}」` : ''}）` : ''
    return { ...base, text: `422：${err.message}${where}` }
  }
  return { ...base, text: `${err.errorCode}：${err.message}` }
}
