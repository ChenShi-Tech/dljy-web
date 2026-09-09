/**
 * 场站目录的检索与筛选
 * ------------------------------------------------------------------
 * 原先只长在「电厂地理空间」页里。2026-09-08 那页并入「空间联动驾驶舱」、气象页也要
 * 同一套目录，逻辑就得从组件里拿出来——三个页面各抄一份检索规则，早晚会出现「同一个
 * 关键词在 A 页搜得到、B 页搜不到」。
 */
import type { GridGeoConfidence, GridGeoPlant, GridGeoPlantType } from './types'

export type PlantTypeFilter = 'all' | GridGeoPlantType
export type PlantConfidenceFilter = 'all' | GridGeoConfidence

export interface PlantCatalogFilter {
  keyword?: string
  type?: PlantTypeFilter
  confidence?: PlantConfidenceFilter
}

/**
 * 检索范围覆盖标准名、别名、行政区位标签与绑定节点名。
 *
 * 用别名和节点名一起参与匹配，是因为交易员记住的往往不是标准名：他记得「金牛山」或
 * 「220kV平川变」，而标准名是「110kV金牛山风电场」。只搜标准名等于这个框一半时间没用。
 * 大小写与全半角靠 `toLocaleLowerCase('zh-CN')` 归一。
 */
export function filterPlantCatalog(
  plants: readonly GridGeoPlant[],
  filter: PlantCatalogFilter = {},
): GridGeoPlant[] {
  const { keyword = '', type = 'all', confidence = 'all' } = filter
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  return plants.filter((plant) => {
    if (type !== 'all' && plant.plantType !== type) return false
    if (confidence !== 'all' && plant.location.confidence !== confidence) return false
    if (!needle) return true
    return [
      plant.standardName,
      ...plant.aliases,
      plant.location.locationLabel,
      ...plant.nodeRefs.map((item) => item.nodeName),
    ]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(needle)
  })
}
