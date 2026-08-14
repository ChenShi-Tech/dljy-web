export type ListrsFullRow = Record<string, unknown>

function isDayAheadType(typeValue: unknown): boolean {
  return String(typeValue) === '0'
}

export function extractDayAheadCurveFromListrsFull(
  data: unknown,
  tradeDate: string,
): number[] | null {
  if (!data || !tradeDate) return null

  const payload = data as { dmx?: unknown }
  const dmx = payload?.dmx
  if (!Array.isArray(dmx)) return null

  for (const raw of dmx) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as ListrsFullRow
    // 权威语义（yunnan-parquet-to-family.mjs 派生源 + 数据对拍确证）：listrs 行的 date=真实标的日
    // （Parquet operate_date），drrq=date+1 是仿山西平台形状的伴随字段，不得用作日期匹配——
    // 按 drrq 匹配会取到偏移一天的曲线。与 PriceAnalysisView 的 rmx/dmx 消费口径（按 date）一致。
    // 注意：逐日 curve 文件（sdpt__zcqxhdl__curve__<D>.json）的 inner.drrq==D 与此不同源，勿类比。
    if (!isDayAheadType(row.type) || row.date !== tradeDate) continue

    const points: number[] = []
    for (let i = 1; i <= 96; i++) {
      const value = row[`p${i}`]
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      points.push(value)
    }
    return points
  }

  return null
}
