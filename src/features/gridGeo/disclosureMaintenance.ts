import type { GridDisclosureEvent } from './types'
import { parseDisclosureTime as timestamp } from './disclosureTime'

export type MaintenanceTimingFilter = 'all' | 'starts-in-window' | 'ends-in-window' | 'covers-window' | 'incomplete'
export type MaintenanceSort = 'default' | 'start-asc' | 'end-asc' | 'duration-desc'
export type MaintenanceCategory = '' | 'maintenance' | 'outage'
export type MaintenanceFilters = { equipmentKeyword: string; reasonKeyword: string; timingFilter: MaintenanceTimingFilter; sort: MaintenanceSort }
export type MaintenanceTiming = { startLabel: string; endLabel: string; start: string; end: string; note: string }
export type MaintenanceListRow = { event: GridDisclosureEvent; timing: MaintenanceTiming }
export function createDefaultMaintenanceFilters(): MaintenanceFilters {
  return { equipmentKeyword: '', reasonKeyword: '', timingFilter: 'all', sort: 'default' }
}
export const MAINTENANCE_TIMING_OPTIONS: Array<{ value: MaintenanceTimingFilter; label: string }> = [
  { value: 'all', label: '全部时间关系' }, { value: 'starts-in-window', label: '窗口内开始停电' },
  { value: 'ends-in-window', label: '窗口内复电' }, { value: 'covers-window', label: '贯穿所选窗口' },
  { value: 'incomplete', label: '时间不完整' },
]
export const MAINTENANCE_SORT_OPTIONS: Array<{ value: MaintenanceSort; label: string }> = [
  { value: 'default', label: '默认顺序' }, { value: 'start-asc', label: '停电时间：早 → 晚' },
  { value: 'end-asc', label: '复电时间：早 → 晚' }, { value: 'duration-desc', label: '已知总时长：长 → 短' },
]
export function hasMaintenanceFilters(filters: MaintenanceFilters): boolean {
  return Boolean(filters.equipmentKeyword || filters.reasonKeyword || filters.timingFilter !== 'all' || filters.sort !== 'default')
}

/** 仅收拢授权检修编译器的已知模板；原始事件与任何真实原因/其他摘要保持完整。 */
export function maintenanceListSummary(event: GridDisclosureEvent): string {
  if (event.providerId !== 'csg-authorized-export' || event.category !== 'maintenance'
    || event.source.sourceTable !== 'tb_disclosure_forecast_maintenance_plan' || maintenanceDuration(event).status !== 'known') return event.summary
  const match = /^([^；\r\n]+)；(实际|计划)停复电：(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00) 至 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00)。$/.exec(event.summary)
  if (!match || event.timeQuality?.intervalBasis !== (match[2] === '实际' ? 'actual' : 'planned')
    || timestamp(match[3]) !== timestamp(event.effectiveAt) || timestamp(match[4]) !== timestamp(event.expiresAt)) return event.summary
  return match[1]
}

export function formatMaintenanceDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '未提供'
  if (minutes === 0) return '0 分钟'
  const seconds = Math.round(minutes * 60)
  if (seconds === 0) return '不足 1 秒'
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), restMinutes = Math.floor(seconds % 3600 / 60), restSeconds = seconds % 60
  return [days ? `${days} 天` : '', hours ? `${hours} 小时` : '', restMinutes ? `${restMinutes} 分钟` : '', restSeconds ? `${restSeconds} 秒` : ''].filter(Boolean).join(' ')
}
export function maintenanceDuration(event: GridDisclosureEvent): { minutes: number | null; label: string; status: 'known' | 'missing' | 'invalid' } {
  const basis = event.timeQuality?.intervalBasis
  if (event.timeQuality?.effective === 'business-date' || event.timeQuality?.effective === 'unknown' || basis === 'point' || basis === 'unknown'
    || !event.effectiveAt || !event.expiresAt) return { minutes: null, label: '未提供', status: 'missing' }
  const from = timestamp(event.effectiveAt), to = timestamp(event.expiresAt)
  if (from === null || to === null || to < from) return { minutes: null, label: '区间异常', status: 'invalid' }
  const minutes = (to - from) / 60000
  return { minutes, label: formatMaintenanceDuration(minutes), status: 'known' }
}
export function maintenanceTimeBasis(event: GridDisclosureEvent): string {
  if (event.timeQuality?.effective === 'business-date') return '仅业务日期'
  if (event.timeQuality?.effective === 'unknown') return '区间未提供'
  const basis = event.timeQuality?.intervalBasis
  return basis === 'actual' ? '实际区间' : basis === 'planned' ? '计划区间' : basis === 'point' ? '仅已知时点'
    : basis === 'unknown' ? '区间未提供' : maintenanceDuration(event).status === 'known' ? '来源区间' : '区间未提供'
}
