// 市场总览：区块清单与重点事项规则（#3006，OpenSpec 任务 8.1、8.2，specs yunnan-market-overview）。
//
// 总览不另写一套口径：每个区块就是某个已登记分析的某个视图，页面按这里的清单分别查询，
// 一个区块失败只影响它自己（OV02）；从区块下钻到详情页时带同一分析、同一视图、同一筛选，
// 详情用的是同一份读取版本集合（OV05）。
//
// 重点事项（OV03）：规则、阈值与排序都登记在这里，结果里原样带出，页面可见；没有事项满足条件就少于五条，
// 不凑数。阈值是平台分析默认值，不是官方规则，也不是投资建议；「低价同期新能源高位」只陈述同期观测，不下因果。

/** 总览区块：分析 + 视图；access 以分析登记为准（能力目录里没有的区块，页面直接不显示）。 */
export const OVERVIEW_BLOCKS = Object.freeze([
  Object.freeze({ blockId: 'key-items', title: '重点事项', analysisId: 'overview.key-items', view: 'key-items' }),
  Object.freeze({ blockId: 'prices', title: '价格概况', analysisId: 'prices.user-series', view: 'summary', drilldownPageId: 'prices' }),
  Object.freeze({ blockId: 'spread', title: '日前实时价差', analysisId: 'prices.user-series', view: 'spread', drilldownPageId: 'prices' }),
  Object.freeze({ blockId: 'supply', title: '供需与水电', analysisId: 'supply.system-series', view: 'summary', drilldownPageId: 'supply' }),
  Object.freeze({ blockId: 'forecast', title: '预测与实际', analysisId: 'supply.system-series', view: 'forecast-error', drilldownPageId: 'supply' }),
  Object.freeze({ blockId: 'grid', title: '跨省与电网边界', analysisId: 'grid.boundary-series', view: 'series', drilldownPageId: 'grid-boundaries' }),
  Object.freeze({ blockId: 'plants', title: '获权场站表现', analysisId: 'plants.settlement-daily', view: 'series', drilldownPageId: 'plants' }),
])

/** 重点事项最多条数（OV03）。 */
export const KEY_ITEM_LIMIT = 5

const rule = spec => Object.freeze({ ruleKind: 'analysis-default', ...spec, thresholds: Object.freeze(spec.thresholds) })

/**
 * 重点事项规则。severity = 观测值 / 阈值（越过阈值越多越靠前）；同分按规则登记顺序、再按时间稳定排列。
 */
export const KEY_ITEM_RULES = Object.freeze([
  rule({
    ruleId: 'negative-price', title: '负电价时段', drilldown: { analysisId: 'prices.user-series', view: 'summary' },
    thresholds: { minNegativeHours: '1' },
    description: '日前或实时用户侧价格在所选日期内累计负价时长达到阈值',
  }),
  rule({
    ruleId: 'da-rt-spread', title: '日前实时价差较大', drilldown: { analysisId: 'prices.user-series', view: 'spread' },
    thresholds: { minAbsSpread: '200' },
    description: '用户侧日前减实时价差（共同有效时段）绝对值的最大值达到阈值',
  }),
  rule({
    ruleId: 'low-price-high-new-energy', title: '低价时段同期新能源处于高位', drilldown: { analysisId: 'prices.user-series', view: 'series' },
    thresholds: { priceQuantile: '0.1', newEnergyQuantile: '0.9', minHours: '1' },
    description: '实时用户侧价处于所选窗口最低一成、同一小时云南新能源实际出力处于窗口最高一成；只陈述同期观测，不代表因果',
  }),
  rule({
    ruleId: 'load-forecast-deviation', title: '负荷预测偏差较大', drilldown: { analysisId: 'supply.system-series', view: 'forecast-error' },
    thresholds: { minMaeRatioPercent: '3' },
    description: '云南统调负荷预测与实际（共同有效时段）的平均绝对误差占实际平均值的比例达到阈值',
  }),
  rule({
    ruleId: 'load-progress-change', title: '负荷较前一日同进度变化', drilldown: { analysisId: 'supply.system-series', view: 'summary' },
    thresholds: { minChangePercent: '5' },
    description: '云南统调负荷实际在已发布时段内的平均值，与前一日同一时段相比的变化达到阈值；前一日同时段不完整则不比较',
  }),
])

export function getKeyItemRule(ruleId) {
  return KEY_ITEM_RULES.find(entry => entry.ruleId === ruleId) ?? null
}
