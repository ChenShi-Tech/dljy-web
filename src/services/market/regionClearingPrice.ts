// 「该交易日的实际出清价」按地区取数（#2392）。
//
// 分流的理由不是代码风格，是数据事实：云南**没有** `sdpt_zcqxhdl` 这个采集族
// （`/api/real-coverage?family=sdpt_zcqxhdl&region=yunnan` 返回 datasets: []），
// 那是电力交易中心披露口径、只有山西等地有。云南的真实电价在
// `yn_system_forecast/da_user_price`（日前用户侧统一电价，24 点/天）。
//
// 驾驶舱面板此前统一走 sdpt_zcqxhdl，所以在云南**永远**取不到真实曲线、永远落到
// synth96 合成——换句话说那条链路从一开始就不可能给云南画出真实数据。
import { fetchCaptured } from '@/services/captured'
import { loadClearingCurve } from '@/services/market/spotPrice'
import type { CurvePoint } from '@/services/market/spotPriceCore'
import type { DataBasis } from '@/services/dataBasis'
import { timeAxis96 } from '@/services/market/spotPriceCore'

export interface ClearingPriceCurve {
  points: CurvePoint[]
  basis: DataBasis
  /** 源粒度是小时（24 点铺成 96 点）。图头要标注，否则会被读成 15 分钟分辨率。 */
  hourly: boolean
  /** 该地区这条曲线的业务口径名，直接用作图例——口径不同却共用一个名字就是误导。 */
  label: string
}

const EMPTY: ClearingPriceCurve = { points: [], basis: 'empty', hourly: false, label: '实际出清' }

interface UserPriceRow { operateDate?: string; timePoint?: string; value?: number | null }

/** 24 点小时价 → 96 点阶梯：每小时 4 个 15min 槽同值。不插值——小时价在小时内本就是常数。 */
function hourlyTo96(rows: UserPriceRow[]): CurvePoint[] {
  const byHour = new Map<number, number>()
  for (const r of rows) {
    const h = Number(String(r.timePoint ?? '').slice(0, 2))
    if (!Number.isFinite(h) || h < 0 || h > 23) continue
    if (r.value == null || !Number.isFinite(r.value)) continue
    byHour.set(h, r.value)
  }
  if (byHour.size === 0) return []
  // 缺的小时**不产出点**，而不是产出 value=null：横轴由消费方按时刻并集拼，缺的时刻
  // 自然是断点。塞一个 null 点进曲线反而要求每个消费方都记得过滤。
  return timeAxis96
    .map((time, i) => ({ time, value: byHour.get(Math.floor(i / 4)) }))
    .filter((p): p is CurvePoint => p.value != null)
}

/**
 * 取某地区某日的实际出清价曲线（96 点）。
 *
 * 取不到一律返回空 + `basis: 'empty'`，**绝不合成**：编造的价格曲线画出来与真实曲线毫无
 * 区别，KPI 也会照着它算，比空面板危险得多。
 */
export async function fetchClearingPrice(regionId: string, date: string): Promise<ClearingPriceCurve> {
  if (regionId === 'yunnan') {
    try {
      const res = await fetchCaptured<{ data?: UserPriceRow[] }>(
        'yn_system_forecast', 'da_user_price', { dateFrom: date, dateTo: date, region: regionId })
      const points = hourlyTo96(Array.isArray(res?.data) ? res.data : [])
      if (!points.length) return EMPTY
      return { points, basis: 'captured', hourly: true, label: '日前用户侧电价' }
    } catch {
      return EMPTY
    }
  }
  const curve = await loadClearingCurve(date)
  // 合成兜底当作没有数据（同上）。
  if (curve.basis === 'synthetic' || !curve.points.length) return EMPTY
  return {
    points: curve.points, basis: curve.basis,
    hourly: curve.sourcePoints === 24, label: '实际出清',
  }
}
