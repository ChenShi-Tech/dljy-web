// 现货 96 点（15 分钟）时刻标签单一来源：00:15 … 24:00。
// 此前 5 份逐字副本散布于 DayAheadReport/DayAheadEnergy/DataAnalysis/PriceAnalysis/HomeConsole
// （spot-trading-module-hygiene 收口）。口径：第 i 点（0 基）取段末时刻，末日为 24:00 而非 00:00。
export function pointLabel(i: number): string {
  const m = (i + 1) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const POINTS_96: string[] = Array.from({ length: 96 }, (_, i) => pointLabel(i))

/** 96 个电量/价格字段名 p1…p96（与 POINTS_96 同序，配合表格列/取数下标）。键类型收窄为点位键，可直接索引 SpotDayAheadRow。 */
export const PTS_96 = Array.from({ length: 96 }, (_, i): `p${number}` => `p${i + 1}`)
