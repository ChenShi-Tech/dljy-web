// 地市州下钻的纯几何判定（#1424）。
//
// 下钻语义：点击地市州不是切到县区行政图，而是把省图收窄到该地州范围，并把资产、
// 节点、网架要素筛成「落在该地州内」的子集，交易关心的是断面阻塞与节点价差，不是区县边界。
//
// 因此需要三件事：地州的经纬包围盒（定视角）、点是否在其多边形内（定归属）、
// 以及包围盒转 bounds 查询串（收窄 topology 视口，复用 Cesium 那侧的 "w,s,e,n" 口径）。
//
// 这里全部是纯函数，不碰 ECharts 与 DOM，便于单测覆盖极端形状（洞、跨环、无效坐标）。

import type { BoundaryFeature } from './geoJsonLoader'
import type { GridTopologyFeature } from '../types'

export type BBox = [west: number, south: number, east: number, north: number]

/** GeoJSON 线性环：[经度, 纬度] 序列。 */
type Ring = Array<[number, number]>

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function isRing(value: unknown): value is Ring {
  return Array.isArray(value) && value.length >= 3 && value.every(isPosition)
}

function isRingList(value: unknown): value is Ring[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRing)
}

/**
 * 把 Polygon / MultiPolygon 统一成「多边形列表」，每个多边形是环列表（首环为外环，其余为洞）。
 * 其他几何类型（行政边界不该出现的 Point/LineString）返回空，宁可判定为「无法归属」，
 * 也不猜一个包围盒出来。
 */
function toPolygons(feature: BoundaryFeature): Ring[][] {
  const { type, coordinates } = feature.geometry
  if (type === 'Polygon') return isRingList(coordinates) ? [coordinates] : []
  if (type === 'MultiPolygon') {
    return Array.isArray(coordinates) ? coordinates.filter(isRingList) : []
  }
  return []
}

/** 单个地州（或省域整体要素）的经纬包围盒；几何不可解析时返回 null。 */
export function boundaryBBox(feature: BoundaryFeature): BBox | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const polygon of toPolygons(feature)) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < west) west = lon
        if (lon > east) east = lon
        if (lat < south) south = lat
        if (lat > north) north = lat
      }
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) return null
  return [west, south, east, north]
}

/** 整省包围盒 = 所有地州包围盒的并集。用于换算下钻缩放倍数的基准。 */
export function collectionBBox(features: BoundaryFeature[]): BBox | null {
  let result: BBox | null = null
  for (const feature of features) {
    const box = boundaryBBox(feature)
    if (!box) continue
    result = result
      ? [Math.min(result[0], box[0]), Math.min(result[1], box[1]), Math.max(result[2], box[2]), Math.max(result[3], box[3])]
      : box
  }
  return result
}

/**
 * 点是否落在该地州内。
 *
 * 按 GeoJSON 的 even-odd 规则对多边形的所有环累计射线交点：外环让状态翻进去、
 * 洞再翻出来，飞地（MultiPolygon）逐个多边形试。这样无需区分外环与洞的绕向，
 * 也能正确处理「地州内的插花地」。
 */
export function pointInBoundary(feature: BoundaryFeature, longitude: number, latitude: number): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false
  for (const polygon of toPolygons(feature)) {
    let inside = false
    for (const ring of polygon) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const [lonI, latI] = ring[index]
        const [lonJ, latJ] = ring[previous]
        // 半开区间比较（latI > lat 与 latJ > lat 异号）避免顶点被重复计数。
        const straddles = latI > latitude !== latJ > latitude
        if (!straddles) continue
        const crossLon = lonI + ((latitude - latI) / (latJ - latI)) * (lonJ - lonI)
        if (longitude < crossLon) inside = !inside
      }
    }
    if (inside) return true
  }
  return false
}

/** 网架要素的所有顶点（Point / LineString / MultiLineString 统一展开）。 */
function topologyPositions(feature: GridTopologyFeature): Array<[number, number]> {
  const geometry = feature.geometry
  if (geometry.type === 'Point') {
    return isPosition(geometry.coordinates) ? [[geometry.coordinates[0], geometry.coordinates[1]]] : []
  }
  if (geometry.type === 'LineString') {
    return (geometry.coordinates ?? []).filter(isPosition).map((position) => [position[0], position[1]])
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates ?? []).flatMap((line) => (line ?? []).filter(isPosition).map((position): [number, number] => [position[0], position[1]]))
  }
  return []
}

/**
 * 网架要素是否与该地州相关：任一顶点落在地州内即算。
 *
 * 有意不用「全部顶点在内」：送出断面与联络线本身就是跨地州的，要求全包含会把下钻最想看的
 * 那批要素全滤掉，地州视图里「一头在本地州、另一头送出去」正是关注对象。
 */
export function topologyFeatureInBoundary(feature: GridTopologyFeature, boundary: BoundaryFeature): boolean {
  return topologyPositions(feature).some(([longitude, latitude]) => pointInBoundary(boundary, longitude, latitude))
}

/**
 * 下钻视角：地州包围盒 → ECharts geo 的 center + zoom。
 *
 * zoom 是相对「省域自适应铺满」的倍数，故取省域与地州在两个方向上的跨度比的较小值
 * （取小值保证地州完整落在视野内，不被裁掉）。上限 8 倍：再放大对参考精度的坐标没有意义，
 * 反而会让不确定性光圈铺满屏幕。
 */
/** 下钻视口的留白系数：0.88 ≈ 四周各留 6% 的上下文。 */
const FOCUS_PADDING = 0.88

export function focusViewport(subdivision: BBox, province: BBox, preferredCenter?: [number, number]): { center: [number, number]; zoom: number } {
  const center: [number, number] = preferredCenter && isPosition(preferredCenter)
    ? preferredCenter
    : [(subdivision[0] + subdivision[2]) / 2, (subdivision[1] + subdivision[3]) / 2]
  const subWidth = subdivision[2] - subdivision[0]
  const subHeight = subdivision[3] - subdivision[1]
  const provinceWidth = province[2] - province[0]
  const provinceHeight = province[3] - province[1]
  if (subWidth <= 0 || subHeight <= 0 || provinceWidth <= 0 || provinceHeight <= 0) return { center, zoom: 1 }
  // 跨度要按「以 center 为心」量，不能直接用 bbox 宽高：DataV 给的 center 是行政
  // 驻地而非几何中心，楚雄州府就压在州域南部。拿偏心的 center 配上刚好装下 bbox 的
  // zoom，画面必然裁掉远离驻地的那半个州——底图是纯色块时看不出来，铺上卫星影像后
  // 一眼就是「下钻完只剩半个州」。取到两侧的较大距离再乘二，视口才一定包得住全域。
  const spanWidth = Math.max(center[0] - subdivision[0], subdivision[2] - center[0]) * 2
  const spanHeight = Math.max(center[1] - subdivision[1], subdivision[3] - center[1]) * 2
  if (spanWidth <= 0 || spanHeight <= 0) return { center, zoom: 1 }
  // 再留一圈余量。刚好填满可用区域时州界会紧贴视口边缘，一半被地图上方的浮层与
  // 底部状态条压掉，也看不到与相邻州的接壤关系——下钻是为了看局部，不是为了把
  // 局部裁成孤岛。
  const zoom = Math.min(provinceWidth / spanWidth, provinceHeight / spanHeight) * FOCUS_PADDING
  return { center, zoom: Math.max(1, Math.min(8, zoom)) }
}

/**
 * 包围盒 → topology 快照的 bounds 查询串（"west,south,east,north"，与 CesiumPlantMap 同口径）。
 * 留 5% 外扩：断面端点常压在地州边界上，紧贴包围盒查询会把它们漏在视口外。
 */
export function boundsParam(box: BBox, padRatio = 0.05): string {
  const padLon = Math.max((box[2] - box[0]) * padRatio, 0.01)
  const padLat = Math.max((box[3] - box[1]) * padRatio, 0.01)
  return [box[0] - padLon, box[1] - padLat, box[2] + padLon, box[3] + padLat]
    .map((value) => value.toFixed(6))
    .join(',')
}
