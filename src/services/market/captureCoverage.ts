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
 * ⚠ 下表是手工维护的事实镜像，只服务**静态历史批次**的地区（山西等采集已停在固定区间）。
 * 值来自对 `data/private/capture-raw/` 的实测（见各条注释）。
 *
 * 云南不再走这张表（#2375）：它的价格数据自 #2370 接上中广核厂侧 API 后**每日推进**，
 * 手工镜像每天都会过时——改一次值只能撑一天，首屏照样落到空日期上。改由
 * `fetchCaptureCoverage()` 向后端 `/api/real-coverage` 实时取真实区间。
 * 这就是本文件原注释所说「长期方向是由后端暴露覆盖区间接口」的落地。
 */

import { apiGet } from '@/services/api'

export type DateRange = { start: string; end: string }

/** 用途：price=只需要价格序列（监盘）；review=需要申报 ∩ 价格 或结算口径（复盘）。 */
export type CoveragePurpose = 'price' | 'review' | 'clearing'

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
  // 云南：
  // ⚠ price 已改由后端实时提供（#2375），下面这个区间**只在接口不可用时兜底**，
  //   不再随采集推进维护——真要用到它，说明后端没答，页面本来也取不到数。
  //   接口正常时首屏用的是 fetchCaptureCoverage() 的返回值。
  // 结算 yn_spot_settlement 仅 2026-05（#1488；是否补采 6-7 月待定），仍是静态批次
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

// ---------------------------------------------------------------------------
// 后端实时覆盖区间（#2375）
// ---------------------------------------------------------------------------

/** 采集族 → 该用途需要哪些 datasetKey 都有数据才算「这天可用」。 */
const PRICE_DATASETS: Record<string, { family: string; datasetKeys: string[] } | undefined> = {
  // 监盘要算日前 vs 实时价差，两条曲线缺一条那天就是空态——故取交集而非并集。
  // 实测 2026-08-18 就是「有日前、无实时」，若按并集会把它当作可用日，首屏依旧空。
  yunnan: { family: 'yn_system_forecast', datasetKeys: ['da_user_price', 'rt_user_price'] }
}

/** 出清价口径（驾驶舱主图）：只要日前那条。与监盘的差别正是 2026-08-18 那一天——
 *  监盘取 da∩rt 会把它判成不可用，而只看出清的驾驶舱那天是有数据的。 */
const CLEARING_DATASETS: Record<string, { family: string; datasetKeys: string[] } | undefined> = {
  yunnan: { family: 'yn_system_forecast', datasetKeys: ['da_user_price'] }
}

type CoverageResponse = {
  code?: number
  data?: { datasets?: Array<{ datasetKey: string; start: string | null; end: string | null }> }
}

/**
 * 向后端取该地区该用途的真实覆盖区间。
 *
 * 只对已登记 PRICE_DATASETS 的地区发请求（当前仅云南——其余地区是静态历史批次，
 * 手工表不会过时，没必要每次进页面多打一次请求）。接口失败或数据不全时返回 null，
 * 调用方据此回落到同步表；这是「UI 默认日期取不到就用旧值」，与数据层面的
 * fallbackPolicy 无关——不会让页面显示任何来源不明的数字。
 */
export async function fetchCaptureCoverage(
  regionId: string,
  purpose: CoveragePurpose
): Promise<DateRange | null> {
  const spec = purpose === 'price' ? PRICE_DATASETS[regionId]
    : purpose === 'clearing' ? CLEARING_DATASETS[regionId]
      : undefined
  if (!spec) return null
  return queryCoverage(spec, regionId)
}

// ---------------------------------------------------------------------------
// 覆盖缺口兜底（现货审计二轮 S1）：/api/real-coverage 按 region 精确聚合 DB 行，
// 而云南价格数据集以 region='all' 归档，缺席覆盖返回（实测 da/rt_user_price 不在
// datasets 里）→ 依赖覆盖钳默认日的页面在云南集体拿 null：现货驾驶舱 tab 回退
// 2026-05-01 硬编码常量、旗舰「实时价格」落今天空屏、监盘非厂侧账号停今天。
// 兜底两层：① 云南按用途数据集逐个「尾行探针」（limit=1 取回放层真实尾行日期，
// 仍是服务层数据事实，不猜日期，取各尾日最小值为交集末日）；② 其余地区/探针不可
// 得时回落手工静态表（price 用途，静态批次不会过时）。
// ---------------------------------------------------------------------------

/** 尾行探针：某数据集最后一个有行日期；失败/空返回 null（不臆造）。
 *  刻意用 apiGet 直连 /api/real 而不是 captured.ts 的 fetchCaptured——后者 import
 *  regionContext（模块顶层读 window.localStorage），会把本文件拖出 node 环境
 *  纯函数单测的可测范围（CI 实测踩中，同 cockpitPricePanel 头注释的同类约束）。 */
async function datasetTailDate(family: string, datasetKey: string, regionId: string): Promise<string | null> {
  try {
    const res = await apiGet<{ data?: Array<{ operateDate?: unknown }> }>('/api/real', {
      family, match: datasetKey, region: regionId, limit: 1
    })
    const tail = res?.data?.[0]
    return typeof tail?.operateDate === 'string' ? tail.operateDate.slice(0, 10) : null
  } catch {
    return null
  }
}

/**
 * 带兜底的覆盖区间：优先实时覆盖接口；云南价格数据集（region='all' 归档）用尾行
 * 探针补齐；再不行回落静态表。仅供「把默认日期钳到有数据的一天」这类 UI 用途——
 * 任何一层失败都返回 null，调用方保持原默认并由空态诚实说明，绝不猜日期。
 */
export async function fetchCaptureCoverageWithFallback(
  regionId: string,
  purpose: CoveragePurpose
): Promise<DateRange | null> {
  const range = await fetchCaptureCoverage(regionId, purpose)
  if (range) return range
  const spec = purpose === 'price' ? PRICE_DATASETS[regionId]
    : purpose === 'clearing' ? CLEARING_DATASETS[regionId]
      : undefined
  if (regionId === 'yunnan' && spec) {
    const tails = (await Promise.all(
      spec.datasetKeys.map((key) => datasetTailDate(spec.family, key, regionId))
    )).filter((t): t is string => t != null)
    // 交集语义与 queryCoverage 一致：任一数据集无尾行即不可声称交集，保守回落
    if (tails.length === spec.datasetKeys.length) {
      const end = tails.sort()[0]
      return { start: end, end }
    }
  }
  return captureCoverage(regionId, purpose) ?? captureCoverage(regionId, 'price')
}

// ---------------------------------------------------------------------------
// 结算族覆盖区间（#2992）：云南结算价页「查看历史资料」入口用。
// 与上面同一条 /api/real-coverage 通道：yn_spot_settlement 是公司私有族，
// apiGet 自动带的身份头（x-company-id 等）决定能否看到；无权/失败返回 null，
// 调用方只说「暂无资料」，不编造覆盖区间。
// ---------------------------------------------------------------------------

const SETTLEMENT_DATASETS: Record<string, { family: string; datasetKeys: string[] } | undefined> = {
  yunnan: { family: 'yn_spot_settlement', datasetKeys: ['yn_settlement_daily'] }
}

/** 该地区结算族的已入库覆盖区间（yn_settlement_daily 起止）；未登记/失败/无权返回 null。 */
export async function fetchSettlementCoverage(regionId: string): Promise<DateRange | null> {
  const spec = SETTLEMENT_DATASETS[regionId]
  if (!spec) return null
  return queryCoverage(spec, regionId)
}

async function queryCoverage(
  spec: { family: string; datasetKeys: string[] },
  regionId: string
): Promise<DateRange | null> {
  try {
    const res = await apiGet<CoverageResponse>('/api/real-coverage', {
      family: spec.family,
      region: regionId
    })
    const datasets = res?.data?.datasets
    if (!Array.isArray(datasets)) return null
    const picked = spec.datasetKeys.map((key) => datasets.find((d) => d.datasetKey === key))
    if (picked.some((d) => !d?.start || !d?.end)) return null
    // 交集：最晚的 start ~ 最早的 end
    const start = picked.map((d) => String(d!.start).slice(0, 10)).sort().at(-1)!
    const end = picked.map((d) => String(d!.end).slice(0, 10)).sort().at(0)!
    return start <= end ? { start, end } : null
  } catch {
    return null
  }
}
