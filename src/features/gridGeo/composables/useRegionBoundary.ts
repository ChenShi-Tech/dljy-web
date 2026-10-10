/**
 * 省级行政边界图层 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 加载并绘制当前地区的省界 GeoJSON，并算出包围盒供「复位」精确飞到本省，
 * 避免「一整片地形看不出省在哪」与「一复位就跑飞到运营商全景」。
 */
import {
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  GeoJsonDataSource,
  JulianDate,
  Rectangle,
  type Viewer,
} from 'cesium'
import { loadBoundaryByAdcode } from '../flatmap/geoJsonLoader'
import { adcodeForRegion } from '../flatmap/regionAdcode'
import { selectedRegionId } from '@/services/region/regionContext'

/** 从 GeoJSON 坐标算经纬包围盒，供「复位」精确飞到本省而不是运营商全景。 */
export function computeBoundaryRectangle(geoJson: { features: Array<{ geometry: { coordinates: unknown } }> }): Rectangle | null {
  let west = 180, east = -180, south = 90, north = -90, seen = false
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lon, lat] = node as [number, number]
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
      west = Math.min(west, lon); east = Math.max(east, lon)
      south = Math.min(south, lat); north = Math.max(north, lat)
      seen = true
      return
    }
    for (const child of node) walk(child)
  }
  for (const feature of geoJson.features ?? []) walk(feature.geometry?.coordinates)
  return seen ? Rectangle.fromDegrees(west, south, east, north) : null
}

export function useRegionBoundary(options: {
  getViewer: () => Viewer | null
}) {
  const { getViewer } = options
  let boundaryDataSource: GeoJsonDataSource | null = null
  let boundaryRectangle: Rectangle | null = null
  let boundaryRequestId = 0

  function getBoundaryRectangle() {
    return boundaryRectangle
  }

  /**
   * 加载并绘制当前地区的省级行政边界。
   * 只描边、不填色，填色会盖住地形与影像，而这层的目的只是「圈出省在哪」。
   */
  async function syncRegionBoundary() {
    const viewer = getViewer()
    if (!viewer) return
    const requestId = ++boundaryRequestId
    const adcode = adcodeForRegion(selectedRegionId.value)

    if (boundaryDataSource) {
      viewer.dataSources.remove(boundaryDataSource, true)
      boundaryDataSource = null
      boundaryRectangle = null
    }
    // 模板地区无对应行政区：不画边界，也绝不回退他省。
    if (!adcode) { viewer.scene.requestRender(); return }

    try {
      const geoJson = await loadBoundaryByAdcode(adcode)
      // 世代守卫：地区已再次切换则丢弃本次结果。
      const current = getViewer()
      if (requestId !== boundaryRequestId || !current) return

      const accent = Color.fromCssColorString('#ffd166')
      const source = await GeoJsonDataSource.load(geoJson, {
        stroke: accent,
        strokeWidth: 3,
        fill: Color.TRANSPARENT,
        clampToGround: true,
      })
      const loaded = getViewer()
      if (requestId !== boundaryRequestId || !loaded) return

      // Cesium 的贴地多边形不渲染 outline（已知限制），所以边界线必须单独用
      // clampToGround 的 polyline 画，否则只有一层几乎看不见的半透明填充。
      const now = JulianDate.now()
      const outlines: Array<{ positions: unknown }> = []
      for (const entity of source.entities.values) {
        if (!entity.polygon) continue
        entity.polygon.material = new ColorMaterialProperty(accent.withAlpha(0.05))
        entity.polygon.outline = new ConstantProperty(false)
        const hierarchy = entity.polygon.hierarchy?.getValue(now)
        const positions = hierarchy?.positions
        if (Array.isArray(positions) && positions.length > 1) {
          outlines.push({ positions: [...positions, positions[0]] })
        }
      }
      for (const outline of outlines) {
        source.entities.add({
          polyline: {
            positions: outline.positions as never,
            width: 3,
            clampToGround: true,
            material: new ColorMaterialProperty(accent),
          },
        })
      }
      loaded.dataSources.add(source)
      boundaryDataSource = source
      boundaryRectangle = computeBoundaryRectangle(geoJson)
      loaded.scene.requestRender()
    } catch (error) {
      console.warn('[grid-geo] 省界加载失败，保留地形底图', error)
    }
  }

  /** 卸载归位：数据源随 viewer 销毁，这里只清引用与包围盒缓存。 */
  function dispose() {
    boundaryDataSource = null
    boundaryRectangle = null
  }

  return { syncRegionBoundary, getBoundaryRectangle, dispose }
}
