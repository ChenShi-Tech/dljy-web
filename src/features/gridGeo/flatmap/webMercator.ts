/**
 * Web Mercator 投影与瓦片索引换算
 * ------------------------------------------------------------------
 * 二维平面图要叠真实底图，前提是 **ECharts geo 与瓦片用同一个投影**。
 *
 * 原先 geo 走 ECharts 默认投影（经纬度直接当平面坐标，再用 `aspectScale: 0.9`
 * 手工压一下经度方向）——那是个纯观感上的近似，与任何在线地图瓦片都对不上。
 * 统一到 Web Mercator 之后，一张 Mercator 瓦片映射到屏幕就是**轴对齐矩形**，
 * 可以直接 `drawImage(img, x, y, w, h)` 贴上去，不必逐块做透视变形。
 *
 * 输出坐标采用**屏幕语义**（y 向下为正，纬度越大 y 越小），与 ECharts geo 内部
 * 对 project 结果的处理一致；d3-geo 的 mercatorRaw 是「北为正」再由 d3 翻转，
 * 这里直接取负省掉一层。
 *
 * 纬度裁剪到 ±85.051129°（Mercator 在极点发散）；这是 Web Mercator 的标准边界，
 * 也是全部在线地图瓦片方案的覆盖上限。
 */

/** Web Mercator 的纬度边界：atan(sinh(π)) 换算成角度。 */
export const MERCATOR_MAX_LATITUDE = 85.05112877980659

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export function clampLatitude(latitude: number): number {
  return Math.min(MERCATOR_MAX_LATITUDE, Math.max(-MERCATOR_MAX_LATITUDE, latitude))
}

/**
 * 经纬度 → Mercator 平面坐标（屏幕语义，y 向下）。
 * 量纲是弧度级别，ECharts 会按 boundingRect 自适应缩放，绝对尺度不重要。
 */
export function projectMercator(point: number[]): number[] {
  const longitude = Number(point[0])
  const latitude = clampLatitude(Number(point[1]))
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [Number.NaN, Number.NaN]
  return [
    longitude * DEG2RAD,
    -Math.log(Math.tan(Math.PI / 4 + (latitude * DEG2RAD) / 2)),
  ]
}

/** Mercator 平面坐标 → 经纬度，`projectMercator` 的逆。 */
export function unprojectMercator(point: number[]): number[] {
  const x = Number(point[0])
  const y = Number(point[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [Number.NaN, Number.NaN]
  return [
    x * RAD2DEG,
    (2 * Math.atan(Math.exp(-y)) - Math.PI / 2) * RAD2DEG,
  ]
}

/** 供 `geo.projection` 直接使用的对象。 */
export const MERCATOR_PROJECTION = {
  project: projectMercator,
  unproject: unprojectMercator,
}

/**
 * 经度 → 瓦片列号（可含小数，小数部分是瓦片内偏移）。
 * 标准 XYZ / GoogleMapsCompatible 方案：z 级共 2^z 列，0 列左边界为 -180°。
 */
export function longitudeToTileX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * Math.pow(2, zoom)
}

/** 纬度 → 瓦片行号（可含小数）。0 行上边界为北纬 85.0511°。 */
export function latitudeToTileY(latitude: number, zoom: number): number {
  const lat = clampLatitude(latitude) * DEG2RAD
  return ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * Math.pow(2, zoom)
}

/** 瓦片列号 → 该列左边界经度。 */
export function tileXToLongitude(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180
}

/** 瓦片行号 → 该行上边界纬度。 */
export function tileYToLatitude(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom)
  return RAD2DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/**
 * 由「视口经度跨度 + 视口像素宽」选瓦片级别。
 *
 * 判据是让一张 256px 瓦片在屏幕上大致仍占 256px——取更高一级会糊，更低一级则
 * 白白多下几倍的瓦片。`Math.round` 而非 `floor`：宁可稍微清晰一点。
 */
export function pickTileZoom(
  longitudeSpan: number,
  viewportWidthPx: number,
  options: { min?: number; max?: number; tileSize?: number } = {},
): number {
  const { min = 1, max = 18, tileSize = 256 } = options
  if (!(longitudeSpan > 0) || !(viewportWidthPx > 0)) return min
  // 视口占全球经度的比例 → 需要多少张瓦片横向铺满 → 反推层级
  const tilesAcross = viewportWidthPx / tileSize
  const worldTiles = tilesAcross * (360 / longitudeSpan)
  const zoom = Math.round(Math.log2(Math.max(1, worldTiles)))
  return Math.min(max, Math.max(min, zoom))
}

/** 该层级的瓦片行列上限（不含）。 */
export function tileCount(zoom: number): number {
  return Math.pow(2, Math.max(0, Math.floor(zoom)))
}
