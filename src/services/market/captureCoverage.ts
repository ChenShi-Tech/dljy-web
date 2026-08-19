/**
 * 真实采集的日期覆盖区间（按地区 × 用途），供页面把默认日期钳进有数据的范围。
 *
 * 为什么需要它：现货页的默认日期普遍是「今天/昨天」，而采集是历史批次，默认值落在
 * 覆盖区外，用户一进页面就是空态或错误，看起来像功能坏了。#1531 之前这被 mock 兜底掩盖着
 * （取不到真实数据就合成一份形状相同的），把「没数据」伪装成「有数据」；mock 加标注、
 * 按日取数改真之后，覆盖区外就变成诚实的「该日无数据」，默认日期必须同步钳住。
 *
 * 纪律：只钳默认值，不限制用户手选。用户选到区间外，后端照旧诚实告知该日无数据
 * 这里不是权限也不是过滤器，只是让首屏落在有数据的地方。
 *
 * ⚠ 这是手工维护的事实镜像，不是自动推导：值来自对 `data/private/capture-raw/` 的实测
 * （见各条注释）。采集扩展到新月份后改这一处；漏改的后果是首屏落到空态，不会给出错误数字。
 * 长期方向是由后端暴露覆盖区间接口，前端不再镜像（未开 issue，见 #1531 讨论）。
 */

export type DateRange = { start: string; end: string }

/** 用途：price=只需要价格序列（监盘）；review=需要申报 ∩ 价格 或结算口径（复盘）。 */
export type CoveragePurpose = 'price' | 'review'

const COVERAGE: Record<string, Partial<Record<CoveragePurpose, DateRange>>> = {
  // 山西（实测 2026-08-01 / 2026-08-03）：
  // 价格 sdpt_zcqxhdl/listrs_full 的 dmx 容器 2022-07-01~2026-06-03
  // 申报 sdpt_zrqsb 2026-04-01~2026-06-04 有数据（06-05 起 26 个文件是无申报的空壳）
  // 实际 sdpt_zptqx type='2'（实时电量）2026-04-01~2026-05-30 连续 60 天
  // ⚠ price 的 end 取的是最后一个完整日而非最后一个有数据的日：2026-06-03 是采集当天，
  // 实时价只出到第 58 点（日前 96 点），落在这天首屏会是半条曲线 + 失真的峰谷统计。
  // 用户手选 06-03 照常能看到那 58 点，只是不拿它当默认。
  // ⚠ review 需要 申报 ∩ 价格 ∩ 实际 三者都有，实际侧最短（到 05-30），故取交集末日
  // 2026-05-30（Epic #1485 接上实际侧后由 06-02 收窄；此前实际侧根本没接，不构成约束）。
  shanxi: {
    price: { start: '2022-07-01', end: '2026-06-02' },
    review: { start: '2026-04-01', end: '2026-05-30' }
  },
  // 云南（实测）：
  // 价格 yn_system_forecast 的 da/rt_user_price 2025-07-01~2026-07-01
  // 结算 yn_spot_settlement 仅 2026-05（#1488；是否补采 6-7 月待定）
  yunnan: {
    price: { start: '2025-07-01', end: '2026-07-01' },
    review: { start: '2026-05-01', end: '2026-05-31' }
  }
}

/** 该地区该用途的覆盖区间；未登记返回 null（调用方保持原有「今天/昨天」默认）。 */
export function captureCoverage(regionId: string, purpose: CoveragePurpose): DateRange | null {
  return COVERAGE[regionId]?.[purpose] ?? null
}

/** date 是否落在覆盖区外（未登记覆盖的地区恒返回 false，不知道就不声称越界）。 */
export function isOutOfCoverage(regionId: string, purpose: CoveragePurpose, date: string): boolean {
  const range = captureCoverage(regionId, purpose)
  if (!range || !date) return false
  return date < range.start || date > range.end
}

/** 把候选日期钳进覆盖区间；未登记覆盖的地区原样返回。 */
export function clampToCoverage(regionId: string, purpose: CoveragePurpose, date: string): string {
  const range = captureCoverage(regionId, purpose)
  if (!range || !date) return date
  if (date > range.end) return range.end
  if (date < range.start) return range.start
  return date
}
