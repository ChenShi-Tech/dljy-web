// 市场洞察旧入口兼容映射登记（dljy#2995 阶段 A，OpenSpec build-yunnan-regional-market-insight D2 迁移表）
// ----------------------------------------------------------------------------
// 定位：把「旧洞察入口 → 规范六页」的迁移意图登记为数据。本阶段**只登记、默认不启用**：
// 每条 enabledFor 都为空数组，resolveLegacyInsightLink 恒返回 null，不产生任何重定向，
// 旧入口（/sjfx/*、/insight/cockpit、/xhjy/yunnan/* 等）全部保持原样可用。
// 后续阶段某页在云南交付后，把该地区 id 加入对应条目的 enabledFor 才会真正启用。
//
// 设计约束（spec RW03）：
// - 目标页在该地区未交付时不重定向——旧书签继续落在旧页面，绝不落到一个占位页；
// - 不创建任何全局静态 redirect，解析只发生在显式调用 resolveLegacyInsightLink 的地方；
// - 页面身份（canonicalInsightRoutePath）供已保存分析检索、AI 来源识别等消费：
//   旧路径与对应新路径互相识别为同一页面身份，避免同一页出现两份身份记录。
// - fshq（撮合分时行情）在云南无来源、也不等价节点价格，只登记 notice 不映射页面。

import {
  INSIGHT_PAGE_PATHS,
  resolveInsightPage,
  type InsightPageId
} from './insightWorkspace'

export type InsightLegacyLinkTarget =
  | { kind: 'page'; pageId: InsightPageId; query?: Record<string, string> }
  /** 不映射页面：旧入口保留并自行显示说明（如撮合行情 ≠ 节点价格） */
  | { kind: 'notice' }

export type InsightLegacyLinkEntry = {
  /** 旧入口路径（不含 query） */
  legacyPath: string
  /** 迁移条目所属地区（D2 迁移表针对云南；启用与否由 enabledFor 决定） */
  regionId: string
  target: InsightLegacyLinkTarget
  /** 启用重定向的地区列表。本阶段全部为空数组：目标页未交付前不重定向，旧入口保持原样。 */
  enabledFor: string[]
  /** 重定向时保留的合法公共 query 参数（不在名单内的参数视为目标页不支持，丢弃并提示） */
  preserveQuery: string[]
  /** 确实丢弃了目标页不支持的参数时要显示的说明（一次性提示） */
  dropNotice: string
}

/** 11 条旧入口迁移登记（与 design.md D2 迁移表逐条对应） */
export const insightLegacyLinks: InsightLegacyLinkEntry[] = [
  {
    legacyPath: '/insight/cockpit',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'overview' },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to', 'market'],
    dropNotice: '驾驶舱已并入市场总览；仅驾驶舱适用的个别参数不再适用。'
  },
  {
    legacyPath: '/sjfx/fshq',
    regionId: 'yunnan',
    // 撮合分时行情在云南无来源；节点价格不等同撮合行情，价格分析仅作参考入口，不建立页面映射。
    target: { kind: 'notice' },
    enabledFor: [],
    preserveQuery: [],
    dropNotice: '云南暂无撮合分时行情来源；节点价格不等同撮合行情，价格分析页仅供参考。'
  },
  {
    legacyPath: '/sjfx/zrsjg',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'prices', query: { tab: 'periods' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to', 'market'],
    dropNotice: '已进入价格与价差（时段走势）；仅旧页适用的个别参数不再适用。'
  },
  {
    legacyPath: '/sjfx/zcqxhdl',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'plants', query: { tab: 'declared-cleared-actual' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '场站申报/出清/实际口径为获权场站集合，非全省出清电量，不能当作全省口径使用。'
  },
  {
    legacyPath: '/sjfx/zrxgx',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'research', query: { preset: 'price-new-energy' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '同页关系图已并入研究工作台（价格×新能源预设）。'
  },
  {
    legacyPath: '/sjfx/zrxgx2',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'research', query: { preset: 'price-load' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '统调负荷关系图已并入研究工作台（价格×负荷预设）。'
  },
  {
    legacyPath: '/sjfx/actualLoad',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'supply', query: { tab: 'overview' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '逐日系统负荷已并入供需与水电（总览页签）。'
  },
  {
    legacyPath: '/sjfx/singleZsjfx',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'research', query: { mode: 'custom' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '自定义指数分析已并入研究工作台（自定义模式）。'
  },
  {
    legacyPath: '/sjfx/market-ops',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'overview' },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to'],
    dropNotice: '市场经营分析内容已调整并入市场总览；场站经营请改用场站市场表现。'
  },
  {
    legacyPath: '/xhjy/yunnan/node-price',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'prices', query: { tab: 'nodes', source: 'company-node' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to', 'node'],
    dropNotice: '节点电价已并入价格页（节点页签）；保持公司私有来源身份，不以公开历史替换。'
  },
  {
    legacyPath: '/xhjy/yunnan/settlement-price',
    regionId: 'yunnan',
    target: { kind: 'page', pageId: 'plants', query: { tab: 'settlement' } },
    enabledFor: [],
    preserveQuery: ['date', 'from', 'to', 'plant', 'settlementType'],
    dropNotice: '结算价已并入场站市场表现（结算页签）；保留厂站、日期与正式/暂结选择。'
  }
]

export type ResolvedLegacyInsightLink = {
  path: string
  query: Record<string, string>
  /** 参数被丢弃等需要向用户展示的一次性说明（无则空数组） */
  notices: string[]
}

/** 查询参数值的宽松形态（URLSearchParams.get / LocationQuery 均可传入） */
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return value[0] == null ? '' : String(value[0])
  return value == null ? '' : String(value)
}

function normalizePath(path: string) {
  const pathOnly = path.split(/[?#]/)[0]
  return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
}

/**
 * 解析旧入口在新工作区的落点。返回 null = 保持原样（旧页面继续可用）：
 * 未登记的路径、条目未对当前地区启用（本阶段全部如此）、notice 型条目、
 * 或目标页在该地区未交付（RW03：目标未交付保留旧入口，绝不把书签重定向到占位页）。
 * 本阶段任何调用都应得到 null；保留完整实现供后续阶段启用时直接生效。
 */
export function resolveLegacyInsightLink(
  path: string,
  query: Record<string, unknown> | null | undefined,
  regionId: string
): ResolvedLegacyInsightLink | null {
  const normalized = normalizePath(path)
  const entry = insightLegacyLinks.find((item) => item.legacyPath === normalized)
  if (!entry) return null
  if (!entry.enabledFor.includes(regionId)) return null
  if (entry.target.kind === 'notice') return null
  if (resolveInsightPage(regionId, entry.target.pageId).kind !== 'page') return null

  const preserved: Record<string, string> = {}
  let droppedAny = false
  for (const [key, value] of Object.entries(query ?? {})) {
    if (entry.preserveQuery.includes(key)) {
      preserved[key] = firstValue(value)
    } else if (value != null && firstValue(value) !== '') {
      droppedAny = true
    }
  }
  // 目标页指定的参数（tab/preset/mode 等）优先于旧入口透传的同名参数
  return {
    path: INSIGHT_PAGE_PATHS[entry.target.pageId],
    query: { ...preserved, ...entry.target.query },
    notices: droppedAny ? [entry.dropNotice] : []
  }
}

/**
 * 页面身份路径：六条规范路径原样返回；旧入口返回其映射目标页的规范路径
 * （如 /sjfx/zrsjg → /insight/prices）；无映射的路径原样返回。
 * 供已保存分析的 routePath 检索、AI 来源识别等场景，把新旧路径识别为同一页面身份。
 * 注意 notice 型条目（/sjfx/fshq）没有映射目标，返回原路径。
 */
export function canonicalInsightRoutePath(path: string): string {
  const normalized = normalizePath(path)
  const entry = insightLegacyLinks.find((item) => item.legacyPath === normalized)
  if (entry?.target.kind === 'page') return INSIGHT_PAGE_PATHS[entry.target.pageId]
  return normalized
}

/** 反查某规范页的旧入口路径（notice 型不算），供占位页展示「原有入口」链接 */
export function legacyPathsForInsightPage(pageId: InsightPageId): string[] {
  return insightLegacyLinks
    .filter((item) => item.target.kind === 'page' && item.target.pageId === pageId)
    .map((item) => item.legacyPath)
}
