import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  PolylineDashMaterialProperty,
  VerticalOrigin,
  type Entity,
  type JulianDate,
  type Viewer,
} from 'cesium'
import type { GridGeoViewMode, GridTopologyFeature, GridTopologyPosition } from '../types'
import { topologyFeatureLabel, topologyVisualStyle } from './topologyStyle'

export type TopologyRenderOptions = {
  selectedFeatureId: string | null
  gridOperator: 'csg' | 'sgcc'
  viewMode: GridGeoViewMode
  lod: 0 | 1 | 2
  weakNetwork: boolean
}

function cartesian(position: GridTopologyPosition) {
  return Cartesian3.fromDegrees(position[0], position[1], position[2] ?? 45)
}

export function createCesiumTopologyRenderer(viewer: Viewer) {
  const entityIds = new Set<string>()

  function clear() {
    for (const id of entityIds) viewer.entities.removeById(id)
    entityIds.clear()
    viewer.scene.requestRender()
  }

  function addPoint(feature: GridTopologyFeature, options: TopologyRenderOptions) {
    if (feature.geometry.type !== 'Point') return
    const selected = feature.featureId === options.selectedFeatureId
    const style = topologyVisualStyle(feature, { ...options, selected })
    const id = `topology:${feature.featureId}`
    entityIds.add(id)
    viewer.entities.add({
      id,
      name: feature.name,
      position: cartesian(feature.geometry.coordinates),
      properties: { topologyFeatureId: feature.featureId, topologyKind: feature.kind },
      point: {
        pixelSize: style.pointSize,
        color: Color.fromCssColorString(style.color),
        outlineColor: Color.fromCssColorString(selected ? '#fff4bd' : '#03111d'),
        outlineWidth: selected ? 5 : 3,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(7e4, 1.25, 1.8e6, 0.58),
      },
      label: style.showLabel ? {
        text: `${topologyFeatureLabel(feature.kind)} · ${feature.name}`,
        font: selected ? '700 14px "PingFang SC", sans-serif' : '500 12px "PingFang SC", sans-serif',
        fillColor: Color.fromCssColorString(style.color),
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? 1.8e6 : 720_000),
      } : undefined,
    })
  }

  function addLine(feature: GridTopologyFeature, positions: GridTopologyPosition[], segment: number, options: TopologyRenderOptions) {
    const selected = feature.featureId === options.selectedFeatureId
    const style = topologyVisualStyle(feature, { ...options, selected })
    const id = `topology:${feature.featureId}:${segment}`
    entityIds.add(id)
    const lineColor = Color.fromCssColorString(style.color).withAlpha(selected ? 0.98 : 0.82)
    const hasAuthoritativeElevation = positions.some((position) => position.length >= 3)
    viewer.entities.add({
      id,
      name: feature.name,
      position: positions.length ? cartesian(positions[Math.floor(positions.length / 2)]) : undefined,
      properties: { topologyFeatureId: feature.featureId, topologyKind: feature.kind },
      polyline: {
        positions: positions.map(cartesian),
        width: style.width,
        material: style.dashed ? new PolylineDashMaterialProperty({ color: lineColor, dashLength: 14 }) : lineColor,
        clampToGround: !hasAuthoritativeElevation,
        distanceDisplayCondition: new DistanceDisplayCondition(0, options.lod === 0 ? 2.8e6 : 1.8e6),
      },
      label: style.showLabel && segment === 0 ? {
        text: `${topologyFeatureLabel(feature.kind)} · ${feature.name}`,
        font: selected ? '700 14px "PingFang SC", sans-serif' : '500 12px "PingFang SC", sans-serif',
        fillColor: Color.fromCssColorString(style.color),
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#03111d').withAlpha(0.78),
      } : undefined,
    })
  }

  function render(features: GridTopologyFeature[], options: TopologyRenderOptions) {
    clear()
    for (const feature of features) {
      if (feature.geometry.type === 'Point') addPoint(feature, options)
      else if (feature.geometry.type === 'LineString') addLine(feature, feature.geometry.coordinates, 0, options)
      else feature.geometry.coordinates.forEach((positions, index) => addLine(feature, positions, index, options))
    }
    viewer.scene.requestRender()
  }

  function featureIdFromEntity(entity: Entity, time: JulianDate) {
    return String(entity.properties?.topologyFeatureId?.getValue(time) ?? '') || null
  }

  function setSelected(features: GridTopologyFeature[], options: TopologyRenderOptions) {
    render(features, options)
  }

  return Object.freeze({ clear, render, setSelected, featureIdFromEntity })
}
