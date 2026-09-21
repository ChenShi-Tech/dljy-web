import { isRealCalendarDate } from '@/utils/calendarDate'
import type { GridDisclosureEvent } from './types'

/** Source times without an offset use Beijing time, independently of the browser timezone. */
export function parseDisclosureTime(value: string | null | undefined, allowDate = false): number | null {
  if (allowDate && value && isRealCalendarDate(value)) return Date.parse(`${value}T00:00:00+08:00`)
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value ?? '')
  if (!match || !isRealCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return null
  const result = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}${match[5] ? `.${match[5]}` : ''}${match[6] ?? '+08:00'}`)
  return Number.isFinite(result) ? result : null
}

export function disclosureMinuteText(value: string): string {
  const time = parseDisclosureTime(value, true)
  return time === null ? value : new Date(time + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
}

export function disclosureEventWindow(event: GridDisclosureEvent | null) {
  if (!event || ['business-date', 'unknown'].includes(event.timeQuality?.effective ?? '') || event.timeQuality?.issues?.includes('invalid-effective-time')) return null
  const from = parseDisclosureTime(event.effectiveAt), to = parseDisclosureTime(event.expiresAt)
  if (from === null) return null
  const invalidEnd = event.timeQuality?.issues?.some(issue => ['invalid-expiry-time', 'expiry-before-effective'].includes(issue))
  return { from: event.effectiveAt!, to: !invalidEnd && to !== null && to >= from ? event.expiresAt : null }
}
