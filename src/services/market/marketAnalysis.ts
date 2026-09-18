import { fetchCaptured } from '@/services/captured'
import type { DataBasis } from '@/services/dataBasis'
import { unifyBasis } from '@/services/data/basis'

export type MarketAnalysisTab = 'overview' | 'generation' | 'sales' | 'storage' | 'packages' | 'price'

export interface MarketMetric {
  label: string
  value: number
  unit: string
  tone: 'blue' | 'green' | 'orange' | 'purple'
}

export interface TradeSummaryRow {
  tradeType: string
  quantity: number
  avgPrice: number
  tradeCount: number
  percentage: number
}

export interface MonthTrendRow {
  month: string
  quantity: number
  avgPrice: number
  mediumLong: number
  spot: number
  ancillary: number
}

export interface HourTradeRow {
  hour: string
  quantity: number
  avgPrice: number
}

export interface CategoryRow {
  name: string
  quantity: number
  avgPrice: number
  count: number
  percentage: number
}

export interface RetailPackageRow {
  companyName: string
  userName: string
  packageType: string
  status: string
  flatPrice: number
  peakPrice: number
  valleyPrice: number
  volume: number
}

export interface PriceTrendRow {
  month: string
  mediumLongPrice: number
  spotPrice: number
  retailPrice: number
  deviation: number
}

export interface MarketAnalysisDataset {
  year: number
  overviewMetrics: MarketMetric[]
  generationMetrics: MarketMetric[]
  salesMetrics: MarketMetric[]
  storageMetrics: MarketMetric[]
  packageMetrics: MarketMetric[]
  tradeSummary: TradeSummaryRow[]
  monthlyTrend: MonthTrendRow[]
  hourData: HourTradeRow[]
  powerTypes: CategoryRow[]
  generationDetails: CategoryRow[]
  salesCompanies: CategoryRow[]
  storageProjects: CategoryRow[]
  retailPackages: RetailPackageRow[]
  priceTrend: PriceTrendRow[]
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const months = Array.from({ length: 12 }, (_, index) => `${index + 1}月`)
const hours = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`)

function yearFactor(year: number) {
  return 1 + (year - 2026) * 0.035
}

function buildMonthlyTrend(year: number): MonthTrendRow[] {
  const factor = yearFactor(year)
  return months.map((month, index) => {
    const seasonal = 1 + Math.sin((index / 12) * Math.PI * 2) * 0.13
    const mediumLong = round((64 + index * 1.8) * seasonal * factor, 2)
    const spot = round((18 + (index % 4) * 3.2) * seasonal * factor, 2)
    const ancillary = round((7 + (index % 3) * 1.6) * seasonal * factor, 2)
    const quantity = round(mediumLong + spot + ancillary, 2)
    const avgPrice = round(0.365 + index * 0.004 + (index % 5) * 0.006, 4)
    return { month, quantity, avgPrice, mediumLong, spot, ancillary }
  })
}

function buildHourData(year: number): HourTradeRow[] {
  const factor = yearFactor(year)
  return hours.map((hour, index) => {
    const morningPeak = Math.exp(-((index - 10) ** 2) / 18) * 8
    const eveningPeak = Math.exp(-((index - 20) ** 2) / 12) * 12
    const valley = index >= 1 && index <= 6 ? -6 : 0
    const quantity = round((22 + morningPeak + eveningPeak + valley) * factor, 2)
    const avgPrice = round(0.33 + morningPeak * 0.006 + eveningPeak * 0.009 + (valley < 0 ? -0.025 : 0), 4)
    return { hour, quantity, avgPrice }
  })
}

function withPercent<T extends { quantity: number }>(rows: Array<Omit<T, 'percentage'> & { percentage?: number }>) {
  const total = rows.reduce((sum, row) => sum + row.quantity, 0)
  return rows.map((row) => ({
    ...row,
    percentage: total ? round(row.quantity / total * 100, 1) : 0
  })) as unknown as T[]
}

function buildTradeSummary(year: number): TradeSummaryRow[] {
  const factor = yearFactor(year)
  const rows = [
    { tradeType: '中长期交易', quantity: round(856.2 * factor, 2), avgPrice: 0.382, tradeCount: 1258 },
    { tradeType: '现货交易', quantity: round(286.4 * factor, 2), avgPrice: 0.486, tradeCount: 3567 },
    { tradeType: '辅助服务', quantity: round(116 * factor, 2), avgPrice: 0.65, tradeCount: 892 }
  ]
  return withPercent<TradeSummaryRow>(rows)
}

function buildPowerTypes(year: number): CategoryRow[] {
  const factor = yearFactor(year)
  return withPercent<CategoryRow>([
    { name: '火电', quantity: round(658.2 * factor, 2), avgPrice: 0.4, count: 89 },
    { name: '风电', quantity: round(286.4 * factor, 2), avgPrice: 0.38, count: 67 },
    { name: '水电', quantity: round(186 * factor, 2), avgPrice: 0.35, count: 45 },
    { name: '太阳能', quantity: round(86.2 * factor, 2), avgPrice: 0.42, count: 32 },
    { name: '综合利用', quantity: round(28.6 * factor, 2), avgPrice: 0.45, count: 12 },
    { name: '电化学储能', quantity: round(12 * factor, 2), avgPrice: 0.52, count: 8 },
    { name: '生物质', quantity: round(1.2 * factor, 2), avgPrice: 0.48, count: 3 }
  ])
}

function buildGenerationDetails(year: number): CategoryRow[] {
  const factor = yearFactor(year)
  return withPercent<CategoryRow>([
    { name: '华能电厂', quantity: round(125.8 * factor, 2), avgPrice: 0.41, count: 256 },
    { name: '大唐电厂', quantity: round(108.6 * factor, 2), avgPrice: 0.4, count: 215 },
    { name: '国电电厂', quantity: round(95.2 * factor, 2), avgPrice: 0.39, count: 198 },
    { name: '风电场1号', quantity: round(86.4 * factor, 2), avgPrice: 0.38, count: 175 },
    { name: '风电场2号', quantity: round(78.2 * factor, 2), avgPrice: 0.37, count: 162 },
    { name: '水电站1号', quantity: round(65.8 * factor, 2), avgPrice: 0.35, count: 135 },
    { name: '太阳能电站1号', quantity: round(45.2 * factor, 2), avgPrice: 0.42, count: 92 },
    { name: '太阳能电站2号', quantity: round(41 * factor, 2), avgPrice: 0.43, count: 85 }
  ])
}

function buildSalesCompanies(year: number): CategoryRow[] {
  const factor = yearFactor(year)
  return withPercent<CategoryRow>([
    { name: '国网售电', quantity: round(168.5 * factor, 2), avgPrice: 0.455, count: 412 },
    { name: '晋能售电', quantity: round(126.8 * factor, 2), avgPrice: 0.448, count: 326 },
    { name: '华润售电', quantity: round(96.4 * factor, 2), avgPrice: 0.462, count: 238 },
    { name: '大唐售电', quantity: round(75.3 * factor, 2), avgPrice: 0.451, count: 196 },
    { name: '新能源售电联盟', quantity: round(62.1 * factor, 2), avgPrice: 0.438, count: 164 }
  ])
}

function buildStorageProjects(year: number): CategoryRow[] {
  const factor = yearFactor(year)
  return withPercent<CategoryRow>([
    { name: '独立储能A站', quantity: round(18.2 * factor, 2), avgPrice: 0.58, count: 216 },
    { name: '独立储能B站', quantity: round(15.6 * factor, 2), avgPrice: 0.61, count: 198 },
    { name: '共享储能C站', quantity: round(12.4 * factor, 2), avgPrice: 0.55, count: 176 },
    { name: '用户侧储能D站', quantity: round(8.8 * factor, 2), avgPrice: 0.49, count: 142 }
  ])
}

function buildRetailPackages(year: number): RetailPackageRow[] {
  const factor = yearFactor(year)
  return [
    { companyName: '国网售电', userName: '高载能用户A', packageType: '固定价套餐', status: '执行中', flatPrice: 0.438, peakPrice: 0.512, valleyPrice: 0.286, volume: round(12.5 * factor, 2) },
    { companyName: '晋能售电', userName: '装备制造B', packageType: '分时浮动套餐', status: '执行中', flatPrice: 0.426, peakPrice: 0.498, valleyPrice: 0.278, volume: round(9.8 * factor, 2) },
    { companyName: '华润售电', userName: '数据中心C', packageType: '偏差考核套餐', status: '待执行', flatPrice: 0.452, peakPrice: 0.535, valleyPrice: 0.302, volume: round(8.4 * factor, 2) },
    { companyName: '新能源售电联盟', userName: '园区负荷D', packageType: '绿电联动套餐', status: '执行中', flatPrice: 0.418, peakPrice: 0.486, valleyPrice: 0.268, volume: round(7.1 * factor, 2) }
  ]
}

function buildPriceTrend(_year: number): PriceTrendRow[] {
  return months.map((month, index) => {
    const mediumLongPrice = round(0.372 + index * 0.003, 4)
    const spotPrice = round(0.405 + Math.sin(index / 2) * 0.045 + index * 0.002, 4)
    const retailPrice = round(0.445 + index * 0.0025, 4)
    return { month, mediumLongPrice, spotPrice, retailPrice, deviation: round(spotPrice - mediumLongPrice, 4) }
  })
}

export function getMarketAnalysis(year = 2026): MarketAnalysisDataset {
  const tradeSummary = buildTradeSummary(year)
  const monthlyTrend = buildMonthlyTrend(year)
  const hourData = buildHourData(year)
  const powerTypes = buildPowerTypes(year)
  const generationDetails = buildGenerationDetails(year)
  const salesCompanies = buildSalesCompanies(year)
  const storageProjects = buildStorageProjects(year)
  const retailPackages = buildRetailPackages(year)
  const priceTrend = buildPriceTrend(year)
  const totalTradeVolume = tradeSummary.reduce((sum, row) => sum + row.quantity, 0)
  const avgTradePrice = tradeSummary.reduce((sum, row) => sum + row.avgPrice * row.quantity, 0) / totalTradeVolume

  return {
    year,
    overviewMetrics: [
      { label: '年度总交易量', value: round(totalTradeVolume, 2), unit: '亿kWh', tone: 'green' },
      { label: '平均交易电价', value: round(avgTradePrice, 4), unit: '元/kWh', tone: 'blue' },
      { label: '交易对手数量', value: 318 + (year - 2026) * 11, unit: '个', tone: 'purple' },
      { label: '市场占比', value: round(totalTradeVolume / 1000 * 100, 2), unit: '%', tone: 'orange' }
    ],
    generationMetrics: [
      { label: '发电主体', value: 256, unit: '家', tone: 'green' },
      { label: '新能源主体', value: 99, unit: '家', tone: 'blue' },
      { label: '储能主体', value: 8, unit: '家', tone: 'purple' },
      { label: '发电侧均价', value: round(powerTypes.reduce((sum, row) => sum + row.avgPrice * row.quantity, 0) / powerTypes.reduce((sum, row) => sum + row.quantity, 0), 4), unit: '元/kWh', tone: 'orange' }
    ],
    salesMetrics: [
      { label: '售电公司', value: salesCompanies.length, unit: '家', tone: 'blue' },
      { label: '代理电量', value: round(salesCompanies.reduce((sum, row) => sum + row.quantity, 0), 2), unit: '亿kWh', tone: 'green' },
      { label: '代理用户', value: 1268, unit: '户', tone: 'purple' },
      { label: '平均零售差价', value: 0.031, unit: '元/kWh', tone: 'orange' }
    ],
    storageMetrics: [
      { label: '储能项目', value: storageProjects.length, unit: '个', tone: 'purple' },
      { label: '交易电量', value: round(storageProjects.reduce((sum, row) => sum + row.quantity, 0), 2), unit: '亿kWh', tone: 'green' },
      { label: '小时收益峰值', value: 0.72, unit: '元/kWh', tone: 'orange' },
      { label: '平均成交价', value: round(storageProjects.reduce((sum, row) => sum + row.avgPrice * row.quantity, 0) / storageProjects.reduce((sum, row) => sum + row.quantity, 0), 4), unit: '元/kWh', tone: 'blue' }
    ],
    packageMetrics: [
      { label: '套餐总数', value: retailPackages.length, unit: '个', tone: 'green' },
      { label: '执行中套餐', value: retailPackages.filter((row) => row.status === '执行中').length, unit: '个', tone: 'blue' },
      { label: '零售用户数', value: retailPackages.length, unit: '户', tone: 'purple' },
      { label: '平段均价', value: round(retailPackages.reduce((sum, row) => sum + row.flatPrice, 0) / retailPackages.length, 4), unit: '元/kWh', tone: 'orange' }
    ],
    tradeSummary,
    monthlyTrend,
    hourData,
    powerTypes,
    generationDetails,
    salesCompanies,
    storageProjects,
    retailPackages,
    priceTrend
  }
}

// 链路 A：fetchCaptured 真实回放装配（P1）
// ----------------------------------------------------------------------------
// 设计依据：docs/data/market-ops-data-spec.md + docs/data/data-layer-unification.md
// 把 9 个 datasetKey 的地区隔离真实回放（/api/real）并行取回，组装回 MarketAnalysisDataset
// （interface 不变，View 改动最小）。无任何真实数据时回落硬编码 getMarketAnalysis（basis=synthetic），
// 修复「MarketOps 缺 basis 标注」P1 红线（绝不冒充真实）。
//
// datasetKey ↔ MarketAnalysisDataset 字段映射：
// market_trade_summary → tradeSummary
// market_monthly_trend → monthlyTrend（跨 tab 共用）
// market_generation → powerTypes(category=powerType) + generationDetails(category=detail)
// market_sales → salesCompanies；market_storage → storageProjects
// market_packages → retailPackages；market_price → priceTrend（派生 deviation）
// market_metrics → overview/generation/sales/storage（public）；market_retail_package_metrics → packageMetrics（company）

// 落盘族名：与 scripts/etl/import-market-export.mjs::FAMILY、shared/schema/entities/capture-families.mjs
// 注册的 `market_analysis` 族一致。fetchCaptured 第一参数是 family（/api/real → 受管回放根/<family>/），
// 不是 datasetKey，此前误传 datasetKey 致 MarketOps 真实回放读不到、DataBasisBadge 恒回落 synthetic
// （#238）。
const MARKET_FAMILY = 'market_analysis' as const
// #669：售电套餐经营口径独立为 company 私有族，从公共 market_analysis 族拆出，前端按 family 分流取数。
const RETAIL_PACKAGE_FAMILY = 'market_retail_packages' as const
const RETAIL_PACKAGE_KEY = 'market_packages' as const
const RETAIL_PACKAGE_METRICS_KEY = 'market_retail_package_metrics' as const

// 公共口径 7 键（market_analysis·public 族）；market_packages 单独经 company 私有族取数。
const MARKET_PUBLIC_KEYS = [
  'market_trade_summary', 'market_monthly_trend', 'market_generation',
  'market_sales', 'market_storage', 'market_price', 'market_metrics'
] as const

function pickMarketRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

// 并行取数；只采纳真实回放（_sourceType=CAPTURE/IMPORT/DB → captured），mock 兜底/404 不混入。
// denied：company 私有族被回放层公司授权闸门拒绝（401/403，fetchCaptured 返回 accessDenied 空信封）
// 非归属公司据此走 synthetic 授权态（不泄漏他司经营数据）。
async function safeFetchMarket<T>(key: string, family: string = MARKET_FAMILY):
  Promise<{ key: string; rows: T[]; real: boolean; denied: boolean }> {
  try {
    const body = await fetchCaptured<unknown>(family, key)
    const denied = Boolean((body as { accessDenied?: boolean } | null)?.accessDenied)
    const real = !denied && unifyBasis(body) === 'captured'
    return { key, rows: real ? pickMarketRows<T>(body) : [], real, denied }
  } catch {
    return { key, rows: [], real: false, denied: false }
  }
}

/**
 * 逐页签数据口径（#2991）：按「该页签自己消费的数据集」判定，而不是整页 hasRealData 顶包。
 * captured = 页签消费的全部数据集均真实；illustrative = 部分真实（缺的以空态呈现）；
 * synthetic = 全部不真实（仅出现在整页纯示例分支）。
 */
export type MarketAnalysisSectionBasis = Record<MarketAnalysisTab, DataBasis>

export interface MarketAnalysisResult {
  dataset: MarketAnalysisDataset
  basis: DataBasis
  hasRealData: boolean
  // 公共 7 键与套餐私有族必须独立判断，避免仅套餐命中时把公共页签误标 captured。
  publicDataReal: boolean
  // #2991：逐数据集真实性（9 个 datasetKey → 是否命中真实回放）。
  // 消费方据此决定字段显示真实数据还是诚实空态，杜绝「任一真实 → 其余字段回落示例」的混排。
  realByKey: Record<string, boolean>
  // #2991：逐页签口径，页面按它显示徽章/提示（不再用整页 basis 顶包）。
  sectionBasis: MarketAnalysisSectionBasis
  // #669：售电套餐 tab 的真实性单独暴露（company 私有族，可能被授权闸门拒绝）。
  retailPackagesReal: boolean
  retailPackagesPartialReal: boolean
  retailPackageDetailsReal: boolean
  retailPackageMetricsReal: boolean
  retailPackagesAccessDenied: boolean
}

/**
 * 页签 → 该页签消费的 datasetKey（与下方装配逻辑一一对应）。#2991：页签级徽章/空态
 * 按这组键的真实性判定，不再用整页 hasRealData 顶包。
 */
const TAB_DATASET_KEYS: Record<MarketAnalysisTab, readonly string[]> = {
  overview: ['market_trade_summary', 'market_monthly_trend', 'market_metrics'],
  generation: ['market_generation', 'market_metrics'],
  sales: ['market_sales', 'market_metrics'],
  storage: ['market_storage', 'market_metrics'],
  packages: [RETAIL_PACKAGE_KEY, RETAIL_PACKAGE_METRICS_KEY],
  price: ['market_price']
}

function sectionBasisOf(realByKey: Record<string, boolean>): MarketAnalysisSectionBasis {
  const out = {} as MarketAnalysisSectionBasis
  for (const entry of Object.entries(TAB_DATASET_KEYS) as Array<[MarketAnalysisTab, readonly string[]]>) {
    const [tab, keys] = entry
    const reals = keys.map((key) => Boolean(realByKey[key]))
    out[tab] = reals.every(Boolean) ? 'captured' : reals.some(Boolean) ? 'illustrative' : 'synthetic'
  }
  return out
}

/**
 * 装配市场经营分析全部模块数据（9 datasetKey 并行真实回放 + 失败降级）。
 * 无任何真实数据 → 硬编码 fallback（basis=synthetic，可见「模拟数据」标注，合规）。
 * #2991：有任一真实数据时，缺真实回放的字段一律返回空（空数组/空指标列表），
 * 绝不回落示例——旧实现「真实优先、否则示例」的混排会让 318 家、1258.6 亿kWh 等
 * 示例值顶着 captured 徽章出现，误导用户。hourData 从无真实来源，此分支恒为空。
 */
export async function loadMarketAnalysis(year = 2026): Promise<MarketAnalysisResult> {
  // 公共 7 键走 market_analysis(public)；套餐明细与 KPI 走同一 company 私有族并行取。
  const [publicResults, packageResult, packageMetricResult] = await Promise.all([
    Promise.all(MARKET_PUBLIC_KEYS.map((k) => safeFetchMarket(k))),
    safeFetchMarket<RetailPackageRow>(RETAIL_PACKAGE_KEY, RETAIL_PACKAGE_FAMILY),
    safeFetchMarket<MarketMetric & { tab?: string }>(RETAIL_PACKAGE_METRICS_KEY, RETAIL_PACKAGE_FAMILY)
  ])
  const results = [...publicResults, packageResult, packageMetricResult]
  const rowsOf = <T,>(key: string): T[] => (results.find((r) => r.key === key)?.rows ?? []) as T[]
  const publicDataReal = publicResults.some((r) => r.real)
  const hasRealData = results.some((r) => r.real)
  // #2991：逐数据集真实性（9 键），供页面显示页签级口径与诚实空态。
  const realByKey = Object.fromEntries(results.map((r) => [r.key, r.real]))
  // 套餐 tab 同时展示明细与 KPI；只有两者均为真实回放才允许整页标 captured。
  const retailPackagesReal = packageResult.real && packageMetricResult.real
  const retailPackagesPartialReal = packageResult.real !== packageMetricResult.real
  const retailPackagesAccessDenied = packageResult.denied || packageMetricResult.denied

  if (!hasRealData) {
    return {
      dataset: getMarketAnalysis(year),
      basis: 'synthetic',
      hasRealData: false,
      publicDataReal,
      realByKey,
      sectionBasis: sectionBasisOf(realByKey),
      retailPackagesReal,
      retailPackagesPartialReal,
      retailPackageDetailsReal: packageResult.real,
      retailPackageMetricsReal: packageMetricResult.real,
      retailPackagesAccessDenied
    }
  }

  // 以下只在「至少一个数据集真实」时执行：每个字段只取自己的真实行，没有就为空。
  const tradeSummary = withPercent<TradeSummaryRow>(rowsOf<TradeSummaryRow>('market_trade_summary'))
  const monthlyTrend = rowsOf<MonthTrendRow>('market_monthly_trend')
  const genRows = rowsOf<CategoryRow & { category?: string }>('market_generation')
  const stripCategory = (r: CategoryRow & { category?: string }): CategoryRow => ({
    name: r.name, quantity: r.quantity, avgPrice: r.avgPrice, count: r.count, percentage: r.percentage
  })
  const powerTypesRaw = genRows.filter((r) => !r.category || r.category === 'powerType').map(stripCategory)
  const detailsRaw = genRows.filter((r) => r.category === 'detail').map(stripCategory)
  const powerTypes = withPercent<CategoryRow>(powerTypesRaw)
  const generationDetails = withPercent<CategoryRow>(detailsRaw)
  const salesCompanies = withPercent<CategoryRow>(rowsOf<CategoryRow>('market_sales'))
  const storageProjects = withPercent<CategoryRow>(rowsOf<CategoryRow>('market_storage'))
  const retailPackages = rowsOf<RetailPackageRow>('market_packages')
  const priceTrend = rowsOf<PriceTrendRow>('market_price')
    .map((r) => ({ ...r, deviation: r.deviation || +(r.spotPrice - r.mediumLongPrice).toFixed(4) }))

  const metricRows = rowsOf<MarketMetric & { tab?: string }>('market_metrics')
  const packageMetricRows = rowsOf<MarketMetric & { tab?: string }>(RETAIL_PACKAGE_METRICS_KEY)
  // #2991：缺真实 KPI 的页签返回空指标列表（页面显示空态），不再回落示例指标。
  const pickMetrics = (tab: string): MarketMetric[] =>
    (tab === 'packages' ? packageMetricRows : metricRows)
      .filter((r) => r.tab === tab)
      .map(({ label, value, unit, tone }) => ({ label, value, unit, tone }))

  const dataset: MarketAnalysisDataset = {
    year,
    overviewMetrics: pickMetrics('overview'),
    generationMetrics: pickMetrics('generation'),
    salesMetrics: pickMetrics('sales'),
    storageMetrics: pickMetrics('storage'),
    packageMetrics: pickMetrics('packages'),
    tradeSummary,
    monthlyTrend,
    hourData: [], // hourData 从无真实来源：部分真实场景下宁可空也不回放示例曲线
    powerTypes,
    generationDetails,
    salesCompanies,
    storageProjects,
    retailPackages,
    priceTrend
  }

  return {
    dataset,
    basis: 'captured',
    hasRealData: true,
    publicDataReal,
    realByKey,
    sectionBasis: sectionBasisOf(realByKey),
    retailPackagesReal,
    retailPackagesPartialReal,
    retailPackageDetailsReal: packageResult.real,
    retailPackageMetricsReal: packageMetricResult.real,
    retailPackagesAccessDenied
  }
}
