// 关系分析纯计算层：把 relation_scatter 契约的逐日逐时散点（RelationScatterDataset.xd）
// 归约成三种可视化所需的派生量——小时回归 / 热力矩阵 / 敏感度条 / KPI 摘要。
// 全部纯函数、无副作用、不依赖 DOM 或 ECharts，故可 vitest 单测（src/services/analysis/relationInsight.spec.ts）。
// zrxgx（价格×新能源）与 zrxgx2（价格×统调负荷）共用；驱动量语义（新能源出力 / 统调负荷）由调用方标注。
import type {
  RelationScatterCell,
  RelationScatterRow
} from '@/services/data/contracts/relationScatterAdapter'

/** 24 个小时刻度 1..24（与页面 HOURS 对齐）。 */
export const RELATION_HOURS = Array.from({ length: 24 }, (_, i) => i + 1)

/** 一元线性回归结果：price = slope·driver + intercept。 */
export interface RegressionResult {
  /** 斜率：电价对驱动量的边际反应（元/MWh per MW）。 */
  slope: number
  /** 截距。 */
  intercept: number
  /** Pearson 相关系数（带符号，∈[-1,1]）。 */
  r: number
  /** 判定系数 r²（∈[0,1]）。 */
  r2: number
  /** 参与拟合的有效样本数。 */
  n: number
}

/** 单个小时的敏感度条目。 */
export interface HourSensitivity extends RegressionResult {
  /** 小时刻度 1..24。 */
  hour: number
}

/** 热力矩阵：X=小时、Y=驱动量分箱、值=平均电价。 */
export interface HeatmapMatrix {
  /** X 轴刻度（小时 1..24）。 */
  xHours: number[]
  /** Y 轴分箱标签（如 "0–1400"），由低到高。 */
  yBins: string[]
  /** 单元格 [小时索引, 分箱索引, 平均电价]（仅含有样本的格）。 */
  cells: [number, number, number][]
  /** 各单元格样本数，与 cells 一一对应。 */
  counts: number[]
  /** 电价色阶下界。 */
  min: number
  /** 电价色阶上界。 */
  max: number
}

/** KPI 摘要。 */
export interface RelationSummary {
  /** 全时段汇总的 Pearson 相关系数（所有小时的点汇入一池）。 */
  overallR: number
  /** 相关性最强（|r| 最大）的小时；无有效样本为 null。 */
  strongestHour: number | null
  /** 相关性最弱（|r| 最小、n≥2）的小时；无有效样本为 null。 */
  weakestHour: number | null
  /** 各小时斜率的均值（元/MWh per MW）。 */
  meanSlope: number
  /** 实际参与统计的天数（xd 截取后长度）。 */
  sampleDays: number
  /** 参与汇总的总点数。 */
  totalPoints: number
}

function isCell(v: unknown): v is RelationScatterCell {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  )
}

/** 取最近 days 天该小时的 (驱动量, 电价) 点集，过滤无效值。 */
export function pointsForHour(
  xd: RelationScatterRow[],
  hour: number,
  days: number
): [number, number][] {
  const rows = (xd || []).slice(-Math.max(0, days))
  const key = 'p' + hour
  const pts: [number, number][] = []
  for (const row of rows) {
    const cell = row?.[key]
    if (isCell(cell)) pts.push([cell[0], cell[1]])
  }
  return pts
}

/** 对一组 (x, y) 做最小二乘一元回归；不足两点时退化返回 n<2、r/r2/slope=0。 */
export function linearRegression(points: [number, number][]): RegressionResult {
  const n = points.length
  if (n < 2) {
    return { slope: 0, intercept: n === 1 ? points[0][1] : 0, r: 0, r2: 0, n }
  }
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of points) {
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y
  }
  const mx = sx / n
  const my = sy / n
  const covXY = sxy / n - mx * my
  const varX = sxx / n - mx * mx
  const varY = syy / n - my * my
  // 驱动量或电价方差为 0（点退化成竖/横线）→ 无法定义相关性
  if (varX <= 0 || varY <= 0) {
    return { slope: 0, intercept: my, r: 0, r2: 0, n }
  }
  const slope = covXY / varX
  const intercept = my - slope * mx
  const r = covXY / Math.sqrt(varX * varY)
  const rClamped = Math.max(-1, Math.min(1, r))
  return { slope, intercept, r: rClamped, r2: rClamped * rClamped, n }
}

/** 某小时的电价-驱动量回归。 */
export function hourlyRegression(
  xd: RelationScatterRow[],
  hour: number,
  days: number
): RegressionResult {
  return linearRegression(pointsForHour(xd, hour, days))
}

export interface HeatmapOptions {
  days: number
  /** 分箱数量，默认 10。 */
  binCount?: number
  /** 驱动量上界（固定量传入，如新能源 14000）；不传则用样本最大值自适应。 */
  binMax?: number
  /** 驱动量下界；不传时——固定上界场景锚 0，全自适应（未传 binMax）场景用样本最小值。 */
  binMin?: number
}

/** 构建「小时 × 驱动量分箱 → 平均电价」热力矩阵。 */
export function heatmapMatrix(
  xd: RelationScatterRow[],
  opts: HeatmapOptions
): HeatmapMatrix {
  const binCount = Math.max(1, opts.binCount ?? 10)
  const rows = (xd || []).slice(-Math.max(0, opts.days))
  // 先收集全部点，确定驱动量范围（自适应时）。
  const all: { hourIdx: number; driver: number; price: number }[] = []
  RELATION_HOURS.forEach((h, hourIdx) => {
    const key = 'p' + h
    for (const row of rows) {
      const cell = row?.[key]
      if (isCell(cell)) all.push({ hourIdx, driver: cell[0], price: cell[1] })
    }
  })
  const drivers = all.map((p) => p.driver)
  // 固定上界（新能源 binMax=14000）时下界锚 0；全自适应（负荷未传 binMax）时
  // 下界也用样本最小值，避免负荷 15k~45k 却从 0 起分箱、下半区色阶全空（codex P2）。
  const autoScale = opts.binMax == null
  const lo = opts.binMin ?? (autoScale && drivers.length ? Math.min(...drivers) : 0)
  const hi = opts.binMax ?? (drivers.length ? Math.max(...drivers) : 1)
  const span = hi > lo ? hi - lo : 1
  const width = span / binCount
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(0))
  const yBins = Array.from({ length: binCount }, (_, i) =>
    `${fmt(lo + i * width)}–${fmt(lo + (i + 1) * width)}`
  )
  // 分箱聚合：每 (小时, 箱) 累计电价与计数。
  const sum = new Map<string, number>()
  const cnt = new Map<string, number>()
  for (const p of all) {
    let bin = Math.floor((p.driver - lo) / width)
    if (bin < 0) bin = 0
    if (bin >= binCount) bin = binCount - 1
    const k = `${p.hourIdx}:${bin}`
    sum.set(k, (sum.get(k) ?? 0) + p.price)
    cnt.set(k, (cnt.get(k) ?? 0) + 1)
  }
  const cells: [number, number, number][] = []
  const counts: number[] = []
  let min = Infinity
  let max = -Infinity
  for (const [k, s] of sum) {
    const c = cnt.get(k) ?? 1
    const [hourIdx, bin] = k.split(':').map(Number)
    const avg = s / c
    cells.push([hourIdx, bin, avg])
    counts.push(c)
    if (avg < min) min = avg
    if (avg > max) max = avg
  }
  if (!cells.length) {
    min = 0
    max = 0
  }
  return { xHours: [...RELATION_HOURS], yBins, cells, counts, min, max }
}

/** 各小时的敏感度（斜率 + 相关性），按小时顺序返回 24 条。 */
export function sensitivityBars(
  xd: RelationScatterRow[],
  days: number
): HourSensitivity[] {
  return RELATION_HOURS.map((hour) => ({
    hour,
    ...hourlyRegression(xd, hour, days)
  }))
}

/** 全页 KPI 摘要。 */
export function summaryKpis(
  xd: RelationScatterRow[],
  days: number
): RelationSummary {
  const rows = (xd || []).slice(-Math.max(0, days))
  const bars = sensitivityBars(xd, days)
  // 汇总相关系数：所有小时的点并成一池做整体回归。
  const pooled: [number, number][] = []
  RELATION_HOURS.forEach((h) => pooled.push(...pointsForHour(xd, h, days)))
  const overall = linearRegression(pooled)
  const valid = bars.filter((b) => b.n >= 2)
  let strongestHour: number | null = null
  let weakestHour: number | null = null
  if (valid.length) {
    strongestHour = valid.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a)).hour
    weakestHour = valid.reduce((a, b) => (Math.abs(b.r) < Math.abs(a.r) ? b : a)).hour
  }
  const meanSlope = valid.length
    ? valid.reduce((s, b) => s + b.slope, 0) / valid.length
    : 0
  return {
    overallR: overall.r,
    strongestHour,
    weakestHour,
    meanSlope,
    sampleDays: rows.length,
    totalPoints: pooled.length
  }
}
