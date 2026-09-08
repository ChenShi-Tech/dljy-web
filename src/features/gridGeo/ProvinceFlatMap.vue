<script setup lang="ts">
// 省级平面地图（ECharts geo）。与 CesiumPlantMap 同 props/emits/expose 契约，
// 由宿主按 viewMode 二选一挂载，数据流不必改动。
//
// 相对三维地球的取舍：这里不做地形、不做相机漫游，只把「哪些资产在哪个地市州、
// 价格与偏差如何」平铺出来。坐标按参考精度使用，非精确厂址以真实地理半径的
// 不确定性光圈表达（uncertaintyMeters），不假装点位精确。
//
// 边界数据：GET /api/v1/geo/boundary/{adcode}（需登录），仅限内部使用
// （见 docs/data/geo-boundary-dataset.md）。

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import { ChevronRight, CornerUpLeft, Crosshair, Layers } from 'lucide-vue-next'
import { cssVar, useTheme } from '@/composables/useTheme'
import { currentRegion, selectedRegionId } from '@/services/region/regionContext'
import { ensureBoundaryForRegion, type BoundaryFeature } from './flatmap/geoJsonLoader'
import { hasSubdivisions } from './flatmap/regionAdcode'
import { shortSubdivisionName } from './flatmap/labels'
import {
  boundaryBBox,
  boundsParam,
  collectionBBox,
  focusViewport,
  pointInBoundary,
  topologyFeatureInBoundary,
} from './flatmap/drilldown'
import { createTileBasemap } from './flatmap/tileBasemap'
import { DEFAULT_TIANDITU_LAYER, listTiandituLayers, resolveTiandituLayer, type TiandituLayerId } from './flatmap/tiandituLayers'
import { MERCATOR_PROJECTION, projectMercator } from './flatmap/webMercator'
import { MAP_TOKEN_CHANGE_EVENT, resolveTiandituToken, resolveTiandituTokenSource, writeTiandituToken } from '@/config/mapTokens'
import { topologyFeatureLabel, topologyVisualStyle } from './topology/topologyStyle'
import type { TopologyViewportQuery } from './topology/topologyViewportLoader'
import type {
  GridGeoNode,
  GridGeoPlant,
  GridGeoRuntimeStatus,
  GridGeoSelection,
  GridGeoMapSelection,
  GridGeoTerrainStatus,
  GridGeoViewMode,
  GridGeoWeatherLayer,
  GridGeoWeatherSnapshot,
  GridMarketLayer,
  GridMarketMetric,
  GridOperatorProfile,
  GridGeoTerrainProvider,
  GridTopologyFeature,
} from './types'

const props = defineProps<{
  plants: GridGeoPlant[]
  viewMode: GridGeoViewMode
  selectedPlantId?: string | null
  // 以下为 Cesium 专用参数：接受以保持契约一致，平面地图不消费
  terrainProvider?: GridGeoTerrainProvider
  verticalExaggeration?: number
  hillshadeEnabled?: boolean
  defaultCamera?: GridOperatorProfile['defaultCamera']
  // 图层
  weatherLayer?: GridGeoWeatherLayer
  weatherItems?: GridGeoWeatherSnapshot[]
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

const emit = defineEmits<{
  select: [selection: GridGeoSelection | null]
  'asset-select': [selection: GridGeoMapSelection | null]
  runtime: [status: GridGeoRuntimeStatus]
  /** 平面图无地形。不发这个事件的话，宿主的图层面板会永久停在「正在加载地形」。 */
  terrain: [status: GridGeoTerrainStatus]
  /**
   * 地市州下钻态变化（#1424）。地图内部已完成视角收窄与点层筛选，此事件供宿主同步
   * 侧栏清单与面包屑；退出下钻时发 null。
   *
   * 一并带上落在范围内的 id 集合：边界几何只存在于地图侧，宿主没有它就无法把
   * 「键盘等价列表」筛成同一子集，那会让键盘用户拿不到下钻能力。
   */
  'subdivision-select': [selection: {
    adcode: string
    name: string
    plantIds: string[]
    nodeIds: string[]
    topologyFeatureIds: string[]
  } | null]
  /** 与 CesiumPlantMap 同形状，宿主可无差别处理网架选中。 */
  'topology-select': [selection: { featureId: string; x: number; y: number } | null]
  /** 下钻后把网架查询视口收窄到该地州，并提高 LOD，这正是「下钻」的数据侧含义。 */
  'topology-viewport': [viewport: TopologyViewportQuery]
}>()

const container = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)

/* ---- 天地图底图层 -------------------------------------------------
 * 在线底图是**增强项不是前提**：交付现场是否有外网尚未确认，且 tk 可能没配。
 * 任一条件不成立时本层什么都不画，ECharts 政区图照常工作（见 tileBasemap.ts）。
 * `basemapActive` 驱动政区面的两套配色——有影像时几乎透明，无影像时是实心冷蓝。
 * -------------------------------------------------------------------- */
type TileBasemap = ReturnType<typeof createTileBasemap>
let basemap: TileBasemap | null = null
const basemapActive = ref(false)
const basemapLayerId = ref<TiandituLayerId>(DEFAULT_TIANDITU_LAYER)
const basemapNote = ref('')
const basemapPanelOpen = ref(false)
const basemapTokenDraft = ref('')
const basemapTokenSource = ref(resolveTiandituTokenSource())
const basemapLayerLabel = computed(() => resolveTiandituLayer(basemapLayerId.value).label)
const basemapLayerOptions = listTiandituLayers()
const basemapTokenConfigured = computed(() => basemapTokenSource.value !== 'none')

function openBasemapPanel() {
  basemapTokenDraft.value = basemapTokenSource.value === 'runtime' ? resolveTiandituToken() : ''
  basemapPanelOpen.value = !basemapPanelOpen.value
}

function saveBasemapToken() {
  writeTiandituToken(basemapTokenDraft.value)
  basemapTokenSource.value = resolveTiandituTokenSource()
  basemapPanelOpen.value = false
  // writeTiandituToken 会广播 MAP_TOKEN_CHANGE_EVENT，onMapTokenChange 负责 reset
}

function clearBasemapToken() {
  writeTiandituToken('')
  basemapTokenSource.value = resolveTiandituTokenSource()
  basemapTokenDraft.value = ''
}

// 换底图图层要清掉瓦片缓存与失败态：不同图层的可用性彼此独立，
// 一个图层挂了不代表另一个也挂。
watch(basemapLayerId, () => {
  basemap?.destroy()
  basemap = null
  basemapActive.value = false
  refreshBasemap()
})
const { theme } = useTheme()

const mapName = ref<string | null>(null)
const subdivisions = ref<BoundaryFeature[]>([])
const loadState = ref<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle')
const loadError = ref('')

/** 地区切换世代守卫：切换过快时丢弃过期响应，避免旧省地图覆盖新省。 */
let loadGeneration = 0
let resizeObserver: ResizeObserver | null = null

const canDrillDown = computed(() => hasSubdivisions(selectedRegionId.value))

/** 当前下钻到的地市州（null = 省域全景）。 */
const focusedAdcode = ref<string | null>(null)
const focusedFeature = computed(() =>
  focusedAdcode.value
    ? subdivisions.value.find((feature) => String(feature.properties.adcode) === focusedAdcode.value) ?? null
    : null,
)
const focusedName = computed(() => focusedFeature.value?.properties.name ?? '')
const provinceBBox = computed(() => collectionBBox(subdivisions.value))
const focusedBBox = computed(() => (focusedFeature.value ? boundaryBBox(focusedFeature.value) : null))
const focusView = computed(() => {
  const subdivision = focusedBBox.value
  const province = provinceBBox.value
  if (!subdivision || !province) return null
  return focusViewport(subdivision, province, focusedFeature.value?.properties.center)
})

/** 只渲染有坐标的资产；无坐标不臆造位置。 */
const locatedPlants = computed(() =>
  props.plants.filter((plant) => Number.isFinite(plant.location?.longitude) && Number.isFinite(plant.location?.latitude)),
)

/** 只渲染有坐标的节点，且尊重宿主的 showLocatedNodes 开关。 */
const locatedNodes = computed(() =>
  (props.nodes ?? []).filter(
    (node) => props.showLocatedNodes !== false && Number.isFinite(node.location?.longitude) && Number.isFinite(node.location?.latitude),
  ),
)

const activeTopology = computed(() => (props.showTopology ? props.topologyFeatures ?? [] : []))

// 下钻筛选：省域全景返回全集，地州焦点态只留落在该地州内的要素
const visiblePlants = computed(() => {
  const boundary = focusedFeature.value
  if (!boundary) return locatedPlants.value
  return locatedPlants.value.filter((plant) => pointInBoundary(boundary, plant.location.longitude, plant.location.latitude))
})

const visibleNodes = computed(() => {
  const boundary = focusedFeature.value
  if (!boundary) return locatedNodes.value
  return locatedNodes.value.filter((node) => pointInBoundary(boundary, node.location!.longitude, node.location!.latitude))
})

const visibleTopology = computed(() => {
  const boundary = focusedFeature.value
  if (!boundary) return activeTopology.value
  return activeTopology.value.filter((feature) => topologyFeatureInBoundary(feature, boundary))
})

/** 焦点态下的断面/联络线数量，面包屑上要告诉用户「这里有几条送出通道」。 */
const visibleSectionCount = computed(() =>
  visibleTopology.value.filter((feature) => ['section', 'intertie', 'branch'].includes(feature.kind)).length,
)

const metricByPlantId = computed(() => new Map((props.marketMetrics ?? []).map((metric) => [metric.plantId, metric])))

// 电源类型色是数据编码，按 useTheme 既有约定不随主题变化，同一类型在任何主题下
// 都必须是同一个颜色，否则「蓝色=水电」的读图习惯会被换肤打破。
const PLANT_TYPE_COLOR: Record<string, string> = {
  hydro: '#2f7fe0',
  thermal: '#ef7136',
  wind: '#12b5c4',
  solar: '#e3b032',
  storage: '#8b6ff0',
  other: '#8fa3b5',
}

/**
 * ECharts 的 HTML tooltip 走 innerHTML。standardName / locationLabel 可由资产治理页
 * 写入，服务端 clean() 只做字符串清理不做 HTML 转义，直接拼接会形成存储型 XSS。
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 与 CesiumPlantMap 同口径的市场图层取值。 */
function metricValueFor(metric: GridMarketMetric | undefined, layer: GridMarketLayer): number | null {
  if (!metric) return null
  if (layer === 'priceSpread') return metric.priceSpread
  if (layer === 'outputDeviation') return metric.outputDeviationPercent
  if (layer === 'risk') return metric.riskScore
  return null
}

/**
 * 市场图层色标，与 CesiumPlantMap 的 marketColor 阈值逐档对齐，
 * 保证同一份数据在 2D / 3D 下读出同样的冷暖判断。
 */
function marketColor(value: number | null, layer: GridMarketLayer): string {
  if (value === null) return '#607989'
  if (layer === 'priceSpread') {
    if (value >= 80) return '#ff5f8f'
    if (value >= 20) return '#ffb454'
    if (value <= -80) return '#6f7cff'
    if (value <= -20) return '#51b8ff'
    return '#72e6bc'
  }
  if (layer === 'outputDeviation') {
    if (value >= 15) return '#52ddff'
    if (value <= -15) return '#ff6f73'
    return '#72e6bc'
  }
  if (value >= 70) return '#ff5f68'
  if (value >= 40) return '#ffc45c'
  return '#65e5b8'
}

function plantColor(plant: GridGeoPlant): string {
  return PLANT_TYPE_COLOR[plant.plantType] ?? PLANT_TYPE_COLOR.other
}

/** 装机 → 点位像素半径，做平方根压缩避免大电厂吞掉整张图。 */
function plantSymbolSize(plant: GridGeoPlant): number {
  const capacity = Number(plant.capacityMw)
  if (!Number.isFinite(capacity) || capacity <= 0) return 7
  return Math.max(6, Math.min(26, Math.sqrt(capacity) * 1.15))
}

function buildOption(): echarts.EChartsOption | null {
  if (!mapName.value) return null

  const areaBorder = cssVar('--line') || 'rgba(140,170,200,.5)'
  const labelColor = cssVar('--text-body') || cssVar('--chart-axis-label') || '#64748b'
  const selectedColor = cssVar('--warning') || '#f59e0b'
  const accent = cssVar('--primary') || '#3b82f6'
  const panel = cssVar('--panel') || '#ffffff'

  // L0 底图：地市州分块
  // 有意用统一中性底色而非彩色循环：底图只是地理参照与点击热区，一旦按块上不同
  // 颜色，读者会去找颜色的含义（哪块贵/哪块风险高），而那正是本图不承载的信息。
  // 业务量值一律走点层。
  const activeLayer: GridMarketLayer = props.marketLayer ?? 'none'
  const series: echarts.SeriesOption[] = []

  // L2 精度光圈：按 uncertaintyMeters 画真实地理半径
  // 用 custom series 而非固定像素，缩放时半径随比例尺变化，不失真。
  const haloPlants = visiblePlants.value.filter(
    (plant) => plant.location.displayPolicy === 'uncertainty-halo' && Number(plant.location.uncertaintyMeters) > 0,
  )
  if (haloPlants.length) {
    series.push({
      type: 'custom',
      name: '位置不确定范围',
      coordinateSystem: 'geo',
      geoIndex: 0,
      silent: true,
      z: 2,
      data: haloPlants.map((plant) => [
        plant.location.longitude,
        plant.location.latitude,
        Number(plant.location.uncertaintyMeters),
        plant.plantId,
      ]),
      renderItem: (_params, api) => {
        const lon = Number(api.value(0))
        const lat = Number(api.value(1))
        const meters = Number(api.value(2))
        const center = api.coord([lon, lat])
        // 该纬度下 meters 对应的经度偏移；用它换算成屏幕半径。
        const metersPerLon = 111_320 * Math.cos((lat * Math.PI) / 180)
        if (!Number.isFinite(center[0]) || !metersPerLon) return { type: 'group', children: [] }
        const edge = api.coord([lon + meters / metersPerLon, lat])
        const radius = Math.abs(edge[0] - center[0])
        if (!Number.isFinite(radius) || radius <= 0) return { type: 'group', children: [] }
        return {
          type: 'circle',
          shape: { cx: center[0], cy: center[1], r: radius },
          style: {
            // 光圈表达「厂址只精确到这个范围」，语义上该用警示色而不是随底图的冷色，
            // 否则读者会把它当成又一个业务图层。但 0.1 的暖色填充在深色底上会糊成
            // 一片灰饼——半径大的能盖住小半个地州，反而看不出圈心在哪。
            // 改为几乎只留虚线描边：范围仍然读得出，视觉重量交还给点层。
            fill: echarts.color.modifyAlpha(cssVar('--warning') || '#f59e0b', 0.045),
            stroke: echarts.color.modifyAlpha(cssVar('--warning') || '#f59e0b', 0.46),
            lineWidth: 1,
            lineDash: [3, 3],
          },
        }
      },
    })
  }

  // L1 资产点
  series.push({
    type: 'scatter',
    id: 'plants',
    name: '场站',
    coordinateSystem: 'geo',
    geoIndex: 0,
    z: 5,
    data: visiblePlants.value.map((plant) => ({
      name: plant.standardName,
      value: [plant.location.longitude, plant.location.latitude],
      plantId: plant.plantId,
      itemStyle: {
        // 有市场图层时按指标着色（与图例的冷/暖/高一致）；无图层才退回电源类型色。
        // 否则切「出力偏差 / 综合关注」颜色纹丝不动，用户会把电源类型误读成市场风险。
        color: plant.plantId === props.selectedPlantId
          ? selectedColor
          : activeLayer === 'none'
            ? plantColor(plant)
            : marketColor(metricValueFor(metricByPlantId.value.get(plant.plantId), activeLayer), activeLayer),
        borderColor: panel,
        borderWidth: 1,
        opacity: 0.92,
      },
      symbolSize: plantSymbolSize(plant),
    })),
    emphasis: { scale: 1.25, focus: 'none' },
  })

  // L3 网架：断面 / 联络线 / 线路 与 变电站 / 母线
  // 与 CesiumPlantMap 共用 topologyVisualStyle，同一要素在 2D/3D 下同色同粗细，
  // 换视图不会让「哪条是断面」的判断失效。只画 Provider 返回的真实几何，不推测拓扑。
  const topologyLines = visibleTopology.value
    .map((feature) => {
      const style = topologyVisualStyle(feature, {
        selected: feature.featureId === props.selectedTopologyFeatureId,
        gridOperator: props.topologyGridOperator ?? feature.gridOperator,
        viewMode: props.viewMode,
        lod: focusedFeature.value ? 1 : 0,
        weakNetwork: false,
      })
      const geometry = feature.geometry
      const paths: number[][][] = geometry.type === 'LineString'
        ? [geometry.coordinates as unknown as number[][]]
        : geometry.type === 'MultiLineString'
          ? (geometry.coordinates as unknown as number[][][])
          : []
      return paths
        .filter((coords) => Array.isArray(coords) && coords.length >= 2)
        .map((coords) => ({
          name: feature.name,
          coords: coords.map((position) => [Number(position[0]), Number(position[1])]),
          featureId: feature.featureId,
          featureKind: feature.kind,
          lineStyle: {
            color: style.color,
            width: style.width,
            opacity: 0.92,
            type: style.dashed ? ('dashed' as const) : ('solid' as const),
          },
        }))
    })
    .flat()
  if (topologyLines.length) {
    series.push({
      type: 'lines',
      name: '网架通道',
      coordinateSystem: 'geo',
      geoIndex: 0,
      polyline: true,
      z: 4,
      data: topologyLines,
      emphasis: { lineStyle: { width: 8 }, focus: 'none' },
    })
  }

  const topologyPoints = visibleTopology.value.filter((feature) => feature.geometry.type === 'Point')
  if (topologyPoints.length) {
    series.push({
      type: 'scatter',
      name: '网架站点',
      coordinateSystem: 'geo',
      geoIndex: 0,
      z: 7,
      symbol: 'rect',
      data: topologyPoints.map((feature) => {
        const style = topologyVisualStyle(feature, {
          selected: feature.featureId === props.selectedTopologyFeatureId,
          gridOperator: props.topologyGridOperator ?? feature.gridOperator,
          viewMode: props.viewMode,
          lod: focusedFeature.value ? 1 : 0,
          weakNetwork: false,
        })
        const position = feature.geometry.coordinates as unknown as number[]
        return {
          name: feature.name,
          value: [Number(position[0]), Number(position[1])],
          featureId: feature.featureId,
          featureKind: feature.kind,
          itemStyle: { color: style.color, borderColor: panel, borderWidth: 1 },
          symbolSize: Math.max(7, style.pointSize * 0.7),
        }
      }),
      emphasis: { scale: 1.3, focus: 'none' },
    })
  }

  // L4 节点电价点
  const located = visibleNodes.value
  if (located.length) {
    series.push({
      type: 'scatter',
      name: '节点',
      coordinateSystem: 'geo',
      geoIndex: 0,
      z: 6,
      symbol: 'diamond',
      data: located.map((node) => ({
        name: node.nodeName,
        value: [node.location!.longitude, node.location!.latitude],
        // selectedNodeId 的权威口径是 nodeId（见 CesiumPlantMap 的 nodeColor/选中比对）。
        // 这里原先用 assetId，两者不等时 2D 下选中态与详情卡都对不上。
        nodeId: node.nodeId,
        assetId: node.assetId || node.nodeId,
        itemStyle: {
          color: node.nodeId === props.selectedNodeId ? selectedColor : accent,
          borderColor: panel,
          borderWidth: 1,
        },
        symbolSize: 9,
      })),
      emphasis: { scale: 1.3, focus: 'none' },
    })
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (params: unknown) => {
        const item = params as { seriesName?: string; name?: string; data?: Record<string, unknown> }
        if (item.seriesName === '网架通道' || item.seriesName === '网架站点') {
          const kind = item.data?.featureKind as GridTopologyFeature['kind'] | undefined
          return `<strong>${escapeHtml(item.data?.name ?? item.name)}</strong><br/>${kind ? escapeHtml(topologyFeatureLabel(kind)) : '授权网架要素'}`
        }
        if (item.seriesName === '场站') {
          const plant = visiblePlants.value.find((candidate) => candidate.plantId === item.data?.plantId)
          if (!plant) return String(item.name ?? '')
          const metric = metricByPlantId.value.get(plant.plantId)
          const rows = [
            `<strong>${escapeHtml(plant.standardName)}</strong>`,
            `类型：${escapeHtml(plant.plantType)}　装机：${escapeHtml(plant.capacityMw ?? '—')} MW`,
            `位置：${escapeHtml(plant.location.locationLabel)}`,
            // 精度诚实标注：不精确就写明不精确，并给出实际不确定半径。
            plant.location.displayPolicy === 'uncertainty-halo'
              ? `<em>位置为${plant.location.accuracyLevel}级近似，不确定半径约 ${Math.round(Number(plant.location.uncertaintyMeters))} m</em>`
              : '位置：精确点位',
          ]
          if (activeLayer !== 'none') {
            const value = metricValueFor(metric, activeLayer)
            const label = activeLayer === 'priceSpread' ? '实时-日前价差'
              : activeLayer === 'outputDeviation' ? '出力偏差' : '综合关注'
            const unit = activeLayer === 'priceSpread' ? ' 元/MWh' : activeLayer === 'outputDeviation' ? ' %' : ' 分'
            rows.push(`${label}：${value === null ? '缺测' : escapeHtml(value.toFixed(1)) + unit}`)
          }
          return rows.join('<br/>')
        }
        if (item.seriesName === '节点') return `<strong>${escapeHtml(item.name)}</strong><br/>定价节点`
        return escapeHtml(item.name)
      },
    },
    geo: {
      map: mapName.value,
      roam: true,
      // 用 top/left/right/bottom 让 ECharts 自适应铺满容器；layoutCenter+layoutSize 会
      // 把地图钉死在一个较小的正方框内，省域形状越扁浪费越多。
      top: 16,
      bottom: 16,
      left: 16,
      right: 16,
      // Web Mercator。原先走 ECharts 默认投影（经纬度直接当平面坐标）再用
      // aspectScale 手工压经度方向，那只是观感近似，与任何在线地图瓦片都对不上。
      // 换成 Mercator 后瓦片贴上来是轴对齐矩形，且省域形状本身也更接近真实。
      projection: MERCATOR_PROJECTION,
      itemStyle: basemapActive.value
        ? {
            // 底图在下面透出来，政区面只留一层极淡的冷色蒙版压住影像杂色；边界线
            // 相应提亮——白细线在卫星影像上比在暗底上更容易被地物淹没。
            areaColor: 'rgba(10, 32, 54, 0.18)',
            borderColor: 'rgba(150, 220, 255, 0.62)',
            borderWidth: 1.3,
            shadowBlur: 0,
          }
        : {
            // 降级态（无底图）。原先用 `--primary` 的 16% alpha——驾驶舱主题的
            // primary 是暖橙红，压在深蓝底上叠出一块发脏的棕色，正是「地图太丑」的
            // 直接来源。改用与深色主题同族的冷蓝灰，不再跟随会变暖的品牌色。
            areaColor: 'rgba(24, 58, 88, 0.62)',
            borderColor: 'rgba(126, 194, 231, 0.5)',
            borderWidth: 1,
            shadowBlur: 18,
            shadowColor: 'rgba(64, 150, 205, 0.22)',
          },
      label: {
        show: true,
        color: labelColor,
        fontSize: 14,
        // 地市州名较长（如"西双版纳傣族自治州"），不加粗以免压过业务点层
        fontWeight: 'normal',
        // 全称在地图上必然重叠且喧宾夺主，简称即可辨认，全称留给 tooltip。
        formatter: ({ name }: { name: string }) => shortSubdivisionName(name),
      },
      emphasis: {
        itemStyle: {
          areaColor: basemapActive.value ? 'rgba(72, 190, 240, 0.16)' : 'rgba(46, 96, 140, 0.72)',
        },
        label: { color: '#eaf7ff', fontWeight: 'bold' },
      },
      select: {
        itemStyle: {
          areaColor: basemapActive.value ? 'rgba(72, 190, 240, 0.24)' : 'rgba(58, 118, 168, 0.8)',
        },
        label: { color: '#eaf7ff' },
      },
      // 选中态完全由 focusedAdcode 驱动 regions 样式：notMerge 重建 option 会丢掉
      // ECharts 自己维护的 select 状态，两套来源并存会让高亮与下钻态对不上。
      selectedMode: false,
      // 下钻态：视角收到该地州，其余地州压暗留作地理参照，移除它们会让人失去方位感。
      // 用了 projection 之后 `center` 必须是**投影后**坐标（ECharts geo 的约定），
      // 而 focusViewport 算出来的是经纬度，这里投一次再交给 ECharts。
      ...(focusView.value
        ? { center: projectMercator(focusView.value.center), zoom: focusView.value.zoom }
        : {}),
      regions: focusedAdcode.value
        ? subdivisions.value.map((feature) => {
            const isFocused = String(feature.properties.adcode) === focusedAdcode.value
            return {
              name: feature.properties.name,
              itemStyle: isFocused
                ? { areaColor: echarts.color.modifyAlpha(accent, 0.34), borderColor: selectedColor, borderWidth: 1.8 }
                // 0.06/0.4 实测把分块边界压得完全看不见，整张图只剩一块高亮孤悬
                // 压暗是为了让焦点跳出来，不是为了抹掉地理参照。
                : { areaColor: echarts.color.modifyAlpha(accent, 0.1), borderColor: echarts.color.modifyAlpha(areaBorder, 0.75) },
              label: { show: isFocused, color: cssVar('--text') || '#0f172a', fontWeight: 'bold' as const },
            }
          })
        : undefined,
    },
    series,
  }
}

/** 清空已渲染的图元，但保留 chart 实例（避免重复 init 与闪烁）。 */
function clearChart() {
  chart.value?.clear()
}

function render() {
  const dom = container.value
  if (!dom) return
  // 容器尚未布局（clientWidth/Height 为 0）时 echarts.init 会退回 100x100 默认尺寸，
  // 且此后不会自行纠正，地图会一直缩在角落。此时先不 init，交给 ResizeObserver
  // 在拿到真实尺寸后触发。
  if (!dom.clientWidth || !dom.clientHeight) return

  if (!chart.value) {
    chart.value = echarts.init(dom)
    chart.value.on('click', onChartClick)
    // roam 改变 geo 变换，瓦片必须跟着重贴；tileBasemap 内部按帧合并，
    // 拖拽期间的高频事件不会变成高频重绘。
    chart.value.on('georoam', refreshBasemap)
  }
  const option = buildOption()
  if (!option) return
  chart.value.setOption(option, { notMerge: true })
  // setOption 之后 geo 变换才是最终值（下钻改 center/zoom 时尤其如此），
  // 放在这里刷新才拿得到正确的视口。
  refreshBasemap()
}

function onChartClick(params: unknown) {
  const item = params as {
    componentType?: string
    seriesName?: string
    name?: string
    data?: Record<string, unknown>
    event?: { offsetX?: number; offsetY?: number }
  }
  const x = item.event?.offsetX ?? 0
  const y = item.event?.offsetY ?? 0

  if (item.componentType === 'geo') {
    if (!canDrillDown.value) return
    const feature = subdivisions.value.find((candidate) => candidate.properties.name === item.name)
    if (!feature) return
    const adcode = String(feature.properties.adcode)
    // 再点当前地州 = 收起，与「点空白退出」相比更好发现，也免得下钻后无处可点。
    if (adcode === focusedAdcode.value) exitFocus()
    else enterFocus(adcode)
    return
  }
  if ((item.seriesName === '网架通道' || item.seriesName === '网架站点') && item.data?.featureId) {
    emit('topology-select', { featureId: String(item.data.featureId), x, y })
    return
  }
  if (item.seriesName === '场站' && item.data?.plantId) {
    const plantId = String(item.data.plantId)
    emit('select', { plantId, x, y })
    emit('asset-select', { kind: 'plant', assetId: plantId, plantId, x, y })
    return
  }
  if (item.seriesName === '节点' && item.data?.nodeId) {
    const nodeId = String(item.data.nodeId)
    emit('asset-select', { kind: 'node', assetId: String(item.data.assetId ?? nodeId), nodeId, x, y })
  }
}

/**
 * 进入地市州焦点态。
 *
 * 同时把网架查询视口收窄到该地州并把 LOD 提到 1，下钻不只是视觉放大，数据侧也该
 * 换成「更小范围、更多细节」，否则地州视图里看到的仍是省级抽稀后的那几条线。
 */
function emitSubdivisionScope() {
  const feature = focusedFeature.value
  if (!focusedAdcode.value || !feature) {
    emit('subdivision-select', null)
    return
  }
  emit('subdivision-select', {
    adcode: focusedAdcode.value,
    name: feature.properties.name,
    plantIds: visiblePlants.value.map((plant) => plant.plantId),
    nodeIds: visibleNodes.value.map((node) => node.nodeId),
    topologyFeatureIds: visibleTopology.value.map((item) => item.featureId),
  })
}

function enterFocus(adcode: string) {
  focusedAdcode.value = adcode
  const feature = subdivisions.value.find((candidate) => String(candidate.properties.adcode) === adcode)
  emitSubdivisionScope()
  const box = feature ? boundaryBBox(feature) : null
  emit('topology-viewport', box ? { bounds: boundsParam(box), lod: 1, limit: 1_600 } : { lod: 0, limit: 900 })
  nextTick(render)
}

function exitFocus() {
  if (!focusedAdcode.value) return
  focusedAdcode.value = null
  emit('subdivision-select', null)
  emit('topology-viewport', { lod: 0, limit: 900 })
  nextTick(render)
}

/**
 * 地区切换时复位下钻态：新省份没有旧省的 adcode，留着会筛掉全部要素。
 *
 * 必须同时通知宿主。只清自己的话，宿主会攥着旧地州的 id 集合去过滤新地区的数据
 * （市场页排行就会按旧省 plantIds 筛新省资产），而且不是每个宿主都记得自己清。
 */
function resetFocusForRegionChange() {
  if (!focusedAdcode.value) return
  focusedAdcode.value = null
  emit('subdivision-select', null)
  emit('topology-viewport', { lod: 0, limit: 900 })
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && focusedAdcode.value) exitFocus()
}

async function loadBoundary(regionId: string) {
  const generation = ++loadGeneration
  loadState.value = 'loading'
  loadError.value = ''
  resetFocusForRegionChange()
  // 立即清空旧地区的图元：只清响应式字段不会让已渲染的 option 消失，
  // 加载期间父组件清空 plants 触发的 watcher 又会因 loadState !== 'ready' 跳过 render，
  // 结果旧省地图与场站点长期压在新地区的空态/错误提示下（跨地区数据串显）。
  clearChart()
  try {
    const resolved = await ensureBoundaryForRegion(regionId)
    // 世代守卫：地区已再次切换则丢弃本次结果。
    if (generation !== loadGeneration) return
    if (!resolved) {
      // 模板地区无对应行政区：显空态，绝不回退他省地图。
      mapName.value = null
      subdivisions.value = []
      loadState.value = 'unsupported'
      clearChart()
      return
    }
    mapName.value = resolved.mapName
    subdivisions.value = resolved.geoJson.features
    loadState.value = 'ready'
    await nextTick()
    render()
  } catch (error) {
    if (generation !== loadGeneration) return
    mapName.value = null
    subdivisions.value = []
    loadState.value = 'error'
    clearChart()
    loadError.value = error instanceof Error ? error.message : String(error)
  }
}

/**
 * 与 Cesium 版本同形状的运行时状态。平面地图不走 WebGL、不拉瓦片，
 * 因此 webgl 恒为 ready（避免宿主误报「WebGL 不可用」）、tileCacheSize 恒为 0。
 */
function buildRuntimeStatus(): GridGeoRuntimeStatus {
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean }
  }).connection
  const effectiveType = connection?.effectiveType ?? 'unknown'
  return {
    network: effectiveType === 'slow-2g' || effectiveType === '2g' ? 'weak' : 'normal',
    renderMode: 'on-demand',
    webgl: 'ready',
    tileCacheSize: 0,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    effectiveType,
    dataSaver: connection?.saveData ?? false,
  }
}

function resize() {
  chart.value?.resize()
  refreshBasemap()
}

/** 与 Cesium 版本同名的对外方法，宿主可无差别调用。 */
function focusPlant(plantId: string) {
  const plant = locatedPlants.value.find((candidate) => candidate.plantId === plantId)
  if (!plant || !chart.value) return
  // 侧栏点到的资产可能不在当前下钻范围内，那它根本没被渲染，showTip 只会落空。
  // 先退回省域再定位，比静默什么都不发生要好。
  if (focusedFeature.value && !pointInBoundary(focusedFeature.value, plant.location.longitude, plant.location.latitude)) exitFocus()
  // 光圈 series 会插在场站之前，seriesIndex:0 指向的是光圈而非场站，用稳定 id 定位。
  void nextTick(() => chart.value?.dispatchAction({ type: 'showTip', seriesId: 'plants', name: plant.standardName }))
}

function focusNode(nodeId: string) {
  // 宿主传的是 nodeId（侧栏 selectNode 口径），但历史调用方也可能传 assetId，两者都接。
  const node = (props.nodes ?? []).find((candidate) => candidate.nodeId === nodeId || candidate.assetId === nodeId)
  if (!node || !chart.value) return
  const location = node.location
  if (
    focusedFeature.value
    && location
    && !pointInBoundary(focusedFeature.value, location.longitude, location.latitude)
  ) exitFocus()
  void nextTick(() => chart.value?.dispatchAction({ type: 'showTip', name: node.nodeName }))
}

/** 复位到当前省域的自适应范围。notMerge 重建 option 会清掉 roam 的平移与缩放。 */
function resetView() {
  if (!chart.value || !mapName.value) return
  if (focusedAdcode.value) exitFocus()
  else render()
}

/**
 * 建立或复用瓦片层。必须在 chart 实例存在之后调用——本层的坐标换算完全依赖
 * ECharts geo 的当前变换（`convertToPixel` / `convertFromPixel` 接收的是原始
 * 经纬度，投影由 ECharts 内部按 geo.projection 处理，调用方不必自己投）。
 */
function ensureBasemap() {
  if (!container.value || !chart.value) return
  if (basemap) return
  basemap = createTileBasemap(
    {
      container: container.value,
      toPixel: (lngLat) => {
        const px = chart.value?.convertToPixel({ geoIndex: 0 }, lngLat) as number[] | undefined
        return px && Number.isFinite(px[0]) && Number.isFinite(px[1]) ? [px[0], px[1]] : null
      },
      toLngLat: (pixel) => {
        const ll = chart.value?.convertFromPixel({ geoIndex: 0 }, pixel) as number[] | undefined
        return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? [ll[0], ll[1]] : null
      },
    },
    {
      layerId: basemapLayerId.value,
      token: () => resolveTiandituToken(),
      onStatus: (status) => {
        const active = status.state === 'ready' || status.state === 'loading'
        basemapNote.value = status.state === 'error'
          ? (status.reason ?? '底图不可用')
          : status.state === 'off'
            ? (status.reason ?? '')
            : ''
        // 只有「有没有底图」这件事翻转时才重绘 option：政区面配色依赖它，而
        // loading↔ready 之间来回切不该把整张图重建一遍。
        if (active !== basemapActive.value) {
          basemapActive.value = active
          if (loadState.value === 'ready') nextTick(render)
        }
      },
    },
  )
}

/** geo 视口变化后重贴瓦片；tileBasemap 内部按帧合并，高频调用是安全的。 */
function refreshBasemap() {
  ensureBasemap()
  basemap?.render()
}

/** tk 或图层换了：清缓存与失败态重来，否则失败判定会一直粘着。 */
function onMapTokenChange() {
  basemap?.reset()
}

defineExpose({ focusPlant, focusNode, resetView })

onMounted(() => {
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', onWindowKeydown)
  // 容器尺寸由父级布局决定，挂载时可能仍为 0；用 ResizeObserver 兜住首次真实尺寸，
  // 顺带覆盖侧栏折叠、面板展开等父级尺寸变化。
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!container.value?.clientWidth || !container.value?.clientHeight) return
      if (!chart.value) render()
      else { chart.value.resize(); refreshBasemap() }
    })
    resizeObserver.observe(container.value)
  }
  window.addEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
  emit('runtime', buildRuntimeStatus())
  emit('terrain', { kind: 'ellipsoid', status: 'ready', label: '平面省图 · 无地形' })
  void loadBoundary(selectedRegionId.value)
})

watch(selectedRegionId, (regionId) => void loadBoundary(regionId))
watch(
  () => [
    props.plants,
    props.nodes,
    props.selectedPlantId,
    props.selectedNodeId,
    props.marketLayer,
    props.marketMetrics,
    props.showLocatedNodes,
    props.topologyFeatures,
    props.selectedTopologyFeatureId,
    props.showTopology,
    props.topologyGridOperator,
    theme.value,
  ],
  () => {
    if (loadState.value === 'ready') nextTick(render)
  },
  { deep: true },
)

// 焦点态下节点/网架是按需加载的，数据后到时要补发范围快照，否则宿主会一直按点击那一刻
// 的空集合过滤，侧栏看起来「这个地州什么都没有」。
watch([visiblePlants, visibleNodes, visibleTopology], () => {
  if (focusedAdcode.value) emitSubdivisionScope()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener(MAP_TOKEN_CHANGE_EVENT, onMapTokenChange)
  resizeObserver?.disconnect()
  resizeObserver = null
  basemap?.destroy()
  basemap = null
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <div class="province-flat-map" role="region" :aria-label="props.ariaLabel || '省级平面地图'" :aria-describedby="props.ariaDescribedby">
    <div ref="container" class="canvas" />

    <!--
      下钻面包屑：省 › 地市州。左段可点回省域，右侧同时给出该地州范围内实际筛出的
      资产/节点/通道条数：下钻后地图上若空无一物，用户要能立刻分清是「这里确实没有」
      还是「筛错了」。
    -->
    <nav v-if="focusedAdcode && loadState === 'ready'" class="drill-crumb" aria-label="地图下钻层级">
      <button type="button" class="crumb-root" @click="exitFocus">{{ currentRegion.name }}</button>
      <ChevronRight :size="14" aria-hidden="true" />
      <strong>{{ focusedName }}</strong>
      <span class="crumb-counts">
        资产 {{ visiblePlants.length }} · 节点 {{ visibleNodes.length }} · 通道 {{ visibleSectionCount }}
      </span>
      <button type="button" class="crumb-back" title="返回省域视图（Esc）" @click="exitFocus">
        <CornerUpLeft :size="14" aria-hidden="true" /> 返回省域
      </button>
    </nav>
    <p v-else-if="canDrillDown && loadState === 'ready'" class="drill-hint">点击地市州可下钻查看该范围的节点与送出通道</p>

    <p v-if="loadState === 'loading'" class="state">正在加载地区地图…</p>
    <p v-else-if="loadState === 'unsupported'" class="state">
      当前地区没有对应的省级行政区地图（模板地区）。切换到具体省份后显示。
    </p>
    <p v-else-if="loadState === 'error'" class="state error">地图加载失败：{{ loadError }}</p>

    <button
      v-if="loadState === 'ready'"
      type="button"
      class="reset-view"
      :title="focusedAdcode ? '返回省域视图（Esc）' : '回到本省范围'"
      @click="resetView"
    >
      <Crosshair :size="16" /> {{ focusedAdcode ? '返回省域' : '复位' }}
    </button>

    <div v-if="loadState === 'ready'" class="basemap-control">
      <button
        type="button"
        class="basemap-toggle"
        :class="{ active: basemapActive }"
        :title="basemapActive ? `当前底图：${basemapLayerLabel}` : '配置在线底图'"
        @click="openBasemapPanel"
      >
        <Layers :size="15" aria-hidden="true" /> {{ basemapActive ? basemapLayerLabel : '底图' }}
      </button>

      <div v-if="basemapPanelOpen" class="basemap-panel">
        <label>
          <span>底图图层</span>
          <select v-model="basemapLayerId" aria-label="天地图底图图层">
            <option v-for="item in basemapLayerOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>

        <label>
          <span>天地图 tk</span>
          <input
            v-model="basemapTokenDraft"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="basemapTokenConfigured ? '已配置，留空则不改动' : '在 tianditu.gov.cn 免费申请'"
            aria-label="天地图访问令牌"
            @keyup.enter="saveBasemapToken"
          />
        </label>
        <p class="basemap-hint">
          保存在本机浏览器，立即生效、无需重新构建。未配置或现场无外网时自动退回本地政区图。
        </p>
        <p v-if="basemapNote" class="basemap-hint warn">{{ basemapNote }}</p>

        <div class="basemap-buttons">
          <button type="button" class="primary" @click="saveBasemapToken">保存并启用</button>
          <button v-if="basemapTokenSource === 'runtime'" type="button" @click="clearBasemapToken">清除</button>
          <button type="button" @click="basemapPanelOpen = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 天地图要求显示来源标注，这是使用条件而非可选项；无底图时退回原有说明。 -->
    <p class="source-note">
      <template v-if="basemapActive">底图：© 天地图 · 国家地理信息公共服务平台 | 行政区划：阿里云 DataV.GeoAtlas</template>
      <template v-else>底图数据：阿里云 DataV.GeoAtlas · 仅限内部使用</template>
    </p>
  </div>
</template>

<style scoped>
.province-flat-map { position: relative; width: 100%; height: 100%; }
.canvas { width: 100%; height: 100%; }
.state {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  margin: 0; padding: 10px 16px; border-radius: 8px;
  font-size: var(--font-md); color: var(--text-soft); background: var(--panel, rgba(255, 255, 255, .9));
}
.state.error { color: var(--danger); }
.drill-crumb {
  /* 底部居中：实测左上会被驾驶舱的情景导轨压住（它从地图顶部一直延伸到底部），
     顶部中间又是 signal-strip；两个宿主唯一都空着的是底部中段。
     z-index 高于情报舱（8），否则窄视口下仍会被盖。 */
  position: absolute; bottom: 34px; left: 50%; transform: translateX(-50%); z-index: 9;
  display: flex; align-items: center; gap: 6px; max-width: calc(100% - 32px);
  box-shadow: 0 8px 24px rgba(0, 8, 20, .28);
  padding: 6px 10px; border-radius: 8px; font-size: var(--font-md);
  color: var(--text-body); border: 1px solid var(--line); background: var(--panel);
}
.drill-crumb strong { color: var(--text); }
.drill-crumb button {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 6px; font-size: var(--font-md); cursor: pointer;
  color: var(--text-soft); border: none; border-radius: 6px; background: transparent;
}
.drill-crumb button:hover { color: var(--primary); background: var(--hover, rgba(59, 130, 246, .1)); }
.crumb-counts { margin-left: 4px; font-size: var(--font-sm); color: var(--text-soft); }
.crumb-back { margin-left: 6px; border-left: 1px solid var(--line) !important; border-radius: 0 !important; padding-left: 10px !important; }
.drill-hint {
  position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%); z-index: 2; margin: 0;
  font-size: var(--font-sm); color: var(--text-soft); opacity: .8; pointer-events: none; white-space: nowrap;
}
.reset-view {
  /* 右上角是宿主的 2D/2.5D/3D 模式切换，这里避到右下、来源声明上方 */
  position: absolute; right: 12px; bottom: 32px;
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: var(--font-lg); cursor: pointer;
  color: var(--text-body); border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel);
}
.reset-view:hover { color: var(--primary); border-color: var(--primary); }
.source-note {
  position: absolute; right: 10px; bottom: 8px; margin: 0;
  font-size: var(--font-xs); color: var(--muted, var(--text-soft)); opacity: .75; pointer-events: none;
}

/* 底图控件。与 .reset-view 同族的悬浮小控件，收在左下角避开右下的复位按钮。 */
.basemap-control { position: absolute; z-index: 6; bottom: 34px; left: 12px; }
.basemap-toggle { display: inline-flex; height: 30px; padding: 0 10px; align-items: center; gap: 5px; color: #9fd0e2; border: 1px solid rgba(107, 194, 227, .22); border-radius: 9px; background: rgba(5, 21, 38, .82); backdrop-filter: blur(9px); cursor: pointer; font-size: var(--font-9-5); }
.basemap-toggle:hover { color: #63e4ff; border-color: rgba(99, 228, 255, .38); }
.basemap-toggle.active { color: #63e4ff; border-color: rgba(99, 228, 255, .34); background: rgba(58, 174, 225, .16); }
.basemap-panel { position: absolute; bottom: 38px; left: 0; width: 264px; padding: 11px; border: 1px solid rgba(107, 194, 227, .2); border-radius: 11px; background: rgba(5, 21, 38, .94); box-shadow: 0 18px 44px rgba(0, 7, 18, .5); backdrop-filter: blur(14px); }
.basemap-panel label { display: flex; margin-bottom: 9px; flex-direction: column; gap: 4px; color: #8cb4c3; font-size: var(--font-9); }
.basemap-panel select,
.basemap-panel input { width: 100%; height: 29px; padding: 0 8px; color: #dff5ff; border: 1px solid rgba(107, 194, 227, .22); border-radius: 7px; outline: 0; background: #061a2c; font-size: var(--font-9); }
.basemap-panel input:focus, .basemap-panel select:focus { border-color: rgba(99, 228, 255, .55); }
.basemap-hint { margin: 0 0 8px; color: #7fa2b3; font-size: var(--font-8-5); line-height: 1.5; }
.basemap-hint.warn { color: #d8aa56; }
.basemap-buttons { display: flex; gap: 6px; }
.basemap-buttons button { height: 26px; flex: 1; border: 1px solid rgba(107, 194, 227, .22); border-radius: 7px; color: #9fd0e2; background: rgba(107, 194, 227, .08); cursor: pointer; font-size: var(--font-9); }
.basemap-buttons .primary { color: #63e4ff; border-color: rgba(99, 228, 255, .34); background: rgba(58, 174, 225, .16); }
.basemap-buttons button:hover { background: rgba(58, 174, 225, .24); }
</style>
