// 价格 profile 视图结果 → 三维 / 双切面 / 热力 / 证据表的纯转换（dljy#3007 任务 6.8/6.9）
// ----------------------------------------------------------------------------
// 输入是同一次 filters.view='profile' 查询的 data.rows / data.series（后端只下发真实
// 存在的时段，缺测时段没有行）；三维、两张切面、热力与证据表全部消费这一个结果对象，
// 不另发请求、不在前端补点、不插值（specs yunnan-price-analysis PR07、design D6.2）。
// 本模块只做形状转换：
//   - 日内时点按结果里真实出现的集合（小时价 24 个、15 分钟价 96 个），不写死 96；
//   - 缺测时段在线里是断点（拆段，不连线）、热力里没有格子、表格里显示「—」，绝不补 0；
//   - 负价原样（z 值为负、热力色带发散、跨日切面照画）；
//   - 日前 / 实时固定配色，日期靠位置与选中态区分，不给几十条线随机彩虹色。
// 数值口径：值是十进制字符串；比较与减法走 shared 十进制内核，只在交给 ECharts 前
// Number() 一次（显示精度由组件层 formatMetricValue 决定）。

import { decimalCompare, decimalSub } from 'shared/midlong/decimal.mjs'
import type { InsightSeriesMeta } from '@/services/insight/insightClient'

export type PricePhase = 'day-ahead' | 'real-time'

/** 日前 / 实时的固定线色（日前蓝、实时橙=价格语义色；三维、切面、热力切换共用）。 */
export const PHASE_LINE_COLOR: Record<PricePhase, string> = {
  'day-ahead': '#2563eb',
  'real-time': '#f97316',
}

/** 三维原生点数预算上限（design D10：默认 7 日、最多 31 日、单对象、DA/RT 两类）。 */
export const MAX_3D_NATIVE_POINTS = 6000

/** profile 视图的长表行（后端 priceProfile：只有真实存在的时段）。 */
export type ProfileRow = {
  seriesId: string
  date: string
  timeOfDay: string
  intervalStart: string
  intervalEnd: string
  value: string
}

/** profile 视图 data.series 的条目（价格序列带完整来源身份 + kind 标记）。 */
export type ProfileSeriesEntry = InsightSeriesMeta & { kind?: string }

/** 行 + 所属市场阶段（经序列目录解析；无阶段的序列不属于价格分析，跳过）。 */
export type GridCell = ProfileRow & { phase: PricePhase }

/** 同一次 profile 结果的规则化网格：轴集合 + 逐格取值。 */
export type PriceGrid = {
  /** 日内时点（升序去重；小时价 24 个、15 分钟价 96 个，按真实行归纳） */
  timePoints: string[]
  /** 业务日（升序去重） */
  dates: string[]
  /** 进入网格的全部行（即所选序列的原生点） */
  rows: GridCell[]
  /** 按 阶段×业务日×时点 取行；缺测返回 undefined */
  cell: (phase: PricePhase, date: string, timeOfDay: string) => GridCell | undefined
  /** 某业务日的全部行（时点升序） */
  day: (date: string) => GridCell[]
  /** 某时点的全部行（业务日升序） */
  timeOfDay: (timeOfDay: string) => GridCell[]
}

/** 序列的市场阶段；非日前/实时的序列不参与三维与切面。 */
function phaseOfSeries(meta: ProfileSeriesEntry | undefined): PricePhase | null {
  if (meta?.marketPhase === 'day-ahead' || meta?.marketPhase === 'real-time') return meta.marketPhase
  return null
}

/**
 * rows + series → 网格。只保留能解析出日前/实时阶段的序列的行；
 * 轴集合来自这些行里真实出现的日期与时点，不按粒度补满。
 */
export function buildPriceGrid(rows: ProfileRow[], series: ProfileSeriesEntry[]): PriceGrid {
  const phaseById = new Map<string, PricePhase>()
  for (const meta of series) {
    const phase = phaseOfSeries(meta)
    if (phase) phaseById.set(meta.seriesId, phase)
  }
  const cells: GridCell[] = []
  for (const row of rows) {
    const phase = phaseById.get(row.seriesId)
    if (!phase) continue
    cells.push({ ...row, phase })
  }
  const timePoints = [...new Set(cells.map((cell) => cell.timeOfDay))].sort()
  const dates = [...new Set(cells.map((cell) => cell.date))].sort()
  const byKey = new Map<string, GridCell>()
  for (const cell of cells) byKey.set(`${cell.phase}|${cell.date}|${cell.timeOfDay}`, cell)

  const day = (date: string) => cells.filter((cell) => cell.date === date).sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay))
  const timeOfDay = (time: string) => cells.filter((cell) => cell.timeOfDay === time).sort((a, b) => a.date.localeCompare(b.date))

  return {
    timePoints,
    dates,
    rows: cells,
    cell: (phase, date, time) => byKey.get(`${phase}|${date}|${time}`),
    day,
    timeOfDay,
  }
}

// ── 立体对象（经济对象）的序列选择 ───────────────────────────────────────────────────────

/**
 * 三维/热力只消费一个经济对象的序列：
 *   - 无对象维度（用户侧价）或未指定对象名 → 全部序列；
 *   - 指定对象名 → 只留该对象的序列；同名多条序列（同名多个上游节点）时每阶段取
 *     seriesId 稳定排序的第一条——不合并（两序列同一格会有两个值，合并等于造数）。
 */
export function selectObjectSeries(
  series: ProfileSeriesEntry[],
  objectName: string | null,
  objectDimension: string | null
): ProfileSeriesEntry[] {
  if (!objectDimension || !objectName) return series
  const matched = series.filter((meta) => meta.dimensions[objectDimension] === objectName)
  const picked = new Map<string, ProfileSeriesEntry>()
  for (const meta of matched.sort((a, b) => a.seriesId.localeCompare(b.seriesId))) {
    const phase = phaseOfSeries(meta)
    if (!phase) continue
    if (!picked.has(phase)) picked.set(phase, meta)
  }
  return [...picked.values()]
}

/** 序列目录里出现过的对象名（升序；用户侧价为空数组）。 */
export function objectNamesOf(series: ProfileSeriesEntry[], objectDimension: string | null): string[] {
  if (!objectDimension) return []
  return [...new Set(series.map((meta) => meta.dimensions[objectDimension]).filter((name): name is string => Boolean(name)))].sort()
}

// ── 三维线 ───────────────────────────────────────────────────────────────────────────────

/** 一条三维折线：某业务日 × 某市场阶段；缺测时段把线拆成多段（段间不连线）。 */
export type PriceLine3D = {
  phase: PricePhase
  date: string
  /** 每段是 [时点下标, 业务日下标, 价格] 序列；连续时段游程一段 */
  segments: Array<Array<[number, number, number]>>
  /** 日前/实时固定配色（不随日期变化） */
  color: string
}

/**
 * 网格 → 三维线。x = 日内时段（真实时点集合）、y = 业务日、z = 价格（元/MWh）；
 * 每个业务日 × 市场阶段一条线，缺测时段两侧各成一段（断开，不补值），负价原样为负。
 */
export function buildLine3DSeries(grid: PriceGrid): PriceLine3D[] {
  const timeIdx = new Map(grid.timePoints.map((time, index) => [time, index]))
  const dateIdx = new Map(grid.dates.map((date, index) => [date, index]))
  const groups = new Map<string, GridCell[]>()
  for (const cell of grid.rows) {
    const key = `${cell.phase}|${cell.date}`
    const list = groups.get(key) ?? []
    list.push(cell)
    groups.set(key, list)
  }
  const phaseOrder: Record<PricePhase, number> = { 'day-ahead': 0, 'real-time': 1 }
  const lines: PriceLine3D[] = []
  for (const [key, cells] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [phase, date] = key.split('|') as [PricePhase, string]
    const sorted = cells.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay))
    const segments: Array<Array<[number, number, number]>> = []
    let current: Array<[number, number, number]> = []
    let lastIntervalEnd = ''
    for (const cell of sorted) {
      const x = timeIdx.get(cell.timeOfDay) ?? -1
      if (x < 0) continue
      // 连续判据用行自身的时段首尾相接（intervalStart === 上一行 intervalEnd）：
      // 轴集合是全局时点并集，缺测时点若在所有序列里都不存在会从轴上消失、下标仍
      // 连续——按下标判断会跨缺测误连；按物理时段判断无论洞在轴上是否可见都断开。
      if (current.length && cell.intervalStart !== lastIntervalEnd) {
        segments.push(current)
        current = []
      }
      current.push([x, dateIdx.get(date) ?? 0, Number(cell.value)])
      lastIntervalEnd = cell.intervalEnd
    }
    if (current.length) segments.push(current)
    lines.push({ phase, date, segments, color: PHASE_LINE_COLOR[phase] })
  }
  lines.sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase] || a.date.localeCompare(b.date))
  return lines
}

// ── 热力 ─────────────────────────────────────────────────────────────────────────────────

export type HeatmapBuild = {
  /** [时点下标, 业务日下标, 价格]；缺测格子不存在（不是 0） */
  cells: Array<[number, number, number]>
  /** 真实最小值（含负价） */
  min: number
  /** 真实最大值 */
  max: number
}

/** 网格 + 单一市场阶段 → 热力格子与真实极值；该阶段没有行时返回 null。 */
export function buildHeatmap(grid: PriceGrid, phase: PricePhase): HeatmapBuild | null {
  const timeIdx = new Map(grid.timePoints.map((time, index) => [time, index]))
  const dateIdx = new Map(grid.dates.map((date, index) => [date, index]))
  const own = grid.rows.filter((cell) => cell.phase === phase)
  if (!own.length) return null
  let minRow = own[0]!
  let maxRow = own[0]!
  for (const cell of own) {
    if (decimalCompare(cell.value, minRow.value) < 0) minRow = cell
    if (decimalCompare(cell.value, maxRow.value) > 0) maxRow = cell
  }
  const cells = own.map((cell) => [
    timeIdx.get(cell.timeOfDay) ?? 0,
    dateIdx.get(cell.date) ?? 0,
    Number(cell.value),
  ] as [number, number, number])
  return { cells, min: Number(minRow.value), max: Number(maxRow.value) }
}

// ── 默认剖面选择 ─────────────────────────────────────────────────────────────────────────

/**
 * 默认剖面：窗口（结果）最后一天 + 该日价格最高的时点（所有序列一起看，并列取最早）。
 * 十进制比较挑极值，避免浮点误差把 210.5 与 210.50 判成不同。
 */
export function defaultCrossSection(grid: PriceGrid): { date: string; timeOfDay: string } | null {
  const lastDate = grid.dates.at(-1)
  if (!lastDate) return null
  const dayRows = grid.day(lastDate)
  if (!dayRows.length) return null
  let best = dayRows[0]!
  for (const cell of dayRows) {
    const cmp = decimalCompare(cell.value, best.value)
    if (cmp > 0 || (cmp === 0 && cell.timeOfDay < best.timeOfDay)) best = cell
  }
  return { date: lastDate, timeOfDay: best.timeOfDay }
}

// ── 双切面 ───────────────────────────────────────────────────────────────────────────────

export type FacetSeries = { da: Array<number | null>; rt: Array<number | null> }

/** 所选日剖面：该日日前/实时两条阶梯线（x = 时点集合；缺测为 null 断开）。 */
export function buildDayProfile(grid: PriceGrid, date: string): FacetSeries {
  const pick = (phase: PricePhase) =>
    grid.timePoints.map((time) => {
      const cell = grid.cell(phase, date, time)
      return cell ? Number(cell.value) : null
    })
  return { da: pick('day-ahead'), rt: pick('real-time') }
}

/** 所选时点跨日切面：该时点在各业务日的日前/实时两条线（x = 业务日；缺测为 null）。 */
export function buildTimeOfDayProfile(grid: PriceGrid, timeOfDay: string): FacetSeries {
  const pick = (phase: PricePhase) =>
    grid.dates.map((date) => {
      const cell = grid.cell(phase, date, timeOfDay)
      return cell ? Number(cell.value) : null
    })
  return { da: pick('day-ahead'), rt: pick('real-time') }
}

// ── 证据表 ───────────────────────────────────────────────────────────────────────────────

export type EvidenceCell = {
  /** 日期视图=时点；时点视图=业务日（第一列的口径由调用方标注） */
  key: string
  intervalStart: string
  intervalEnd: string
  dayAhead: string | null
  realTime: string | null
  /** 价差 = 日前 − 实时（十进制减法）；任一侧缺测为 null */
  spread: string | null
}

function evidenceRow(key: string, da: GridCell | undefined, rt: GridCell | undefined): EvidenceCell {
  const any = da ?? rt
  const dayAhead = da?.value ?? null
  const realTime = rt?.value ?? null
  return {
    key,
    intervalStart: any?.intervalStart ?? '',
    intervalEnd: any?.intervalEnd ?? '',
    dayAhead,
    realTime,
    spread: dayAhead !== null && realTime !== null ? decimalSub(dayAhead, realTime) : null,
  }
}

/** 剖面日期那一天的全部真实时段（至少一侧有行的时点；缺一侧为 null，显示「—」）。 */
export function buildDayEvidence(grid: PriceGrid, date: string): EvidenceCell[] {
  return grid.timePoints
    .map((time) => evidenceRow(time, grid.cell('day-ahead', date, time), grid.cell('real-time', date, time)))
    .filter((row) => row.dayAhead !== null || row.realTime !== null)
}

/** 剖面时点在各业务日的跨日列表（至少一侧有行的日期）。 */
export function buildTimeOfDayEvidence(grid: PriceGrid, timeOfDay: string): EvidenceCell[] {
  return grid.dates
    .map((date) => evidenceRow(date, grid.cell('day-ahead', date, timeOfDay), grid.cell('real-time', date, timeOfDay)))
    .filter((row) => row.dayAhead !== null || row.realTime !== null)
}

// ── 窗口与预算 ───────────────────────────────────────────────────────────────────────────

/** 以某结束日往前数 7 天（共 7 天）的窗口；非法日期原样返回单日。 */
export function sevenDayWindowEndingAt(end: string): { start: string; end: string } {
  const ms = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(ms)) return { start: end, end }
  return { start: new Date(ms - 6 * 86_400_000).toISOString().slice(0, 10), end }
}

/** WebGL 可用性检测（三维渲染前置；单独导出便于测试 mock）。 */
export function detectWebGL(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl') ??
      canvas.getContext('webgl2') ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    return Boolean(gl)
  } catch {
    return false
  }
}
