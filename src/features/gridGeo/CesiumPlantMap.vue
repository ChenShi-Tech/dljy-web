<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  ArcGISTiledElevationTerrainProvider,
  ArcGisMapServerImageryProvider,
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  CloudCollection,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  DirectionalLight,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  GeoJsonDataSource,
  JulianDate,
  HeightReference,
  HeadingPitchRange,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  IonImageryProvider,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  OpenStreetMapImageryProvider,
  PolylineArrowMaterialProperty,
  Rectangle,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  createWorldTerrainAsync,
  defined,
  type Entity,
  type ImageryProvider,
  type TerrainProvider,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  BASE_MAP_PROVIDERS,
  resolveBaseMapSequenceWithPreferred,
  resolvePreferredBaseMapId,
  shouldFallbackBaseMap,
  type BaseMapProviderConfig,
} from '../../config/mapProviders'
import {
  MAP_TOKEN_CHANGE_EVENT,
  resolveArcgisToken,
  resolveIonToken,
} from '../../config/mapTokens'
import type {
  GridGeoPlant,
  GridGeoMapSelection,
  GridGeoNode,
  GridGeoRuntimeStatus,
  GridGeoSelection,
  GridGeoTerrainProvider,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridGeoWeatherLayer,
  GridGeoWeatherSnapshot,
  GridMarketLayer,
  GridMarketMetric,
  GridOperatorProfile,
  GridTopologyFeature,
} from './types'
import { createCesiumTopologyRenderer } from './topology/cesiumTopologyRenderer'
import type { TopologyViewportQuery } from './topology/topologyViewportLoader'
import { Crosshair, Layers } from 'lucide-vue-next'
import { aggregateMapPoints } from './mapInteraction'
import { loadBoundaryByAdcode } from './flatmap/geoJsonLoader'
import { adcodeForRegion } from './flatmap/regionAdcode'
import { selectedRegionId } from '@/services/region/regionContext'
import { listBaseMapProviders } from '../../config/mapProviders'

const props = defineProps<{
  plants: GridGeoPlant[]
  viewMode: GridGeoViewMode
  selectedPlantId?: string | null
  terrainProvider: GridGeoTerrainProvider
  verticalExaggeration: number
  hillshadeEnabled: boolean
  weatherLayer: GridGeoWeatherLayer
  weatherItems: GridGeoWeatherSnapshot[]
  defaultCamera?: GridOperatorProfile['defaultCamera']
  marketLayer?: GridMarketLayer
  marketMetrics?: GridMarketMetric[]
  nodes?: GridGeoNode[]
  selectedNodeId?: string | null
  showLocatedNodes?: boolean
  topologyFeatures?: GridTopologyFeature[]
  selectedTopologyFeatureId?: string | null
  showTopology?: boolean
  topologyGridOperator?: 'csg' | 'sgcc'
  ariaLabel?: string
  ariaDescribedby?: string
}>()

/**
 * 晕渲（山体阴影）源降级链。
 *
 * 原默认是 `services.arcgisonline.com/.../World_Hillshade_Dark`，实测该子域对本项目
 * 出口 IP 15s 超时无响应，于是「叠加多向地形晕渲」这个默认勾选的复选框长期恒失败——
 * 而它恰恰是免 token 档唯一能让人看出地形起伏的视觉线索（ArcGIS Terrain 3D 没有
 * 顶点法线，光照算不出山体明暗）。
 *
 * 换到可达的 `server.` 子域后实测：World_Hillshade 12 并发全 200、0.90–2.89s。
 * 保留第二档 World_Shaded_Relief（同域、更快、观感偏柔和）以防单个服务抖动。
 */
const HILLSHADE_URL_FALLBACKS = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer',
] as const

const emit = defineEmits<{
  select: [selection: GridGeoSelection | null]
  'asset-select': [selection: GridGeoMapSelection | null]
  terrain: [status: GridGeoTerrainStatus]
  hillshade: [status: { available: boolean; error?: string }]
  runtime: [status: GridGeoRuntimeStatus]
  'topology-select': [selection: { featureId: string; x: number; y: number } | null]
  'topology-viewport': [viewport: TopologyViewportQuery]
}>()

const container = shallowRef<HTMLDivElement | null>(null)
const initializationError = ref('')
const baseMapStatus = ref<{
  state: 'loading' | 'ready' | 'degraded' | 'fallback'
  label: string
  message: string
}>({ state: 'loading', label: '正在加载免费底图', message: '' })
const hoverState = ref<{ x: number; y: number; title: string; detail: string } | null>(null)
const liveMessage = ref('地图已就绪。方向键浏览场站，Enter 选择，Escape 清除选择。')
let viewer: Viewer | null = null
let clickHandler: ScreenSpaceEventHandler | null = null
let resizeObserver: ResizeObserver | null = null
let viewResetTimer: number | null = null
let clouds: CloudCollection | null = null
let terrainRequestId = 0
let hillshadeRequestId = 0
let hillshadeLayer: ImageryLayer | null = null
// 省界轮廓：把当前地区的行政边界标在地形上，避免「一整片地形看不出省在哪」。
let boundaryDataSource: GeoJsonDataSource | null = null
let boundaryRectangle: Rectangle | null = null
let boundaryRequestId = 0
const baseMapOptions = listBaseMapProviders()
const activeBaseMapId = ref(baseMapOptions[0]?.id ?? '')
const baseMapMenuOpen = ref(false)
let runtimeStatus: GridGeoRuntimeStatus | null = null
let reduceMotionEnabled = false
let motionPreference: MediaQueryList | null = null
let connectionPreference: (EventTarget & { effectiveType?: string; saveData?: boolean }) | null = null
let topologyRenderer: ReturnType<typeof createCesiumTopologyRenderer> | null = null
let removeCameraMoveEnd: (() => void) | null = null
let removeBaseMapErrorListener: (() => void) | null = null
let baseMapSequence: BaseMapProviderConfig[] = []
let activeBaseMapIndex = -1
let baseMapErrorCount = 0
let baseMapRequestId = 0
/** 切换进行中收到的最新意图；只保留最后一次，中间态没有展示价值。 */
let pendingBaseMapRequest: { index: number; reason: string } | null = null

/** 有排队请求则立即接上，返回是否已接管后续流程。 */
function flushPendingBaseMap() {
  const next = pendingBaseMapRequest
  pendingBaseMapRequest = null
  if (!next || !viewer) return false
  void switchBaseMap(next.index, next.reason)
  return true
}
let baseMapSwitching = false
let coarsePointer = false
const plantEntityIds = new Set<string>()
const nodeEntityIds = new Set<string>()
const weatherEntityIds = new Set<string>()

function runtimePerformanceProfile() {
  const connection = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; saveData?: boolean } }).connection
  const weakNetwork = connection?.saveData === true || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '')
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  return {
    weakNetwork,
    reducedMotion,
    effectiveType: connection?.effectiveType ?? 'unknown',
    dataSaver: connection?.saveData === true,
    requestRenderMode: weakNetwork || reducedMotion,
    maximumScreenSpaceError: weakNetwork ? 4 : 2,
    tileCacheSize: weakNetwork ? 80 : 200,
  }
}

function applyRuntimePerformanceProfile() {
  const profile = runtimePerformanceProfile()
  reduceMotionEnabled = profile.reducedMotion
  runtimeStatus = {
    network: profile.weakNetwork ? 'weak' : 'normal',
    renderMode: profile.requestRenderMode ? 'on-demand' : 'continuous',
    webgl: runtimeStatus?.webgl ?? 'ready',
    tileCacheSize: profile.tileCacheSize,
    reducedMotion: profile.reducedMotion,
    effectiveType: profile.effectiveType,
    dataSaver: profile.dataSaver,
  }
  if (viewer) {
    viewer.clock.shouldAnimate = !profile.reducedMotion
    viewer.scene.requestRenderMode = profile.requestRenderMode
    viewer.scene.maximumRenderTimeChange = profile.requestRenderMode ? Number.POSITIVE_INFINITY : 0
    viewer.scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError
    viewer.scene.globe.tileCacheSize = profile.tileCacheSize
    rebuildClouds()
    renderTopologyEntities()
    viewer.scene.requestRender()
  }
  emit('runtime', runtimeStatus)
}

function onRuntimePreferenceChange() {
  applyRuntimePerformanceProfile()
}

const WIND = Color.fromCssColorString('#31d9ff')
const SOLAR = Color.fromCssColorString('#a88cff')
const SELECTED = Color.fromCssColorString('#ffe58a')

function marketMetricValue(metric: GridMarketMetric, layer: GridMarketLayer | undefined) {
  if (layer === 'priceSpread') return metric.priceSpread
  if (layer === 'outputDeviation') return metric.outputDeviationPercent
  if (layer === 'risk') return metric.riskScore
  return null
}

function plantColor(plant: GridGeoPlant) {
  const metric = props.marketMetrics?.find((item) => item.plantId === plant.plantId)
  if (props.marketLayer && props.marketLayer !== 'none' && metric) {
    const value = marketMetricValue(metric, props.marketLayer)
    if (value !== null) {
      if (props.marketLayer === 'priceSpread') {
        if (value >= 80) return Color.fromCssColorString('#ff5f8f')
        if (value >= 20) return Color.fromCssColorString('#ffb454')
        if (value <= -80) return Color.fromCssColorString('#6f7cff')
        if (value <= -20) return Color.fromCssColorString('#51b8ff')
        return Color.fromCssColorString('#72e6bc')
      }
      if (props.marketLayer === 'outputDeviation') {
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
  return plant.plantType === 'wind' ? WIND : plant.plantType === 'solar' ? SOLAR : Color.fromCssColorString('#72f1b8')
}

function markerCanvas(plant: GridGeoPlant, selected: boolean, metricColor = plantColor(plant)) {
  const color = selected ? '#ffe58a' : metricColor.toCssColorString()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(48, 45)
  ctx.shadowColor = color
  ctx.shadowBlur = selected ? 24 : 15
  ctx.fillStyle = 'rgba(4, 18, 34, .92)'
  ctx.strokeStyle = color
  ctx.lineWidth = selected ? 4 : 3
  ctx.beginPath()
  ctx.arc(0, 0, 34, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4

  if (plant.plantType === 'wind') {
    ctx.beginPath()
    ctx.arc(0, -2, 6, 0, Math.PI * 2)
    ctx.stroke()
    for (const angle of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
      ctx.save()
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(5, -2)
      ctx.quadraticCurveTo(19, -11, 27, -4)
      ctx.quadraticCurveTo(18, 2, 5, 2)
      ctx.stroke()
      ctx.restore()
    }
    ctx.beginPath()
    ctx.moveTo(-3, 5)
    ctx.lineTo(-7, 28)
    ctx.moveTo(3, 5)
    ctx.lineTo(7, 28)
    ctx.moveTo(-10, 28)
    ctx.lineTo(10, 28)
    ctx.stroke()
  } else {
    ctx.save()
    ctx.rotate(-0.16)
    ctx.strokeRect(-24, -15, 48, 31)
    for (const x of [-8, 8]) {
      ctx.beginPath()
      ctx.moveTo(x, -15)
      ctx.lineTo(x, 16)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(-24, 0)
    ctx.lineTo(24, 0)
    ctx.stroke()
    ctx.restore()
    ctx.beginPath()
    ctx.moveTo(-7, 19)
    ctx.lineTo(-12, 28)
    ctx.moveTo(7, 19)
    ctx.lineTo(12, 28)
    ctx.moveTo(-17, 28)
    ctx.lineTo(17, 28)
    ctx.stroke()
  }
  return canvas
}

function clusterCanvas(count: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 112
  canvas.height = 112
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const gradient = ctx.createRadialGradient(56, 56, 8, 56, 56, 45)
  gradient.addColorStop(0, 'rgba(70, 226, 255, .92)')
  gradient.addColorStop(0.46, 'rgba(13, 87, 119, .96)')
  gradient.addColorStop(1, 'rgba(4, 20, 36, .92)')
  ctx.fillStyle = gradient
  ctx.strokeStyle = '#7cecff'
  ctx.lineWidth = 3
  ctx.shadowColor = '#31d9ff'
  ctx.shadowBlur = 22
  ctx.beginPath()
  ctx.arc(56, 56, 37, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#f0fdff'
  ctx.font = '700 29px "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), 56, 53)
  ctx.fillStyle = '#8feaff'
  ctx.font = '600 10px "PingFang SC", sans-serif'
  ctx.fillText('场站', 56, 76)
  return canvas
}

function addPlantCluster(assetIds: string[], longitude: number, latitude: number) {
  if (!viewer) return
  const plants = assetIds
    .map((plantId) => props.plants.find((plant) => plant.plantId === plantId))
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
      width: coarsePointer ? 62 : 54,
      height: coarsePointer ? 62 : 54,
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
  if (!viewer) return
  const selected = plant.plantId === props.selectedPlantId
  const color = selected ? SELECTED : plantColor(plant)
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
          const pulse = reduceMotionEnabled ? 1 : 0.94 + Math.sin(Date.now() / 900 + pulseStart) * 0.06
          return Math.max(2600, uncertainty * pulse)
        }, false),
        semiMinorAxis: new CallbackProperty(() => {
          const pulse = reduceMotionEnabled ? 1 : 0.94 + Math.sin(Date.now() / 900 + pulseStart) * 0.06
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
      width: selected ? 58 : coarsePointer ? 52 : 46,
      height: selected ? 58 : coarsePointer ? 52 : 46,
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
      fillColor: selected ? SELECTED : Color.WHITE,
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

function validNodeLocation(node: GridGeoNode) {
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

function nodeColor(node: GridGeoNode, selected = node.nodeId === props.selectedNodeId) {
  if (selected) return SELECTED
  return node.locationStatus === 'approximate'
    ? Color.fromCssColorString('#f6c96b')
    : Color.fromCssColorString('#69e4c2')
}

function addNodeEntity(node: GridGeoNode) {
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
      fillColor: selected ? SELECTED : color,
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

function temperatureColor(value: number | null) {
  if (value === null) return Color.fromCssColorString('#8ba8b7')
  if (value <= 5) return Color.fromCssColorString('#6e8cff')
  if (value <= 15) return Color.fromCssColorString('#43c7ff')
  if (value <= 25) return Color.fromCssColorString('#54e3b5')
  if (value <= 32) return Color.fromCssColorString('#ffc85b')
  return Color.fromCssColorString('#ff6b65')
}

function weatherColor(weather: GridGeoWeatherSnapshot) {
  if (props.weatherLayer === 'temperature') return temperatureColor(weather.temperatureC)
  if (props.weatherLayer === 'precipitation') return Color.fromCssColorString('#4c9cff')
  if (props.weatherLayer === 'irradiance') return Color.fromCssColorString('#ffd45b')
  if (props.weatherLayer === 'cloud') return Color.fromCssColorString('#c5d8e5')
  return Color.fromCssColorString('#62e8ff')
}

function weatherLabel(weather: GridGeoWeatherSnapshot) {
  if (props.weatherLayer === 'wind') return Number.isFinite(weather.windSpeedMs) ? `${Number(weather.windSpeedMs).toFixed(1)} m/s` : null
  if (props.weatherLayer === 'temperature') return Number.isFinite(weather.temperatureC) ? `${Number(weather.temperatureC).toFixed(1)} °C` : null
  if (props.weatherLayer === 'precipitation') return Number.isFinite(weather.precipitationMm) ? `${Number(weather.precipitationMm).toFixed(1)} mm` : null
  if (props.weatherLayer === 'irradiance') return Number.isFinite(weather.shortwaveRadiationWm2) ? `${Math.round(Number(weather.shortwaveRadiationWm2))} W/m²` : null
  return Number.isFinite(weather.cloudCoverPercent) ? `${Math.round(Number(weather.cloudCoverPercent))}% 云量` : null
}

function windEndpoint(plant: GridGeoPlant, weather: GridGeoWeatherSnapshot) {
  const travelDirection = ((weather.windDirectionDeg ?? 0) + 180) * Math.PI / 180
  const distanceDegrees = 0.08 + Math.min(0.34, (weather.windSpeedMs ?? 0) * 0.018)
  const latitudeDelta = Math.cos(travelDirection) * distanceDegrees
  const longitudeDelta = Math.sin(travelDirection) * distanceDegrees / Math.max(0.4, Math.cos(plant.location.latitude * Math.PI / 180))
  return [plant.location.longitude + longitudeDelta, plant.location.latitude + latitudeDelta]
}

function addWeatherEntity(weather: GridGeoWeatherSnapshot) {
  if (!viewer || props.weatherLayer === 'none' || props.weatherLayer === 'cloud') return
  const plant = props.plants.find((item) => item.plantId === weather.plantId)
  if (!plant) return
  const label = weatherLabel(weather)
  if (!label) return
  if (props.weatherLayer === 'wind' && !Number.isFinite(weather.windDirectionDeg)) return
  const color = weatherColor(weather)
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
  clouds.show = props.weatherLayer === 'cloud' && props.viewMode === '3d'
  if (!clouds.show) return
  for (const weather of props.weatherItems) {
    const plant = props.plants.find((item) => item.plantId === weather.plantId)
    if (!plant || !Number.isFinite(weather.cloudCoverPercent) || Number(weather.cloudCoverPercent) < 15) continue
    const cloudCount = runtimeStatus?.network === 'weak'
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

function clearTrackedEntities(ids: Set<string>) {
  if (!viewer) return
  for (const id of ids) viewer.entities.removeById(id)
  ids.clear()
}

function renderPlantEntities() {
  if (!viewer) return
  clearTrackedEntities(plantEntityIds)
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
  if (!viewer) return
  clearTrackedEntities(nodeEntityIds)
  if (props.showLocatedNodes) (props.nodes ?? []).forEach(addNodeEntity)
  viewer.scene.requestRender()
}

function renderWeatherEntities() {
  if (!viewer) return
  clearTrackedEntities(weatherEntityIds)
  props.weatherItems.forEach(addWeatherEntity)
  rebuildClouds()
  viewer.scene.requestRender()
}

function renderEntities() {
  renderPlantEntities()
  renderNodeEntities()
  renderWeatherEntities()
  renderTopologyEntities()
}

function renderTopologyEntities() {
  if (!viewer || !topologyRenderer) return
  if (!props.showTopology) {
    topologyRenderer.clear()
    return
  }
  topologyRenderer.render(props.topologyFeatures ?? [], {
    selectedFeatureId: props.selectedTopologyFeatureId ?? null,
    gridOperator: props.topologyGridOperator ?? props.topologyFeatures?.[0]?.gridOperator ?? 'csg',
    viewMode: props.viewMode,
    lod: topologyViewport().lod,
    weakNetwork: runtimeStatus?.network === 'weak',
  })
}

function topologyViewport(): TopologyViewportQuery {
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

function emitTopologyViewport() {
  if (!props.showTopology || !viewer) return
  emit('topology-viewport', topologyViewport())
}

function updateSelectionStyle() {
  // 选中项必须从远景聚合中拆出，因此选择变化时重建轻量电厂实体组。
  renderPlantEntities()
}

function updateNodeSelectionStyle() {
  if (!viewer) return
  for (const node of props.nodes ?? []) {
    if (!validNodeLocation(node)) continue
    const selected = node.nodeId === props.selectedNodeId
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

/**
 * 加载并绘制当前地区的省级行政边界。
 * 只描边、不填色，填色会盖住地形与影像，而这层的目的只是「圈出省在哪」。
 */
async function syncRegionBoundary() {
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
    if (requestId !== boundaryRequestId || !viewer) return

    const accent = Color.fromCssColorString('#ffd166')
    const source = await GeoJsonDataSource.load(geoJson, {
      stroke: accent,
      strokeWidth: 3,
      fill: Color.TRANSPARENT,
      clampToGround: true,
    })
    if (requestId !== boundaryRequestId || !viewer) return

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
    viewer.dataSources.add(source)
    boundaryDataSource = source
    boundaryRectangle = computeBoundaryRectangle(geoJson)
    viewer.scene.requestRender()
  } catch (error) {
    console.warn('[grid-geo] 省界加载失败，保留地形底图', error)
  }
}

/** 从 GeoJSON 坐标算经纬包围盒，供「复位」精确飞到本省而不是运营商全景。 */
function computeBoundaryRectangle(geoJson: { features: Array<{ geometry: { coordinates: unknown } }> }): Rectangle | null {
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

/** 切底图（影像 / 逻辑图）。 */
function selectBaseMap(id: string) {
  const config = BASE_MAP_PROVIDERS[id]
  if (!config) return
  // 需 token 却没配的源点了必失败，菜单已禁用它；这里再挡一次，避免键盘/程序化调用绕过。
  if (config.requiresToken && !baseMapCredentialReady(config)) return
  baseMapMenuOpen.value = false
  activeBaseMapId.value = id
  const index = baseMapSequence.findIndex((item) => item.id === id)
  if (index >= 0) {
    void switchBaseMap(index, '用户切换底图')
    return
  }
  // 目标不在当前序列里，需 token 的源被排除在自动降级链外，显式 VITE_GRID_GEO_BASEMAP
  // 指向免费源时 ion 也不在链上。以它为首选重建序列，其后仍接完整免费降级链。
  baseMapSequence = resolveBaseMapSequenceWithPreferred(id)
  void switchBaseMap(0, '用户切换底图')
}

/** 该源所需凭据是否已就位；无 tokenEnvKey 的源视为无需凭据。 */
function baseMapCredentialReady(config: BaseMapProviderConfig) {
  if (!config.requiresToken) return true
  if (config.tokenEnvKey === 'VITE_CESIUM_ION_TOKEN') {
    return resolveIonToken().length > 0
  }
  return false
}

function resetView(duration = 1.2) {
  if (!viewer) return
  const effectiveDuration = reduceMotionEnabled ? 0 : duration
  // 优先飞到当前省的实际范围；没有省界时才退回运营商全景镜头（它可能落在很远的
  // 区域中心，正是「一复位就跑飞」的来源）。
  if (boundaryRectangle) {
    viewer.camera.flyTo({ destination: boundaryRectangle, duration: effectiveDuration })
    return
  }
  const camera = props.defaultCamera ?? { longitude: 102.15, latitude: 24.85, heightM: 2_450_000 }
  const aspect = Math.max(0.2, (container.value?.clientWidth ?? 1200) / Math.max(1, container.value?.clientHeight ?? 800))
  const narrowViewportFactor = aspect < 0.75 ? Math.min(1.8, 0.75 / aspect) : 1
  if (props.viewMode === '3d') {
    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(Cartesian3.fromDegrees(camera.longitude, camera.latitude, 1800), camera.heightM * 0.2),
      { duration: effectiveDuration, offset: new HeadingPitchRange(-0.12, -0.64, camera.heightM * 0.48 * narrowViewportFactor) }
    )
    return
  }
  const longitudeSpan = Math.min(22, Math.max(5, camera.heightM / 250_000) * narrowViewportFactor)
  const latitudeSpan = longitudeSpan * 0.62
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(camera.longitude - longitudeSpan / 2, camera.latitude - latitudeSpan / 2, camera.longitude + longitudeSpan / 2, camera.latitude + latitudeSpan / 2),
    duration: effectiveDuration,
  })
}

function focusPlant(plantId: string) {
  if (!viewer) return
  if (viewResetTimer !== null) {
    window.clearTimeout(viewResetTimer)
    viewResetTimer = null
  }
  const entity = viewer.entities.getById(`plant:${plantId}`)
  const plant = props.plants.find((item) => item.plantId === plantId)
  if (!entity && !plant) return
  const range = props.viewMode === '2d' ? 520000 : 190000
  if (!entity && plant) {
    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude), 2_000),
      {
        duration: reduceMotionEnabled ? 0 : 1.15,
        offset: new HeadingPitchRange(0, props.viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
      },
    )
    return
  }
  if (!entity) return
  void viewer.flyTo(entity, {
    duration: reduceMotionEnabled ? 0 : 1.15,
    offset: new HeadingPitchRange(0, props.viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
  })
}

function focusNode(nodeId: string) {
  if (!viewer) return
  if (viewResetTimer !== null) {
    window.clearTimeout(viewResetTimer)
    viewResetTimer = null
  }
  const node = (props.nodes ?? []).find((item) => item.nodeId === nodeId)
  const entity = node ? viewer.entities.getById(`node:${node.assetId || node.nodeId}`) : null
  if (!entity) return
  const range = props.viewMode === '2d' ? 420000 : 150000
  void viewer.flyTo(entity, {
    duration: reduceMotionEnabled ? 0 : 1.05,
    offset: new HeadingPitchRange(0, props.viewMode === '2d' ? -Math.PI / 2 : -0.62, range),
  })
}

function applyViewMode(mode: GridGeoViewMode) {
  if (!viewer) return
  if (viewResetTimer !== null) {
    window.clearTimeout(viewResetTimer)
    viewResetTimer = null
  }
  if (viewer.scene.mode === SceneMode.MORPHING) viewer.scene.completeMorph()
  const duration = reduceMotionEnabled ? 0 : 0.85
  if (mode === '2d') viewer.scene.morphTo2D(duration)
  else viewer.scene.morphTo3D(duration)
  applyLighting(mode)
  viewer.scene.fog.enabled = mode !== '2d'
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = mode === '3d'
  if (viewer.scene.sun) viewer.scene.sun.show = mode === '3d'
  rebuildClouds()
  if (reduceMotionEnabled) {
    resetView(0)
    return
  }
  viewResetTimer = window.setTimeout(() => {
    viewResetTimer = null
    resetView(0.7)
  }, 900)
}

/**
 * 地表光照：跟随相机的偏移方向光。
 *
 * 【为什么不是关掉光照】历史上为治「地图太暗」把 `globe.enableLighting` 写死成 false。
 * 那确实治好了「夜半球全黑」，但同时把地形立体感一并砍掉了——Cesium 的地表明暗
 * 100% 来自光照对地表法线的着色，关掉之后无论加载的是多精细的地形，屏幕上都是一张
 * 平的贴图。「切了 3D 地形却看不出 3D」的第一根因就在这里。
 *
 * 【为什么不是直接打开】默认光源是 SunLight（跟真太阳走），打开就会把地球分昼夜，
 * 当地夜里进页面就是一片黑——正是当年关掉它的理由，不能原样退回去。
 *
 * 【本方案】改用 DirectionalLight，方向锁定在「相机的左上后方」并逐帧跟随相机：
 * 相机看到的地表永远在受光面（不会有夜半球），而地表法线随山坡朝向变化仍产生明暗，
 * 山脊亮、背坡暗，立体感回来了。偏移量是关键——若光方向正好等于相机朝向（headlight），
 * 各处入射角趋同，明暗被抹平，等于白开。
 */
let sceneLight: DirectionalLight | null = null
let removePreRender: (() => void) | null = null
const lightDirectionScratch = new Cartesian3()
const lightOffsetScratch = new Cartesian3()

/** 光相对相机的偏移：向右 0.45、向下 0.62，即光源位于相机左上方。 */
const LIGHT_RIGHT_BIAS = 0.45
const LIGHT_UP_BIAS = 0.62

function updateSceneLight() {
  if (!viewer || !sceneLight) return
  const camera = viewer.camera
  const direction = Cartesian3.clone(camera.directionWC, lightDirectionScratch)
  Cartesian3.multiplyByScalar(camera.rightWC, LIGHT_RIGHT_BIAS, lightOffsetScratch)
  Cartesian3.add(direction, lightOffsetScratch, direction)
  Cartesian3.multiplyByScalar(camera.upWC, LIGHT_UP_BIAS, lightOffsetScratch)
  Cartesian3.subtract(direction, lightOffsetScratch, direction)
  Cartesian3.normalize(direction, direction)
  sceneLight.direction = Cartesian3.clone(direction, sceneLight.direction)
}

/**
 * 按视图模式与地形档位调光。
 *
 * 2D（平面地图）下地表法线全部朝向观察者，光照只会平白压暗底图，故关闭。
 * 三维下开启；`arcgis-terrain` 因为没有顶点法线拿不到山体明暗（阴影靠晕渲图层补），
 * 但开着光照仍有价值——地球曲率造成的边缘渐暗会让球体读起来更立体。
 */
function applyLighting(mode: GridGeoViewMode) {
  if (!viewer) return
  const globe = viewer.scene.globe
  globe.enableLighting = mode !== '2d'
  // 提高漫反射系数、压低阴影下限，让山脊/背坡的明暗差拉开又不至于死黑。
  globe.lambertDiffuseMultiplier = 1.45
  globe.vertexShadowDarkness = 0.32
  updateSceneLight()
}

function terrainLabel(kind: GridGeoTerrainProvider) {
  if (kind === 'arcgis-terrain') return 'ArcGIS Terrain 3D'
  if (kind === 'cesium-world-terrain') return 'Cesium World Terrain'
  return 'Cesium 椭球地形'
}

async function createTerrainProvider(kind: GridGeoTerrainProvider): Promise<TerrainProvider> {
  if (kind === 'ellipsoid') return new EllipsoidTerrainProvider()
  if (kind === 'arcgis-terrain') {
    const url = String(import.meta.env.VITE_GRID_GEO_ARCGIS_TERRAIN_URL ?? 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer').trim()
    const token = resolveArcgisToken()
    return ArcGISTiledElevationTerrainProvider.fromUrl(url, token ? { token } : undefined)
  }
  const token = resolveIonToken()
  if (!token) throw new Error('未配置 Cesium ion token')
  Ion.defaultAccessToken = token
  // 顶点法线是这一档存在的全部理由：只有它能让 globe 光照算出山体明暗。
  // ArcGIS Terrain 3D（LERC 高程）的 hasVertexNormals 在 Cesium 里恒为 false，
  // 几何起伏是真的、山坡阴影是没有的，靠晕渲图层补（见 applyHillshade）。
  return createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true })
}

async function applyTerrain(requested: GridGeoTerrainProvider) {
  if (!viewer) return
  const requestId = ++terrainRequestId
  emit('terrain', { kind: requested, status: 'loading', label: terrainLabel(requested) })
  try {
    const provider = await createTerrainProvider(requested)
    if (!viewer || requestId !== terrainRequestId) return
    viewer.terrainProvider = provider
    viewer.scene.globe.depthTestAgainstTerrain = requested !== 'ellipsoid'
    viewer.scene.verticalExaggeration = props.verticalExaggeration
    emit('terrain', { kind: requested, status: 'ready', label: terrainLabel(requested) })
    viewer.scene.requestRender()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const fallback: GridGeoTerrainProvider = requested === 'cesium-world-terrain' ? 'arcgis-terrain' : 'ellipsoid'
    console.warn(`[grid-geo] ${terrainLabel(requested)} 不可用，回退 ${terrainLabel(fallback)}`, error)
    try {
      const provider = await createTerrainProvider(fallback)
      if (!viewer || requestId !== terrainRequestId) return
      viewer.terrainProvider = provider
      viewer.scene.globe.depthTestAgainstTerrain = fallback !== 'ellipsoid'
      viewer.scene.verticalExaggeration = props.verticalExaggeration
      emit('terrain', { kind: fallback, status: 'fallback', label: terrainLabel(fallback), error: message, fallbackFrom: requested })
      viewer.scene.requestRender()
    } catch (fallbackError) {
      if (!viewer || requestId !== terrainRequestId) return
      viewer.terrainProvider = new EllipsoidTerrainProvider()
      viewer.scene.globe.depthTestAgainstTerrain = false
      emit('terrain', {
        kind: 'ellipsoid',
        status: 'error',
        label: terrainLabel('ellipsoid'),
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        fallbackFrom: requested,
      })
    }
  }
}

async function applyHillshade(enabled: boolean) {
  if (!viewer) return
  const requestId = ++hillshadeRequestId
  if (hillshadeLayer) {
    viewer.imageryLayers.remove(hillshadeLayer, true)
    hillshadeLayer = null
  }
  if (!enabled) return
  const explicit = String(import.meta.env.VITE_GRID_GEO_HILLSHADE_URL ?? '').trim()
  const candidates = explicit ? [explicit] : [...HILLSHADE_URL_FALLBACKS]
  let lastError: unknown = null
  try {
    for (const url of candidates) {
      try {
        const provider = await ArcGisMapServerImageryProvider.fromUrl(url)
        if (!viewer || requestId !== hillshadeRequestId || !props.hillshadeEnabled) return
        hillshadeLayer = viewer.imageryLayers.addImageryProvider(provider)
        // 参数是配着卫星影像底图调的，实测过两个失败方向：
        //   alpha 0.28（原值，配矢量街道图）→ 山形几乎看不出来
        //   alpha 0.52 + contrast 1.28      → 灰度晕渲把影像洗成灰白，植被/裸岩的颜色全没了
        // 0.36 是「山脊河谷读得出、影像本色还在」的位置；brightness 略压让阴影侧沉下去，
        // 阴影本来就该是这一层的全部贡献。
        hillshadeLayer.alpha = 0.36
        hillshadeLayer.brightness = 0.94
        hillshadeLayer.contrast = 1.18
        viewer.scene.requestRender()
        emit('hillshade', { available: true })
        return
      } catch (attemptError) {
        lastError = attemptError
        if (!viewer || requestId !== hillshadeRequestId) return
      }
    }
    throw lastError ?? new Error('晕渲源全部不可用')
  } catch (error) {
    // 只 console.warn 的话，面板上复选框还勾着、用户以为晕渲生效了。
    // 失败仍属可能（换域后实测可达，但外网抖动、企业代理仍会拦），必须让 UI 可见。
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[grid-geo] ArcGIS World Hillshade 不可用，保留当前底图', error)
    emit('hillshade', { available: false, error: message })
  }
}

// 把底图配置描述符翻译成 Cesium ImageryProvider；solid-color 由 globe.baseColor 承担。
// ion 走异步工厂（fromAssetId 要先换 endpoint 凭据），故返回值可能是 Promise，
// 由 switchBaseMap 统一 await。
function createBaseImageryProvider(config: BaseMapProviderConfig): ImageryProvider | Promise<ImageryProvider> | null {
  if (config.kind === 'solid-color') return null
  if (config.kind === 'ion') {
    const token = resolveIonToken()
    if (!token) throw new Error(`${config.label} 需要 Cesium ion token`)
    Ion.defaultAccessToken = token
    return IonImageryProvider.fromAssetId(Number(config.ionAssetId))
  }
  if (config.kind === 'url-template') {
    return new UrlTemplateImageryProvider({
      url: config.url,
      credit: config.credit,
      ...(config.subdomains ? { subdomains: config.subdomains } : {}),
    })
  }
  return new OpenStreetMapImageryProvider({ url: config.url, credit: config.credit })
}

function applyLayerAdjustment(layer: ImageryLayer, config: BaseMapProviderConfig) {
  layer.brightness = config.adjustment.brightness
  layer.contrast = config.adjustment.contrast
  layer.saturation = config.adjustment.saturation
  layer.gamma = config.adjustment.gamma
  if (config.adjustment.alpha !== undefined) layer.alpha = config.adjustment.alpha
}

// 本函数开头的 imageryLayers.removeAll(true) 会连 applyHillshade 加入的图层
// 一起销毁，而 hillshadeEnabled prop 未变不触发 watcher 重建。重建必须收敛在这里，
// 覆盖「用户手动切换」与「瓦片连续失败自动 fallback」两条路径。
async function switchBaseMap(index: number, reason = '') {
  if (!viewer) return
  if (baseMapSwitching) {
    // ion 的 fromAssetId 可能慢到用户已经改主意。直接 return 会把这次选择丢掉，
    // 且旧请求完成后还会把它覆盖回去；改为记住最后一次意图，当前切换收尾时接上。
    pendingBaseMapRequest = { index, reason }
    return
  }
  const config = baseMapSequence[index] ?? baseMapSequence.at(-1)
  if (!config) return
  const configIndex = Math.max(0, baseMapSequence.indexOf(config))
  // ion 工厂是异步的：await 期间用户可能又切了一次、组件可能已卸载。用单调 id
  // 判定过期，避免旧请求把新选择覆盖回去（布尔闸只能防并发、防不了乱序回填）。
  const requestId = ++baseMapRequestId
  baseMapSwitching = true

  let provider: ImageryProvider | null
  try {
    provider = await createBaseImageryProvider(config)
  } catch {
    baseMapSwitching = false
    if (flushPendingBaseMap()) return
    if (!viewer || requestId !== baseMapRequestId) return
    void switchBaseMap(configIndex + 1, '底图初始化失败')
    return
  }
  // 先 await 再拆旧图层：否则 ion 换凭据这段时间里地球是空的。
  if (!viewer || requestId !== baseMapRequestId) {
    baseMapSwitching = false
    flushPendingBaseMap()
    return
  }
  // await 期间用户可能已另选底图；先接上它，别把旧结果装上去。
  if (pendingBaseMapRequest) {
    baseMapSwitching = false
    flushPendingBaseMap()
    return
  }
  removeBaseMapErrorListener?.()
  removeBaseMapErrorListener = null
  viewer.imageryLayers.removeAll(true)
  activeBaseMapIndex = configIndex
  // 菜单高亮跟随实际生效的 provider：env 指定了别的底图、或瓦片报错自动
  // fallback 时，都不能还高亮注册表第一项。
  activeBaseMapId.value = config.id
  baseMapErrorCount = 0
  if (!provider) {
    baseMapStatus.value = {
      state: 'fallback',
      label: config.label,
      message: '外部底图不可用，已切换内置地球底色；资产图元、选择与地形控制仍可使用。',
    }
    liveMessage.value = baseMapStatus.value.message
    baseMapSwitching = false
    if (flushPendingBaseMap()) return
    viewer.scene.requestRender()
    return
  }

  const layer = viewer.imageryLayers.addImageryProvider(provider)
  applyLayerAdjustment(layer, config)
  removeBaseMapErrorListener = provider.errorEvent.addEventListener(() => {
    if (!viewer || baseMapSwitching || baseMapSequence[activeBaseMapIndex]?.id !== config.id) return
    baseMapErrorCount += 1
    baseMapStatus.value = {
      state: 'degraded',
      label: config.label,
      message: '底图瓦片响应异常，正在自动切换免费备用源。',
    }
    if (!shouldFallbackBaseMap(baseMapErrorCount)) return
    void switchBaseMap(activeBaseMapIndex + 1, '瓦片连续失败')
  })
  baseMapStatus.value = {
    state: index > 0 ? 'fallback' : 'ready',
    label: config.label,
    message: index > 0 ? `${reason || '首选源不可用'}，已切换免费备用底图。` : '',
  }
  if (index > 0) liveMessage.value = baseMapStatus.value.message
  baseMapSwitching = false
  if (flushPendingBaseMap()) return
  // 本函数开头 removeAll(true) 连山体阴影一起销毁；在此统一重建，手动切换与
  // 瓦片错误自动 fallback 两条路径都会经过这里。
  if (props.hillshadeEnabled) void applyHillshade(true)
  viewer.scene.requestRender()
}

function clusterPlantIds(entity: Entity) {
  if (!viewer) return []
  const value = entity.properties?.clusterPlantIds?.getValue(viewer.clock.currentTime)
  return Array.isArray(value) ? value.map(String) : []
}

function focusPlantCluster(plantIds: string[]) {
  if (!viewer) return
  const positions = plantIds
    .map((plantId) => props.plants.find((plant) => plant.plantId === plantId))
    .filter((plant): plant is GridGeoPlant => Boolean(plant))
    .map((plant) => Cartesian3.fromDegrees(plant.location.longitude, plant.location.latitude))
  if (!positions.length) return
  viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(positions), {
    duration: reduceMotionEnabled ? 0 : 0.9,
    offset: new HeadingPitchRange(0, -0.72, Math.max(120_000, BoundingSphere.fromPoints(positions).radius * 5.2)),
  })
  liveMessage.value = `已展开 ${positions.length} 座场站聚合。`
}

function describePickedEntity(entity: Entity) {
  if (!viewer) return null
  const clusterIds = clusterPlantIds(entity)
  if (clusterIds.length) {
    const capacity = clusterIds.reduce((sum, plantId) => {
      const plant = props.plants.find((item) => item.plantId === plantId)
      return sum + (Number(plant?.capacityMw) || 0)
    }, 0)
    return {
      title: `${clusterIds.length} 座场站`,
      detail: `点击展开 · 已知装机 ${capacity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} MW`,
    }
  }
  const topologyFeatureId = topologyRenderer?.featureIdFromEntity(entity, viewer.clock.currentTime)
  if (topologyFeatureId) {
    const feature = props.topologyFeatures?.find((item) => item.featureId === topologyFeatureId)
    return {
      title: feature?.name ?? entity.name ?? '授权网架要素',
      detail: `${feature?.kind === 'branch' ? '线路' : '变电站'} · 点击查看稳定引用`,
    }
  }
  const nodeId = String(entity.properties?.nodeId?.getValue(viewer.clock.currentTime) ?? '')
  if (nodeId) {
    const node = (props.nodes ?? []).find((item) => item.nodeId === nodeId)
    return { title: node?.nodeName ?? entity.name ?? '空间节点', detail: '点击查看节点信息' }
  }
  const plantId = String(entity.properties?.plantId?.getValue(viewer.clock.currentTime) ?? '')
  if (plantId) {
    const plant = props.plants.find((item) => item.plantId === plantId)
    return {
      title: plant?.standardName ?? entity.name ?? '空间资产',
      detail: plant ? `${plant.location.locationLabel} · 点击查看信息卡` : '点击查看信息卡',
    }
  }
  return null
}

function selectPlantForKeyboard(index: number) {
  if (!props.plants.length) return
  const currentIndex = props.plants.findIndex((plant) => plant.plantId === props.selectedPlantId)
  const nextIndex = currentIndex < 0
    ? (index > 0 ? 0 : props.plants.length - 1)
    : (currentIndex + index + props.plants.length) % props.plants.length
  const plant = props.plants[nextIndex]
  const x = Math.round((container.value?.clientWidth ?? 800) / 2)
  const y = Math.round((container.value?.clientHeight ?? 600) / 2)
  emit('select', { plantId: plant.plantId, x, y })
  emit('asset-select', { kind: 'plant', assetId: plant.plantId, plantId: plant.plantId, x, y })
  liveMessage.value = `已选择 ${plant.standardName}，${nextIndex + 1} / ${props.plants.length}。`
  focusPlant(plant.plantId)
}

function onMapKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    selectPlantForKeyboard(1)
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectPlantForKeyboard(-1)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (props.selectedPlantId) focusPlant(props.selectedPlantId)
    else selectPlantForKeyboard(1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    hoverState.value = null
    emit('select', null)
    emit('asset-select', null)
    emit('topology-select', null)
    liveMessage.value = '已清除地图选择。'
  } else if (event.key === 'Home') {
    event.preventDefault()
    resetView()
    liveMessage.value = '已恢复区域全景。'
  }
}

async function createViewer() {
  if (!container.value) return
  const performanceProfile = runtimePerformanceProfile()
  reduceMotionEnabled = performanceProfile.reducedMotion
  coarsePointer = window.matchMedia?.('(pointer: coarse)').matches === true
  baseMapSequence = resolveBaseMapSequenceWithPreferred(resolvePreferredBaseMapId({
    explicitId: import.meta.env.VITE_GRID_GEO_BASEMAP,
    hasIonToken: resolveIonToken().length > 0,
  }))

  viewer = new Viewer(container.value, {
    baseLayer: false,
    terrainProvider: new EllipsoidTerrainProvider(),
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: !performanceProfile.reducedMotion,
    requestRenderMode: performanceProfile.requestRenderMode,
    maximumRenderTimeChange: performanceProfile.requestRenderMode ? Number.POSITIVE_INFINITY : 0,
  })
  topologyRenderer = createCesiumTopologyRenderer(viewer)

  viewer.scene.backgroundColor = Color.fromCssColorString('#071523')
  // 地球基色决定「影像未加载处」的观感。原 #0a2233 过深，未贴图区域近乎纯黑，
  // 整个地球显脏；抬到中蓝后低层级瓦片与缝隙仍能看清轮廓。
  viewer.scene.globe.baseColor = Color.fromCssColorString('#16405f')
  // 地表光照：用跟随相机的方向光取代太阳，既有山体明暗又不会出现夜半球（见 applyLighting）。
  sceneLight = new DirectionalLight({ direction: Cartesian3.clone(Cartesian3.UNIT_Z), intensity: 2.6 })
  viewer.scene.light = sceneLight
  applyLighting(props.viewMode)
  // 相机一动就要重算光向，否则转到另一侧时明暗关系会僵在原处。
  removePreRender = viewer.scene.preRender.addEventListener(updateSceneLight)
  viewer.scene.globe.dynamicAtmosphereLighting = false
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = false
  viewer.scene.globe.atmosphereLightIntensity = 20
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.globe.maximumScreenSpaceError = performanceProfile.maximumScreenSpaceError
  viewer.scene.globe.tileCacheSize = performanceProfile.tileCacheSize
  applyRuntimePerformanceProfile()
  viewer.scene.canvas.addEventListener('webglcontextlost', onWebglContextLost)
  viewer.scene.canvas.addEventListener('webglcontextrestored', onWebglContextRestored)
  motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  motionPreference?.addEventListener('change', onRuntimePreferenceChange)
  connectionPreference = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; saveData?: boolean } }).connection ?? null
  connectionPreference?.addEventListener('change', onRuntimePreferenceChange)
  window.addEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
  viewer.scene.verticalExaggeration = props.verticalExaggeration
  viewer.scene.fog.enabled = true
  viewer.scene.fog.density = 0.00015
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = props.viewMode === '3d'
    viewer.scene.skyAtmosphere.hueShift = -0.02
    // 原来 saturationShift/brightnessShift 都是负值，等于主动把大气调暗调灰。
    // 改为正向微调，地球边缘亮起来，整体不再发闷。
    viewer.scene.skyAtmosphere.saturationShift = 0.05
    viewer.scene.skyAtmosphere.brightnessShift = 0.12
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 22
  }
  if (viewer.scene.sun) viewer.scene.sun.show = props.viewMode === '3d'
  viewer.scene.sunBloom = props.viewMode === '3d'
  viewer.scene.highDynamicRange = true
  viewer.scene.postProcessStages.fxaa.enabled = true

  // 清晰度
  // Cesium 默认 resolutionScale = 1，即按 CSS 像素渲染。Retina（devicePixelRatio=2）
  // 下等于用一半分辨率渲染再放大，这是「地图糊」的主因，与配色无关。
  // 按 dPR 渲染并封顶 2，避免 3x 屏上像素量翻 9 倍拖垮帧率。
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2)
  // MSAA 是几何级抗锯齿，质量高于 fxaa 后处理；地形与线要素边缘明显更干净。
  if ('msaaSamples' in viewer.scene) viewer.scene.msaaSamples = 4
  clouds = viewer.scene.primitives.add(new CloudCollection({ noiseDetail: 16 }))
  void switchBaseMap(0)
  void syncRegionBoundary()

  clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
    if (!viewer) return
    const picked = viewer.scene.pick(movement.position)
    if (!defined(picked) || !picked.id) {
      emit('select', null)
      emit('asset-select', null)
      emit('topology-select', null)
      return
    }
    const entity = picked.id as Entity
    const clusterIds = clusterPlantIds(entity)
    if (clusterIds.length) {
      focusPlantCluster(clusterIds)
      return
    }
    const topologyFeatureId = topologyRenderer?.featureIdFromEntity(entity, viewer.clock.currentTime)
    if (topologyFeatureId) {
      emit('topology-select', { featureId: topologyFeatureId, x: movement.position.x, y: movement.position.y })
      return
    }
    const nodeId = String(entity.properties?.nodeId?.getValue(viewer.clock.currentTime) ?? '')
    const assetId = String(entity.properties?.assetId?.getValue(viewer.clock.currentTime) ?? '')
    if (nodeId) {
      emit('topology-select', null)
      emit('asset-select', { kind: 'node', assetId: assetId || nodeId, nodeId, x: movement.position.x, y: movement.position.y })
      return
    }
    const plantId = String(entity.properties?.plantId?.getValue(viewer.clock.currentTime) ?? '')
    if (!plantId) {
      emit('select', null)
      emit('asset-select', null)
      return
    }
    const selection = { plantId, x: movement.position.x, y: movement.position.y }
    emit('topology-select', null)
    emit('select', selection)
    emit('asset-select', { kind: 'plant', assetId: plantId, ...selection })
  }, ScreenSpaceEventType.LEFT_CLICK)
  clickHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    if (!viewer || coarsePointer) return
    const picked = viewer.scene.pick(movement.endPosition)
    const entity = defined(picked) && picked.id ? picked.id as Entity : null
    const description = entity ? describePickedEntity(entity) : null
    viewer.scene.canvas.style.cursor = description ? 'pointer' : 'grab'
    hoverState.value = description
      ? {
          x: Math.min(movement.endPosition.x + 16, Math.max(12, (container.value?.clientWidth ?? 0) - 250)),
          y: Math.max(64, movement.endPosition.y - 12),
          ...description,
        }
      : null
  }, ScreenSpaceEventType.MOUSE_MOVE)

  resizeObserver = new ResizeObserver(() => viewer?.resize())
  resizeObserver.observe(container.value)
  removeCameraMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
    renderPlantEntities()
    emitTopologyViewport()
  })
  renderEntities()
  void applyHillshade(props.hillshadeEnabled)
  await applyTerrain(props.terrainProvider)
  if (props.viewMode === '3d') resetView(0)
  else applyViewMode(props.viewMode)
}

function onWebglContextLost(event: Event) {
  event.preventDefault()
  if (!runtimeStatus) return
  runtimeStatus = { ...runtimeStatus, webgl: 'lost' }
  emit('runtime', runtimeStatus)
}

function onWebglContextRestored() {
  if (!runtimeStatus) return
  runtimeStatus = { ...runtimeStatus, webgl: 'restored' }
  emit('runtime', runtimeStatus)
  viewer?.scene.requestRender()
}

watch(() => props.plants, () => {
  renderPlantEntities()
  renderWeatherEntities()
}, { deep: false })
watch(() => props.nodes, renderNodeEntities, { deep: false })
watch(() => props.showLocatedNodes, renderNodeEntities)
watch(() => props.weatherItems, renderWeatherEntities, { deep: false })
watch(() => props.weatherLayer, renderWeatherEntities)
watch(() => props.marketMetrics, renderPlantEntities, { deep: false })
watch(() => props.marketLayer, renderPlantEntities)
watch(() => props.viewMode, (mode) => {
  applyViewMode(mode)
  renderTopologyEntities()
})
watch(() => props.selectedPlantId, updateSelectionStyle)
watch(() => props.selectedNodeId, updateNodeSelectionStyle)
watch(() => props.topologyFeatures, renderTopologyEntities, { deep: false })
watch(() => props.selectedTopologyFeatureId, renderTopologyEntities)
watch(() => props.showTopology, () => {
  renderTopologyEntities()
  emitTopologyViewport()
})
watch(() => props.topologyGridOperator, renderTopologyEntities)
watch(() => props.terrainProvider, applyTerrain)
watch(() => props.hillshadeEnabled, applyHillshade)
watch(() => props.verticalExaggeration, (value) => {
  if (!viewer) return
  viewer.scene.verticalExaggeration = value
  viewer.scene.requestRender()
})
watch(() => props.defaultCamera, () => resetView(0.8), { deep: true })

onMounted(() => {
  initializationError.value = ''
  void createViewer().catch((cause) => {
    initializationError.value = cause instanceof Error ? cause.message : '当前设备无法初始化三维地图'
    emit('terrain', {
      kind: 'ellipsoid',
      status: 'error',
      label: '地图初始化失败，未加载地形',
      error: initializationError.value,
      fallbackFrom: props.terrainProvider,
    })
    runtimeStatus = {
      network: 'normal', renderMode: 'on-demand', webgl: 'unavailable', tileCacheSize: 0,
      reducedMotion: reduceMotionEnabled, effectiveType: 'unknown', dataSaver: false,
    }
    emit('runtime', runtimeStatus)
  })
})
onBeforeUnmount(() => {
  if (viewResetTimer !== null) window.clearTimeout(viewResetTimer)
  resizeObserver?.disconnect()
  viewer?.scene.canvas.removeEventListener('webglcontextlost', onWebglContextLost)
  viewer?.scene.canvas.removeEventListener('webglcontextrestored', onWebglContextRestored)
  motionPreference?.removeEventListener('change', onRuntimePreferenceChange)
  connectionPreference?.removeEventListener('change', onRuntimePreferenceChange)
  removeBaseMapErrorListener?.()
  removeCameraMoveEnd?.()
  removePreRender?.()
  removePreRender = null
  sceneLight = null
  window.removeEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
  clickHandler?.destroy()
  viewer?.destroy()
  viewer = null
  reduceMotionEnabled = false
  clouds = null
  hillshadeLayer = null
  motionPreference = null
  connectionPreference = null
  removeCameraMoveEnd = null
  removeBaseMapErrorListener = null
  baseMapSequence = []
  pendingBaseMapRequest = null
  activeBaseMapIndex = -1
  baseMapErrorCount = 0
  baseMapSwitching = false
  topologyRenderer = null
  plantEntityIds.clear()
  nodeEntityIds.clear()
  weatherEntityIds.clear()
})

watch(selectedRegionId, () => void syncRegionBoundary())

/**
 * 地形巡视镜头：飞到本次可见资产里高差最大的一段，用贴近地表的低视角看地形。
 *
 * 省域默认镜头在 245 万米高、俯角 -37°，云南 6000m 的高差在这个视距下只有约 0.7%
 * 的凹凸——地形加载得再对，肉眼也读不出立体感。「地形是不是真的生效了」这个问题
 * 不该靠用户自己拖拽找角度来回答，给一个按钮直接把镜头放到能看见山的地方。
 */
function flyTerrainTour() {
  if (!viewer) return
  if (viewResetTimer !== null) {
    window.clearTimeout(viewResetTimer)
    viewResetTimer = null
  }
  const located = props.plants.filter((plant) => Number.isFinite(plant.location.longitude) && Number.isFinite(plant.location.latitude))
  const camera = props.defaultCamera ?? { longitude: 102.15, latitude: 24.85, heightM: 2_450_000 }
  // 优先挑海拔最高的场站——它周边一定是山区，是最能体现地形的取景点。
  const peak = located.reduce<GridGeoPlant | null>((best, plant) => {
    const elevation = Number(plant.location.elevationM ?? Number.NaN)
    if (!Number.isFinite(elevation)) return best
    const bestElevation = Number(best?.location.elevationM ?? Number.NEGATIVE_INFINITY)
    return elevation > bestElevation ? plant : best
  }, null)
  const target = peak
    ? Cartesian3.fromDegrees(peak.location.longitude, peak.location.latitude, Number(peak.location.elevationM ?? 0))
    : Cartesian3.fromDegrees(camera.longitude, camera.latitude, 1800)
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 12_000), {
    duration: reduceMotionEnabled ? 0 : 1.6,
    // 俯角 -26°、视距 120km：实测 78km 时山体占满整屏、一个场站图标都露不出来，
    // 「巡视」得同时看得见地形和资产才算数。再平就只剩天际线，再远又退回看不出起伏。
    offset: new HeadingPitchRange(-0.42, -0.46, 120_000),
  })
}

/**
 * ion token 在面板里被改过：底图与地形都可能因此从「不可用」变成「可用」，
 * 两者都要重建。不重建的话用户填完 token 得刷新页面才看得到效果。
 */
function onMapTokenChange() {
  if (!viewer) return
  const preferredId = resolvePreferredBaseMapId({
    explicitId: import.meta.env.VITE_GRID_GEO_BASEMAP,
    hasIonToken: resolveIonToken().length > 0,
  })
  if (preferredId !== activeBaseMapId.value) selectBaseMap(preferredId)
  void applyTerrain(props.terrainProvider)
}

defineExpose({ focusPlant, focusNode, resetView, flyTerrainTour })
</script>

<template>
  <div
    ref="container"
    class="cesium-plant-map"
    role="region"
    tabindex="0"
    :aria-label="props.ariaLabel || '电厂三维地理空间地图'"
    :aria-describedby="props.ariaDescribedby ? `${props.ariaDescribedby} grid-geo-map-help` : 'grid-geo-map-help'"
    @keydown="onMapKeydown"
  >
    <span id="grid-geo-map-help" class="sr-only">方向键逐个浏览场站，Enter 或空格聚焦，Escape 清除选择，Home 恢复全景。</span>
    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>

    <div class="map-tools">
      <button type="button" class="map-tool" title="回到本省范围" @click="resetView()">
        <Crosshair :size="16" /> 复位
      </button>
      <div class="map-tool-group">
        <button type="button" class="map-tool" title="切换底图" @click="baseMapMenuOpen = !baseMapMenuOpen">
          <Layers :size="16" /> 底图
        </button>
        <ul v-if="baseMapMenuOpen" class="basemap-menu">
          <li v-for="option in baseMapOptions" :key="option.id">
            <button
              type="button"
              :class="{ active: option.id === activeBaseMapId }"
              :disabled="!baseMapCredentialReady(option)"
              :title="baseMapCredentialReady(option) ? undefined : `需配置 ${option.tokenEnvKey}`"
              @click="selectBaseMap(option.id)"
            >
              {{ option.label }}{{ baseMapCredentialReady(option) ? '' : ' · 未配置 token' }}
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div
      v-if="baseMapStatus.state === 'degraded' || baseMapStatus.state === 'fallback'"
      class="provider-fallback"
      :class="baseMapStatus.state"
      role="status"
    >
      <strong>{{ baseMapStatus.label }}</strong>
      <span>{{ baseMapStatus.message }}</span>
    </div>
    <div
      v-if="hoverState"
      class="map-hover-card"
      :style="{ left: `${hoverState.x}px`, top: `${hoverState.y}px` }"
      aria-hidden="true"
    >
      <strong>{{ hoverState.title }}</strong>
      <span>{{ hoverState.detail }}</span>
    </div>
    <div v-if="initializationError" class="map-fallback" role="alert">
      <strong>三维地图暂不可用</strong>
      <span>{{ initializationError }}</span>
    </div>
  </div>
</template>

<style scoped>
.map-tools{position:absolute;z-index:9;right:12px;bottom:14px;display:flex;gap:8px;align-items:flex-end}
.map-tool-group{position:relative}
.map-tool{display:flex;align-items:center;gap:6px;padding:7px 12px;font-size: var(--font-lg);cursor:pointer;color:var(--text-body);border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.map-tool:hover{color:var(--primary);border-color:var(--primary)}
.basemap-menu{position:absolute;right:0;bottom:calc(100% + 6px);min-width:190px;margin:0;padding:5px;list-style:none;border:1px solid var(--line);border-radius:9px;background:var(--panel);box-shadow:var(--shadow,0 12px 32px rgba(0,0,0,.14))}
.basemap-menu button{display:block;width:100%;padding:8px 10px;font-size: var(--font-lg);text-align:left;cursor:pointer;color:var(--text-body);border:0;border-radius:6px;background:transparent}
.basemap-menu button:disabled{cursor:not-allowed;opacity:.42}
.basemap-menu button:hover{background:var(--surface-hover)}
.basemap-menu button.active{color:var(--primary);background:var(--primary-tint)}
.cesium-plant-map {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 55% 40%, rgba(25, 117, 173, 0.2), transparent 42%),
    #020811;
  touch-action: none;
}

.cesium-plant-map:focus-visible {
  outline: 2px solid #31d9ff;
  outline-offset: -4px;
}

.map-fallback {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  color: #d7eef5;
  text-align: center;
  background: radial-gradient(circle at 50% 35%, rgba(44, 158, 188, 0.18), transparent 36%), #020811;
}

.map-fallback span { max-width: 520px; color: #7fa2af; font-size: var(--font-sm); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.provider-fallback {
  position: absolute;
  z-index: 18;
  right: 14px;
  bottom: 38px;
  display: flex;
  max-width: min(360px, calc(100% - 28px));
  padding: 9px 11px;
  flex-direction: column;
  gap: 3px;
  color: #f7d88c;
  border: 1px solid rgba(235, 181, 72, .38);
  border-radius: 10px;
  background: rgba(42, 29, 8, .88);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .32);
  pointer-events: none;
  backdrop-filter: blur(12px);
}

.provider-fallback strong { font-size: var(--font-xs); }
.provider-fallback span { color: #c8aa69; font-size: var(--font-9); line-height: 1.45; }

.map-hover-card {
  position: absolute;
  z-index: 17;
  display: flex;
  width: 230px;
  padding: 10px 11px;
  transform: translateY(-100%);
  flex-direction: column;
  gap: 3px;
  color: #e7fbff;
  border: 1px solid rgba(90, 220, 247, .35);
  border-radius: 10px;
  background: rgba(3, 20, 34, .92);
  box-shadow: 0 16px 38px rgba(0, 5, 14, .44);
  pointer-events: none;
  backdrop-filter: blur(14px);
}

.map-hover-card strong { overflow: hidden; font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.map-hover-card span { overflow: hidden; color: #82afbd; font-size: var(--font-9); text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 620px), (pointer: coarse) {
  .map-hover-card { display: none; }
  .provider-fallback { right: 10px; bottom: 30px; left: 10px; max-width: none; }
}

:deep(.cesium-viewer),
:deep(.cesium-viewer-cesiumWidgetContainer),
:deep(.cesium-widget),
:deep(.cesium-widget canvas) {
  width: 100%;
  height: 100%;
}

:deep(.cesium-viewer-bottom) {
  right: 8px;
  bottom: 5px;
  left: auto;
  color: rgba(219, 239, 255, 0.72);
  font-size: var(--font-10);
  text-shadow: 0 1px 2px #000;
}
</style>
