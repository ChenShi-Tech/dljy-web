// 月度市场归因 · 平台真实数据取数（#3392）
// ---------------------------------------------------------------------------
// 取「复盘月及此前共 12 个月」的逐日现货价与系统负荷，聚合成月度序列。
// 价格口径按地区分流（数据事实，不是代码风格——同 regionClearingPrice.ts 的分流理由）：
//   云南  yn_system_forecast/da_user_price（日前用户侧统一电价，24 点/天），
//         dateFrom/dateTo 一次拉 12 个月，行 operateDate(YYYY-MM-DD)/timePoint/value；
//   其余  sdpt_zcqxhdl/listrs_full 的 rmx 逐日均价 p3（type 0 日前），经
//         fetchMarketInsightPriceAnalysisContract；云南没有 sdpt_zcqxhdl 族，非山西地区
//         契约层按地区能力硬拦截不发请求，均诚实落 empty。
// 负荷（云南、山西都有）：sdpt_actualLoad 经 fetchMarketInsightActualLoadContract，
// system.nameList 是 366 个「M月D日」月-日槽位（无年份），**年份来自 years[i]**（
// legendList，与 metrics.average[i] 一一对应）——两表结合是确定性解析，绝不猜年份；
// 年份解析不出的行整行放弃。中长期成交均价无全省公共来源，本层不提供。
//
// 诚实语义：三个来源各自独立 try/catch，失败或无数据只让对应序列落 empty，绝不抛出
// 拖垮整面板、绝不回落示例、绝不合成；mock/未知来源的信封一律不采纳。
import { fetchCaptured } from '@/services/captured'
import { unifyBasis } from '@/services/data/basis'
import { fetchMarketInsightActualLoadContract, fetchMarketInsightPriceAnalysisContract } from '@/services/data/contracts'
import type { MonthlyMarketPoint } from './marketAttribution'

export type AttributionSourceBasis = 'captured' | 'empty'

export type AttributionSourceRef = {
  /** 真实数据族·键（口径说明列展示） */
  family: string
  /** captured=命中真实数据；empty=失败或无数据（诚实空态） */
  basis: AttributionSourceBasis
  /** 业务口径名（日前用户侧电价 / 日前全省均价 / 系统负荷） */
  label: string
}

export type MarketAttributionSource = {
  /** 复盘月及此前共 12 个月，按月升序 */
  points: MonthlyMarketPoint[]
  priceSource: AttributionSourceRef
  loadSource: AttributionSourceRef
}

/** 复盘月及此前共 12 个月（升序）：month='2026-05' → ['2025-06' … '2026-05']。 */
export function attributionMonths(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return []
  const out: string[] = []
  for (let back = 11; back >= 0; back--) {
    let yy = y
    let mm = m - back
    while (mm <= 0) {
      mm += 12
      yy -= 1
    }
    out.push(`${yy}-${String(mm).padStart(2, '0')}`)
  }
  return out
}

function lastDayOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return String(new Date(y, m, 0).getDate()).padStart(2, '0')
}

function rowsOf<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const b = body as { data?: unknown; rows?: unknown } | null
  if (Array.isArray(b?.data)) return b.data as T[]
  if (Array.isArray(b?.rows)) return b.rows as T[]
  return []
}

/** 逐点值按 YYYY-MM 分组求均值（null/NaN 跳过，不参与分母）。 */
function monthlyMeans(entries: Array<{ month: string; value: number | null }>): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const e of entries) {
    if (!e.month || e.value === null || !Number.isFinite(e.value)) continue
    const cur = acc.get(e.month) ?? { sum: 0, n: 0 }
    cur.sum += e.value
    cur.n += 1
    acc.set(e.month, cur)
  }
  const out = new Map<string, number>()
  for (const [m, { sum, n }] of acc) out.set(m, sum / n)
  return out
}

// ── 云南价格：yn_system_forecast/da_user_price ──────────────────────────────
const YN_PRICE_FAMILY = 'yn_system_forecast'
const YN_PRICE_KEY = 'da_user_price'

interface UserPriceRow {
  operateDate?: string
  timePoint?: string
  value?: number | null
}

async function fetchYunnanMonthlySpotPrices(win: { dateFrom: string; dateTo: string }): Promise<Map<string, number> | null> {
  try {
    const body = await fetchCaptured<unknown>(YN_PRICE_FAMILY, YN_PRICE_KEY, {
      dateFrom: win.dateFrom,
      dateTo: win.dateTo,
      region: 'yunnan'
    })
    // mock 合成 / 未知来源一律不采纳（真实或空）。
    const basis = unifyBasis(body)
    if (basis !== 'captured' && basis !== 'real') return null
    const rows = rowsOf<UserPriceRow>(body)
    if (!rows.length) return null
    return monthlyMeans(
      rows.map((r) => ({
        month: String(r.operateDate ?? '').slice(0, 7),
        value: r.value == null ? null : Number(r.value)
      }))
    )
  } catch {
    return null
  }
}

// ── 其余地区价格：sdpt_zcqxhdl/listrs_full rmx 逐日均价（日前 type 0 → p3）────
const CONTRACT_PRICE_FAMILY = 'sdpt_zcqxhdl·listrs_full'

async function fetchContractMonthlySpotPrices(region: string): Promise<Map<string, number> | null> {
  try {
    const contract = await fetchMarketInsightPriceAnalysisContract({ region })
    const block = contract.blocks.price_analysis
    // 契约 status 非 real（missing/mock）视为无真实数据，不采纳。
    if (block.status !== 'real') return null
    const rows = block.dailyStats.filter((s) => s.market === 'rq')
    if (!rows.length) return null
    return monthlyMeans(rows.map((s) => ({ month: String(s.date ?? '').slice(0, 7), value: s.avg })))
  } catch {
    return null
  }
}

// ── 负荷：sdpt_actualLoad 系统负荷逐日均值 ──────────────────────────────────
const LOAD_FAMILY = 'sdpt_actualLoad'

const NAME_LIST_RE = /^(\d{1,2})月(\d{1,2})日$/

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
}

/** 「M月D日」槽位 + 年份 → YYYY-MM-DD；解析不出（含非闰年的 2月29日空槽）返回 null，绝不猜。 */
function slotDateOf(year: number, label: string): string | null {
  const m = NAME_LIST_RE.exec(String(label))
  if (!m) return null
  const mo = Number(m[1])
  const d = Number(m[2])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (mo === 2 && d === 29 && !isLeapYear(year)) return null
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 年份标签（'2025年' → 2025）；解析不出返回 null（该行放弃，不猜年份）。 */
function yearNumOf(label: string): number | null {
  const n = Number(String(label).replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchMonthlyLoads(region: string): Promise<Map<string, number> | null> {
  try {
    const contract = await fetchMarketInsightActualLoadContract({ region })
    const block = contract.blocks.actual_load
    if (block.status !== 'real') return null
    const sys = block.sources.system
    if (!sys || !sys.years.length || !sys.nameList.length) return null
    const entries: Array<{ month: string; value: number | null }> = []
    sys.years.forEach((yLabel, yi) => {
      const year = yearNumOf(yLabel)
      if (year === null) return
      const row = sys.metrics.average[yi] ?? []
      sys.nameList.forEach((label, j) => {
        const date = slotDateOf(year, label)
        if (!date) return
        entries.push({ month: date.slice(0, 7), value: row[j] ?? null })
      })
    })
    if (!entries.length) return null
    return monthlyMeans(entries)
  } catch {
    return null
  }
}

/**
 * 取复盘月及此前共 12 个月的真实月度序列。三来源独立：任一失败/无数据只让对应
 * 序列为空（points 对应月为 null），整函数不抛；地区分流如上——云南价格走
 * yn_system_forecast，其余地区走 sdpt_zcqxhdl 契约（能力外地区契约层拦截，
 * 不发请求、诚实为空）。
 */
export async function fetchMarketAttributionSource(params: {
  region: string
  /** 复盘月 YYYY-MM */
  month: string
}): Promise<MarketAttributionSource> {
  const months = attributionMonths(params.month)
  const yunnan = params.region === 'yunnan'
  const win = months.length
    ? { dateFrom: `${months[0]}-01`, dateTo: `${params.month}-${lastDayOf(params.month)}` }
    : null

  const [priceMap, loadMap] = await Promise.all([
    yunnan && win ? fetchYunnanMonthlySpotPrices(win) : fetchContractMonthlySpotPrices(params.region),
    fetchMonthlyLoads(params.region)
  ])

  const points: MonthlyMarketPoint[] = months.map((m) => ({
    month: m,
    spotPrice: priceMap?.get(m) ?? null,
    avgLoad: loadMap?.get(m) ?? null
  }))
  return {
    points,
    priceSource: yunnan
      ? { family: `${YN_PRICE_FAMILY}·${YN_PRICE_KEY}`, basis: priceMap && priceMap.size ? 'captured' : 'empty', label: '日前用户侧电价' }
      : { family: `${CONTRACT_PRICE_FAMILY}（日前 p3 均价）`, basis: priceMap && priceMap.size ? 'captured' : 'empty', label: '日前全省均价' },
    loadSource: { family: LOAD_FAMILY, basis: loadMap && loadMap.size ? 'captured' : 'empty', label: '系统负荷（逐日均值）' }
  }
}
