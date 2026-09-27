/**
 * 场站与节点实体渲染 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 场站：远景聚合为 cluster billboard，近景为「不确定圈 + 立柱 + 标注」三件套；
 * 节点：定位有效时画 point + label，近似定位补不确定圈。
 * 每类实体用独立 id 集合做增删配对，重建即全清再画（保持拆分前行为）。
 */
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import { aggregateMapPoints } from '../mapInteraction'
import type { GridGeoNode, GridGeoPlant, GridMarketLayer, GridMarketMetric } from '../types'
import { markerCanvas, clusterCanvas } from './mapMarkerCanvas'
import { SELECTED_COLOR, marketMetricValue, nodeColor, plantColor, validNodeLocation } from './mapPlantStyles'

export function useMapEntities(options: {
  getViewer: () => Viewer | null
  isReduceMotion: () => boolean
  isCoarsePointer: () => boolean
  getProps: () => {
    plants: GridGeoPlant[]
    selectedPlantId?: string | null
    nodes?: GridGeoNode[]
    selectedNodeId?: string | null
    showLocatedNodes?: boolean
    marketLayer?: GridMarketLayer
    marketMetrics?: GridMarketMetric[]
  }
}) {
  const { getViewer, isReduceMotion, isCoarsePointer, getProps } = options
  const plantEntityIds = new Set<string>()
  const nodeEntityIds = new Set<string>()

  function addPlantCluster(assetIds: string[], longitude: number, latitude: number) {
    const viewer = getViewer()
    if (!viewer) return
    const plants = assetIds
      .map((plantId) => getProps().plants.find((plant) => plant.plantId === plantId))
      .filter((plant): plant is GridGeoPlant => Boolean(plant))
    if (plants.length < 2) return
    const capacity = plants.reduce((sum, plant) => sum + (Number(plant.capacityMw) || 0), 0)
    const id = `plant-cluster:${assetIds.join('|')}`
    plantEntityIds.add(id)
    viewer.entities.add({
      id,
      name: `${plants.length} 座场站`,
      position: Cartesian3.fromDegrees(longitude, latitude, 900),
      properties: { clusterPlantIds: assetIds },
      billboard: {
        image: clusterCanvas(plants.length),
        width: isCoarsePointer() ? 62 : 54,
        height: isCoarsePointer() ? 62 : 54,
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.0e5, 1.15, 3.2e6, 0.82),
      },
      label: {
        text: `${capacity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} MW`,
        font: '600 12px "PingFang SC", sans-serif',
        fillColor: Color.fromCssColorString('#a7efff'),
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, 31),
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }

  function addPlantEntity(plant: GridGeoPlant) {
    const viewer = getViewer()
    if (!viewer) return
    const props = getProps()
    const selected = plant.plantId === props.selectedPlantId
    const color = selected ? SELECTED_COLOR : plantColor(plant, props.marketLayer, props.marketMetrics)
    const capacity = Number(plant.capacityMw) || 50
    const columnHeight = Math.min(36000, Math.max(9000, capacity * 110))
    const columnRadius = Math.min(7000, Math.max(2300, Math.sqrt(capacity) * 340))
    const uncertainty = Math.max(0, Number(plant.location.uncertaintyMeters) || 0)
    const pulseStart = Math.random() * Math.PI * 2
    const metric = props.marketMetrics?.find((item) => item.plantId === plant.plantId)
    const marketValue = metric ? marketMetricValue(metric, props.marketLayer) : null
    const marketText = marketValue === null || marketValue === undefined
      ? ''
      : props.marketLayer === 'priceSpread'
        ? `\n价差 ${marketValue >= 0 ? '+' : ''}${marketValue.toFixed(1)} 元/MWh`
        : props.marketLayer === 'outputDeviation'
          ? `\n出力 ${marketValue >= 0 ? '+' : ''}${marketValue.toFixed(1)}%`
          : `\n关注 ${marketValue.toFixed(0)}`

    if (uncertainty > 0 || plant.location.confidence !== 'verified') {
      plantEntityIds.add(`uncertainty:${plant.plantId}`)
      viewer.entities.add({
        id: `uncertainty:${plant.plantId}`,
        position: Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude),
        properties: { plantId: plant.plantId },
        ellipse: {
          semiMajorAxis: new CallbackProperty(() => {
            const pulse = isReduceMotion() ? 1 : 0.94 + Math.sin(Date.now() / 900 + pulseStart) * 0.06
            return Math.max(2600, uncertainty * pulse)
          }, false),
          semiMinorAxis: new CallbackProperty(() => {
            const pulse = isReduceMotion() ? 1 : 0.94 + Math.sin(Date.now() / 900 + pulseStart) * 0.06
            return Math.max(2200, uncertainty * pulse * 0.82)
          }, false),
          height: 30,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          material: color.withAlpha(selected ? 0.2 : 0.07),
          outline: true,
          outlineColor: color.withAlpha(selected ? 0.95 : 0.36),
          outlineWidth: selected ? 3 : 1,
        },
      })
    }

    plantEntityIds.add(`column:${plant.plantId}`)
    viewer.entities.add({
      id: `column:${plant.plantId}`,
      name: plant.standardName,
      position: Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude, columnHeight / 2),
      properties: { plantId: plant.plantId },
      cylinder: {
        length: columnHeight,
        topRadius: columnRadius * 0.34,
        bottomRadius: columnRadius,
        material: color.withAlpha(selected ? 0.58 : 0.32),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        heightReference: HeightReference.RELATIVE_TO_GROUND,
      },
    })

    plantEntityIds.add(`plant:${plant.plantId}`)
    viewer.entities.add({
      id: `plant:${plant.plantId}`,
      name: plant.standardName,
      position: Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude),
      properties: { plantId: plant.plantId },
      billboard: {
        image: markerCanvas(plant, selected, color),
        width: selected ? 58 : isCoarsePointer() ? 52 : 46,
        height: selected ? 58 : isCoarsePointer() ? 52 : 46,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -18),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1.0e5, 1.1, 2.8e6, 0.62),
      },
      label: {
        text: `${plant.standardName}${marketText}`,
        font: selected ? '600 16px "PingFang SC", sans-serif' : '500 14px "PingFang SC", sans-serif',
        fillColor: selected ? SELECTED_COLOR : Color.WHITE,
        outlineColor: Color.fromCssColorString('#06111f'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(0, 12),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? 2.0e6 : 750_000),
        scaleByDistance: new NearFarScalar(8.0e4, 1.05, 1.8e6, 0.66),
      },
    })
  }

  function addNodeEntity(node: GridGeoNode) {
    const viewer = getViewer()
    const props = getProps()
    if (!viewer || !props.showLocatedNodes || !validNodeLocation(node) || !node.location) return
    const selected = node.nodeId === props.selectedNodeId
    const color = nodeColor(node, selected)
    const assetId = node.assetId || node.nodeId
    const uncertainty = Math.max(0, Number(node.location.uncertaintyMeters) || 0)

    if (uncertainty > 0 || node.locationStatus === 'approximate') {
      nodeEntityIds.add(`node-uncertainty:${assetId}`)
      viewer.entities.add({
        id: `node-uncertainty:${assetId}`,
        position: Cartesian3.fromDegrees(node.location.longitude, node.location.latitude),
        properties: { assetKind: 'node', assetId, nodeId: node.nodeId },
        ellipse: {
          semiMajorAxis: Math.max(1800, uncertainty),
          semiMinorAxis: Math.max(1500, uncertainty * 0.82),
          height: 30,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          material: color.withAlpha(selected ? 0.18 : 0.06),
          outline: true,
          outlineColor: color.withAlpha(selected ? 0.95 : 0.42),
          outlineWidth: selected ? 3 : 1,
        },
      })
    }

    nodeEntityIds.add(`node:${assetId}`)
    viewer.entities.add({
      id: `node:${assetId}`,
      name: node.nodeName,
      position: Cartesian3.fromDegrees(node.location.longitude, node.location.latitude),
      properties: { assetKind: 'node', assetId, nodeId: node.nodeId },
      point: {
        pixelSize: selected ? 15 : 10,
        color,
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: selected ? 4 : 3,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(8.0e4, 1.2, 1.5e6, 0.62),
      },
      label: {
        text: node.nodeName,
        font: selected ? '600 15px "PingFang SC", sans-serif' : '500 13px "PingFang SC", sans-serif',
        fillColor: selected ? SELECTED_COLOR : color,
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -14),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? 1.4e6 : 620_000),
        scaleByDistance: new NearFarScalar(8.0e4, 1.02, 620_000, 0.7),
      },
    })
  }

  function clearTrackedEntities(ids: Set<string>) {
    const viewer = getViewer()
    if (!viewer) return
    for (const id of ids) viewer.entities.removeById(id)
    ids.clear()
  }

  function renderPlantEntities() {
    const viewer = getViewer()
    if (!viewer) return
    clearTrackedEntities(plantEntityIds)
    const props = getProps()
    const height = viewer.camera.positionCartographic.height
    const items = aggregateMapPoints(
      props.plants.map((plant) => ({
        id: plant.plantId,
        longitude: plant.location.longitude,
        latitude: plant.location.latitude,
      })),
      height,
      props.selectedPlantId,
    )
    for (const item of items) {
      if (item.kind === 'cluster') addPlantCluster(item.assetIds, item.longitude, item.latitude)
      else {
        const plant = props.plants.find((candidate) => candidate.plantId === item.id)
        if (plant) addPlantEntity(plant)
      }
    }
    viewer.scene.requestRender()
  }

  function renderNodeEntities() {
    const viewer = getViewer()
    if (!viewer) return
    clearTrackedEntities(nodeEntityIds)
    if (getProps().showLocatedNodes) (getProps().nodes ?? []).forEach(addNodeEntity)
    viewer.scene.requestRender()
  }

  function updateSelectionStyle() {
    // 选中项必须从远景聚合中拆出，因此选择变化时重建轻量电厂实体组。
    renderPlantEntities()
  }

  function updateNodeSelectionStyle() {
    const viewer = getViewer()
    if (!viewer) return
    for (const node of getProps().nodes ?? []) {
      if (!validNodeLocation(node)) continue
      const selected = node.nodeId === getProps().selectedNodeId
      const color = nodeColor(node, selected)
      const assetId = node.assetId || node.nodeId
      const marker = viewer.entities.getById(`node:${assetId}`)
      if (marker?.point) {
        marker.point.pixelSize = new ConstantProperty(selected ? 15 : 10)
        marker.point.color = new ConstantProperty(color)
        marker.point.outlineWidth = new ConstantProperty(selected ? 4 : 3)
      }
      if (marker?.label) {
        marker.label.fillColor = new ConstantProperty(color)
        marker.label.font = new ConstantProperty(selected ? '600 15px "PingFang SC", sans-serif' : '500 13px "PingFang SC", sans-serif')
        marker.label.distanceDisplayCondition = new ConstantProperty(new DistanceDisplayCondition(0, selected ? 1.4e6 : 620_000))
      }
      const halo = viewer.entities.getById(`node-uncertainty:${assetId}`)
      if (halo?.ellipse) {
        halo.ellipse.material = new ColorMaterialProperty(color.withAlpha(selected ? 0.18 : 0.06))
        halo.ellipse.outlineColor = new ConstantProperty(color.withAlpha(selected ? 0.95 : 0.42))
        halo.ellipse.outlineWidth = new ConstantProperty(selected ? 3 : 1)
      }
    }
    viewer.scene.requestRender()
  }

  /** 聚合成员 id 读取：悬停描述与点击展开都靠它区分聚合 billboard。 */
  function clusterPlantIds(entity: Entity) {
    const viewer = getViewer()
    if (!viewer) return []
    const value = entity.properties?.clusterPlantIds?.getValue(viewer.clock.currentTime)
    return Array.isArray(value) ? value.map(String) : []
  }

  /** 卸载时清空 id 集合（对应原 1719–1720）。 */
  function clearAll() {
    plantEntityIds.clear()
    nodeEntityIds.clear()
  }

  return { renderPlantEntities, renderNodeEntities, updateSelectionStyle, updateNodeSelectionStyle, clusterPlantIds, clearAll }
}
