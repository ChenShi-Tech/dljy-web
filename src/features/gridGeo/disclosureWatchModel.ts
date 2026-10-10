// 日前盯盘结果适配（纯函数，Epic ChenShi-Tech/dljy#3478 · C1 #3484；规格 DW-08/DW-09/DW-12，设计 D6/D8）。
// 口径：
// - 首屏只取服务端给出的 level='focus' 事项，按服务端顺序取前三，不在前端重排或补位。
// - 只有 window.kind='interval' 且区间合法、未转待核的事项画小时区间，并裁剪到目标日 00:00–24:00；
//   日级要求、单点状态与未知时段只列为“日级 / 持续性未知”，不画成全天区间。
// - 负荷预测保留原生粒度，缺测（null 或缺槽）断开曲线，不插值、不补零、不平滑。
// - 覆盖与计数缺字段一律显示“未知”，不写 0（DW-01/DW-08）。
import { lineSeries } from '@/services/chart/chartStyle'
import {
  DISCLOSURE_WATCH_CONSISTENCY_LABELS,
  DISCLOSURE_WATCH_CORE_DATASETS,
  DISCLOSURE_WATCH_DATASET_LABELS,
  DISCLOSURE_WATCH_MECHANISM_LABELS,
  isLocalDateTime,
  isTimePoint,
} from 'shared/schema/disclosure-watch-contract.mjs'
import type {
  DisclosureWatchAttention,
  DisclosureWatchCapabilities,
  DisclosureWatchChangeKind,
  DisclosureWatchCompleteness,
  DisclosureWatchCoreDataset,
  DisclosureWatchCoverageEntry,
  DisclosureWatchCoverageStatus,
  DisclosureWatchDataset,
  DisclosureWatchDisposition,
  DisclosureWatchFeedbackVerdict,
  DisclosureWatchItem,
  DisclosureWatchItemFlag,
  DisclosureWatchItemKind,
  DisclosureWatchItemLevel,
  DisclosureWatchMode,
  DisclosureWatchProcessing,
  DisclosureWatchReviewReason,
  DisclosureWatchRunResult,
  DisclosureWatchRunStatus,
  DisclosureWatchSnapshotSummary,
  DisclosureWatchWindowKind,
} from 'shared/schema/disclosure-watch-contract.mjs'

export type { DisclosureWatchCapabilities, DisclosureWatchItem, DisclosureWatchMode, DisclosureWatchRunResult, DisclosureWatchFeedbackVerdict }

const DAY_MINUTES = 1440
const BEIJING_OFFSET_MS = 8 * 3600_000

export const WATCH_LEVEL_LABELS: Readonly<Record<DisclosureWatchItemLevel, string>> = { focus: '重点核对', general: '一般关注', review: '待核实' }
export const WATCH_KIND_LABELS: Readonly<Record<DisclosureWatchItemKind, string>> = { 'maintenance-plan': '检修计划', 'must-run-stop': '必开必停', 'unplanned-outage': '非计划停运' }
/** 模式标识：review 必须常驻显示，不可隐藏（DW-03）。 */
export const WATCH_MODE_BADGES: Readonly<Record<DisclosureWatchMode, string>> = { live: '真实日前', review: '历史资料审阅，非当时已知回放' }
export const WATCH_RUN_STATUS_LABELS: Readonly<Record<DisclosureWatchRunStatus, string>> = { running: '运行中', complete: '已完成', partial: '部分完成', failed: '研判失败', interrupted: '已中断' }
export const WATCH_ATTENTION_LABELS: Readonly<Record<DisclosureWatchAttention, string>> = { focus: '有重点核对事项', review: '需核实', 'none-qualified': '未识别出重点事项' }
export const WATCH_COVERAGE_STATUS_LABELS: Readonly<Record<DisclosureWatchCoverageStatus, string>> = { complete: '完整', partial: '部分', missing: '缺失', invalid: '无效' }
export const WATCH_COMPLETENESS_LABELS: Readonly<Record<DisclosureWatchCompleteness, string>> = { complete: '完整', partial: '部分', empty: '空表', invalid: '无效' }
export const WATCH_CHANGE_LABELS: Readonly<Record<DisclosureWatchChangeKind, string>> = {
  new: '新增', changed: '有变化', unchanged: '无变化', removed: '本期未列入（名单变化，不代表复机）', 'not-comparable': '无法比较（上一份缺失或不完整）',
}
export const WATCH_REVIEW_REASON_LABELS: Readonly<Record<DisclosureWatchReviewReason, string>> = {
  'no-target-date-list': '非目标日清单',
  'interval-anomaly': '区间异常',
  'column-order-ambiguous': '列序无法确认',
  'identity-unclear': '对象身份不明',
  conflict: '存在互斥断言',
  'persistence-unknown': '明日持续性未知',
  'partial-snapshot': '资料不完整',
  'model-failed': '模型研判失败',
  'budget-unprocessed': '预算内未处理',
  'excerpt-truncated': '原因摘录被截断',
  'consistency-conflict': '原因与状态语义冲突',
}
export const WATCH_FLAG_LABELS: Readonly<Record<DisclosureWatchItemFlag, string>> = {
  recovery: '恢复事项', 'high-load-overlap': '与负荷预测较高时段重叠', 'non-target-date-list': '非目标日清单', conflict: '冲突', 'restricted-source': '受限来源',
}
export const WATCH_PROCESSING_LABELS: Readonly<Record<DisclosureWatchProcessing, string>> = {
  rule: '规则整理', evaluated: '已研判', 'model-failed': '研判失败', 'budget-unprocessed': '预算内未处理', 'not-required': '无需模型',
}
export const WATCH_DISPOSITION_LABELS: Readonly<Record<DisclosureWatchDisposition, string>> = { eligible: '纳入研判', 'review-needed': '转待核', 'out-of-scope': '范围外', invalid: '无效' }
export const WATCH_VERDICT_LABELS: Readonly<Record<DisclosureWatchFeedbackVerdict, string>> = { useful: '有用', 'not-useful': '无用', 'needs-correction': '需修正' }
/** 目标日清单类资料：live 时缺它们即“明日资料未到”（停运用 7 日回看，不按目标日判缺）。 */
export const WATCH_TARGET_DATE_DATASETS: readonly DisclosureWatchDataset[] = ['forecast_maintenance_plan', 'forecast_must_run_stop_unit_list']
export const WATCH_TIMELINE_ROW_LIMIT = 40

function label<K extends string>(labels: Readonly<Record<K, string>>, key: string | null | undefined, fallback = '未知') {
  return key && Object.hasOwn(labels, key) ? labels[key as K] : fallback
}

export function levelLabel(level: string | null | undefined) { return label(WATCH_LEVEL_LABELS, level) }
export function kindLabel(kind: string | null | undefined) { return label(WATCH_KIND_LABELS, kind) }
export function reviewReasonLabel(reason: string) { return label(WATCH_REVIEW_REASON_LABELS, reason, reason) }
export function flagLabel(flag: string) { return label(WATCH_FLAG_LABELS, flag, flag) }
export function processingLabel(value: string | null | undefined) { return label(WATCH_PROCESSING_LABELS, value) }
export function runStatusLabel(value: string | null | undefined) { return label(WATCH_RUN_STATUS_LABELS, value) }
export function attentionLabel(value: string | null | undefined) { return label(WATCH_ATTENTION_LABELS, value) }
export function modeBadge(mode: string | null | undefined) { return label(WATCH_MODE_BADGES, mode) }
export function datasetLabel(dataset: string) { return label(DISCLOSURE_WATCH_DATASET_LABELS as Readonly<Record<DisclosureWatchDataset, string>>, dataset, dataset) }

/** 非负整数照常显示，缺失或非法显示“未知”——未知不能写成 0。 */
export function countText(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '未知'
}

/** ISO-8601 系统时刻 → 北京时间 YYYY-MM-DD HH:mm:ss；非法返回 null。 */
export function formatBeijingTime(value: string | null | undefined) {
  if (!value) return null
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch)) return null
  return new Date(epoch + BEIJING_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

function minuteText(minute: number) {
  const whole = Math.round(minute)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

// ── 事项 ───────────────────────────────────────────────────────────────

export function watchTopFocus(result: Pick<DisclosureWatchRunResult, 'items'> | null | undefined, limit = 3) {
  return (result?.items ?? []).filter((item) => item.level === 'focus').slice(0, limit)
}

export function groupWatchItems(items: readonly DisclosureWatchItem[] | null | undefined) {
  const groups: Record<DisclosureWatchItemLevel, DisclosureWatchItem[]> = { focus: [], general: [], review: [] }
  for (const item of items ?? []) if (Object.hasOwn(groups, item.level)) groups[item.level].push(item)
  return groups
}

export function watchObjectLabel(item: Pick<DisclosureWatchItem, 'object'>) {
  const { plantName, unitName, deviceName, objectKey } = item.object
  const plantUnit = [plantName, unitName].filter(Boolean).join(' ')
  return plantUnit || deviceName || objectKey || '对象未明'
}

export function watchChangeText(item: Pick<DisclosureWatchItem, 'change'>) {
  const { kind, comparedCoverageDate, detail } = item.change
  const base = detail?.trim() || label(WATCH_CHANGE_LABELS, kind)
  return comparedCoverageDate && kind !== 'not-comparable' ? `${base}（对比 ${comparedCoverageDate}）` : base
}

/** 模型判断只作试验附注（D5）；没有模型判断返回空数组。 */
export function watchModelNotes(item: Pick<DisclosureWatchItem, 'mechanism' | 'consistency'>) {
  const notes: Array<{ label: string; value: string; modelVersion: string }> = []
  if (item.mechanism) notes.push({ label: '原因机制', value: label(DISCLOSURE_WATCH_MECHANISM_LABELS, item.mechanism.choice, item.mechanism.choice), modelVersion: item.mechanism.modelVersion })
  if (item.consistency) notes.push({ label: '原因与状态', value: label(DISCLOSURE_WATCH_CONSISTENCY_LABELS, item.consistency.choice, item.consistency.choice), modelVersion: item.consistency.modelVersion })
  return notes
}

export function hasModelJudgement(result: Pick<DisclosureWatchRunResult, 'items'> | null | undefined) {
  return (result?.items ?? []).some((item) => Boolean(item.mechanism || item.consistency))
}

export function watchEvidenceFields(fields: Record<string, string | null> | null | undefined) {
  return Object.entries(fields ?? {}).map(([key, value]) => ({ key, value: value === null || value === undefined || value === '' ? '未提供' : value }))
}

/** 服务端返回的本人已提交评价 → 每个事项最新一条的评价枚举（重开历史运行时显示“已评价”）。 */
export function watchSubmittedVerdicts(records: ReadonlyArray<{ itemId: string; verdict: string; createdAt?: string | null }> | null | undefined) {
  const latest = new Map<string, { verdict: DisclosureWatchFeedbackVerdict; createdAt: string }>()
  for (const record of records ?? []) {
    if (!record || typeof record.itemId !== 'string' || !Object.hasOwn(WATCH_VERDICT_LABELS, record.verdict)) continue
    const createdAt = String(record.createdAt ?? '')
    const previous = latest.get(record.itemId)
    if (!previous || createdAt >= previous.createdAt) latest.set(record.itemId, { verdict: record.verdict as DisclosureWatchFeedbackVerdict, createdAt })
  }
  return Object.fromEntries([...latest].map(([itemId, entry]) => [itemId, entry.verdict])) as Record<string, DisclosureWatchFeedbackVerdict>
}

// ── 覆盖与计数 ─────────────────────────────────────────────────────────

export interface WatchCoverageRow {
  dataset: DisclosureWatchDataset
  label: string
  group: 'core' | 'background'
  status: DisclosureWatchCoverageStatus | 'unknown'
  statusLabel: string
  coverageDate: string
  receivedAt: string
  note: string | null
}

function coverageRow(dataset: DisclosureWatchDataset, group: WatchCoverageRow['group'], entry: DisclosureWatchCoverageEntry | null | undefined): WatchCoverageRow {
  const status = entry && Object.hasOwn(WATCH_COVERAGE_STATUS_LABELS, entry.status) ? entry.status : 'unknown'
  return {
    dataset, group, label: datasetLabel(dataset), status,
    statusLabel: status === 'unknown' ? '未知' : WATCH_COVERAGE_STATUS_LABELS[status],
    coverageDate: entry?.coverageDate || '未提供',
    receivedAt: formatBeijingTime(entry?.receivedAt) ?? '未提供',
    note: entry?.note ?? null,
  }
}

export function watchCoverageRows(result: Pick<DisclosureWatchRunResult, 'inputCoverage' | 'backgroundCoverage'>): WatchCoverageRow[] {
  return [
    ...DISCLOSURE_WATCH_CORE_DATASETS.map((dataset) => coverageRow(dataset, 'core', result.inputCoverage?.[dataset as DisclosureWatchCoreDataset])),
    coverageRow('load_forecast', 'background', result.backgroundCoverage?.load_forecast),
  ]
}

export function watchProcessingRows(result: Pick<DisclosureWatchRunResult, 'processingCoverage'>) {
  const p = result.processingCoverage as Partial<DisclosureWatchRunResult['processingCoverage']> | undefined
  return [
    { label: '对象链', value: countText(p?.chains) },
    { label: '需模型判断', value: countText(p?.modelRequired) },
    { label: '已研判', value: countText(p?.evaluated) },
    { label: '研判失败', value: countText(p?.modelFailed) },
    { label: '未处理', value: countText(p?.unprocessed) },
  ]
}

export function watchCountRows(result: Pick<DisclosureWatchRunResult, 'counts'>) {
  const c = result.counts as Partial<DisclosureWatchRunResult['counts']> | undefined
  return {
    totals: [
      { label: '原始行', value: countText(c?.rawRows) },
      { label: '重复行', value: countText(c?.duplicateRows) },
      { label: '对象链', value: countText(c?.chains) },
    ],
    dispositions: (Object.keys(WATCH_DISPOSITION_LABELS) as DisclosureWatchDisposition[]).map((key) => ({ label: WATCH_DISPOSITION_LABELS[key], value: countText(c?.byDisposition?.[key]) })),
    levels: (Object.keys(WATCH_LEVEL_LABELS) as DisclosureWatchItemLevel[]).map((key) => ({ label: WATCH_LEVEL_LABELS[key], value: countText(c?.byLevel?.[key]) })),
  }
}

/** 一行覆盖摘要：核心三类逐项状态 + 负荷背景 + 模型处理进度；未知不写 0。 */
export function watchCoverageSummary(result: Pick<DisclosureWatchRunResult, 'inputCoverage' | 'backgroundCoverage' | 'processingCoverage'>) {
  const rows = watchCoverageRows(result)
  const core = rows.filter((row) => row.group === 'core').map((row) => `${row.label} ${row.statusLabel}`).join(' · ')
  const background = rows.find((row) => row.group === 'background')!
  const p = result.processingCoverage as Partial<DisclosureWatchRunResult['processingCoverage']> | undefined
  return `核心资料：${core}；负荷背景：${background.statusLabel}；需模型判断 ${countText(p?.modelRequired)} 条（已研判 ${countText(p?.evaluated)} · 失败 ${countText(p?.modelFailed)} · 未处理 ${countText(p?.unprocessed)}）`
}

/** 结论行的数量：各级事项取实际列表长度，未处理取处理覆盖（缺失为“未知”）。 */
export function watchHeadlineCounts(result: Pick<DisclosureWatchRunResult, 'items' | 'processingCoverage'>) {
  const groups = groupWatchItems(result.items)
  return { focus: groups.focus.length, general: groups.general.length, review: groups.review.length, unprocessed: countText(result.processingCoverage?.unprocessed) }
}

// ── 能力（打开弹窗时的资料就绪情况） ─────────────────────────────────────

export function snapshotText(summary: DisclosureWatchSnapshotSummary | null | undefined) {
  if (!summary) return '未到'
  return `${summary.coverageDate} · ${label(WATCH_COMPLETENESS_LABELS, summary.completeness)} · 接收 ${formatBeijingTime(summary.receivedAt) ?? '时间未知'}`
}

export function watchCapabilityRows(capabilities: Pick<DisclosureWatchCapabilities, 'datasets'> | null | undefined) {
  return (capabilities?.datasets ?? []).map((entry) => ({
    dataset: entry.dataset,
    label: entry.label || datasetLabel(entry.dataset),
    forTradeDate: snapshotText(entry.forTradeDate),
    latest: snapshotText(entry.latest),
    missingForTradeDate: !entry.forTradeDate,
  }))
}

/** 目标日清单类资料中尚未收到的项（按标签）；未登记的类别同样视为未到。 */
export function watchTargetDateGaps(capabilities: Pick<DisclosureWatchCapabilities, 'datasets'> | null | undefined) {
  const byDataset = new Map((capabilities?.datasets ?? []).map((entry) => [entry.dataset, entry]))
  const missing = WATCH_TARGET_DATE_DATASETS.filter((dataset) => !byDataset.get(dataset)?.forTradeDate).map((dataset) => datasetLabel(dataset))
  return { missing, allMissing: missing.length === WATCH_TARGET_DATE_DATASETS.length }
}

// ── 时间轴 ─────────────────────────────────────────────────────────────

export interface WatchTimelineRow {
  itemId: string
  label: string
  level: DisclosureWatchItemLevel
  kind: DisclosureWatchItemKind
  windowLabel: string
  startMinute: number
  endMinute: number
  startText: string
  endText: string
  clippedStart: boolean
  clippedEnd: boolean
  highLoadOverlap: boolean
}

export interface WatchTimelineUndrawn {
  itemId: string
  label: string
  level: DisclosureWatchItemLevel
  kind: DisclosureWatchItemKind
  windowKind: DisclosureWatchWindowKind
  windowLabel: string
  reason: string
}

export interface WatchLoadSeries {
  coverageDate: string
  unit: string
  method: string
  /** 按分钟排序；缺槽处插入 value=null 断点，不插值。 */
  points: Array<{ minute: number; value: number | null }>
  missingPoints: number
  validPoints: number
}

export interface WatchTimeline {
  tradeDate: string
  rows: WatchTimelineRow[]
  hiddenRows: number
  undrawn: WatchTimelineUndrawn[]
  load: WatchLoadSeries | null
  highLoadBands: Array<{ fromMinute: number; toMinute: number }>
  highLoadNote: string
}

const UNDRAWN_REASONS: Record<Exclude<DisclosureWatchWindowKind, 'interval'>, string> = {
  day: '日级要求，不画小时区间',
  point: '仅有状态时点，明日持续性未知',
  unknown: '时段未知',
}
const LEVEL_ORDER: Record<DisclosureWatchItemLevel, number> = { focus: 0, general: 1, review: 2 }

/** 本地时刻串（北京时间，无时区）→ 距目标日 00:00 的分钟数；带时区的 ISO 串按北京时间换算；其余返回 null。 */
export function minuteOfTradeDate(value: string | null | undefined, tradeDate: string) {
  if (!value) return null
  const base = Date.parse(`${tradeDate}T00:00:00Z`)
  if (!Number.isFinite(base)) return null
  if (isLocalDateTime(value)) return (Date.parse(`${value}Z`) - base) / 60_000
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value)) return null
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? (epoch + BEIJING_OFFSET_MS - base) / 60_000 : null
}

function timelineEntry(item: DisclosureWatchItem, tradeDate: string): { row: WatchTimelineRow } | { undrawn: WatchTimelineUndrawn } {
  const base = { itemId: item.itemId, label: watchObjectLabel(item), level: item.level, kind: item.kind, windowLabel: item.window?.label || '时段未提供' }
  const windowKind = item.window?.kind ?? 'unknown'
  const undrawn = (reason: string) => ({ undrawn: { ...base, windowKind, reason } })
  if (windowKind !== 'interval') return undrawn(UNDRAWN_REASONS[windowKind] ?? UNDRAWN_REASONS.unknown)
  if (item.reviewReasons?.some((reason) => reason === 'interval-anomaly' || reason === 'column-order-ambiguous')) return undrawn('区间待核，不画小时区间')
  const start = minuteOfTradeDate(item.window.start, tradeDate)
  const end = minuteOfTradeDate(item.window.end, tradeDate)
  if (start === null || end === null) return undrawn('区间不完整，不画小时区间')
  if (end <= start) return undrawn('区间异常（结束不晚于开始）')
  const from = Math.max(0, start), to = Math.min(DAY_MINUTES, end)
  if (to <= from) return undrawn('区间不在目标日内')
  return { row: {
    ...base, startMinute: from, endMinute: to,
    startText: from === 0 && start < 0 ? '00:00（前日起）' : minuteText(from),
    endText: to === DAY_MINUTES && end > DAY_MINUTES ? '24:00（次日止）' : minuteText(to),
    clippedStart: start < 0, clippedEnd: end > DAY_MINUTES,
    highLoadOverlap: (item.flags ?? []).includes('high-load-overlap'),
  } }
}

function parseHour(value: unknown) {
  const match = typeof value === 'string' ? /^\s*(\d{1,2})(?::(\d{2}))?/.exec(value) : null
  if (!match) return null
  const hour = Number(match[1])
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && (!match[2] || Number(match[2]) < 60) ? hour : null
}

/** highLoadHours（每项一个小时，如 "18:00" 或 "18"）→ 合并相邻小时的分钟区间。 */
export function highLoadBands(hours: readonly string[] | null | undefined) {
  const sorted = [...new Set((hours ?? []).map(parseHour).filter((hour): hour is number => hour !== null))].sort((a, b) => a - b)
  const bands: Array<{ fromMinute: number; toMinute: number }> = []
  for (const hour of sorted) {
    const last = bands.at(-1)
    if (last && last.toMinute === hour * 60) last.toMinute += 60
    else bands.push({ fromMinute: hour * 60, toMinute: hour * 60 + 60 })
  }
  return bands
}

/** 负荷预测点：只保留合法时点，按分钟排序；null 原样保留，相邻点间距超过原生步长处插入 null 断点。 */
export function watchLoadPoints(points: ReadonlyArray<{ timePoint: string; valueMw: number | null }> | null | undefined) {
  const parsed = (points ?? [])
    .filter((point) => isTimePoint(point.timePoint))
    .map((point) => ({ minute: Number(point.timePoint.slice(0, 2)) * 60 + Number(point.timePoint.slice(3, 5)), value: typeof point.valueMw === 'number' && Number.isFinite(point.valueMw) ? point.valueMw : null }))
    .sort((a, b) => a.minute - b.minute)
  const steps = parsed.slice(1).map((point, index) => point.minute - parsed[index].minute).filter((step) => step > 0)
  const step = steps.length ? Math.min(...steps) : 15
  const result: Array<{ minute: number; value: number | null }> = []
  let gaps = 0
  for (const point of parsed) {
    const previous = result.at(-1)
    if (previous && point.minute - previous.minute > step) {
      // 缺槽：在缺失的第一个槽位插一个空点让折线断开；不补值。
      result.push({ minute: previous.minute + step, value: null })
      gaps += Math.round((point.minute - previous.minute) / step) - 1
    }
    if (previous && previous.minute === point.minute) continue
    result.push(point)
  }
  const nulls = parsed.filter((point) => point.value === null).length
  return { points: result, missingPoints: nulls + gaps, validPoints: parsed.length - nulls }
}

export function buildWatchTimeline(result: Pick<DisclosureWatchRunResult, 'tradeDate' | 'items' | 'background'>, rowLimit = WATCH_TIMELINE_ROW_LIMIT): WatchTimeline {
  const rows: WatchTimelineRow[] = []
  const undrawn: WatchTimelineUndrawn[] = []
  for (const item of result.items ?? []) {
    const entry = timelineEntry(item, result.tradeDate)
    if ('row' in entry) rows.push(entry.row)
    else undrawn.push(entry.undrawn)
  }
  // 稳定排序：级别优先，同级保留服务端顺序。
  const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) => LEVEL_ORDER[a.row.level] - LEVEL_ORDER[b.row.level] || a.index - b.index).map(({ row }) => row)
  const loadForecast = result.background?.loadForecast ?? null
  const load = loadForecast ? { coverageDate: loadForecast.coverageDate, unit: loadForecast.unit || 'MW', method: loadForecast.method || '', ...watchLoadPoints(loadForecast.points) } : null
  const bands = loadForecast ? highLoadBands(loadForecast.highLoadHours) : []
  const bandText = bands.map((band) => `${minuteText(band.fromMinute)}–${minuteText(band.toMinute)}`).join('、')
  const highLoadNote = !loadForecast ? '无负荷预测背景'
    : loadForecast.highLoadHours === null ? '负荷预测样本不完整，未生成较高负荷时段'
      : bands.length ? `较高负荷时段 ${bandText}（当日相对位置，非官方紧张阈值）`
        : '未标注较高负荷时段'
  return { tradeDate: result.tradeDate, rows: ordered.slice(0, rowLimit), hiddenRows: Math.max(0, ordered.length - rowLimit), undrawn, load, highLoadBands: bands, highLoadNote }
}

export interface WatchChartColors { line: string; band: string; axis: string; split: string }

/** 负荷预测曲线：lineSeries 固定不平滑，缺测不连线；较高负荷时段作浅色区域标注。 */
export function buildWatchLoadChartOption(timeline: Pick<WatchTimeline, 'load' | 'highLoadBands'>, colors: WatchChartColors) {
  const load = timeline.load
  const data = (load?.points ?? []).map((point) => [point.minute, point.value])
  const series = lineSeries('云南统调负荷预测', data, colors.line, {
    connectNulls: false,
    ...(timeline.highLoadBands.length ? { markArea: { silent: true, itemStyle: { color: colors.band, opacity: 0.16 }, data: timeline.highLoadBands.map((band) => [{ xAxis: band.fromMinute }, { xAxis: band.toMinute }]) } } : {}),
  })
  return {
    animation: false,
    // 左右边距归零、纵轴刻度内收：图与上方甘特条共用同一 0–24 时刻列（运行日看板共轴）。
    grid: { left: 0, right: 0, top: 22, bottom: 20, containLabel: false },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params[0] : params) as { value?: [number, number | null] } | undefined
        const [minute, value] = first?.value ?? [0, null]
        return `${minuteText(minute)} · ${value === null || value === undefined ? '缺测' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${load?.unit ?? 'MW'}`}`
      },
    },
    xAxis: {
      type: 'value' as const, min: 0, max: DAY_MINUTES, interval: 180,
      axisLabel: { color: colors.axis, formatter: (value: number) => minuteText(value), showMinLabel: false, showMaxLabel: false },
      splitLine: { lineStyle: { color: colors.split, type: 'dashed' as const } },
    },
    yAxis: { type: 'value' as const, name: load?.unit ?? 'MW', nameGap: 6, nameTextStyle: { color: colors.axis, align: 'left' as const, padding: [0, 0, 0, 4] }, scale: true, axisLabel: { color: colors.axis, inside: true, verticalAlign: 'bottom' as const }, splitLine: { lineStyle: { color: colors.split, type: 'dashed' as const } } },
    series: [series],
  }
}
