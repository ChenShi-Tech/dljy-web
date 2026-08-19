// data/freshness.ts — 数据新鲜度分级（新鲜度透出链前端末端）
// ----------------------------------------------------------------------------
// 后端 /api/real 信封的 provenance 现携带真实数据时间（capturedAt 优先 / ingestedAt 兜底，
// 见 server/capture-replay.mjs + capture-store.mjs）。本模块把「数据时间」按业务节律折算成
// 四档新鲜度，供 ChartCard 等 UI 显示陈旧指示（黄/红点 + tooltip）。
//
// 口径（cadence 决定阈值）：
// daily（默认，日更数据如现货结算/节点电价）：fresh <26h · aging 26h–3d · stale >3d
// monthly（月度导出如损益/结算月报）：       fresh <32d · aging 32–40d · stale >40d
// manual（手录/无固定节律）：                fresh <26h · 否则 aging，永不 stale
// 手录数据没有自然更新节律，把它标红「过期」是误导；给一个温和的 aging 提示、
// 是否要更新交读者判断（见下方 JSDoc）。
//
// 纯函数、无副作用、单测友好。时间来源缺失（null/非法/无 provenance）→ 'unknown'。
// 与真伪标注（basis.ts）正交：basis 回答「真不真」，freshness 回答「新不新」。

export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown'
export type FreshnessCadence = 'daily' | 'monthly' | 'manual'

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface Thresholds {
  fresh: number // < fresh → 'fresh'
  aging: number // < aging → 'aging'，否则 'stale'
}

// 各节律的老化阈值（毫秒）。daily/monthly 有 stale 上限；manual 只到 aging（永不 stale）。
const CADENCE_THRESHOLDS: Record<FreshnessCadence, Thresholds> = {
  daily: { fresh: 26 * HOUR, aging: 3 * DAY },
  monthly: { fresh: 32 * DAY, aging: 40 * DAY },
  manual: { fresh: 26 * HOUR, aging: Number.POSITIVE_INFINITY }
}

/**
 * 把「数据时间」折算成新鲜度分级。
 *
 * @param capturedAt 真实数据时间（ISO 字符串或 epoch 毫秒）。null/undefined/非法 → 'unknown'。
 * @param opts.cadence 业务更新节律，默认 'daily'。
 *   - 'daily'：fresh <26h / aging 26h–3d / stale >3d
 *   - 'monthly'：fresh <32d / aging 32–40d / stale >40d
 *   - 'manual'：fresh <26h / 否则 aging；永不返回 'stale'（手录数据无固定节律，
 *     标「过期」会误导，仅给温和 aging 提示由读者判断是否更新）
 * @returns 四档之一；未来时间（时钟偏移）按 'fresh' 处理。
 */
export function freshnessOf(
  capturedAt: string | number | null | undefined,
  opts?: { cadence?: FreshnessCadence }
): Freshness {
  if (capturedAt == null) return 'unknown'
  const t = new Date(capturedAt).getTime()
  if (Number.isNaN(t)) return 'unknown'
  const ageMs = Date.now() - t
  if (ageMs <= 0) return 'fresh' // 未来时间戳（时钟偏移）视为最新
  const { fresh, aging } = CADENCE_THRESHOLDS[opts?.cadence ?? 'daily']
  if (ageMs < fresh) return 'fresh'
  if (ageMs < aging) return 'aging'
  return 'stale'
}

/**
 * 数据时间距今的整天数（向下取整，≥0）。用于 tooltip「数据已过期 N 天」。
 * 无效时间返回 null。
 */
export function ageDaysOf(capturedAt: string | number | null | undefined): number | null {
  if (capturedAt == null) return null
  const t = new Date(capturedAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / DAY))
}

/**
 * 从统一信封（/api/real 的 body）的 provenance 提取真实数据时间：capturedAt 优先，
 * 回退 ingestedAt（写入时刻）。MOCK 合成源不带这两个字段 → 返回 null（新鲜度落 'unknown'）。
 */
export function capturedAtFromProvenance(body: unknown): string | null {
  const prov = (body as { provenance?: { capturedAt?: unknown; ingestedAt?: unknown } } | null | undefined)?.provenance
  if (!prov) return null
  if (typeof prov.capturedAt === 'string' && prov.capturedAt) return prov.capturedAt
  if (typeof prov.ingestedAt === 'string' && prov.ingestedAt) return prov.ingestedAt
  return null
}
