// 套保「今明两日」页签的视图模型（openspec build-midlong-spot-hedging 任务 8.2/8.4/8.7，HW-01/02/05/06/09；ChenShi-Tech/dljy#3420）。
//
// 只做展示前的纯加工，不改口径（口径全在后端）：
// 1) 响应归一：/overview 的 intervals 带 locked.lockNote（NO_CONTRACT/CURVE_MISSING/FORBIDDEN）与 legs.rows（逐腿水位，HW-01），
//    旧后端缺字段按「没有」处理，数值保持 null，绝不补 0；
// 2) 中文标签：腿状态、未覆盖原因、判级与原因、标准指标，全部取 shared/hedge/contract.mjs 的同一份标签（页面不直接依赖 shared/）；
// 3) 逐时段序列（HW-02）：含机制/仅中长期两条线与发电柱的数据，未知点为 null、断开不连线；
// 4) 导出（HW-05）：CSV 行由「当前结果 + 它对应的那次查询参数」生成，文件内带认知时点；
// 5) 侧边栏摘要（HW-09）：两个套保率、判级、需关注时段与数据腿状态；不含试算与方案对比，未覆盖时段不带数值。

import type { CsvCell } from '@/utils/exportCsv'
import type { HedgeOverview } from './hedgeApi'
import { formatBeijingTime } from './hedgeMaintenanceModel'
import { compareText } from 'shared/insight/contract.mjs'
import {
  ASSESSMENT_LEVEL_LABELS,
  ASSESSMENT_REASON_LABELS,
  LEG_KEY_LABELS,
  LEG_STATUS_LABELS,
  STANDARD_METRIC_LABELS,
  UNCOVERED_REASON_LABELS,
} from 'shared/hedge/contract.mjs'
import type { AssessmentLevel, AssessmentReason, LegStatus, UncoveredReason } from 'shared/hedge/contract.mjs'

export {
  ASSESSMENT_LEVEL_LABELS, ASSESSMENT_REASON_LABELS, LEG_KEY_LABELS, LEG_STATUS_LABELS,
  STANDARD_METRIC_LABELS, UNCOVERED_REASON_LABELS, compareText,
}

/** /overview 逐时段行（后端 assembleIntervals 输出；lockNote 区分「台账无合同 = 已知 0」与「分解缺段/失败 = 未知」）。 */
export interface TodayInterval {
  start: string
  end: string
  covered: boolean
  generation: { value: string | null; source: string | null; sourceKey?: string | null; uncoveredReason?: string | null; unknownStationIds?: number[]; knownStationCount?: number }
  locked: { midlong: string | null; lockNote?: string | null; mechanism: { value: string | null; note?: string | null }; total: string | null }
  exposure: { withMechanism: string | null; midlongOnly: string | null }
}

/** 数据腿水位行（HW-01，契约 HedgeLegRow；时刻为 ISO 字符串，缺失 null + reason 写原因）。 */
export interface HedgeLegRowView {
  key: string
  sourceKey: string | null
  label: string
  status: LegStatus
  changedAt: string | null
  dataThrough: string | null
  publishRule: string | null
  publishAssumption: string | null
  publishedAt: string | null
  ingestedAt: string | null
  version: { schemeId: number; versionNo: number; name: string; basis: string | null; effectiveFrom: string | null } | null
  reason: string | null
  note: string | null
}

export interface TodayOverview extends Omit<HedgeOverview, 'intervals' | 'legs'> {
  intervals: TodayInterval[]
  legs: { rows?: unknown } & Record<string, unknown>
  fromDate?: string
  toDate?: string
  granularity?: string
}

/** 当前结果对应的那次查询参数（与 overview 同生共死；不是输入框里尚未生效的值）。 */
export interface TodayResultQuery {
  stationId?: string
  stationName?: string
  fromDate: string
  toDate: string
  granularity: string
  /** null = 当前视图。 */
  asOf: string | null
}

export interface TodayResult {
  data: TodayOverview
  query: TodayResultQuery
}

// ── 响应归一：缺字段按「没有」处理，数值保持 null ─────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function normalizeInterval(raw: unknown): TodayInterval {
  const row = (raw ?? {}) as Record<string, unknown>
  const gen = (row.generation ?? {}) as Record<string, unknown>
  const lock = (row.locked ?? {}) as Record<string, unknown>
  const mech = (lock.mechanism ?? {}) as Record<string, unknown>
  const expo = (row.exposure ?? {}) as Record<string, unknown>
  return {
    start: String(row.start ?? ''),
    end: String(row.end ?? ''),
    covered: Boolean(row.covered),
    generation: {
      value: str(gen.value),
      source: str(gen.source),
      sourceKey: str(gen.sourceKey),
      uncoveredReason: str(gen.uncoveredReason),
      knownStationCount: typeof gen.knownStationCount === 'number' ? gen.knownStationCount : undefined,
      unknownStationIds: Array.isArray(gen.unknownStationIds) ? gen.unknownStationIds.map(Number) : [],
    },
    locked: {
      midlong: str(lock.midlong),
      lockNote: str(lock.lockNote),
      mechanism: { value: str(mech.value), note: str(mech.note) },
      total: str(lock.total),
    },
    exposure: { withMechanism: str(expo.withMechanism), midlongOnly: str(expo.midlongOnly) },
  }
}

export function todayOverviewOf(raw: unknown): TodayOverview {
  const data = (raw ?? {}) as HedgeOverview & { fromDate?: unknown; toDate?: unknown; granularity?: unknown }
  return {
    ...data,
    fromDate: str(data.fromDate) ?? undefined,
    toDate: str(data.toDate) ?? undefined,
    granularity: str(data.granularity) ?? undefined,
    intervals: Array.isArray(data.intervals) ? data.intervals.map(normalizeInterval) : [],
    legs: (data.legs && typeof data.legs === 'object' ? data.legs : {}) as TodayOverview['legs'],
  }
}

function normalizeLegRow(raw: unknown): HedgeLegRowView | null {
  const row = (raw ?? {}) as Record<string, unknown>
  if (!row.key) return null
  const version = (row.version ?? null) as HedgeLegRowView['version']
  return {
    key: String(row.key),
    sourceKey: str(row.sourceKey),
    label: String(row.label ?? row.key),
    status: String(row.status ?? 'OK') as LegStatus,
    changedAt: str(row.changedAt),
    dataThrough: str(row.dataThrough),
    publishRule: str(row.publishRule),
    publishAssumption: str(row.publishAssumption),
    publishedAt: str(row.publishedAt),
    ingestedAt: str(row.ingestedAt),
    version: version && typeof version === 'object' ? version : null,
    reason: str(row.reason),
    note: str(row.note),
  }
}

/** 页头逐腿水位（HW-01）：FORECAST_VENDOR 按来源各一行；旧后端无 rows 时为空数组。 */
export function legRowsOf(overview: TodayOverview): HedgeLegRowView[] {
  const rows = (overview.legs as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []
  return rows.map(normalizeLegRow).filter((row): row is HedgeLegRowView => row !== null)
}

// ── 中文标签 ──────────────────────────────────────────────────────────────────

export const LOCK_NOTE_LABELS: Readonly<Record<string, string>> = {
  NO_CONTRACT: '无生效合同',
  CURVE_MISSING: '分解缺段',
  FORBIDDEN: '无权限',
}

/** 未覆盖原因的中文标签（HW-02 悬停）；未知码原样给出，不吞掉。 */
export function uncoveredLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return UNCOVERED_REASON_LABELS[reason as UncoveredReason] ?? reason
}

export function legStatusLabel(status: string): string {
  return LEG_STATUS_LABELS[status as LegStatus] ?? status
}

export function assessmentLevelLabel(level: string): string {
  return ASSESSMENT_LEVEL_LABELS[level as AssessmentLevel] ?? level
}

export function assessmentReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return ASSESSMENT_REASON_LABELS[reason as AssessmentReason] ?? reason
}

export function standardMetricLabel(metric: string): string {
  return STANDARD_METRIC_LABELS[metric as keyof typeof STANDARD_METRIC_LABELS] ?? metric
}

/**
 * ISO 时刻的短显示（MM-DD HH:mm，北京时间）；用于腿水位与发布时刻，缺失返回 null。
 * 必须解析 instant 后按 Asia/Shanghai 格式化（复用 hedgeMaintenanceModel 的 formatBeijingTime）：
 * 直接截取 ISO 字符串会把 UTC 的 Z 时间原样显示，新鲜度整体错报 8 小时。
 */
export function formatIsoShort(iso: string | null): string | null {
  if (!iso) return null
  return formatBeijingTime(iso).slice(5)
}

/** 腿状态色调：正常 muted 以外按状态给警示/危险/弱化，供状态徽标 class。 */
export function legStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'muted' {
  if (status === 'OK') return 'ok'
  if (status === 'STALE' || status === 'PARTIAL') return 'warn'
  if (status === 'FAILED' || status === 'FORBIDDEN') return 'danger'
  return 'muted'
}

/** 发布时刻文本：publishAssumption 有值时标注「发布时刻为登记假设」（HW-01）。 */
export function legPublishText(row: HedgeLegRowView): string | null {
  const at = formatIsoShort(row.publishedAt ?? row.changedAt)
  if (!at) return null
  return row.publishAssumption ? `${at}（登记假设）` : at
}

/** 中长期锁价单元格文本：「台账无合同」是已知 0、「分解缺段/失败」是未知，两者必须分得开（HW-02）。 */
export function midlongText(row: TodayInterval): string {
  if (row.locked.midlong !== null) return row.locked.midlong
  if (row.locked.lockNote === 'NO_CONTRACT') return '0（无生效合同）'
  if (row.locked.lockNote === 'FORBIDDEN') return '无权限'
  if (row.locked.lockNote === 'CURVE_MISSING') return '未知（分解缺段）'
  return '未知'
}

/** 需关注方向中文（服务端 SELL/BUY/ZERO）。 */
export function watchlistDirectionLabel(direction: string): string {
  if (direction === 'SELL') return '多发需现货卖出'
  if (direction === 'BUY') return '欠发需现货买回'
  return '持平'
}

/** 发电来源中文（图表着色与表格来源列共用）：ACTUAL=实际、其余有值=预测。 */
export function generationSourceLabel(source: string | null): string {
  if (source === null) return ''
  return source === 'ACTUAL' ? '实际' : '预测'
}

/** 比率值展示（HM-02）：FORBIDDEN 显示「无权限查看中长期持仓」，不显示数值（更不是 0）。 */
export function ratioValueText(ratio: { value: string | null; status: string } | null | undefined): string {
  if (!ratio) return '不可计算'
  if (ratio.status === 'FORBIDDEN') return '无权限查看中长期持仓'
  return ratio.value ?? '不可计算'
}

export function ratioStatusText(ratio: { value: string | null; status: string } | null | undefined): string | null {
  if (!ratio) return null
  if (ratio.status === 'FORBIDDEN') return '无权限查看中长期持仓'
  if (ratio.value !== null) return null
  // 不可计算的原因码与判级原因共用一套标签（MECHANISM_INCOMPLETE 等）；未知码原样保留。
  return ASSESSMENT_REASON_LABELS[ratio.status as AssessmentReason] ?? ratio.status
}

// ── 逐时段序列（HW-02）：未知 null 断开，不插值、不平滑 ────────────────────────

export interface GenerationBar {
  value: number | null
  source: string | null
  uncoveredReason: string | null
}

export interface UncoveredRange {
  fromLabel: string
  toLabel: string
  reason: string | null
}

export interface ExposureSeries {
  /** 跨天窗口的时段标签（MM-DD HH:mm）。 */
  labels: string[]
  withMechanism: Array<number | null>
  midlongOnly: Array<number | null>
  generation: GenerationBar[]
  uncoveredRanges: UncoveredRange[]
}

function toNumber(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function intervalLabel(start: string): string {
  return start.slice(5, 16).replace('T', ' ')
}

export function buildExposureSeries(intervals: TodayInterval[]): ExposureSeries {
  const labels = intervals.map((row) => intervalLabel(row.start))
  const withMechanism = intervals.map((row) => toNumber(row.exposure.withMechanism))
  const midlongOnly = intervals.map((row) => toNumber(row.exposure.midlongOnly))
  const generation = intervals.map((row) => ({
    value: toNumber(row.generation.value),
    source: row.generation.value === null ? null : row.generation.source,
    uncoveredReason: row.generation.value === null ? row.generation.uncoveredReason ?? null : null,
  }))
  const uncoveredRanges: UncoveredRange[] = []
  let open: UncoveredRange | null = null
  intervals.forEach((row, i) => {
    if (row.generation.value === null) {
      if (!open) open = { fromLabel: labels[i] ?? '', toLabel: labels[i] ?? '', reason: uncoveredLabel(row.generation.uncoveredReason) }
      open.toLabel = labels[i] ?? open.toLabel
      if (!open.reason && row.generation.uncoveredReason) open.reason = uncoveredLabel(row.generation.uncoveredReason)
    } else if (open) {
      uncoveredRanges.push(open)
      open = null
    }
  })
  if (open) uncoveredRanges.push(open)
  return { labels, withMechanism, midlongOnly, generation, uncoveredRanges }
}

// ── 数据缺口分区（HW-02）：读取失败与数据覆盖分开展示，不混入风险排序 ────────────

export interface HedgeGapView { code: string; message: string; affected: string | null }

/** 读取失败类缺口（各腿查询失败）：与「数据未覆盖」（预测未到达等）分开列出。 */
export function splitGaps(gaps: Array<{ code: string; message: string; affected: string | null }>): {
  failures: HedgeGapView[]
  coverage: HedgeGapView[]
} {
  const failures: HedgeGapView[] = []
  const coverage: HedgeGapView[] = []
  for (const gap of gaps ?? []) {
    const row = { code: String(gap?.code ?? ''), message: String(gap?.message ?? ''), affected: gap?.affected ?? null }
    ;(/_QUERY_FAILED$|^LEDGER_WATERMARK_FAILED$|^STATIONS_QUERY_FAILED$|^HEDGE_CONSISTENCY_FAILED$/.test(row.code) ? failures : coverage).push(row)
  }
  const byCode = (a: HedgeGapView, b: HedgeGapView) => compareText(a.code, b.code)
  return { failures: failures.sort(byCode), coverage: coverage.sort(byCode) }
}

// ── 导出（HW-05）：当前结果 + 它对应的那次查询参数，文件内带认知时点 ────────────

function safeFilePart(text: string): string {
  return text.replace(/[^0-9A-Za-z-]+/g, '-')
}

export function todayCsvFilename(query: TodayResultQuery): string {
  const asOf = query.asOf ? `_asof-${safeFilePart(query.asOf)}` : ''
  return `hedge-today2_${query.fromDate}_${query.toDate}${asOf}.csv`
}

export function buildTodayCsv(result: TodayResult): { filename: string; headers: string[]; rows: CsvCell[][] } {
  const { data, query } = result
  const asOfText = query.asOf ?? '当前视图'
  const headers = [
    '认知时点', '视图', '窗口起', '窗口止', '粒度',
    '时段开始', '时段结束', '发电(MWh)', '发电来源', '未覆盖原因',
    '中长期锁价(MWh)', '锁价说明', '机制电量(MWh)', '敞口-含机制(MWh)', '敞口-仅中长期(MWh)', '展示范围',
  ]
  const rows = data.intervals.map((row) => [
    asOfText,
    query.asOf ? 'AS_OF' : 'CURRENT',
    query.fromDate, query.toDate, query.granularity,
    row.start, row.end,
    row.generation.value ?? '',
    row.generation.value === null ? '未覆盖' : row.generation.source ?? '',
    uncoveredLabel(row.generation.uncoveredReason) ?? '',
    row.locked.midlong ?? '',
    row.locked.lockNote ? LOCK_NOTE_LABELS[row.locked.lockNote] ?? row.locked.lockNote : '',
    row.locked.mechanism.value ?? '',
    row.exposure.withMechanism ?? '',
    row.exposure.midlongOnly ?? '',
    query.stationName ?? '全公司',
  ])
  return { filename: todayCsvFilename(query), headers, rows }
}

// ── 侧边栏摘要（HW-09）：不含试算与方案对比；未覆盖时段不带数值 ────────────────

const WATCHLIST_TOP = 5

export function buildTodaySummary(result: TodayResult | null): Record<string, unknown> | null {
  if (!result) return null
  const { data, query } = result
  const assessment = data.standardMetrics?.TODAY2_INTERVAL ?? null
  const watchRows = (Array.isArray(data.watchlist?.rows) ? data.watchlist.rows : []).slice(0, WATCHLIST_TOP)
  return {
    view: 'hedge_today2',
    window: { fromDate: query.fromDate, toDate: query.toDate, granularity: query.granularity, asOf: query.asOf ?? '当前视图' },
    scope: query.stationId ? { stationId: query.stationId, stationName: query.stationName } : { company: true },
    ratios: {
      withMechanism: { value: ratioValueText(data.ratio?.withMechanism), status: ratioStatusText(data.ratio?.withMechanism) },
      midlongOnly: { value: ratioValueText(data.ratio?.midlongOnly), status: ratioStatusText(data.ratio?.midlongOnly) },
    },
    assessment: assessment
      ? { metric: standardMetricLabel('TODAY2_INTERVAL'), level: assessmentLevelLabel(assessment.level), reason: assessmentReasonLabel(assessment.reason) }
      : null,
    scheme: data.scheme ? { name: data.scheme.name, versionNo: data.scheme.versionNo, basis: data.scheme.basis } : '套保区间未配置',
    coverage: {
      coveredCount: Number((data.ratio?.coverage as { coveredCount?: unknown })?.coveredCount ?? data.intervals.filter((row) => row.covered).length),
      totalCount: data.intervals.length,
    },
    // 需关注时段只含已覆盖时段（服务端生成时已过滤），未覆盖时段不在这里给任何数值。
    watchlist: watchRows.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>
      return {
        start: String(item.start ?? ''),
        direction: watchlistDirectionLabel(String(item.direction ?? 'ZERO')),
        exposureMwh: typeof item.exposureMwh === 'string' ? item.exposureMwh : null,
        note: typeof item.note === 'string' ? item.note : null,
      }
    }),
    legs: legRowsOf(data).map((row) => ({
      label: row.label,
      status: legStatusLabel(row.status),
      reason: row.reason,
    })),
    gaps: (Array.isArray(data.gaps) ? data.gaps : []).map((gap) => ({ code: gap.code, message: gap.message })),
  }
}
