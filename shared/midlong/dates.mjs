// 中长期合同的日期与交割期（#2938）。零依赖、前后端同构。
//
// 口径（design D3）：交割期按北京时间（Asia/Shanghai，全年 UTC+8、无夏令时）日历日表达，
// 结束日期包含当天，换算成时段时取次日零点为排他上界 [start, end)。月键 YYYY-MM。
// 交割进度只按日期派生：交割期结束 ≠ 逾期、违约或已结清——那些需要结清凭证。

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOOSE_DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/
const MONTH_RE = /^(\d{4})-(\d{2})$/
const LOOSE_MONTH_RE = /^(\d{4})[-/.年](\d{1,2})月?$/
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

function pad2(n) {
  return String(n).padStart(2, '0')
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isIsoDate(value) {
  const m = ISO_DATE_RE.exec(String(value ?? ''))
  if (!m) return false
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** 宽松日期输入 → YYYY-MM-DD；无法识别或非法日历日返回 null（不猜测）。 */
export function normalizeDate(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const m = ISO_DATE_RE.exec(text) ?? LOOSE_DATE_RE.exec(text)
  if (!m) return null
  const iso = `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  return isIsoDate(iso) ? iso : null
}

export function isMonthKey(value) {
  const m = MONTH_RE.exec(String(value ?? ''))
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** 宽松月份输入（2026-01 / 2026/1 / 2026年1月 / 2026-01-01）→ YYYY-MM；无法识别返回 null。 */
export function normalizeMonth(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const date = normalizeDate(text)
  if (date) return date.slice(0, 7)
  const m = MONTH_RE.exec(text) ?? LOOSE_MONTH_RE.exec(text)
  if (!m) return null
  const key = `${m[1]}-${pad2(Number(m[2]))}`
  return isMonthKey(key) ? key : null
}

export function monthKeyOf(isoDate) {
  return isIsoDate(isoDate) ? String(isoDate).slice(0, 7) : null
}

export function monthFirstDay(monthKey) {
  return isMonthKey(monthKey) ? `${monthKey}-01` : null
}

export function monthLastDay(monthKey) {
  if (!isMonthKey(monthKey)) return null
  const [year, month] = monthKey.split('-').map(Number)
  return `${monthKey}-${pad2(daysInMonth(year, month))}`
}

/** 闭区间 [startMonth, endMonth] 内的全部月键；非法或倒序返回空数组。 */
export function monthsBetween(startMonth, endMonth) {
  if (!isMonthKey(startMonth) || !isMonthKey(endMonth) || startMonth > endMonth) return []
  const months = []
  let [year, month] = startMonth.split('-').map(Number)
  const end = endMonth
  // 上限防御：合同交割期不会超过 50 年，异常输入不至于生成巨量数组。
  for (let guard = 0; guard < 600; guard += 1) {
    const key = `${year}-${pad2(month)}`
    if (key > end) break
    months.push(key)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}

/** 交割期覆盖的月份（按日期所在月，跨年正确）。 */
export function deliveryMonths(deliveryStart, deliveryEnd) {
  return monthsBetween(monthKeyOf(deliveryStart), monthKeyOf(deliveryEnd))
}

/** 北京时间今日 YYYY-MM-DD。 */
export function beijingToday(now = Date.now()) {
  const shifted = new Date(Number(now) + SHANGHAI_OFFSET_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** YYYY-MM-DD 的次日（交割期结束日换算排他上界用）。 */
export function nextDay(isoDate) {
  if (!isIsoDate(isoDate)) return null
  const [year, month, day] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`
}

/** 北京时间某日零点的 ISO 时刻，如 2026-01-01 → 2025-12-31T16:00:00.000Z。 */
export function beijingMidnightInstant(isoDate) {
  if (!isIsoDate(isoDate)) return null
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS).toISOString()
}

// 业务时刻的分项正则：日期固定 4-2-2 位，时间可省（省略即当日零点），秒与小数可省
// （小数位数不限——兼容 RFC3339Nano 等亚毫秒精度，换算时按毫秒截断），
// 时区后缀 Z 或 ±HH:MM 可省（省略按北京时间，design D3）。
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:\d{2})?$/

/**
 * 严格解析业务时刻（#2981）：逐项核对各分量范围，日历上不存在的日期或越界的时分秒一律拒绝，
 * 绝不交给 new Date 碰运气（JS Date 会把 02-30 静默滚动成 03-02）。
 * 接受 YYYY-MM-DD（北京时间零点）与 YYYY-MM-DD[T ]HH:mm[:ss[.f+]]（秒小数位数不限、按毫秒截断），可带 Z 或 ±HH:MM；
 * 不带时区按北京时间（+08:00）解释。返回 { ok: true, date } 或 { ok: false, reason }，
 * reason ∈ FORMAT / MONTH / DAY / HOUR / MINUTE / SECOND / OFFSET。
 */
export function parseBeijingInstant(value) {
  const m = INSTANT_RE.exec(String(value ?? '').trim())
  if (!m) return { ok: false, reason: 'FORMAT' }
  const [, yearText, monthText, dayText, hourText = '00', minuteText = '00', secondText = '00', frac, offset] = m
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (year < 100) return { ok: false, reason: 'FORMAT' } // Date.UTC 会把 0–99 年映射到 1900 年代，直接拒绝
  if (month < 1 || month > 12) return { ok: false, reason: 'MONTH' }
  if (day < 1 || day > daysInMonth(year, month)) return { ok: false, reason: 'DAY' }
  if (hour > 23) return { ok: false, reason: 'HOUR' }
  if (minute > 59) return { ok: false, reason: 'MINUTE' }
  if (second > 59) return { ok: false, reason: 'SECOND' }
  let offsetMinutes = 480 // 无时区后缀按北京时间（design D3）
  if (offset) {
    if (offset === 'Z') {
      offsetMinutes = 0
    } else {
      const sign = offset[0] === '-' ? -1 : 1
      const [offsetHour, offsetMinute] = offset.slice(1).split(':').map(Number)
      if (offsetHour > 14 || offsetMinute > 59) return { ok: false, reason: 'OFFSET' }
      offsetMinutes = sign * (offsetHour * 60 + offsetMinute)
    }
  }
  const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0
  return { ok: true, date: new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60 * 1000) }
}

/** 交割期换算为排他上界的时段 [start, end)（北京时间零点）。 */
export function deliveryInterval(deliveryStart, deliveryEnd) {
  if (!isIsoDate(deliveryStart) || !isIsoDate(deliveryEnd) || deliveryEnd < deliveryStart) return null
  return { startInclusive: beijingMidnightInstant(deliveryStart), endExclusive: beijingMidnightInstant(nextDay(deliveryEnd)) }
}

/**
 * 交割进度（按日期派生，不入库）：NOT_STARTED / IN_DELIVERY / DELIVERY_ENDED / UNKNOWN。
 * 缺日期返回 UNKNOWN，不猜测。
 */
export function deliveryProgress(deliveryStart, deliveryEnd, today = beijingToday()) {
  if (!isIsoDate(deliveryStart) || !isIsoDate(deliveryEnd)) return 'UNKNOWN'
  if (today < deliveryStart) return 'NOT_STARTED'
  if (today > deliveryEnd) return 'DELIVERY_ENDED'
  return 'IN_DELIVERY'
}

/** 闭区间相交判断（日期或月键字符串均可，按字典序即时间序）。 */
export function rangesIntersect(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}
