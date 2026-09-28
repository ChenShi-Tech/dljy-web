// 旧关系页 → 价格驱动分析（/sjfx/price-drivers）的跳转映射（dljy#3390）。
// 「现货价格×新能源」（/sjfx/zrxgx）与「现货价格×统调负荷」（/sjfx/zrxgx2）合并为一页后，
// 两条旧地址保留 redirect：分别预选 driver（zrxgx→renewable / zrxgx2→load），并透传
// date/days/mode 查询参数（旧书签与分享链接不失效）；旧页专属的 view/cols 控件参数
// 已随散点矩阵删除，不再适用，静默丢弃。
// 抽成纯函数（router/index.ts 顶层有 await import，vitest 不宜直接导入整表）。
import type { RouteLocationRaw } from 'vue-router'
import { PRICE_DRIVERS_PATH, type PriceDriverKind } from '@/services/governance'

// 路径与驱动类型的唯一定义在 governance（授权判定同源），这里转出口供路由与测试使用。
export { PRICE_DRIVERS_PATH, type PriceDriverKind }

/** 旧入口 query 中合并页仍支持的白名单（driver 由旧路径决定，覆盖任何透传值）。 */
const PRESERVED_QUERY_KEYS = ['date', 'days', 'mode'] as const

/** 旧入口跳转目标：保参数 + 预选驱动。 */
export function resolvePriceDriversRedirect(
  driver: PriceDriverKind,
  query: Record<string, unknown> | null | undefined
): RouteLocationRaw {
  const preserved: Record<string, string> = {}
  for (const key of PRESERVED_QUERY_KEYS) {
    const raw = query?.[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value != null && String(value) !== '') preserved[key] = String(value)
  }
  return { path: PRICE_DRIVERS_PATH, query: { ...preserved, driver } }
}
