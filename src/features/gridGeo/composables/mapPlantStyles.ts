/**
 * 地图实体的配色与展示标签纯函数层（#2802 拆分 CesiumPlantMap）。
 *
 * 不依赖 DOM/WebGL，只做「数据 → Cesium Color / 文案」的映射，便于单测。
 * 阈值与色值是跟着卫星底图调校出来的观感结果，改动前先跑 mapPlantStyles.spec.ts 对拍。
 */
import { Color } from 'cesium'
import type {
  GridGeoNode,
  GridGeoPlant,
  GridGeoWeatherLayer,
  GridGeoWeatherSnapshot,
  GridMarketLayer,
  GridMarketMetric,
} from '../types'

/** 场站类型基色：风 / 光；其余类型见 plantColor 的兜底绿。 */
export const WIND_COLOR = Color.fromCssColorString('#31d9ff')
export const SOLAR_COLOR = Color.fromCssColorString('#a88cff')
/** 选中态统一色（场站、节点共用）。 */
export const SELECTED_COLOR = Color.fromCssColorString('#ffe58a')

/** 市场图层下该厂站要渲染的数值；无指标或图层未开返回 null。 */
export function marketMetricValue(metric: GridMarketMetric, layer: GridMarketLayer | undefined) {
  if (layer === 'priceSpread') return metric.priceSpread
  if (layer === 'outputDeviation') return metric.outputDeviationPercent
  if (layer === 'risk') return metric.riskScore
  return null
}

/**
 * 厂站标注色：市场图层开启且该厂站有指标时按数值分档，否则按能源类型。
 * 阈值口径与 ProvinceFlatMap 的 marketColor 逐档对齐，改这里必须同步那边。
 */
export function plantColor(
  plant: GridGeoPlant,
  marketLayer: GridMarketLayer | undefined,
  marketMetrics: GridMarketMetric[] | undefined,
) {
  const metric = marketMetrics?.find((item) => item.plantId === plant.plantId)
  if (marketLayer && marketLayer !== 'none' && metric) {
    const value = marketMetricValue(metric, marketLayer)
    if (value !== null) {
      if (marketLayer === 'priceSpread') {
        if (value >= 80) return Color.fromCssColorString('#ff5f8f')
        if (value >= 20) return Color.fromCssColorString('#ffb454')
        if (value <= -80) return Color.fromCssColorString('#6f7cff')
        if (value <= -20) return Color.fromCssColorString('#51b8ff')
        return Color.fromCssColorString('#72e6bc')
      }
      if (marketLayer === 'outputDeviation') {
        if (value >= 15) return Color.fromCssColorString('#52ddff')
        if (value <= -15) return Color.fromCssColorString('#ff6f73')
        return Color.fromCssColorString('#72e6bc')
      }
      if (value >= 70) return Color.fromCssColorString('#ff5f68')
      if (value >= 40) return Color.fromCssColorString('#ffc45c')
      return Color.fromCssColorString('#65e5b8')
    }
    return Color.fromCssColorString('#607989')
  }
  return plant.plantType === 'wind' ? WIND_COLOR : plant.plantType === 'solar' ? SOLAR_COLOR : Color.fromCssColorString('#72f1b8')
}

/** 节点坐标能否上 globe：坐标系、数值范围、解析状态三关都要过。 */
export function validNodeLocation(node: GridGeoNode) {
  const location = node.location
  return Boolean(
    location
      && node.locationStatus !== 'unresolved'
      && location.coordinateSystem === 'WGS84'
      && Number.isFinite(location.longitude)
      && Number.isFinite(location.latitude)
      && location.longitude >= -180
      && location.longitude <= 180
      && location.latitude >= -90
      && location.latitude <= 90,
  )
}

/** 节点标注色：选中黄、近似定位橙、精确绿。 */
export function nodeColor(node: GridGeoNode, selected: boolean) {
  if (selected) return SELECTED_COLOR
  return node.locationStatus === 'approximate'
    ? Color.fromCssColorString('#f6c96b')
    : Color.fromCssColorString('#69e4c2')
}

/** 温度色带：5/15/25/32 四档分界，null 给灰。 */
export function temperatureColor(value: number | null) {
  if (value === null) return Color.fromCssColorString('#8ba8b7')
  if (value <= 5) return Color.fromCssColorString('#6e8cff')
  if (value <= 15) return Color.fromCssColorString('#43c7ff')
  if (value <= 25) return Color.fromCssColorString('#54e3b5')
  if (value <= 32) return Color.fromCssColorString('#ffc85b')
  return Color.fromCssColorString('#ff6b65')
}

/** 天气图层色：按当前图层语义取色。 */
export function weatherColor(weather: GridGeoWeatherSnapshot, weatherLayer: GridGeoWeatherLayer) {
  if (weatherLayer === 'temperature') return temperatureColor(weather.temperatureC)
  if (weatherLayer === 'precipitation') return Color.fromCssColorString('#4c9cff')
  if (weatherLayer === 'irradiance') return Color.fromCssColorString('#ffd45b')
  if (weatherLayer === 'cloud') return Color.fromCssColorString('#c5d8e5')
  return Color.fromCssColorString('#62e8ff')
}

/** 天气图层数值标签；数值缺失返回 null（调用方跳过该要素）。 */
export function weatherLabel(weather: GridGeoWeatherSnapshot, weatherLayer: GridGeoWeatherLayer) {
  if (weatherLayer === 'wind') return Number.isFinite(weather.windSpeedMs) ? `${Number(weather.windSpeedMs).toFixed(1)} m/s` : null
  if (weatherLayer === 'temperature') return Number.isFinite(weather.temperatureC) ? `${Number(weather.temperatureC).toFixed(1)} °C` : null
  if (weatherLayer === 'precipitation') return Number.isFinite(weather.precipitationMm) ? `${Number(weather.precipitationMm).toFixed(1)} mm` : null
  if (weatherLayer === 'irradiance') return Number.isFinite(weather.shortwaveRadiationWm2) ? `${Math.round(Number(weather.shortwaveRadiationWm2))} W/m²` : null
  return Number.isFinite(weather.cloudCoverPercent) ? `${Math.round(Number(weather.cloudCoverPercent))}% 云量` : null
}

/** 风羽终点：从厂站位置沿风的去向延伸，风速越大箭头越长。 */
export function windEndpoint(plant: GridGeoPlant, weather: GridGeoWeatherSnapshot) {
  const travelDirection = ((weather.windDirectionDeg ?? 0) + 180) * Math.PI / 180
  const distanceDegrees = 0.08 + Math.min(0.34, (weather.windSpeedMs ?? 0) * 0.018)
  const latitudeDelta = Math.cos(travelDirection) * distanceDegrees
  const longitudeDelta = Math.sin(travelDirection) * distanceDegrees / Math.max(0.4, Math.cos(plant.location.latitude * Math.PI / 180))
  return [plant.location.longitude + longitudeDelta, plant.location.latitude + latitudeDelta]
}
