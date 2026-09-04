// 复盘中心驾驶舱外壳的纯逻辑（Epic #2033 · #2038 外壳重做）：标签顺序/深链解析、
// 标签就绪度信号、偏差热力条、分时价差盈亏、市场价格统计、日期步进。
// 全部无副作用、不碰 DOM/网络。
//
// 与 cockpitModel.ts 的分工（**不重复实现**）：模板清单/就绪度计数/偏差率指标/待办富化
// 归 cockpitModel（#2038 首版已交付并有测试）；本模块只补外壳独有的推导。
import type { ReviewDimension } from 'shared/review-templates/registry.mjs'
import type { ReviewDetailPoint } from '@/services/quant/quantClient'
import type { DimensionCard } from './cockpitModel'

export type { ReviewDimension }

/** 主体驾驶舱（#2048）与六维正交：它是「以谁的身份看」，不是第七个维度，故单列标签键。 */
export type ShellTab = ReviewDimension | 'subject'

/** 标签顺序：偏差居首——现页用户天天来看的就是它；主体视角垫底。 */
export const TAB_ORDER: readonly ShellTab[] = Object.freeze([
  'deviation', 'result', 'market', 'strategy', 'risk', 'decision', 'subject'
]) as readonly ShellTab[]

/** 标签短名（注册表 DIMENSIONS 是「偏差复盘」全称，标签栏放不下）。 */
export const TAB_SHORT: Readonly<Record<ShellTab, string>> = Object.freeze({
  deviation: '偏差',
  result: '结果',
  market: '市场',
  strategy: '策略',
  risk: '风险',
  decision: '决策',
  subject: '主体'
})

/** 暂不对外展示的标签（藏而不删）：tab 栏不渲染、维面组件与数据链路原样保留，
 *  ?dim= 深链仍可直达（parseDimQuery 不改）。恢复可见只需清空本清单。 */
export const HIDDEN_TABS: readonly ShellTab[] = Object.freeze([
  'risk', 'decision', 'subject'
]) as readonly ShellTab[]

/** tab 栏实际渲染的标签 = TAB_ORDER − HIDDEN_TABS，保持既有顺序。 */
export const VISIBLE_TABS: readonly ShellTab[] = Object.freeze(
  TAB_ORDER.filter((t) => !(HIDDEN_TABS as readonly string[]).includes(t))
) as readonly ShellTab[]

export function isShellTab(value: unknown): value is ShellTab {
  return typeof value === 'string' && (TAB_ORDER as readonly string[]).includes(value)
}

/** `?dim=` 深链解析：非法/缺省一律落偏差维，不抛。 */
export function parseDimQuery(raw: unknown, fallback: ShellTab = 'deviation'): ShellTab {
  return isShellTab(raw) ? raw : fallback
}

/**
 * 标签圆点信号——回答「点进去此刻能不能看到东西」：
 * - live：页面这一刻已拿到该维真实数字（由调用方按加载结果判定）
 * - gap：注册表里该维模板全部 data_gap，缺的是数据源不是代码
 * - pending：其余情况（服务未上线 / 本次加载空手而归）
 * 注册表 readiness 是**数据可得性台账**（见 registry.mjs 头注），不是开发进度，
 * 所以 live 必须由调用方给，不能从注册表推。
 */
export type DimSignal = 'live' | 'gap' | 'pending'

export function dimSignal(live: boolean, card: DimensionCard | null | undefined): DimSignal {
  if (live) return 'live'
  if (card && card.counts.ready === 0 && card.counts.dataGap > 0) return 'gap'
  return 'pending'
}

/** YYYY-MM-DD 按天步进；用 UTC 构造避免本地时区/夏令时把日期挪一天。 */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** 96 格热力条：over=实际高于申报（用多了）/ under=低于（用少了）/ flat=申报为 0 无法算比。 */
export type HeatCell = {
  label: string
  ratio: number | null
  tone: 'over' | 'under' | 'flat'
  /** 0.12–1：满刻度（默认 ±7%）以上封顶，避免一个极端点把其余格子压成看不见 */
  alpha: number
}

export function heatCells(
  detail: ReadonlyArray<Pick<ReviewDetailPoint, 'datetime' | 'declared' | 'actual'>>,
  fullScaleRatio = 0.07
): HeatCell[] {
  return detail.map((p) => {
    const label = String(p.datetime ?? '').slice(-5)
    if (!Number.isFinite(p.declared) || p.declared === 0) return { label, ratio: null, tone: 'flat', alpha: 0.12 }
    const ratio = (p.actual - p.declared) / p.declared
    const alpha = Math.min(1, Math.max(0.12, Math.abs(ratio) / fullScaleRatio))
    return { label, ratio, tone: ratio >= 0 ? 'over' : 'under', alpha }
  })
}

/** 时点串里的小时（"2026-05-18 19:15" / "2026-05-18T19:15" 皆可）；解析不出返回 null。 */
export function hourOf(datetime: unknown): number | null {
  const m = /(\d{2}):(\d{2})/.exec(String(datetime ?? ''))
  if (!m) return null
  const h = Number(m[1])
  return h >= 0 && h < 24 ? h : null
}

/** 偏差 96 点逐时明细行（清单 R8）：数据直接来自 /review 响应 detail，与主图/热力条同源。 */
export type DeviationDetailRow = {
  /** 时点 HH:MM（取 datetime 尾部，与主图 x 轴一致）。 */
  label: string
  declared: number
  actual: number
  /** actual − declared（正=多用，负=少用），MWh。 */
  deviation: number
  /** 服务端该点计入考核的电量，MWh；合计与 KPI 卡「受考核电量」同口径。 */
  assessedMwh: number
  /** 方向着色与热力条同规则：over=实际高于申报 / under=低于 / flat=申报为 0 无法算比。 */
  tone: 'over' | 'under' | 'flat'
  /** 是否带内按主图容差带同口径：|actual−declared| ≤ declared×容差%。申报为 0 时带宽为 0，
   *  actual=0 记带内、否则超带（与图上零高度带视觉一致），不冒充「无法判定」。 */
  inBand: boolean
}

/**
 * 偏差 96 点逐时明细行推导（清单 R8，零新增取数——detail 随 /review 响应下发）。
 * 坏掉的症状：明细表合计 ≠ KPI 卡受考核电量、或带内外判定与主图容差带观感矛盾。
 */
export function deviationDetailRows(
  detail: ReadonlyArray<Pick<ReviewDetailPoint, 'datetime' | 'declared' | 'actual' | 'assessed_mwh'>>,
  tolerancePct: number
): DeviationDetailRow[] {
  const tol = Number.isFinite(tolerancePct) ? Math.max(tolerancePct, 0) / 100 : 0
  return detail.map((p) => {
    const declared = Number.isFinite(p.declared) ? p.declared : 0
    const actual = Number.isFinite(p.actual) ? p.actual : 0
    const deviation = actual - declared
    return {
      label: String(p.datetime ?? '').slice(-5),
      declared,
      actual,
      deviation,
      assessedMwh: Number.isFinite(p.assessed_mwh) ? p.assessed_mwh : 0,
      tone: declared === 0 ? 'flat' : deviation >= 0 ? 'over' : 'under',
      inBand: Math.abs(deviation) <= declared * tol
    }
  })
}

/**
 * 分时价差盈亏（24 桶，元）= Σ (日前价 − 实时价) × (实际 − 申报)，与 backtest.da_rt_spread_pnl_yuan 同口径。
 * 缺价点（da/rt 任一缺）如实跳过并计数——单侧缺测不臆造。
 */
export function hourlySpreadPnl(detail: ReadonlyArray<ReviewDetailPoint>): { hours: number[]; missing: number } {
  const hours = new Array<number>(24).fill(0)
  let missing = 0
  for (const p of detail) {
    const h = hourOf(p.datetime)
    if (h == null || p.da_price == null || p.rt_price == null) { missing++; continue }
    hours[h] += (p.da_price - p.rt_price) * (p.actual - p.declared)
  }
  return { hours: hours.map((v) => Math.round(v)), missing }
}

export type PriceStats = {
  points: number
  daAvg: number
  rtAvg: number
  /** 日前 − 实时（均价差，元/MWh） */
  spread: number
  daPeak: number
  daValley: number
  rtPeak: number
  rtValley: number
}

/** 市场维统计：只统计双侧都有价的点；一个都没有返回 null（不出全 0 假数）。 */
export function priceStats(detail: ReadonlyArray<ReviewDetailPoint>): PriceStats | null {
  const da: number[] = []
  const rt: number[] = []
  for (const p of detail) {
    if (p.da_price == null || p.rt_price == null) continue
    da.push(p.da_price)
    rt.push(p.rt_price)
  }
  if (!da.length) return null
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const r1 = (v: number) => Math.round(v * 10) / 10
  const daAvg = avg(da)
  const rtAvg = avg(rt)
  return {
    points: da.length,
    daAvg: r1(daAvg),
    rtAvg: r1(rtAvg),
    spread: r1(daAvg - rtAvg),
    daPeak: r1(Math.max(...da)),
    daValley: r1(Math.min(...da)),
    rtPeak: r1(Math.max(...rt)),
    rtValley: r1(Math.min(...rt))
  }
}
