// 驾驶舱现货价格面板的取数决策（#2392）。
//
// 抽成纯函数而不是留在 TradingCockpitView 里，是因为这里的每一条判断错了都**不会报错**，
// 只会在图上画出一条看起来完全正常的曲线：日期选错就是把几天前的行情当成今天的，
// 合成兜底没拦住就是把编造的价格当成出清价，失败残留的预测被画出来就是把一次没跑成的
// 预测当成结论。这类错必须由断言钉住，而组件层测不动。
import type { CurvePoint, SpotCurve } from '@/services/market/spotPriceCore'
import { curveStats, timeAxis96 } from '@/services/market/spotPriceCore'
import type { DataBasis } from '@/services/dataBasis'
import type { LatestForecast, LatestForecastRun } from '@/services/forecast/latestForecast'

/**
 * 挑一条能用来画图的曲线：`status === 'ok'` 且点数非空，取最新的一条（后端已按 predicted_at 倒序）。
 *
 * 两个判据都不能省。只判 status 会放过 ok 但 points 为空的行；只判点数会让 error/skipped 的
 * 残留曲线被画成正常预测——那比没有图更糟，因为看不出它是一次没跑成的预测留下的。
 *
 * 放在这里而不是 latestForecast.ts：本模块必须**运行时零依赖**（同 spotPriceCore），
 * 一旦 import 那个 fetch 客户端就会把 `@/services/api` → regionContext → `window`
 * 整条链拖进来，纯函数单测在 node 环境直接崩。
 */
export function pickUsableRun(result: LatestForecast): LatestForecastRun | null {
  return result.runs.find((r) => r.status === 'ok' && r.points.length > 0) ?? null
}

export interface DateRange { start: string; end: string }

/**
 * 面板画哪一天：今天有数据就今天，否则退到覆盖区间的最后一天。
 *
 * 不写死「今天」是因为云南价格受上游发布节奏限制恒滞后数日（实测节点电价滞后 4 天），
 * 钉在今天就永远落在无数据的日期上——面板此前正因如此长期显示合成曲线。
 * 覆盖区间拿不到时仍回落到今天：那种情况下宁可空着，也不猜一个日期。
 */
export function resolvePanelDate(today: string, coverage: DateRange | null): string {
  if (!coverage) return today
  return today <= coverage.end ? today : coverage.end
}

export interface PricePanelInput {
  date: string
  coverage: DateRange | null
  clearing: SpotCurve
  forecast: LatestForecast
}

export interface PricePanelResult {
  realPoints: CurvePoint[]
  forecastPoints: CurvePoint[]
  basis: DataBasis
  hourlySourced: boolean
  stats: ReturnType<typeof curveStats>
  /** 空串表示一切正常；否则是给用户看的、说明「为什么图上少东西」的一句话。 */
  error: string
}

const EMPTY_STATS = { mean: null, spread: null, max: null, min: null }

export function buildPricePanel(input: PricePanelInput): PricePanelResult {
  const { date, coverage, clearing, forecast } = input
  // 合成兜底一律当作「没有数据」：loadClearingCurve 取不到真实曲线时会 synth96 编一条，
  // 画出来与真实曲线毫无区别，KPI 也会照着它算——宁可空着。
  const realPoints = clearing.basis === 'synthetic' ? [] : clearing.points
  const run = pickUsableRun(forecast)
  const forecastPoints: CurvePoint[] = run
    ? run.points.map((value, index) => ({ time: timeAxis96[index] ?? '', value }))
    : []

  let error = ''
  if (!realPoints.length && !forecastPoints.length) {
    error = coverage
      ? `${date} 既无出清曲线也无已落库预测（真实数据覆盖至 ${coverage.end}）`
      : `${date} 无真实出清数据，且该地区未登记价格数据集`
  } else if (!forecastPoints.length) {
    error = `${date} 尚无已落库的模型预测${forecast.reason ? `：${forecast.reason}` : ''}`
  } else if (!realPoints.length) {
    error = `${date} 尚未出清，图中只有模型预测`
  }

  return {
    realPoints,
    forecastPoints,
    // KPI 口径是**实际出清**：此前用的是预测曲线（且多半是合成的），一个叫「预测均价」的
    // 数字其实来自编造的曲线，比没有数字更误导。
    stats: realPoints.length ? curveStats(realPoints) : EMPTY_STATS,
    basis: realPoints.length ? clearing.basis : 'empty',
    hourlySourced: clearing.sourcePoints === 24,
    error,
  }
}
