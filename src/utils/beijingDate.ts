// 北京时区（UTC+8）业务日期工具。
// ---------------------------------------------------------------------------
// 全站「今天/本月」类默认值必须走此口径：裸 `new Date().toISOString().slice(0, 10)`
// 取的是 UTC 日期，北京时间每天 00:00–08:00 会拿到「昨天」，月度默认值在每月 1 日
// 0–8 点会拿到「上个月」（复盘周锚点、月面板默认月、纪要默认日期等曾集体踩坑）。
// 与 DeclarationDeskView 等处既有的 +8h 位移约定同源；纯日期字符串（YYYY-MM-DD）
// 的加减请继续用字符串/UTC 锚定工具（如 shared/trading-rules 的 shiftIsoDate），
// 本工具只负责「当前时刻」的北京口径换算。

/** 北京时区今天的 YYYY-MM-DD。 */
export function todayBeijing(now: number = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 北京时区当前的 YYYY-MM（月度面板默认月）。 */
export function currentMonthBeijing(now: number = Date.now()): string {
  return todayBeijing(now).slice(0, 7)
}

/** 北京时区今天偏移 offsetDays 天的 YYYY-MM-DD（负数=过去，正数=未来）。 */
export function beijingDay(offsetDays: number, now: number = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
}
