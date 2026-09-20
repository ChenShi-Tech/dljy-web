// 真实结算派生敞口/套保率：来自 yn_spot_settlement（captured 真实导出，云南 region 隔离）。
// 与 cockpitData::loadCockpit 的 position 模块同源同口径（settlementFormula.hedgeCoverage），
// 供敞口看板在「合成测算」线之外并列展示「真实结算套保率/敞口」+ oversell/overbuy 风险提示。
// 严格地区「真实或空」：非云南无真实结算时 hasData=false → 走空态，不回退/不伪造。
import { fetchCaptured } from '@/services/captured'
import { hedgeCoverage } from '@/services/settlementFormula'

// 敞口看板经 fetchCaptured 读取的 company 私有 capture 族，供 ExposureBoardView 的
// RegionDataBanner opt-in 声明（Sub-4 #520）。
export const EXPOSURE_PRIVATE_FAMILIES = ['yn_spot_settlement'] as const

export interface SettlementExposure {
  /** 套保率 = ltm / total（确定性公式，verify:report-formulas 断言） */
  coverageRate: number
  /** 净敞口 = total − ltm（>0 欠保·净卖出 / <0 过保·净买入） */
  openExposureMwh: number
  /** 欠保(净卖出)规模 MWh，>=0 */
  sellExposureMwh: number
  /** 过保(净买入)规模 MWh，>=0 */
  buyExposureMwh: number
  ltmEnergy: number
  totalEnergy: number
  daysCount: number
  basis: 'captured' | 'empty'
  hasData: boolean
}

interface SettleRow {
  date: string
  ltmEnergy: number
  totalEnergy: number
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickRows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

function inRange(date: string, range?: [string, string]): boolean {
  if (!range) return true
  const [from, to] = range
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

/**
 * 拉真实结算数据并按 dateRange 聚合套保率/敞口。失败/无数据返回空态（hasData=false），不抛错。
 * dateRange 默认演示月 2026-05（与 cockpitData 一致）。
 */
export async function loadSettlementExposure(
  opts: { dateRange?: [string, string] } = {}
): Promise<SettlementExposure> {
  const dateRange = opts.dateRange ?? ['2026-05-01', '2026-05-31']
  let rows: SettleRow[] = []
  try {
    const raw = await fetchCaptured('yn_spot_settlement', 'yn_settlement_daily')
    rows = pickRows<SettleRow>(raw).filter((r) => inRange(r.date, dateRange))
  } catch {
    rows = []
  }

  let ltmEnergy = 0
  let totalEnergy = 0
  for (const r of rows) {
    ltmEnergy += toNum(r.ltmEnergy)
    totalEnergy += toNum(r.totalEnergy)
  }
  // HA-06：这里 rows 已是按日聚合的合成场景（exposureParams），0 缺省口径维持不变；
  // 真实结算链（cockpitData/结算复核）走 notComputable 口径。
  const cov = hedgeCoverage({ contractedMwh: ltmEnergy, forecastMwh: totalEnergy })
  const open = cov.notComputable ? 0 : (cov.openExposureMwh as number)

  return {
    coverageRate: (cov.coverageRate ?? 0) as number,
    openExposureMwh: open,
    sellExposureMwh: open > 0 ? +open.toFixed(1) : 0,
    buyExposureMwh: open < 0 ? +Math.abs(open).toFixed(1) : 0,
    ltmEnergy: +ltmEnergy.toFixed(1),
    totalEnergy: +totalEnergy.toFixed(1),
    daysCount: rows.length,
    basis: rows.length ? 'captured' : 'empty',
    hasData: rows.length > 0
  }
}

/** 风险评级：欠保(coverageRate<0.8)=oversell·价格下行；过保(>1.1)=overbuy·价格上行；其余 balanced。 */
export type ExposureRisk = {
  level: 'oversell' | 'overbuy' | 'balanced'
  cls: 'bad' | 'warn' | 'good'
  label: string
  detail: string
}
export function settlementExposureRisk(e: SettlementExposure): ExposureRisk {
  if (!e.hasData) {
    return { level: 'balanced', cls: 'good', label: '无数据', detail: '该地区无真实结算数据' }
  }
  if (e.coverageRate < 0.8) {
    return {
      level: 'oversell',
      cls: 'bad',
      label: '欠保 · 净卖出敞口',
      detail: `套保率 ${(e.coverageRate * 100).toFixed(1)}% < 80%，多发 ${e.sellExposureMwh} MWh 进现货卖出，承担现货价格下行风险`
    }
  }
  if (e.coverageRate > 1.1) {
    return {
      level: 'overbuy',
      cls: 'warn',
      label: '过保 · 净买入敞口',
      detail: `套保率 ${(e.coverageRate * 100).toFixed(1)}% > 110%，欠发 ${e.buyExposureMwh} MWh 需现货购入，承担现货价格上行风险`
    }
  }
  return {
    level: 'balanced',
    cls: 'good',
    label: '套保适中',
    detail: `套保率 ${(e.coverageRate * 100).toFixed(1)}% 在 80%–110% 区间，敞口风险可控`
  }
}
