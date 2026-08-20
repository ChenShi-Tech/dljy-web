// 结算价分析取数服务（云南现货 S5）：日前-实时-结算三价对比 + 中长期价参照。
//
// 数据源（真实回放，非 Mock）：
// fetchCaptured('yn_spot_settlement', 'yn_settlement_daily')
// ← scripts/private-cache-adapters/yn-fact-pnl.mjs 把
// plant_spot_settlement/plant_daily_settlement_raw.csv 归一化进 family，
// ETL 阶段已 filter result_type==='formal'（temp 临时结算值不进 family），
// 故前端读到的行天然全是 formal 权威结算（数据契约保证，无需再过滤）。
//
// 字段口径（capture-families.mjs ynSpotSettlementSchema，中文列名→英文字段）：
// daPrice  = 日前结算电价    rtPrice = 实时结算电价
// avgPrice = 平均电价(综合结算) ltmPrice = 合计中长期电价
// daClearedEnergy/totalEnergy 等电量字段供加权（本处取等权均值，口径在注释标注）。
//
// 严格地区「真实或空」：fetchCaptured 自动带 currentRegion.id；云南在
// REGION_STRICT_REAL_DATA 内，无真实数据走空态、不回退山西基线。失败/无数据 →
// hasData=false（basis='empty'），由调用方决定空态呈现，不抛错断页面。
import { fetchCaptured } from '@/services/captured'
import { capturedAtFromProvenance } from '@/services/data/freshness'

// 本模块经 fetchCaptured 读取的 company 私有 capture 族（与后端 capture-families.mjs
// visibility='company' 定级一致）。供消费页 RegionDataBanner opt-in 声明（Sub-4 #520）。
export const SETTLEMENT_PRIVATE_FAMILIES = ['yn_spot_settlement'] as const

/** 单日三价聚合点（跨电厂等权均值；null=该日该价全缺测）。 */
export interface SettlementPricePoint {
  date: string
  /** 日前结算电价（元/MWh，该日全部 formal 厂站 daPrice 等权均值） */
  daPrice: number | null
  /** 实时结算电价（元/MWh） */
  rtPrice: number | null
  /** 综合结算均价（元/MWh，平均电价） */
  avgPrice: number | null
  /** 中长期电价（元/MWh，参照线·非结算主序列） */
  ltmPrice: number | null
  /** 该日参与聚合的厂站数 */
  plantCount: number
}

export interface SettlementPriceResult {
  points: SettlementPricePoint[]
  /** 电厂候选（全部 formal 行 distinct，按名排序），供筛选下拉 */
  plantOptions: string[]
  basis: 'captured' | 'empty'
  hasData: boolean
  sourceType: string
  mock: boolean
  updatedAt: string | null
  matchedPlant: string | null
}

/** yn_spot_settlement 行的最小字段集（与 yn-fact-pnl.mjs 输出对齐）。 */
interface SettlementRow {
  date: string
  plant: string
  daPrice: number
  rtPrice: number
  avgPrice: number
  ltmPrice: number
}

function pickRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 一组数的忽略零样本均值；样本为 0（全缺测）时返回 null，避免「0 元/MWh」假信号。 */
function meanOrNull(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v) && v !== 0)
  if (!valid.length) return null
  return +(valid.reduce((s, v) => s + v, 0) / valid.length).toFixed(2)
}

/**
 * 拉真实结算数据并按日聚合三价。
 *
 * @param opts.dateRange 闭区间日期过滤 [from, to]，默认演示月 2026-05（与现有云南 panel 一致）
 * @param opts.plant     电厂筛选；省略/空串=全部电厂（ALL_PLANTS 语义）
 */
export async function loadSettlementPrices(
  opts: {
    dateRange?: [string, string]
    plant?: string
    plantCandidates?: string[]
    source?: { family: string; dataset: string; region: string }
  } = {}
): Promise<SettlementPriceResult> {
  const [from, to] = opts.dateRange ?? ['2026-05-01', '2026-05-31']
  const source = opts.source ?? { family: 'yn_spot_settlement', dataset: 'yn_settlement_daily', region: 'yunnan' }
  let plant = opts.plant?.trim()
  let rows: SettlementRow[] = []
  let sourceType = ''
  let mock = false
  let updatedAt: string | null = null
  try {
    const raw = await fetchCaptured(source.family, source.dataset, { region: source.region, dateFrom: from, dateTo: to })
    const envelope = raw as { mock?: boolean; sourceType?: string; provenance?: { sourceType?: string; realDataConnected?: boolean } }
    sourceType = envelope.provenance?.sourceType ?? envelope.sourceType ?? ''
    mock = envelope.mock === true || sourceType === 'MOCK'
    updatedAt = capturedAtFromProvenance(raw)
    rows = envelope.provenance?.realDataConnected === true && !mock ? pickRows<SettlementRow>(raw) : []
  } catch {
    rows = []
  }

  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to)
  const plantMatch = (p: string) => !plant || p === plant

  // 电厂候选（全量 formal 行 distinct，不受日期范围限制，供下拉稳定）。
  const plantSet = new Set<string>()
  for (const r of rows) if (r.plant) plantSet.add(r.plant)
  const plantOptions = Array.from(plantSet).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  if (!plant && opts.plantCandidates?.length) {
    plant = opts.plantCandidates.map((candidate) => candidate.trim()).find((candidate) => plantSet.has(candidate))
  }

  const filtered = rows.filter((r) => inRange(r.date) && plantMatch(r.plant))

  // 按日分组等权均值。
  const byDate = new Map<
    string,
    { da: number[]; rt: number[]; avg: number[]; ltm: number[]; count: number }
  >()
  for (const r of filtered) {
    const cur = byDate.get(r.date) ?? { da: [], rt: [], avg: [], ltm: [], count: 0 }
    cur.da.push(toNum(r.daPrice))
    cur.rt.push(toNum(r.rtPrice))
    cur.avg.push(toNum(r.avgPrice))
    cur.ltm.push(toNum(r.ltmPrice))
    cur.count += 1
    byDate.set(r.date, cur)
  }

  const points: SettlementPricePoint[] = Array.from(byDate.keys())
    .sort()
    .map((date) => {
      const g = byDate.get(date)!
      return {
        date,
        daPrice: meanOrNull(g.da),
        rtPrice: meanOrNull(g.rt),
        avgPrice: meanOrNull(g.avg),
        ltmPrice: meanOrNull(g.ltm),
        plantCount: g.count
      }
    })

  return {
    points,
    plantOptions,
    basis: points.length ? 'captured' : 'empty',
    hasData: points.length > 0,
    sourceType,
    mock,
    updatedAt,
    matchedPlant: plant || null
  }
}

/** 聚合粒度：日/周/月。周/月在按日点之上再分组取均值，缺测保持 null（不连线）。 */
export type Aggregation = 'day' | 'week' | 'month'

/** ISO 周键（年内第 N 周，简化按 7 天桶从 1/1 起；用于分组，非显示）。 */
function weekKey(date: string): string {
  // 取该日所在 ISO 周一日期作 key（稳定分组）。
  const d = new Date(date + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return date
  const day = d.getUTCDay() || 7 // 周日=7
  d.setUTCDate(d.getUTCDate() - day + 1) // 回到周一
  return d.toISOString().slice(0, 10)
}

function monthKey(date: string): string {
  return date.slice(0, 7) // YYYY-MM
}

/** 把按日点按聚合粒度再聚合（周/月）。日粒度原样返回。 */
export function aggregatePoints(
  points: SettlementPricePoint[],
  agg: Aggregation
): SettlementPricePoint[] {
  if (agg === 'day' || !points.length) return points
  const keyOf = agg === 'week' ? weekKey : (d: string) => monthKey(d)
  const labelOf = agg === 'week'
    ? (k: string) => `${k} 周`
    : (k: string) => `${k} 月`

  const groups = new Map<
    string,
    { da: number[]; rt: number[]; avg: number[]; ltm: number[]; count: number; rawDates: string[] }
  >()
  for (const p of points) {
    const k = keyOf(p.date)
    const cur = groups.get(k) ?? { da: [], rt: [], avg: [], ltm: [], count: 0, rawDates: [] }
    if (p.daPrice !== null) cur.da.push(p.daPrice)
    if (p.rtPrice !== null) cur.rt.push(p.rtPrice)
    if (p.avgPrice !== null) cur.avg.push(p.avgPrice)
    if (p.ltmPrice !== null) cur.ltm.push(p.ltmPrice)
    cur.count += p.plantCount
    cur.rawDates.push(p.date)
    groups.set(k, cur)
  }

  return Array.from(groups.keys())
    .sort()
    .map((k) => {
      const g = groups.get(k)!
      // date 字段在周/月聚合下用标签承载（图 x 轴展示）；plantCount 累加。
      return {
        date: labelOf(k),
        daPrice: meanOrNull(g.da),
        rtPrice: meanOrNull(g.rt),
        avgPrice: meanOrNull(g.avg),
        ltmPrice: meanOrNull(g.ltm),
        plantCount: g.count
      } satisfies SettlementPricePoint
    })
}
