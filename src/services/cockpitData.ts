// 云南现货交易驾驶舱数据装配层（xhjy/yunnan/cockpit）。
//
// 把驾驶舱七大模块所需真实数据并行取回、做最小派生，组装成贴合原型 ECharts
// builder 入参形状的结构。所有取数走 HTTP：
// - 节点电价（热力/系统均价/基差/负价雷达/KPI）→ spotClient（agent-backend /api/v1/spot/*）
// - 损益归因 / 申报偏差 / 持仓敞口 → captured.fetchCaptured（/api/real 真实回放）
// - 结算三价 → settlementClient（yn_spot_settlement formal 结算聚合）
// - 出力完成率 → plantOutputClient（yn_plant_output 多源出力长表）
// - 厂站 8 源预测精度擂台 → yn_plant_output（plantForecastArena 服务）
//
// 纪律（云南严格地区 · 真实或空）：
// - 任何模块取数失败 / 空都不抛断整页，只把该模块标记 basis='captured' 且 hasData=false，
// 由 UI 显示「请先摄取 import:spot-export --write」空态。绝不伪造、绝不回退别地区。
// - 金额源单位为元，展示口径换算为万元（÷1e4，UI 层做）。本层保留元口径，仅做求和/聚合。
//
// 诚实标注：
// - 基差用「选定节点」(默认 daily summary 首个有效节点) vs 系统均价，非「自有」节点
// （capture 无 self-owned 维度，dim 未消费）。
// - 预测精度擂台用 yn_plant_output 8 源长表按实际功率对拍；厂站预测损失排行仍保留为互补视图。
import {
  fetchDailySummary,
  fetchHeatmap,
  fetchNodePriceSeries,
  type DailySummaryItem,
  type HeatmapData,
  type NodePricePoint,
  type SpotMarket
} from '@/services/market/spotClient'
import { fetchCaptured } from '@/services/captured'
import { todayBeijing } from '@/utils/beijingDate'
import { hedgeCoverage } from '@/services/settlementFormula'
import { loadSettlementPrices, SETTLEMENT_PRIVATE_FAMILIES, type SettlementPriceResult } from '@/services/market/settlementClient'
import { loadPlantOutputPayload, PLANT_OUTPUT_PRIVATE_FAMILIES, type PlantOutputPayload, type PlantOutputRow } from '@/services/market/plantOutputClient'
import { buildPlantForecastArena, type PlantForecastArena } from '@/services/market/plantForecastArena'

// 现货驾驶舱经 fetchCaptured（本模块 + settlementClient + plantOutputClient）读取的
// company 私有 capture 族并集，供 SpotCockpitCore 的 RegionDataBanner opt-in 声明（Sub-4 #520）
// 去重保证稳定。
export const COCKPIT_PRIVATE_FAMILIES = [
  ...new Set(['yn_loss_attribution', ...SETTLEMENT_PRIVATE_FAMILIES, ...PLANT_OUTPUT_PRIVATE_FAMILIES])
]

// 行类型（与 YunnanSpotPnLPanel 对齐，来自数据层 ROW_SCHEMAS）
export interface LossRow {
  date: string
  plant: string
  area: string
  totalGenerationMwh: number | null
  strategyLossTotal: number | null
  strategyLossPerMwh: number | null
  forecastLossTotal: number | null
  forecastLossPerMwh: number | null
  gridLossTotal: number | null
  gridLossPerMwh: number | null
  originalValueTotal: number | null
}

export interface SettlementRow {
  date: string
  plant: string
  area: string
  ltmEnergy: number | null
  ltmPrice: number | null
  daClearedEnergy: number | null
  daDevEnergy: number | null
  daPrice: number | null
  daDevFee: number | null
  rtDevEnergy: number | null
  rtPrice: number | null
  rtDevFee: number | null
  actualOnGridEnergy: number | null
  totalEnergy: number | null
  avgPrice: number | null
  totalFee: number | null
}

export interface CockpitOptions {
  /** 现货端点 region 参数（业务中文名，如「云南」）。 */
  regionName: string
  /** 全局地区 id（如 'yunnan'），用于 banner/标注。 */
  regionId: string
  /** 交易日（默认 2026-05 内），节点电价/热力按此日。 */
  date: string
  /** 市场口径 da=日前 / rt=实时。 */
  market: SpotMarket
  /** 损益/结算/敞口的日期范围（默认整月）。 */
  dateRange?: [string, string]
  /** 基差/负价雷达选定节点；缺省时取 daily summary 首个有效节点。 */
  node?: string
}

// 模块结果类型
export interface CockpitKpis {
  marketAvg: number | null
  settlementAvgPrice: number | null // 综合结算均价（元/MWh，settlementClient 当前日）
  settlementDaPrice: number | null // 日前结算电价（元/MWh）
  settlementRtPrice: number | null // 实时结算电价（元/MWh）
  peakValleySpread: number | null
  negNodeSharePct: number | null
  minNodePrice: number | null
  maxNodePrice: number | null
  coverageRate: number | null // 0~1
  openExposurePct: number | null // 0~100
  expectedRevenueWan: number | null // 实现损益（万元，结算 totalFee 求和换算）
  biddingSpaceMWh: number | null // 竞价空间近似=当日均(负荷−新能源)，MW（外送未入，同 elasticity 口径）
  hydroSharePct: number | null // 水电占比=当日均(水电/负荷)，%（云南丰枯主驱动）
  plantOutputCompletionPct: number | null // 实际出力 / 最终下发（无下发时回退预测源），%
  plantOutputTargetSource: string | null
  plantOutputPointCount: number
  forecastMapePct: number | null // 最优预测/下发源 MAPE，%
  forecastMapeSource: string | null
  forecastMapeSamples: number
  hasData: boolean
}

export interface HeatmapModule {
  nodes: string[]
  timePoints: string[]
  matrix: (number | null)[][]
  hasData: boolean
}

export interface BasisModule {
  /** 选定节点名（诚实：非自有）。 */
  node: string | null
  timePoints: string[]
  nodePrices: (number | null)[]
  systemAvg: (number | null)[]
  /** 基差 = 节点 − 系统（null 处对齐跳过）。 */
  basisDiff: (number | null)[]
  /** 当前（全天均值）基差，元/MWh。 */
  currentBasis: number | null
  hasData: boolean
}

export interface NegativeWindow {
  startTime: string
  endTime: string
  count: number // 连续负价点数
  minPrice: number
}

export interface NegRadarModule {
  node: string | null
  timePoints: string[]
  prices: (number | null)[]
  window: NegativeWindow | null
  /** 规避损失估算（元，估算口径，见注释）。 */
  avoidLossYuan: number | null
  hasData: boolean
}

export interface WaterfallModule {
  /** 元口径；UI 换算万元。原始价值 → 减三段 → 实现。缺测全空段为 null（fmt 显示「—」，#1755）。 */
  originalValue: number | null
  strategyLoss: number | null
  forecastLoss: number | null
  gridLoss: number | null
  realized: number | null
  hasData: boolean
}

export interface PlantRankRow {
  plant: string
  value: number // 元
}

export interface ForecastDiagModule {
  /** 按 forecastLossTotal 降序的厂站排行（元）。 */
  ranking: PlantRankRow[]
  hasData: boolean
}

export interface DeviationDay {
  date: string
  daDevEnergy: number | null
  rtDevEnergy: number | null
  daDevFee: number | null
  rtDevFee: number | null
}

export interface DeviationModule {
  days: DeviationDay[]
  /** |实时偏差电费| 最大的日（考核预警）。 */
  worstDay: DeviationDay | null
  hasData: boolean
}

export type DecisionKind = 'risk' | 'tune' | 'opp' | 'audit'
export interface DecisionItem {
  kind: DecisionKind
  title: string
  desc: string
  /** 量化影响（万元，正数表示金额规模）。 */
  impactWan: number
  impactLabel: string // 如「规避损失」「降损」「考核费」
}

export interface PositionModule {
  ltmEnergy: number | null // 中长期电量 MWh
  totalEnergy: number | null // 总电量 MWh
  coverageRate: number // 0~1
  openExposureMwh: number
  openExposurePct: number // 0~100
  hasData: boolean
}

/** 逐日敞口序列点（按结算日聚合 ltm/total，captured 真实派生）。 */
export interface ExposureSeriesPoint {
  date: string
  ltm: number | null // 中长期电量 MWh（缺测 null，#1755）
  total: number | null // 总电量 MWh
  openMwh: number | null // 敞口 = total − ltm（>0 净卖出 / <0 净买入）
  coverage: number // 套保率 ltm/total（0~1）
}

export interface CockpitData {
  date: string
  market: SpotMarket
  regionId: string
  regionName: string
  kpis: CockpitKpis
  heatmap: HeatmapModule
  basis: BasisModule
  negRadar: NegRadarModule
  waterfall: WaterfallModule
  forecastDiag: ForecastDiagModule
  deviation: DeviationModule
  decisions: DecisionItem[]
  position: PositionModule
  /** 逐日敞口序列（持仓敞口曲线，captured 真实派生）。 */
  exposureSeries: ExposureSeriesPoint[]
  /** 厂站 8 源 MAPE 擂台，随 loadCockpit 一起装配，避免驾驶舱内重复取数。 */
  forecastArena: PlantForecastArena
  /** 整体是否取到任何真实数据（用于整页 ingest-hint）。 */
  hasAnyData: boolean
  /** 各模块取数错误透出（非空态，硬错误）。 */
  errors: string[]
}

const WAN = 10000

// #1755：null 感知求和跟踪器（与 SpotPnLPanel 同款），全 null → null（fmt 显示「—」），
// 部分 null → 有效值之和。
function trackedSum() {
  let sum = 0
  let valid = 0
  return {
    add(v: number | null | undefined) { if (v != null) { sum += v; valid += 1 } },
    value(): number | null { return valid > 0 ? sum : null }
  }
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function finiteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface PlantOutputKpi {
  completionPct: number | null
  targetSource: string | null
  pointCount: number
  hasData: boolean
}

function pickValuedRow(rows: PlantOutputRow[], preferredTypes: string[]): PlantOutputRow | null {
  for (const type of preferredTypes) {
    const row = rows.find((r) => r.dataType === type && finiteNumber(r.valueMw) !== null)
    if (row) return row
  }
  return rows.find((r) => finiteNumber(r.valueMw) !== null) ?? null
}

function derivePlantOutputKpi(rows: PlantOutputRow[]): PlantOutputKpi {
  const byPlantPoint = new Map<string, PlantOutputRow[]>()
  for (const row of rows) {
    if (!row.plant || !Number.isFinite(Number(row.point))) continue
    const key = `${row.plant}|${Number(row.point)}`
    const list = byPlantPoint.get(key) ?? []
    list.push(row)
    byPlantPoint.set(key, list)
  }

  let actualSum = 0
  let targetSum = 0
  let pointCount = 0
  const targetCounts = new Map<string, number>()

  for (const list of byPlantPoint.values()) {
    const actualRow = pickValuedRow(
      list.filter((r) => r.seriesRole === 'actual'),
      ['实际功率', '子站回传']
    )
    const targetRow =
      pickValuedRow(list.filter((r) => r.seriesRole === 'plan'), ['最终下发']) ??
      pickValuedRow(list.filter((r) => r.seriesRole === 'forecast'), ['超短期预测', '国能日新预测', '远景集团预测'])
    const actual = finiteNumber(actualRow?.valueMw)
    const target = finiteNumber(targetRow?.valueMw)
    if (actual === null || target === null || Math.abs(target) < 1e-9) continue
    actualSum += actual
    targetSum += target
    pointCount += 1
    if (targetRow?.dataType) {
      targetCounts.set(targetRow.dataType, (targetCounts.get(targetRow.dataType) ?? 0) + 1)
    }
  }

  const targetSource = [...targetCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))[0]?.[0] ?? null
  return {
    completionPct: pointCount && Math.abs(targetSum) > 1e-9 ? +((actualSum / targetSum) * 100).toFixed(1) : null,
    targetSource,
    pointCount,
    hasData: pointCount > 0
  }
}

function pickRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  if (Array.isArray(data)) return data as T[]
  return []
}

function inRange(date: string, range?: [string, string]): boolean {
  if (!range) return true
  const [from, to] = range
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

// 热力 matrix 按时段列向求均（忽略 null）= 系统均价曲线
function columnMeans(matrix: (number | null)[][]): (number | null)[] {
  const cols = matrix.reduce((m, row) => Math.max(m, row?.length ?? 0), 0)
  const out: (number | null)[] = []
  for (let c = 0; c < cols; c++) {
    let sum = 0
    let n = 0
    for (const row of matrix) {
      const v = row?.[c]
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue
      sum += Number(v)
      n += 1
    }
    out.push(n ? +(sum / n).toFixed(2) : null)
  }
  return out
}

// 系统均价曲线整天均值（用于「当前基差」标量）
function average(arr: (number | null)[]): number | null {
  let sum = 0
  let n = 0
  for (const v of arr) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue
    sum += v
    n += 1
  }
  return n ? +(sum / n).toFixed(2) : null
}

// 扫最长连续负价段（price<0 的连续 time_point 区间）
function longestNegativeWindow(
  prices: (number | null)[],
  times: string[]
): NegativeWindow | null {
  let bestStart = -1
  let bestLen = 0
  let bestMin = 0
  let curStart = -1
  let curLen = 0
  let curMin = 0
  const flush = () => {
    if (curLen > bestLen) {
      bestLen = curLen
      bestStart = curStart
      bestMin = curMin
    }
  }
  for (let i = 0; i < prices.length; i++) {
    const v = prices[i]
    const neg = v !== null && v !== undefined && Number(v) < 0
    if (neg) {
      if (curLen === 0) {
        curStart = i
        curMin = Number(v)
      } else {
        curMin = Math.min(curMin, Number(v))
      }
      curLen += 1
    } else {
      flush()
      curLen = 0
    }
  }
  flush()
  if (bestLen === 0 || bestStart < 0) return null
  const endIdx = bestStart + bestLen - 1
  return {
    startTime: times[bestStart] ?? '',
    endTime: times[endIdx] ?? '',
    count: bestLen,
    minPrice: +bestMin.toFixed(2)
  }
}

// 负价雷达：取「负价占比最高 / 价格最负」节点（用于扫弃发窗口）
function pickNegativeNode(items: DailySummaryItem[]): string | null {
  if (!items.length) return null
  // 先按负价占比降序，其次按最低价升序（更负者优先）。
  const sorted = [...items].sort((a, b) => {
    const na = a.neg_share_pct ?? 0
    const nb = b.neg_share_pct ?? 0
    if (nb !== na) return nb - na
    return (a.min ?? Infinity) - (b.min ?? Infinity)
  })
  const top = sorted[0]
  if (!top) return null
  // 该节点没有任何负价特征时不强制选（避免在无负价日造假）。
  if ((top.neg_share_pct ?? 0) <= 0 && (top.min ?? 0) >= 0) return null
  return top.node_name
}

async function safe<T>(p: Promise<T>, errors: string[], label: string): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    const msg = e instanceof Error ? e.message : '加载失败'
    // 后端未摄取/空类信息不当作硬错误（UI 走 ingest-hint）。
    if (!/未摄取|parquet|no data|暂无数据|not found|空|404/i.test(msg)) {
      errors.push(`${label}: ${msg}`)
    }
    return null
  }
}

/**
 * 装配云南现货驾驶舱全部模块数据。所有取数并行、失败降级，不抛断整页。
 */
export async function loadCockpit(opts: CockpitOptions): Promise<CockpitData> {
  const { regionName, regionId, date, market } = opts
  const dateRange = opts.dateRange ?? ['2026-05-01', '2026-05-31']
  const errors: string[] = []

  // 并行取真实数据
  const [dailyRaw, heatRaw, lossRaw, settleRaw, supplyRaw, settlementPriceRaw, plantOutputRaw] = await Promise.all([
    safe<{ items: DailySummaryItem[] }>(
      fetchDailySummary(date, market, 200, regionName),
      errors,
      '节点日聚合'
    ),
    safe<HeatmapData>(fetchHeatmap(date, market, 40, regionName), errors, '价格热力场'),
    safe<unknown>(fetchCaptured('yn_loss_attribution', 'yn_loss_daily'), errors, '损益归因'),
    safe<unknown>(fetchCaptured('yn_spot_settlement', 'yn_settlement_daily'), errors, '申报偏差/结算'),
    // 系统供需当日切片（KPI 竞价空间/水电占比；载荷级日期过滤，96 行小载荷）
    safe<unknown>(fetchCaptured('yn_system_supply', 'yn_system_supply_demand', { dateFrom: date, dateTo: date }), errors, '系统供需'),
    safe<SettlementPriceResult>(loadSettlementPrices({ dateRange: [date, date] }), errors, '结算三价'),
    safe<PlantOutputPayload>(loadPlantOutputPayload(date), errors, '多源出力')
  ])

  const dailyItems = dailyRaw?.items ?? []
  const heatNodes = heatRaw?.nodes ?? []
  const heatTimes = heatRaw?.time_points ?? []
  const heatMatrix = heatRaw?.matrix ?? []
  const lossRows = pickRows<LossRow>(lossRaw).filter((r) => inRange(r.date, dateRange))
  const settleRows = pickRows<SettlementRow>(settleRaw).filter((r) => inRange(r.date, dateRange))
  const settlementPoint = settlementPriceRaw?.points.find((p) => p.date === date) ?? settlementPriceRaw?.points[0] ?? null
  const plantOutputRows = plantOutputRaw?.rows ?? []
  const plantOutputKpi = derivePlantOutputKpi(plantOutputRows)
  const forecastArena = buildPlantForecastArena(plantOutputRows, date)
  const bestForecastMape = forecastArena.sources.find((s) => ['forecast', 'plan'].includes(s.role) && s.mape !== null)
    ?? forecastArena.sources.find((s) => s.mape !== null)
    ?? null

  // 系统均价曲线（热力 matrix 列向求均）
  const systemAvg = columnMeans(heatMatrix)
  const systemAvgMean = average(systemAvg)

  // ① 市场态势 KPI
  const validDaily = dailyItems.filter((i) => i.avg !== null && i.avg !== undefined)
  const avgOfAvg = validDaily.length
    ? +(validDaily.reduce((s, i) => s + (i.avg ?? 0), 0) / validDaily.length).toFixed(1)
    : null
  const maxNode = dailyItems.reduce<number | null>(
    (m, i) => (i.max !== null && i.max !== undefined ? (m === null ? i.max : Math.max(m, i.max)) : m),
    null
  )
  const minNode = dailyItems.reduce<number | null>(
    (m, i) => (i.min !== null && i.min !== undefined ? (m === null ? i.min : Math.min(m, i.min)) : m),
    null
  )
  // 负价节点占比%：当日存在负价（neg_share_pct>0）的节点数 / 节点总数。
  const negNodeShare = dailyItems.length
    ? +(
        (dailyItems.filter((i) => (i.neg_share_pct ?? 0) > 0).length / dailyItems.length) *
        100
      ).toFixed(1)
    : null
  // 峰谷价差 = 系统均价曲线 max − min。
  const sysValid = systemAvg.filter((v): v is number => v !== null)
  const peakValley = sysValid.length
    ? +(Math.max(...sysValid) - Math.min(...sysValid)).toFixed(1)
    : null

  // ② 价格热力场（截 16~40 节点，后端已 top_nodes=40）
  const heatmapModule: HeatmapModule = {
    nodes: heatNodes,
    timePoints: heatTimes,
    matrix: heatMatrix,
    hasData: heatNodes.length > 0 && heatMatrix.length > 0
  }

  // ③ 基差（选定节点 vs 系统均价）
  const basisNode =
    opts.node && opts.node.trim()
      ? opts.node.trim()
      : validDaily[0]?.node_name ?? dailyItems[0]?.node_name ?? null
  let basisSeries: NodePricePoint[] = []
  let negSeries: NodePricePoint[] = []
  // 负价雷达节点：优先负价特征最强的节点（与基差节点可不同）。
  const negNode = pickNegativeNode(dailyItems) ?? basisNode

  const seriesTasks: Array<Promise<unknown>> = []
  if (basisNode && heatModuleHasData(heatmapModule)) {
    seriesTasks.push(
      safe(fetchNodePriceSeries(date, basisNode, market, regionName), errors, '基差节点序列').then(
        (r) => {
          basisSeries = (r as { series?: NodePricePoint[] } | null)?.series ?? []
        }
      )
    )
  }
  if (negNode && negNode !== basisNode) {
    seriesTasks.push(
      safe(fetchNodePriceSeries(date, negNode, market, regionName), errors, '负价节点序列').then(
        (r) => {
          negSeries = (r as { series?: NodePricePoint[] } | null)?.series ?? []
        }
      )
    )
  }
  await Promise.all(seriesTasks)
  if (negNode === basisNode) negSeries = basisSeries

  const basisTimes = basisSeries.map((p) => p.time_point)
  const basisPrices = basisSeries.map((p) => p.price)
  // 系统均价按热力时段，与基差节点 96 点对齐（同 date/market，时点一致）。
  const sysAligned = alignSystemToSeries(basisTimes, heatTimes, systemAvg)
  const basisDiff: (number | null)[] = basisPrices.map((p, i) => {
    const s = sysAligned[i]
    if (p === null || p === undefined || s === null || s === undefined) return null
    return +(Number(p) - Number(s)).toFixed(2)
  })
  const basisMean = average(basisPrices)
  const currentBasis =
    basisMean !== null && systemAvgMean !== null ? +(basisMean - systemAvgMean).toFixed(2) : null
  const basisModule: BasisModule = {
    node: basisNode,
    timePoints: basisTimes,
    nodePrices: basisPrices,
    systemAvg: sysAligned,
    basisDiff,
    currentBasis,
    hasData: basisSeries.length > 0
  }

  // ④ 负价雷达 + 弃发建议
  const negTimes = negSeries.map((p) => p.time_point)
  const negPrices = negSeries.map((p) => p.price)
  const negWindow = longestNegativeWindow(negPrices, negTimes)
  // 规避损失估算（元，估算口径）：Σ(该段 |负价| × 单位可调电量近似)。
  // 缺真实节点装机/可调度数据，单位可调电量用「节点该日均发电 / 96」近似；
  // 节点装机维度未消费，故用厂站侧总发电除以节点数与点数作粗略代理。本数仅供量级参考。
  let avoidLossYuan: number | null = null
  if (negWindow && negPrices.length) {
    // 单点可调电量近似：当日全厂站总发电(MWh) / 节点数 / 96 点 → 单节点单点 MWh。
    const totalGen = lossRows
      .filter((r) => r.date === date)
      .reduce((s, r) => s + toNum(r.totalGenerationMwh), 0)
    const nodeCount = Math.max(dailyItems.length, 1)
    const perPointMwh = totalGen > 0 ? totalGen / nodeCount / 96 : 0
    if (perPointMwh > 0) {
      let acc = 0
      // 仅累计窗口内负价点。
      for (let i = 0; i < negPrices.length; i++) {
        const t = negTimes[i]
        if (negWindow.startTime <= t && t <= negWindow.endTime) {
          const v = negPrices[i]
          if (v !== null && v !== undefined && Number(v) < 0) {
            acc += Math.abs(Number(v)) * perPointMwh
          }
        }
      }
      avoidLossYuan = +acc.toFixed(0)
    }
  }
  const negRadar: NegRadarModule = {
    node: negNode,
    timePoints: negTimes,
    prices: negPrices,
    window: negWindow,
    avoidLossYuan,
    hasData: negSeries.length > 0
  }

  // ⑤ 损益瀑布（按日期范围聚合，元口径）
  // #1755：null-aware，全空段落 null（前端 fmt 显示「—」），不按假零 0 展示。
  const strategyLoss = trackedSum()
  const forecastLoss = trackedSum()
  const gridLoss = trackedSum()
  const originalValue = trackedSum()
  for (const r of lossRows) {
    strategyLoss.add(r.strategyLossTotal)
    forecastLoss.add(r.forecastLossTotal)
    gridLoss.add(r.gridLossTotal)
    originalValue.add(r.originalValueTotal)
  }
  const sl = strategyLoss.value()
  const fl = forecastLoss.value()
  const gl = gridLoss.value()
  const ov = originalValue.value()
  // 实现损益 = 原始值 - 各段损失；任一段全 null 则 realized 落 null（无法诚实计算）。
  const realized = ov != null && sl != null && fl != null && gl != null
    ? ov - sl - fl - gl
    : null
  const waterfall: WaterfallModule = {
    originalValue: ov == null ? null : +ov.toFixed(2),
    strategyLoss: sl == null ? null : +sl.toFixed(2),
    forecastLoss: fl == null ? null : +fl.toFixed(2),
    gridLoss: gl == null ? null : +gl.toFixed(2),
    realized: realized == null ? null : +realized.toFixed(2),
    hasData: lossRows.length > 0 && (ov != null || sl != null || fl != null || gl != null)
  }

  // ⑥ 预测损失诊断（按厂站 forecastLossTotal 降序）
  const forecastByPlant = new Map<string, ReturnType<typeof trackedSum>>()
  for (const r of lossRows) {
    let cur = forecastByPlant.get(r.plant)
    if (!cur) { cur = trackedSum(); forecastByPlant.set(r.plant, cur) }
    cur.add(r.forecastLossTotal)
  }
  // #1755：全 null 的厂站不进入排行（避免 0 损失假数据）。
  const forecastRanking = Array.from(forecastByPlant.entries())
    .map(([plant, value]) => ({ plant, value: value.value() }))
    .filter((r) => r.plant && r.value != null)
    .map((r) => ({ plant: r.plant, value: +r.value!.toFixed(2) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
  const forecastDiag: ForecastDiagModule = {
    ranking: forecastRanking,
    hasData: forecastRanking.length > 0
  }

  // 策略损失诊断（用于决策清单：策略损失最高厂站）
  // #1755：trackedSum 语义，全 null 厂站不参与排行（避免 0 损失假数据）。
  const strategyByPlant = new Map<string, ReturnType<typeof trackedSum>>()
  for (const r of lossRows) {
    let cur = strategyByPlant.get(r.plant)
    if (!cur) { cur = trackedSum(); strategyByPlant.set(r.plant, cur) }
    cur.add(r.strategyLossTotal)
  }
  const topStrategyPlant = Array.from(strategyByPlant.entries())
    .map(([plant, value]) => [plant, value.value()] as const)
    .filter(([, v]) => v != null)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]

  // ⑦ 申报偏差体检（按日聚合）
  // #1755：devMap 值类型为求和跟踪器（聚合期），输出时映射回 DeviationDay（number | null）。
  const devMap = new Map<string, {
    date: string
    daDevEnergy: ReturnType<typeof trackedSum>
    rtDevEnergy: ReturnType<typeof trackedSum>
    daDevFee: ReturnType<typeof trackedSum>
    rtDevFee: ReturnType<typeof trackedSum>
  }>()
  for (const r of settleRows) {
    // #1755：null 感知求和，null 不参与加和但计数；该指标全部 null 时输出 null（诚实
    // 「无数据」，前端 fmt 显示「—」），部分 null 时输出有效值之和（null 等价跳过）。
    const cur = devMap.get(r.date) ?? {
      date: r.date,
      daDevEnergy: trackedSum(),
      rtDevEnergy: trackedSum(),
      daDevFee: trackedSum(),
      rtDevFee: trackedSum()
    }
    cur.daDevEnergy.add(r.daDevEnergy)
    cur.rtDevEnergy.add(r.rtDevEnergy)
    cur.daDevFee.add(r.daDevFee)
    cur.rtDevFee.add(r.rtDevFee)
    devMap.set(r.date, cur)
  }
  const devDays = Array.from(devMap.values())
    .map((v) => ({ date: v.date, daDevEnergy: v.daDevEnergy.value(), rtDevEnergy: v.rtDevEnergy.value(), daDevFee: v.daDevFee.value(), rtDevFee: v.rtDevFee.value() }))
    .sort((a, b) => a.date.localeCompare(b.date))
  // #1755：null 感知，全 null 的 rtDevFee 天不参与 worst 比较（真实最大电费日）。
  // #1755：先过滤 rtDevFee 非 null，再按 |rtDevFee| 比较，负值不被正小值压过、
  // 全 null 时 worstDay 落 null（前端不展示预警/高亮）。
  const devDaysWithFee = devDays.filter((d) => d.rtDevFee != null)
  const worstDay =
    devDaysWithFee.length > 0
      ? devDaysWithFee.reduce((w, d) => (Math.abs(d.rtDevFee!) > Math.abs(w.rtDevFee!) ? d : w), devDaysWithFee[0])
      : null
  const deviation: DeviationModule = {
    days: devDays,
    worstDay,
    hasData: devDays.length > 0
  }

  // 持仓与敞口（结算 ltm/总电量真实派生）
  // #1755：trackedSum，全 null 时敞口不按 0 假数据展示（hasData=false）。
  const ltmEnergy = trackedSum()
  const totalEnergy = trackedSum()
  for (const r of settleRows) {
    ltmEnergy.add(r.ltmEnergy)
    totalEnergy.add(r.totalEnergy)
  }
  const ltmV = ltmEnergy.value()
  const totalV = totalEnergy.value()
  const cov = hedgeCoverage({ contractedMwh: ltmV ?? 0, forecastMwh: totalV ?? 0 })
  const position: PositionModule = {
    ltmEnergy: ltmV == null ? null : +ltmV.toFixed(1),
    totalEnergy: totalV == null ? null : +totalV.toFixed(1),
    coverageRate: cov.coverageRate,
    openExposureMwh: cov.openExposureMwh,
    openExposurePct: totalV != null && totalV > 0 ? +((1 - cov.coverageRate) * 100).toFixed(1) : 0,
    hasData: settleRows.length > 0 && (ltmV != null || totalV != null)
  }

  // 逐日敞口序列（按结算日聚合 ltm/total，captured 真实派生）
  // #1755：trackedSum，全 null 日敞口落 null（图表断点而非假零 0）。
  const expByDate = new Map<string, { ltm: ReturnType<typeof trackedSum>; total: ReturnType<typeof trackedSum> }>()
  for (const r of settleRows) {
    const key = String(r.date)
    let acc = expByDate.get(key)
    if (!acc) { acc = { ltm: trackedSum(), total: trackedSum() }; expByDate.set(key, acc) }
    acc.ltm.add(r.ltmEnergy)
    acc.total.add(r.totalEnergy)
  }
  const exposureSeries: ExposureSeriesPoint[] = [...expByDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, v]) => {
      const ltm = v.ltm.value()
      const total = v.total.value()
      return {
        date: d,
        ltm: ltm == null ? null : +ltm.toFixed(1),
        total: total == null ? null : +total.toFixed(1),
        openMwh: ltm != null && total != null ? +(total - ltm).toFixed(1) : null,
        coverage: total != null && total > 0 && ltm != null ? +(ltm / total).toFixed(4) : 0
      }
    })

  // 实现损益（万元）= 结算 totalFee 求和换算
  // #1755：trackedSum 语义，全 null 时 expectedRevenueWan 落 null（KPI 显示
  // 「—」而非 0.0 万元），部分 null 时有效值之和。
  const totalFee = trackedSum()
  for (const r of settleRows) totalFee.add(r.totalFee)
  const feeValue = totalFee.value()
  const expectedRevenueWan = feeValue == null ? null : +(feeValue / WAN).toFixed(1)

  // 竞价空间/水电占比（yn_system_supply 当日均值；缺测行 null 已被过滤语义保护）
  interface SupplyRow { date?: string; loadMWh?: number | null; newEnergyMWh?: number | null; hydropowerMWh?: number | null }
  const supplyRows = pickRows<SupplyRow>(supplyRaw)
  let bsSum = 0; let bsN = 0; let hySum = 0; let hyN = 0
  for (const r of supplyRows) {
    const load = r.loadMWh; const ne = r.newEnergyMWh; const hy = r.hydropowerMWh
    if (typeof load === 'number' && Number.isFinite(load) && load > 0) {
      if (typeof ne === 'number' && Number.isFinite(ne)) { bsSum += load - ne; bsN += 1 }
      if (typeof hy === 'number' && Number.isFinite(hy)) { hySum += hy / load; hyN += 1 }
    }
  }
  const biddingSpaceMWh = bsN ? +(bsSum / bsN).toFixed(0) : null
  const hydroSharePct = hyN ? +((hySum / hyN) * 100).toFixed(1) : null

  const kpis: CockpitKpis = {
    marketAvg: avgOfAvg,
    settlementAvgPrice: settlementPoint?.avgPrice ?? null,
    settlementDaPrice: settlementPoint?.daPrice ?? null,
    settlementRtPrice: settlementPoint?.rtPrice ?? null,
    peakValleySpread: peakValley,
    negNodeSharePct: negNodeShare,
    minNodePrice: minNode,
    maxNodePrice: maxNode,
    coverageRate: position.hasData ? cov.coverageRate : null,
    openExposurePct: position.hasData ? position.openExposurePct : null,
    expectedRevenueWan,
    biddingSpaceMWh,
    hydroSharePct,
    plantOutputCompletionPct: plantOutputKpi.completionPct,
    plantOutputTargetSource: plantOutputKpi.targetSource,
    plantOutputPointCount: plantOutputKpi.pointCount,
    forecastMapePct: bestForecastMape?.mape ?? null,
    forecastMapeSource: bestForecastMape?.source ?? null,
    forecastMapeSamples: bestForecastMape?.mapeSamples ?? 0,
    hasData:
      dailyItems.length > 0 ||
      settleRows.length > 0 ||
      supplyRows.length > 0 ||
      settlementPriceRaw?.hasData === true ||
      plantOutputKpi.hasData ||
      forecastArena.hasData
  }

  // 决策清单（从真实派生；某数据源为空的条目不生成）
  const decisions: DecisionItem[] = []
  // 1) 负价规避 · 弃发
  if (negWindow && avoidLossYuan && avoidLossYuan > 0) {
    decisions.push({
      kind: 'risk',
      title: '负价规避 · 弃发',
      desc: `${negWindow.startTime}–${negWindow.endTime} 连续负价（谷值 ${negWindow.minPrice} 元），节点 ${negNode ?? ''}`,
      impactWan: +(avoidLossYuan / WAN).toFixed(1),
      impactLabel: '规避损失(估算)'
    })
  }
  // 2) 预测源切换（预测损失 top 厂站）
  if (forecastRanking.length && forecastRanking[0].value > 0) {
    const top = forecastRanking[0]
    decisions.push({
      kind: 'tune',
      title: '预测源切换',
      desc: `${top.plant} 区间预测损失 ${(top.value / WAN).toFixed(1)} 万元，为最大失血厂站，建议评估换预测源`,
      impactWan: +(top.value / WAN).toFixed(1),
      impactLabel: '潜在降损'
    })
  }
  // 3) 策略损失高 → 调申报覆盖率
  // #1755：filter 已保证 [1] 非 null（全 null 厂站不进排行）。
  if (topStrategyPlant && topStrategyPlant[1] != null && topStrategyPlant[1] > 0) {
    decisions.push({
      kind: 'opp',
      title: '申报覆盖率调整',
      desc: `${topStrategyPlant[0]} 策略损失 ${(topStrategyPlant[1] / WAN).toFixed(1)} 万元，建议优化中长期申报覆盖率`,
      impactWan: +(topStrategyPlant[1] / WAN).toFixed(1),
      impactLabel: '可改善损失'
    })
  }
  // 4) 偏差考核预警（实时偏差电费最大日）
  // #1755：rtDevFee 全 null（无偏差电费数据）不触发「偏差考核预警」决策（避免假零 0 误报）。
  if (worstDay && worstDay.rtDevFee != null && Math.abs(worstDay.rtDevFee) > 0) {
    decisions.push({
      kind: 'audit',
      title: '偏差考核预警',
      desc: `${worstDay.date} 实时偏差电量 ${worstDay.rtDevEnergy == null ? '—' : worstDay.rtDevEnergy.toFixed(0)} MWh，偏差电费规模最大`,
      impactWan: worstDay.rtDevFee == null ? 0 : +(Math.abs(worstDay.rtDevFee) / WAN).toFixed(1),
      impactLabel: '偏差电费'
    })
  }
  // 5) 中长期覆盖 / 现货敞口
  if (position.hasData && position.openExposurePct > 0) {
    decisions.push({
      kind: 'opp',
      title: '套保比 / 敞口提示',
      desc: `中长期覆盖率 ${(position.coverageRate * 100).toFixed(0)}%，现货敞口 ${position.openExposurePct.toFixed(0)}%（敞口电量 ${position.openExposureMwh.toFixed(0)} MWh）`,
      impactWan: +(position.openExposureMwh / 1000).toFixed(1),
      impactLabel: '敞口(千MWh)'
    })
  }

  // supplyRows 计入整页有数判断：现场可能只导入了披露/供需（节点电价未摄取），
  // 此时 KPI 已展示竞价空间/水电占比，若 hasAnyData=false 会误弹「未摄取」提示
  const hasAnyData =
    heatmapModule.hasData ||
    waterfall.hasData ||
    deviation.hasData ||
    basisModule.hasData ||
    dailyItems.length > 0 ||
    supplyRows.length > 0 ||
    settlementPriceRaw?.hasData === true ||
    plantOutputKpi.hasData ||
    forecastArena.hasData

  return {
    date,
    market,
    regionId,
    regionName,
    kpis,
    heatmap: heatmapModule,
    basis: basisModule,
    negRadar,
    waterfall,
    forecastDiag,
    deviation,
    decisions,
    position,
    exposureSeries,
    forecastArena,
    hasAnyData,
    errors
  }
}

function heatModuleHasData(m: HeatmapModule): boolean {
  return m.hasData
}

// 系统均价曲线时点与基差节点 96 点对齐：若 time_points 一致直接用；否则按索引对齐补 null。
function alignSystemToSeries(
  seriesTimes: string[],
  heatTimes: string[],
  systemAvg: (number | null)[]
): (number | null)[] {
  if (!seriesTimes.length) return []
  // 热力时段与节点序列时点都来自同一 date/market，正常完全一致。
  if (heatTimes.length === seriesTimes.length) return systemAvg.slice(0, seriesTimes.length)
  // 时点不一致时按 time_point 建索引查表。
  const map = new Map<string, number | null>()
  heatTimes.forEach((t, i) => map.set(t, systemAvg[i] ?? null))
  return seriesTimes.map((t) => (map.has(t) ? (map.get(t) ?? null) : null))
}


// 官方预测 vs 实际 · MAPE 擂台（驾驶舱⑦升级，源 yn_system_forecast，南网整年披露）
// 四对指标（load/new_energy/total_generation/non_market 的官方 D-1 预测 vs 实际），
// 按 (operateDate|timePoint|region) 精确对齐后计算 MAPE；云南主线（region=yn）+
// 全区域对照（region=all）。hydro 无官方预测表，如实不入擂台。
// 大族防护：走 /api/real 载荷级日期过滤（默认近 14 天，每 key ≈8k 行）。
// 口径：MAPE 排除 |实际|<1 MW 的点（避免近零除法爆炸）；这是「南网官方预测的
// 准确度」（真实披露 captured），非本系统模型精度。

export interface ArenaMetric {
  key: string
  label: string
  /** MAPE %（null=无对齐点） */
  mapeYn: number | null
  mapeAll: number | null
  points: number
}

export interface ForecastArena {
  hasData: boolean
  dateFrom: string
  dateTo: string
  metrics: ArenaMetric[]
}

const ARENA_PAIRS: Array<{ key: string; label: string; forecast: string; actual: string }> = [
  { key: 'load', label: '统调负荷', forecast: 'load_forecast', actual: 'load_actual' },
  { key: 'new_energy', label: '新能源', forecast: 'new_energy_forecast_d1', actual: 'new_energy_actual' },
  { key: 'total_generation', label: '总发电', forecast: 'total_generation_forecast', actual: 'total_generation_actual' },
  { key: 'non_market', label: '非市场机组', forecast: 'non_market_forecast', actual: 'non_market_actual' }
]

interface ForecastRow { operateDate?: string; targetDate?: string | null; timePoint?: string; region?: string; value?: number | null }

function arenaMape(fRows: ForecastRow[], aRows: ForecastRow[], region: string): { mape: number | null; points: number } {
  const actualByKey = new Map<string, number>()
  for (const r of aRows) {
    if (r.region !== region) continue
    const v = finiteNumber(r.value)
    if (r.operateDate && r.timePoint && v !== null) actualByKey.set(`${r.operateDate}|${r.timePoint}`, v)
  }
  let sum = 0
  let n = 0
  for (const r of fRows) {
    if (r.region !== region) continue
    const f = finiteNumber(r.value)
    // 对齐日期：new_energy_forecast_d1 是滚动 D-1 集（operateDate=发布日、targetDate=目标日），
    // 必须用 targetDate 匹配实际，否则「明日预测」错配到发布日当天实际、MAPE 整体错一天；
    // 其余单日期表 targetDate=null 回退 operateDate（其 operate_date 即运行日=目标日）。
    const a = actualByKey.get(`${r.targetDate ?? r.operateDate}|${r.timePoint}`)
    if (a === undefined || f === null) continue
    if (Math.abs(a) < 1) continue // 近零实际值排除，防 MAPE 爆炸
    sum += Math.abs(f - a) / Math.abs(a)
    n += 1
  }
  return { mape: n ? +(100 * (sum / n)).toFixed(2) : null, points: n }
}

export async function loadForecastArena(days = 14): Promise<ForecastArena> {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  // 窗口锚定库内最新披露日而非浏览器今天：capture 按导出包/月度回放，最新披露可能远早于
  // 当前日期，固定「今天回推」会让历史包场景整窗落空，先用 load_actual 尾部小切片探测
  // 最新 operateDate，再回推 days 窗口；探测失败/无数据回退今天（真实或空，北京口径）。
  let anchor = todayBeijing()
  try {
    const probe = await fetchCaptured<any>('yn_system_forecast', 'load_actual', { limit: 8 })
    const probeRows: ForecastRow[] = Array.isArray(probe?.data) ? probe.data : []
    const latest = probeRows.map((r) => String(r.operateDate ?? '')).filter(Boolean).sort().at(-1)
    if (latest) anchor = latest
  } catch { /* 探测失败按今天回推 */ }
  const end = new Date(`${anchor}T00:00:00Z`)
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000)
  const dateFrom = iso(start)
  const dateTo = anchor
  const filter = { dateFrom, dateTo }
  // D-1 滚动集窗口平移：/api/real 日期过滤字段是 operateDate（发布日），而
  // new_energy_forecast_d1 的目标日 targetDate=operateDate+1，同窗查询会漏掉「首日实际」
  // 对应的预测行（其 operateDate=dateFrom-1）并带入一个窗口外目标日。预测侧查询窗口整体
  // -1 天；MAPE 按 targetDate 与实际集合求交，多余目标日自动不计入。
  const d1Start = new Date(start.getTime() - 24 * 3600 * 1000)
  const d1End = new Date(end.getTime() - 24 * 3600 * 1000)
  const d1Filter = { dateFrom: iso(d1Start), dateTo: iso(d1End) }
  const metrics: ArenaMetric[] = []
  await Promise.all(ARENA_PAIRS.map(async (pair) => {
    try {
      const [fBody, aBody] = await Promise.all([
        fetchCaptured<any>('yn_system_forecast', pair.forecast,
          pair.forecast === 'new_energy_forecast_d1' ? d1Filter : filter),
        fetchCaptured<any>('yn_system_forecast', pair.actual, filter)
      ])
      const fRows: ForecastRow[] = Array.isArray(fBody?.data) ? fBody.data : []
      const aRows: ForecastRow[] = Array.isArray(aBody?.data) ? aBody.data : []
      const yn = arenaMape(fRows, aRows, 'yn')
      const all = arenaMape(fRows, aRows, 'all')
      metrics.push({ key: pair.key, label: pair.label, mapeYn: yn.mape, mapeAll: all.mape, points: yn.points + all.points })
    } catch {
      // 单指标取数失败不阻断擂台（真实或空：该指标缺席）
      metrics.push({ key: pair.key, label: pair.label, mapeYn: null, mapeAll: null, points: 0 })
    }
  }))
  // 保持固定顺序（Promise.all push 序不定）
  metrics.sort((a, b) => ARENA_PAIRS.findIndex((p) => p.key === a.key) - ARENA_PAIRS.findIndex((p) => p.key === b.key))
  const hasData = metrics.some((m) => m.mapeYn !== null || m.mapeAll !== null)
  return { hasData, dateFrom, dateTo, metrics }
}
