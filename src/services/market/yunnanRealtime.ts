// 云南真实数据重组：把 yn_system_forecast（96 点/天，多 region）+ 用户电价（24 点/天）
// 重组为 zrxgx/zrxgx2 视图期望的 xd[{date, p1..p24=[xVal, price]}] 散点形态。
// 父 Issue #477：切云南时市场洞察页显示一年真实数据（替代 sdpt_zcqxhdl mock 回放）。
//
// 数据源：yn_system_forecast/<datasetKey>（import:southern-export 从 spot_raw 一年落盘）
// - new_energy_actual / load_actual：96 点/天（15min），region ∈ {all, yn, ...}，云南页取 yn
// - da_user_price / rt_user_price：24 点/天（小时），用户侧统一电价
//
// 重组：每天每小时一个散点 [xVal, price]，xVal 为该小时 4 个 15min 的均值（96→24 聚合）。
// 竖线（xnyzd/xnyg/xnygd）云南无对应维度，留空（视图不渲染竖线）。
import { fetchCaptured } from '@/services/captured'

type ForecastRow = {
  operateDate: string
  timePoint: string
  region: string
  value: number | null
}

// 按运行日往前切 N 天日期列表（YYYY-MM-DD，全程本地时区）。
// 全程本地日期构造/取字段：toISOString() 会把本地零点按 UTC 输出，在 UTC+ 时区（如
// Asia/Shanghai）会整体回退一天、漏掉运行日当天并多取一天历史，故改用本地 y/m/d 拼接。
function dateRange(runDate: string, days: number): string[] {
  const [y, m, d] = runDate.split('-').map(Number)
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d - i) // 本地时间构造，d-i 自动跨月借位
    const yy = dt.getFullYear()
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    out.push(`${yy}-${mm}-${dd}`)
  }
  return out
}

// 取 yn_system_forecast/<datasetKey>，按日期窗口做载荷级过滤（dateFrom/dateTo 闭区间比较
// operateDate）。yn_system_forecast 是整年长表（单 datasetKey 可达 ~21 万行/30MB），页面每次
// 只展示最多 30 天，不带窗口过滤会每次全量下载 x 指标 + 价格两份整年数据。
// 优先 region=preferRegion（无该 region 行则取全部，不臆造）。
async function fetchForecastRows(datasetKey: string, dateFrom: string, dateTo: string, preferRegion = 'yn', captureRegion?: string): Promise<ForecastRow[]> {
  const res = await fetchCaptured<any>('yn_system_forecast', datasetKey, { dateFrom, dateTo, region: captureRegion })
  const all: ForecastRow[] = (res?.data ?? []) as ForecastRow[]
  if (!preferRegion) return all
  const filtered = all.filter((r) => r.region === preferRegion)
  return filtered.length ? filtered : all
}

// 96 点/天（15min）→ 24 小时聚合：每小时取该小时 4 个 15min 的均值。
// 返回 Map<date, Map<hour(0-23), avgValue>>。
function hourlyAvgByDate(rows: ForecastRow[], dates: string[]): Map<string, Map<number, number>> {
  const buckets = new Map<string, Map<number, number[]>>()
  for (const r of rows) {
    if (!dates.includes(r.operateDate)) continue
    const h = Number((r.timePoint || '').slice(0, 2))
    if (!Number.isFinite(h) || h < 0 || h > 23) continue
    if (r.value == null) continue
    if (!buckets.has(r.operateDate)) buckets.set(r.operateDate, new Map())
    const m = buckets.get(r.operateDate)!
    if (!m.has(h)) m.set(h, [])
    m.get(h)!.push(r.value)
  }
  const out = new Map<string, Map<number, number>>()
  for (const [date, hMap] of buckets) {
    const avg = new Map<number, number>()
    for (const [h, vals] of hMap) avg.set(h, vals.reduce((a, b) => a + b, 0) / vals.length)
    out.set(date, avg)
  }
  return out
}

export type RealtimeScatterDataset = {
  xd: Array<{ date: string; [p: string]: string | number[] | null }>
  // 竖线维度（xnyzd/xnyg/xnygd）云南无对应数据，留空数组，视图 renderHour 已对空竖线容错。
  xnyzd: unknown[]
  xnyg: unknown[]
  xnygd: unknown[]
}

// 构建 zrxgx（xMetric=new_energy_actual）/ zrxgx2（xMetric=load_actual）共用的散点数据集。
// priceMode='rq' → da_user_price（日前），'ss' → rt_user_price（实时）。
export async function buildRealtimeScatter(opts: {
  runDate: string
  days: number
  xMetric: 'new_energy_actual' | 'load_actual'
  priceMode: 'rq' | 'ss'
  region?: string
}): Promise<RealtimeScatterDataset> {
  const dates = dateRange(opts.runDate, opts.days)
  const dateFrom = dates[0]
  const dateTo = dates[dates.length - 1]
  const priceKey = opts.priceMode === 'rq' ? 'da_user_price' : 'rt_user_price'
  const [xRows, priceRows] = await Promise.all([
    fetchForecastRows(opts.xMetric, dateFrom, dateTo, 'yn', opts.region),
    fetchForecastRows(priceKey, dateFrom, dateTo, 'yn', opts.region)
  ])
  const xByDate = hourlyAvgByDate(xRows, dates)
  const priceByDate = hourlyAvgByDate(priceRows, dates)
  const xd = dates.map((date) => {
    const row: { date: string; [p: string]: string | number[] | null } = { date }
    const xDay = xByDate.get(date)
    const priceDay = priceByDate.get(date)
    for (let h = 1; h <= 24; h++) {
      const x = xDay?.get(h - 1) ?? null
      const price = priceDay?.get(h - 1) ?? null
      row['p' + h] = x != null && price != null ? [x, price] : null
    }
    return row
  })
  return { xd, xnyzd: [], xnyg: [], xnygd: [] }
}
