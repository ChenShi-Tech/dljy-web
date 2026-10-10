/**
 * 授权网架拓扑图层 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 渲染细节在 topology/cesiumTopologyRenderer（独立模块）；本层只管
 * 何时渲染（开关/数据/选中/算子变化）、按相机高度算 LOD、把视口查询抛给宿主取数。
 */
import { Math as CesiumMath, type Entity, type Viewer } from 'cesium'
import { createCesiumTopologyRenderer } from '../topology/cesiumTopologyRenderer'
import type { TopologyViewportQuery } from '../topology/topologyViewportLoader'
import type { GridGeoViewMode, GridTopologyFeature } from '../types'

export function useTopologyLayer(options: {
  getViewer: () => Viewer | null
  isWeakNetwork: () => boolean
  getProps: () => {
    showTopology?: boolean
    topologyFeatures?: GridTopologyFeature[]
    selectedTopologyFeatureId?: string | null
    topologyGridOperator?: 'csg' | 'sgcc'
    viewMode: GridGeoViewMode
  }
  emitTopologyViewport: (viewport: TopologyViewportQuery) => void
}) {
  const { getViewer, isWeakNetwork, getProps, emitTopologyViewport } = options
  let topologyRenderer: ReturnType<typeof createCesiumTopologyRenderer> | null = null

  /** Viewer 创建后立即接渲染器（原 createViewer 1503）。 */
  function attachViewer(viewer: Viewer) {
    topologyRenderer = createCesiumTopologyRenderer(viewer)
  }

  function renderTopologyEntities() {
    const viewer = getViewer()
    if (!viewer || !topologyRenderer) return
    const props = getProps()
    if (!props.showTopology) {
      topologyRenderer.clear()
      return
    }
    topologyRenderer.render(props.topologyFeatures ?? [], {
      selectedFeatureId: props.selectedTopologyFeatureId ?? null,
      gridOperator: props.topologyGridOperator ?? props.topologyFeatures?.[0]?.gridOperator ?? 'csg',
      viewMode: props.viewMode,
      lod: topologyViewport().lod,
      weakNetwork: isWeakNetwork(),
    })
  }

  function topologyViewport(): TopologyViewportQuery {
    const viewer = getViewer()
    const height = Math.max(0, viewer?.camera.positionCartographic.height ?? 2_500_000)
    const lod: 0 | 1 | 2 = height > 1_200_000 ? 0 : height > 320_000 ? 1 : 2
    const rectangle = viewer?.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
    if (!rectangle) return { lod, limit: lod === 0 ? 900 : lod === 1 ? 1_600 : 2_400 }
    const west = CesiumMath.toDegrees(rectangle.west)
    const south = CesiumMath.toDegrees(rectangle.south)
    const east = CesiumMath.toDegrees(rectangle.east)
    const north = CesiumMath.toDegrees(rectangle.north)
    const bounds = west < east ? [west, south, east, north].map((value) => value.toFixed(6)).join(',') : undefined
    return { ...(bounds ? { bounds } : {}), lod, limit: lod === 0 ? 900 : lod === 1 ? 1_600 : 2_400 }
  }

  function emitViewport() {
    if (!getProps().showTopology || !getViewer()) return
    emitTopologyViewport(topologyViewport())
  }

  /** 拾取描述用：把命中的实体映射回拓扑要素 id。 */
  function featureIdFromEntity(entity: Entity) {
    const viewer = getViewer()
    if (!topologyRenderer || !viewer) return null
    return topologyRenderer.featureIdFromEntity(entity, viewer.clock.currentTime)
  }

  /** 卸载归位（对应原 1718）。渲染器随 viewer 销毁，无需单独清理实体。 */
  function dispose() {
    topologyRenderer = null
  }

  return { attachViewer, renderTopologyEntities, topologyViewport, emitViewport, featureIdFromEntity, dispose }
}
