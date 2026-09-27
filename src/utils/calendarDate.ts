// 日历日期纯工具（YYYY-MM-DD）。
// ---------------------------------------------------------------------------
// 与 beijingDate.ts 分工：本工具只做「字符串形态+语义」的校验与逐日推进（UTC 锚定，
// 不含当前时刻换算）；「今天/本月」类默认值仍走 beijingDate.ts。
// 用途：深链 ?date= 守卫、偏差/价差「连续」按日历相邻判定（缺数跳日断链）。

/** 真实日历日校验：形态（YYYY-MM-DD）+ 语义（真实存在的日期）双守卫。
 *  2026-13-99 / 2026-02-30 这类伪日期返回 false——避免垃圾日期进请求与对账分母，
 *  也避免 Date 自动进位把伪日期悄悄变成另一天。 */
export function isRealCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** month（YYYY-MM）→ 该月最后一天（YYYY-MM-DD）；形态/月份范围非法返回 null。
 *  UTC 锚定取「下月 0 号」，平年/闰年 2 月与 30/31 天月由 Date 自动进位。
 *  用途：月度→分时跳转把结束日落到真实月末（dljy#2984）。 */
export function lastDayOfMonth(month: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split('-').map(Number)
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return null
  const last = new Date(Date.UTC(y, m, 0))
  return `${month}-${String(last.getUTCDate()).padStart(2, '0')}`
}

/** date（YYYY-MM-DD）→ 次日；形态/语义不符返回 null（调用方按断链处理）。
 *  UTC 锚定，跨月/跨年/闰年由 Date 自动进位。 */
export function nextDayOf(date: string): string | null {
  if (!isRealCalendarDate(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}
