/**
 * 天气与云层实体 composable（#2802 拆分 CesiumPlantMap）。
 *
 * 非 cloud 图层：按图层语义在厂站位置画风羽箭头或覆盖椭圆 + 数值标签；
 * cloud 图层：不再画实体，改由 CloudCollection 原语按云量布云，弱网档每站只放一朵。
 */
import {
  Cartesian2,
  Cartesian3,
  CloudCollection,
  Color,
  DistanceDisplayCondition,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  PolylineArrowMaterialProperty,
  type Viewer,
} from 'cesium'
import type { GridGeoPlant, GridGeoWeatherLayer, GridGeoWeatherSnapshot, GridGeoViewMode } from '../types'
import { weatherColor, weatherLabel, windEndpoint } from './mapPlantStyles'

export function useWeatherEntities(options: {
  getViewer: () => Viewer | null
  isWeakNetwork: () => boolean
  getProps: () => {
    plants: GridGeoPlant[]
    weatherLayer: GridGeoWeatherLayer
    weatherItems: GridGeoWeatherSnapshot[]
    viewMode: GridGeoViewMode
  }
}) {
  const { getViewer, isWeakNetwork, getProps } = options
  const weatherEntityIds = new Set<string>()
  let clouds: CloudCollection | null = null

  function addWeatherEntity(weather: GridGeoWeatherSnapshot) {
    const viewer = getViewer()
    const props = getProps()
    if (!viewer || props.weatherLayer === 'none' || props.weatherLayer === 'cloud') return
    const plant = props.plants.find((item) => item.plantId === weather.plantId)
    if (!plant) return
    const label = weatherLabel(weather, props.weatherLayer)
    if (!label) return
    if (props.weatherLayer === 'wind' && !Number.isFinite(weather.windDirectionDeg)) return
    const color = weatherColor(weather, props.weatherLayer)
    const altitude = Math.max(3800, (weather.sampledLocation.elevationM ?? 0) + 2600)

    if (props.weatherLayer === 'wind') {
      const [endLongitude, endLatitude] = windEndpoint(plant, weather)
      weatherEntityIds.add(`weather:${plant.plantId}`)
      viewer.entities.add({
        id: `weather:${plant.plantId}`,
        properties: { plantId: plant.plantId },
        polyline: {
          positions: [
            Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude, altitude),
            Cartesian3.fromDegrees(endLongitude, endLatitude, altitude),
          ],
          width: 7,
          material: new PolylineArrowMaterialProperty(color.withAlpha(0.92)),
        },
      })
    } else {
      const magnitude = props.weatherLayer === 'temperature'
        ? Math.abs(Number(weather.temperatureC) - 20)
        : props.weatherLayer === 'precipitation'
          ? Number(weather.precipitationMm) * 9
          : props.weatherLayer === 'irradiance'
            ? Number(weather.shortwaveRadiationWm2) / 45
            : Number(weather.cloudCoverPercent)
      const radius = Math.min(46_000, Math.max(14_000, 14_000 + magnitude * 850))
      weatherEntityIds.add(`weather:${plant.plantId}`)
      viewer.entities.add({
        id: `weather:${plant.plantId}`,
        position: Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude),
        properties: { plantId: plant.plantId },
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius * 0.74,
          height: 60,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          material: color.withAlpha(0.16),
          outline: true,
          outlineColor: color.withAlpha(0.82),
          outlineWidth: 2,
        },
      })
    }

    weatherEntityIds.add(`weather-label:${plant.plantId}`)
    viewer.entities.add({
      id: `weather-label:${plant.plantId}`,
      position: Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude, altitude + 1200),
      properties: { plantId: plant.plantId },
      label: {
        text: label,
        font: '600 13px "PingFang SC", sans-serif',
        fillColor: color,
        outlineColor: Color.fromCssColorString('#03111d'),
        outlineWidth: 5,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -58),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 1.7e6),
        scaleByDistance: new NearFarScalar(8.0e4, 1.05, 1.7e6, 0.68),
      },
    })
  }

  function rebuildClouds() {
    if (!clouds) return
    clouds.removeAll()
    const props = getProps()
    clouds.show = props.weatherLayer === 'cloud' && props.viewMode === '3d'
    if (!clouds.show) return
    for (const weather of props.weatherItems) {
      const plant = props.plants.find((item) => item.plantId === weather.plantId)
      if (!plant || !Number.isFinite(weather.cloudCoverPercent) || Number(weather.cloudCoverPercent) < 15) continue
      const cloudCount = isWeakNetwork()
        ? 1
        : Math.min(3, Math.max(1, Math.round(Number(weather.cloudCoverPercent) / 35)))
      for (let index = 0; index < cloudCount; index += 1) {
        const direction = ((weather.windDirectionDeg ?? 0) + index * 120) * Math.PI / 180
        const offset = 0.045 + index * 0.035
        const longitude = plant.location.longitude + Math.sin(direction) * offset
        const latitude = plant.location.latitude + Math.cos(direction) * offset
        const width = 11_000 + Number(weather.cloudCoverPercent) * 85 + index * 1800
        clouds.add({
          position: Cartesian3.fromDegrees(longitude, latitude, (weather.sampledLocation.elevationM ?? 1800) + 5000 + index * 800),
          scale: new Cartesian2(width, width * 0.5),
          maximumSize: new Cartesian3(width * 1.6, width * 0.8, width * 0.72),
          brightness: 0.74 + Math.min(0.2, (100 - Number(weather.cloudCoverPercent)) / 500),
        })
      }
    }
  }

  function renderWeatherEntities() {
    const viewer = getViewer()
    if (!viewer) return
    for (const id of weatherEntityIds) viewer.entities.removeById(id)
    weatherEntityIds.clear()
    getProps().weatherItems.forEach(addWeatherEntity)
    rebuildClouds()
    viewer.scene.requestRender()
  }

  /** Viewer 创建后挂载云层原语（原 createViewer 1553）。 */
  function attachClouds(viewer: Viewer) {
    clouds = viewer.scene.primitives.add(new CloudCollection({ noiseDetail: 16 }))
  }

  /** 卸载归位：云层引用与实体 id 集合清空（对应原 1707、1721）。 */
  function dispose() {
    clouds = null
    weatherEntityIds.clear()
  }

  return { renderWeatherEntities, rebuildClouds, attachClouds, dispose }
}
