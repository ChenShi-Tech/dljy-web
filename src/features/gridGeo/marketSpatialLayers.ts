import type { GridMarketLayer, GridMarketMetric } from './types'

/**
 * 市场图层的指标口径
 * ------------------------------------------------------------------
 * 「电力市场空间态势」页与驾驶舱的 `market` 场景此前各写了一份取值、格式化与分档
 * 阈值，两处的 hot/warm 分界线、单位写法都靠人肉保持一致。2026-09-08 把市场态势
 * 页的功能并进驾驶舱时提到这里共享——同一个「综合关注 70 分」在两个页面显示成不同
 * 颜色，是这种重复迟早会长出来的 bug。
 */

/** 一档市场图层的展示口径。`suffix` 连空格一起写死，避免 `%` 前多出一个空格。 */
export interface GridMarketLayerOption {
  value: Exclude<GridMarketLayer, 'none'>
  label: string
  /** 数值后缀，含必要的前导空格。 */
  suffix: string
  /** 指标含义，给不熟悉口径的人看。 */
  description: string
}

export const GRID_MARKET_LAYER_OPTIONS: readonly GridMarketLayerOption[] = [
  { value: 'priceSpread', label: '实时-日前价差', suffix: ' 元/MWh', description: '正值表示实时均价高于日前均价' },
  { value: 'outputDeviation', label: '出力偏差', suffix: '%', description: '实际均值相对计划/预测目标的偏差' },
  { value: 'risk', label: '综合关注', suffix: ' 分', description: '价差与出力偏差的描述性关注指数' },
]

export function gridMarketLayerOption(layer: GridMarketLayer): GridMarketLayerOption | null {
  return GRID_MARKET_LAYER_OPTIONS.find((option) => option.value === layer) ?? null
}

/** 取该图层对应的指标值；缺测返回 null，调用方据此过滤或显示「缺测」。 */
export function gridMarketValue(metric: GridMarketMetric, layer: GridMarketLayer): number | null {
  if (layer === 'priceSpread') return metric.priceSpread
  if (layer === 'outputDeviation') return metric.outputDeviationPercent
  if (layer === 'risk') return metric.riskScore
  return null
}

export function gridMarketValueText(metric: GridMarketMetric | null, layer: GridMarketLayer): string {
  const value = metric ? gridMarketValue(metric, layer) : null
  if (value === null) return '缺测'
  const option = gridMarketLayerOption(layer)
  // 关注分是无量纲指数，小数位没有意义；价差与偏差保留一位。
  const text = layer === 'risk' ? value.toFixed(0) : `${value > 0 ? '+' : ''}${value.toFixed(1)}`
  return `${text}${option?.suffix ?? ''}`
}

export type GridMarketTone = 'hot' | 'warm' | 'cool' | 'missing'

/**
 * 指标分档，用于排行榜与图例的着色。
 *
 * 阈值按图层各不相同：关注分是 0–100 的指数，价差与出力偏差是有正负的物理量，看的是
 * 绝对幅度。这些数字原先散在两个页面里，改一处漏一处就会出现「同一个电厂在两个页面
 * 一个标红一个标绿」。
 */
export function gridMarketTone(metric: GridMarketMetric, layer: GridMarketLayer): GridMarketTone {
  const value = gridMarketValue(metric, layer)
  if (value === null) return 'missing'
  if (layer === 'risk') return value >= 70 ? 'hot' : value >= 40 ? 'warm' : 'cool'
  const magnitude = Math.abs(value)
  const hotAt = layer === 'priceSpread' ? 80 : 15
  const warmAt = layer === 'priceSpread' ? 20 : 5
  return magnitude >= hotAt ? 'hot' : magnitude >= warmAt ? 'warm' : 'cool'
}

/**
 * 按指标绝对幅度排序，可选按下钻范围收窄。
 *
 * @param plantIds 下钻到地市州时的电厂 id 集合；不传表示全省
 */
export function rankGridMarketMetrics(
  metrics: readonly GridMarketMetric[],
  layer: GridMarketLayer,
  plantIds?: readonly string[] | null,
): GridMarketMetric[] {
  const allowed = plantIds ? new Set(plantIds) : null
  return [...metrics]
    .filter((metric) => gridMarketValue(metric, layer) !== null && (!allowed || allowed.has(metric.plantId)))
    .sort((left, right) => Math.abs(Number(gridMarketValue(right, layer))) - Math.abs(Number(gridMarketValue(left, layer))))
}
