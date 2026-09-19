// 研究结果统计分面（dljy#3114，OpenSpec insight-research-workbench 任务 13.7，RS08、D6.1）
// ----------------------------------------------------------------------------
// 把研究结果的统计长表按**登记指标的量纲**拆成并列分面（「综合多指标 → 量纲分轴/分面」）：
//   - 指标按云南目录：单位一律取 shared/insight/metrics.mjs 的登记值，页面不新造口径；
//   - 分面纪律沿用 useInsightSeriesChart 的分组规则：同量纲共一根轴（面内可比），
//     不同量纲各拆一张图（一根面一根轴），**不共轴、不做双 Y 轴混标**；
//   - 只对统计型内核（相关 / 明确滞后比较 / 同进度比较）的统计行分面：
//     异常窗口是时间线、同类日是候选表，各有专门呈现，不进统计分面；
//   - 值文本按登记精度 formatMetricValue 呈现；数值只用于坐标（显示层转换），
//     本模块不做任何统计计算、不重算口径。
// 序列显隐 / 分面顺序是**会话内视图状态**（见 YunnanResearchPage），不进运行请求、不进保存定义。

import { formatMetricValue, getMetricDefinition } from 'shared/insight/metrics.mjs'

/** 结果长表里与统计分面相关的一行的形状（宽松：多余字段忽略）。 */
export type ResearchFacetRow = {
  metricId?: string | null
  group?: string | null
  value?: string | null
}

/** 分面内的一个观测点：同指标的一个分组值（如相关分析的「全样本」「2026-09」）。 */
export type ResearchFacetGroup = {
  key: string
  label: string
  /** 数值（仅用于坐标）；非十进制文本为 null，文本仍以 text 呈现。 */
  value: number | null
  /** 登记精度格式化后的文本（后端十进制原值）。 */
  text: string
}

/** 分面内的一条指标序列：同量纲、同轴、按图例/颜色区分。 */
export type ResearchFacetItem = {
  metricId: string
  label: string
  groups: ResearchFacetGroup[]
}

/** 一个量纲分面：一张图、一根轴（单位随轴名展示）。 */
export type ResearchStatFacet = {
  unit: string
  items: ResearchFacetItem[]
}

/** 允许进入统计分面的登记指标（三类统计型内核的统计行；时间线/候选表指标不进）。 */
const STAT_METRIC_IDS = new Set([
  'research.pearson-r',
  'research.covariance',
  'sample.valid-count',
  'research.lag-mean-difference',
  'research.lag-absolute-mean',
  'supply.progress-change',
  'supply.mean-power',
])

/** 行分组 → 展示名（相关分析的 'all' 是全样本；'缺分组' 是滞后/同进度的单窗统计）。 */
function groupLabelOf(key: string): string {
  if (key === 'all') return '全样本'
  return key === '' ? '所选窗' : key
}

/** 值文本：按登记精度格式化，登记外的原样呈现（不截断、不改口径）。 */
function textOf(metricId: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (!getMetricDefinition(metricId)) return String(value)
  try {
    return String(formatMetricValue(metricId, value))
  } catch {
    return String(value)
  }
}

export type ResearchStatFacetOptions = {
  /** 显隐的指标（序列选择记忆：会话内视图状态，不影响请求与保存）。 */
  hiddenMetricIds?: ReadonlySet<string>
  /** 分面顺序（unit 列表；未列出的分面按首现顺序跟在后面）。 */
  facetOrder?: readonly string[]
}

/**
 * 统计长表 → 量纲分面。规则：
 *   - 只取登记指标（STAT_METRIC_IDS）的行，单位取登记值；未登记指标不出现在分面里；
 *   - 分面（unit）按首现顺序排列，面内指标按首现顺序排列，面内分组按首现顺序排列；
 *   - options.hiddenMetricIds 过滤指标；options.facetOrder 重排分面（其余保持原序）。
 */
export function buildResearchStatFacets(
  rows: readonly ResearchFacetRow[],
  options: ResearchStatFacetOptions = {}
): ResearchStatFacet[] {
  const byUnit = new Map<string, Map<string, ResearchFacetItem>>()
  const unitOrder: string[] = []
  for (const row of rows) {
    const metricId = String(row.metricId ?? '')
    if (!metricId || !STAT_METRIC_IDS.has(metricId)) continue
    const definition = getMetricDefinition(metricId)
    if (!definition) continue
    const unit = definition.unit || '无单位'
    let items = byUnit.get(unit)
    if (!items) {
      items = new Map()
      byUnit.set(unit, items)
      unitOrder.push(unit)
    }
    let item = items.get(metricId)
    if (!item) {
      item = { metricId, label: definition.label, groups: [] }
      items.set(metricId, item)
    }
    const key = String(row.group ?? '')
    if (!item.groups.some((group) => group.key === key)) {
      const raw = row.value ?? null
      const numeric = raw === null || raw === '' ? null : Number(raw)
      item.groups.push({
        key,
        label: groupLabelOf(key),
        value: numeric !== null && Number.isFinite(numeric) ? numeric : null,
        text: textOf(metricId, raw),
      })
    }
  }
  const facets: ResearchStatFacet[] = unitOrder.map((unit) => ({
    unit,
    items: [...byUnit.get(unit)!.values()].map((item) => ({ ...item, groups: [...item.groups] })),
  }))
  // 显隐：整指标过滤（面内序列减少；分面一条不剩时整面隐藏——空图没有信息）。
  const hidden = options.hiddenMetricIds
  const visible = hidden ? facets.map((facet) => ({ unit: facet.unit, items: facet.items.filter((item) => !hidden.has(item.metricId)) })).filter((facet) => facet.items.length) : facets
  // 顺序：facetOrder 里给出的单位先按给定序排列，未给出的单位保持首现序接在后面。
  const order = options.facetOrder ?? []
  const rank = new Map(order.map((unit, index) => [unit, index]))
  return [...visible].sort((a, b) => {
    const ra = rank.has(a.unit) ? (rank.get(a.unit) as number) : order.length
    const rb = rank.has(b.unit) ? (rank.get(b.unit) as number) : order.length
    return ra === rb ? unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit) : ra - rb
  })
}

/** 单位 → 分面标题（登记单位 token 的业务名；登记外原样展示，不发明口径）。 */
export function statFacetTitleOf(unit: string): string {
  const KNOWN: Record<string, string> = {
    r: '相关系数（r）',
    'by-input': '随输入序列量纲',
    count: '样本计数',
    '%': '百分比（%）',
    MW: '功率（MW）',
    h: '时长（小时）',
  }
  return `量纲分面：${KNOWN[unit] ?? unit}`
}

/**
 * 一个分面 → ECharts option：一张图、一根 y 轴（单位随轴名），指标各一条序列
 * （颜色/图例区分）。横轴是分组（全样本 / 各日历月），同量纲才共这张图。
 */
export function buildStatFacetOption(facet: ResearchStatFacet): Record<string, unknown> {
  const categories: string[] = []
  for (const item of facet.items) {
    for (const group of item.groups) {
      if (!categories.includes(group.label)) categories.push(group.label)
    }
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 56, right: 16, top: 32, bottom: 32 },
    xAxis: { type: 'category', data: categories },
    yAxis: [{ type: 'value', name: facet.unit, scale: true }],
    series: facet.items.map((item) => ({
      name: item.label,
      type: 'bar' as const,
      data: categories.map((label) => item.groups.find((group) => group.label === label)?.value ?? null),
    })),
  }
}
