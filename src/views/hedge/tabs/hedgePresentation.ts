import type { TodayOverview } from '@/services/hedge/hedgeTodayModel'
import { legRowsOf } from '@/services/hedge/hedgeTodayModel'

export function hasGeneration(data: TodayOverview): boolean {
  return data.intervals.some(row => row.generation.value !== null || (row.generation.knownStationCount ?? 0) > 0)
}
/** 水位是区间结束时刻；减一毫秒，避免午夜水位落到无数据的下一天。 */
export function latestGenerationRange(data: TodayOverview): { fromDate: string; toDate: string } | null {
  const points = legRowsOf(data).filter(row => row.key === 'ACTUAL' && row.status !== 'FAILED' && row.status !== 'FORBIDDEN').map(row => Date.parse(row.dataThrough ?? '')).filter(Number.isFinite)
  if (!points.length) return null
  const end = Math.max(...points) - 1 + 8 * 3_600_000
  return { fromDate: new Date(end - 86_400_000).toISOString().slice(0, 10), toDate: new Date(end).toISOString().slice(0, 10) }
}

export function calculationReason(data: TodayOverview, mechanism: boolean): string {
  const rows = data.intervals
  if (!rows.some(row => row.generation.value !== null)) return data.intervals.some(row => (row.generation.knownStationCount ?? 0) > 0) ? '部分场站缺少发电量，公司汇总不可计算。可选择已覆盖场站查看；缺失值不补零。' : '所选日期没有可用发电量，缺少套保率的分母。请查看数据状态或选择有数据的日期。'
  if (!rows.some(row => row.covered && row.generation.value !== null && row.locked.midlong !== null)) return '发电量与中长期分时电量没有共同覆盖的时段，无法计算套保率。'
  const eligible = rows.filter(row => row.covered && row.generation.value !== null && row.locked.midlong !== null)
  if (eligible.reduce((sum, row) => sum + Number(row.generation.value), 0) === 0) return '已覆盖时段的发电量合计为零，无法作为套保率分母。'
  if (mechanism && eligible.some(row => row.locked.mechanism.value === null)) return '机制电量未覆盖：请在维护页登记并确认各场站的机制参数。仅中长期口径可独立查看。'
  return '套保率只使用发电量与锁价电量共同覆盖的时段；未知值不计为零。'
}
