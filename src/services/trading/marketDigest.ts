// S7 日报「市场概况」摘要（会议 2026-08-13 要求：总成交量、各时段成交量与价格、
// 开盘/收盘/最高/最低），由本单可得口径拼装，诚实标注口径边界。
// ----------------------------------------------------------------------------
// 全市场侧的成交量/价格数据无活源（数据活源 #1968 / Epic #1981），本模块用
// 「本单申报/出清/价格曲线」给同构统计（总量、逐小时量价、开高低收），并把口径
// 写进输出（sourceBasis），日报上原样呈现：把本单口径悄悄当全市场概况是口径谎报。
export type HourlyVolumePrice = {
  hour: number
  volumeMwh: number | null
  priceYuanPerMwh: number | null
}

export type MarketDigest = {
  /** 统计口径：本单申报 / 本单出清（全市场概况待数据活源） */
  sourceBasis: 'declared' | 'cleared'
  totalVolumeMwh: number
  openYuanPerMwh: number | null
  closeYuanPerMwh: number | null
  highYuanPerMwh: number | null
  lowYuanPerMwh: number | null
  highHour: number | null
  lowHour: number | null
  weightedAvgYuanPerMwh: number | null
  hourly: HourlyVolumePrice[]
}

function hourlyAvg(values96: number[] | null | undefined): Array<number | null> {
  if (!Array.isArray(values96) || values96.length < 24) return new Array(24).fill(null)
  const per = Math.floor(values96.length / 24)
  return Array.from({ length: 24 }, (_, h) => {
    const slice = values96.slice(h * per, (h + 1) * per).map(Number).filter(Number.isFinite)
    return slice.length ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100 : null
  })
}

/**
 * 由 96 点量/价曲线生成市场概况摘要。
 * basis：'cleared'（优先，出清已登记时）或 'declared'（本单申报口径兜底）。
 * 价格缺失时只给量侧统计（开高低收为 null），不用 0 冒充价格。
 */
export function buildMarketDigest(
  clearedCurveMwh96: number[] | null | undefined,
  declaredCurveMwh96: number[] | null | undefined,
  priceCurve96: number[] | null | undefined
): MarketDigest | null {
  const useCleared = Array.isArray(clearedCurveMwh96) && clearedCurveMwh96.length >= 24
  const volume = useCleared ? clearedCurveMwh96 : declaredCurveMwh96
  if (!Array.isArray(volume) || volume.length < 24) return null
  const sourceBasis: MarketDigest['sourceBasis'] = useCleared ? 'cleared' : 'declared'

  const volHourly = hourlyAvg(volume)
  const priceHourly = hourlyAvg(priceCurve96)
  const totalVolumeMwh = Math.round(volume.map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0) * 10) / 10

  const pricedHours = priceHourly
    .map((p, h) => ({ p, h }))
    .filter((x): x is { p: number; h: number } => x.p !== null)
  const high = pricedHours.length ? pricedHours.reduce((a, b) => (b.p > a.p ? b : a)) : null
  const low = pricedHours.length ? pricedHours.reduce((a, b) => (b.p < a.p ? b : a)) : null

  let weightedNum = 0
  let weightedDen = 0
  for (let h = 0; h < 24; h += 1) {
    const v = volHourly[h]
    const p = priceHourly[h]
    if (v !== null && p !== null) {
      weightedNum += v * p
      weightedDen += v
    }
  }

  return {
    sourceBasis,
    totalVolumeMwh,
    openYuanPerMwh: priceHourly[0] ?? null,
    closeYuanPerMwh: priceHourly[23] ?? null,
    highYuanPerMwh: high?.p ?? null,
    lowYuanPerMwh: low?.p ?? null,
    highHour: high?.h ?? null,
    lowHour: low?.h ?? null,
    weightedAvgYuanPerMwh: weightedDen > 0 ? Math.round((weightedNum / weightedDen) * 100) / 100 : null,
    hourly: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      volumeMwh: volHourly[h],
      priceYuanPerMwh: priceHourly[h]
    }))
  }
}
