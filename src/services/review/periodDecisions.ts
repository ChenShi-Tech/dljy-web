import { listDeclarationsPage, type DeclarationMode } from '@/services/declarations'
import { isRealCalendarDate } from '@/utils/calendarDate'

export type DecisionPeriod = { start: string; end: string }
export async function loadPeriodDecisions(company: string, region: string, period: DecisionPeriod, offset = 0, mode?: DeclarationMode) {
  if (!company || !region || !Number.isInteger(offset) || offset < 0 || !isRealCalendarDate(period.start) || !isRealCalendarDate(period.end) || period.start > period.end) throw new Error('请先确认公司、地区及统计周期')
  const page = await listDeclarationsPage({ dateFrom: period.start, dateTo: period.end, limit: 20, offset, ...(mode ? { mode } : {}) }, company, region)
  // Elevated accounts may receive other regions and legacy records with no region.
  // Never claim the server's unfiltered total is the number of matching decisions.
  const rows = page.rows.filter(row => row.companyId === company && row.region === region && row.targetDate >= period.start && row.targetDate <= period.end)
  if (!Number.isInteger(page.total) || page.total < 0 || page.limit !== 20 || page.offset !== offset) throw new Error('申报分页信息不完整，请重试')
  return { rows, omitted: page.rows.length - rows.length, nextOffset: offset + page.limit < page.total ? offset + page.limit : null }
}

/** Only return to this review analysis, within the still-selected company/region. */
export function safeAnalysisReturn(value: unknown, company: string, region: string): string | null {
  if (typeof value !== 'string' || !value.startsWith('/xhjy/review/analysis?') || value.length > 12000) return null
  const url = new URL(value, 'https://review.invalid')
  if (url.origin !== 'https://review.invalid' || url.pathname !== '/xhjy/review/analysis' || url.hash || url.searchParams.has('analysisReturn')) return null
  if (url.searchParams.get('companyId') !== company || url.searchParams.get('region') !== region) return null
  return url.pathname + url.search
}
