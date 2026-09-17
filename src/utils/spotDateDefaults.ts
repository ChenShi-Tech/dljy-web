// 现货模块「默认日期」解析纯函数（spot-trading-module-hygiene）。
// 规格：specs/.../spot-trading-date-defaults——默认值跟随数据源可用性，
// 不再写死常量；数据源不可用时有确定性回退。
// 刻意不 import captureCoverage（其 fetch 路径会拖入 api→regionContext→window 链，
// 参照 cockpitPricePanel 的同款处理：结构化本地类型，保持 node 环境可单测）。

export interface DateRange { start: string; end: string }

/** ISO YYYY-MM-DD 串列表中的最大日（列表为空返回 null）。 */
export function latestOfDates(dates: string[]): string | null {
  if (!dates.length) return null
  return dates.reduce((a, b) => (b > a ? b : a))
}

/**
 * 日前上报默认运行日，优先级：URL 深链日期 > 采集日期清单最新日 > 回退常量。
 * 对应规格三场景：深链优先 / 清单可用取最新 / 清单缺失回退常量。
 */
export function resolveDefaultRunDate(queryDate: string, dates: string[], fallback: string): string {
  if (queryDate) return queryDate
  return latestOfDates(dates) ?? fallback
}

/**
 * 驾驶舱初始展示日：今天仍落在覆盖区内取今天，否则退到覆盖区最后一天；
 * 覆盖区间不可得时回退已知常量（回放数据落在"今天"必为空，不能猜今天）。
 * 与 cockpitPricePanel.resolvePanelDate 的差异仅在无覆盖时的回退目标。
 */
export function resolveCockpitInitialDate(today: string, coverage: DateRange | null, fallback: string): string {
  if (!coverage || !coverage.end) return fallback
  return today <= coverage.end ? today : coverage.end
}
