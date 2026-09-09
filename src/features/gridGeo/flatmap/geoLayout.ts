/**
 * geo 盒式布局参数的选择
 * ------------------------------------------------------------------
 * ECharts 的 `getLayoutRect` 只在宽或高有一个「算不出来」时才用 aspect 做等比换算
 * （见 echarts util/layout.ts：`if (isNaN(width)) width = aspect * height`）。四边
 * top/left/right/bottom 全给的话宽高都被定死，aspect 分支根本不进，地图会被**非等比
 * 拉伸**铺满容器。
 *
 * 云南投影后的真实宽高比约 0.85（竖高），塞进 1.9 的宽容器就是横向拉到两倍宽。底图
 * 是纯色多边形时这种变形看不出来（历史实现靠手调 `aspectScale: 0.9` 补偿，注释还把它
 * 说成投影校正），铺上卫星影像后一眼即现。
 *
 * 所以只钉一个方向的两条边，另一个方向留给 aspect：谁是瓶颈钉谁。
 */

/** 地图四周留白，单位 px。 */
export const GEO_INSET = 16

export type GeoBoxLayout = Record<string, number | string>

const HEIGHT_BOUND: GeoBoxLayout = { top: GEO_INSET, bottom: GEO_INSET, left: 'center' }
const WIDTH_BOUND: GeoBoxLayout = { left: GEO_INSET, right: GEO_INSET, top: 'middle' }

/**
 * @param mapAspect        地图**投影后**的宽高比。传经纬度直接算的比值会选错方向。
 * @param containerWidth   容器 CSS 像素宽
 * @param containerHeight  容器 CSS 像素高
 */
export function pickGeoBoxLayout(
  mapAspect: number,
  containerWidth: number,
  containerHeight: number,
): GeoBoxLayout {
  // 拿不到有效输入时按「高度受限」走：驾驶舱容器恒为宽屏，这一档更接近实际。
  if (!(mapAspect > 0) || !Number.isFinite(mapAspect)) return HEIGHT_BOUND
  const availableWidth = Math.max(1, containerWidth - GEO_INSET * 2)
  const availableHeight = Math.max(1, containerHeight - GEO_INSET * 2)
  // 容器比地图更宽 → 高度先撑满，宽度按 aspect 算并水平居中；反之相反。
  return availableWidth / availableHeight > mapAspect ? HEIGHT_BOUND : WIDTH_BOUND
}

/** 由经纬度 bbox 求投影后的宽高比。bbox 为 `[west, south, east, north]`。 */
export function mercatorAspect(
  bbox: readonly number[],
  project: (point: number[]) => number[],
): number {
  const southWest = project([bbox[0], bbox[1]])
  const northEast = project([bbox[2], bbox[3]])
  const height = Math.abs(northEast[1] - southWest[1])
  if (!(height > 0)) return Number.NaN
  return Math.abs(northEast[0] - southWest[0]) / height
}
